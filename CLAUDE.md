# Agent Bus Local

Read `AGENTS.md` before making changes. This is the Local-only repository.
Use the Local CLI/MCP and isolate all tests with a temporary `AGENT_BUS_DIR`.
Do not import other repository history or hosted application code here.

Run `npm run typecheck`, `npm test`, `npx tsx test/cross-process.ts`,
`npm run test:setup`, `npm run test:wake`, `npm run test:wake:local`,
`npm run test:delivery`, and `npm run check:publication` before release.
