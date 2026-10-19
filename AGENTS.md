# Repository instructions for coding agents

This repository publishes the LTG243 Fabric-only demo. The deployable source is
the synthetic data under `data/`, the Fabric item definitions under
`src/fabric/`, and the two root deployment entry points.

## Working rules

- Read `instructions/README.md` before running deployment commands.
- Use Node.js 24 or later and the exact Fabio version pinned in `.fabio-version`
  (0.79.0). Upgrade with `fabio upgrade --target-version 0.79.0` if needed.
- Keep `data/scenario.json` frozen. Do not hardcode values already defined by
  the scenario.
- Generated output must remain deterministic. Do not use current time or
  unseeded randomness in data generation.
- After a data or model change, run:

  ```sh
  node data/tools/generate.ts
  node data/tools/validate.ts
  node data/tools/manifest.ts
  ```

- Do not weaken a failing validator or expected-answer check.
- Do not commit `data/.staging/`, generated semantic-model definitions, build
  output, tokens, tenant/workspace/item IDs, screenshots, or command output with
  private values.

## Fabric commands

Run local validation and `--dry-run` first. Before executing a command that
changes Fabric, show the workspace and command to the user and wait for
confirmation.

LTG243 does not use `--with-cosmos`. Use `--overwrite` only for data the user
intends to replace. If a command times out, inspect the workspace before
retrying.
