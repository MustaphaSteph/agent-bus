# Agentic Website Research

Research date: 2026-10-08

## Purpose

Inform the Agent Bus Cloud landing page with official agentic and multi-agent
SaaS references. The visual requirement is recognizable agent session WINDOWS
(Claude Code, Codex, Kimi, and similar clients), not cursors, floating logos,
sculptures, or abstract representations of agents.

This research covers landing-page composition and product demonstrations.
Individual client interface research belongs to the parent task and was not
duplicated here.

## Method and Evidence

- Opened the official CrewAI, LangSmith, Lindy, Relevance AI, Devin, and Factory
  websites in the Codex in-app browser.
- Visually inspected desktop viewport screenshots, including below-fold
  product sections, and used accessibility snapshots to identify page content.
- Used the browser's Playwright locator interface to switch Lindy's demo from
  the growth channel to engineering and Factory Mission Control to Workers.
- Inspected local `README.md` and `docs/cloud.md` for Agent Bus brand and product
  context. No implementation files were edited during research.
- Screenshots were inspected inline in tool results, not exported as persistent
  image files. This document records observations, not a screenshot archive.
- This was desktop visual research, not a mobile, accessibility, performance,
  or authenticated-product audit.

## Official Sources and Observations

### 1. CrewAI

Source: https://crewai.com/

Observed screenshot details:

- White navigation beneath a coral announcement strip.
- A centered, large serif headline with an italic second line, over a warm,
  softly colored hero background.
- A large video frame begins below the introductory copy. Its first viewport
  does not immediately make the working product legible.
- Below the hero and customer logos, Discover and Build sections pair large
  editorial headings on the left with actual product screenshots on the right.
- Screenshots retain application navigation and working content. The discovery
  screenshot shows tool selection; the builder screenshot shows a studio and
  workflow canvas.
- The page content continues through Govern and Optimize, establishing a
  Discover -> Build -> Govern -> Optimize sequence.

Borrow without copying:

- Explain a lifecycle in a deliberate sequence, with software evidence beside
  each claim.
- Give each section one job and one relevant product view.

Do not borrow:

- The atmospheric hero, oversized rounded wrapper, or enterprise-heavy opening.
  Agent Bus should expose recognizable sessions earlier.
- CrewAI's workflow-builder positioning. Agent Bus connects existing sessions;
  it should not look like a replacement agent-building framework.

### 2. LangSmith Observability

Source: https://www.langchain.com/langsmith/observability

Navigation note: visiting `https://www.langchain.com/langsmith` redirected to
the observability page during research.

Observed screenshot details:

- A near-black technical presentation with a bordered navigation bar,
  pale-blue headline, and restrained monospace accents.
- The hero puts explanatory text on the left and a large cropped dashboard on
  the right. Visible dashboard content includes trace counts, errors, and charts.
- Below customer logos, a tracing section pairs explanation with a nested
  execution tree and inspection details.
- Tracing, Monitoring, and Insights are organized as expandable sections.

Borrow without copying:

- Make otherwise invisible coordination inspectable: sender, recipient, task,
  timestamp, status, and result.
- Retain enough real interface structure to make technical claims credible.

Do not borrow:

- A chart-led first impression. Metrics communicate monitoring, not agents
  exchanging context and handing off work.
- The dark-blue palette or split hero as a template for Agent Bus.

### 3. Lindy

Source: https://www.lindy.ai/

Observed screenshot details:

- A light page with a compact elevated navigation bar, centered headline, blue
  primary action, and secondary demo action.
- A wide Slack-style application window begins beneath the introductory copy.
  It has a workspace name, channel sidebar, channel header, avatars, timestamps,
  messages, and a message composer.
- The growth scenario shows a request about ad spend followed by completed
  tool actions. The content progresses toward a concrete report and decision.
- Selecting the engineering channel changed the demo to a signup failure
  investigation. Its content includes PR inspection, OAuth-related diagnosis,
  and a code-change artifact.
- The demo makes request, work, and result understandable in familiar software
  rather than relying on a diagram of connected logos.

Borrow without copying:

- Use a short, readable request -> action -> result sequence.
- Offer a few meaningful scenarios, with stable window dimensions and legible
  content throughout the transition.
- Let recognizable application structure do explanatory work.

Do not borrow:

- The floating integration-logo decoration.
- A single generic chat interface for every agent. Agent Bus needs visually
  distinct client sessions so cross-tool collaboration is obvious.

Evidence caveat: the browser displayed a headline framing Lindy as a coworker,
while the web text retrieval returned a different opening headline. The visual
observations above refer to the browser-rendered page; the discrepancy could
reflect variants or caching and was not investigated.

### 4. Relevance AI

Source: https://relevanceai.com/

Observed screenshot details:

- The current hero introduces Invent 2.0 with text and actions on the left and
  a purple character graphic on the right.
- A customer-logo band follows, including links to case studies.
- Lower sections organize use cases by function and show compact examples of
  task outputs.
- The specialist-agent section has role selectors above a broad dashboard.
  Summary metrics sit above a task table with task, responsible agent, model,
  evaluation, and cost columns.
- The table makes assignment and heterogeneous model usage concrete rather
  than merely asserting that multiple agents exist.

Borrow without copying:

- Make ownership explicit: which session owns each task, its current state,
  and the result it produced.
- Present different agent roles as participants in useful work, not collectible
  agent avatars.

Do not borrow:

- The character-led hero or generic purple styling.
- Example ROI, cost, or evaluation counters as if they were Agent Bus evidence.
  Agent Bus needs its own measured claims or clearly labeled demo data.

### 5. Devin

Source: https://devin.ai/

Observed screenshot details:

- A restrained light page with a compact, left-aligned introduction and paired
  get-started and demo actions.
- A large desktop session window appears below the introduction. Its session
  sidebar, conversation, and composer remain recognizable.
- A foreground PR panel overlaps the session window on the right. It contains
  a change summary, changed-file information, and a test-recording preview.
- The conversation includes implementation progress, passed tests, and a PR
  artifact. The composition presents both the work and evidence of its outcome.
- Decorative image fragments sit behind the primary application windows.

Borrow without copying:

- Use session plus evidence as the main composition principle.
- Pair a readable working session with an actual review, test result, or
  artifact that demonstrates completion.
- Use modest overlap to establish hierarchy, never to obscure the key messages.

Do not borrow:

- Decorative background fragments or excessive window overlap.
- Devin's autonomous-runtime promises. A coordination service must not imply
  it provides the same execution environment or lifecycle guarantees.

### 6. Factory Missions

Primary source: https://factory.com/product/missions

Additional official page inspected: https://factory.com/

Navigation note: `https://factory.ai/` redirected to `https://factory.com/`.

Observed screenshot details:

- Factory's homepage uses a restrained monochrome shell, an uppercase centered
  headline, compact actions, and an installation command. A large dark session
  window appears below the introduction against a technical grid background.
- The Missions page gives substantial space to a Mission Control terminal demo.
  Its visible working state includes an active feature, prerequisites, feature
  completion states, a progress log, and an active-worker execution transcript.
- Selecting Workers changed the demonstration to a table with session IDs,
  durations, statuses, and assigned features. Filters distinguish active,
  completed, and failed workers.
- The surrounding page explains parallel execution, planning, coordination,
  and use cases such as migrations and large feature work.

Borrow without copying:

- Show concrete coordination through task ownership, worker state, and a
  shared execution history.
- Allow visitors to inspect a focused detail view without losing the overall
  scenario.

Do not borrow:

- Tiny terminal text as the entire explanation, dark overlays that reduce
  readability, or a terminal-only visual identity.
- Claims of automatically planning and executing projects unless those
  behaviors are demonstrated by the actual Agent Bus integration.

## Concrete Design Conclusions

The strongest combination is Devin's session-window composition, Lindy's
readable workflow demonstration, and Factory's coordination evidence.

1. Make authentic client WINDOWS the primary visual asset. Preserve identifying
   chrome, session titles, and meaningful content from the parent task's client
   research. A logo on a generic terminal is not enough.
2. Give the hero one collaboration scenario. Three unrelated screenshots would
   show compatibility, but not teamwork.
3. Show causality across windows: a request in one session, its receipt and
   acceptance in another, and a review or result in the third.
4. Make Agent Bus visible as a compact shared activity or task strip, subordinate
   to the sessions. It connects the clients; it does not replace their UI.
5. Put recognizable sessions in the first viewport. Keep introductory copy
   short enough that the product is not pushed entirely below the fold.
6. Use a broad, unframed product scene beneath the introduction, not a decorative
   card containing the entire hero. Window frames are appropriate because they
   represent actual software windows.
7. Keep important content readable. Avoid severe perspective, blur, heavy
   cropping, or window overlap that hides the handoff.
8. Animate message arrival, acknowledgment, task-state changes, and results.
   Do not substitute drifting windows, animated cursors, or ornamental lines
   for evidence of collaboration. Include pause/replay and reduced-motion states.
9. On mobile, show one readable session at a time with persistent session
   selectors and shared task status. Do not scale three desktop windows down
   into unreadable thumbnails.
10. Use screenshots or faithful reconstructions of supported workflows. Clearly
    label illustrative transcripts and simulated interaction as a demo.

## Recommended Hero Copy and Demo

H1: **Agent Bus Cloud**

Supporting promise: **Your agent sessions, working as one team.**

Description: Connect Claude Code, Codex, Kimi, and other MCP-capable agents across
machines. Share messages, delegate tasks, and review results in one workspace.

Primary action: **Create workspace**

Secondary action: **Watch a handoff**

Illustrative demo sequence, subject to validation against working integrations:

1. A Claude Code session requests an implementation and supplies its context.
2. A Codex session receives and accepts the task, then returns a change and
   verification result.
3. A Kimi session receives a review request and returns its findings.
4. The shared activity strip records ownership and the final task state.

These are scenario roles, not claims that a particular client must always plan,
implement, or review. The visual should make clear that different tools are
participating in the same project.

## Recommended Page Narrative

1. **Separate sessions, shared work.** Users keep their existing agents and
   tools. Agent Bus provides the shared coordination workspace.
2. **One complete handoff.** Demonstrate request, acceptance, work, review, and
   result with concrete messages and task states.
3. **Human oversight.** Show the shared thread, ownership, blockers, and a human
   message entering the conversation.
4. **The cloud benefit.** Explain that the same coordination workflow can reach
   connected sessions across machines through a workspace and remote MCP URL.
5. **Setup and boundaries.** Create workspace -> connect sessions -> start
   collaborating. Explain local versus cloud mode and what data is stored.

## Product Grounding and Honesty Limits

Local context reviewed:

- `README.md`, especially the opening positioning and Agent Bus Cloud section.
- `docs/cloud.md`, especially Product Goal and the explicit local/cloud split.

The repository describes Cloud as the hosted coordination model reached through
a remote MCP URL. Its product goal includes connected sessions that chat, ask,
delegate, review, remember, and use team boards. Local mode remains explicit and
local-first; cloud mode is additive.

Limits to preserve in design and copy:

- Do not imply that Agent Bus Cloud hosts agent compute, runs the client
  applications, or keeps an agent executing after its client closes.
- Do not imply automatic synchronization of source files, working directories,
  Git branches, or execution environments across machines.
- Do not imply that connecting clients automatically causes every client to
  listen, accept work, or execute without its normal permissions and lifecycle.
- A visible agent window is evidence of client participation, not proof that
  the Agent Bus dashboard embeds or remotely controls that application.
- Do not invent support guarantees for specific client versions. Validate
  remote MCP setup and authentication for each depicted integration.
- Do not carry the local product's no-cloud/no-account promises into the Cloud
  offering. Clearly distinguish the two modes and their data handling.
- Do not claim enterprise certifications, uptime guarantees, encryption
  properties, zero retention, or measured productivity gains without evidence.
- Do not reuse competitor customer logos, testimonials, metrics, copy, or
  screenshots as Agent Bus proof. Borrow presentation principles, not identity
  or claims.
- A staged demo must not be presented as a live production workload. Use real
  captures where available and label illustrative data clearly.
- The official sites are references for presentation, not independently
  verified evidence that all of their advertised capabilities work as stated.
- Research reflects pages rendered on 2026-10-08. Marketing content can change,
  and observed variants should not be treated as permanent design specifications.

## Scope of This Deliverable

This file is a research handoff only. It does not modify the landing page,
implement a demo, supply client-interface assets, or validate the Cloud runtime.
