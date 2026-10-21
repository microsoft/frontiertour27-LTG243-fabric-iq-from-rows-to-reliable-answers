# Deploy LTG243 with a coding agent

Use this prompt from the repository root:

```text
Prepare the LTG243 Fabric IQ demo.

1. Read README.md, instructions/README.md, AGENTS.md, and
   delivery-resources/README.md. Confirm I have the current slides and speaker
   notes from the tour coordinator; they are not included in this repository.
2. Verify Node.js 24+, the exact Fabio version in .fabio-version (0.79.0),
   and Bash or PowerShell 7. For an existing Fabio installation, use
   fabio upgrade --target-version 0.79.0 if needed. For a fresh installation,
   follow section 0 in instructions/README.md and confirm Fabio is on PATH.
   Verify Azure CLI is installed for Fabio's default local-user sign-in.
3. Run node data/tools/manifest.ts --check and
   node data/tools/validate.ts.
4. Ask me for the Fabric workspace ID, its tenant ID or domain, and the exact
   account I should use. Do not infer them from logs, VS Code sign-in, or Azure
   subscription credentials. Use the OneLake upload + notebook path for this
   speaker setup: run create-data.sh or create-data.ps1 with
   --sql-load-mode notebook --dry-run.
5. Show me the workspace and the tenant-specific az login
   --allow-no-subscriptions, fabio auth login, auth status, and workspace show
   commands. After I confirm, authenticate to that tenant and confirm workspace
   access. Check the active account and tenant as well as workspace access;
   stop on an identity mismatch. Do not use native fabio --browser login
   without a customer-owned public-client ID. Stop if workspace show fails.
6. Show me the workspace, six item names, deployment command, and subsequent
   --verify-only and --verify-only --evaluate-agent commands. Wait for my
   confirmation before running these commands. Include --sql-load-mode
   notebook in the deployment command and explain that it creates an
   additional helper notebook and OneLake staging folder.
7. After I confirm, deploy and run the verification commands.
8. Check every readiness criterion in delivery-resources/README.md. Open the
   published agent, ask the hero question, and inspect the retained sources
   against the expected facts. If browser access requires my help, tell me
   precisely which manual checks remain; do not claim they passed.
9. Report local checks, dry-run output, deployed items, verification results,
   and Data Agent result separately. Never commit private output.
```

## Safe defaults

- Use an empty or disposable workspace.
- Do not add `--overwrite` unless you intend to replace existing demo data.
- Do not add `--with-cosmos`; LTG243 does not use it.
- Keep tokens, workspace IDs, item IDs, screenshots, generated definitions, and
  deployment output out of Git.
- If a command times out, inspect the workspace before running it again.
- Do not replay a notebook or switch SQL load modes to recover a partial
  import. Inspect job and row state before proposing recovery.
- A successful exit code, skipped evaluation, or "PASS with fabric item
  warnings" is not evidence that the talk is ready. Resolve warnings and
  verify the presenter can open the actual demo surfaces.

## Expected result

- `PASS manifest.json matches 94 files on disk.`
- `322 passed, 0 failed.`
- Six demo surfaces created or resolved, including the Eventhouse's KQL
  database, plus a completed helper notebook for the SQL load.
- `CaldovaAnalyst` published.
- The hero question returns the expected facts with source rows.
