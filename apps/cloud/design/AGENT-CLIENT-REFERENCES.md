# Agent Client References

Research date: 2026-10-08.

Purpose: resolve the user's phrase `harness openclaw muse dot` and identify
recognizable session-window references for the Agent Bus Cloud hero.
These are visual research notes, not a compatibility matrix or endorsement.
Confidence below concerns the intended identity, not whether the product exists.

## Evidence and Limits

Official product pages, documentation, published screenshots, and a vendor's
interactive marketing demonstration were inspected. No client was installed,
no authenticated working session was exercised, and no Agent Bus Cloud
integration was tested. Published imagery can be staged, stylized, or older
than the current release; observations apply to the specific references linked
below. Exact colors, layout, and availability should not be generalized to all
versions or themes.

## OpenClaw

**Identity: high confidence.** OpenClaw, the open-source personal assistant at
[openclaw.ai](https://openclaw.ai/), with the official
[openclaw/openclaw repository](https://github.com/openclaw/openclaw).

### Observed UI

The official August 30, 2026
[OpenClaw 2.0 announcement](https://openclaw.ai/blog/openclaw-2-accidentally)
contains a browser-app screenshot that was visually inspected:

- Black page with a centered circular agent avatar and the name `Claw Patrol`.
- Agent, `Local`, and workspace selectors immediately above the composer.
- A wide dark composer with attachment, permission, model, effort, microphone,
  and red circular send controls.
- The shown state is a new conversation, not evidence of a completed task or
  successful connection to Agent Bus.

[Direct browser-app screenshot](https://openclaw.ai/blog/openclaw-2-accidentally/browser-app.jpg).

The same article links a
[multiplayer dashboard screenshot](https://openclaw.ai/blog/openclaw-2-accidentally/multiplayer-dashboard.jpg).
Its caption identifies a user-built dashboard inside a shared workspace;
do not treat that dashboard's content as the standard OpenClaw chat UI.

The [Control UI documentation](https://docs.openclaw.ai/web/control-ui)
describes the gateway-served browser interface, agent/session navigation,
chat, and optional panels. This corroborates the interface's role but is not
itself a pixel reference. OpenClaw also has other surfaces, including messaging
channels and native apps; the browser reference does not represent all of them.

**Hero implication:** use the identifiable conversation composer and agent
identity controls, not an invented generic coding terminal.

## Muse

**Identity: unresolved between two relevant Meta products.** The personal-agent
app is a plausible reading alongside OpenClaw and dot. Muse Code is especially
plausible in a coding-session composition. Do not silently merge them.

### Muse Personal Agent

Official identity and product imagery:
[Muse at Meta](https://ai.meta.com/muse/) and the
[September 8, 2026 announcement](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/).

Observed on the product page and its published chat illustration:

- A blue handwritten-style `M` on a white app icon.
- Light messaging surfaces with an agent avatar/name, white assistant bubbles,
  pale-blue user bubbles, typing dots, and an embedded PDF/document preview.
- A bottom composer with a plus control and circular upward-arrow send control.
- The inspected asset is a promotional composite of chat surfaces, not a full
  authenticated desktop-session capture. It is not sufficient evidence for
  recreating every part of the Mac app's window chrome.

[Direct inspected chat illustration](https://lookaside.fbsbx.com/elementpath/media/?media_id=2465669417262632&version=1790192623&transcode_extension=webp).
The page labels this image `Chatting with Muse via mobile or Mac`.

**Hero implication:** use a light conversation with an artifact preview if the
personal agent is intended. Do not give it Muse Code's terminal interface.

### Muse Code

Exact identity: Meta's terminal coding agent, distinct from the personal Muse
app and from the Muse Spark model family. Official sources:

- [Muse Code launch and technical walkthrough](https://dev.meta.ai/resources/blog/build-with-muse-code).
- [Muse Code documentation](https://dev.meta.ai/docs/muse-code).
- [Muse Code updates, including native inter-session messaging](https://dev.meta.ai/resources/blog/muse-code-new-plans-and-features).

The launch article's subagent-status screenshot was visually inspected:

- Black terminal with small monospaced text.
- A bordered table with task, status, and summary columns.
- Separate `done` and `running` rows for parallel work.
- Isolated-worktree information below the table.
- A model, effort, and working-directory footer.

[Direct inspected subagent-status screenshot](https://lookaside.fbsbx.com/elementpath/media/?media_id=1263642349163746&version=1785956927&transcode_extension=webp).

**Hero implication:** label this client `Muse Code`, not just `Muse`, if using
the terminal reference. Its own session-messaging feature does not establish
an Agent Bus integration.

## Dot

**Likely identity: medium-high confidence.** OpenAI's `dots` / `your dot` in
ChatGPT is the strongest current-context match. This is not evidence for a
separate standalone application formally named `Dot`.

Official sources:

- [Introducing dots](https://openai.com/index/introducing-dots/).
- [Getting started with your dot](https://help.openai.com/en/articles/20001530-getting-started-with-your-dot).

### Observed UI

The launch article's developer example, featuring the named dot `Iggy`, was
visually inspected:

- A desktop window with a narrow vertical navigation rail.
- A light conversation pane on the left, with personalized avatar/name and
  status at the top.
- Gray assistant bubbles, pink user bubbles, and a bottom message composer.
- Computer, calling, and panel controls near the conversation header.
- A browser/work surface on the right showing a release-checklist application.
- Pink theming and the specific avatar belong to this example; they are not a
  universal dot identity. The checklist is the work artifact, not dot's own
  standard navigation.

[Direct inspected developer-session image](https://images.ctfassets.net/kftzwdyauwt9/1xROyxcQu9wVqdHbbOjetz/4598e195e1e8acb11b66dd7f340fde12/introducing-dots-carousel-feedback.png).

**Hero implication:** a personalized conversation alongside a work surface is
recognizable and evidence-based. Do not substitute a generic terminal or
invent Agent Bus connection controls inside the client.

### Other Dot Identity

[Dot by New Computer](https://new.computer/dot) is a distinct personal-AI
product. The company's [official homepage](https://new.computer/) announces
that it is winding down New Computer and Dot. That makes it a poor default
choice for a current integrations hero without explicit user confirmation.
The announcement's operational cutoff says October 5 without an explicit year
in the inspected text; these notes do not infer a shutdown year from it.

## Harness

**Likely identity: medium confidence.** Harness App by Autonomous is the best
fit for a hero about agent session windows. It is a host/workspace for agents,
not another model or necessarily an independent agent engine.

Official sources:

- [Harness App](https://www.autonomous.ai/harness-app).
- [Desktop demonstration](https://www.autonomous.ai/harness-app#desktop).
- [Official openharness repository](https://github.com/autonomous-ai/openharness).
- [Desktop download page](https://harness.autonomous.ai/desktop).

### Observed UI

The official product page's interactive `Every agent, side by side`
demonstration was opened and visually inspected:

- Dark desktop-window frame with macOS-style traffic-light controls.
- Top tabs for agent groupings, including all agents and individual clients.
- Four tiled terminal panes with thin dividers.
- Pane headers identify the underlying agent and task, with machine, project,
  and branch context.
- The inspected state includes Claude Code, Codex, Cursor, and Hermes panes
  with distinct terminal prompts and running-status lines.

This is the vendor's interactive marketing demonstration, not a locally tested
Harness session or proof that the sample task outputs are real execution logs.

**Hero implication:** preserve the tiled terminal host and label the underlying
clients. Avoid presenting Harness and its hosted agent as indistinguishable
independent model brands.

### Other Harness Meanings

- [Harness.io](https://www.harness.io/) is a separate enterprise software-delivery
  platform. Its product identity should not be used interchangeably with
  Autonomous's Harness App.
- `Agent harness` can also mean the runtime/orchestration around a model rather
  than a brand. The original phrase does not resolve this ambiguity.

## Agent Bus Support Caveat

The inspected repository README documents named install paths for Claude Code,
Codex, and Kimi Code, plus a broader group of MCP-capable tools. See
[repository README](../../../README.md).

The sibling plugin repository's installer was inspected read-only at
`/Users/air/Documents/Projects/agent-bus-plugins/install.sh`. Its `candidates()`
function names Claude Code, Codex, Kimi Code, Cursor, Gemini CLI, OpenCode,
Goose, Junie, Amp, and Kiro. OpenClaw, Muse, Muse Code, Dot, and Harness were
not named automatic targets. The installer also distinguishes copying skills
from configuring the MCP server; skill installation alone is not integration
verification. Public reference:
[agent-bus-plugins installer](https://github.com/MustaphaSteph/agent-bus-plugins/blob/main/install.sh).

These findings do not establish incompatibility. They also do not establish
support, successful tool discovery, authentication, messaging, or cloud
connectivity for any of the researched candidates. Generic MCP capability,
hosting a supported CLI, or a client's own inter-session messaging is not proof
of an Agent Bus Cloud integration.

Until the exact clients and integrations are validated:

- Do not label these candidates `supported`, `connected`, or `verified`.
- Do not fabricate successful Agent Bus calls or connection-status badges in
  their windows.
- Treat branded window studies as illustrative visual references. A public
  hero showing connected clients can imply support even without explicit copy.
- Resolve Muse versus Muse Code and the intended Harness identity before
  finalizing product labels.
- Retain each client's actual visual language rather than making every session
  the same terminal with a different logo.

Research links are not a license grant or evidence of a partnership. Review
asset and brand usage separately before reusing vendor imagery publicly.
