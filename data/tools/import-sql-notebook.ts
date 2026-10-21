import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { csvRecords, runFabio } from './import-sql.ts';

type Options = {
  workspace: string;
  lakehouse: string;
  database: string;
  directory: string;
  name: string;
  dryRun?: boolean;
};
type SqlProperties = { serverFqdn?: unknown; databaseName?: unknown };
type Table = { table: string; file: string; path: string; rows: number; sha256: string };

export function jdbcUrl(value: unknown): string {
  if (typeof value !== 'object' || value === null) throw new Error('SQL database properties are missing.');
  const properties: SqlProperties = {
    serverFqdn: 'serverFqdn' in value ? value.serverFqdn : undefined,
    databaseName: 'databaseName' in value ? value.databaseName : undefined,
  };
  const host = properties.serverFqdn;
  const database = properties.databaseName;
  if (typeof host !== 'string' || !/^[A-Za-z0-9.-]+(?:,\d+)?$/.test(host)
      || typeof database !== 'string' || !database || /[;{}\r\n]/.test(database)) {
    throw new Error('SQL database metadata is missing or unsafe: expected serverFqdn and databaseName.');
  }
  return `jdbc:sqlserver://${host.replace(',', ':')};database={${database}};encrypt=true;trustServerCertificate=false;sendTemporalDataTypesAsStringForBulkCopy=false;`;
}

export function makeNotebook(config: { url: string; tables: Table[]; workspace: string; lakehouse: string }) {
  const source = readFileSync(new URL('./sql-notebook.py', import.meta.url), 'utf8');
  const publicConfig = {
    url: config.url,
    tables: config.tables.map(({ table, path, rows, sha256 }) => ({ table, path, rows, sha256 })),
  };
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { name: 'synapse_pyspark', display_name: 'Synapse PySpark', language: 'python' },
      language_info: { name: 'python' },
      trident: {
        lakehouse: {
          default_lakehouse: config.lakehouse,
          default_lakehouse_name: '',
          default_lakehouse_workspace_id: config.workspace,
          known_lakehouses: [{ id: config.lakehouse }],
        },
      },
    },
    cells: [{
      cell_type: 'code', execution_count: null, metadata: {}, outputs: [],
      source: `${source}\nimport json\nconfig = json.loads(${JSON.stringify(JSON.stringify(publicConfig))})\nrun_sql_load(spark, config)\n`.match(/.*\n/g) ?? [],
    }],
  };
}

function jsonObject(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Fabio returned an invalid object response.');
  }
  const data = 'data' in parsed ? parsed.data : parsed;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('Fabio returned an invalid data object.');
  }
  return data as Record<string, unknown>;
}

export function importSqlNotebook(
  options: Options,
  run: (args: string[]) => string = runFabio,
  log: (message: string) => void = console.log,
): number {
  if (!options.name.trim()) throw new Error('Notebook name prefix is required.');
  if (!options.dryRun) {
    for (const id of [options.workspace, options.lakehouse, options.database]) {
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
        throw new Error('Notebook SQL loading requires immutable workspace, Lakehouse and database IDs.');
      }
    }
  }
  const runId = options.dryRun ? 'dry-run' : randomUUID();
  const remoteDirectory = `Files/ltg243/sql-import/${runId}`;
  const tables = readdirSync(options.directory, { withFileTypes: true })
    .filter(file => file.isFile() && file.name.endsWith('.csv'))
    .map(file => {
      const table = basename(file.name, '.csv');
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new Error(`Unsafe SQL table: ${table}`);
      const path = join(options.directory, file.name);
      const bytes = readFileSync(path);
      return {
        table, file: path,
        path: `abfss://${options.workspace}@onelake.dfs.fabric.microsoft.com/${options.lakehouse}/${remoteDirectory}/${file.name}`,
        rows: csvRecords(bytes.toString('utf8')).length - 1,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    }).sort((a, b) => a.table.localeCompare(b.table));
  if (!tables.length) throw new Error('No SQL CSV files found for notebook loading.');
  const rows = tables.reduce((total, table) => total + table.rows, 0);
  if (options.dryRun) {
    log(`DRY-RUN: Upload ${tables.length} SQL CSV files (${rows} records) to a unique Lakehouse Files/ltg243/sql-import/<run> directory.`);
    log('DRY-RUN: Resolve SQL server/database metadata; create a private PySpark helper notebook bound to the Lakehouse.');
    log('DRY-RUN: Run notebook with --wait --timeout 3600; require Completed status, source checksums, empty tables, typed CSVs and exact SQL counts. Never replay on failure.');
    return rows;
  }
  const workspace = ['--workspace', options.workspace];
  const database = jsonObject(run(['sql-database', 'show', ...workspace, '--id', options.database, '--output', 'json']));
  const properties = database.properties;
  if (typeof properties !== 'object' || properties === null) {
    throw new Error('SQL database properties are missing.');
  }
  const url = jdbcUrl(properties);
  const dir = mkdtempSync(join(tmpdir(), 'ltg243-sql-notebook-'));
  let notebookId: string | undefined;
  try {
    for (const table of tables) {
      run(['lakehouse', 'upload', ...workspace, '--id', options.lakehouse,
        '--source-path', table.file, '--dest-path', `${remoteDirectory}/${basename(table.file)}`]);
    }
    const file = join(dir, 'sql-load.ipynb');
    writeFileSync(file, JSON.stringify(makeNotebook({ url, tables, workspace: options.workspace, lakehouse: options.lakehouse })), { mode: 0o600 });
    const notebook = jsonObject(run(['notebook', 'create', ...workspace,
      '--name', `${options.name}-${runId}`, '--file', file, '--lakehouse', options.lakehouse, '--output', 'json']));
    if (typeof notebook.id !== 'string' || !notebook.id) throw new Error('Notebook creation did not return an ID.');
    notebookId = notebook.id;
    log('SQL helper notebook created. Retain its run history and unique OneLake staging for diagnostics.');
    const result = jsonObject(run(['notebook', 'run', ...workspace, '--id', notebookId,
      '--compute-type', 'Spark', '--wait', '--timeout', '3600', '--output', 'json']));
    if (result.status !== 'Completed') throw new Error('Notebook did not report Completed status.');
    log(`SQL notebook load completed: ${tables.length} tables, ${rows} records; notebook validated exact counts.`);
    return rows;
  } catch (cause) {
    throw new Error(
      'OneLake/notebook SQL loading stopped. No retry or fallback was attempted. ' +
      (notebookId ? 'Inspect the helper notebook run before retrying: a timed-out job may still be active and SQL may be partially loaded. ' : '') +
      'Inspect staged files, SQL row counts and foreign keys; do not assume rollback.',
      { cause },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const values = new Map<string, string>();
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') dryRun = true;
    else if (['--workspace', '--lakehouse', '--id', '--directory', '--name'].includes(arg)
        && args[i + 1] && !args[i + 1].startsWith('--')) values.set(arg, args[++i]);
    else throw new Error(`Unknown option or missing value: ${arg}`);
  }
  const required = (key: string) => {
    const value = values.get(key);
    if (!value) throw new Error(`${key} is required.`);
    return value;
  };
  importSqlNotebook({
    workspace: required('--workspace'), lakehouse: required('--lakehouse'),
    database: required('--id'), directory: required('--directory'),
    name: required('--name'), dryRun,
  });
}
