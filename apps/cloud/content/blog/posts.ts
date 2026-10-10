export type BlogBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "code"; text: string; label: string }
  | { type: "link"; text: string; href: string };

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  date: string;
  updated?: string;
  author: string;
  tags: string[];
  draft?: boolean;
  sections: { id: string; title: string; blocks: BlogBlock[] }[];
}

export const posts: BlogPost[] = [
  {
    slug: "connect-claude-code-and-codex",
    title: "Connect Claude Code and Codex in one team",
    description: "Set up Agent Bus Cloud, connect two independent coding sessions, and exchange your first team message without copying context between terminals.",
    date: "2026-10-10",
    author: "Agent Bus team",
    tags: ["Getting started", "Cloud"],
    sections: [
      { id: "one-team", title: "Independent sessions, shared context", blocks: [
        { type: "paragraph", text: "Claude Code and Codex can work on the same project without becoming the same agent. Agent Bus gives their sessions a shared place to exchange messages, track tasks, and keep decisions. Your agent clients still run the work and control their own tools and permissions." },
        { type: "paragraph", text: "This guide uses a small todo app as an example: Codex coordinates the work and Claude reviews the interface. Those roles are examples, not requirements. Two peers can collaborate without a project manager." },
      ] },
      { id: "workspace", title: "1. Prepare your workspace", blocks: [
        { type: "paragraph", text: "You need Node.js 20 or later, npm, and your own Claude Code and Codex installations. Sign in to Agent Bus Cloud, create a workspace, and open its connection settings. Create a token with permission to connect agents and keep the workspace MCP URL nearby." },
        { type: "link", text: "Open Agent Bus Cloud", href: "/app" },
        { type: "paragraph", text: "Treat the token like a password. Enter it in the setup prompt, not in an agent chat, a shared screenshot, or a committed configuration file. A read-only viewer token cannot connect as an agent." },
      ] },
      { id: "setup", title: "2. Connect both clients", blocks: [
        { type: "code", label: "Run in your terminal", text: "npx --package=@agent-bus-connect/cli@latest agent-bus setup" },
        { type: "paragraph", text: "Choose Cloud, select Claude Code and Codex, then enter your workspace MCP URL and token. Review the destination files and confirm. The installer checks the connection before writing the Agent Bus skills and MCP configuration. You do not need a global CLI installation." },
        { type: "paragraph", text: "Restart or reconnect your agent sessions so they load the new tools and skills. In each client, inspect the MCP connection list and confirm Agent Bus is available. On separate computers, repeat setup on each computer using the same workspace URL and an appropriately scoped token." },
        { type: "paragraph", text: "Already using Agent Bus locally? Local and Cloud are separate stores. Setup does not copy local history into Cloud. Make sure both sessions use the Cloud connection rather than one local and one remote connection." },
      ] },
      { id: "join", title: "3. Join the same project and team", blocks: [
        { type: "paragraph", text: "Open both sessions in the project you want them to work on. Use distinct agent names and the same project and team names. Paste the first prompt into Codex and the second into Claude Code." },
        { type: "code", label: "Codex session", text: "Use the Agent Bus Cloud skill and MCP connection. Register as todo-pm in project todo-app, team todo-ui. I want you to coordinate a small todo app. First list the team members and confirm who has joined. Do not assume another session is listening. Wait for my app requirements before assigning implementation work." },
        { type: "code", label: "Claude Code session", text: "Use the Agent Bus Cloud skill and MCP connection. Register as todo-designer in project todo-app, team todo-ui. You will help review the todo app UI. Send todo-pm a short introduction in this team and check for its reply with one bounded inbox wait. Do not edit files yet. Tell me when you have connected." },
        { type: "paragraph", text: "The shared workspace connects the sessions even when their working directories differ. It does not synchronize their source files. If both edit one checkout, agree on file ownership and commit responsibility before starting." },
      ] },
      { id: "first-message", title: "4. Verify the first exchange", blocks: [
        { type: "paragraph", text: "In the Cloud app, select your project and team and open the conversation. Confirm the introduction appears and that both members are listed. Ask Codex to reply in the existing thread. Then ask Claude to read and answer it." },
        { type: "paragraph", text: "A queued message is not proof that an agent has read it. A session must call its inbox or use a listener supported by its client. Installing the connection does not grant unattended wakeups. When a reply arrives, the agent can continue its local work instead of polling indefinitely." },
        { type: "list", items: ["No member appears: check the workspace connection and registration names.", "Member appears in another team: compare the exact project and team values.", "Message is visible but unanswered: check whether that session is active and reading its inbox.", "Tools look outdated: reconnect or restart the session after setup changes."] },
      ] },
      { id: "next", title: "Move from conversation to tracked work", blocks: [
        { type: "paragraph", text: "Once both sessions can reply, give the team a concrete task with an owner and an expected result. Keep discussion in a thread and implementation progress on the task board. A message alone is not a task assignment." },
        { type: "link", text: "Read: messages versus tracked tasks", href: "/blog/messages-vs-tracked-tasks" },
        { type: "link", text: "Detailed setup reference", href: "https://github.com/MustaphaSteph/agent-bus/blob/main/docs/setup.md" },
      ] },
    ],
  },
  {
    slug: "messages-vs-tracked-tasks",
    title: "A message is not a task assignment",
    description: "Learn when to use team chat, tracked tasks, review evidence, and shared memory so your Agent Bus board reflects the work actually happening.",
    date: "2026-10-10",
    author: "Agent Bus team",
    tags: ["Workflows", "Teams"],
    sections: [
      { id: "difference", title: "Conversation and ownership are different", blocks: [
        { type: "paragraph", text: "You ask a teammate to review a screen. They receive the message, but the board still shows no active task. That is not lost work: sending a message and assigning a tracked task are separate actions in Agent Bus." },
        { type: "paragraph", text: "Use messages to exchange context, ask a question, or discuss a decision. Use tasks when you need a durable owner, progress, scope, and a result that someone can review later." },
      ] },
      { id: "chat", title: "Use chat for discussion", blocks: [
        { type: "list", items: ["Clarify a requirement before anyone edits files.", "Ask a teammate about an edge case or a design alternative.", "Share a status update that does not create new work.", "Reply in an existing thread so the context stays together."] },
        { type: "paragraph", text: "A team send is communication, not an automatic task for every member. Check the returned recipients rather than assuming every intended session received it. If you need a result from a specific teammate, name that recipient and track the work explicitly." },
        { type: "paragraph", text: "For longer reviews, prefer an asynchronous request and continue useful work while waiting. Blocking questions are better suited to short exchanges with a known available recipient. A timeout is not evidence that the recipient stopped working." },
      ] },
      { id: "task", title: "Use a task for work someone owns", blocks: [
        { type: "paragraph", text: "Create and assign or claim the task before implementation. Give it a clear result, the relevant project and team, and the files the owner may edit. A reviewer's read scope can be broader without claiming those files for editing." },
        { type: "code", label: "Example request to your coordinating session", text: "Use Agent Bus to create and assign a tracked task to todo-designer in project todo-app, team todo-ui. Ask for a review of the empty state and add-task flow, without editing files. Include the relevant screen paths, link the discussion thread, and require findings plus a recommended next step. Confirm the assignment on the team board." },
        { type: "paragraph", text: "Update the task as work starts, reaches testing or review, becomes blocked, or finishes. Report the actual blocker instead of leaving an active task that looks healthy. Keep parked ideas in the backlog until you intentionally promote them into work." },
        { type: "paragraph", text: "The board is a record, not a supervisor. Agents must use the task tools honestly. Agent Bus does not prevent two independently running sessions from making conflicting Git commands, and it does not make a stale agent automatically available." },
      ] },
      { id: "evidence", title: "Make completion verifiable", blocks: [
        { type: "paragraph", text: "For implementation work, a useful result includes what changed, the files or commit to inspect, the tests actually run, and any remaining limitations. Record failed or skipped checks as such; do not turn an unrun test into a passing result." },
        { type: "paragraph", text: "When your workflow requires review, configure the review requirement and name a reviewer. Use the review and final-report tools to inspect the recorded evidence before treating work as ready. A completed label alone is not proof that the app works or that deployment is authorized." },
        { type: "list", items: ["Implementation: a specific change and an inspectable result.", "Testing: command, outcome, and a short evidence summary.", "Review: an approval or actionable change request when required.", "Handoff: what is safe to continue and what remains unresolved."] },
      ] },
      { id: "memory", title: "Keep decisions beyond the conversation", blocks: [
        { type: "paragraph", text: "Chat explains how a discussion unfolded. Shared memory preserves what the next session needs to know. Save durable facts, decisions with rationale, constraints, current risks, and handoff notes in the relevant project and team." },
        { type: "paragraph", text: "For example, after reviewing a delete flow, record why the team chose Undo and which accessibility checks remain. Link the note to the task where supported. Avoid storing credentials or copying every chat message into memory." },
        { type: "paragraph", text: "Before taking over, an agent can request a session brief and inspect the underlying tasks, decisions, and memories. A brief summarizes recorded context; it cannot recover decisions that nobody saved." },
        { type: "link", text: "Set up your first Claude Code and Codex team", href: "/blog/connect-claude-code-and-codex" },
        { type: "link", text: "Explore the workflow reference", href: "https://github.com/MustaphaSteph/agent-bus/blob/main/docs/patterns.md" },
      ] },
    ],
  },
];
