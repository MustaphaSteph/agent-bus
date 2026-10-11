import assert from "node:assert/strict";

export async function testHumanTasks({ origin, headers }, token) {
  const request = (path, data, auth = headers) => fetch(origin + path, {
    method: "POST", headers: auth, body: JSON.stringify(data),
  });
  const base = "/api/workspaces/human-tasks-empty";
  assert.equal((await request("/api/workspaces", { slug: "human-tasks-empty", name: "Human tasks" })).status, 201);
  const rpc = async (op, input = {}) => {
    const response = await request(base + "/rpc", { op, input });
    assert.equal(response.status, 200);
    return (await response.json()).result;
  };
  assert.equal((await rpc("directory")).agents.length, 0);
  const identity = (await (await fetch(origin + base + "/chat", { headers })).json()).result.human.id;
  for (const state of ["open", "backlog"]) {
    const response = await request(base + "/tasks", { title: "  Human " + state + "  ", description: "No agent required", state });
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    assert.equal(body.result.task.requested_by, identity);
    assert.equal(body.result.task.claimed_by, null);
    assert.equal(body.result.task.state, state);
    assert.equal(body.result.task.title, "Human " + state);
    assert.equal(body.result.task.team, null);
  }
  assert.equal((await rpc("directory")).agents.length, 0, "human task creation registered an agent");
  assert.equal((await request(base + "/tasks", { title: "spoof", requested_by: "dot" })).status, 400);
  assert.equal((await request(base + "/tasks", { title: "unknown assignee", claimed_by: "dot" })).status, 400);
  assert.equal((await request(base + "/tasks", { title: "bad state", state: "completed" })).status, 400);
  assert.equal((await request(base + "/tasks", { title: "   " })).status, 400);
  assert.equal((await request(base + "/tasks", { title: "csrf" }, { ...headers, origin: "https://untrusted.example" })).status, 403);
  assert.equal((await request(base + "/rpc", { op: "human_task_create", input: { title: "bypass" } })).status, 403);
  assert.equal((await request(base + "/rpc", { op: "create_task", input: { title: "spoof", requested_by: identity } })).status, 400);
  assert.equal((await rpc("list_tasks")).tasks.length, 2, "failed submissions leaked tasks");
  await rpc("register", { name: "human-task-worker", team: "test-team" });
  const assigned = await request(base + "/tasks", { title: "Assigned human task", claimed_by: "human-task-worker", team: "test-team" });
  assert.equal(assigned.status, 201, await assigned.clone().text());
  assert.equal((await assigned.json()).result.task.state, "claimed");
  const inbox = await rpc("inbox", { agent: "human-task-worker" });
  assert.equal(inbox.messages[0].from_agent, identity);
  await rpc("reply", { from: "human-task-worker", message_id: inbox.messages[0].id, message: "Acknowledged" });

  const viewer = await request("/api/auth/login", { email: "chat-viewer@example.com", password: "test-password-only" });
  const viewerHeaders = { ...headers, cookie: viewer.headers.get("set-cookie") };
  assert.equal((await request(base + "/tasks", { title: "non-member" }, viewerHeaders)).status, 401);
  assert.equal((await request(base + "/members", { email: "chat-viewer@example.com", role: "viewer" })).status, 201);
  assert.equal((await request(base + "/tasks", { title: "viewer" }, viewerHeaders)).status, 403);
  assert.equal((await request("/api/workspaces/demo/tasks", { title: "agent token" }, {
    origin, "content-type": "application/json", authorization: `Bearer ${token}`,
  })).status, 403);
  console.log("human tasks passed: empty workspace, authenticated requester, unassigned open/backlog, assignment/reply, spoofing, CSRF, viewer and token restrictions");
}
