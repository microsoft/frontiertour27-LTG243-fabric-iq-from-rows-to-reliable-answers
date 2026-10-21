import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SQL_IMPORT_CHUNK_ROWS = 1_000;

// Keep original record bytes (including quoted newlines and CRLF) in each chunk.
export function csvRecords(text: string): string[] {
  const records: string[] = [];
  let start = 0;
  let state: 'start' | 'plain' | 'quoted' | 'closed' = 'start';
  let fields = 1;
  let expectedFields: number | undefined;
  const finish = (end: number) => {
    if (expectedFields !== undefined && fields !== expectedFields) {
      throw new Error(`CSV record ${records.length + 1} has ${fields} fields; expected ${expectedFields}.`);
    }
    expectedFields = fields;
    records.push(text.slice(start, end));
    start = end;
    fields = 1;
    state = 'start';
  };
  for (let i = text.startsWith('\uFEFF') ? 1 : 0; i < text.length; i++) {
    const c = text[i];
    if (state === 'quoted') {
      if (c === '"') {
        if (text[i + 1] === '"') i++;
        else state = 'closed';
      }
    } else if (c === ',') {
      fields++;
      state = 'start';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      finish(i + 1);
    } else if (c === '"' && state === 'start') {
      state = 'quoted';
    } else if (c === '"' || state === 'closed') {
      throw new Error(`Invalid quoting in CSV record ${records.length + 1}.`);
    } else {
      state = 'plain';
    }
  }
  if (state === 'quoted') throw new Error('Unterminated quoted CSV field.');
  if (start < text.length) finish(text.length);
  if (!records.length || !records[0].replace(/^\uFEFF/, '').trim()) {
    throw new Error('CSV header is missing.');
  }
  return records;
}

type RunFabio = (args: string[]) => string;
type ImportOptions = {
  workspace: string;
  database: string;
  file: string;
  table: string;
  dryRun?: boolean;
};

export function importSqlCsv(
  options: ImportOptions,
  run: RunFabio = runFabio,
  log: (message: string) => void = console.log,
): number {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.table)) {
    throw new Error('SQL table must be a simple identifier.');
  }
  const records = csvRecords(readFileSync(options.file, 'utf8'));
  const header = /[\r\n]$/.test(records[0]) ? records[0] : records[0] + '\n';
  const rows = records.length - 1;
  const base = ['--workspace', options.workspace, '--id', options.database];
  const count = () => {
    const value = run(['sql-database', 'query', ...base, '--sql',
      `SELECT COUNT_BIG(*) AS value FROM dbo.[${options.table}];`,
      '--query', '[0].value', '--output', 'plain']).trim();
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
      throw new Error(`Invalid row count returned for ${options.table}; stopping.`);
    }
    return Number(value);
  };
  if (options.dryRun) {
    log(`DRY-RUN: SQL ${options.table}: ${rows} records, ${Math.ceil(rows / SQL_IMPORT_CHUNK_ROWS)} imports of at most ${SQL_IMPORT_CHUNK_ROWS} records; empty-table and cumulative-count checks; no automatic replay.`);
    return rows;
  }
  if (count() !== 0) {
    throw new Error(`SQL table ${options.table} is not empty. Inspect existing data; replacement requires explicit --overwrite authorization.`);
  }
  const dir = mkdtempSync(join(tmpdir(), 'ltg243-sql-'));
  try {
    for (let offset = 1; offset < records.length; offset += SQL_IMPORT_CHUNK_ROWS) {
      const chunk = records.slice(offset, offset + SQL_IMPORT_CHUNK_ROWS);
      const expected = offset - 1 + chunk.length;
      const file = join(dir, 'chunk.csv');
      writeFileSync(file, header + chunk.join(''), { mode: 0o600 });
      try {
        run(['sql-database', 'import', ...base, '--file', file, '--table', options.table, '--no-create-table']);
        const actual = count();
        if (actual !== expected) {
          throw new Error(`Cumulative row count mismatch: expected ${expected}, found ${actual}.`);
        }
      } catch (cause) {
        throw new Error(
          `SQL import stopped for ${options.table}, records ${offset}-${expected}. ` +
          'This chunk may be partially committed. No replay was attempted. Inspect capacity, connectivity and row counts before recovery; foreign keys may remain disabled.',
          { cause },
        );
      }
      log(`SQL ${options.table}: verified ${expected}/${rows} records.`);
    }
    return rows;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function runFabio(args: string[]): string {
  const result = spawnSync('fabio', args, {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Fabio ${args[0]} ${args[1]} failed (exit ${result.status}).\n${result.stderr}\n${result.stdout}`);
  }
  if (result.stderr) process.stderr.write(result.stderr);
  return result.stdout;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const values = new Map<string, string>();
  let dryRun = false;
  let countOnly = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--count-only') countOnly = true;
    else if (['--workspace', '--id', '--file', '--table'].includes(arg) && args[i + 1] && !args[i + 1].startsWith('--')) {
      values.set(arg, args[++i]);
    } else throw new Error(`Unknown option or missing value: ${arg}`);
  }
  const required = (key: string) => {
    const value = values.get(key);
    if (!value) throw new Error(`${key} is required.`);
    return value;
  };
  const file = required('--file');
  if (countOnly) console.log(csvRecords(readFileSync(file, 'utf8')).length - 1);
  else importSqlCsv({
    workspace: required('--workspace'), database: required('--id'),
    table: required('--table'), file, dryRun,
  });
}
