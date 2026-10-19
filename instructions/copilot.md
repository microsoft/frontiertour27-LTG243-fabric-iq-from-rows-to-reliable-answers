# Deploy LTG243 with a coding agent

Use this prompt from the repository root:

```text
Prepare the LTG243 Fabric IQ demo.

1. Read README.md, instructions/README.md, and AGENTS.md.
2. Verify Node.js 24+, the exact Fabio version in .fabio-version (0.79.0),
   and Bash or PowerShell 7. For an existing Fabio installation, use
   fabio upgrade --target-version 0.79.0 if needed. For a fresh installation,
   follow section 0 in instructions/README.md and confirm Fabio is on PATH.
   Verify Azure CLI is installed for Fabio's default local-user sign-in.
3. Run node data/tools/manifest.ts --check and
   node data/tools/validate.ts.
4. Ask me for the Fabric workspace ID and its tenant ID or domain. Do not infer
   them from logs, VS Code sign-in, or Azure subscription credentials.
   Run create-data.sh or create-data.ps1 with --dry-run.
5. Show me the workspace and the tenant-specific az login
   --allow-no-subscriptions, fabio auth login, auth status, and workspace show
   commands. After I confirm, authenticate to that tenant and confirm workspace
   access. Do not use native fabio --browser login without a customer-owned
   public-client ID. Stop if workspace show fails.
6. Show me the workspace, six item names, deployment command, and subsequent
   --verify-only and --verify-only --evaluate-agent commands. Wait for my
   confirmation before running these commands.
7. After I confirm, deploy and run the verification commands.
8. Report local checks, dry-run output, deployed items, verification results,
   and Data Agent result separately. Never commit private output.
```

## Safe defaults

- Use an empty or disposable workspace.
- Do not add `--overwrite` unless you intend to replace existing demo data.
- Do not add `--with-cosmos`; LTG243 does not use it.
- Keep tokens, workspace IDs, item IDs, screenshots, generated definitions, and
  deployment output out of Git.
- If a command times out, inspect the workspace before running it again.

## Expected result

- `PASS manifest.json matches 94 files on disk.`
- `322 passed, 0 failed.`
- Six Fabric items created or resolved.
- `CaldovaAnalyst` published.
- The hero question returns the expected facts with source rows.
