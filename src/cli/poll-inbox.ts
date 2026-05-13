import { inbox } from "../bus.js";
import { BusError } from "../util/errors.js";
import { readListenerMarker } from "./listener-marker.js";

export async function pollInbox(agentName: string, sessionId?: string): Promise<void> {
  let messages;
  try {
    messages = await inbox({ agent: agentName, mark_delivered: false });
  } catch (err) {
    if (err instanceof BusError && err.code === "UNKNOWN_AGENT") {
      process.exit(0);
    }
    throw err;
  }

  if (messages.length > 0) {
    const summary = messages
      .map(
        (m) =>
          `- #${m.id} from ${m.from_agent} (${m.kind}): ${m.content.slice(0, 500)}${m.content.length > 500 ? "…" : ""}`,
      )
      .join("\n");

    const payload = {
      decision: "block",
      reason:
        `You have ${messages.length} unread message(s) on the agent-bus. ` +
        `Call the 'inbox' tool to read them in full, then respond with 'send' or 'reply'.\n\n${summary}`,
    };
    process.stdout.write(JSON.stringify(payload));
    process.exit(0);
  }

  if (sessionId) {
    const marker = readListenerMarker(sessionId);
    if (marker && marker.agent === agentName) {
      const payload = {
        decision: "block",
        reason:
          `You are in listener mode as '${agentName}'. The inbox is currently empty. ` +
          `Immediately call the 'inbox' tool with agent="${agentName}" and wait_s=110 to keep listening. ` +
          `Do not narrate this step — just call the tool.`,
      };
      process.stdout.write(JSON.stringify(payload));
      process.exit(0);
    }
  }

  process.exit(0);
}
