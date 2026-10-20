import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";

export async function testOAuth(worker, sessionCookie) {
  const origin = `http://127.0.0.1:${worker.port}`;
  const resource = origin + "/mcp";
  const fetch = (path, init) => globalThis.fetch(new URL(path, origin), { redirect: "manual", ...init });
  const formPost = (path, body, cookie = sessionCookie, extra = {}) => fetch(path, {
    method: "POST", headers: { origin, cookie, "content-type": "application/x-www-form-urlencoded", ...extra }, body: new URLSearchParams(body),
  });
  const api = (path, method, body, cookie = sessionCookie) => fetch(path, { method, headers: { origin, cookie, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const metadataResponse = await fetch("/.well-known/oauth-authorization-server");
  assert.equal(metadataResponse.status, 200, await metadataResponse.clone().text());
  const metadata = await metadataResponse.json();
  assert(metadata.code_challenge_methods_supported.includes("S256"));
  const protectedResponse = await fetch("/.well-known/oauth-protected-resource/mcp");
  assert.equal(protectedResponse.status, 200, await protectedResponse.clone().text());
  const protectedMetadata = await protectedResponse.json();
  assert.equal(protectedMetadata.resource, resource);
  const unauth = await fetch("/mcp");
  assert.equal(unauth.status, 401);
  assert.match(unauth.headers.get("www-authenticate"), /resource_metadata/);
  const registration = await api("/oauth/register", "POST", { client_name: "Test connector <untrusted>", redirect_uris: ["https://client.example/callback"], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] });
  assert.equal(registration.status, 201, await registration.clone().text());
  const client = await registration.json();
  await api("/api/workspaces", "POST", { slug: "oauth-demo", name: "OAuth Demo" });
  await api("/api/workspaces", "POST", { slug: "oauth-other", name: "Other" });
  const user = (await (await fetch("/api/auth/me", { headers: { cookie: sessionCookie } })).json()).user;

  async function consent(role = "agent", cookie = sessionCookie, userId = user.id) {
    const verifier = randomBytes(32).toString("base64url");
    const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: "https://client.example/callback", response_type: "code", scope: "workspace:access offline_access", state: "state-test", resource, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" });
    const path = "/oauth/authorize?" + params;
    const login = await fetch(path);
    assert.equal(login.status, 302);
    assert.match(login.headers.get("location"), /\/app\?returnTo=/);
    const page = await fetch(path, { headers: { cookie } });
    assert.equal(page.status, 200, await page.clone().text());
    assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    const html = await page.text();
    assert(html.includes("Test connector &lt;untrusted&gt;"));
    assert(html.includes("client.example"));
    const handle = html.match(/name="handle" value="([^"]+)"/)[1];
    const binding = page.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
    const cookies = cookie.split(";")[0] + "; " + binding;
    return { path, params, verifier, cookies, body: { handle, user: userId, workspace: "oauth-demo", role, decision: "allow" } };
  }
  async function exchange(c, overrides = {}) {
    const approved = await formPost("/oauth/authorize", c.body, c.cookies);
    assert.equal(approved.status, 303, await approved.clone().text());
    const callback = new URL(approved.headers.get("location"));
    assert.equal(callback.searchParams.get("state"), "state-test");
    assert.equal(callback.searchParams.get("iss"), origin);
    const args = { grant_type: "authorization_code", client_id: client.client_id, redirect_uri: "https://client.example/callback", code: callback.searchParams.get("code"), code_verifier: c.verifier, resource, ...overrides };
    const response = await formPost("/oauth/token", args);
    return { response, args };
  }
  const initial = await consent();
  assert.equal((await formPost("/oauth/authorize", initial.body, initial.cookies, { origin: "https://evil.example" })).status, 403);
  assert.notEqual((await formPost("/oauth/authorize", initial.body, sessionCookie)).status, 303, "consent cookie must be required");
  assert.equal((await formPost("/oauth/authorize", { ...initial.body, workspace: "not-a-member" }, initial.cookies)).status, 403);
  const { response, args } = await exchange(initial);
  assert.equal(response.status, 200, await response.clone().text());
  const tokens = await response.json();
  assert.equal(tokens.expires_in, 900);
  assert(tokens.refresh_token);
  const mcp = async (method, params, id) => {
    const reply = await fetch("/mcp", { method: "POST", headers: { authorization: `Bearer ${tokens.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
    assert.equal(reply.status, 200, await reply.clone().text());
    const text = await reply.text();
    return JSON.parse(text.startsWith("event:") || text.startsWith("data:") ? text.split("\n").filter(line => line.startsWith("data: ")).map(line => line.slice(6)).join("\n") : text);
  };
  assert((await mcp("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "connector-test", version: "1" } }, 1)).result);
  assert.equal((await mcp("tools/list", {}, 2)).result.tools.length, 66);
  assert.match(JSON.stringify((await mcp("tools/call", { name: "cloud_workspace", arguments: {} }, 3)).result), /oauth-demo/);
  assert.notEqual((await formPost("/oauth/authorize", initial.body, initial.cookies)).status, 303, "consent handle replay");

  const rpc = (token, tool, input = {}) => fetch("/mcp?json=1", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ tool, input }) });
  const info = await rpc(tokens.access_token, "cloud_workspace");
  assert.equal(info.status, 200, await info.clone().text());
  assert.match(await info.text(), /oauth-demo/);
  assert.equal((await fetch("/mcp/oauth-other/info", { headers: { authorization: `Bearer ${tokens.access_token}` } })).status, 401, "OAuth tokens cannot access a different workspace");
  assert.equal((await rpc(tokens.access_token, "delete_team", { team: "test" })).status, 403, "no manager escalation");
  const refresh = await formPost("/oauth/token", { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.client_id, resource });
  assert.equal(refresh.status, 200, await refresh.clone().text());
  const refreshed = await refresh.json();
  const connections = await (await fetch("/api/connections?workspace=oauth-demo", { headers: { cookie: sessionCookie } })).json();
  assert.equal(connections.connections.length, 1);
  const id = connections.connections[0].id;
  assert.equal((await api(`/api/connections/${id}`, "DELETE")).status, 200);
  assert.equal((await rpc(refreshed.access_token, "cloud_workspace")).status, 401, "disconnect immediately blocks access");
  assert.equal((await formPost("/oauth/token", { grant_type: "refresh_token", refresh_token: refreshed.refresh_token, client_id: client.client_id, resource })).status, 400, "disconnect blocks refresh");
  assert.equal((await formPost("/oauth/token", args)).status, 400, "code replay");

  const read = await exchange(await consent("viewer"));
  assert.equal(read.response.status, 200);
  const readToken = (await read.response.json()).access_token;
  assert.equal((await rpc(readToken, "cloud_workspace")).status, 200);
  assert.equal((await rpc(readToken, "register", { name: "blocked-write" })).status, 403);
  const otherConsent = await consent("viewer");
  otherConsent.body.workspace = "oauth-other";
  const otherExchange = await exchange(otherConsent);
  assert.equal(otherExchange.response.status, 200);
  const otherToken = (await otherExchange.response.json()).access_token;
  assert.match(await (await rpc(otherToken, "cloud_workspace")).text(), /oauth-other/);
  assert.match(await (await rpc(readToken, "cloud_workspace")).text(), /oauth-demo/, "a second connection cannot switch the first grant's workspace");
  const wrongVerifier = await exchange(await consent(), { code_verifier: randomBytes(32).toString("base64url") });
  assert.equal(wrongVerifier.response.status, 400);
  const wrongAudience = await exchange(await consent(), { resource: "https://other.example/mcp" });
  assert.equal(wrongAudience.response.status, 400);
  const denied = await consent();
  const denial = await formPost("/oauth/authorize", { ...denied.body, decision: "deny" }, denied.cookies);
  assert.equal(denial.status, 303);
  assert.equal(new URL(denial.headers.get("location")).searchParams.get("error"), "access_denied");
  const badRedirect = await consent();
  badRedirect.params.set("redirect_uri", "https://evil.example/callback");
  assert.notEqual((await fetch("/oauth/authorize?" + badRedirect.params, { headers: { cookie: sessionCookie } })).status, 200);
  const noPkce = new URLSearchParams(badRedirect.params);
  noPkce.set("redirect_uri", "https://client.example/callback");
  noPkce.delete("code_challenge"); noPkce.delete("code_challenge_method");
  assert.notEqual((await fetch("/oauth/authorize?" + noPkce, { headers: { cookie: sessionCookie } })).status, 200);
  const signup = await api("/api/auth/signup", "POST", { email: "oauth-member@example.com", password: "test-member-password", name: "Member" });
  const memberCookie = signup.headers.get("set-cookie");
  const memberId = (await signup.json()).user.id;
  assert.equal((await api("/api/workspaces/oauth-demo/members", "POST", { email: "oauth-member@example.com", role: "agent" })).status, 201);
  const memberGrant = await exchange(await consent("agent", memberCookie, memberId));
  assert.equal(memberGrant.response.status, 200);
  const memberTokens = await memberGrant.response.json();
  const ownConnections = await (await fetch("/api/connections?workspace=oauth-demo", { headers: { cookie: memberCookie } })).json();
  assert.equal(ownConnections.connections.length, 1, "connection list must exclude other users");
  const ownId = ownConnections.connections[0].id;
  await api(`/api/connections/${ownId}`, "DELETE");
  assert.equal((await rpc(memberTokens.access_token, "cloud_workspace")).status, 200, "another user cannot revoke this connection");
  await api(`/api/workspaces/oauth-demo/members/${memberId}`, "PATCH", { role: "viewer" });
  assert.equal((await rpc(memberTokens.access_token, "register", { name: "demoted-write" })).status, 403);
  const viewerConsent = await consent("agent", memberCookie, memberId);
  assert.equal((await formPost("/oauth/authorize", viewerConsent.body, viewerConsent.cookies)).status, 403);
  await api(`/api/workspaces/oauth-demo/members/${memberId}`, "DELETE");
  assert.equal((await rpc(memberTokens.access_token, "cloud_workspace")).status, 401);
  assert.equal((await formPost("/oauth/token", { grant_type: "refresh_token", refresh_token: memberTokens.refresh_token, client_id: client.client_id, resource })).status, 400);
  if (process.env.AGENT_BUS_BROWSER_TEST === "1") {
    const { chromium } = await import(process.env.AGENT_BUS_PLAYWRIGHT_PATH || "playwright");
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const context = await browser.newContext();
      const cookiePair = sessionCookie.split(";")[0];
      const split = cookiePair.indexOf("=");
      await context.addCookies([{ name: cookiePair.slice(0, split), value: cookiePair.slice(split + 1), url: origin, httpOnly: true, secure: true, sameSite: "Lax" }]);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("https://client.example/**", route => route.fulfill({ status: 200, body: "Connected" }));
      const c = await consent("viewer");
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(origin + c.path);
        await page.getByRole("heading", { name: "Connect Test connector <untrusted>" }).waitFor();
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "consent overflow");
        await page.screenshot({ path: `/tmp/agent-bus-oauth-consent-${width}.png`, fullPage: true });
      }
      await page.locator('[name="workspace"]').selectOption("oauth-demo");
      assert((await context.cookies()).some(cookie => cookie.name.startsWith("__Host-oauth-consent")), "browser did not retain the secure consent cookie");
      const posted = page.waitForResponse(res => res.url().includes("/oauth/authorize") && res.request().method() === "POST");
      await page.getByRole("button", { name: "Allow connection" }).click();
      const postResponse = await posted;
      if (postResponse.status() !== 303) assert.fail(await postResponse.text());
      await page.waitForURL("https://client.example/**");
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(origin + "/app#connect");
      await page.locator("#workspace-select").selectOption("oauth-demo");
      await page.locator("#connection-list [data-disconnect]").first().waitFor();
      assert.equal(await page.locator("#oauth-mcp-output").textContent(), resource);
      await page.setViewportSize({ width: 390, height: 900 });
      await page.keyboard.press("Escape");
      await page.locator("#sidebar").waitFor({ state: "hidden" });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "connected apps overflow");
      await page.screenshot({ path: "/tmp/agent-bus-connected-apps-mobile.png", fullPage: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      page.on("dialog", dialog => dialog.accept());
      const removed = page.waitForResponse(res => res.url().includes("/api/connections/") && res.request().method() === "DELETE");
      await page.locator("#connection-list [data-disconnect]").first().click();
      assert.equal((await removed).status(), 200);
      for (const status of [200, 403]) {
        await page.locator("#workspace-select").selectOption("oauth-other");
        let release, started;
        const gate = new Promise(resolve => { release = resolve; });
        const requested = new Promise(resolve => { started = resolve; });
        const match = url => url.pathname === "/api/connections" && url.searchParams.get("workspace") === "oauth-demo";
        const handler = async route => {
          started(); await gate;
          await route.fulfill({ status, json: status === 200 ? { connections: [{ id: "old-id", client_name: "Private stale connection", role: "agent", expires_at: Date.now() }] } : { error: { message: "Old connection denied" } } });
        };
        await page.route(match, handler);
        await page.locator("#workspace-select").selectOption("oauth-demo");
        await requested;
        await page.locator("#workspace-select").selectOption("oauth-other");
        const finished = page.waitForResponse(res => match(new URL(res.url())));
        release(); await finished;
        await page.waitForTimeout(100);
        assert.doesNotMatch(await page.locator("#connection-list").textContent(), /Private stale|Old connection denied/);
        await page.unroute(match, handler);
      }
      assert.deepEqual(errors, []);
      await context.close();
      await api("/api/auth/signup", "POST", { email: "oauth-login@example.com", password: "browser-login-password", name: "Browser Login" });
      const loginContext = await browser.newContext();
      const loginPage = await loginContext.newPage();
      await loginPage.goto(origin + c.path);
      await loginPage.locator("#email").fill("oauth-login@example.com");
      await loginPage.locator("#password").fill("browser-login-password");
      await loginPage.getByRole("button", { name: "Log in", exact: true }).click();
      await loginPage.waitForURL("**/oauth/authorize?**");
      await loginPage.getByText("oauth-login@example.com", { exact: true }).waitFor();
      assert.equal(await loginPage.getByRole("button", { name: "Allow connection" }).count(), 0, "new user must create a workspace before consent");
      await loginContext.close();
      console.log("OAuth browser: desktop/mobile consent, approval and dashboard disconnect passed");
    } finally { await browser.close(); }
  }
  console.log("OAuth: discovery, consent, PKCE, replay, workspace isolation, read-only, refresh, revocation and denial passed");
}
