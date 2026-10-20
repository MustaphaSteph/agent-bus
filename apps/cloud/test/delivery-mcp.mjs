import assert from "node:assert/strict";

export async function testDeliveryMcp(mcpCall, worker, cookie, agentToken) {
  let id = 2000;
  const call = (name, input) => mcpCall(++id, name, input);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  await call("register", { name: "delivery-sender", team: "delivery" });
  await call("register", { name: "delivery-receiver", team: "delivery" });
  const input = { agent: "delivery-receiver", team: "delivery" };
  const waiting = call("inbox", { ...input, wait_s: 3, claim_s: 1 });
  await delay(200);
  await call("inbox_previews", input);
  await call("send", { from: "delivery-sender", to: input.agent, message: "MCP delayed delivery" });
  const first = await waiting;
  const message = first.messages[0];
  assert.equal(message.content, "MCP delayed delivery");
  assert(message.claim_token);
  assert.equal(message.status, "pending");
  assert.equal((await call("inbox", { ...input, since_id: first.next_cursor })).messages.length, 0);
  await delay(1100);
  const replay = await call("inbox", { ...input, since_id: first.next_cursor });
  assert.equal(replay.messages[0].id, message.id);
  assert.notEqual(replay.messages[0].claim_token, message.claim_token);
  await call("ack", { agent: input.agent, message_id: message.id, claim_token: replay.messages[0].claim_token });
  assert.equal((await call("get_message", { message_id: message.id })).message.status, "delivered");
  const start = Date.now();
  const empty = await call("inbox", { ...input, since_id: replay.next_cursor, wait_s: 0.3 });
  assert.equal(empty.messages.length, 0);
  assert(Date.now() - start >= 250);


  if (process.env.AGENT_BUS_LONG_POLL_TEST === "1") {
    console.log("Cloud MCP: verifying full 110-second wait and mid-wait presence");
    const began = Date.now();
    const longWait = call("inbox", { ...input, wait_s: 110 });
    await delay(60000);
    const directory = await call("directory", { team: "delivery" });
    const agent = directory.agents.find(row => row.name === input.agent);
    assert(agent.last_seen > began + 55000 && agent.listening_until > Date.now());
    assert.equal((await longWait).messages.length, 0);
    assert(Date.now() - began >= 109000 && Date.now() - began < 125000);
    console.log("Cloud MCP: full 110-second timeout and presence refresh passed");
  }

  // Register and revoke without sending: smoke tests must never contact a public receiver.
  const rpc = (op, body, headers = { cookie }) => worker.fetch("/api/workspaces/demo/rpc", {
    method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ op, input: body }),
  });
  const denied = await rpc("webhook_create", { agent: input.agent, url: "https://example.com/inbox" }, { authorization: `Bearer ${agentToken}` });
  assert.equal(denied.status, 403);
  const created = await rpc("webhook_create", { agent: input.agent, url: "https://example.com/inbox" });
  assert.equal(created.status, 200);
  const hook = (await created.json()).result.webhook;
  assert(hook.secret);
  const listed = await rpc("webhook_list", {});
  const listing = await listed.text();
  assert(!listing.includes(hook.secret));
  const removed = await rpc("webhook_delete", { id: hook.id });
  assert.equal(removed.status, 200);
  console.log("Cloud MCP delivery: long poll, lease/reconnect/ack and webhook permissions passed");
}
