import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const workspaceId = '00000000-0000-0000-0000-000000000000';
const powershell = process.env.PWSH ?? 'pwsh';
const hasPowerShell = !spawnSync(powershell, ['--version']).error;
const hasBash = !spawnSync('bash', ['--version']).error;

function functions(source, names, powerShell) {
  return names.map((name) => {
    const pattern = powerShell
      ? new RegExp(`^function ${name}(?:[ (])[^]*?^}`, 'm')
      : new RegExp(`^${name}\\(\\) \\{[^]*?^}`, 'm');
    const match = source.match(pattern);
    assert.ok(match, `Function ${name} exists`);
    return match[0];
  }).join('\n');
}

for (const engine of ['bash', 'powershell']) {
  const ps = engine === 'powershell';
  const source = readFileSync(join(root, ps ? 'create-data.ps1' : 'create-data.sh'), 'utf8');
  const helpers = functions(source, ps
    ? ['Fail', 'Format-Command', 'Write-DryRun', 'Invoke-Fabio', 'Get-FirstNonEmptyLine',
      'Ensure-QuerySafe', 'Resolve-Workspace', 'Resolve-OrCreateItem', 'Check-Prerequisites', 'Invoke-Authentication']
    : ['fail', 'info', 'quote_cmd', 'print_dry_run', 'has_single_quote', 'ensure_query_safe', 'first_nonempty_line',
      'resolve_workspace', 'resolve_or_create_item', 'check_prerequisites', 'authenticate'], ps);

  function run(t, {
    scenario = 'existing', workspace = workspaceId, verify = false, dryRun = false,
    command = 'workspace', version = 'fabio 0.79.0',
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
      FABIO_CAPACITY: '',
    };
    const operation = ps
      ? { workspace: 'Resolve-Workspace; Write-Host "RESULT=$Script:WorkspaceId"',
        item: "Resolve-OrCreateItem 'Lakehouse' 'DemoAnalytics' 'lakehouse'",
        authentication: 'Invoke-Authentication',
        prerequisites: 'Check-Prerequisites' }[command]
      : { workspace: 'resolve_workspace; printf "RESULT=%s\\n" "$WORKSPACE_ID"',
        item: 'resolve_or_create_item Lakehouse DemoAnalytics lakehouse',
        authentication: 'authenticate',
        prerequisites: 'check_prerequisites' }[command];
    const harness = ps
      ? `$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0
$Script:Workspace = $env:FABIO_TEST_WORKSPACE
$Script:WorkspaceId = '${workspaceId}'
$Script:RootDir = $env:FABIO_TEST_ROOT
$Script:Capacity = 'mock-capacity'
$Script:VerifyOnly = $${verify}
$Script:DryRun = $${dryRun}
${helpers}
${operation}`
      : `set -euo pipefail
WORKSPACE="$FABIO_TEST_WORKSPACE"
WORKSPACE_ID='${workspaceId}'
ROOT_DIR="$FABIO_TEST_ROOT"
CAPACITY='mock-capacity'
VERIFY_ONLY=${Number(verify)}
DRY_RUN=${Number(dryRun)}
${helpers}
${operation}`;
    const args = command === 'entrypoint'
      ? [...(ps ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', join(root, 'create-data.ps1')]
        : [join(root, 'create-data.sh')]),
      '--workspace', workspace, '--dry-run', '--staging', join(dir, 'staging')]
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
    return { ...result, output: result.stdout + result.stderr, calls };
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
