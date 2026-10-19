# Deploy and run the LTG243 demo

This guide deploys the synthetic Caldova Fabric environment used by LTG243. Use
an empty or disposable workspace and start with the dry run.

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
./create-data.sh --workspace "$workspace_id" --dry-run
```

PowerShell:

```powershell
pwsh ./create-data.ps1 --workspace $workspaceId --dry-run
```

The dry run validates the files and prints the Fabio commands without changing
Fabric. Check the workspace and item names before continuing. It does not
authenticate or prove workspace access; you can also run it before signing in.

## 4. Deploy

Bash:

```sh
./create-data.sh --workspace "$workspace_id"
```

PowerShell:

```powershell
pwsh ./create-data.ps1 --workspace $workspaceId
```

The scripts load dependencies in order and then verify the Fabric estate. The
default names are:

- `CaldovaAnalytics`
- `CaldovaSignals`
- `CaldovaOperations`
- `CaldovaBusinessMeaning`
- `CaldovaLaunchModel`
- `CaldovaAnalyst`

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
published data agent. The summary includes workspace and item IDs, so do not
commit it.

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
- `SCN-2026-HS-B` as recommended but not approved;
- the difference between the 30-day forecast horizon and the longer campaign
  and seasonal outlook.

The wording may vary. Check the facts and cited sources.

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

| Symptom | Check |
| --- | --- |
| Workspace lookup failed | Read the original Fabio error. Confirm the Fabio account, signed-in tenant, immutable workspace ID, and workspace role. Do not substitute a subscription, tenant, capacity, or item ID. |
| Interactive login requires a customer-owned public-client ID | Use the Azure CLI sign-in sequence in section 2. Do not use native `--browser`/`--device-code`/`--wam` without your organization's configured public-client ID. |
| Permission denied | Confirm that your workspace role can create and load the required Fabric items. |
| Existing rows protected | Use a new workspace or prefix; use `--overwrite` only for disposable data. |
| Agent answer is incomplete | Run `--evaluate-agent`, inspect selected sources, and compare with expected facts. |
| Generated answer differs in wording | Validate facts and sources; Data Agent output is non-deterministic. |

## Offline script regression tests

Run `node --test tests/deployment.test.mjs` from the repository root, or `npm test`
from `data/` to include the manifest and scenario checks. The script tests use a
mock Fabio executable and never authenticate or contact Fabric. Install
PowerShell 7 (or set `PWSH` to its executable path) and Bash to exercise both
scripts; a suite is explicitly skipped if its shell is unavailable.

When upgrading Fabio, update `.fabio-version`, the pinned-version regression
tests, and the setup guidance together, then rerun the offline checks and dry
run before testing against Fabric.
