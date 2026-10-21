# Deploy and run the LTG243 demo

This guide deploys the synthetic Caldova Fabric environment used by LTG243. Use
an empty or disposable workspace and start with the dry run.

For speakers who want a single OneLake/notebook setup route, follow the
[speaker checklist](../delivery-resources/README.md). It includes the slides
handoff and a clear readiness checklist; the detailed technical reference
below supports both SQL load modes.

## What this deploys

Everything runs in Microsoft Fabric. The script creates a Lakehouse,
Eventhouse/KQL database, Fabric SQL Database, Fabric IQ ontology, Direct Lake
semantic model, and Fabric data agent in the selected workspace. No separate
Azure application or Azure SQL server is required.

## Prerequisites

- Node.js 24 or later.
- [Fabio CLI](https://github.com/iemejia/fabio) **0.79.0**, pinned in
  [`.fabio-version`](../.fabio-version). Both scripts reject other versions.
  Upgrade an existing installation with `fabio upgrade --target-version 0.79.0`,
  or install the matching binary from the
  [v0.79.0 release](https://github.com/iemejia/fabio/releases/tag/v0.79.0).
- Bash on macOS/Linux, or PowerShell 7 or later on Windows.
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) for the
  default local sign-in. This does not require an Azure subscription. Fabio
  0.79.0 delegates local-user authentication to Azure CLI by default.
- Access to a Microsoft Fabric tenant with capacity and an empty or disposable
  workspace.
- Permission to create, read, update, publish, and load:
  - Lakehouse;
  - Eventhouse and KQL database;
  - Fabric SQL Database;
  - Fabric IQ ontology;
  - Direct Lake semantic model;
  - Fabric data agent.

No credentials, tenant IDs, workspace IDs, or item IDs are stored in the
repository.

## 0. Install the pinned Fabio version

Open a terminal in the cloned repository root. Install
[Node.js 24 or later](https://nodejs.org/en/download) and, on Windows,
[PowerShell 7](https://learn.microsoft.com/powershell/scripting/install/installing-powershell-on-windows)
first. No `npm install`, Azure CLI login, or VS Code sign-in is required to run
the local checks.

If Fabio is already on `PATH`, run:

```sh
fabio upgrade --target-version 0.79.0
fabio --version
```

For a fresh installation, use the upstream installer below. It installs the
latest release, so the explicit upgrade command then selects this repository's
exact pin even if a newer release has been published.

### macOS (Apple Silicon) or Linux

```sh
curl -fsSL https://raw.githubusercontent.com/iemejia/fabio/v0.79.0/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"
fabio upgrade --target-version 0.79.0
fabio --version
```

Keep `$HOME/.local/bin` on `PATH` in your shell profile for future terminals.
The upstream installer supports Linux x64/ARM64 and macOS ARM64. Intel macOS
users must follow Fabio's [source-build instructions](https://github.com/iemejia/fabio/tree/v0.79.0);
there is no published macOS x64 binary for this release.

### Windows (PowerShell 7)

```powershell
$installer = Join-Path ([System.IO.Path]::GetTempPath()) "fabio-install-$([guid]::NewGuid()).ps1"
Invoke-WebRequest https://raw.githubusercontent.com/iemejia/fabio/v0.79.0/install.ps1 -OutFile $installer
& $installer
Remove-Item -LiteralPath $installer
$env:PATH = "$(Join-Path $env:LOCALAPPDATA 'fabio');$env:PATH"
fabio upgrade --target-version 0.79.0
fabio --version
```

The Windows installer also adds Fabio to your user `PATH` for future terminals.
If your organization's policy blocks installer scripts, download the matching
Windows x64 or ARM64 ZIP from the
[pinned release](https://github.com/iemejia/fabio/releases/tag/v0.79.0), extract it
to a user-owned directory, and add that directory to `PATH`.

`fabio --version` must print `fabio 0.79.0`. If it does not, check for an older
Fabio earlier on `PATH` (`command -v fabio` in Bash, `Get-Command fabio` in
PowerShell).

## 1. Validate locally

From the repository root:

```sh
node --version
fabio --version
az version
node data/tools/manifest.ts --check
node data/tools/validate.ts
```

Expected local results:

- `fabio 0.79.0` from `fabio --version`.
- `PASS manifest.json matches 94 files on disk.`
- `322 passed, 0 failed.`

The validator checks the scenario, relationships, Fabric definitions, expected
answers, and manifest.

The repository's checkout rules preserve fixture bytes on Windows as well as
macOS/Linux. If an older Windows checkout reports changed manifest hashes
after Git converted line endings, download a fresh copy of the current
repository ZIP. Do not regenerate the scenario or rewrite the manifest merely
to bypass an integrity failure.

## 2. Authenticate and select a workspace

Copy the workspace ID from the workspace's settings in the Fabric portal.
Use the tenant that owns that workspace, including when signing in as a guest
in another organization. Keep the following values and output local.

Bash:

```sh
read -r -p "Fabric workspace ID: " workspace_id
read -r -p "Fabric tenant ID or domain: " fabric_tenant
az login --tenant "$fabric_tenant" --allow-no-subscriptions
fabio auth login --tenant "$fabric_tenant"
fabio auth status
fabio workspace show --id "$workspace_id" -o table
```

PowerShell:

```powershell
$workspaceId = Read-Host "Fabric workspace ID"
$fabricTenant = Read-Host "Fabric tenant ID or domain"
az login --tenant $fabricTenant --allow-no-subscriptions
fabio auth login --tenant $fabricTenant
fabio auth status
fabio workspace show --id $workspaceId -o table
```

Use the workspace ID when possible and confirm that it is the workspace you
intend to use for the demo. Stop here if the lookup fails; do not run deployment
to diagnose workspace access. Retain these variables in the same terminal for
the following commands.

Azure CLI owns the interactive sign-in, MFA, and token refresh. Fabio validates
and uses that session. The `--allow-no-subscriptions` flag supports Fabric-only
tenants. Select the intended tenant and account during sign-in; do not assume
that existing Azure CLI, VS Code, or Fabric portal sessions use that identity.

Do not replace this sequence with `fabio auth login --browser` alone: in
Fabio 0.79.0, native browser/device-code/WAM login requires your organization's
own public-client app registration, supplied with `--client-id` or
`FABIO_CLIENT_ID`. That is an alternative, administrator-configured path, not a
prerequisite for the Azure CLI flow. See
[Fabio's authentication guide](https://github.com/iemejia/fabio/blob/v0.79.0/docs/src/content/docs/guides/authentication.md).

Workspace IDs are looked up directly. If that lookup fails, setup stops and
preserves the Fabio error; it does not treat the ID as a name or create another
workspace. Confirm the account and tenant used by Fabio, not just the account
used in VS Code or Azure. Azure subscription access alone does not grant access
to a Fabric workspace.

If you supply a display name instead, setup looks for that name and creates a
workspace only if the lookup succeeds without a match. `--capacity` (or
`FABIO_CAPACITY`) selects capacity for that new workspace. `--verify-only` never
creates a missing workspace.

## 3. Preview the deployment

Bash:

```sh
./create-data.sh --workspace "$workspace_id" --sql-load-mode notebook --dry-run
```

PowerShell:

```powershell
pwsh ./create-data.ps1 --workspace $workspaceId --sql-load-mode notebook --dry-run
```

The dry run validates the files and prints the Fabio commands without changing
Fabric. Check the workspace and item names before continuing. It does not
authenticate or prove workspace access; you can also run it before signing in.

## 4. Deploy

Bash:

```sh
./create-data.sh --workspace "$workspace_id" --sql-load-mode notebook
```

PowerShell:

```powershell
pwsh ./create-data.ps1 --workspace $workspaceId --sql-load-mode notebook
```

The scripts load dependencies in order and then verify the Fabric estate. The
default names are:

- `CaldovaAnalytics`
- `CaldovaSignals`
- `CaldovaOperations`
- `CaldovaBusinessMeaning`
- `CaldovaLaunchModel`
- `CaldovaAnalyst`

### Choose the SQL load path

**Option 1 (recommended for speakers): `--sql-load-mode notebook`.**
Stage the relational CSVs in OneLake and run SQL bulk loading inside Fabric.
The preview and deployment commands above explicitly select this path.

Start with a dry run:

```sh
./create-data.sh --workspace "$workspace_id" --sql-load-mode notebook --dry-run
```

```powershell
pwsh ./create-data.ps1 --workspace $workspaceId --sql-load-mode notebook --dry-run
```

After reviewing the target and plan, explicitly approve and run deployment:

```sh
./create-data.sh --workspace "$workspace_id" --sql-load-mode notebook
```

```powershell
pwsh ./create-data.ps1 --workspace $workspaceId --sql-load-mode notebook
```

Both modes use the same authored SQL schema/views, existing-data protection,
explicit overwrite handling, final foreign-key revalidation, and downstream
Eventhouse, Lakehouse, ontology, semantic-model, and agent deployment.
`--verify-only` does not upload SQL files or create/run notebooks in either mode.
Do not change modes as an automatic recovery from a partial load.

Notebook mode additionally requires:

- Active Fabric capacity that supports Spark notebook execution.
- Permission to upload files to the Lakehouse and create/run a helper notebook.
- A Fabric runtime with the
  [Spark connector for SQL databases](https://learn.microsoft.com/en-us/fabric/data-engineering/spark-sql-connector).
- The notebook's execution identity must have SQL read/write permissions and
  the permissions required by the connector's `NO_DUPLICATES` reliability mode.
  Interactive CLI access alone does not prove notebook identity permissions.

This mode:

1. Applies the existing SQL scripts, disables foreign keys and, only with
   authorized `--overwrite`, clears the existing target rows.
2. Uploads the expanded SQL CSVs under a unique
   `Files/ltg243/sql-import/<run>/` folder in the analytics Lakehouse. These are
   source files, not new Delta tables.
3. Creates a helper notebook named `<prefix>SqlLoad-<run>` in the workspace,
   bound to that Lakehouse. This is an **additional deployment helper**, not a
   seventh demo grounding source.
4. Runs Spark with `--wait --timeout 3600`. The notebook uses its Fabric Entra
   identity; no passwords or tokens are embedded in its generated definition.
5. Checks every source checksum, exact CSV row count, header/SQL schema
   compatibility and empty target before the first write. It takes NOT NULL
   metadata from the SQL catalog rather than the connector's read schema, and
   casts strings to existing SQL types (including bits, dates and decimals).
   The JDBC URL selects native temporal bulk encoding for the authored
   `datetime2` columns.
   It preserves that exact schema for strict bulk-copy validation, bulk-appends
   with `NO_DUPLICATES` and verifies exact SQL counts for every table.
6. Continues only after a `Completed` job result; the scripts then revalidate
   foreign keys and proceed to the remaining deployment stages.

The staging files and helper notebook/run history are retained in Fabric for
diagnostics. They contain synthetic data and private deployment metadata, so
keep them within the workspace and do not commit/export the generated notebook
definition to Git. Local generated notebook files are removed automatically.
After a successful rehearsal, remove old helper notebooks and staging run
folders through separately authorized cleanup if desired.

If upload, notebook startup, execution, count validation or waiting fails,
deployment stops without retry or fallback. A timeout does **not** prove that
the notebook stopped: inspect its run status before any further write.
Failed/partial writes may leave foreign keys disabled. Preserve diagnostics,
inspect SQL rows and choose recovery explicitly; neither path resumes a
partially loaded table.

**Option 2: `--sql-load-mode cli`.** Use bounded client-side SQL imports
instead of a helper notebook. Replace `--sql-load-mode notebook` with
`--sql-load-mode cli` in both the dry-run and deployment commands above.
For backward compatibility, omitting the option still selects `cli`; it does
not select the recommended notebook path automatically.

Use `--prefix <value>` for another presenter in the same workspace. Use
`--overwrite` only when you intend to replace data in a disposable workspace.

LTG243 does not need `--with-cosmos`. That option belongs to a broader shared
fixture and is intentionally outside the lightning-talk path.

## 5. Verify the deployed estate

Bash:

```sh
./create-data.sh --workspace "$workspace_id" --verify-only
./create-data.sh --workspace "$workspace_id" --verify-only --evaluate-agent
```

PowerShell:

```powershell
pwsh ./create-data.ps1 --workspace $workspaceId --verify-only
pwsh ./create-data.ps1 --workspace $workspaceId --verify-only --evaluate-agent
```

Verification checks SQL, KQL, Lakehouse, ontology, semantic model, and the
published data agent. It resolves the existing items without creating,
rebinding, refreshing, or publishing them. `--evaluate-agent` also runs the
authored question set against the existing published agent; it is not skipped
merely because this is a verification-only run. `--skip-fabric-items` explicitly
excludes the ontology, model, and agent checks.

Lakehouse table discovery can briefly lag behind a completed load. Dashboard
verification checks all inventory pages and retries a missing table up to six
times, five seconds apart. These are read-only checks, not data-load retries.
A table still missing afterward is a failed check. The model and Lakehouse
`capacity_plan` counts must both match the staged fixture, not merely each other.

Ontology search can also lag while Fabric materializes its derived graph.
Verification retries only the explicit `Graph Model is not ready` response,
up to 40 read-only checks 30 seconds apart. Other errors are reported
immediately. No binding changes, source reloads, or duplicate graph refreshes
are performed by this wait.

Resolve every warning before presenting, including ontology graph-not-ready
warnings. A successful smoke query or completed evaluation is not a substitute
for checking the hero answer and its source rows below. The summary includes
workspace and item IDs, so do not commit it.

Fabio's evaluation `failedRuns` counts execution failures. Its `match` fields
are simple case/whitespace-insensitive string comparisons, not semantic grades.
Neither zero execution failures nor a literal-match result establishes factual
correctness. Review the actual answers against the expected facts and source rows.

## 6. Run the lightning-talk question

Open the published `CaldovaAnalyst` Fabric data agent and ask:

```text
What's driving the increase in Hydration Sunscreen sales, and is it likely to continue?
```

Inspect both the answer and its retained source rows. A grounded answer should
identify:

- the external signal `SIG-ENSO-2026-07`;
- four affected regions and two control regions;
- the 100,000-unit, $800,000 targeted opportunity;
- a 0.78 persistence probability;
- the synthetic Meridian Climate Services provenance and seasonal persistence
  through 2026-11-26;
- `SCN-2026-HS-B` as recommended but not approved;
- the difference between the 30-day forecast horizon and the longer campaign
  and seasonal outlook.

The wording may vary. Check the facts and cited sources.

Keep observed sales variance separate from the proposed campaign opportunity.
The hero evidence query returns both, together with the recommended scenario's
approval status. If discussing coverage, the daily forecast covers 17 of the
47 campaign days, not half or the full campaign.

The authored prompts and expected facts are in:

- [`data/evaluation/questions.json`](../data/evaluation/questions.json)
- [`data/evaluation/expected-results.json`](../data/evaluation/expected-results.json)
- [`src/fabric/CaldovaLaunch.DataAgent/`](../src/fabric/CaldovaLaunch.DataAgent/)

## Rehearsal and reset

- Rehearse in the same workspace only after `--verify-only` passes.
- Prefer a new workspace or prefix for another presenter.
- Do not regenerate the optional outcome slice before the talk; the default
  scenario deliberately leaves the decision open.
- Keep `data/scenario.json` unchanged.
- Keep `data/.staging/`, generated Fabric IDs, tokens, screenshots, and
  deployment output out of Git.

## Use GitHub Copilot

Follow the [Copilot deployment runbook](copilot.md). The agent runs the local
checks and dry run, then shows you the workspace and deployment command before
continuing.

## Troubleshooting

### Interrupted SQL loads and capacity/network failures

The Bash and PowerShell loaders use the same
[`import-sql.ts`](../data/tools/import-sql.ts) helper. Each Fabio import contains
at most 1,000 CSV data records, preserving quoted multiline fields and record
order. The helper requires an empty target table and checks the exact cumulative
row count after every chunk. The 186,859-record sales table uses 187 chunks.
The temporary chunks are removed on success or failure.

These are **not atomic table loads**. A failed import can commit some records
before returning an error. Neither a failed import nor a failed row-count check
is automatically retried. The helper stops with the affected table and record
range; inspect actual table contents before deciding how to recover. It does
not resume a partial table or infer that a failed operation changed nothing.

Numbered SQL schema/view scripts run **before** foreign-key disabling,
overwrite clearing, and CSV imports. If a script batch fails, earlier batches
may already have committed, but this attempt has not reached SQL row clearing
or CSV loading. A later failure during clearing or loading can leave partial
data and disabled foreign keys. Only a fully successful SQL load reaches
foreign-key revalidation.

For `CAPACITY_INACTIVE` / `CapacityNotActive`, ask the capacity administrator to
confirm the workspace's assigned capacity is active. For `NETWORK_ERROR`,
connection resets, or timeouts during SQL query, script, or import calls:

1. Stop deployment and retain diagnostics privately. Do not automatically
   replay a failed import chunk or a script batch.
2. With approval for authenticated checks, inspect current item inventory,
   capacity state, SQL schema/row counts, and constraint status. A successful
   workspace lookup or local dry run does not establish capacity or SQL health.
3. Correlate the first failing operation and service diagnostics with the
   capacity/Fabric administrator. Smaller chunks reduce individual import
   duration but do not establish or repair the underlying network/service cause.
4. Before a new full deployment, separately authorize a small disposable SQL
   connectivity/import test and verify its result. Do not use the demo tables
   as a connectivity probe.
5. Choose a fresh workspace/prefix, or explicitly approve replacement with
   `--overwrite`. Replacement reloads data; it is not a safe resume operation.
   Never choose overwrite automatically because a prior attempt failed.
6. After deployment finishes, require foreign-key revalidation and both
   verification modes to pass. Missing `LineSignals` means the KQL stage is
   incomplete; successful checks on a few SQL tables do not make the demo ready.
   Do not claim a Data Agent result if deployment/evaluation was never reached.

The `--dry-run` output includes bounded-import plans without SQL calls.
Run concurrent previews with distinct `--staging` directories: payload expansion
cleans its staging directory, so sharing one between processes can race.

Notebook mode removes the laptop-to-SQL path from the bulk import loop, but the
schema/view scripts still use Fabio SQL queries. It does not eliminate inactive
capacity, notebook/service failures, or all connectivity problems. It is not an
atomic database load. Validate the new path in a disposable workspace before
depending on it for the talk.

| Symptom | Check |
| --- | --- |
| Workspace lookup failed | Read the original Fabio error. Confirm the Fabio account, signed-in tenant, immutable workspace ID, and workspace role. Do not substitute a subscription, tenant, capacity, or item ID. |
| Interactive login requires a customer-owned public-client ID | Use the Azure CLI sign-in sequence in section 2. Do not use native `--browser`/`--device-code`/`--wam` without your organization's configured public-client ID. |
| Permission denied | Confirm that your workspace role can create and load the required Fabric items. |
| Existing rows protected | Use a new workspace or prefix; use `--overwrite` only for disposable data. |
| Ontology graph says `PathNotFound` for a `Tables/dbo/...` path | Compare the managed table's actual OneLake location with the ontology binding. A schema-less Lakehouse uses `Tables/<table>`, not `Tables/dbo/<table>`. The scripts discover `properties.defaultSchema` before generating bindings; do not reload populated source data to repair a metadata path. Previously deployed bindings require a separately approved metadata repair and derived-graph refresh. |
| Ontology search says the graph model is not ready | Inspect the child graph's refresh history. A failed refresh needs its actual error resolved; waiting alone does not repair a missing source path. Keep the demo marked not ready until the refresh and search succeed. |
| Agent answer is incomplete | Run `--evaluate-agent`, inspect selected sources, and compare with expected facts. |
| Generated answer differs in wording | Validate facts and sources; Data Agent output is non-deterministic. |

## Offline script regression tests

Run `npm --prefix data test` from the repository root to include manifest,
scenario, both deployment paths, bounded-import, and notebook regression tests.
The script tests use a mock Fabio executable and never authenticate or contact Fabric. Install
PowerShell 7 (or set `PWSH` to its executable path) and Bash to exercise both
scripts; a suite is explicitly skipped if its shell is unavailable.
Install Python 3 (or set `PYTHON` to its executable path) to run the notebook
control-flow tests; they use mocked Spark/SQL operations and do not require local
PySpark. They do not substitute for a live Fabric/Spark acceptance test.

When upgrading Fabio, update `.fabio-version`, the pinned-version regression
tests, and the setup guidance together, then rerun the offline checks and dry
run before testing against Fabric.
