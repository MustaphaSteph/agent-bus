import assert from "node:assert/strict";

export async function testHumanChat(worker, cookie, token) {
  // Browsers allow Secure test cookies on loopback, not Wrangler's 0.0.0.0 bind address.
  const origin = `http://127.0.0.1:${worker.port}`;
  const fetchLocal = (path, init) => fetch(new URL(path, origin), init);
  const headers = { cookie, origin, "content-type": "application/json" };
  const path = "/api/workspaces/demo/chat";
  const scope = { team: "human-chat-test", project: "chat-project", area: "ui" };
  const params = new URLSearchParams(scope);
  const request = (content, extra = {}, customHeaders = headers) => fetchLocal(path, {
    method: "POST", headers: customHeaders,
    body: JSON.stringify({ ...scope, content, request_id: crypto.randomUUID(), ...extra }),
  });
  const rpc = async (op, input) => {
    const response = await fetchLocal("/api/workspaces/demo/rpc", { method: "POST", headers,
      body: JSON.stringify({ op, input }) });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result.result;
  };
  const view = async () => {
    const response = await fetchLocal(path + "?" + params, { headers: { cookie } });
    assert.equal(response.status, 200);
    return (await response.json()).result;
  };
  await rpc("register", { ...scope, name: "chat-claude", capabilities: ["design"] });
  await rpc("register", { ...scope, name: "chat-codex", capabilities: ["review"] });
  await rpc("register", { ...scope, project: "different-project", name: "chat-outsider" });
  await rpc("register", { ...scope, area: "backend", name: "chat-other-area" });
  await rpc("register", { ...scope, name: "chat-paused" });
  await rpc("sleep_agent", { agent: "chat-paused" });
  const initial = await view();
  assert(initial.can_post);
  assert.equal(initial.human.name, "Smoke");
  assert.deepEqual(initial.members.map(member => member.name).sort(), ["chat-claude", "chat-codex", "chat-paused"]);
  assert.equal(initial.members.find(member => member.name === "chat-paused").presence, "online");

  const id = crypto.randomUUID();
  const sentResponse = await request("@chat-claude Please improve this layout.", { request_id: id });
  const sent = await sentResponse.json();
  assert.equal(sentResponse.status, 201, JSON.stringify(sent));
  assert.equal(sent.result.recipients.length, 1);
  assert.equal(sent.result.recipients[0].name, "chat-claude");
  const repeated = await request("@chat-claude Please improve this layout.", { request_id: id });
  assert.deepEqual((await repeated.json()).result.ids, sent.result.ids);
  assert.equal((await request("different content", { request_id: id })).status, 400);
  assert.equal((await request("@chat-outsider do something")).status, 400);
  assert.equal((await request("@chat-other-area do something")).status, 400);
  assert.equal((await request("@missing-agent do something")).status, 400);
  assert.equal((await request("@chat-claude hello", { from: "chat-codex" })).status, 400);
  assert.equal((await request("  ")).status, 400);
  assert.equal((await request("x".repeat(12001))).status, 400);
  assert.equal((await request("hello", {}, { ...headers, origin: "https://untrusted.example" })).status, 403);
  assert.equal((await request("hello", {}, { origin, "content-type": "application/json", authorization: `Bearer ${token}` })).status, 403);
  const forged = await fetchLocal("/api/workspaces/demo/rpc", { method: "POST", headers,
    body: JSON.stringify({ op: "human_chat_post", input: { ...scope, content: "bad", request_id: crypto.randomUUID() } }) });
  assert.equal(forged.status, 403);
  let current = await view();
  assert.equal(current.messages.length, 1, "failed sends or retries added messages");
  const message = current.messages[0];
  assert.equal(message.sender_kind, "human");
  assert.equal(message.sender_name, "Smoke");
  assert.equal(message.from_agent, initial.human.id);
  const impersonation = await fetchLocal("/api/workspaces/demo/rpc", { method: "POST", headers,
    body: JSON.stringify({ op: "register", input: { name: initial.human.id, replace: true } }) });
  assert.equal(impersonation.status, 400);
  const falseHumanSend = await fetchLocal("/api/workspaces/demo/rpc", { method: "POST", headers,
    body: JSON.stringify({ op: "send_team", input: { from: initial.human.id, team: scope.team, message: "fake" } }) });
  assert.equal(falseHumanSend.status, 400);
  const inbox = await rpc("inbox", { agent: "chat-claude", team: scope.team });
  assert(JSON.stringify(inbox).includes("Please improve this layout."));
  assert(JSON.stringify(inbox).includes('"sender_kind":"human"'));
  const reply = await rpc("reply", { from: "chat-claude", message_id: message.id, message: "I will update the layout." });
  assert.equal(reply.thread_id, message.thread_id);
  await rpc("send", { from: "chat-claude", to: initial.human.id, thread_id: message.thread_id, message: "Follow-up for the person." });
  current = await view();
  assert(current.messages.some(row => row.content_preview === "I will update the layout."));
  const followup = await request("Thanks, proceed.", { reply_to: reply.id });
  const followupBody = await followup.json();
  assert.equal(followup.status, 201);
  assert.equal(followupBody.result.thread_id, message.thread_id);
  assert.equal(followupBody.result.recipients[0].name, "chat-claude");
  const foreign = await rpc("send", { from: "chat-outsider", to: "chat-codex", message: "Different project" });
  assert.equal((await request("wrong thread", { reply_to: foreign.id })).status, 400);
  const broadcast = await request("Team update, please review.");
  const broadcastBody = await broadcast.json();
  assert.equal(broadcast.status, 201);
  assert.equal(broadcastBody.result.ids.length, 3);
  assert(broadcastBody.result.recipients.some(member => member.name === "chat-paused"));
  await rpc("wake_agent", { agent: "chat-paused" });
  const queued = await rpc("inbox", { agent: "chat-paused", team: scope.team });
  assert(JSON.stringify(queued).includes("Team update, please review."));
  const agents = await rpc("directory", scope);
  assert(!agents.agents.some(agent => agent.name.startsWith("human.")), "people leaked into agent roster");
  await rpc("remove_agent", { name: "chat-paused" });
  assert.equal((await request("@chat-paused please return")).status, 400);

  const signup = await fetchLocal("/api/auth/signup", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "chat-viewer@example.com", name: "Chat viewer", password: "test-password-only" }) });
  assert.equal(signup.status, 201);
  const viewerCookie = signup.headers.get("set-cookie");
  const nonMember = await fetchLocal(path + "?" + params, { headers: { cookie: viewerCookie } });
  assert.equal(nonMember.status, 401);
  const member = await fetchLocal("/api/workspaces/demo/members", { method: "POST", headers,
    body: JSON.stringify({ email: "chat-viewer@example.com", role: "viewer" }) });
  assert.equal(member.status, 201);
  const readOnly = await fetchLocal(path + "?" + params, { headers: { cookie: viewerCookie } });
  assert.equal(readOnly.status, 200);
  assert.equal((await readOnly.json()).result.can_post, false);
  assert.equal((await request("not permitted", {}, { ...headers, cookie: viewerCookie })).status, 403);
  console.log("agent-bus human chat passed: authenticated identity, mentions, isolation, retries, replies, queued delivery, and read-only enforcement");
  return { origin, scope, rpc, headers };
}
