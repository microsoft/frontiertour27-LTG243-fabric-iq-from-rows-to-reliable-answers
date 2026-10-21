# LTG243 speaker checklist

Start here if you are delivering **Fabric IQ: From rows to reliable answers**.
You do not need to write code, edit CSVs, or manually author a notebook. The
setup commands create the notebook and load the synthetic demo data for you.
You do need an approved Fabric environment; a personal Power BI login alone is
not sufficient.

## 1. Get the presentation materials

- Obtain the current LTG243 slides and speaker notes from your AI/Frontier Tour
  delivery coordinator or delivery system.
- Watch the [session recording](https://aka.ms/ft27/ltg243/youtube) and compare
  it with the deck you received.
- Keep a locally available fallback approved by your delivery coordinator.
  Do not depend on streaming the recording during the talk.

**There is no slide deck or offline demo recording in this repository.** If
you have only downloaded the repository, you have not yet obtained all the
presentation materials. Ask the coordinator for the deck rather than trying
to reconstruct it from the data.

## 2. Get the environment ready with your administrator

Ask your Fabric administrator for:

- A dedicated, empty demo workspace and its workspace ID.
- The tenant ID or domain and the exact account you should sign in with.
- An active capacity that supports Fabric and Spark notebooks.
- Workspace permissions to create/load the demo items and run notebooks, SQL
  read/write access for the notebook identity, and access to the ontology and
  Data Agent features used in the talk.

Open the workspace in the browser using that account. Confirm that the account
is a workspace Member or Admin for setup. If you can open a workspace under one
account, that does not give a different account or a guest the same access.
Ask the administrator to confirm the assigned capacity is active and Fabric
item creation is enabled for your account.

Do not put workspace URLs, IDs, screenshots, credentials, or private command
output into a Git commit or public issue.

## 3. Run setup once, using OneLake upload and a notebook

Download the current repository and extract it, or use a current checkout.
Open a terminal in the extracted repository folder, not inside `data/`.
On Windows, use **PowerShell 7** (not Windows PowerShell 5).
On macOS/Linux, use **Bash** for the Bash commands.
At each step below, run only the block for your operating system, not both.

Follow [sections 0-2 of the setup guide](../instructions/README.md#0-install-the-pinned-fabio-version)
to install the tools, check the files and sign in. Fabio must be **0.79.0**, the
exact version in [`.fabio-version`](../.fabio-version).
Leave the same terminal open: the following commands use the workspace variable
you entered during sign-in.

Preview first. This checks the local files but does **not** prove the tenant
can run the demo:

**Windows / PowerShell 7**

```powershell
pwsh ./create-data.ps1 --workspace $workspaceId --sql-load-mode notebook --dry-run
```

**macOS/Linux / Bash**

```sh
./create-data.sh --workspace "$workspace_id" --sql-load-mode notebook --dry-run
```

Confirm the target with your administrator, then run the setup command
**without `--dry-run`**:

**Windows / PowerShell 7**

```powershell
pwsh ./create-data.ps1 --workspace $workspaceId --sql-load-mode notebook
```

**macOS/Linux / Bash**

```sh
./create-data.sh --workspace "$workspace_id" --sql-load-mode notebook
```

This uploads the SQL source files to OneLake and creates/runs a helper notebook
for SQL bulk loading. The remaining demo items are deployed automatically.
The helper notebook and source folder are setup artifacts, not tabs to show
during the talk. See [SQL load paths](../instructions/README.md#choose-the-sql-load-path)
for the additional permissions and failure behavior.

Leave the terminal open during provisioning and Spark startup. Some steps do
not print progress until they finish; the notebook wait allows up to 60 minutes.
Once the helper notebook appears in Fabric, you can inspect its run status
there, but do not click Run or start a second setup command while the first is
still running.

The ontology graph has a separate materialization stage. If Fabric reports
that it is not ready yet, the script prints progress and waits between checks.
Allow roughly 20 minutes plus service response time for this readiness wait;
it does not reload your data or start duplicate graph jobs.

**If any step fails, stop.** Do not keep rerunning setup, add `--overwrite`,
switch accounts/workspaces, or manually start the helper notebook again.
Some failed loads can leave partial data. Give your administrator the first
error message privately, then use the [recovery guidance](../instructions/README.md#interrupted-sql-loads-and-capacitynetwork-failures).
Do not reset or regenerate the scenario.

## 4. Prove the demo is ready

After setup completes, run both verification commands:

**Windows / PowerShell 7**

```powershell
pwsh ./create-data.ps1 --workspace $workspaceId --verify-only
pwsh ./create-data.ps1 --workspace $workspaceId --verify-only --evaluate-agent
```

**macOS/Linux / Bash**

```sh
./create-data.sh --workspace "$workspace_id" --verify-only
./create-data.sh --workspace "$workspace_id" --verify-only --evaluate-agent
```

The environment is **not ready** merely because a command exits with code 0 or
some SQL checks pass. In particular, `PASS with fabric item warnings` needs
investigation before presenting. Require all of these:

If ontology search reports that its graph is not ready, stop and ask your setup
contact to inspect the graph refresh error. Do not rerun deployment or choose
overwrite: an incorrect metadata path can cause this even when the data loaded
successfully.

| Ready check | What you should see |
| --- | --- |
| Setup | Completed load and foreign-key revalidation; no unresolved errors or warnings |
| Verification | Both commands finish successfully; SQL, KQL and Lakehouse checks pass |
| Fabric items | `CaldovaAnalytics`, `CaldovaSignals` (including its KQL database), `CaldovaOperations`, `CaldovaBusinessMeaning`, `CaldovaLaunchModel`, and `CaldovaAnalyst` are present |
| Meaning and measures | The presenter can open the ontology and semantic model and inspect their definitions |
| Agent | `CaldovaAnalyst` is published; evaluation actually runs rather than being skipped |
| Sources | The presenter can open the retained source rows behind an answer |
| Presentation | Current slides and notes obtained; live walkthrough rehearsed in the presenter account |

Then open the published `CaldovaAnalyst` and ask:

```text
What's driving the increase in Hydration Sunscreen sales, and is it likely to continue?
```

The answer is generated and will vary. Check that it is grounded in retained
sources, including the synthetic El Nino signal, the affected/control regions,
the persistence outlook, and the distinction between a forecast and approval.
Use the [expected-facts checklist](../instructions/README.md#6-run-the-lightning-talk-question);
do not memorize generated prose or substitute expected facts for a live result.

## 5. Rehearse the 15-minute talk

Use the deck's speaker notes as the timing guide. The repository supports this
[LTG243 sequence](../docs/session-order.md):

1. Explain the Hydration Sunscreen business question and inspect the synthetic
   rows/governed measures.
2. Open the Fabric IQ ontology and show how it supplies business meaning.
3. Ask the hero question in `CaldovaAnalyst`.
4. Open its retained source rows and explain why they support the answer.
5. Distinguish a recommendation from an approved action and explain the limits
   of the forecast.

The fixture includes later campaign/action/memory examples, but these are not
additional required stages of this 15-minute talk. Preserve the default
open-decision scenario.

## 6. Before the session

- Repeat the two verification commands in section 4 while there is still time
  for administrator support. Do not redeploy just before going on stage.
- Confirm capacity is active and open the data, ontology, model and agent tabs
  using the account you will use during the session.
- Ask the hero question once and inspect its source rows.
- Have the slides and approved fallback available locally.

## If the live service is unavailable

Use the slides and approved recording/fallback from your delivery coordinator.
You can also show the authored
[`questions.json`](../data/evaluation/questions.json) and
[`expected-results.json`](../data/evaluation/expected-results.json) to explain
what the demo is designed to establish.
Say explicitly that this is an **expected result or recording**, not a live
tenant response. Do not present a partial environment as ready.
