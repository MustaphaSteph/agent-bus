import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { socialAuthRoute, resolveSocialIdentity, safeAuthReturn, configuredProviders } from "../src/auth/social";
import { createUser, verifyUserLogin } from "../src/auth/workspaces";
import { currentUser, createSessionCookie } from "../src/auth/session";
import { handleApi } from "../src/api/routes";
import { dashboardPage, accountPage } from "../src/web/pages";
import type { Env } from "../src/shared/types";

const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default { fetch() { return new Response('test'); } }", compatibilityDate: "2026-10-01", d1Databases: ["DB"] }));
const originalFetch = globalThis.fetch;
let checks = 0;
function check(value: unknown, message: string) { assert.ok(value, message); checks++; }
try {
  const db = await mf.getD1Database("DB");
  for (const file of readdirSync("migrations/d1").filter((p) => p.endsWith(".sql")).sort()) {
    for (const sql of readFileSync(`migrations/d1/${file}`, "utf8").split(";").filter((s) => s.trim())) await db.prepare(sql).run();
  }
  const env = { AGENT_BUS_CLOUD_DB: db, AGENT_BUS_CLOUD_ENV: "test", AGENT_BUS_CLOUD_AUTH_SECRET: "social-test-only", AUTH_PUBLIC_ORIGIN: "https://bus.example", GOOGLE_CLIENT_ID: "google-test", GOOGLE_CLIENT_SECRET: "test-only", GITHUB_CLIENT_ID: "github-test", GITHUB_CLIENT_SECRET: "test-only" } as unknown as Env;
  const user = await createUser(env, "existing@example.com", "password-test-only", "Existing");
  const session = (await createSessionCookie(env, user.id)).split(";")[0]!;
  await db.prepare("INSERT INTO workspaces(id, slug, name, created_by, created_at, updated_at) VALUES ('existing-ws', 'existing', 'Existing', ?, 1, 1)").bind(user.id).run();
  await db.prepare("INSERT INTO memberships(workspace_id, user_id, role, created_at) VALUES ('existing-ws', ?, 'owner', 1)").bind(user.id).run();

  let tokenRequests = 0;
  let githubId = 42;
  let githubEmail = "new@example.com";
  let verified = true;
  let fail = false;
  let googleNonce = "";
  let googleSubject = "google-123";
  let wrongNonce = false;
  const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/token") || url.endsWith("/access_token")) {
      tokenRequests++;
      if (fail) return json({ error: "invalid_grant", error_description: "NEVER_EXPOSE_SECRET" });
      const body = new URLSearchParams(String(init?.body));
      check(Boolean(body.get("code_verifier")), "PKCE verifier sent to token endpoint");
      if (url.includes("googleapis")) {
        const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
        const jwt = `${encode({alg: "RS256"})}.${encode({iss: "https://accounts.google.com", sub: "google-123", aud: "google-test", iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600, nonce: wrongNonce ? "wrong" : googleNonce})}.c2ln`;
        return json({ access_token: "test-google-access", token_type: "Bearer", expires_in: 3600, id_token: jwt });
      }
      return json({ access_token: "test-github-access", token_type: "Bearer", scope: "user:email" });
    }
    if (url === "https://api.github.com/user") return json({ id: githubId, name: "Test Person" });
    if (url === "https://api.github.com/user/emails") return json([{email: githubEmail, primary: true, verified}]);
    if (url === "https://openidconnect.googleapis.com/v1/userinfo") return json({sub: googleSubject, email: "google@example.com", email_verified: verified, name: "Google Test"});
    throw new Error(`Unexpected external request: ${url}`);
  };

  async function start(provider = "github", cookie = "", intent = "signin", returnTo = "/app") {
    const response = await socialAuthRoute(new Request(`https://bus.example/api/auth/${provider}/start`, {method: "POST", headers: { origin: "https://bus.example", cookie }, body: new URLSearchParams({intent, returnTo})}), env);
    assert.equal(response?.status, 303);
    const authorize = new URL(response!.headers.get("location")!);
    googleNonce = authorize.searchParams.get("nonce") || "";
    return { provider, authorize, state: authorize.searchParams.get("state")!, cookie: response!.headers.get("set-cookie")!.split(";")[0]! + (cookie ? `; ${cookie}` : "") };
  }
  async function finish(flow: Awaited<ReturnType<typeof start>>, extra = "code=test-code") {
    return (await socialAuthRoute(new Request(`https://bus.example/api/auth/${flow.provider}/callback?state=${flow.state}&${extra}`, { headers: {cookie: flow.cookie} }), env))!;
  }
  const flow = await start("github", "", "signin", "/oauth/authorize?client_id=test");
  check(flow.authorize.searchParams.get("scope") === "user:email", "GitHub requests no repository scope");
  check(flow.authorize.searchParams.get("code_challenge_method") === "S256", "S256 enabled");
  const wrongBrowser = await finish({...flow, cookie: "__Host-ab-login-github=wrong"});
  check(wrongBrowser.headers.get("location")?.includes("invalid_state"), "callback bound to browser");
  const good = await finish(flow);
  check(good.headers.get("location") === "/oauth/authorize?client_id=test", "MCP consent return preserved");
  const newSession = good.headers.getSetCookie().find((v) => v.startsWith("agent_bus_cloud_session="))!.split(";")[0]!;
  const socialUser = await currentUser(env, new Request("https://bus.example", {headers:{cookie:newSession}}));
  check(socialUser?.email === "new@example.com", "new social user signed in");
  await assert.rejects(verifyUserLogin(env, "new@example.com", "any-password")); checks++;
  const callsBeforeReplay = tokenRequests;
  check((await finish(flow)).headers.get("location")?.includes("invalid_state"), "replay rejected");
  check(tokenRequests === callsBeforeReplay, "replay never reaches token endpoint");
  const again = await finish(await start());
  check(again.headers.get("set-cookie")?.includes("agent_bus_cloud_session="), "existing social identity signs in");
  githubId = 43; githubEmail = "existing@example.com";
  check((await finish(await start())).headers.get("location")?.includes("link_required"), "email collision never silently links");
  check((await verifyUserLogin(env, "existing@example.com", "password-test-only")).id === user.id, "password account untouched");
  const link = await start("github", session, "link");
  check((await finish(link)).headers.get("location") === "/account", "authenticated account linking succeeds");
  check((await db.prepare("SELECT user_id FROM auth_identities WHERE provider='github' AND subject='43'").first())?.user_id === user.id, "identity bound to existing user");
  check((await db.prepare("SELECT role FROM memberships WHERE workspace_id='existing-ws' AND user_id=?").bind(user.id).first())?.role === "owner", "workspace ownership preserved");
  await assert.rejects(resolveSocialIdentity(env, "github", {subject:"42",email:"new@example.com",name:null}, user.id), /identity_in_use/); checks++;
  const changed = await start("google", session, "link");
  check((await finish({...changed,cookie: changed.cookie.split("; ")[0]!})).headers.get("location")?.includes("session_changed"), "link requires same logged-in session");
  const expired = await start();
  await db.prepare("UPDATE auth_login_states SET expires_at=1").run();
  check((await finish(expired)).headers.get("location")?.includes("invalid_state"), "expired state rejected");
  check((await finish(await start(), "error=access_denied")).headers.get("location")?.includes("access_denied"), "canceled consent handled");
  githubId = 50; githubEmail = "unverified@example.com"; verified = false;
  check((await finish(await start())).headers.get("location")?.includes("email_unverified"), "unverified GitHub email rejected");
  check((await finish(await start("google"))).headers.get("location")?.includes("email_unverified"), "unverified Google email rejected");
  verified = true; wrongNonce = true;
  check((await finish(await start("google"))).headers.get("location")?.includes("provider_failed"), "wrong Google nonce rejected");
  wrongNonce = false; googleSubject = "wrong-user";
  check((await finish(await start("google"))).headers.get("location")?.includes("provider_failed"), "Google userinfo subject must match ID token");
  googleSubject = "google-123";
  check((await finish(await start("google"))).headers.get("set-cookie")?.includes("agent_bus_cloud_session="), "Google sign-in succeeds");
  fail = true;
  const failure = await finish(await start());
  check(failure.headers.get("location")?.startsWith("/app?auth_error=provider_failed&"), "provider failures sanitized");
  check(!(await failure.text()).includes("NEVER_EXPOSE_SECRET"), "provider error contents not reflected"); fail = false;
  env.AUTH_SIGNUP_ENABLED = "false";
  check((await finish(await start())).headers.get("location")?.includes("signup_closed"), "new social registrations can be closed");
  githubId = 42; githubEmail = "new@example.com";
  check((await finish(await start())).headers.get("set-cookie")?.includes("agent_bus_cloud_session="), "existing social users can sign in when registration closed");
  const signupRequest = new Request("https://bus.example/api/auth/signup", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:"blocked@example.com",password:"password-test"})});
  await assert.rejects(handleApi(signupRequest, env, new URL(signupRequest.url)), /registration is currently closed/); checks++;
  await assert.rejects(socialAuthRoute(new Request("https://bus.example/api/auth/github/start",{method:"POST",headers:{origin:"https://attacker.example"}}),env), /Open Agent Bus directly/); checks++;
  await assert.rejects(socialAuthRoute(new Request("https://bus.example/api/auth/github/start"),env), /Start sign-in/); checks++;
  check(safeAuthReturn("//attacker.example") === "/app", "external redirect rejected");
  check(safeAuthReturn("/\\attacker.example") === "/app", "backslash redirect rejected");
  check(configuredProviders({...env,GITHUB_CLIENT_SECRET:undefined}).join() === "google", "incomplete providers hidden");
  const closedHtml = await (await dashboardPage(new Request("https://bus.example/app?mode=signup"), env)).text();
  check(!closedHtml.includes('id="name"') && closedHtml.includes("registration is currently closed"), "closed signup UI remains login");
  env.AUTH_SIGNUP_ENABLED = "true";
  const loginHtml = await (await dashboardPage(new Request("https://bus.example/app"), env)).text();
  check(!loginHtml.includes('id="name"') && loginHtml.includes('autocomplete="current-password"'), "login only asks email and password");
  check(loginHtml.includes("Continue with Google") && loginHtml.includes("Continue with GitHub"), "configured providers rendered");
  const signupHtml = await (await dashboardPage(new Request("https://bus.example/app?mode=signup"), env)).text();
  check(signupHtml.includes('id="name"') && signupHtml.includes('autocomplete="new-password"'), "signup has its own form");
  const accountHtml = await (await accountPage(new Request("https://bus.example/account",{headers:{cookie:session}}),env)).text();
  check(accountHtml.includes("Connected") && accountHtml.includes("Connect Google"), "account page exposes linked methods");
  console.log(`social auth: ${checks} checks passed (isolated D1, mocked providers)`);
} finally {
  globalThis.fetch = originalFetch;
  await mf.dispose();
}
