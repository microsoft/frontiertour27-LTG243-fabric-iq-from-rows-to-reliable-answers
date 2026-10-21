import importlib.util
import pathlib
import sys
import types
import unittest
from unittest.mock import MagicMock, Mock, patch

path = pathlib.Path(__file__).parents[1] / "data/tools/sql-notebook.py"
spec = importlib.util.spec_from_file_location("sql_notebook", path)
loader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(loader)


class NotebookTests(unittest.TestCase):
    def setUp(self):
        self.spark = Mock()
        self.config = {
            "url": "jdbc:sqlserver://example.invalid;database={demo};",
            "tables": [
                {"table": "a", "rows": 1, "path": "source-a", "sha256": "checksum-a"},
                {"table": "b", "rows": 2, "path": "source-b", "sha256": "checksum-b"},
            ],
        }
        modules = {}
        for name in [
            "com", "com.microsoft", "com.microsoft.sqlserver",
            "com.microsoft.sqlserver.jdbc", "com.microsoft.sqlserver.jdbc.spark",
        ]:
            module = types.ModuleType(name)
            module.__path__ = []
            modules[name] = module
        self.module_patch = patch.dict(sys.modules, modules)
        self.module_patch.start()
        self.addCleanup(self.module_patch.stop)

    def run_load(self, counts, **overrides):
        mocks = {
            "target_count": Mock(side_effect=counts),
            "verify_source": Mock(),
            "load_csv": Mock(return_value=Mock()),
            "write_table": Mock(),
        }
        mocks.update(overrides)
        with patch.multiple(loader, **mocks):
            loader.run_sql_load(self.spark, self.config)
        return mocks

    def test_success_validates_every_source_before_writes(self):
        events = []
        mocks = self.run_load(
            [0, 0, 0, 1, 0, 2],
            verify_source=Mock(side_effect=lambda spark, entry: events.append(("verify", entry["table"]))),
            write_table=Mock(side_effect=lambda frame, url, table: events.append(("write", table))),
        )
        self.assertEqual(events, [("verify", "a"), ("verify", "b"), ("write", "a"), ("write", "b")])
        self.assertEqual(mocks["load_csv"].call_count, 4)

    def test_nonempty_second_table_prevents_all_writes(self):
        writer = Mock()
        with self.assertRaisesRegex(RuntimeError, "not empty"):
            self.run_load([0, 3], write_table=writer)
        writer.assert_not_called()

    def test_changed_target_does_not_append(self):
        writer = Mock()
        with self.assertRaisesRegex(RuntimeError, "changed after preflight"):
            self.run_load([0, 0, 1], write_table=writer)
        writer.assert_not_called()

    def test_bad_source_prevents_all_writes(self):
        writer = Mock()
        with self.assertRaisesRegex(RuntimeError, "checksum mismatch"):
            self.run_load([0], verify_source=Mock(side_effect=RuntimeError("checksum mismatch")), write_table=writer)
        writer.assert_not_called()

    def test_invalid_csv_prevents_all_writes(self):
        writer = Mock()
        with self.assertRaisesRegex(RuntimeError, "invalid CSV"):
            self.run_load([0], load_csv=Mock(side_effect=RuntimeError("invalid CSV")), write_table=writer)
        writer.assert_not_called()

    def test_partial_write_is_not_replayed(self):
        writer = Mock(side_effect=RuntimeError("connection reset"))
        with self.assertRaisesRegex(RuntimeError, "partial commits"):
            self.run_load([0, 0, 0], write_table=writer)
        self.assertEqual(writer.call_count, 1)

    def test_count_mismatch_stops_before_next_write(self):
        writer = Mock()
        with self.assertRaisesRegex(RuntimeError, "partial commits"):
            self.run_load([0, 0, 0, 9], write_table=writer)
        self.assertEqual(writer.call_count, 1)

    def test_header_only_table_is_checked_but_not_written(self):
        self.config["tables"] = [dict(self.config["tables"][0], rows=0)]
        writer = Mock()
        self.run_load([0, 0, 0], write_table=writer)
        writer.assert_not_called()

    def test_writer_only_appends_with_duplicate_protection(self):
        frame = Mock()
        writer = frame.coalesce.return_value.write
        writer.mode.return_value = writer
        writer.option.return_value = writer
        loader.write_table(frame, self.config["url"], "a")
        frame.coalesce.assert_called_once_with(1)
        writer.mode.assert_called_once_with("append")
        writer.option.assert_any_call("reliabilityLevel", "NO_DUPLICATES")
        writer.mssql.assert_called_once_with("dbo.a")

    def csv_loader(self, invalid=0, actual=1):
        fields = [
            types.SimpleNamespace(name="enabled", dataType="boolean", nullable=False),
            types.SimpleNamespace(name="amount", dataType="decimal", nullable=True),
            types.SimpleNamespace(name="day", dataType="date", nullable=True),
        ]
        functions = types.ModuleType("pyspark.sql.functions")
        columns = [MagicMock() for _ in fields]
        functions.col = Mock(side_effect=columns)
        functions.lit = Mock(return_value=MagicMock())
        type_module = types.ModuleType("pyspark.sql.types")
        type_module.StringType = lambda: "string"
        type_module.StructField = lambda name, kind, nullable, metadata=None: types.SimpleNamespace(
            name=name, dataType=kind, nullable=nullable, metadata=metadata or {}
        )
        type_module.StructType = list
        sql_module = types.ModuleType("pyspark.sql")
        sql_module.functions = functions
        modules = {"pyspark": types.ModuleType("pyspark"), "pyspark.sql": sql_module,
                   "pyspark.sql.functions": functions, "pyspark.sql.types": type_module}
        raw = Mock()
        converted = raw.select.return_value
        converted.count.return_value = actual
        raw.filter.return_value.limit.return_value.count.return_value = invalid
        reader = self.spark.read
        reader.schema.return_value = reader
        reader.option.return_value = reader
        reader.csv.return_value = raw
        return fields, columns, converted, modules

    def test_csv_uses_existing_sql_types_and_strict_multiline_reader(self):
        fields, columns, converted, modules = self.csv_loader()
        with patch.dict(sys.modules, modules), patch.object(
            loader, "target_schema", return_value=fields
        ):
            result = loader.load_csv(self.spark, self.config["url"], self.config["tables"][0])
        self.assertIs(result, self.spark.createDataFrame.return_value)
        self.spark.createDataFrame.assert_called_once_with(
            converted.rdd, schema=fields, verifySchema=True
        )
        for field, column in zip(fields, columns):
            column.cast.assert_any_call(field.dataType)
        self.spark.read.option.assert_any_call("enforceSchema", "false")
        self.spark.read.option.assert_any_call("mode", "FAILFAST")
        self.spark.read.option.assert_any_call("multiLine", "true")
        self.spark.read.option.assert_any_call("escape", '"')

    def test_invalid_typed_value_is_rejected(self):
        fields, _, _, modules = self.csv_loader(invalid=1)
        with patch.dict(sys.modules, modules), patch.object(
            loader, "target_schema", return_value=fields
        ), self.assertRaisesRegex(RuntimeError, "Invalid or missing typed value"):
            loader.load_csv(self.spark, self.config["url"], self.config["tables"][0])
        self.spark.createDataFrame.assert_not_called()

    def test_missing_csv_rows_are_rejected(self):
        fields, _, _, modules = self.csv_loader(actual=0)
        with patch.dict(sys.modules, modules), patch.object(
            loader, "target_schema", return_value=fields
        ), self.assertRaisesRegex(RuntimeError, "CSV row count mismatch"):
            loader.load_csv(self.spark, self.config["url"], self.config["tables"][0])
        self.spark.createDataFrame.assert_not_called()

    def test_target_schema_uses_sql_catalog_not_jdbc_read_nullability(self):
        fields, _, _, modules = self.csv_loader()
        jdbc_fields = [
            types.SimpleNamespace(
                name=field.name, dataType=field.dataType, nullable=True,
                metadata={"source": "jdbc"}
            )
            for field in fields
        ]
        self.spark.read.mssql.return_value.collect.return_value = [
            {"name": field.name, "is_nullable": field.nullable} for field in reversed(fields)
        ]
        with patch.dict(sys.modules, modules), patch.object(
            loader, "read_target", return_value=types.SimpleNamespace(schema=jdbc_fields)
        ):
            schema = loader.target_schema(self.spark, self.config["url"], "a")
        self.assertEqual([field.name for field in schema], [field.name for field in fields])
        self.assertEqual([field.nullable for field in schema], [False, True, True])
        self.assertEqual([field.dataType for field in schema], [field.dataType for field in fields])
        self.assertTrue(all(field.metadata == {"source": "jdbc"} for field in schema))

    def test_missing_or_invalid_sql_catalog_metadata_is_rejected(self):
        fields, _, _, modules = self.csv_loader()
        for rows in [
            [],
            [{"name": "wrong", "is_nullable": False}] * len(fields),
            [{"name": field.name, "is_nullable": "false"} for field in fields],
        ]:
            self.spark.read.mssql.return_value.collect.return_value = rows
            with patch.dict(sys.modules, modules), patch.object(
                loader, "read_target", return_value=types.SimpleNamespace(schema=fields)
            ), self.assertRaisesRegex(RuntimeError, "SQL .*metadata"):
                loader.target_schema(self.spark, self.config["url"], "a")


if __name__ == "__main__":
    unittest.main()
