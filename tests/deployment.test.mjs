import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const workspaceId = '00000000-0000-0000-0000-000000000000';
const powershell = process.env.PWSH ?? 'pwsh';
const hasPowerShell = !spawnSync(powershell, ['--version']).error;
const hasBash = !spawnSync('bash', ['--version']).error;
const hasGit = !spawnSync('git', ['--version']).error;

test('Windows Git checkout preserves every frozen payload and Bash entrypoint', {
  skip: !hasGit && 'Install Git to test Windows checkout fidelity',
}, (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'ltg243-checkout-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const manifest = JSON.parse(readFileSync(join(root, 'data/manifest.json'), 'utf8'));
  const files = [...new Set([
    '.gitattributes', 'data/scenario.json', 'data/manifest.json', 'create-data.sh',
    ...manifest.files.map(file => file.path),
  ])];
  for (const file of files) {
    const destination = join(directory, file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(root, file), destination);
  }
  const git = (args) => {
    const result = spawnSync('git', args, { cwd: directory, maxBuffer: 64 * 1024 * 1024 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr.toString());
    return result.stdout;
  };
  git(['init', '--quiet']);
  git(['-c', 'core.autocrlf=false', 'add', '--', ...files]);
  for (const file of files.filter(file => file !== '.gitattributes')) {
    const checkedOut = git(['-c', 'core.autocrlf=true', 'cat-file', '--filters', `--path=${file}`, `:${file}`]);
    assert.deepEqual(checkedOut, readFileSync(join(root, file)), `Windows checkout must preserve ${file}`);
  }
});

for (const schema of ['', 'dbo', 'custom_schema']) {
  test(`ontology bindings preserve the actual Lakehouse schema (${schema || 'schema-less'})`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'ltg243-bindings-test-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const output = join(dir, 'bindings.json');
    const result = spawnSync(process.execPath, [
      'data/tools/build-ontology.ts', '--bindings-output', output, `--lakehouse-schema=${schema}`,
    ], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const expected = JSON.parse(readFileSync(join(root, 'src/fabric/CaldovaLaunch.Ontology/bindings.json'), 'utf8'));
    expected.source.sourceSchema = schema;
    assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), expected);
  });
}

test('agent instructions use the frozen persistence horizon and configured provider', () => {
  const scenario = JSON.parse(readFileSync(join(root, 'data/scenario.json'), 'utf8'));
  const instructions = readFileSync(join(root, 'src/fabric/CaldovaLaunch.DataAgent/instructions.md'), 'utf8');
  const horizon = instructions.match(/seasonal outlook through (\d{4}-\d{2}-\d{2})/);
  assert.ok(horizon, 'Agent instructions must distinguish the seasonal outlook horizon.');
  assert.equal(horizon[1], scenario.externalSignal.persistenceThrough);
  assert.ok(instructions.includes(`Attribute weather evidence to ${scenario.weather.provider.name} and identify the retrieved source rows`));
});

test('hero few-shot distinguishes observed sales, proposed opportunity, approval and forecast coverage', () => {
  const examples = JSON.parse(readFileSync(join(root, 'src/fabric/CaldovaLaunch.DataAgent/fewshots/lakehouse.json'), 'utf8'));
  const query = examples[0].query;
  for (const column of ['forecastUnits30d', 'actualUnits30d', 'regionalOpportunityUnits',
    'totalOpportunityUnits', 'totalOpportunityRevenueUsd', 'recommendedScenarioId',
    'approved', 'commitmentExists', 'dailyForecastCoveredCampaignDays', 'campaignDurationDays',
    'forecastBriefingIssueDate', 'forecastHorizonStartsOn']) {
    assert.ok(query.includes(column), `Hero evidence query must return ${column}`);
  }
  assert.match(query, /CROSS JOIN campaign_decision_status AS c\s+WHERE c\.recommended = 1/);
  assert.match(query, /JOIN forecast_briefings AS b ON b\.issueDate = d\.observedThrough/);
  assert.match(query, /b\.forecastTargetStartDate AS forecastHorizonStartsOn/);
  assert.match(query, /DATEDIFF\(day, d\.campaignStartsOn, d\.forecastHorizonEndsOn\) \+ 1/);
});

function functions(source, names, powerShell) {
  return names.map((name) => {
    if (powerShell) {
      const match = source.match(new RegExp(`^function ${name}(?:[ (])[^]*?^}\\r?$`, 'm'));
      assert.ok(match, `Function ${name} exists`);
      return match[0];
    }
    const start = source.match(new RegExp(`^${name}\\(\\) \\{`, 'm'));
    assert.ok(start, `Function ${name} exists`);
    const bodyStart = start.index + start[0].length;
    const next = source.slice(bodyStart).search(/^[A-Za-z_][A-Za-z0-9_]*\(\) \{/m);
    return source.slice(start.index, next < 0 ? source.length : bodyStart + next);
  }).join('\n');
}

for (const engine of ['bash', 'powershell']) {
  const ps = engine === 'powershell';
  const source = readFileSync(join(root, ps ? 'create-data.ps1' : 'create-data.sh'), 'utf8');
  const helpers = functions(source, ps
    ? ['Fail', 'Format-Command', 'Write-DryRun', 'Invoke-Fabio', 'Get-FirstNonEmptyLine',
      'Ensure-QuerySafe', 'Resolve-Workspace', 'Resolve-OrCreateItem', 'Check-Prerequisites', 'Invoke-Authentication',
      'Warn', 'Resolve-ExistingOptionalItem', 'Resolve-VerificationItems', 'Invoke-Verification',
      'Verify-OntologyPeerSurface', 'Invoke-OntologySearchWhenReady', 'Verify-OntologyEntityTypes', 'Verify-SemanticModelQuery',
      'Verify-DataAgentAct1Answer', 'Invoke-DataAgentEvaluation', 'Get-DataAgentAct1Question',
      'New-DataAgentEvaluationQuestions', 'Test-DataAgentQueryBlockedByTenantSetting', 'Get-CsvRowCount',
      'Verify-LakehouseDashboardTables', 'Test-LakehouseTableExists', 'Test-Identifier', 'ConvertTo-SnakeTableName',
      'New-OntologyBindings', 'Write-NodeDryRun', 'Invoke-NodeRequiredVisible', 'Set-OntologyBindingCounts']
    : ['fail', 'info', 'quote_cmd', 'print_dry_run', 'has_single_quote', 'ensure_query_safe', 'first_nonempty_line',
      'resolve_workspace', 'resolve_or_create_item', 'check_prerequisites', 'authenticate', 'warn',
      'run_fabio_capture', 'run_fabio_optional_capture', 'strip_fabio_noise',
      'resolve_existing_optional_item', 'resolve_verification_items', 'run_verification',
      'verify_ontology_peer_surface', 'ontology_search_when_ready', 'verify_ontology_entity_types', 'verify_semantic_model_query',
      'verify_data_agent_act1_answer', 'evaluate_data_agent', 'data_agent_act1_question',
      'prepare_data_agent_evaluation_questions', 'data_agent_query_blocked_by_tenant_setting', 'csv_row_count',
      'verify_lakehouse_dashboard_tables', 'lakehouse_table_exists', 'is_identifier', 'to_snake_table_name',
      'prepare_ontology_bindings', 'run_node_required', 'print_node_dry_run', 'record_ontology_binding_counts'], ps);

  function run(t, {
    scenario = 'existing', workspace = workspaceId, verify = false, dryRun = false,
    command = 'workspace', version = 'fabio 0.79.0', sqlLoadMode, evaluate = false, skipFabricItems = false,
  } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'ltg243-deployment-test-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    copyFileSync(join(root, 'tests/fixtures/fabio.mjs'), join(dir, 'fabio'));
    chmodSync(join(dir, 'fabio'), 0o755);
    if (process.platform === 'win32') {
      copyFileSync(join(root, 'tests/fixtures/fabio.mjs'), join(dir, 'fabio.mjs'));
      writeFileSync(join(dir, 'fabio.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0fabio.mjs" %*\r\n`);
    }
    const callsFile = join(dir, 'calls.jsonl');
    const env = {
      ...process.env,
      PATH: `${dir}${delimiter}${process.env.PATH}`,
      FABIO_TEST_CALLS: callsFile,
      FABIO_TEST_SCENARIO: scenario,
      FABIO_TEST_VERSION: version,
      FABIO_TEST_WORKSPACE: workspace,
      FABIO_TEST_ROOT: root,
      FABIO_TEST_STAGING: dir,
      FABIO_CAPACITY: '',
    };
    if (command === 'verification') {
      mkdirSync(join(dir, 'fabric-sql'));
      writeFileSync(join(dir, 'fabric-sql/capacity_plan.csv'), 'id\none\ntwo\n');
    }
    if (command === 'metadata') {
      mkdirSync(join(dir, 'lakehouse/dashboard'), { recursive: true });
      writeFileSync(join(dir, 'lakehouse/dashboard/campaign-performance.csv'), 'id\none\n');
    }
    const operation = ps
      ? { workspace: 'Resolve-Workspace; Write-Host "RESULT=$Script:WorkspaceId"',
        item: "Resolve-OrCreateItem 'Lakehouse' 'DemoAnalytics' 'lakehouse'",
        authentication: 'Invoke-Authentication',
        prerequisites: 'Check-Prerequisites',
        verification: `function Verify-SqlCounts {}
function Verify-SqlShortfall {}
function Verify-KqlLineSignals {}
function Verify-LakehouseDashboardTables {}
Resolve-VerificationItems
Invoke-Verification
Write-Host "WARNINGS=$Script:FabricItemWarnings PUBLISHED=$Script:DataAgentPublished EVALUATION=$Script:DataAgentEvaluationStatus"`,
        metadata: `function Start-Sleep {}
Verify-LakehouseDashboardTables
Write-Host "FAILED=$Script:VerificationFailed"`,
        bindings: `function Get-EventhouseQueryUri { return 'https://example.invalid' }
if (-not (New-OntologyBindings)) { exit 1 }`,
        'ontology-readiness': `function Start-Sleep {}
$Script:OntologyId = '${workspaceId}'
Invoke-OntologySearchWhenReady 'Which regions are affected?'` }[command]
      : { workspace: 'resolve_workspace; printf "RESULT=%s\\n" "$WORKSPACE_ID"',
        item: 'resolve_or_create_item Lakehouse DemoAnalytics lakehouse',
        authentication: 'authenticate',
        prerequisites: 'check_prerequisites',
        verification: `verify_sql_counts() { :; }
verify_sql_shortfall() { :; }
verify_kql_line_signals() { :; }
verify_lakehouse_dashboard_tables() { :; }
resolve_verification_items
run_verification
printf 'WARNINGS=%s PUBLISHED=%s EVALUATION=%s\\n' "$FABRIC_ITEM_WARNINGS" "$DATA_AGENT_PUBLISHED" "$DATA_AGENT_EVALUATION_STATUS"`,
        metadata: `sleep() { :; }
verify_lakehouse_dashboard_tables
printf 'FAILED=%s\\n' "$VERIFICATION_FAILED"`,
        bindings: `eventhouse_query_uri() { printf 'https://example.invalid'; }
prepare_ontology_bindings`,
        'ontology-readiness': `sleep() { :; }
ONTOLOGY_ID='${workspaceId}'
ontology_search_when_ready 'Which regions are affected?'` }[command];
    const harness = ps
      ? `$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0
$Script:Workspace = $env:FABIO_TEST_WORKSPACE
$Script:WorkspaceId = '${workspaceId}'
$Script:RootDir = $env:FABIO_TEST_ROOT
$Script:Capacity = 'mock-capacity'
$Script:VerifyOnly = $${verify}
$Script:DryRun = $${dryRun}
$Script:SkipFabricItems = $${skipFabricItems}
$Script:EvaluateAgent = $${evaluate}
$Script:DataDir = Join-Path $env:FABIO_TEST_ROOT 'data'
$Script:Staging = $env:FABIO_TEST_STAGING
$Script:LakehouseId = '${workspaceId}'
$Script:EventhouseId = '${workspaceId}'
$Script:KqlDatabaseName = 'DemoSignals'
$Script:FabricItemWarnings = $false
$Script:VerificationFailed = $false
$Script:OntologyId = ''
$Script:OntologyName = 'DemoOntology'
$Script:OntologyStatus = 'skipped'
$Script:SemanticModelId = ''
$Script:SemanticModelName = 'DemoModel'
$Script:SemanticModelStatus = 'skipped'
$Script:DataAgentId = ''
$Script:DataAgentName = 'DemoAgent'
$Script:DataAgentPublished = 'no'
$Script:DataAgentEvaluationStatus = 'not requested'
${helpers}
${operation}`
      : `set -euo pipefail
WORKSPACE="$FABIO_TEST_WORKSPACE"
WORKSPACE_ID='${workspaceId}'
ROOT_DIR="$FABIO_TEST_ROOT"
CAPACITY='mock-capacity'
VERIFY_ONLY=${Number(verify)}
DRY_RUN=${Number(dryRun)}
SKIP_FABRIC_ITEMS=${Number(skipFabricItems)}
EVALUATE_AGENT=${Number(evaluate)}
DATA_DIR="$FABIO_TEST_ROOT/data"
STAGING="$FABIO_TEST_STAGING"
LAKEHOUSE_ID='${workspaceId}'
EVENTHOUSE_ID='${workspaceId}'
KQL_DATABASE_NAME=DemoSignals
FABRIC_ITEM_WARNINGS=0
VERIFICATION_FAILED=0
ONTOLOGY_ID=''
ONTOLOGY_NAME=DemoOntology
ONTOLOGY_STATUS=skipped
SEMANTIC_MODEL_ID=''
SEMANTIC_MODEL_NAME=DemoModel
SEMANTIC_MODEL_STATUS=skipped
DATA_AGENT_ID=''
DATA_AGENT_NAME=DemoAgent
DATA_AGENT_PUBLISHED=no
DATA_AGENT_EVALUATION_STATUS='not requested'
${helpers}
${operation}`;
    const args = command === 'entrypoint'
      ? [...(ps ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', join(root, 'create-data.ps1')]
        : [join(root, 'create-data.sh')]),
      '--workspace', workspace, '--dry-run', '--staging', join(dir, 'staging'),
      ...(verify ? ['--verify-only'] : []),
      ...(evaluate ? ['--evaluate-agent'] : []),
      ...(skipFabricItems ? ['--skip-fabric-items'] : []),
      ...(sqlLoadMode === undefined ? [] : ['--sql-load-mode', sqlLoadMode])]
      : ps ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', harness] : ['-c', harness];
    const result = spawnSync(ps ? powershell : 'bash', args,
      { cwd: root, env, encoding: 'utf8', timeout: command === 'entrypoint' ? 120_000 : 30_000 });
    assert.equal(result.error, undefined, result.stdout.slice(-4000) + result.stderr.slice(-4000));
    const calls = (() => {
      try {
        return readFileSync(callsFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
    })();
    const bindings = command === 'bindings' && result.status === 0
      ? JSON.parse(readFileSync(join(dir, 'fabric-items/ontology-bindings.json'), 'utf8')) : undefined;
    return { ...result, output: result.stdout + result.stderr, calls, bindings };
  }

  const skip = ps
    ? !hasPowerShell && 'Install PowerShell 7 or set PWSH to test both scripts'
    : !hasBash && 'Install Bash to test both scripts';
  test(engine, { skip }, async (t) => {
    await t.test('complete entrypoint dry run validates locally without remote calls', (t) => {
      const result = run(t, { command: 'entrypoint' });
      assert.equal(result.status, 0, result.output);
      assert.match(result.output, /322 passed, 0 failed/);
      assert.match(result.output, /PASS manifest\.json matches 94 files on disk/);
      assert.match(result.output, /Verification: dry-run commands printed/);
      assert.doesNotMatch(result.output, /workspace create/);
      assert.deepEqual(result.calls, [['--version']]);
      assert.match(result.output, /SQL load mode: cli/);
      assert.match(result.output, /lakehouse show .*--query properties.defaultSchema/);
      assert.match(result.output, /--lakehouse-schema=/);
      assert.match(result.output, /data-agent update-datasource/);
      assert.match(result.output, /imports of at most 1000 records/);
      assert.doesNotMatch(result.output, /SQL helper notebook|Upload \d+ SQL CSV files/);
      const plannedRows = [...result.output.matchAll(/SQL \w+: (\d+) records,/g)]
        .reduce((total, match) => total + Number(match[1]), 0);
      assert.ok(plannedRows > 186_859);
      assert.match(result.output, new RegExp(`SQL rows loaded: ${plannedRows}\\b`));
    });

    await t.test('complete notebook entrypoint dry run plans server-side loading without remote calls', (t) => {
      const result = run(t, { command: 'entrypoint', sqlLoadMode: 'notebook' });
      assert.equal(result.status, 0, result.output);
      assert.match(result.output, /322 passed, 0 failed/);
      assert.match(result.output, /SQL load mode: notebook/);
      assert.match(result.output, /Upload \d+ SQL CSV files/);
      assert.match(result.output, /Run notebook with --wait --timeout 3600/);
      assert.match(result.output, /Verification: dry-run commands printed/);
      assert.doesNotMatch(result.output, /imports of at most 1000 records/);
      const plannedRows = result.output.match(/Upload \d+ SQL CSV files \((\d+) records\)/)[1];
      assert.match(result.output, new RegExp(`SQL rows loaded: ${plannedRows}\\b`));
      assert.deepEqual(result.calls, [['--version']]);
    });

    await t.test('verify-only notebook mode does not plan uploads or notebook execution', (t) => {
      const result = run(t, { command: 'entrypoint', sqlLoadMode: 'notebook', verify: true, evaluate: true });
      assert.equal(result.status, 0, result.output);
      assert.doesNotMatch(result.output, /Upload \d+ SQL CSV files|Run notebook with/);
      assert.match(result.output, /item list .*--type Ontology/);
      assert.match(result.output, /item list .*--type SemanticModel/);
      assert.match(result.output, /item list .*--type DataAgent/);
      assert.match(result.output, /data-agent query/);
      assert.match(result.output, /data-agent evaluate/);
      assert.doesNotMatch(result.output, /fabio (?:ontology|semantic-model|data-agent) (?:create|publish|update-config|update-datasource|update-fewshot|refresh)\b/);
      assert.deepEqual(result.calls, [['--version']]);
    });

    await t.test('verify-only explicitly skipped Fabric items do not plan agent checks', (t) => {
      const result = run(t, { command: 'entrypoint', verify: true, evaluate: true, skipFabricItems: true });
      assert.equal(result.status, 0, result.output);
      assert.doesNotMatch(result.output, /fabio (?:ontology|semantic-model|data-agent) /);
      assert.deepEqual(result.calls, [['--version']]);
    });

    await t.test('verify-only resolves and checks existing items without writes', (t) => {
      const result = run(t, { command: 'verification', verify: true, evaluate: true });
      assert.equal(result.status, 0, result.output);
      assert.match(result.output, /WARNINGS=(?:0|False) PUBLISHED=yes EVALUATION=ran/);
      const commands = result.calls.map(args => args.slice(0, 2).join(' '));
      assert.deepEqual(commands, [
        'item list', 'item list', 'item list', 'ontology mcp-url', 'ontology search',
        'data-agent query', 'data-agent evaluate', 'ontology list-entity-types',
        'semantic-model query', 'semantic-model query', 'lakehouse query',
      ]);
    });

    for (const scenario of ['empty-name', 'null-name', 'list-error']) {
      await t.test(`verify-only ${scenario} explicitly reports missing optional checks`, (t) => {
        const result = run(t, { command: 'verification', verify: true, evaluate: true, scenario });
        assert.equal(result.status, 0, result.output);
        assert.match(result.output, /Verification could not resolve/);
        assert.match(result.output, /WARNINGS=(?:1|True) PUBLISHED=no EVALUATION=skipped/);
        assert.deepEqual(result.calls.map(args => args.slice(0, 2)), [
          ['item', 'list'], ['item', 'list'], ['item', 'list'],
        ]);
      });
    }

    for (const scenario of ['framing-error', 'framing-stale', 'framing-null', 'agent-query-error', 'evaluation-error']) {
      await t.test(`verify-only surfaces ${scenario} rather than reporting a clean pass`, (t) => {
        const result = run(t, { command: 'verification', verify: true, evaluate: true, scenario });
        assert.equal(result.status, 0, result.output);
        assert.match(result.output, /WARNINGS=(?:1|True)/);
        assert.ok(result.calls.some(args => args[0] === 'data-agent' && args[1] === 'evaluate'));
        if (scenario === 'agent-query-error') assert.match(result.output, /PUBLISHED=unverified/);
        if (scenario === 'evaluation-error') assert.match(result.output, /EVALUATION=failed/);
      });
    }

    for (const [scenario, count, failed] of [['metadata-lag', 2, false], ['metadata-never', 6, true]]) {
      await t.test(`dashboard ${scenario} retries only bounded read-only metadata checks`, (t) => {
        const result = run(t, { command: 'metadata', scenario });
        assert.equal(result.status, 0, result.output);
        assert.match(result.output, failed ? /FAILED=(?:1|True)/ : /FAILED=(?:0|False)/);
        assert.equal(result.calls.length, count);
        for (const args of result.calls) {
          assert.deepEqual(args.slice(0, 2), ['lakehouse', 'list-tables']);
          assert.ok(args.includes('--all'));
        }
      });
    }

    for (const [scenario, schema] of [['legacy-schema', ''], ['enabled-schema', 'dbo']]) {
      await t.test(`ontology ${scenario} discovers the actual schema before generating bindings`, (t) => {
        const result = run(t, { command: 'bindings', scenario });
        assert.equal(result.status, 0, result.output);
        assert.equal(result.bindings.source.sourceSchema, schema);
        assert.deepEqual(result.calls.map(args => args.slice(0, 2)), [['lakehouse', 'show']]);
        assert.ok(result.calls[0].includes('properties.defaultSchema'));
      });
    }

    await t.test('ontology schema lookup failure stops binding generation rather than defaulting to dbo', (t) => {
      const result = run(t, { command: 'bindings', scenario: 'schema-read-error' });
      assert.notEqual(result.status, 0, result.output);
      assert.match(result.output, /Could not discover the Lakehouse schema/);
      assert.deepEqual(result.calls.map(args => args.slice(0, 2)), [['lakehouse', 'show']]);
    });

    for (const [scenario, count, success] of [
      ['existing', 1, true], ['graph-lag', 2, true], ['graph-not-ready', 40, false], ['graph-failure', 1, false],
    ]) {
      await t.test(`ontology readiness ${scenario} only retries recognized not-ready errors`, (t) => {
        const result = run(t, { command: 'ontology-readiness', scenario });
        assert.equal(result.status === 0, success, result.output);
        assert.equal(result.calls.length, count);
        for (const args of result.calls) assert.deepEqual(args.slice(0, 2), ['ontology', 'search']);
        if (scenario === 'graph-not-ready') assert.match(result.output, /Graph Model is not ready/);
        if (scenario === 'graph-failure') assert.match(result.output, /HTTP 403 Forbidden/);
      });
    }

    await t.test('invalid SQL load mode stops before calling Fabio', (t) => {
      const result = run(t, { command: 'entrypoint', sqlLoadMode: 'invalid' });
      assert.notEqual(result.status, 0, result.output);
      assert.match(result.output, /--sql-load-mode must be cli or notebook/);
      assert.deepEqual(result.calls, []);
    });

    await t.test('resolves an existing ID without name lookup', (t) => {
      const result = run(t);
      assert.equal(result.status, 0, result.output);
      assert.match(result.output, new RegExp(`RESULT=${workspaceId}`));
      assert.deepEqual(result.calls.map((args) => args.slice(0, 2)), [['workspace', 'show']]);
    });

    await t.test('authentication guard accepts an existing sign-in', (t) => {
      const result = run(t, { command: 'authentication' });
      assert.equal(result.status, 0, result.output);
      assert.deepEqual(result.calls, [['auth', 'status']]);
    });

    await t.test('missing sign-in points to the tenant-specific Azure CLI flow', (t) => {
      const result = run(t, { command: 'authentication', scenario: 'unauthenticated' });
      assert.notEqual(result.status, 0, result.output);
      assert.match(result.output, /tenant-specific Azure CLI sign-in/);
      assert.match(result.output, /Native --browser login requires a customer-owned public-client ID/);
      assert.deepEqual(result.calls, [['auth', 'status']]);
    });

    await t.test('dry run does not check authentication', (t) => {
      const result = run(t, { command: 'authentication', dryRun: true });
      assert.equal(result.status, 0, result.output);
      assert.deepEqual(result.calls, []);
    });

    for (const scenario of ['forbidden', 'not-found', 'empty-id', 'null-id']) {
      await t.test(`ID lookup ${scenario} stops without creating a workspace`, (t) => {
        const result = run(t, { scenario });
        assert.notEqual(result.status, 0, result.output);
        assert.deepEqual(result.calls.map((args) => args.slice(0, 2)), [['workspace', 'show']]);
        if (scenario === 'forbidden') assert.match(result.output, /HTTP 403 Forbidden/);
        if (scenario === 'not-found') assert.match(result.output, /HTTP 404 Not Found/);
      });
    }

    await t.test('resolves a name without attempting an ID lookup', (t) => {
      const result = run(t, { workspace: 'Demo Workspace' });
      assert.equal(result.status, 0, result.output);
      assert.deepEqual(result.calls.map((args) => args.slice(0, 2)), [['workspace', 'list']]);
    });

    for (const scenario of ['empty-name', 'null-name']) {
      await t.test(`creates a missing name with ${scenario} output`, (t) => {
        const result = run(t, { workspace: 'Demo Workspace', scenario });
        assert.equal(result.status, 0, result.output);
        assert.deepEqual(result.calls.map((args) => args.slice(0, 2)),
          [['workspace', 'list'], ['workspace', 'create']]);
        assert.ok(result.calls[1].includes('--capacity-id'));
      });
    }

    for (const scenario of ['empty-name', 'list-error']) {
      await t.test(`verify-only never creates a workspace on ${scenario}`, (t) => {
        const result = run(t, { workspace: 'Demo Workspace', scenario, verify: true });
        assert.notEqual(result.status, 0, result.output);
        assert.deepEqual(result.calls.map((args) => args.slice(0, 2)), [['workspace', 'list']]);
      });
    }

    await t.test('failed name lookup does not create a workspace during deployment', (t) => {
      const result = run(t, { workspace: 'Demo Workspace', scenario: 'list-error' });
      assert.notEqual(result.status, 0, result.output);
      assert.equal(result.calls.length, 1);
      assert.match(result.output, /HTTP 403 Forbidden/);
    });

    await t.test('empty workspace creation response reports an explicit error', (t) => {
      const result = run(t, { workspace: 'Demo Workspace', scenario: 'empty-create' });
      assert.notEqual(result.status, 0, result.output);
      assert.match(result.output, /did not return a workspace id/);
    });

    for (const workspace of [workspaceId, 'Demo Workspace']) {
      for (const verify of [false, true]) {
        await t.test(`dry run for ${workspace === workspaceId ? 'ID' : 'name'}, verify=${verify}`, (t) => {
          const result = run(t, { workspace, verify, dryRun: true });
          assert.equal(result.status, 0, result.output);
          assert.deepEqual(result.calls, []);
          assert.equal(result.output.includes('workspace create'), workspace !== workspaceId && !verify);
        });
      }
    }

    await t.test('empty item lookup permits item creation', (t) => {
      const result = run(t, { command: 'item', scenario: 'empty-name' });
      assert.equal(result.status, 0, result.output);
      assert.deepEqual(result.calls.map((args) => args.slice(0, 2)), [['item', 'list'], ['lakehouse', 'create']]);
    });

    await t.test('empty item lookup in verify-only reports missing item', (t) => {
      const result = run(t, { command: 'item', scenario: 'empty-name', verify: true });
      assert.notEqual(result.status, 0, result.output);
      assert.match(result.output, /requires existing Lakehouse/);
      assert.equal(result.calls.length, 1);
    });

    await t.test('empty item creation response reports an explicit error', (t) => {
      const result = run(t, { command: 'item', scenario: 'empty-create' });
      assert.notEqual(result.status, 0, result.output);
      assert.match(result.output, /did not return an id/);
    });

    for (const [version, accepted] of [
      ['fabio 0.70.9', false], ['fabio 0.71.0', false], ['fabio 0.76.0', false],
      ['fabio 0.79.0', true], ['fabio 0.80.0', false], ['fabio 1.0.0', false],
      ['fabio 0.79.0-rc.1', false], ['fabio 0.79.0+build.1', false], ['unparseable', false],
    ]) {
      await t.test(`${accepted ? 'accepts' : 'rejects'} ${version}`, (t) => {
        const result = run(t, { command: 'prerequisites', version });
        assert.equal(result.status === 0, accepted, result.output);
        if (!accepted) assert.match(result.output, /0\.79\.0 is required by \.fabio-version/);
        assert.deepEqual(result.calls, [['--version']]);
      });
    }
  });
}
