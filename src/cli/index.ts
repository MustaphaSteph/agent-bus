#!/usr/bin/env node
import { Command } from "commander";
import kleur from "kleur";
import {
  recentMessages,
  register,
  send,
  setPaused,
  whois,
} from "../bus.js";
import { formatMessage } from "./format.js";
import { installHook, uninstallHook } from "./install-hook.js";
import { listenPrompt } from "./listen-prompt.js";
import { markListening, unmarkListening } from "./listener-marker.js";
import { pollInbox } from "./poll-inbox.js";
import { tasks } from "./tasks.js";
import { watch } from "./watch.js";

const program = new Command();
program
  .name("agent-bus")
  .description("Local message bus for Claude Code, Codex and other MCP agents.")
  .version("0.3.0");

program
  .command("watch")
  .description("Live tail every message on the bus")
  .option("--interval <ms>", "poll interval in ms", "250")
  .action(async (opts) => {
    await watch({ intervalMs: Number(opts.interval) });
  });

program
  .command("log")
  .description("Show the most recent messages and exit")
  .option("-n, --last <count>", "how many to show", "50")
  .action((opts) => {
    const msgs = recentMessages(Number(opts.last));
    if (msgs.length === 0) {
      console.log(kleur.gray("(no messages yet)"));
      return;
    }
    for (const m of msgs) console.log(formatMessage(m));
  });

program
  .command("whois")
  .description("List registered agents")
  .action(() => {
    const agents = whois();
    if (agents.length === 0) {
      console.log(kleur.gray("(no agents registered)"));
      return;
    }
    for (const a of agents) {
      const age = Math.round((Date.now() - a.last_seen) / 1000);
      const caps = a.capabilities.length > 0 ? ` [${a.capabilities.join(", ")}]` : "";
      const paused = a.paused ? kleur.red(" (paused)") : "";
      console.log(`${kleur.bold(a.name)}${kleur.gray(caps)}${paused}  ${kleur.gray(`seen ${age}s ago`)}`);
    }
  });

program
  .command("tasks")
  .description("List tasks or watch task changes")
  .option("--state <state>", "filter by task state")
  .option("--all", "include terminal tasks (completed, failed, canceled)")
  .option("--watch", "keep running and print new/changed tasks")
  .option("--interval <ms>", "watch poll interval in ms", "1000")
  .action(async (opts: { state?: string; all?: boolean; watch?: boolean; interval: string }) => {
    await tasks({
      state: opts.state,
      all: opts.all,
      watch: opts.watch,
      intervalMs: Number(opts.interval),
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
  .option("--replace", "take over the name if already held")
  .action((opts: { name: string; capabilities: string; replace?: boolean }) => {
    const caps = opts.capabilities
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const a = register({ name: opts.name, capabilities: caps, replace: opts.replace });
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
