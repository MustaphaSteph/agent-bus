import * as oauth from "oauth4webapi";
import type { Env } from "../shared/types";
import { newId, sha256Hex } from "../shared/ids";
import { HttpError } from "../shared/http";
import { createSessionCookie, currentUser, type AuthUser } from "./session";

export type SocialProvider = "google" | "github";
export const providers: SocialProvider[] = ["google", "github"];
const TTL = 10 * 60 * 1000;
const metadata: Record<SocialProvider, oauth.AuthorizationServer> = {
  google: { issuer: "https://accounts.google.com", authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth", token_endpoint: "https://oauth2.googleapis.com/token", userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo" },
  github: { issuer: "https://github.com", authorization_endpoint: "https://github.com/login/oauth/authorize", token_endpoint: "https://github.com/login/oauth/access_token" },
};
interface LoginState {
  provider: SocialProvider; verifier: string; nonce: string; return_to: string; user_id: string | null;
}
interface Identity { subject: string; email: string; name: string | null }

export function signupEnabled(env: Env): boolean { return env.AUTH_SIGNUP_ENABLED !== "false"; }
function credentials(env: Env, provider: SocialProvider) {
  return provider === "google"
    ? { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET }
    : { id: env.GITHUB_CLIENT_ID, secret: env.GITHUB_CLIENT_SECRET };
}
export function configuredProviders(env: Env): SocialProvider[] {
  return providers.filter((provider) => { const c = credentials(env, provider); return Boolean(c.id && c.secret && env.AUTH_PUBLIC_ORIGIN); });
}
export function safeAuthReturn(value: string | null): string {
  if (!value || /[\r\n\\]/.test(value)) return "/app";
  let url: URL;
  try { url = new URL(value, "https://return.invalid"); } catch { return "/app"; }
  if (url.origin !== "https://return.invalid") return "/app";
  return ["/app", "/account", "/oauth/authorize"].includes(url.pathname) ? url.pathname + url.search + url.hash : "/app";
}
function stateCookie(provider: SocialProvider, value: string, clear = false): string {
  return `__Host-ab-login-${provider}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${clear ? 0 : TTL / 1000}`;
}
function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, "cache-control": "no-store", "referrer-policy": "no-referrer" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}
export function assertAuthOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new HttpError(403, "AUTH_ORIGIN", "Open Agent Bus directly to sign in.");
  }
}

// Never merge accounts by email alone: existing password accounts have unverified emails.
export async function resolveSocialIdentity(env: Env, provider: SocialProvider, identity: Identity, linkUserId: string | null): Promise<AuthUser> {
  const db = env.AGENT_BUS_CLOUD_DB;
  const existing = await db.prepare("SELECT u.id, u.email, u.name FROM auth_identities i JOIN users u ON u.id = i.user_id WHERE i.provider = ? AND i.subject = ?").bind(provider, identity.subject).first<AuthUser>();
  if (existing) {
    if (linkUserId && existing.id !== linkUserId) throw new Error("identity_in_use");
    return existing;
  }
  if (linkUserId) {
    const user = await db.prepare("SELECT id, email, name FROM users WHERE id = ?").bind(linkUserId).first<AuthUser>();
    if (!user) throw new Error("session_changed");
    const linked = await db.prepare("SELECT subject FROM auth_identities WHERE user_id = ? AND provider = ?").bind(linkUserId, provider).first();
    if (linked) throw new Error("identity_in_use");
    await db.prepare("INSERT INTO auth_identities (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?)").bind(provider, identity.subject, user.id, Date.now()).run();
    return user;
  }
  const sameEmail = await db.prepare("SELECT id FROM users WHERE email = ?").bind(identity.email).first();
  if (sameEmail) throw new Error("link_required");
  if (!signupEnabled(env)) throw new Error("signup_closed");
  const user = { id: newId("usr"), email: identity.email, name: identity.name };
  const at = Date.now();
  await db.batch([
    db.prepare("INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)").bind(user.id, user.email, user.name, at, at),
    db.prepare("INSERT INTO auth_identities (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?)").bind(provider, identity.subject, user.id, at),
  ]);
  return user;
}

async function providerIdentity(provider: SocialProvider, c: { id: string; secret: string }, callback: URL, row: LoginState, callbackUri: string): Promise<Identity> {
  const as = metadata[provider];
  const client: oauth.Client = { client_id: c.id };
  const params = oauth.validateAuthResponse(as, client, callback, callback.searchParams.get("state")!);
  const response = await oauth.authorizationCodeGrantRequest(as, client, oauth.ClientSecretPost(c.secret), params, callbackUri, row.verifier, { signal: AbortSignal.timeout(15000) });
  const tokens = await oauth.processAuthorizationCodeResponse(as, client, response, provider === "google" ? { requireIdToken: true, expectedNonce: row.nonce } : {});
  let subject: string;
  let email: unknown;
  let name: unknown;
  if (provider === "google") {
    const claims = oauth.getValidatedIdTokenClaims(tokens);
    if (!claims) throw new Error("provider_failed");
    const infoResponse = await oauth.userInfoRequest(as, client, tokens.access_token, { signal: AbortSignal.timeout(15000) });
    const info = await oauth.processUserInfoResponse(as, client, claims.sub, infoResponse);
    if (info.email_verified !== true) throw new Error("email_unverified");
    subject = info.sub; email = info.email; name = info.name;
  } else {
    const headers = new Headers({ "user-agent": "Agent-Bus-Cloud", accept: "application/vnd.github+json" });
    const profileResponse = await oauth.protectedResourceRequest(tokens.access_token, "GET", new URL("https://api.github.com/user"), headers, undefined, { signal: AbortSignal.timeout(15000) });
    const emailResponse = await oauth.protectedResourceRequest(tokens.access_token, "GET", new URL("https://api.github.com/user/emails"), headers, undefined, { signal: AbortSignal.timeout(15000) });
    if (!profileResponse.ok || !emailResponse.ok) throw new Error("provider_failed");
    const profile = await profileResponse.json() as { id?: number; name?: string; login?: string };
    const emails = await emailResponse.json() as { email: string; primary: boolean; verified: boolean }[];
    if (!Number.isSafeInteger(profile.id) || !Array.isArray(emails)) throw new Error("provider_failed");
    const primary = emails.find((item) => item.primary && item.verified);
    if (!primary) throw new Error("email_unverified");
    subject = String(profile.id); email = primary.email; name = profile.name || profile.login;
  }
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !subject) throw new Error("email_unverified");
  return { subject, email: email.trim().toLowerCase(), name: typeof name === "string" ? name.slice(0, 200) : null };
}

export async function socialAuthRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/auth\/(google|github)\/(start|callback)$/);
  if (!match) return null;
  const provider = match[1] as SocialProvider;
  if (!configuredProviders(env).includes(provider)) return redirect("/app?auth_error=provider_unavailable");
  const c = credentials(env, provider) as { id: string; secret: string };
  const origin = new URL(env.AUTH_PUBLIC_ORIGIN!).origin;
  if (url.origin !== origin) throw new HttpError(400, "AUTH_HOST", "Use the configured Agent Bus address to sign in.");
  const callbackUri = `${origin}/api/auth/${provider}/callback`;
  if (match[2] === "start") {
    if (request.method !== "POST") throw new HttpError(405, "METHOD_NOT_ALLOWED", "Start sign-in from the Agent Bus login page.");
    assertAuthOrigin(request);
    const input = await request.formData();
    const link = input.get("intent") === "link";
    const user = await currentUser(env, request);
    if (link && !user) return redirect("/app?returnTo=%2Faccount");
    if (!link && user) return redirect(safeAuthReturn(String(input.get("returnTo") || "/app")));
    const state = oauth.generateRandomState();
    const browser = oauth.generateRandomState();
    const verifier = oauth.generateRandomCodeVerifier();
    const nonce = oauth.generateRandomNonce();
    const returnTo = link ? "/account" : safeAuthReturn(String(input.get("returnTo") || "/app"));
    await env.AGENT_BUS_CLOUD_DB.batch([
      env.AGENT_BUS_CLOUD_DB.prepare("DELETE FROM auth_login_states WHERE expires_at < ?").bind(Date.now()),
      env.AGENT_BUS_CLOUD_DB.prepare("INSERT INTO auth_login_states (state_hash, browser_hash, provider, verifier, nonce, return_to, user_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(await sha256Hex(state), await sha256Hex(browser), provider, verifier, nonce, returnTo, link ? user!.id : null, Date.now() + TTL),
    ]);
    const authorize = new URL(metadata[provider].authorization_endpoint!);
    authorize.search = new URLSearchParams({ client_id: c.id, redirect_uri: callbackUri, response_type: "code", state, code_challenge: await oauth.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256", scope: provider === "google" ? "openid email profile" : "user:email" }).toString();
    if (provider === "google") { authorize.searchParams.set("nonce", nonce); authorize.searchParams.set("prompt", "select_account"); }
    return redirect(authorize.href, [stateCookie(provider, browser)]);
  }
  if (request.method !== "GET") throw new HttpError(405, "METHOD_NOT_ALLOWED", "Invalid sign-in callback.");
  const clear = stateCookie(provider, "", true);
  let returnTo = "/app";
  let retryReturn = "/app";
  try {
    const state = url.searchParams.get("state");
    const browser = (request.headers.get("cookie") || "").split(";").map((v) => v.trim()).find((v) => v.startsWith(`__Host-ab-login-${provider}=`))?.split("=")[1];
    if (!state || !browser || state.length > 512) throw new Error("invalid_state");
    // D1's atomic DELETE RETURNING prevents callback replay, including concurrent requests.
    const row = await env.AGENT_BUS_CLOUD_DB.prepare("DELETE FROM auth_login_states WHERE state_hash = ? AND browser_hash = ? AND provider = ? AND expires_at > ? RETURNING provider, verifier, nonce, return_to, user_id").bind(await sha256Hex(state), await sha256Hex(browser), provider, Date.now()).first<LoginState>();
    if (!row) throw new Error("invalid_state");
    returnTo = row.user_id ? "/account" : "/app";
    retryReturn = safeAuthReturn(row.return_to);
    if (url.searchParams.has("error")) throw new Error("access_denied");
    const user = await currentUser(env, request);
    if ((row.user_id && user?.id !== row.user_id) || (!row.user_id && user)) throw new Error("session_changed");
    const identity = await providerIdentity(provider, c, url, row, callbackUri);
    const authenticated = await resolveSocialIdentity(env, provider, identity, row.user_id);
    return redirect(row.return_to, [clear, await createSessionCookie(env, authenticated.id)]);
  } catch (error) {
    const known = ["invalid_state", "access_denied", "session_changed", "link_required", "identity_in_use", "email_unverified", "signup_closed"];
    const code = error instanceof Error && known.includes(error.message) ? error.message : "provider_failed";
    // Provider errors can contain credentials; return only our fixed public error codes.
    return redirect(`${returnTo}?auth_error=${code}&returnTo=${encodeURIComponent(retryReturn)}`, [clear]);
  }
}

export const socialErrorMessages: Record<string, string> = {
  invalid_state: "This sign-in link expired or was already used. Please try again.",
  access_denied: "Sign-in was canceled. You can try again or use email.",
  session_changed: "Your signed-in account changed. Please start again.",
  link_required: "This email already has an account. Sign in with your existing method, then link this provider in Account.",
  identity_in_use: "This sign-in identity is already linked. No account was changed.",
  email_unverified: "Verify your primary email with this provider before continuing.",
  signup_closed: "New account registration is currently closed. Existing users can still sign in.",
  provider_unavailable: "This sign-in provider is not available yet. Please use email.",
  provider_failed: "We couldn't complete sign-in. Please try again.",
};
