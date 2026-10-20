import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

assert.equal(process.env.AGENT_BUS_LIVE_TEST, "1", "Live tests require explicit opt-in");
const origin = new URL(process.env.AGENT_BUS_CLOUD_HOST).origin;
assert(origin.startsWith("https://"));
const config = JSON.parse(readFileSync(join(process.env.AGENT_BUS_DIR || join(homedir(), ".agent-bus"), "cloud.json"), "utf8"));
const cookie = config.hosts?.[origin]?.cookie;
assert(cookie, "Log in to the Cloud host first");
const slug = `oauth-deploy-${Date.now()}`;
const resource = origin + "/mcp";
const callback = "https://client.example/callback";
const headers = { cookie, origin, "content-type": "application/json" };
let createdWorkspace = false;

async function request(path, init = {}, expected = 200) {
  const response = await fetch(origin + path, { redirect: "manual", ...init, signal: AbortSignal.timeout(30000) });
  let detail = "";
  if (response.status !== expected && path === "/oauth/token") {
    const error = await response.clone().json();
    detail = ` (${error.error}: ${error.error_description})`;
  }
  assert.equal(response.status, expected, `${init.method || "GET"} ${path.split("?")[0]}: unexpected status${detail}`);
  return response;
}
const form = (path, body, extra = {}, expected = 200) => request(path, {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...extra }, body: new URLSearchParams(body),
}, expected);
const connections = async () => (await (await request(`/api/connections?workspace=${slug}`, { headers })).json()).connections;
const disconnect = id => request(`/api/connections/${id}`, { method: "DELETE", headers });
const rpc = (token, tool, input = {}, expected = 200) => request("/mcp?json=1", {
  method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ tool, input }),
}, expected);

try {
  const metadata = await (await request("/.well-known/oauth-authorization-server")).json();
  assert.equal(metadata.issuer, origin);
  assert(metadata.code_challenge_methods_supported.includes("S256"));
  assert.equal((await (await request("/.well-known/oauth-protected-resource/mcp")).json()).resource, resource);
  assert.match((await request("/mcp", {}, 401)).headers.get("www-authenticate"), /resource_metadata/);
  const user = (await (await request("/api/auth/me", { headers })).json()).user;
  assert(user?.id, "Saved login expired");
  await request("/api/workspaces", { method: "POST", headers, body: JSON.stringify({ slug, name: "OAuth deployment verification" }) }, 201);
  createdWorkspace = true;
  const client = await (await request("/oauth/register", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Temporary deployment verification", redirect_uris: [callback], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
  }, 201)).json();

  async function grant(role) {
    const verifier = randomBytes(32).toString("base64url");
    const state = randomBytes(16).toString("hex");
    const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: callback, response_type: "code", scope: "workspace:access offline_access", resource, state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" });
    const path = "/oauth/authorize?" + params;
    assert.match((await request(path, {}, 302)).headers.get("location"), /\/app\?returnTo=/);
    const page = await request(path, { headers });
    const handle = (await page.text()).match(/name="handle" value="([^"]+)"/)?.[1];
    assert(handle, "Consent handle missing");
    const binding = page.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const approved = await form("/oauth/authorize", { handle, user: user.id, workspace: slug, role, decision: "allow" }, { origin, cookie: cookie.split(";")[0] + "; " + binding }, 303);
    const redirected = new URL(approved.headers.get("location"));
    assert.equal(redirected.origin + redirected.pathname, callback);
    assert.equal(redirected.searchParams.get("state"), state);
    return (await form("/oauth/token", { grant_type: "authorization_code", client_id: client.client_id, redirect_uri: callback, code: redirected.searchParams.get("code"), code_verifier: verifier, resource })).json();
  }
  const tokens = await grant("agent");
  assert.equal(tokens.expires_in, 900);
  for (const [id, method, params] of [
    [1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "live-oauth-test", version: "1" } }],
    [2, "tools/list", {}],
    [3, "tools/call", { name: "cloud_workspace", arguments: {} }],
  ]) {
    const response = await request("/mcp", { method: "POST", headers: { authorization: `Bearer ${tokens.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
    const text = await response.text();
    const result = JSON.parse(text.startsWith("{") ? text : text.split("\n").filter(line => line.startsWith("data: ")).map(line => line.slice(6)).join("\n"));
    assert(!result.error && result.result && !result.result.isError, `MCP ${method} failed`);
    if (method === "tools/list") assert.equal(result.result.tools.length, 66);
    if (method === "tools/call") assert(JSON.stringify(result.result).includes(slug));
  }
  await rpc(tokens.access_token, "delete_team", { team: "test" }, 403);
  const settleMs = Number(process.env.AGENT_BUS_OAUTH_SETTLE_MS || 0);
  assert(Number.isFinite(settleMs) && settleMs >= 0 && settleMs <= 120000);
  if (settleMs) {
    console.log(`Waiting ${settleMs}ms before refresh to diagnose storage propagation`);
    await new Promise(resolve => setTimeout(resolve, settleMs));
  }
  const refreshed = await (await form("/oauth/token", { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.client_id, resource })).json();
  for (const connection of await connections()) await disconnect(connection.id);
  await rpc(refreshed.access_token, "cloud_workspace", {}, 401);
  await form("/oauth/token", { grant_type: "refresh_token", refresh_token: refreshed.refresh_token, client_id: client.client_id, resource }, {}, 400);
  console.log("PASS live OAuth discovery, sign-in redirect, PKCE consent, MCP (66 tools), workspace binding, privilege limits, refresh and immediate Disconnect");
  const viewer = await grant("viewer");
  await rpc(viewer.access_token, "cloud_workspace");
  await rpc(viewer.access_token, "register", { name: "must-not-register" }, 403);
  console.log("PASS live read-only connector permissions");
} finally {
  if (createdWorkspace) {
    for (const connection of await connections()) await disconnect(connection.id);
    assert.equal((await connections()).length, 0);
    console.log(`Temporary connections disconnected; verification workspace: ${slug}`);
  }
}
