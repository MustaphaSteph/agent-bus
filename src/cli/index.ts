#!/usr/bin/env node
import { Command } from "commander";
import kleur from "kleur";
import {
  ack,
  directory,
  finalReport,
  inbox,
  listDecisions,
  recentMessages,
  register,
  recordDecision,
  send,
  setAgentStatus,
  setPaused,
  sleepAgent,
  wakeAgent,
  whois,
} from "../bus.js";
import { dbPath } from "../util/paths.js";
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
  .version("0.4.0");

program
  .command("watch")
  .description("Live tail every message on the bus")
  .option("--interval <ms>", "poll interval in ms", "250")
  .option("--project <name>", "project scope (default current repo; use 'all' for global)")
  .option("--area <name>", "area scope from .agent-bus.json (use 'all' for every area)")
  .action(async (opts: { interval: string; project?: string; area?: string }) => {
    await watch({
      intervalMs: Number(opts.interval),
      ...resolveScopeOptions(opts.project, opts.area),
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
