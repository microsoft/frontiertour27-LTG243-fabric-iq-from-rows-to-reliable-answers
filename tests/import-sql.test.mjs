import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { test } from 'node:test';
import { csvRecords, importSqlCsv, SQL_IMPORT_CHUNK_ROWS } from '../data/tools/import-sql.ts';

function fixture(t, text) {
  const dir = mkdtempSync(join(tmpdir(), 'ltg243-import-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'input.csv');
  writeFileSync(file, text);
  return { workspace: 'test-workspace', database: 'test-database', table: 'test_table', file };
}

function mock(initial = 0, failImport = 0, mismatch = false) {
  let count = initial;
  let imports = 0;
  const chunks = [];
  const calls = [];
  const paths = [];
  return {
    chunks, calls, paths,
    run(args) {
      calls.push(args);
      if (args[1] === 'query') return String(count);
      assert.equal(args[1], 'import');
      const path = args[args.indexOf('--file') + 1];
      const text = readFileSync(path, 'utf8');
      paths.push(path);
      chunks.push(text);
      imports++;
      if (imports === failImport) {
        count += 3;
        throw new Error('NETWORK_ERROR: connection reset after partial commit');
      }
      count += csvRecords(text).length - 1 + Number(mismatch);
      return '';
    },
  };
}

test('CSV quoted multiline fields and CRLF preserve original contents', () => {
  const text = '\uFEFFid,text\r\n1,"a,b"\r\n2,"first\r\nsecond ""quoted"""\r\n3,plain';
  const records = csvRecords(text);
  assert.equal(records.length, 4);
  assert.equal(records.join(''), text);
});

for (const text of ['', 'id,text\n1,"unterminated', 'id,text\n1,a"b\n', 'id,text\n1,"a"x\n', 'id,text\n1\n']) {
  test(`rejects malformed CSV ${JSON.stringify(text)}`, () => assert.throws(() => csvRecords(text)));
}

for (const size of [0, 1, 1_000, 1_001, 2_001]) {
  test(`imports ${size} records with exact bounded chunks and counts`, (t) => {
    const text = 'id,text\r\n' + Array.from({ length: size }, (_, i) => `${i},"line\n${i}"\r\n`).join('');
    const options = fixture(t, text);
    const client = mock();
    assert.equal(importSqlCsv(options, client.run, () => {}), size);
    assert.equal(client.chunks.length, Math.ceil(size / SQL_IMPORT_CHUNK_ROWS));
    assert.equal(client.calls.filter(args => args[1] === 'query').length, client.chunks.length + 1);
    assert.ok(client.chunks.every(chunk => csvRecords(chunk).length - 1 <= SQL_IMPORT_CHUNK_ROWS));
    assert.equal('id,text\r\n' + client.chunks.map(chunk => csvRecords(chunk).slice(1).join('')).join(''), text);
    for (const path of client.paths) assert.equal(existsSync(path), false);
  });
}

test('dry run never invokes Fabio and describes bounded calls', (t) => {
  const options = fixture(t, 'id\n1\n2\n');
  const messages = [];
  assert.equal(importSqlCsv({ ...options, dryRun: true }, () => assert.fail('No remote calls'), message => messages.push(message)), 2);
  assert.match(messages.join(''), /2 records, 1 imports of at most 1000 records/);
});

test('non-empty table is never appended to automatically', (t) => {
  const client = mock(3);
  assert.throws(() => importSqlCsv(fixture(t, 'id\n1\n'), client.run), /not empty/);
  assert.equal(client.chunks.length, 0);
});

test('partial commit stops without replay or subsequent chunks and cleans up', (t) => {
  const text = 'id\n' + Array.from({ length: 3_000 }, (_, i) => `${i}\n`).join('');
  const client = mock(0, 2);
  assert.throws(() => importSqlCsv(fixture(t, text), client.run, () => {}), error => {
    assert.match(error.message, /records 1001-2000/);
    assert.match(error.message, /partially committed.*No replay/);
    assert.match(error.cause.message, /NETWORK_ERROR/);
    return true;
  });
  assert.equal(client.chunks.length, 2);
  assert.equal(client.calls.filter(args => args[1] === 'query').length, 2);
  for (const path of client.paths) assert.equal(existsSync(path), false);
});

test('cumulative count mismatch stops before another import', (t) => {
  const text = 'id\n' + Array.from({ length: 1_001 }, (_, i) => `${i}\n`).join('');
  const client = mock(0, 0, true);
  assert.throws(() => importSqlCsv(fixture(t, text), client.run, () => {}), error => {
    assert.match(error.cause.message, /expected 1000, found 1001/);
    return true;
  });
  assert.equal(client.chunks.length, 1);
});

test('invalid count output is not treated as an empty table', (t) => {
  assert.throws(() => importSqlCsv(fixture(t, 'id\n1\n'), () => 'null'), /Invalid row count/);
});

test('unsafe table identifiers are rejected before any remote operation', (t) => {
  assert.throws(() => importSqlCsv({ ...fixture(t, 'id\n1\n'), table: 'a]; DROP TABLE a;' }, () => assert.fail()), /simple identifier/);
});

test('committed sales data reconstructs byte-for-byte over 187 bounded imports', (t) => {
  const text = gunzipSync(readFileSync(new URL('../data/fabric-sql/sales_order_lines.csv.gz', import.meta.url))).toString('utf8');
  const client = mock();
  assert.equal(importSqlCsv(fixture(t, text), client.run, () => {}), 186_859);
  assert.equal(client.chunks.length, 187);
  const records = csvRecords(text);
  const reconstructed = records[0] + client.chunks.map(chunk => csvRecords(chunk).slice(1).join('')).join('');
  assert.equal(reconstructed, text);
});
