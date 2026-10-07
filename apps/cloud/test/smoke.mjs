import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unstable_dev } from "wrangler";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function json(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`expected JSON response, got ${response.status}: ${text}`);
  }
}

async function assertStatus(response, status, label) {
  if (response.status !== status) {
    throw new Error(`${label} failed: ${response.status} ${await response.text()}`);
  }
}

function parseMcpEvent(text) {
  const data = text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length))
    .join("\n");
  if (!data) throw new Error(`missing MCP event data: ${text}`);
  return JSON.parse(data);
}

function wrangler(args, persistTo) {
  execFileSync(
    "npx",
    ["wrangler", ...args, "--local", "--persist-to", persistTo],
    {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, CI: "1" },
      stdio: "pipe",
    },
  );
}

const root = new URL("..", import.meta.url);
const persistTo = mkdtempSync(join(tmpdir(), "agent-bus-cloud-smoke-"));
process.env.AGENT_BUS_CLOUD_AUTH_SECRET = "test-agent-bus-cloud-secret";

try {
  wrangler(["d1", "execute", "agent-bus-cloud", "--file", "migrations/d1/0001_init.sql"], persistTo);
  wrangler(["d1", "execute", "agent-bus-cloud", "--file", "migrations/d1/0002_auth.sql"], persistTo);

  const worker = await unstable_dev("src/worker.ts", {
    config: "wrangler.toml",
    local: true,
    persistTo,
    logLevel: "error",
    vars: {
      AGENT_BUS_CLOUD_AUTH_SECRET: "test-agent-bus-cloud-secret",
    },
    experimental: { disableExperimentalWarning: true },
  });

  try {
    const landing = await worker.fetch("/");
    await assertStatus(landing, 200, "landing page");
    const landingHtml = await landing.text();
    assert(landingHtml.includes("The shared inbox for AI agent teams"), "landing page did not render the hero copy");
    assert(landingHtml.includes("Hosted setup in four steps"), "landing page did not render hosted setup guide");
    assert(landingHtml.includes("agent-bus cloud --host https://your-worker.example bootstrap my-team"), "landing page did not show bootstrap command");
    const health = await worker.fetch("/api/health");
    await assertStatus(health, 200, "health");
    const healthBody = await json(health);
    assert(healthBody.ok === true, "health did not report ok");
    assert(healthBody.d1?.ok === true, "health did not verify D1");
    assert(healthBody.tools?.implemented >= 65, "health did not report implemented tools");
    const unauthenticatedApp = await worker.fetch("/app");
    await assertStatus(unauthenticatedApp, 200, "unauthenticated app page");
    assert((await unauthenticatedApp.text()).includes("Sign in"), "unauthenticated app page did not render login form");

    const signup = await worker.fetch("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "smoke@example.com", password: "change-me-please", name: "Smoke" }),
    });
    await assertStatus(signup, 201, "signup");
    const cookie = signup.headers.get("set-cookie");
    assert(cookie, "signup did not set a session cookie");
    const authenticatedApp = await worker.fetch("/app", { headers: { cookie } });
    await assertStatus(authenticatedApp, 200, "authenticated app page");
    const authenticatedHtml = await authenticatedApp.text();
    assert(authenticatedHtml.includes("Workspaces"), "authenticated app page did not render dashboard");
    assert(authenticatedHtml.includes("Human actions"), "authenticated app page did not render dashboard action controls");
    const invalidSignup = await worker.fetch("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "bad-email", password: "short", name: "Bad" }),
    });
    assert(invalidSignup.status === 400, `invalid signup returned ${invalidSignup.status}`);
    const duplicateSignup = await worker.fetch("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "smoke@example.com", password: "change-me-please", name: "Smoke 2" }),
    });
    assert(duplicateSignup.status === 409, `duplicate signup returned ${duplicateSignup.status}`);

    const createWorkspace = await worker.fetch("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ slug: "demo", name: "Demo" }),
    });
    await assertStatus(createWorkspace, 201, "workspace create");
    const duplicateWorkspace = await worker.fetch("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ slug: "demo", name: "Duplicate Demo" }),
    });
    assert(duplicateWorkspace.status === 409, `duplicate workspace returned ${duplicateWorkspace.status}`);

    const memberSignup = await worker.fetch("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "member@example.com", password: "change-me-please", name: "Member" }),
    });
    await assertStatus(memberSignup, 201, "member signup");
    const memberCookie = memberSignup.headers.get("set-cookie");
    assert(memberCookie, "member signup did not set a session cookie");

    const addMember = await worker.fetch("/api/workspaces/demo/members", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ email: "member@example.com", role: "viewer" }),
    });
    await assertStatus(addMember, 201, "member add");
    const memberBody = await json(addMember);
    assert(memberBody.member.email === "member@example.com", "member add returned wrong email");
    const memberList = await worker.fetch("/api/workspaces/demo/members", { headers: { cookie } });
    await assertStatus(memberList, 200, "member list");
    assert((await json(memberList)).members.length === 2, "member list did not include owner and invited member");
    const memberWorkspaces = await worker.fetch("/api/workspaces", { headers: { cookie: memberCookie } });
    await assertStatus(memberWorkspaces, 200, "member workspace list");
    assert((await json(memberWorkspaces)).workspaces[0]?.slug === "demo", "member cannot see joined workspace");

    const createToken = await worker.fetch("/api/workspaces/demo/tokens", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "codex", role: "agent" }),
    });
    await assertStatus(createToken, 201, "token create");
    const tokenBody = await json(createToken);
    const token = tokenBody.token?.token;
    assert(typeof token === "string" && token.startsWith("ab_cloud_"), "agent token was not returned");
    const extraToken = await worker.fetch("/api/workspaces/demo/tokens", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "revoked-agent", role: "agent" }),
    });
    await assertStatus(extraToken, 201, "extra token create");
    const extraTokenId = (await json(extraToken)).token.id;
    const viewerTokenResponse = await worker.fetch("/api/workspaces/demo/tokens", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "viewer", role: "viewer" }),
    });
    await assertStatus(viewerTokenResponse, 201, "viewer token create");
    const viewerTokenBody = await json(viewerTokenResponse);
    const viewerToken = viewerTokenBody.token?.token;
    assert(typeof viewerToken === "string" && viewerToken.startsWith("ab_cloud_"), "viewer token was not returned");
    const tokenList = await worker.fetch("/api/workspaces/demo/tokens", { headers: { cookie } });
    await assertStatus(tokenList, 200, "token list");
    assert((await json(tokenList)).tokens.length === 3, "token list did not include created tokens");
    const revoke = await worker.fetch(`/api/workspaces/demo/tokens/${extraTokenId}`, { method: "DELETE", headers: { cookie } });
    await assertStatus(revoke, 200, "token revoke");
    const tokenListAfterRevoke = await worker.fetch("/api/workspaces/demo/tokens", { headers: { cookie } });
    await assertStatus(tokenListAfterRevoke, 200, "token list after revoke");
    assert((await json(tokenListAfterRevoke)).tokens.length === 2, "token revoke did not remove the token");
    const ownerListBeforeDemotion = await worker.fetch("/api/workspaces/demo/members", { headers: { cookie } });
    await assertStatus(ownerListBeforeDemotion, 200, "member list before owner demotion");
    const ownerMember = (await json(ownerListBeforeDemotion)).members.find((member) => member.role === "owner");
    assert(ownerMember?.user_id, "owner member was not returned");
    const demoteOnlyOwner = await worker.fetch(`/api/workspaces/demo/members/${ownerMember.user_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ role: "manager" }),
    });
    assert(demoteOnlyOwner.status === 409, `last owner demotion returned ${demoteOnlyOwner.status}`);
    const updateMember = await worker.fetch(`/api/workspaces/demo/members/${memberBody.member.user_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ role: "manager" }),
    });
    await assertStatus(updateMember, 200, "member role update");
    const managerTokenByMember = await worker.fetch("/api/workspaces/demo/tokens", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: memberCookie },
      body: JSON.stringify({ name: "member-manager-token", role: "agent" }),
    });
    await assertStatus(managerTokenByMember, 201, "manager member token create");
    const removeMember = await worker.fetch(`/api/workspaces/demo/members/${memberBody.member.user_id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    await assertStatus(removeMember, 200, "member remove");
    const memberWorkspacesAfterRemove = await worker.fetch("/api/workspaces", { headers: { cookie: memberCookie } });
    await assertStatus(memberWorkspacesAfterRemove, 200, "member workspace list after remove");
    assert((await json(memberWorkspacesAfterRemove)).workspaces.length === 0, "removed member can still see workspace");

    async function debugCall(tool, input) {
      const response = await worker.fetch("/mcp/demo?json=1", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ tool, input }),
      });
      await assertStatus(response, 200, tool);
      const body = await json(response);
      return JSON.parse(body.content[0].text);
    }

    async function expectDebugFailure(tool, input, expected) {
      const response = await worker.fetch("/mcp/demo?json=1", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ tool, input }),
      });
      assert(response.status >= 400, `${tool} unexpectedly succeeded`);
      const body = await json(response);
      assert(String(body.error?.message ?? body.message ?? "").includes(expected), `${tool} did not fail with ${expected}`);
    }

    async function mcp(body) {
      const response = await worker.fetch("/mcp/demo", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      await assertStatus(response, 200, body.method);
      return parseMcpEvent(await response.text());
    }

    const init = await mcp({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0.0.0" } },
    });
    assert(init.result?.serverInfo?.name === "agent-bus-cloud-demo", "MCP initialize did not return the workspace server");
    const tools = await mcp({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    assert(tools.result?.tools?.length >= 65, "MCP tools/list did not expose the agent-bus tool surface");
    const registerTool = tools.result.tools.find((tool) => tool.name === "register");
    assert(registerTool?.inputSchema?.properties?.name, "register tool schema did not expose the required name input");
    const sendTool = tools.result.tools.find((tool) => tool.name === "send");
    assert(sendTool?.inputSchema?.properties?.message, "send tool schema did not expose the message input");

    async function mcpCall(id, name, args) {
      const event = await mcp({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
      return event.result?.structuredContent?.result ?? JSON.parse(event.result.content[0].text);
    }

    await mcpCall(3, "register", { name: "codex", team: "cloud-smoke", capabilities: ["pm"], replace: true });
    await mcpCall(4, "register", { name: "claude", team: "cloud-smoke", capabilities: ["ui"], replace: true });
    const dashboardTeamSend = await worker.fetch("/api/workspaces/demo/rpc", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        op: "send_team",
        input: { from: "codex", team: "cloud-smoke", message: "dashboard team dispatch" },
      }),
    });
    await assertStatus(dashboardTeamSend, 200, "dashboard team send");
    assert((await json(dashboardTeamSend)).result.recipients.includes("claude"), "dashboard team send did not target team member");
    const dashboardDirectSend = await worker.fetch("/api/workspaces/demo/rpc", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        op: "send",
        input: { from: "codex", to: "claude", message: "dashboard direct dispatch" },
      }),
    });
    await assertStatus(dashboardDirectSend, 200, "dashboard direct send");
    assert((await json(dashboardDirectSend)).result.delivered_to === "claude", "dashboard direct send did not deliver to claude");
    const dashboardTask = await worker.fetch("/api/workspaces/demo/rpc", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        op: "create_task",
        input: { requested_by: "codex", title: "Dashboard-created task", team: "cloud-smoke", state: "backlog" },
      }),
    });
    await assertStatus(dashboardTask, 200, "dashboard task create");
    assert((await json(dashboardTask)).result.task.title === "Dashboard-created task", "dashboard task create returned wrong task");
    const viewerSend = await worker.fetch("/mcp/demo?json=1", {
      method: "POST",
      headers: {
        authorization: `Bearer ${viewerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ tool: "send", input: { from: "viewer", to: "claude", message: "should be denied" } }),
    });
    assert(viewerSend.status === 403, `viewer token was allowed to send a mutating bus message: ${viewerSend.status} ${await viewerSend.text()}`);
    const viewerCockpit = await worker.fetch("/mcp/demo?json=1", {
      method: "POST",
      headers: {
        authorization: `Bearer ${viewerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ tool: "cockpit", input: { team: "cloud-smoke" } }),
    });
    await assertStatus(viewerCockpit, 200, "viewer cockpit read");
    await mcpCall(41, "ask_async", { from: "claude", to: "codex", question: "pending cycle check" });
    await expectDebugFailure("ask", { from: "codex", to: "claude", question: "should detect cycle", timeout_s: 1 }, "ASK_CYCLE");
    const sent = await mcpCall(5, "send", { from: "codex", to: "claude", message: "hello from cloud smoke" });
    assert(sent.thread_id, "send did not return a thread_id");
    const inbox = await debugCall("inbox", { agent: "claude", team: "cloud-smoke", mark_delivered: false });
    const smokeMessage = inbox.messages?.find((message) => message.content === "hello from cloud smoke");
    assert(smokeMessage, "inbox did not return the sent message");
    const lastMessageId = Math.max(...inbox.messages.map((message) => message.id));
    const inboxWait = debugCall("inbox", { agent: "claude", team: "cloud-smoke", since_id: lastMessageId, wait_s: 2, mark_delivered: false });
    setTimeout(() => {
      void mcpCall(6, "send", { from: "codex", to: "claude", message: "delayed cloud message" });
    }, 150);
    const waitedInbox = await inboxWait;
    assert(waitedInbox.messages?.[0]?.content === "delayed cloud message", "inbox wait_s did not return delayed message");

    const createdTask = await mcpCall(7, "create_task", {
      requested_by: "codex",
      claimed_by: "claude",
      title: "Cloud smoke task",
      team: "cloud-smoke",
    });
    const waitForTask = debugCall("wait_for_task", {
      task_id: createdTask.task.id,
      since_updated_at: createdTask.task.updated_at,
      wait_s: 2,
    });
    setTimeout(() => {
      void mcpCall(8, "record_task_event", {
        task_id: createdTask.task.id,
        by_agent: "claude",
        event_type: "progress",
        message: "task moved during wait",
        team: "cloud-smoke",
      });
    }, 150);
    const waitedTask = await waitForTask;
    assert(waitedTask.timed_out === false, "wait_for_task timed out despite delayed task activity");
    assert(waitedTask.latest_event?.message === "task moved during wait", "wait_for_task did not return latest task event");
    const messages = await worker.fetch("/api/workspaces/demo/messages?team=cloud-smoke", { headers: { cookie } });
    await assertStatus(messages, 200, "messages api");
    const messagesBody = await json(messages);
    assert(messagesBody.result.messages.length >= 1, "messages api returned no chat rows");

    const cockpit = await worker.fetch("/api/workspaces/demo/cockpit?team=cloud-smoke", { headers: { cookie } });
    await assertStatus(cockpit, 200, "cockpit api");
    const cockpitBody = await json(cockpit);
    assert(cockpitBody.result.board.agents.length === 2, "cockpit did not include registered agents");

    console.log("agent-bus cloud smoke passed");
  } finally {
    await worker.stop();
  }
} finally {
  rmSync(persistTo, { recursive: true, force: true });
}
