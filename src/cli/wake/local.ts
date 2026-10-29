import { z } from "zod";
import { wakeInbox, wakeReply, wakeAck, whois } from "../../bus.js";
import { BusError } from "../../util/errors.js";
import { DeliveryError } from "../delivery.js";

const receipt = z.object({ agent: z.string(), message_id: z.number().int().positive(), claim_token: z.string().min(1) });

// Adapt the shared delivery loop to the local domain without network access.
export async function callLocalWake(tool: string, input: unknown, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  try {
    if (tool === "directory") return whois();
    if (tool === "inbox") return await wakeInbox(z.object({ agent: z.string(), project: z.string().optional(), team: z.string().optional(),
      since_id: z.number().int().nonnegative().optional(), wait_s: z.number().nonnegative().optional() }).parse(input), signal);
    if (tool === "reply") {
      const args = z.object({ from: z.string(), message_id: z.number().int().positive(), claim_token: z.string(), message: z.string() }).parse(input);
      return wakeReply({ ...args, agent: args.from });
    }
    if (tool === "ack") return wakeAck(receipt.parse(input));
    throw new Error("Unsupported local wake operation");
  } catch (error) {
    // Domain errors are fatal; transient SQLite locks are retried by the loop.
    if (error instanceof BusError || error instanceof z.ZodError) {
      const fatal = new DeliveryError(400);
      fatal.message = error.message;
      throw fatal;
    }
    throw error;
  }
}
