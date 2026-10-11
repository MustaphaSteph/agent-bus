# Local and Cloud behavior parity

Local is the reference for Agent Bus workflow semantics. Matching tool names
alone does not prove matching behavior. Cloud changes the connection, workspace
authentication, and storage location; it should not silently change task rules.
Local and Cloud stores remain separate and are not automatically synchronized.

## Verified workflow coverage

`src/core/workflow.ts` shares the task transition table and final-report
calculation between Local and Cloud. `apps/cloud/test/workflow-parity.ts`
compares isolated Local and Cloud outcomes, including:

- All 64 pairs of task states, including backlog and terminal states.
- Task ownership, competing claims, release timestamps, and task progress.
- Required independent reviews, changes requested, approval, and completion.
- Final-report safety and test evidence, including failed tests and backlog.
- Scoped audit events, pinned memory selection, and inbox delivery metadata.

The Worker smoke test also exercises review verdict persistence, completion
gating, and terminal-state rejection through the remote MCP endpoint.

Run from `apps/cloud`:

```sh
npm run check
```

Tests use isolated databases and local Workers, not a production workspace.
Passing source tests does not mean those changes have been deployed.

## Cloud adapter details

Task updates and releases require the acting `agent`. The actor must be the
requester or current holder. Use `submit_review` for approval rather than
writing review fields through `update_task`. Cloud accepts either
`approved: true/false` or `review_state: "approved"/"changes_requested"`;
conflicting verdicts are rejected. Review changes produce task audit events.
Restart connected agent sessions after deploying MCP schema changes.

Cloud retains its existing response envelopes, including the `report` alias
alongside `final_report` in review gates. Risk memories remain context rather
than automatic blockers, consistent with Local's existing report policy.

## Remaining coverage

This is verified workflow coverage, not a claim of complete behavioral parity
across every tool. Further differential tests and alignment are needed for
routing and ask timing, edit-scope conflict enforcement, pending assignment
and handoff, deletion and reassignment, pagination, advanced memory filters,
and complete brief/board response shapes. Local process hooks cannot run on a
remote server; a client-side listener is still needed where the host requires
one. Connecting Cloud does not start an agent session or keep it running.
