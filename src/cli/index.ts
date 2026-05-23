#!/usr/bin/env node
import { Command } from "commander";
import kleur from "kleur";
import {
  ack,
  acknowledgeTask,
  checkScopeConflicts,
  directory,
  finalReport,
  handoffTask,
  inbox,
  listDecisions,
  listMemories,
  listTestResults,
  AREA_WILDCARD,
  pinMemory,
  projectBoard,
  PROJECT_WILDCARD,
  recentMessages,
  register,
  recordDecision,
  recordTestResult,
  remember,
  send,
  setAgentStatus,
  setPaused,
  sessionBrief,
  sleepAgent,
  submitReview,
  wakeAgent,
  whois,
  waitForAgents,
} from "../bus.js";
import { dbPath } from "../util/paths.js";
import { packageVersion } from "../util/package-info.js";
import {
  configuredAreas,
  deriveScope,
  scopeConfigPath,
  writeScopeConfig,
} from "../util/project.js";
import { formatMessage } from "./format.js";
import { installHook, uninstallHook } from "./install-hook.js";
import { listenPrompt } from "./listen-prompt.js";
import { markListening, unmarkListening } from "./listener-marker.js";
import { pollInbox } from "./poll-inbox.js";
import { resolveScopeOptions, scopeBanner } from "./project-scope.js";
import { tasks } from "./tasks.js";
import { watch } from "./watch.js";

const program = new Command();
program
  .name("agent-bus")
  .description("Local message bus for Claude Code, Codex and other MCP agents.")
  .version(packageVersion());

program
  .command("watch")
  .description("Live tail messages for the current project")
  .option("--interval <ms>", "poll interval in ms", "250")
  .option("--project <name>", "project scope (default current repo; use 'all' for global)")
  .option("--area <name>", "area scope from .agent-bus.json (use 'all' for every area)")
  .option("--global", "show every project and area")
  .action(async (opts: { interval: string; project?: string; area?: string; global?: boolean }) => {
    const scope = opts.global === true ? { project: "all", area: "all" } : { project: opts.project, area: opts.area };
    const resolved = resolveScopeOptions(scope.project, scope.area);
    await watch({
      intervalMs: Number(opts.interval),
      strict: opts.global !== true,
      ...resolved,
    });
  });

program
  .command("log")
  .description("Show the most recent messages and exit")
  .option("-n, --last <count>", "how many to show", "50")
  .option("--project <name>", "project scope (default current repo; use 'all' for global)")
  .option("--area <name>", "area scope from .agent-bus.json (use 'all' for every area)")
  .action((opts: { last: string; project?: string; area?: string }) => {
    const scope = resolveScopeOptions(opts.project, opts.area);
    const banner = scopeBanner(scope);
    if (banner) console.log(banner);
    const msgs = recentMessages({ limit: Number(opts.last), ...scope });
    if (msgs.length === 0) {
      console.log(kleur.gray("(no messages yet)"));
      return;
    }
    for (const m of msgs) console.log(formatMessage(m));
  });

program
  .command("whois")
  .description("List registered agents")
  .option("--project <name>", "project scope (default current repo; use 'all' for global)")
  .option("--area <name>", "area scope from .agent-bus.json (use 'all' for every area)")
  .action((opts: { project?: string; area?: string }) => {
    const scope = resolveScopeOptions(opts.project, opts.area);
    const banner = scopeBanner(scope);
    if (banner) console.log(banner);
    const agents = directory(scope);
    if (agents.length === 0) {
      console.log(kleur.gray("(no agents registered)"));
      return;
    }
    for (const a of agents) {
      const caps = a.capabilities.length > 0 ? ` [${a.capabilities.join(", ")}]` : "";
      const projectChip = a.project ? ` {${a.project}}` : " {no-project}";
      const areaChip = a.area ? `/${a.area}` : "";
      const role = a.role ? ` role=${a.role}` : "";
      const active = a.active_task_id ? ` task=#${a.active_task_id}` : "";
      const paused = a.paused ? kleur.red(" (paused)") : "";
      console.log(`${kleur.bold(a.name)}${kleur.gray(caps)}${kleur.gray(projectChip + areaChip + role + active)}${paused}  ${kleur.gray(`${a.status}/${a.presence}, seen ${a.age_s}s ago`)}`);
    }
  });

program
  .command("scope")
  .description("Show the project/area derived from the current directory")
  .action(() => {
    const scope = deriveScope();
    console.log(JSON.stringify({ ...scope, config: scopeConfigPath() }, null, 2));
  });

program
  .command("areas")
  .description("List areas from .agent-bus.json")
  .action(() => {
    const areas = configuredAreas();
    if (Object.keys(areas).length === 0) {
      console.log(kleur.gray("(no areas configured)"));
      return;
    }
    for (const [name, patterns] of Object.entries(areas)) {
      console.log(`${kleur.bold(name)} ${kleur.gray(patterns.join(", "))}`);
    }
  });

program
  .command("init")
  .description("Create a .agent-bus.json scope config")
  .option("--project <name>", "project name (default derived from cwd)")
  .option("--areas <list>", "comma-separated area names", "backend,frontend,ios")
  .option("--force", "overwrite existing config")
  .action((opts: { project?: string; areas: string; force?: boolean }) => {
    const existing = scopeConfigPath();
    if (existing && opts.force !== true) {
      throw new Error(`${existing} already exists; pass --force to overwrite`);
    }
    const project = opts.project ?? deriveScope().project ?? "agent-bus-project";
    const areas = Object.fromEntries(
      opts.areas
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((area) => [area, [`${area}/**`]]),
    );
    const path = writeScopeConfig({
      project,
      areas,
      routing: { default: "same-area", managerAreas: ["pm"] },
      hooks: {},
    });
    console.log(`${kleur.green("created")} ${path}`);
  });

program
  .command("team")
  .description("Team topology helpers")
  .command("init <areas...>")
  .description("Create .agent-bus.json and print recommended agent names")
  .option("--project <name>", "project name (default derived from cwd)")
  .action((areas: string[], opts: { project?: string }) => {
    const project = opts.project ?? deriveScope().project ?? "agent-bus-project";
    const path = writeScopeConfig({
      project,
      areas: Object.fromEntries(areas.map((area) => [area, [`${area}/**`]])),
      routing: { default: "same-area", managerAreas: ["pm"] },
      hooks: {},
    });
    console.log(`${kleur.green("created")} ${path}`);
    console.log("recommended agents:");
    console.log(`  ${project}-pm`);
    for (const area of areas) {
      console.log(`  ${project}-${area}-worker`);
      console.log(`  ${project}-${area}-verifier`);
    }
  });

program
  .command("doctor")
  .description("Check local bus health and current scope")
  .action(() => {
    const scope = deriveScope();
    const agents = directory({ project: scope.project ?? undefined, area: scope.area ?? undefined });
    const stale = agents.filter((a) => a.presence === "stale").length;
    console.log(`db: ${dbPath()}`);
    console.log(`scope: project=${scope.project ?? "-"} area=${scope.area ?? "-"}`);
    console.log(`config: ${scopeConfigPath() ?? "-"}`);
    console.log(`agents: ${agents.length} (${stale} stale)`);
    console.log(`areas: ${Object.keys(configuredAreas()).join(", ") || "-"}`);
  });

program
  .command("listen")
  .description("Long-running local inbox listener")
  .requiredOption("--agent <name>", "agent name")
  .option("--claim-s <seconds>", "claim window before redelivery", "300")
  .option("--wait-s <seconds>", "blocking inbox wait per poll", "110")
  .action(async (opts: { agent: string; claimS: string; waitS: string }) => {
    console.log(kleur.bold(`listening as ${opts.agent}`));
    for (;;) {
      const messages = await inbox({
        agent: opts.agent,
        wait_s: Number(opts.waitS),
        claim_s: Number(opts.claimS),
      });
      for (const message of messages) {
        console.log(formatMessage(message));
        ack({ agent: opts.agent, message_id: message.id });
      }
    }
  });

program
  .command("tasks")
  .description("List tasks or watch task changes")
  .option("--state <state>", "filter by task state")
  .option("--all", "include terminal tasks (completed, failed, canceled)")
  .option("--watch", "keep running and print new/changed tasks")
  .option("--interval <ms>", "watch poll interval in ms", "1000")
  .option("--project <name>", "project scope (default current repo; use 'all' for global)")
  .option("--area <name>", "area scope from .agent-bus.json (use 'all' for every area)")
  .option("--required-capability <name>", "filter by required task capability")
  .option("--mode <mode>", "filter by task mode")
  .option("--manager-reviewed", "only reviewed tasks")
  .action(async (opts: { state?: string; all?: boolean; watch?: boolean; interval: string; project?: string; area?: string; requiredCapability?: string; mode?: string; managerReviewed?: boolean }) => {
    await tasks({
      state: opts.state,
      all: opts.all,
      watch: opts.watch,
      intervalMs: Number(opts.interval),
      requiredCapability: opts.requiredCapability,
      mode: opts.mode,
      managerReviewed: opts.managerReviewed,
      ...resolveScopeOptions(opts.project, opts.area),
    });
  });

program
  .command("inject")
  .description("Send a message into the bus from the human relay")
  .requiredOption("--to <agent>", "recipient agent")
  .option("--from <agent>", "sender name (default 'human')", "human")
  .argument("<message>", "the message body")
  .action((message: string, opts: { from: string; to: string }) => {
    register({ name: opts.from, capabilities: ["human"], replace: true });
    const m = send({ from: opts.from, to: opts.to, content: message });
    console.log(formatMessage(m));
  });

program
  .command("pause <agent>")
  .description("Stop delivering messages to this agent (they queue up)")
  .action((agent: string) => {
    setPaused(agent, true);
    console.log(kleur.yellow(`paused ${agent}`));
  });

program
  .command("sleep <agent>")
  .description("Mark an agent as sleeping")
  .action((agent: string) => {
    sleepAgent(agent);
    console.log(kleur.yellow(`sleeping ${agent}`));
  });

program
  .command("wake <agent>")
  .description("Wake a sleeping agent")
  .action((agent: string) => {
    wakeAgent(agent);
    console.log(kleur.green(`awake ${agent}`));
  });

program
  .command("status <agent> <status>")
  .description("Set agent status: idle, working, blocked, waiting_review, sleeping")
  .action((agent: string, status: string) => {
    setAgentStatus(agent, status as never);
    console.log(kleur.green(`${agent} status=${status}`));
  });

program
  .command("ack-task <task-id>")
  .description("Acknowledge an assigned task as claimed, declined, or blocked")
  .requiredOption("--agent <name>", "agent acknowledging the task")
  .requiredOption("--response <value>", "claimed, declined, or blocked")
  .option("--note <text>", "optional acknowledgement note")
  .action((taskId: string, opts: { agent: string; response: string; note?: string }) => {
    const task = acknowledgeTask({
      agent: opts.agent,
      task_id: Number(taskId),
      response: opts.response as never,
      note: opts.note,
    });
    console.log(`${kleur.green("acknowledged")} task #${task.id} ${task.acknowledged_by ?? ""}`);
  });

program
  .command("review-task <task-id>")
  .description("Submit verifier review for a task")
  .requiredOption("--reviewer <name>", "reviewing agent")
  .option("--approve", "mark review approved")
  .option("--changes-requested", "mark review as changes requested")
  .option("--notes <text>", "review notes")
  .action((taskId: string, opts: { reviewer: string; approve?: boolean; changesRequested?: boolean; notes?: string }) => {
    if (opts.approve !== true && opts.changesRequested !== true) {
      throw new Error("pass --approve or --changes-requested");
    }
    const task = submitReview({
      reviewer: opts.reviewer,
      task_id: Number(taskId),
      approved: opts.approve === true,
      notes: opts.notes,
    });
    console.log(`${kleur.green("reviewed")} task #${task.id} ${task.review_state}`);
  });

program
  .command("handoff <task-id>")
  .description("Create a pinned handoff memory and optionally assign/release a task")
  .requiredOption("--from <agent>", "agent handing off")
  .requiredOption("--reason <text>", "handoff reason")
  .option("--to <agent>", "optional target agent")
  .option("--memory <text>", "memory content; defaults to the reason")
  .action((taskId: string, opts: { from: string; reason: string; to?: string; memory?: string }) => {
    const result = handoffTask({
      from_agent: opts.from,
      task_id: Number(taskId),
      to_agent: opts.to ?? null,
      reason: opts.reason,
      memory: opts.memory,
    });
    console.log(`${kleur.green("handoff")} task #${result.task.id}${result.memory ? ` memory #${result.memory.id}` : ""}`);
  });

program
  .command("scope-conflicts")
  .description("Check whether a proposed file scope overlaps active tasks")
  .requiredOption("--files <list>", "comma-separated file scope patterns")
  .option("--exclude-task <id>", "task id to ignore")
  .option("--project <name>", "project scope (use all for global)")
  .option("--area <name>", "area scope (use all for global)")
  .action((opts: { files: string; excludeTask?: string; project?: string; area?: string }) => {
    const conflicts = checkScopeConflicts({
      ...resolveScopeOptions(opts.project, opts.area),
      file_scope: opts.files.split(",").map((value) => value.trim()).filter(Boolean),
      exclude_task_id: opts.excludeTask ? Number(opts.excludeTask) : undefined,
    });
    if (conflicts.length === 0) {
      console.log(kleur.green("no scope conflicts"));
      return;
    }
    for (const conflict of conflicts) {
      console.log(`#${conflict.task_id} [${conflict.state}] ${conflict.title}${kleur.gray(` held=${conflict.claimed_by ?? "-"} overlap=${conflict.overlapping_scope}`)}`);
    }
  });

program
  .command("wait-for-agents")
  .description("Wait for an expected agent roster")
  .requiredOption("--names <list>", "comma-separated agent names")
  .option("--timeout <seconds>", "seconds to wait", "60")
  .option("--project <name>", "expected project scope (use all for any)")
  .option("--area <name>", "expected area scope (use all for any)")
  .action(async (opts: { names: string; timeout: string; project?: string; area?: string }) => {
    const result = await waitForAgents({
      ...resolveScopeOptions(opts.project, opts.area),
      names: opts.names.split(",").map((value) => value.trim()).filter(Boolean),
      timeout_s: Number(opts.timeout),
    });
    console.log(kleur.bold("Ready:"));
    console.log(formatList(result.ready.map((agent) => `${agent.name} ${agent.status}/${agent.presence}`)));
    console.log(kleur.bold("Missing:"));
    console.log(formatList(result.missing));
    console.log(kleur.bold("Stale:"));
    console.log(formatList(result.stale.map((agent) => `${agent.name} seen ${agent.age_s}s ago`)));
    console.log(kleur.bold("Wrong scope:"));
    console.log(formatList(result.wrong_scope.map((row) => `${row.name} is ${row.project ?? "-"}${row.area ? `/${row.area}` : ""}`)));
  });

program
  .command("decision")
  .description("Record or list project decisions")
  .option("--by <agent>", "agent recording the decision")
  .option("--decision <text>", "decision text")
  .option("--rationale <text>", "why this was decided")
  .option("--implemented", "mark decision implemented")
  .option("--list", "list decisions")
  .option("--project <name>", "project scope (use all for global)")
  .option("--area <name>", "area scope (use all for global)")
  .action((opts: { by?: string; decision?: string; rationale?: string; implemented?: boolean; list?: boolean; project?: string; area?: string }) => {
    const scope = resolveScopeOptions(opts.project, opts.area);
    if (opts.list) {
      const rows = listDecisions({ ...scope });
      for (const row of rows) {
        const mark = row.implemented ? "done" : "open";
        console.log(`#${row.id} [${mark}] ${row.decision}${row.rationale ? kleur.gray(` - ${row.rationale}`) : ""}`);
      }
      return;
    }
    if (!opts.by || !opts.decision) throw new Error("--by and --decision are required unless --list is used");
    const row = recordDecision({
      by_agent: opts.by,
      decision: opts.decision,
      rationale: opts.rationale,
      implemented: opts.implemented,
      project: scope.project ?? null,
      area: scope.area ?? null,
    });
    console.log(`${kleur.green("recorded")} decision #${row.id}`);
  });

program
  .command("remember <content>")
  .description("Record a durable project memory")
  .requiredOption("--by <agent>", "agent recording the memory")
  .option("--kind <kind>", "memory kind: summary, handoff, risk, todo, fact, blocker, lesson, gotcha, or custom", "summary")
  .option("--agent <name>", "optional subject/target agent")
  .option("--task <id>", "optional related task id")
  .option("--thread <id>", "optional related thread id")
  .option("--pinned", "pin the memory so brief surfaces it")
  .option("--supersedes <id>", "older memory id this one replaces")
  .option("--project <name>", "project scope (use all for global)")
  .option("--area <name>", "area scope (use all for global)")
  .action((content: string, opts: { by: string; kind: string; agent?: string; task?: string; thread?: string; pinned?: boolean; supersedes?: string; project?: string; area?: string }) => {
    const scope = resolveScopeOptions(opts.project, opts.area);
    const row = remember({
      by_agent: opts.by,
      kind: opts.kind,
      content,
      agent: opts.agent ?? null,
      task_id: opts.task ? Number(opts.task) : null,
      thread_id: opts.thread ?? null,
      pinned: opts.pinned,
      supersedes_id: opts.supersedes ? Number(opts.supersedes) : null,
      project: scope.project ?? null,
      area: scope.area ?? null,
    });
    console.log(`${kleur.green("remembered")} memory #${row.id}`);
  });

program
  .command("memories")
  .description("List durable project memories")
  .option("--agent <name>", "filter by author or subject agent")
  .option("--kind <kind>", "filter by memory kind")
  .option("--task <id>", "filter by related task id")
  .option("--thread <id>", "filter by related thread id")
  .option("--pinned", "only show pinned memories")
  .option("--unpinned", "only show unpinned memories")
  .option("--since <ms>", "only show memories created at or after this ms epoch")
  .option("-n, --last <count>", "how many to show", "50")
  .option("--project <name>", "project scope (use all for global)")
  .option("--area <name>", "area scope (use all for global)")
  .action((opts: { agent?: string; kind?: string; task?: string; thread?: string; pinned?: boolean; unpinned?: boolean; since?: string; last: string; project?: string; area?: string }) => {
    const pinned = opts.pinned ? true : opts.unpinned ? false : undefined;
    const rows = listMemories({
      ...resolveScopeOptions(opts.project, opts.area),
      agent: opts.agent,
      kind: opts.kind,
      task_id: opts.task ? Number(opts.task) : undefined,
      thread_id: opts.thread,
      pinned,
      since: opts.since ? Number(opts.since) : undefined,
      limit: Number(opts.last),
    });
    if (rows.length === 0) {
      console.log(kleur.gray("(no memories yet)"));
      return;
    }
    for (const row of rows) {
      const subject = row.agent ? ` agent=${row.agent}` : "";
      const task = row.task_id ? ` task=#${row.task_id}` : "";
      const thread = row.thread_id ? ` thread=${row.thread_id}` : "";
      const pinnedMark = row.pinned ? " pinned" : "";
      console.log(`#${row.id} [${row.kind}] ${row.content}${kleur.gray(pinnedMark + subject + task + thread)}`);
    }
  });

program
  .command("test-result")
  .description("Record or list test/build/lint evidence")
  .option("--by <agent>", "agent recording the result")
  .option("--task <id>", "related task id")
  .option("--command <text>", "command that was run")
  .option("--status <status>", "passed, failed, or skipped")
  .option("--summary <text>", "short output summary")
  .option("--list", "list results")
  .option("-n, --last <count>", "how many to list", "50")
  .option("--project <name>", "project scope (use all for global)")
  .option("--area <name>", "area scope (use all for global)")
  .action((opts: { by?: string; task?: string; command?: string; status?: string; summary?: string; list?: boolean; last: string; project?: string; area?: string }) => {
    const scope = resolveScopeOptions(opts.project, opts.area);
    if (opts.list === true) {
      const rows = listTestResults({
        ...scope,
        task_id: opts.task ? Number(opts.task) : undefined,
        by_agent: opts.by,
        status: opts.status as never,
        limit: Number(opts.last),
      });
      console.log(formatList(rows.map((row) => `#${row.id} [${row.status}] ${row.command}${row.output_summary ? ` - ${row.output_summary}` : ""}`)));
      return;
    }
    if (!opts.by || !opts.command || !opts.status) throw new Error("--by, --command, and --status are required unless --list is used");
    const row = recordTestResult({
      by_agent: opts.by,
      task_id: opts.task ? Number(opts.task) : null,
      command: opts.command,
      status: opts.status as never,
      output_summary: opts.summary ?? null,
      project: scope.project === PROJECT_WILDCARD ? null : (scope.project ?? null),
      area: scope.area === AREA_WILDCARD ? null : (scope.area ?? null),
    });
    console.log(`${kleur.green("recorded")} test result #${row.id}`);
  });

program
  .command("pin-memory <id>")
  .description("Pin a memory so brief surfaces it")
  .action((id: string) => {
    const row = pinMemory(Number(id), true);
    console.log(`${kleur.green("pinned")} memory #${row.id}`);
  });

program
  .command("unpin-memory <id>")
  .description("Unpin a memory")
  .action((id: string) => {
    const row = pinMemory(Number(id), false);
    console.log(`${kleur.green("unpinned")} memory #${row.id}`);
  });

program
  .command("brief")
  .description("Generate a startup/handoff brief from agents, tasks, decisions, memories, and messages")
  .option("--agent <name>", "filter memories for an agent")
  .option("-n, --last <count>", "maximum items per section", "10")
  .option("--project <name>", "project scope (use all for global)")
  .option("--area <name>", "area scope (use all for global)")
  .action((opts: { agent?: string; last: string; project?: string; area?: string }) => {
    const brief = sessionBrief({
      ...resolveScopeOptions(opts.project, opts.area),
      agent: opts.agent,
      limit: Number(opts.last),
    });
    console.log(kleur.bold("Active agents:"));
    console.log(formatList(brief.active_agents.map((agent) => `${agent.name} ${agent.status}/${agent.presence}`)));
    console.log(kleur.bold("Open tasks:"));
    console.log(formatList(brief.open_tasks.map((task) => `#${task.id} ${task.title}`)));
    console.log(kleur.bold("Blocked tasks:"));
    console.log(formatList(brief.blocked_tasks.map((task) => `#${task.id} ${task.title}${task.blocked_reason ? `: ${task.blocked_reason}` : ""}`)));
    console.log(kleur.bold("Stale tasks:"));
    console.log(formatList(brief.stale_tasks.map((task) => `#${task.id} ${task.title}`)));
    console.log(kleur.bold("Recent decisions:"));
    console.log(formatList(brief.recent_decisions.map((decision) => `#${decision.id} ${decision.decision}`)));
    console.log(kleur.bold("Pinned memories:"));
    console.log(formatList(brief.pinned_memories.map((memory) => `#${memory.id} [${memory.kind}] ${memory.content}`)));
    console.log(kleur.bold("Recent memories:"));
    console.log(formatList(brief.recent_memories.map((memory) => `#${memory.id} [${memory.kind}] ${memory.content}`)));
    console.log(kleur.bold("Recent messages:"));
    console.log(formatList(brief.recent_messages.map((message) => `#${message.id} ${message.from_agent} -> ${message.to_agent}: ${message.content}`)));
    console.log(kleur.bold("Suggested next actions:"));
    console.log(formatList(brief.suggested_next_actions));
  });

program
  .command("board")
  .description("Show the project manager board")
  .option("-n, --last <count>", "maximum items per section", "20")
  .option("--project <name>", "project scope (use all for global)")
  .option("--area <name>", "area scope (use all for global)")
  .action((opts: { last: string; project?: string; area?: string }) => {
    const board = projectBoard({
      ...resolveScopeOptions(opts.project, opts.area),
      limit: Number(opts.last),
    });
    console.log(kleur.bold("Agents:"));
    console.log(formatList(board.agents.map((agent) => `${agent.name} ${agent.status}/${agent.presence}`)));
    console.log(kleur.bold("Open tasks:"));
    console.log(formatList(board.open_tasks.map((task) => `#${task.id} ${task.title}`)));
    console.log(kleur.bold("Active tasks:"));
    console.log(formatList(board.active_tasks.map((task) => `#${task.id} ${task.title} held=${task.claimed_by ?? "-"}`)));
    console.log(kleur.bold("Blocked tasks:"));
    console.log(formatList(board.blocked_tasks.map((task) => `#${task.id} ${task.title}${task.blocked_reason ? `: ${task.blocked_reason}` : ""}`)));
    console.log(kleur.bold("Waiting review:"));
    console.log(formatList(board.waiting_review.map((task) => `#${task.id} ${task.title}`)));
    console.log(kleur.bold("Waiting acknowledgement:"));
    console.log(formatList(board.waiting_acknowledgement.map((task) => `#${task.id} ${task.title} assigned=${task.pending_assignee ?? task.claimed_by ?? "-"}`)));
    console.log(kleur.bold("Scope conflicts:"));
    console.log(formatList(board.scope_conflicts.map((row) => `#${row.task_id} ${row.title} overlaps #${row.conflicts[0]?.task_id}`)));
    console.log(kleur.bold("Pinned risks:"));
    console.log(formatList(board.pinned_risks.map((memory) => `#${memory.id} ${memory.content}`)));
    console.log(kleur.bold("Pinned handoffs:"));
    console.log(formatList(board.pinned_handoffs.map((memory) => `#${memory.id} ${memory.content}`)));
    console.log(kleur.bold("Suggested next actions:"));
    console.log(formatList(board.suggested_next_actions));
  });

program
  .command("final-report")
  .description("Generate a merge-readiness report from tasks")
  .option("--project <name>", "project scope (use all for global)")
  .option("--area <name>", "area scope (use all for global)")
  .action((opts: { project?: string; area?: string }) => {
    const report = finalReport(resolveScopeOptions(opts.project, opts.area));
    console.log(`Implemented:\n${formatList(report.implemented)}`);
    console.log(`Not implemented:\n${formatList(report.not_implemented)}`);
    console.log(`Known risks:\n${formatList(report.known_risks)}`);
    console.log(`Tests passed:\n${formatList(report.tests_passed)}`);
    console.log(`Test evidence:\n${formatList(report.test_results.map((row) => `#${row.id} [${row.status}] ${row.command}${row.output_summary ? ` - ${row.output_summary}` : ""}`))}`);
    console.log(`Manual tests needed:\n${formatList(report.manual_tests_needed)}`);
    console.log(`Safe to commit: ${report.safe_to_commit ? "yes" : "no"}`);
    console.log(`Safe to push: ${report.safe_to_push ? "yes" : "no"}`);
    console.log("Safe to deploy: no unless user approves");
  });

program
  .command("resume <agent>")
  .description("Resume delivery to this agent")
  .action((agent: string) => {
    setPaused(agent, false);
    console.log(kleur.green(`resumed ${agent}`));
  });

program
  .command("register")
  .description("Manually register an agent name (mostly for testing)")
  .requiredOption("--name <name>")
  .option("--capabilities <list>", "comma-separated tags", "")
  .option("--role <role>", "agent role (pm, worker, verifier, reviewer, listener)")
  .option("--weight <n>", "routing weight for ask_best", "0")
  .option("--project <name>", "project scope")
  .option("--area <name>", "area scope")
  .option("--replace", "take over the name if already held")
  .action((opts: { name: string; capabilities: string; role?: string; weight: string; project?: string; area?: string; replace?: boolean }) => {
    const caps = opts.capabilities
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const a = register({
      name: opts.name,
      capabilities: caps,
      replace: opts.replace,
      role: opts.role,
      routing_weight: Number(opts.weight),
      project: opts.project,
      area: opts.area,
    });
    console.log(`${kleur.green("registered")} ${a.name}`);
  });

program
  .command("poll-inbox")
  .description("Used by the Claude Code Stop hook — emits a block-decision when messages are pending or session is in listener mode")
  .requiredOption("--agent <name>", "the agent name to poll for")
  .option("--session <id>", "Claude Code session id (enables listener-mode auto-resume)")
  .action(async (opts: { agent: string; session?: string }) => {
    await pollInbox(opts.agent, opts.session);
  });

program
  .command("mark-listening")
  .description("Record that a Claude Code session is in listener mode (used by /listen)")
  .requiredOption("--session <id>", "Claude Code session id")
  .requiredOption("--agent <name>", "agent name this session is listening as")
  .action((opts: { session: string; agent: string }) => {
    markListening(opts.session, opts.agent);
    console.log(`marked session ${opts.session} as listener for '${opts.agent}'`);
  });

program
  .command("unmark-listening")
  .description("Remove the listener marker for a session (used when /listen exits)")
  .requiredOption("--session <id>", "Claude Code session id")
  .action((opts: { session: string }) => {
    unmarkListening(opts.session);
    console.log(`unmarked session ${opts.session}`);
  });

program
  .command("install-hook")
  .description("Install a Claude Code Stop hook that auto-delivers inbox on each turn end")
  .requiredOption("--agent <name>", "agent name to poll for")
  .action((opts: { agent: string }) => {
    installHook(opts.agent);
  });

program
  .command("uninstall-hook")
  .description("Remove the agent-bus Stop hook from ~/.claude/settings.json")
  .action(() => {
    uninstallHook();
  });

program
  .command("listen-prompt <agent>")
  .description("Print the listener-mode prompt for any MCP-speaking agent (Codex, Claude Desktop, Cursor, etc.)")
  .action((agent: string) => {
    process.stdout.write(listenPrompt(agent));
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(kleur.red("error:"), err instanceof Error ? err.message : err);
  process.exit(1);
});

function formatList(values: string[]): string {
  return values.length === 0 ? "  - none" : values.map((value) => `  - ${value}`).join("\n");
}
