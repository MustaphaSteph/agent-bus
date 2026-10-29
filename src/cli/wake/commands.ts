import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, openSync, closeSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Command } from "commander";
import { busDir } from "../../util/paths.js";
import { listenDeliveries, type Delivery } from "../delivery.js";
import { createClaudeChannel } from "./channel.js";
import { CodexWake } from "./codex.js";
import { callLocalWake } from "./local.js";

type Options = { agent: string; team?: string; project?: string; thread?: string; cwd?: string; sandbox?: "read-only" | "workspace-write" };
export function registerLocalWakeCommands(program: Command): void {
  for (const kind of ["claude-channel", "codex-listen"] as const) {
    const command = program.command(kind)
      .description(kind === "claude-channel" ? "Claude Code stdio channel bridge; complete deliveries explicitly" : "Run deliveries on a dedicated, explicitly bound Codex App Server thread")
      .requiredOption("--agent <name>", "registered local agent; exclusive inbox consumer")
      .option("--team <name>", "team filter").option("--project <name>", "project filter");
    if (kind === "codex-listen") command.requiredOption("--thread <id>", "dedicated stopped Codex thread ID")
      .requiredOption("--cwd <path>", "bound project directory")
      .option("--sandbox <mode>", "read-only or workspace-write; interactive requests are refused", "read-only");
    const run = async (workspace: string, opts: Options) => {
      if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(opts.agent)) throw new Error("Invalid agent name");
      if (kind === "codex-listen" && !["read-only", "workspace-write"].includes(opts.sandbox!)) throw new Error("Invalid sandbox mode");
      const controller = new AbortController();
      const stop = () => controller.abort();
      const invoke = (tool: string, input: unknown, signal = controller.signal) => callLocalWake(tool, input, signal);
      await invoke("directory", {});
      const dir = join(busDir(), "wake"); mkdirSync(dir, { recursive: true, mode: 0o700 });
      const identity = JSON.stringify(["local", workspace, opts.agent, opts.project ?? null, opts.team ?? null]);
      const path = join(dir, createHash("sha256").update(identity).digest("hex"));
      const checkpoint = path + ".json";
      const journal = existsSync(checkpoint) ? JSON.parse(readFileSync(checkpoint, "utf8")) as { cursor: number; handled: number[] } : { cursor: 0, handled: [] as number[] };
      if (!Number.isSafeInteger(journal.cursor) || journal.cursor < 0 || !Array.isArray(journal.handled) || journal.handled.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error("Invalid wake checkpoint");
      // Fail closed on stale locks: never guess that another process no longer
      // owns a thread. An operator must inspect/remove a stale lock explicitly.
      const locks = [path + ".lock"];
      locks.push(join(dir, `local-${opts.agent}.lock`));
      if (opts.thread) locks.push(join(dir, "codex-" + createHash("sha256").update(JSON.stringify([process.env.CODEX_HOME ?? "default", opts.thread])).digest("hex") + ".lock"));
      const acquired: string[] = [];
      const save = () => { writeFileSync(checkpoint + ".tmp", JSON.stringify(journal), { mode: 0o600 }); renameSync(checkpoint + ".tmp", checkpoint); };
      const reply = async (message: Delivery, text: string) => {
        // Durable server-side idempotency makes a lost reply response safe to retry.
        await invoke("reply", { from: opts.agent, message_id: message.id, message: text, claim_token: message.claim_token, idempotency_key: `wake:${opts.agent}:${message.id}` }, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]));
      };
      let channel: Awaited<ReturnType<typeof createClaudeChannel>> | undefined;
      let codex: CodexWake | undefined;
      let fatal: unknown;
      process.once("SIGINT", stop); process.once("SIGTERM", stop);
      if (kind === "claude-channel") process.stdin.once("end", stop);
      try {
        for (const lock of locks) { const fd = openSync(lock, "wx", 0o600); writeFileSync(fd, JSON.stringify({ pid: process.pid, kind, agent: opts.agent })); closeSync(fd); acquired.push(lock); }
        if (kind === "claude-channel") {
          channel = await createClaudeChannel({ agent: opts.agent, workspace, local: true, signal: controller.signal, reply });
          await Promise.race([channel.ready, new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("Channel closed before initialization")), { once: true }))]);
        } else {
          codex = new CodexWake({ thread: opts.thread!, cwd: resolve(opts.cwd!), sandbox: opts.sandbox! });
          await codex.start();
        }
        await listenDeliveries({ agent: opts.agent, scope: { project: opts.project, team: opts.team }, cursor: journal.cursor, signal: controller.signal,
          call: (tool, input, signal) => invoke(tool, input, signal),
          status: value => console.error(`${new Date().toISOString()} ${value}`),
          saveCursor: id => { journal.cursor = id; journal.handled = []; save(); },
          handle: async (message, signal) => {
            if (journal.handled.includes(message.id) || message.wake_handled === true) return;
            try {
              if (channel) await channel.handle(message, signal);
              else await reply(message, await codex!.handle(message, signal));
              journal.handled.push(message.id); save();
            } catch (error) {
              // A failed host turn needs explicit inspection, not an endless
              // series of new billable turns or silent permission bypasses.
              fatal = error; controller.abort(); throw error;
            }
          },
        });
        if (fatal) throw fatal;
      } finally {
        controller.abort(); await channel?.close(); await codex?.close();
        process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); process.stdin.removeListener("end", stop);
        for (const lock of acquired) unlinkSync(lock);
      }
    };
    command.action((opts: Options) => run("local", opts));
  }
}
