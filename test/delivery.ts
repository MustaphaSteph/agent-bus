import assert from "node:assert/strict";
import { listenDeliveries, DeliveryError, type Delivery } from "../src/cli/delivery.js";

const message = (id: number): Delivery => ({ id, claim_token: `receipt-${id}`, claim_deadline: Date.now() + 300000 });
let passed = 0;
async function test(name: string, fn: () => Promise<void>) { await fn(); console.log(`PASS ${name}`); passed++; }

await test("empty responses reconnect immediately; checkpoint only handled and acknowledged IDs", async () => {
  const stop = new AbortController(); const events: string[] = []; const cursors: number[] = [];
  let polls = 0;
  await listenDeliveries({ agent: "test", cursor: 7, signal: stop.signal,
    call: async (tool, input) => {
      events.push(tool);
      if (tool === "ack") { assert(events.includes("handled")); return {}; }
      cursors.push(Number(input.since_id)); polls++;
      if (polls === 1) return { messages: [], next_cursor: 500 };
      if (polls === 2) return { messages: [message(8)], next_cursor: 999 };
      stop.abort(); return { messages: [] };
    }, handle: async () => { events.push("handled"); }, saveCursor: id => events.push(`saved-${id}`),
    wait: async () => { assert.fail("successful polls must not sleep"); },
  });
  assert.deepEqual(events, ["inbox", "inbox", "handled", "ack", "saved-8", "inbox"]);
  assert.deepEqual(cursors, [7, 7, 8]);
});
await test("transient failures use capped backoff; lost ack retries without rerunning handler", async () => {
  const stop = new AbortController(); const waits: number[] = []; let polls = 0; let acks = 0; let handled = 0;
  await listenDeliveries({ agent: "test", cursor: 0, signal: stop.signal, random: () => 1,
    call: async tool => {
      if (tool === "ack") { if (++acks === 1) throw new TypeError("connection lost"); return {}; }
      if (++polls <= 7) throw new TypeError("connection lost");
      if (polls === 8) return { messages: [message(1)] };
      stop.abort(); return { messages: [] };
    }, handle: async () => { handled++; }, saveCursor: id => assert.equal(id, 1), wait: async ms => { waits.push(ms); },
  });
  assert.deepEqual(waits.slice(0, 7), [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  assert.equal(handled, 1); assert.equal(acks, 2);
});
await test("failed handling never acknowledges or advances cursor; lower IDs still get handled", async () => {
  const stop = new AbortController(); let attempts = 0; let polls = 0; let acks = 0;
  await listenDeliveries({ agent: "test", cursor: 20, signal: stop.signal,
    call: async (tool, input) => {
      if (tool === "ack") { acks++; return {}; }
      assert.equal(input.since_id, 20);
      if (++polls === 3) { stop.abort(); return { messages: [] }; }
      return { messages: [message(12)] };
    }, handle: async () => { if (++attempts === 1) throw new Error("handler failed"); },
    saveCursor: id => assert.equal(id, 20), wait: async () => {},
  });
  assert.equal(attempts, 2); assert.equal(acks, 1);
});
await test("unauthorized connections fail instead of retrying forever", async () => {
  await assert.rejects(listenDeliveries({ agent: "test", cursor: 0, signal: new AbortController().signal,
    call: async () => { throw new DeliveryError(403); }, handle: async () => {}, saveCursor: () => {},
    wait: async () => assert.fail("no retry for revoked access"),
  }), /403/);
});
await test("shutdown aborts live poll and ends offline without acknowledgement", async () => {
  const stop = new AbortController(); const states: string[] = [];
  await listenDeliveries({ agent: "test", cursor: 0, signal: stop.signal,
    call: async (_tool, _input, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true }); stop.abort();
    }), handle: async () => assert.fail("no handling"), saveCursor: () => assert.fail("no checkpoint"), status: state => states.push(state),
  });
  assert.equal(states.at(-1), "offline"); assert(!states.includes("listening"));
});
console.log(`${passed} Delivery listener regression tests passed`);
