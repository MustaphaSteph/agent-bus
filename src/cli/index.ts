#!/usr/bin/env node
import { Command } from "commander";
import kleur from "kleur";
import {
  ack,
  acknowledgeTask,
  askTeam,
  cancelTask,
  checkScopeConflicts,
  delegate,
  delegateTeam,
  directory,
  finalReport,
  handoffTask,
  getMessage,
  getTask,
  inbox,
  inboxPreviews,
  inboxStatus,
  listDecisions,
  listMemories,
  listTaskEvents,
  listTestResults,
  AREA_WILDCARD,
  pinMemory,
  projectBoard,
  PROJECT_WILDCARD,
  recentMessages,
  replyThread,
  register,
  recordDecision,
  recordTaskEvent,
  recordTestResult,
  remember,
  reviewGate,
  send,
  sendTeam,
  setAgentStatus,
  setPaused,
  sessionBrief,
  sleepAgent,
  submitReview,
  wakeAgent,
  whois,
  waitForAgents,
  waitForTask,
  taskResult,
  teamBoard,
  TEAM_WILDCARD,
  updateTask,
  messageStatus,
  whyNoReply,
  type MessagePriority,
} from "../bus.js";
import { dbPath } from "../util/paths.js";
import { packageVersion } from "../util/package-info.js";
import {
  configuredAreas,
  deriveScope,
  scopeConfigPath,
  writeScopeConfig,
} from "../util/project.js";
import { parseSince, printActivity, printCockpit, printNow } from "./coordination.js";
import { formatMessage } from "./format.js";
import { installHook, uninstallHook } from "./install-hook.js";
import { doneTasks, kanban, taskDetail } from "./kanban.js";
import { listenPrompt } from "./listen-prompt.js";
import { markListening, unmarkListening } from "./listener-marker.js";
import { pollInbox } from "./poll-inbox.js";
import { resolveScopeOptions, scopeBanner } from "./project-scope.js";
import { teamChat } from "./team-chat.js";
import { tasks } from "./tasks.js";
import { startUi } from "./ui.js";
import { watch } from "./watch.js";

const program = new Command();
program
  .name("agent-bus")
  .description("Local message bus for Claude Code, Codex and other MCP agents.")
  .version(packageVersion());

function normalizeTeamOption(value: string | undefined): string | undefined {
  return value === "all" ? TEAM_WILDCARD : value;
}

function phaseImpliesWorking(phase: string): boolean {
  const normalized = phase.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return ["planning", "editing", "implementation", "testing", "test", "qa", "verification", "verify", "review", "reviewing"].includes(normalized);
}

function moveTaskPhase(taskId: number, by: string, phase: string, message?: string): void {
  const task = getTask(taskId);
  const nextState =
    phaseImpliesWorking(phase) && (task.state === "claimed" || task.state === "blocked")
      ? "working"
      : undefined;
  updateTask({
    agent: by,
    task_id: taskId,
    state: nextState as never,
    phase,
  });
  const event = recordTaskEvent({
    by_agent: by,
    task_id: taskId,
    event_type: "phase",
    phase,
    message: message ?? `phase -> ${phase}`,
  });
  console.log(`${kleur.green("moved")} task #${taskId} phase=${phase} event #${event.id}`);
}

function completeTask(taskId: number, by: string, result: string): void {
  const task = getTask(taskId);
  if (task.state === "claimed") {
    updateTask({ agent: by, task_id: taskId, state: "working", phase: task.phase ?? "finishing" });
  }
  const done = updateTask({
    agent: by,
    task_id: taskId,
    state: "completed",
    phase: "done",
    result,
    final_answer: result,
  });
  const event = recordTaskEvent({
    by_agent: by,
    task_id: taskId,
    event_type: "result",
    phase: "done",
    message: result,
  });
  console.log(`${kleur.green("completed")} task #${done.id} event #${event.id}`);
}

program
  .command("watch")
  .description("Live tail messages for the current project")
  .option("--interval <ms>", "poll interval in ms", "250")
  .option("--project <name>", "project scope (default current repo; use 'all' for global)")
  .option("--area <name>", "area scope from .agent-bus.json (use 'all' for every area)")
  .option("--team <name>", "team scope (use 'all' for every team)")
  .option("--global", "show every project and area")
  .action(async (opts: { interval: string; project?: string; area?: string; team?: string; global?: boolean }) => {
    const scope = opts.global === true ? { project: "all", area: "all", team: "all" } : { project: opts.project, area: opts.area, team: opts.team };
    const resolved = resolveScopeOptions(scope.project, scope.area, scope.team);
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
  .option("--team <name>", "team scope (use 'all' for every team)")
  .action((opts: { last: string; project?: string; area?: string; team?: string }) => {
    const scope = resolveScopeOptions(opts.project, opts.area, opts.team);
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
  .command("team-chat")
  .description("Show, send, or watch messages scoped to one team")
  .requiredOption("--team <name>", "team scope")
  .option("--project <name>", "project scope (default current repo; use 'all' for global)")
  .option("--area <name>", "area scope from .agent-bus.json (use 'all' for every area)")
  .option("-n, --last <count>", "how many recent messages to show", "50")
  .option("--watch", "keep running after the snapshot and print new messages")
  .option("--interval <ms>", "watch poll interval in ms", "250")
  .option("--from <agent>", "sender agent when sending a message")
  .option("--message <text>", "message body to send before showing chat")
  .option("--thread <id>", "existing thread id for the sent message")
  .option("--include-self", "also send to the sender when sending")
  .option("--show-log", "after sending, also print the recent team chat snapshot")
  .argument("[message]", "message body to send before showing chat")
  .action(async (message: string | undefined, opts: {
    team: string;
    project?: string;
    area?: string;
    last: string;
    watch?: boolean;
    interval: string;
    from?: string;
    message?: string;
    thread?: string;
    includeSelf?: boolean;
    showLog?: boolean;
  }) => {
    await teamChat(message, opts);
  });

program
  .command("ui")
  .description("Start the local Agent Bus Cockpit web UI")
  .option("--host <host>", "host to bind", "127.0.0.1")
  .option("--port <port>", "port to bind", "8787")
  .option("--project <name>", "project scope (default current repo; use 'all' for global)")
  .option("--area <name>", "area scope from .agent-bus.json (use 'all' for every area)")
  .option("--team <name>", "team scope (use 'all' for every team)")
  .option("--no-open", "do not open the browser automatically")
  .action(async (opts: { host: string; port: string; project?: string; area?: string; team?: string; open?: boolean }) => {
    await startUi({
      host: opts.host,
      port: Number(opts.port),
      project: opts.project,
      area: opts.area,
      team: opts.team,
      open: opts.open,
    });
  });

program
  .command("activity")
  .description("Show a chronological activity timeline for a project, area, or team")
  .option("-n, --last <count>", "maximum activity rows", "50")
  .option("--since <time>", "ms epoch or duration like 30m, 2h, 1d")
  .option("--project <name>", "project scope (default current repo; use 'all' for global)")
  .option("--area <name>", "area scope from .agent-bus.json (use 'all' for every area)")
  .option("--team <name>", "team scope (use 'all' for every team)")
  .action((opts: { last: string; since?: string; project?: string; area?: string; team?: string }) => {
    printActivity({
      ...resolveScopeOptions(opts.project, opts.area, opts.team),
      limit: Number(opts.last),
      sinceMs: parseSince(opts.since),
    });
  });

program
  .command("cockpit")
  .description("Show coordinator next actions for a project, area, or team")
  .option("-n, --last <count>", "maximum items per section", "20")
  .option("--project <name>", "project scope (default current repo; use 'all' for global)")
  .option("--area <name>", "area scope from .agent-bus.json (use 'all' for every area)")
  .option("--team <name>", "team scope (use 'all' for every team)")
  .action((opts: { last: string; project?: string; area?: string; team?: string }) => {
    printCockpit({
      ...resolveScopeOptions(opts.project, opts.area, opts.team),
      limit: Number(opts.last),
    });
  });

program
  .command("now")
  .description("Update an agent's current status and optional task phase/progress")
  .requiredOption("--agent <name>", "agent name")
  .option("--task <id>", "active task id")
  .option("--phase <name>", "task phase, e.g. planning, editing, testing, review")
  .option("--note <text>", "progress note to record on the task")
  .option("--status <status>", "idle, working, blocked, waiting_review, or sleeping")
  .action((opts: { agent: string; task?: string; phase?: string; note?: string; status?: string }) => {
    printNow({
      agent: opts.agent,
      taskId: opts.task ? Number(opts.task) : undefined,
      phase: opts.phase,
      note: opts.note,
      status: opts.status,
    });
  });

program
  .command("whois")
  .description("List registered agents")
  .option("--project <name>", "project scope (default current repo; use 'all' for global)")
  .option("--area <name>", "area scope from .agent-bus.json (use 'all' for every area)")
  .option("--team <name>", "team scope")
  .action((opts: { project?: string; area?: string; team?: string }) => {
    const scope = resolveScopeOptions(opts.project, opts.area);
    const banner = scopeBanner(scope);
    if (banner) console.log(banner);
    const agents = directory({ ...scope, team: opts.team });
    if (agents.length === 0) {
      console.log(kleur.gray("(no agents registered)"));
      return;
    }
    for (const a of agents) {
      const caps = a.capabilities.length > 0 ? ` [${a.capabilities.join(", ")}]` : "";
      const projectChip = a.project ? ` {${a.project}}` : " {no-project}";
      const areaChip = a.area ? `/${a.area}` : "";
      const teamChip = a.team ? ` team=${a.team}` : "";
      const role = a.role ? ` role=${a.role}` : "";
      const active = a.active_task_id ? ` task=#${a.active_task_id}` : "";
      const paused = a.paused ? kleur.red(" (paused)") : "";
      console.log(`${kleur.bold(a.name)}${kleur.gray(caps)}${kleur.gray(projectChip + areaChip + teamChip + role + active)}${paused}  ${kleur.gray(`${a.status}/${a.presence}, seen ${a.age_s}s ago`)}`);
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
  .option("--areas <list>", "optional comma-separated area names")
  .option("--force", "overwrite existing config")
  .action((opts: { project?: string; areas?: string; force?: boolean }) => {
    const existing = scopeConfigPath();
    if (existing && opts.force !== true) {
      throw new Error(`${existing} already exists; pass --force to overwrite`);
    }
    const project = opts.project ?? deriveScope().project ?? "project";
    const areas = Object.fromEntries(
      (opts.areas ?? "")
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

const teamCommand = program
  .command("team")
  .description("Team topology helpers");

teamCommand
  .command("init <areas...>")
  .description("Create .agent-bus.json with neutral area scopes")
  .option("--project <name>", "project name (default derived from cwd)")
  .action((areas: string[], opts: { project?: string }) => {
    const project = opts.project ?? deriveScope().project ?? "project";
    const path = writeScopeConfig({
      project,
      areas: Object.fromEntries(areas.map((area) => [area, [`${area}/**`]])),
      routing: { default: "same-area", managerAreas: ["pm"] },
      hooks: {},
    });
    console.log(`${kleur.green("created")} ${path}`);
    console.log(`project=${project}`);
    console.log(`areas=${areas.join(", ") || "-"}`);
    console.log("Agent names, roles, and task strategy are controlled by your sessions.");
  });

teamCommand
  .command("init-folder")
  .description("Create a neutral .agent-bus.json for one separated project folder")
  .option("--project <name>", "unique project name for this folder (default derived from cwd)")
  .option("--area <name>", "area/lane for this folder", "app")
  .option("--force", "overwrite existing .agent-bus.json")
  .action((opts: { project?: string; area: string; force?: boolean }) => {
    const existing = scopeConfigPath();
    if (existing && opts.force !== true) {
      throw new Error(`${existing} already exists; pass --force to overwrite`);
    }
    const project = opts.project ?? deriveScope().project ?? "project";
    const area = opts.area.trim() || "app";
    const path = writeScopeConfig({
      project,
      area,
      routing: { default: "same-area", managerAreas: ["pm"] },
      hooks: {},
    });
    console.log(`${kleur.green("created")} ${path}`);
    console.log("");
    console.log(kleur.bold("Project scope:"));
    console.log(`  project=${project} area=${area}`);
    console.log("");
    console.log("Open any agent session in this folder and register it with this project/area.");
    console.log("Use task modes, file scopes, and review gates according to your own workflow.");
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
  .option("--team <name>", "only receive messages for this team (use 'all' for every team)")
  .option("--claim-s <seconds>", "claim window before redelivery", "300")
  .option("--wait-s <seconds>", "blocking inbox wait per poll", "110")
  .action(async (opts: { agent: string; team?: string; claimS: string; waitS: string }) => {
    const team = normalizeTeamOption(opts.team);
    console.log(kleur.bold(`listening as ${opts.agent}${team ? ` team=${team}` : ""}`));
    for (;;) {
      const messages = await inbox({
        agent: opts.agent,
        team,
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
  .command("inbox-status")
  .description("Show unread, claimed/in-flight, and recent delivered inbox messages without consuming them")
  .requiredOption("--agent <name>", "agent inbox to inspect")
  .option("--team <name>", "only inspect messages for this team (use 'all' for every team)")
  .option("-n, --last <count>", "maximum rows per section", "20")
  .option("--json", "print raw JSON")
  .action((opts: { agent: string; team?: string; last: string; json?: boolean }) => {
    const status = inboxStatus({ agent: opts.agent, team: normalizeTeamOption(opts.team), limit: Number(opts.last) });
    if (opts.json === true) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    console.log(status.summary);
    console.log(kleur.bold("Unread:"));
    console.log(formatList(status.unread.map((message) => `#${message.id} ${message.from_agent}: ${message.content}`)));
    console.log(kleur.bold("In flight:"));
    console.log(formatList(status.in_flight.map((message) => `#${message.id} claimed_by=${message.claimed_by ?? "-"} until=${message.claim_deadline ?? "-"}`)));
    console.log(kleur.bold("Delivered recent:"));
    console.log(formatList(status.delivered_recent.map((message) => `#${message.id} [${message.status}] ${message.from_agent}: ${message.content}`)));
  });

program
  .command("inbox-previews")
  .description("Preview unread inbox messages without consuming them or printing full bodies")
  .requiredOption("--agent <name>", "agent inbox to inspect")
  .option("--team <name>", "only inspect messages for this team (use 'all' for every team)")
  .option("--since-id <id>", "only preview messages with id > this")
  .option("-n, --last <count>", "maximum previews", "20")
  .option("--wait-s <seconds>", "block up to N seconds for a message")
  .option("--preview-chars <count>", "max content preview chars per message", "300")
  .option("--json", "print raw JSON")
  .action(async (opts: { agent: string; team?: string; sinceId?: string; last: string; waitS?: string; previewChars: string; json?: boolean }) => {
    const previews = await inboxPreviews({
      agent: opts.agent,
      team: normalizeTeamOption(opts.team),
      since_id: opts.sinceId ? Number(opts.sinceId) : undefined,
      limit: Number(opts.last),
      wait_s: opts.waitS ? Number(opts.waitS) : undefined,
      preview_chars: Number(opts.previewChars),
    });
    if (opts.json === true) {
      console.log(JSON.stringify(previews, null, 2));
      return;
    }
    console.log(formatList(previews.map((message) => `#${message.id} ${message.from_agent} ${message.kind} len=${message.content_length}${message.truncated ? " truncated" : ""}: ${message.content_preview}`)));
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
  .option("--team <name>", "team scope (use 'all' for every team)")
  .option("--mode <mode>", "filter by task mode")
  .option("--manager-reviewed", "only reviewed tasks")
  .action(async (opts: { state?: string; all?: boolean; watch?: boolean; interval: string; project?: string; area?: string; team?: string; requiredCapability?: string; mode?: string; managerReviewed?: boolean }) => {
    await tasks({
      state: opts.state,
      all: opts.all,
      watch: opts.watch,
      intervalMs: Number(opts.interval),
      requiredCapability: opts.requiredCapability,
      mode: opts.mode,
      managerReviewed: opts.managerReviewed,
      ...resolveScopeOptions(opts.project, opts.area, opts.team),
    });
  });

program
  .command("kanban")
  .description("Show tasks grouped as a Kanban board")
  .option("--all", "include completed, failed, and canceled columns")
  .option("--done", "show only completed, failed, and canceled columns")
  .option("--compact", "print shorter task rows")
  .option("--state-columns", "show raw task state columns instead of workflow lanes")
  .option("--watch", "keep refreshing the board")
  .option("--interval <ms>", "watch refresh interval in ms", "2000")
  .option("-n, --last <count>", "maximum tasks to load", "200")
  .option("--project <name>", "project scope (default current repo; use 'all' for global)")
  .option("--area <name>", "area scope from .agent-bus.json (use 'all' for every area)")
  .option("--team <name>", "team scope (use 'all' for every team)")
  .action(async (opts: { all?: boolean; done?: boolean; compact?: boolean; stateColumns?: boolean; watch?: boolean; interval: string; last: string; project?: string; area?: string; team?: string }) => {
    await kanban({
      all: opts.all,
      done: opts.done,
      compact: opts.compact,
      stateColumns: opts.stateColumns,
      watch: opts.watch,
      intervalMs: Number(opts.interval),
      limit: Number(opts.last),
      ...resolveScopeOptions(opts.project, opts.area, opts.team),
    });
  });

program
  .command("done")
  .description("List completed, failed, or canceled tasks")
  .option("--state <state>", "completed, failed, or canceled")
  .option("-n, --last <count>", "maximum tasks to show", "100")
  .option("--project <name>", "project scope (default current repo; use 'all' for global)")
  .option("--area <name>", "area scope from .agent-bus.json (use 'all' for every area)")
  .option("--team <name>", "team scope (use 'all' for every team)")
  .action((opts: { state?: string; last: string; project?: string; area?: string; team?: string }) => {
    doneTasks({
      state: opts.state,
      limit: Number(opts.last),
      ...resolveScopeOptions(opts.project, opts.area, opts.team),
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
  .command("send")
  .description("Send a direct message to one agent")
  .requiredOption("--to <agent>", "recipient agent")
  .option("--from <agent>", "sender name", "human")
  .option("--message <text>", "message body")
  .option("--thread <id>", "existing thread id")
  .option("--priority <priority>", "low, normal, high, or urgent")
  .option("--project <name>", "sender project scope (default current repo; use all for global)")
  .option("--area <name>", "sender area scope (use all for global)")
  .option("--team <name>", "sender team scope")
  .argument("[message]", "message body")
  .action((messageArg: string | undefined, opts: {
    to: string;
    from: string;
    message?: string;
    thread?: string;
    priority?: string;
    project?: string;
    area?: string;
    team?: string;
  }) => {
    const message = opts.message ?? messageArg;
    if (message === undefined) {
      throw new Error("send requires a message body via --message or positional argument");
    }
    const scope = resolveScopeOptions(opts.project, opts.area, opts.team);
    register({
      name: opts.from,
      capabilities: ["cli"],
      replace: true,
      project: scope.project === PROJECT_WILDCARD ? null : (scope.project ?? null),
      area: scope.area === AREA_WILDCARD ? null : (scope.area ?? null),
      team: scope.team === TEAM_WILDCARD ? null : (scope.team ?? null),
    });
    const sent = send({
      from: opts.from,
      to: opts.to,
      content: message,
      thread_id: opts.thread,
      priority: opts.priority as MessagePriority | undefined,
    });
    console.log(formatMessage(sent));
  });

program
  .command("send-team")
  .description("Send one message to every active agent in a team")
  .requiredOption("--from <agent>", "sender agent")
  .requiredOption("--team <team>", "team name")
  .option("--project <name>", "project scope (use all for global)")
  .option("--area <name>", "area scope (use all for global)")
  .option("--thread <id>", "existing thread id")
  .option("--include-self", "also send to the sender")
  .argument("<message>", "message body")
  .action((message: string, opts: { from: string; team: string; project?: string; area?: string; thread?: string; includeSelf?: boolean }) => {
    const sent = sendTeam({
      from: opts.from,
      team: opts.team,
      content: message,
      thread_id: opts.thread,
      include_self: opts.includeSelf,
      ...resolveScopeOptions(opts.project, opts.area),
    });
    console.log(`${kleur.green("sent")} ${sent.length} team message(s)`);
    for (const row of sent) console.log(formatMessage(row));
  });

program
  .command("ask-team")
  .description("Ask the best active member of a team")
  .requiredOption("--from <agent>", "sender agent")
  .requiredOption("--team <team>", "team name")
  .option("--capability <name>", "required capability")
  .option("--role <role>", "required role")
  .option("--timeout <seconds>", "seconds to wait", "60")
  .option("--project <name>", "project scope (use all for global)")
  .option("--area <name>", "area scope (use all for global)")
  .argument("<question>", "question body")
  .action(async (question: string, opts: { from: string; team: string; capability?: string; role?: string; timeout: string; project?: string; area?: string }) => {
    const answer = await askTeam({
      from: opts.from,
      team: opts.team,
      question,
      capability: opts.capability,
      role: opts.role,
      timeout_s: Number(opts.timeout),
      ...resolveScopeOptions(opts.project, opts.area),
    });
    console.log(formatMessage(answer));
  });

program
  .command("delegate")
  .description("Create a task, assign it, notify the assignee, and require acknowledgement by default")
  .requiredOption("--from <agent>", "coordinator/requester agent")
  .requiredOption("--to <agent>", "assignee agent")
  .requiredOption("--title <text>", "task title")
  .option("--description <text>", "task description")
  .option("--mode <mode>", "investigate_only, propose_patch, edit_files, or test_only")
  .option("--expect <text>", "expected output")
  .option("--priority <n>", "task priority", "0")
  .option("--scope <list>", "comma-separated file scope")
  .option("--edit-scope <list>", "comma-separated edit scope")
  .option("--read-scope <list>", "comma-separated read scope")
  .option("--capability <name>", "required capability")
  .option("--deadline <ms>", "deadline as ms epoch")
  .option("--checkin <ms>", "check-in time as ms epoch")
  .option("--cwd <path>", "working directory")
  .option("--thread <id>", "existing thread id")
  .option("--no-ack", "do not require acknowledgement")
  .option("--review", "require approved review before completion")
  .option("--allow-pending-agent", "reserve for an agent that is not registered yet")
  .option("--allow-conflicts", "allow overlapping edit scopes")
  .option("--project <name>", "project scope (use all for global)")
  .option("--area <name>", "area scope (use all for global)")
  .option("--team <name>", "team scope")
  .action((opts: {
    from: string;
    to: string;
    title: string;
    description?: string;
    mode?: string;
    expect?: string;
    priority: string;
    scope?: string;
    editScope?: string;
    readScope?: string;
    capability?: string;
    deadline?: string;
    checkin?: string;
    cwd?: string;
    thread?: string;
    ack?: boolean;
    review?: boolean;
    allowPendingAgent?: boolean;
    allowConflicts?: boolean;
    project?: string;
    area?: string;
    team?: string;
  }) => {
    const scope = resolveScopeOptions(opts.project, opts.area);
    const result = delegate({
      from: opts.from,
      to_agent: opts.to,
      title: opts.title,
      description: opts.description,
      mode: opts.mode as never,
      expected_output: opts.expect ?? null,
      priority: Number(opts.priority),
      file_scope: opts.scope ? splitList(opts.scope) : undefined,
      edit_scope: opts.editScope ? splitList(opts.editScope) : undefined,
      read_scope: opts.readScope ? splitList(opts.readScope) : undefined,
      required_capability: opts.capability ?? null,
      deadline_at: opts.deadline ? Number(opts.deadline) : null,
      checkin_at: opts.checkin ? Number(opts.checkin) : null,
      cwd: opts.cwd,
      thread_id: opts.thread,
      ack_required: opts.ack !== false,
      review_required: opts.review === true,
      allow_pending_agent: opts.allowPendingAgent,
      allow_conflicts: opts.allowConflicts,
      project: scope.project === PROJECT_WILDCARD ? null : (scope.project ?? undefined),
      area: scope.area === AREA_WILDCARD ? null : (scope.area ?? undefined),
      team: opts.team ?? undefined,
    });
    console.log(`${kleur.green("delegated")} task #${result.task.id} to ${opts.to}`);
    console.log(`state=${result.task.state} pending=${result.pending ? "yes" : "no"} thread=${result.task.thread_id}`);
    console.log(kleur.bold("Next:"));
    console.log(formatList(result.suggested_next_actions));
  });

program
  .command("delegate-team")
  .description("Create tracked tasks for active members of a team and show skipped recipients")
  .requiredOption("--from <agent>", "coordinator/requester agent")
  .requiredOption("--team <name>", "team to delegate to")
  .requiredOption("--title <text>", "task title")
  .option("--description <text>", "task description")
  .option("--mode <mode>", "investigate_only, propose_patch, edit_files, or test_only")
  .option("--expect <text>", "expected output")
  .option("--priority <n>", "task priority", "0")
  .option("--scope <list>", "comma-separated file scope")
  .option("--edit-scope <list>", "comma-separated edit scope")
  .option("--read-scope <list>", "comma-separated read scope")
  .option("--capability <name>", "only delegate to active team members with this capability")
  .option("--required-capability <name>", "capability required to claim each created task")
  .option("--role <name>", "only delegate to active team members with this role")
  .option("--deadline <ms>", "deadline as ms epoch")
  .option("--checkin <ms>", "check-in time as ms epoch")
  .option("--cwd <path>", "working directory")
  .option("--thread <id>", "existing thread id to share across all tasks")
  .option("--max <n>", "maximum tasks to create", "50")
  .option("--include-self", "include sender if they are in the target team")
  .option("--no-ack", "do not require acknowledgement")
  .option("--review", "require approved review before completion")
  .option("--allow-conflicts", "allow overlapping edit scopes")
  .option("--project <name>", "project scope (use all for global)")
  .option("--area <name>", "area scope (use all for global)")
  .action((opts: {
    from: string;
    team: string;
    title: string;
    description?: string;
    mode?: string;
    expect?: string;
    priority: string;
    scope?: string;
    editScope?: string;
    readScope?: string;
    capability?: string;
    requiredCapability?: string;
    role?: string;
    deadline?: string;
    checkin?: string;
    cwd?: string;
    thread?: string;
    max: string;
    includeSelf?: boolean;
    ack?: boolean;
    review?: boolean;
    allowConflicts?: boolean;
    project?: string;
    area?: string;
  }) => {
    const scope = resolveScopeOptions(opts.project, opts.area);
    const result = delegateTeam({
      from: opts.from,
      team: opts.team,
      title: opts.title,
      description: opts.description,
      mode: opts.mode as never,
      expected_output: opts.expect ?? null,
      priority: Number(opts.priority),
      file_scope: opts.scope ? splitList(opts.scope) : undefined,
      edit_scope: opts.editScope ? splitList(opts.editScope) : undefined,
      read_scope: opts.readScope ? splitList(opts.readScope) : undefined,
      capability: opts.capability,
      required_capability: opts.requiredCapability ?? null,
      role: opts.role as never,
      deadline_at: opts.deadline ? Number(opts.deadline) : null,
      checkin_at: opts.checkin ? Number(opts.checkin) : null,
      cwd: opts.cwd,
      thread_id: opts.thread,
      max_recipients: Number(opts.max),
      include_self: opts.includeSelf === true,
      ack_required: opts.ack !== false,
      review_required: opts.review === true,
      allow_conflicts: opts.allowConflicts,
      project: scope.project === PROJECT_WILDCARD ? null : (scope.project ?? undefined),
      area: scope.area === AREA_WILDCARD ? null : (scope.area ?? undefined),
    });
    console.log(`${kleur.green("delegated")} ${result.delegated_count}/${result.expected_count} tracked task(s) to team ${result.team}`);
    console.log(`thread=${result.thread_id}`);
    console.log(kleur.bold("Tasks:"));
    console.log(formatList(result.tasks.map((entry) => `#${entry.task.id} ${entry.task.claimed_by ?? entry.task.pending_assignee ?? "-"} ${entry.task.title}`)));
    if (result.skipped.length > 0) {
      console.log(kleur.bold("Skipped:"));
      console.log(formatList(result.skipped.map((entry) => `${entry.agent} ${entry.reason} ${entry.presence}/${entry.age_s}s`)));
    }
    console.log(kleur.bold("Next:"));
    console.log(formatList(result.suggested_next_actions));
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
  .command("task-event <task-id>")
  .description("Record or list task progress/event rows")
  .option("--by <agent>", "agent recording the event")
  .option("--type <type>", "note, phase, progress, log, result, or cancel", "note")
  .option("--message <text>", "event message")
  .option("--phase <phase>", "optional phase; also updates task.phase")
  .option("--metadata <json>", "optional JSON metadata object")
  .option("--list", "list events instead of recording")
  .option("-n, --last <count>", "how many events to list", "50")
  .option("--project <name>", "project scope (use all for global)")
  .option("--area <name>", "area scope (use all for global)")
  .action((taskId: string, opts: { by?: string; type: string; message?: string; phase?: string; metadata?: string; list?: boolean; last: string; project?: string; area?: string }) => {
    if (opts.list === true) {
      const rows = listTaskEvents({
        ...resolveScopeOptions(opts.project, opts.area),
        task_id: Number(taskId),
        limit: Number(opts.last),
      });
      console.log(formatList(rows.map((row) => `#${row.id} [${row.event_type}] ${row.by_agent}: ${row.message}${row.phase ? ` phase=${row.phase}` : ""}`)));
      return;
    }
    if (!opts.by || !opts.message) throw new Error("--by and --message are required unless --list is used");
    const metadata = opts.metadata ? parseJsonObject(opts.metadata, "--metadata") : undefined;
    const row = recordTaskEvent({
      by_agent: opts.by,
      task_id: Number(taskId),
      event_type: opts.type as never,
      message: opts.message,
      phase: opts.phase ?? null,
      metadata,
    });
    console.log(`${kleur.green("recorded")} task event #${row.id}`);
  });

program
  .command("task-start <task-id>")
  .description("Move a claimed/blocked task into Doing with a phase note")
  .requiredOption("--by <agent>", "agent moving the task")
  .option("--phase <phase>", "phase to set", "working")
  .option("--message <text>", "event message")
  .action((taskId: string, opts: { by: string; phase: string; message?: string }) => {
    moveTaskPhase(Number(taskId), opts.by, opts.phase, opts.message ?? "started work");
  });

program
  .command("task-phase <task-id> <phase>")
  .description("Set task phase and record a phase event")
  .requiredOption("--by <agent>", "agent moving the task")
  .option("--message <text>", "event message")
  .action((taskId: string, phase: string, opts: { by: string; message?: string }) => {
    moveTaskPhase(Number(taskId), opts.by, phase, opts.message);
  });

program
  .command("task-testing <task-id>")
  .description("Move a task into the Testing Kanban lane")
  .requiredOption("--by <agent>", "agent moving the task")
  .option("--message <text>", "event message", "testing started")
  .action((taskId: string, opts: { by: string; message: string }) => {
    moveTaskPhase(Number(taskId), opts.by, "testing", opts.message);
  });

program
  .command("task-done <task-id>")
  .description("Complete a task and record final result evidence")
  .requiredOption("--by <agent>", "agent completing the task")
  .requiredOption("--result <text>", "final answer or result summary")
  .action((taskId: string, opts: { by: string; result: string }) => {
    completeTask(Number(taskId), opts.by, opts.result);
  });

program
  .command("task <task-id>")
  .description("Show readable task details, evidence, and thread messages")
  .option("-n, --last <count>", "maximum related rows per section", "50")
  .option("--json", "print raw JSON")
  .action((taskId: string, opts: { last: string; json?: boolean }) => {
    taskDetail(Number(taskId), Number(opts.last), opts.json === true);
  });

program
  .command("task-result <task-id>")
  .description("Show a task with event log, tests, memories, and thread messages")
  .option("-n, --last <count>", "maximum related rows per section", "50")
  .option("--json", "print raw JSON")
  .action((taskId: string, opts: { last: string; json?: boolean }) => {
    const result = taskResult(Number(taskId), Number(opts.last));
    if (opts.json === true) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(kleur.bold(`#${result.task.id} ${result.task.title}`));
    console.log(`state=${result.task.state} phase=${result.task.phase ?? "-"} holder=${result.task.claimed_by ?? "-"}`);
    console.log(kleur.bold("Events:"));
    console.log(formatList(result.events.map((row) => `#${row.id} [${row.event_type}] ${row.by_agent}: ${row.message}${row.phase ? ` phase=${row.phase}` : ""}`)));
    console.log(kleur.bold("Test evidence:"));
    console.log(formatList(result.test_results.map((row) => `#${row.id} [${row.status}] ${row.command}${row.output_summary ? ` - ${row.output_summary}` : ""}`)));
    console.log(kleur.bold("Memories:"));
    console.log(formatList(result.memories.map((row) => `#${row.id} [${row.kind}] ${row.content}`)));
    console.log(kleur.bold("Messages:"));
    console.log(formatList(result.messages.map((row) => `#${row.id} ${row.from_agent} -> ${row.to_agent}: ${row.content}`)));
  });

program
  .command("wait-task <task-id>")
  .description("Wait for a task update/event/message/test result and print latest status")
  .option("--wait-s <seconds>", "seconds to wait, max 110", "110")
  .option("--since <ms>", "activity must be newer than this ms epoch")
  .option("-n, --last <count>", "maximum related rows per section", "50")
  .option("--json", "print raw JSON")
  .action(async (taskId: string, opts: { waitS: string; since?: string; last: string; json?: boolean }) => {
    const result = await waitForTask({
      task_id: Number(taskId),
      wait_s: Number(opts.waitS),
      since_updated_at: opts.since ? Number(opts.since) : undefined,
      limit: Number(opts.last),
    });
    if (opts.json === true) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(kleur.bold(`#${result.task.id} ${result.task.title}`));
    console.log(`state=${result.task.state} holder=${result.task.claimed_by ?? "-"} timed_out=${result.timed_out ? "yes" : "no"}`);
    console.log(`latest_event=${result.latest_event ? `#${result.latest_event.id} ${result.latest_event.message}` : "-"}`);
    console.log(`latest_message=${result.latest_message ? `#${result.latest_message.id} ${result.latest_message.from_agent}: ${result.latest_message.content}` : "-"}`);
    console.log(kleur.bold("Next:"));
    console.log(formatList(result.suggested_next_actions));
  });

program
  .command("message-status <message-id>")
  .description("Diagnose one message delivery/claim/reply state")
  .option("--json", "print raw JSON")
  .action((messageId: string, opts: { json?: boolean }) => {
    const result = messageStatus({ message_id: Number(messageId) });
    if (opts.json === true) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(formatMessage(result.message));
    console.log(kleur.bold("Diagnostics:"));
    console.log(formatList(result.diagnostics));
    console.log(kleur.bold("Next:"));
    console.log(formatList(result.suggested_next_actions));
  });

program
  .command("message <message-id>")
  .description("Fetch one message by id; use --preview-chars or --no-content for large messages")
  .option("--preview-chars <count>", "return only this many content chars")
  .option("--no-content", "return metadata and a small preview, not full content")
  .option("--project <name>", "require message project scope (use all for any project)")
  .option("--area <name>", "require message area scope (use all for any area)")
  .option("--team <name>", "require message team scope (use all for any team)")
  .option("--json", "print raw JSON")
  .action((messageId: string, opts: { previewChars?: string; content?: boolean; project?: string; area?: string; team?: string; json?: boolean }) => {
    const scoped = opts.project !== undefined || opts.area !== undefined || opts.team !== undefined
      ? resolveScopeOptions(opts.project, opts.area, opts.team)
      : {};
    const result = getMessage({
      message_id: Number(messageId),
      preview_chars: opts.previewChars ? Number(opts.previewChars) : undefined,
      include_content: opts.content,
      ...scoped,
    });
    if (opts.json === true) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    const message = result.message;
    if ("content" in message) {
      console.log(formatMessage(message));
    } else {
      console.log(`#${message.id} ${message.from_agent} → ${message.to_agent} ${message.kind} [${message.status}] len=${message.content_length}${message.truncated ? " truncated" : ""}`);
      console.log(message.content_preview);
    }
    console.log(kleur.bold("Next:"));
    console.log(formatList(result.suggested_next_actions));
  });

program
  .command("why-no-reply <message-id>")
  .description("Explain why a message or ask has no reply yet")
  .option("--json", "print raw JSON")
  .action((messageId: string, opts: { json?: boolean }) => {
    const result = whyNoReply(Number(messageId));
    if (opts.json === true) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(formatMessage(result.message));
    console.log(kleur.bold("Diagnostics:"));
    console.log(formatList(result.diagnostics));
    console.log(kleur.bold("Next:"));
    console.log(formatList(result.suggested_next_actions));
  });

program
  .command("reply-thread <thread-id>")
  .description("Send a message to the last other participant in a thread")
  .requiredOption("--from <agent>", "sender agent")
  .requiredOption("--message <text>", "message body")
  .action((threadId: string, opts: { from: string; message: string }) => {
    const message = replyThread({ from: opts.from, thread_id: threadId, message: opts.message });
    console.log(formatMessage(message));
  });

program
  .command("cancel-task <task-id>")
  .description("Cancel a non-terminal task and notify the other side")
  .requiredOption("--agent <name>", "requester or current holder")
  .option("--reason <text>", "why the task was canceled")
  .action((taskId: string, opts: { agent: string; reason?: string }) => {
    const result = cancelTask({
      agent: opts.agent,
      task_id: Number(taskId),
      reason: opts.reason ?? null,
    });
    console.log(`${kleur.yellow("canceled")} task #${result.task.id}${result.event ? ` event #${result.event.id}` : ""}`);
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
  .option("--team <name>", "team scope")
  .action((opts: { last: string; project?: string; area?: string; team?: string }) => {
    const board = projectBoard({
      ...resolveScopeOptions(opts.project, opts.area),
      team: opts.team,
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
  .command("team-board")
  .description("Show the manager board for one team")
  .requiredOption("--team <team>", "team name")
  .option("-n, --last <count>", "maximum items per section", "20")
  .option("--project <name>", "project scope (use all for global)")
  .option("--area <name>", "area scope (use all for global)")
  .action((opts: { team: string; last: string; project?: string; area?: string }) => {
    const board = teamBoard({
      ...resolveScopeOptions(opts.project, opts.area),
      team: opts.team,
      limit: Number(opts.last),
    });
    console.log(kleur.bold(`Team ${opts.team}`));
    console.log(kleur.bold("Agents:"));
    console.log(formatList(board.agents.map((agent) => `${agent.name} ${agent.status}/${agent.presence}`)));
    console.log(kleur.bold("Open tasks:"));
    console.log(formatList(board.open_tasks.map((task) => `#${task.id} ${task.title}`)));
    console.log(kleur.bold("Active tasks:"));
    console.log(formatList(board.active_tasks.map((task) => `#${task.id} ${task.title} held=${task.claimed_by ?? "-"}`)));
    console.log(kleur.bold("Suggested next actions:"));
    console.log(formatList(board.suggested_next_actions));
  });

program
  .command("final-report")
  .description("Generate a merge-readiness report from tasks")
  .option("--project <name>", "project scope (use all for global)")
  .option("--area <name>", "area scope (use all for global)")
  .option("--team <name>", "team scope (use all for global)")
  .action((opts: { project?: string; area?: string; team?: string }) => {
    const report = finalReport(resolveScopeOptions(opts.project, opts.area, opts.team));
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
  .command("review-gate")
  .description("Check whether the current project is ready to merge/push")
  .option("--project <name>", "project scope (use all for global)")
  .option("--area <name>", "area scope (use all for global)")
  .option("--team <name>", "team scope (use all for global)")
  .option("--json", "print raw JSON")
  .option("--hook-decision", "print a Claude Code Stop-hook decision JSON object")
  .action((opts: { project?: string; area?: string; team?: string; json?: boolean; hookDecision?: boolean }) => {
    const gate = reviewGate(resolveScopeOptions(opts.project, opts.area, opts.team));
    if (opts.hookDecision === true) {
      const reason = [...gate.blockers, ...gate.warnings].join("; ");
      console.log(JSON.stringify({ decision: gate.ok ? "approve" : "block", reason }, null, 2));
      return;
    }
    if (opts.json === true) {
      console.log(JSON.stringify(gate, null, 2));
      return;
    }
    console.log(`Ready: ${gate.ok ? kleur.green("yes") : kleur.red("no")}`);
    console.log(kleur.bold("Blockers:"));
    console.log(formatList(gate.blockers));
    console.log(kleur.bold("Warnings:"));
    console.log(formatList(gate.warnings));
    console.log(`Safe to commit: ${gate.final_report.safe_to_commit ? "yes" : "no"}`);
    console.log(`Safe to push: ${gate.final_report.safe_to_push ? "yes" : "no"}`);
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
  .option("--team <name>", "team scope")
  .option("--replace", "take over the name if already held")
  .action((opts: { name: string; capabilities: string; role?: string; weight: string; project?: string; area?: string; team?: string; replace?: boolean }) => {
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
      team: opts.team,
    });
    console.log(`${kleur.green("registered")} ${a.name}`);
  });

program
  .command("poll-inbox")
  .description("Used by the Claude Code Stop hook — emits a block-decision when messages are pending or session is in listener mode")
  .requiredOption("--agent <name>", "the agent name to poll for")
  .option("--team <name>", "only poll messages for this team (use 'all' for every team)")
  .option("--session <id>", "Claude Code session id (enables listener-mode auto-resume)")
  .action(async (opts: { agent: string; team?: string; session?: string }) => {
    await pollInbox(opts.agent, opts.session, normalizeTeamOption(opts.team));
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

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}
