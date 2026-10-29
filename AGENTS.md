# Agent Bus Local

This repository is the open-source Local distribution. Keep domain behavior in
`src/bus.ts`, SQLite migrations in `src/db.ts`, and MCP/CLI adapters thin.
Preserve existing Local messaging, task, and listener behavior. Agent identities
are globally unique; project, area, and team are filters rather than identities.

All tests must use temporary `AGENT_BUS_DIR` storage. Never mutate the user's
real bus or client settings from tests. Keep migrations idempotent, SQL
parameterized, and TypeScript strict. Preserve unrelated working-tree changes.

Before release run typecheck, smoke, cross-process, setup, delivery, and wake
tests. Run `npm run check:publication` after building. It checks the current Git
index, working files, and npm archive for forbidden material. Enable the tracked pre-push hook
with `git config core.hooksPath .githooks`. npm prepublish runs the same gate.
`scripts/local-ci.yml` is an inactive Actions template; enabling it requires a
GitHub credential with workflow permission. Do not claim CI is active until then.

Only Local is approved for publication. Do not add hosted application source,
assets, deployment configuration, or internal docs. Preserve this repository's
identity, visibility, and history. Never rewrite history or force-push to perform
a product separation. Any change to this boundary requires explicit
owner authorization. Preserve MIT notices and contributor attribution.

Update README, docs, llms.txt, and the canonical `skills/agent-bus` when public
interfaces change. Sync the companion plugin repository from this checkout.
Do not publish npm or deploy without explicit authorization.
