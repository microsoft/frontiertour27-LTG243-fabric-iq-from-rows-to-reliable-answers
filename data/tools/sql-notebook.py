"""Fabric-side SQL loader. Runtime configuration is injected into a private notebook."""


def read_target(spark, url, table):
    return spark.read.option("url", url).mssql(f"dbo.{table}")


def target_schema(spark, url, table):
    from pyspark.sql.types import StructField, StructType

    fields = read_target(spark, url, table).schema
    columns = (
        spark.read.option("url", url)
        .option("query", f"SELECT name, is_nullable FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.{table}', N'U')")
        .mssql()
        .collect()
    )
    nullability = {column["name"]: column["is_nullable"] for column in columns}
    if len(columns) != len(fields) or set(nullability) != {field.name for field in fields}:
        raise RuntimeError(f"SQL column metadata mismatch for {table}; no write attempted.")
    if any(not isinstance(value, (bool, int)) or value not in (0, 1) for value in nullability.values()):
        raise RuntimeError(f"Invalid SQL nullability metadata for {table}; no write attempted.")
    # JDBC reads can mark every field nullable, even SQL NOT NULL columns.
    return StructType([
        StructField(field.name, field.dataType, bool(nullability[field.name]), field.metadata)
        for field in fields
    ])


def target_count(spark, url, table):
    return (
        spark.read.option("url", url)
        .option("query", f"SELECT COUNT_BIG(*) AS value FROM dbo.[{table}]")
        .mssql()
        .first()["value"]
    )


def load_csv(spark, url, entry):
    from functools import reduce
    from pyspark.sql import functions as F
    from pyspark.sql.types import StringType, StructField, StructType

    schema = target_schema(spark, url, entry["table"])
    string_schema = StructType([StructField(field.name, StringType(), True) for field in schema])
    raw = (
        spark.read.schema(string_schema)
        .option("header", "true")
        .option("enforceSchema", "false")
        .option("mode", "FAILFAST")
        .option("multiLine", "true")
        .option("escape", '"')
        .csv(entry["path"])
    )
    columns = [F.col(f"`{field.name}`") for field in schema]
    converted = raw.select(*[
        column.cast(field.dataType).alias(field.name)
        for column, field in zip(columns, schema)
    ])
    invalid = reduce(lambda a, b: a | b, [
        (column.isNotNull() & column.cast(field.dataType).isNull())
        | (column.isNull() if not field.nullable else F.lit(False))
        for column, field in zip(columns, schema)
    ])
    if raw.filter(invalid).limit(1).count():
        raise RuntimeError(f"Invalid or missing typed value in {entry['table']}; no write attempted.")
    if converted.count() != entry["rows"]:
        raise RuntimeError(f"CSV row count mismatch for {entry['table']}; no write attempted.")
    # Casts mark fields nullable; bulk copy requires the SQL nullability too.
    return spark.createDataFrame(converted.rdd, schema=schema, verifySchema=True)


def verify_source(spark, entry):
    from pyspark.sql import functions as F

    hashes = (
        spark.read.format("binaryFile").load(entry["path"])
        .select(F.sha2("content", 256).alias("sha256"))
        .collect()
    )
    if len(hashes) != 1 or hashes[0]["sha256"] != entry["sha256"]:
        raise RuntimeError(f"OneLake source checksum mismatch for {entry['table']}.")


def write_table(frame, url, table):
    (
        frame.coalesce(1).write.mode("append")
        .option("url", url)
        .option("reliabilityLevel", "NO_DUPLICATES")
        .mssql(f"dbo.{table}")
    )


def run_sql_load(spark, config):
    # The connector uses the notebook's Entra identity; no tokens are persisted.
    import com.microsoft.sqlserver.jdbc.spark

    url = config["url"]
    tables = config["tables"]
    if not tables:
        raise RuntimeError("SQL load manifest contains no tables.")
    for entry in tables:
        if target_count(spark, url, entry["table"]) != 0:
            raise RuntimeError(f"Target {entry['table']} is not empty; refusing to append.")
        verify_source(spark, entry)
        load_csv(spark, url, entry)

    for entry in tables:
        table = entry["table"]
        if target_count(spark, url, table) != 0:
            raise RuntimeError(f"Target {table} changed after preflight; stopping.")
        frame = load_csv(spark, url, entry)
        try:
            if entry["rows"]:
                write_table(frame, url, table)
            actual = target_count(spark, url, table)
            if actual != entry["rows"]:
                raise RuntimeError(f"Expected {entry['rows']} SQL rows, found {actual}.")
        except Exception as error:
            raise RuntimeError(
                f"SQL notebook load failed for {table}; partial commits are possible. "
                "No table replay was attempted. Inspect data and constraints before recovery."
            ) from error
        print(f"Verified SQL table {table}: {entry['rows']} rows.")
