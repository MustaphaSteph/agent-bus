import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Explicit opt-in: creates a dedicated workspace on the chosen live host.
assert.equal(process.env.AGENT_BUS_LIVE_TEST, "1", "Set AGENT_BUS_LIVE_TEST=1 to run against a live deployment");
const origin = new URL(process.env.AGENT_BUS_CLOUD_HOST).origin;
assert(origin.startsWith("https://"), "Live testing requires HTTPS");
const config = JSON.parse(readFileSync(join(process.env.AGENT_BUS_DIR || join(homedir(), ".agent-bus"), "cloud.json"), "utf8"));
const cookie = config.hosts?.[origin]?.cookie;
assert(cookie, "Log in to this Cloud host first");
const slug = `deploy-test-${Date.now()}`;
const base = `/api/workspaces/${slug}`;
const scope = { project: "deployment-test", team: "verification" };
const headers = { cookie, origin, "content-type": "application/json" };
let token;
let tokenId;
let sequence = 0;
const registered = [];

async function request(path, options = {}, expected = 200) {
  const response = await fetch(origin + path, { ...options, signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, expected, `${options.method || "GET"} ${path}: unexpected HTTP status`);
  return response;
}
async function api(path, body, expected = 200) {
  return (await request(path, { method: "POST", headers, body: JSON.stringify(body) }, expected)).json();
}
async function wire(method, params) {
  const response = await request(`/mcp/${slug}`, { method: "POST", headers: {
    accept: "application/json, text/event-stream", authorization: `Bearer ${token}`, "content-type": "application/json",
  }, body: JSON.stringify({ jsonrpc: "2.0", id: ++sequence, method, params }) });
  const text = await response.text();
  const payload = text.startsWith("{") ? JSON.parse(text) : JSON.parse(text.split("\n").filter(line => line.startsWith("data: ")).map(line => line.slice(6)).join("\n"));
  assert(!payload.error, `MCP ${method} failed`);
  return payload.result;
}
async function modern(method, params = {}) {
  const response = await request(`/mcp/${slug}`, { method: "POST", headers: {
    accept: "application/json, text/event-stream", authorization: `Bearer ${token}`, "content-type": "application/json",
    "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": method,
  }, body: JSON.stringify({ jsonrpc: "2.0", id: ++sequence, method, params: { ...params, _meta: {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": { name: "agent-bus-live-events", version: "1" },
    "io.modelcontextprotocol/clientCapabilities": {},
  } } }) });
  const text = await response.text();
  const payload = text.startsWith("{") ? JSON.parse(text) : JSON.parse(text.split("\n").filter(line => line.startsWith("data: ")).at(-1).slice(6));
  assert(!payload.error, `Modern MCP ${method} failed`); return payload.result;
}
async function call(name, args, expectedError) {
  const result = await wire("tools/call", { name, arguments: args });
  const text = result.content?.map(item => item.text || "").join("\n") || "";
  if (expectedError) {
    assert(result.isError, `${name} should reject this operation`);
    const messages = {
      TASK_NOT_CLAIMABLE: /not open|not claimable/i,
      TASK_REVIEW_REQUIRED: /requires approved review/i,
      REVIEW_SELF_FORBIDDEN: /reviewer other than its implementer/i,
      TASK_INVALID_TRANSITION: /cannot transition/i,
    };
    assert.match(text, messages[expectedError], `${name} rejection reason`);
    return;
  }
  assert(!result.isError, `${name} failed`);
  return result.structuredContent?.result ?? JSON.parse(text);
}

try {
  for (const path of ["/", "/blog", "/blog/messages-vs-tracked-tasks", "/app", "/sitemap.xml"]) await request(path);
  const health = await (await request("/api/health")).json();
  assert(health.ok);
  const me = await (await request("/api/auth/me", { headers })).json();
  assert(me.user, "Saved login has expired");
  await api("/api/workspaces", { slug, name: `Deployment verification ${new Date().toISOString()}` }, 201);
  console.log(`Verification workspace: ${slug}`);
  const created = await api(base + "/tokens", { name: "temporary-deployment-test", role: "agent" }, 201);
  token = created.token.token;
  tokenId = created.token.id;
  const init = await wire("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "agent-bus-live-smoke", version: "1.0.0" } });
  assert(init.serverInfo.name.includes(slug));
  const tools = await wire("tools/list", {});
  assert(tools.tools.find(tool => tool.name === "update_task").inputSchema.required.includes("agent"));
  await call("cloud_workspace", {});
  console.log(`PASS live pages, authentication, workspace and MCP schemas (${tools.tools.length} tools)`);
  assert((await modern("server/discover")).capabilities.events);
  assert.equal((await modern("events/list")).events[0].name, "inbox.message_available");
  console.log("PASS live MCP Events discovery alongside legacy tool protocol (not a ChatGPT wake test)");

  for (const name of ["verify-pm", "verify-builder", "verify-reviewer"]) {
    await call("register", { name, ...scope, capabilities: ["verification"] });
    registered.push(name);
  }
  const sent = await call("send", { from: "verify-pm", to: "verify-builder", message: "Deployment test: verify threaded messaging." });
  const inbox = await call("inbox", { agent: "verify-builder", claim_s: 1, ...scope });
  assert(inbox.messages.some(message => message.id === sent.id && message.status === "pending" && message.claim_token));
  await new Promise(resolve => setTimeout(resolve, 1100));
  const resumed = await call("inbox", { agent: "verify-builder", since_id: inbox.next_cursor, ...scope });
  const received = resumed.messages.find(message => message.id === sent.id);
  assert(received && received.claim_token !== inbox.messages.find(message => message.id === sent.id).claim_token);
  const replyInput = { from: "verify-builder", message_id: sent.id, message: "Threaded reply confirmed.", idempotency_key: `live:${sent.id}` };
  const reply = await call("reply", replyInput);
  assert.deepEqual(await call("reply", replyInput), reply);
  assert.equal(reply.thread_id, sent.thread_id);
  await call("ack", { agent: "verify-builder", message_id: received.id, claim_token: received.claim_token });
  const handled = (await call("get_message", { message_id: received.id })).message;
  assert.equal(handled.status, "answered");
  assert(handled.delivered_at, "handled message was not acknowledged");
  const replies = await call("inbox", { agent: "verify-pm", ...scope });
  for (const message of replies.messages) {
    assert.equal(message.thread_id, sent.thread_id);
    await call("ack", { agent: "verify-pm", message_id: message.id, claim_token: message.claim_token });
  }
  const pollStart = Date.now();
  assert.equal((await call("inbox", { agent: "verify-pm", wait_s: 2, since_id: replies.next_cursor, ...scope })).messages.length, 0);
  assert(Date.now() - pollStart >= 1900);
  console.log("PASS live messaging, long poll, cursor recovery, explicit acknowledgement and threaded reply");

  const { task } = await call("create_task", { requested_by: "verify-pm", title: "Verify deployed review workflow", ...scope, review_required: true, independent_review: true });
  await call("claim_task", { task_id: task.id, agent: "verify-builder" });
  await call("claim_task", { task_id: task.id, agent: "verify-reviewer" }, "TASK_NOT_CLAIMABLE");
  await call("now", { agent: "verify-builder", task_id: task.id, phase: "testing", note: "Running live deployment checks" });
  await call("update_task", { task_id: task.id, agent: "verify-builder", state: "completed" }, "TASK_REVIEW_REQUIRED");
  await call("submit_review", { task_id: task.id, reviewer: "verify-builder", approved: true }, "REVIEW_SELF_FORBIDDEN");
  await call("submit_review", { task_id: task.id, reviewer: "verify-reviewer", review_state: "changes_requested", notes: "Synthetic rejection for deployment verification" });
  assert.equal((await call("review_gate", scope)).ok, false);
  await call("record_test_result", { by_agent: "verify-builder", task_id: task.id, command: "deployment-review-test", status: "passed", output_summary: "Review gates verified through live MCP" });
  const reviewed = await call("submit_review", { task_id: task.id, reviewer: "verify-reviewer", review_state: "approved", notes: "Deployment review checks passed" });
  assert.equal(reviewed.task.review_state, "approved");
  const completed = await call("update_task", { task_id: task.id, agent: "verify-builder", state: "completed", result: "Live workflow smoke passed" });
  assert(completed.task.finished_at);
  await call("update_task", { task_id: task.id, agent: "verify-builder", state: "open" }, "TASK_INVALID_TRANSITION");
  await call("create_task", { requested_by: "verify-pm", title: "Synthetic parked idea", state: "backlog", ...scope });
  const report = await call("final_report", scope);
  assert(report.safe_to_commit && report.safe_to_push);
  assert(report.tests_passed.some(test => test.includes("deployment-review-test")));
  assert.equal((await call("review_gate", scope)).ok, true);
  await call("remember", { by_agent: "verify-pm", content: "Synthetic deployment verification note", kind: "fact", pinned: true, ...scope });
  await call("remember", { by_agent: "verify-pm", content: "Unpinned verification note", kind: "fact", ...scope });
  const brief = await call("session_brief", scope);
  assert.equal(brief.pinned_memories.length, 1);
  assert.equal(brief.recent_memories.length, 1);
  console.log("PASS live task ownership, independent review, approval, final report, backlog and memory pinning");

  const pngData = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6S5sAAAAASUVORK5CYII=", "base64");
  const markdown = "# Deployment check\nSynthetic file shared through Agent Bus Cloud.\n";
  const files = [];
  for (const [name, body] of [["verification.png", pngData], ["verification.md", markdown]]) {
    const response = await request(base + "/files?" + new URLSearchParams({ ...scope, name }), { method: "POST", headers, body }, 201);
    files.push((await response.json()).attachment);
  }
  const agentHeaders = { authorization: `Bearer ${token}` };
  await request(files[0].url, {}, 401);
  await request(files[0].url, { headers: agentHeaders }, 404);
  const png = await request(files[0].url + "?preview=1", { headers });
  assert.equal(png.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await png.arrayBuffer()), pngData);
  const draft = await request(base + "/files?" + new URLSearchParams({ ...scope, name: "discard.md" }), { method: "POST", headers, body: "Disposable deployment draft" }, 201);
  const discarded = (await draft.json()).attachment;
  await request(discarded.url, { method: "DELETE", headers });
  await request(discarded.url, { headers }, 404);
  await request(base + "/chat", { method: "POST", headers: { ...headers, origin: "https://untrusted.example" }, body: JSON.stringify({ ...scope, content: "Must be rejected", request_id: crypto.randomUUID() }) }, 403);
  const body = { ...scope, content: "@verify-builder Check these deployment test files.", attachment_ids: files.map(file => file.id), request_id: crypto.randomUUID() };
  const chat = await api(base + "/chat", body, 201);
  const retry = await api(base + "/chat", body, 201);
  assert.deepEqual(retry.result.ids, chat.result.ids);
  const delivered = await call("inbox", { agent: "verify-builder", ...scope });
  const message = delivered.messages.find(message => chat.result.ids.includes(message.id));
  assert.equal(message.sender_kind, "human");
  assert.deepEqual(message.attachments.map(file => file.id), files.map(file => file.id));
  const downloaded = await request(files[1].url, { headers: agentHeaders });
  assert.equal(await downloaded.text(), markdown);
  const answer = await call("reply", { from: "verify-builder", message_id: message.id, message: "Verified image and Markdown attachment delivery." });
  assert.equal(answer.thread_id, message.thread_id);
  await call("ack", { agent: "verify-builder", message_id: message.id, claim_token: message.claim_token });
  const view = await (await request(base + "/chat?" + new URLSearchParams(scope), { headers })).json();
  assert(view.result.messages.some(row => row.attachments?.length === 2));
  console.log("PASS live image/Markdown upload, authenticated downloads, draft privacy/deletion, human mentions, retry safety and agent reply");
  console.log(`Verification workspace: ${slug}`);
} finally {
  const cleanupErrors = [];
  for (const agent of registered) {
    try { await call("set_agent_status", { agent, status: "sleeping" }); }
    catch { cleanupErrors.push(`agent status: ${agent}`); }
  }
  if (tokenId) {
    try {
      await request(base + "/tokens/" + tokenId, { method: "DELETE", headers });
      await request(`/mcp/${slug}/info`, { headers: { authorization: `Bearer ${token}` } }, 401);
      console.log("Temporary verification token revoked; test workspace retained as evidence.");
    } catch { cleanupErrors.push("token revocation"); }
  }
  assert.equal(cleanupErrors.length, 0, `Cleanup needs attention in ${slug}: ${cleanupErrors.join(", ")}`);
}
