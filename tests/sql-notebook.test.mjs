import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { importSqlNotebook, jdbcUrl, makeNotebook } from '../data/tools/import-sql-notebook.ts';

const id = '00000000-0000-0000-0000-000000000000';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'ltg243-notebook-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, 'a.csv'), 'id,value\n1,"first\nsecond"\n');
  writeFileSync(join(directory, 'b.csv'), 'id,value\r\n2,"quoted ""text"""\r\n');
  return { workspace: id, lakehouse: id, database: id, directory, name: 'DemoSqlLoad' };
}

function client({ failAt = '', status = 'Completed', metadata = true, createId = true } = {}) {
  const calls = [];
  const files = [];
  let notebook;
  return {
    calls, files,
    get notebook() { return notebook; },
    run(args) {
      const operation = args.slice(0, 2).join(' ');
      calls.push(args);
      if (operation === failAt) throw new Error('NETWORK_ERROR');
      if (operation === 'sql-database show') return JSON.stringify({
        data: { properties: metadata ? { serverFqdn: 'example.invalid,1433', databaseName: 'Demo-Database' } : {} },
      });
      if (operation === 'lakehouse upload') {
        assert.ok(existsSync(args[args.indexOf('--source-path') + 1]));
        return '{}';
      }
      if (operation === 'notebook create') {
        const file = args[args.indexOf('--file') + 1];
        files.push(file);
        notebook = JSON.parse(readFileSync(file, 'utf8'));
        return JSON.stringify({ data: createId ? { id } : {} });
      }
      if (operation === 'notebook run') return JSON.stringify({ data: { status } });
      assert.fail(`Unexpected command: ${operation}`);
    },
  };
}

test('notebook path uploads CSVs, binds the Lakehouse and waits for successful Spark completion', (t) => {
  const options = fixture(t);
  const mock = client();
  assert.equal(importSqlNotebook(options, mock.run, () => {}), 2);
  assert.deepEqual(mock.calls.map(args => args.slice(0, 2).join(' ')), [
    'sql-database show', 'lakehouse upload', 'lakehouse upload', 'notebook create', 'notebook run',
  ]);
  const run = mock.calls.at(-1);
  assert.ok(run.includes('--wait'));
  assert.equal(run[run.indexOf('--compute-type') + 1], 'Spark');
  assert.equal(run[run.indexOf('--timeout') + 1], '3600');
  assert.ok(!run.includes('--cancel-on-timeout'));
  const notebook = mock.notebook;
  assert.equal(notebook.nbformat, 4);
  assert.equal(notebook.metadata.trident.lakehouse.default_lakehouse, id);
  assert.equal(notebook.metadata.trident.lakehouse.default_lakehouse_workspace_id, id);
  assert.ok(Array.isArray(notebook.cells[0].source));
  assert.deepEqual(notebook.cells[0].outputs, []);
  assert.equal(notebook.cells[0].execution_count, null);
  const source = notebook.cells[0].source.join('');
  const encoded = source.match(/^config = json.loads\((.+)\)$/m);
  const config = JSON.parse(JSON.parse(encoded[1]));
  assert.equal(config.tables.length, 2);
  for (const table of config.tables) {
    assert.equal(table.rows, 1);
    assert.match(table.sha256, /^[a-f0-9]{64}$/);
    assert.ok(table.path.startsWith(`abfss://${id}@onelake.dfs.fabric.microsoft.com/${id}/Files/ltg243/sql-import/`));
    assert.equal('file' in table, false);
    assert.ok(!JSON.stringify(notebook).includes(options.directory));
  }
  for (const file of mock.files) assert.equal(existsSync(file), false);
});

test('notebook dry run validates CSVs locally without any remote calls or notebook generation', (t) => {
  const messages = [];
  const rows = importSqlNotebook({ ...fixture(t), dryRun: true }, () => assert.fail('No remote calls'), text => messages.push(text));
  assert.equal(rows, 2);
  assert.match(messages.join('\n'), /Upload 2 SQL CSV files \(2 records\)/);
});

test('invalid loading IDs fail before network calls', (t) => {
  assert.throws(() => importSqlNotebook({ ...fixture(t), workspace: 'name-not-id' }, () => assert.fail()), /immutable/);
});

test('empty or malformed source data fails before network calls', (t) => {
  const options = fixture(t);
  rmSync(join(options.directory, 'a.csv'));
  rmSync(join(options.directory, 'b.csv'));
  assert.throws(() => importSqlNotebook(options, () => assert.fail()), /No SQL CSV files/);
  writeFileSync(join(options.directory, 'bad.csv'), 'id,value\n1,"unfinished');
  assert.throws(() => importSqlNotebook(options, () => assert.fail()), /Unterminated/);
});

for (const status of ['Failed', 'Cancelled', 'InProgress', undefined]) {
  test(`notebook ${String(status)} status is not treated as success`, (t) => {
    const mock = client({ status: status ?? null });
    assert.throws(() => importSqlNotebook(fixture(t), mock.run, () => {}), /No retry or fallback/);
    assert.equal(mock.calls.filter(args => args[1] === 'run').length, 1);
    for (const file of mock.files) assert.equal(existsSync(file), false);
  });
}

for (const failAt of ['lakehouse upload', 'notebook create', 'notebook run']) {
  test(`${failAt} failure stops without retry or CLI fallback`, (t) => {
    const mock = client({ failAt });
    assert.throws(() => importSqlNotebook(fixture(t), mock.run, () => {}), error => {
      assert.match(error.message, /No retry or fallback/);
      assert.match(error.cause.message, /NETWORK_ERROR/);
      return true;
    });
    assert.equal(mock.calls.filter(args => args.slice(0, 2).join(' ') === failAt).length, 1);
    assert.ok(!mock.calls.some(args => args[0] === 'sql-database' && args[1] === 'import'));
    for (const file of mock.files) assert.equal(existsSync(file), false);
  });
}

test('missing SQL metadata or notebook ID fails closed', (t) => {
  const options = fixture(t);
  const missingMetadata = client({ metadata: false });
  assert.throws(() => importSqlNotebook(options, missingMetadata.run), /metadata is missing or unsafe/);
  assert.equal(missingMetadata.calls.length, 1);
  const missingId = client({ createId: false });
  assert.throws(() => importSqlNotebook(options, missingId.run), /No retry or fallback/);
  assert.ok(!missingId.calls.some(args => args[1] === 'run'));
});

test('SQL connection URL uses native temporal bulk encoding and rejects connection-string injection', () => {
  assert.equal(jdbcUrl({ serverFqdn: 'example.invalid,1433', databaseName: 'Database-1' }),
    'jdbc:sqlserver://example.invalid:1433;database={Database-1};encrypt=true;trustServerCertificate=false;sendTemporalDataTypesAsStringForBulkCopy=false;');
  for (const properties of [
    null, {}, { serverFqdn: 'host;encrypt=false', databaseName: 'db' },
    { serverFqdn: 'host', databaseName: 'db};password=secret' },
  ]) assert.throws(() => jdbcUrl(properties));
});

const python = process.env.PYTHON ?? 'python3';
const pythonAvailable = !spawnSync(python, ['--version']).error;
test('Python notebook orchestration, validation and partial-failure behavior', {
  skip: !pythonAvailable && 'Install Python 3 or set PYTHON to run notebook offline tests',
}, () => {
  const result = spawnSync(python, [fileURLToPath(new URL('./sql-notebook.test.py', import.meta.url))], {
    encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, timeout: 30_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('generated notebook Python compiles with safely encoded runtime configuration', {
  skip: !pythonAvailable && 'Install Python 3 or set PYTHON to validate generated notebook syntax',
}, () => {
  const notebook = makeNotebook({
    workspace: id, lakehouse: id,
    url: jdbcUrl({ serverFqdn: 'example.invalid', databaseName: 'database "quoted"' }),
    tables: [{ table: 'a', file: '/local/not-for-export.csv', path: 'abfss://example/a.csv', rows: 1, sha256: 'a'.repeat(64) }],
  });
  const source = notebook.cells[0].source.join('');
  const result = spawnSync(python, ['-c', 'import sys; compile(sys.stdin.read(), "generated-notebook", "exec")'], {
    input: source, encoding: 'utf8', timeout: 30_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const configLine = source.match(/^config = json.loads\(.+\)$/m)[0];
  const configuration = spawnSync(python, ['-c', `import json\n${configLine}\nprint(json.dumps(config))`], {
    encoding: 'utf8', timeout: 30_000,
  });
  assert.ifError(configuration.error);
  assert.equal(configuration.status, 0, configuration.stderr);
  assert.equal(JSON.parse(configuration.stdout).url, 'jdbc:sqlserver://example.invalid;database={database "quoted"};encrypt=true;trustServerCertificate=false;sendTemporalDataTypesAsStringForBulkCopy=false;');
});
