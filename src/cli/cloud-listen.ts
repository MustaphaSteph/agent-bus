import { setTimeout as delay } from "node:timers/promises";

export interface CloudDelivery {
  id: number;
  claim_token: string;
  claim_deadline: number;
  [key: string]: unknown;
}

export class CloudRequestError extends Error {
  constructor(readonly status: number) { super(`Cloud request failed (HTTP ${status})`); }
}

export interface CloudListenerOptions {
  agent: string;
  scope?: { team?: string; project?: string };
  cursor: number;
  signal: AbortSignal;
  call: (tool: string, input: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
  handle: (message: CloudDelivery, signal: AbortSignal) => Promise<void>;
  saveCursor: (cursor: number) => void;
  status?: (state: string) => void;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
}

// One delivery at a time keeps the lease bound to work that can actually run.
// Handler side effects must be idempotent by ID: a process can die before ack.
export async function listenCloud(options: CloudListenerOptions): Promise<void> {
  const { signal, agent, call } = options;
  const wait = options.wait ?? (async (ms, abort) => { await delay(ms, undefined, { signal: abort }); });
  let cursor = options.cursor;
  let failures = 0;
  const retry = async () => {
    options.status?.("offline; reconnecting");
    const base = Math.min(30000, 1000 * 2 ** Math.min(failures++, 5));
    await wait(Math.round(base * (0.5 + (options.random ?? Math.random)() * 0.5)), signal);
  };
  const fatal = (error: unknown) => error instanceof CloudRequestError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status);
  try {
    while (!signal.aborted) {
      try {
        // The dashboard derives Listening from the server's live request, never
        // from this optimistic client-side attempt to connect.
        options.status?.("connecting");
        const result = await call("inbox", { agent, ...options.scope, since_id: cursor, wait_s: 110, claim_s: 300, limit: 1 },
          AbortSignal.any([signal, AbortSignal.timeout(120000)])) as { messages: CloudDelivery[]; paused?: boolean };
        options.status?.("last checked");
        if (!Array.isArray(result.messages)) throw new Error("Invalid inbox response");
        if (result.paused) { options.status?.("paused"); await wait(5000, signal); continue; }
        for (const message of result.messages) {
          if (!Number.isSafeInteger(message.id) || message.id <= 0 || !message.claim_token || !Number.isFinite(message.claim_deadline)) throw new Error("Invalid inbox receipt");
          signal.throwIfAborted();
          options.status?.(`handling #${message.id}`);
          await options.handle(message, AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.min(240000, message.claim_deadline - Date.now() - 10000)))]));
          // Retry a lost acknowledgement without running a successful handler twice.
          while (true) {
            signal.throwIfAborted();
            try {
              await call("ack", { agent, message_id: message.id, claim_token: message.claim_token }, AbortSignal.any([signal, AbortSignal.timeout(15000)]));
              break;
            } catch (error) {
              if (Date.now() >= message.claim_deadline) throw new Error("Lease expired; awaiting redelivery");
              if (fatal(error)) throw error;
              await retry();
            }
          }
          cursor = Math.max(cursor, message.id);
          options.saveCursor(cursor);
        }
        failures = 0;
        // Empty timeouts and successfully handled responses reconnect immediately.
      } catch (error) {
        if (signal.aborted) break;
        if (fatal(error)) throw error;
        await retry();
      }
    }
  } catch (error) {
    if (!signal.aborted) throw error;
  } finally { options.status?.("offline"); }
}
