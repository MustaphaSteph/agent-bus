# Website Sign-In

Website login is separate from the MCP OAuth server. Google/GitHub authenticate
the person; Agent Bus then asks them which workspace an MCP client may access.
Existing password accounts, workspace memberships, tokens, and connected MCP
clients are preserved.

## Pages

- `/app`: login with email/password or configured Google/GitHub sign-in.
- `/app?mode=signup`: a separate signup form. Name is optional and only shown here.
- `/account`: signed-in users can link an additional sign-in method.
- Successful social login creates a normal 30-day Agent Bus session.
- New social users do not need to invent an Agent Bus password.

An email match does not automatically merge accounts. Password-account emails
were not verified, so automatic linking would risk account takeover. Sign in
with the existing method, open Account, then connect Google/GitHub. Linking
requires the same signed-in user throughout the callback. Provider identities
cannot be transferred from another account or silently replaced.

## Deployment Configuration

Run from `apps/cloud`. Apply migration `0004_social_login.sql` before deployment:

```sh
npx wrangler d1 migrations apply agent-bus-cloud --remote
```

Set `AUTH_PUBLIC_ORIGIN` to the exact HTTPS site origin in `wrangler.toml`.
`AUTH_SIGNUP_ENABLED = "true"` permits new accounts via both email and social
login. Set it to `"false"` to close registration without blocking existing users
or authenticated account linking. This is an operator setting, not a workspace
owner permission. It defaults to enabled for existing installations.

### Google

In Google Auth Platform, configure an external application with the correct
product name, support email, homepage and required policy URLs. Create a Web
application OAuth client and register this exact redirect URI:

```text
https://agent-bus-cloud.mustapha-achtaou.workers.dev/api/auth/google/callback
```

Only `openid email profile` scopes are requested. A testing-mode application may
be restricted to configured test users. Complete Google's publication and
verification requirements before presenting it as publicly available.

```sh
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

### GitHub

Create a dedicated OAuth App, not a personal access token or repository app.
Homepage: the public Agent Bus site. Register the exact callback:

```text
https://agent-bus-cloud.mustapha-achtaou.workers.dev/api/auth/github/callback
```

Disable wildcard redirects and device flow. Only `user:email` is requested;
repository, organization and workflow permissions are not needed.

```sh
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
```

Do not put secrets in source, screenshots, command arguments, issue reports, or
chat. The UI only displays a provider when its ID, secret and public origin are
configured. Use separate OAuth clients and bindings for development/staging.

## Security and Tests

- Authorization code flow with PKCE S256 for both providers and Google nonce.
- Ten-minute, browser-bound, single-use state consumed atomically in D1.
- HttpOnly, Secure, SameSite=Lax state and session cookies.
- Fixed provider endpoints and configured callback origin; no arbitrary redirects.
- Verified primary GitHub email; verified Google email and matching OIDC subject.
- Access tokens are used transiently to fetch identity, never persisted or logged.
- Sign-in errors are sanitized. Existing account records are not overwritten.
- Login/signup/linking POSTs reject cross-origin browser requests.
- Authenticated pages and auth redirects are not cached.

`npm run test:social` uses isolated D1 and mocked providers to exercise both
callbacks, failures, replay, identity collisions, account linking, signup policy
and forms. `npm run check` also covers existing Cloud and MCP flows.

After configuring real provider credentials, manually test new-user sign-in,
existing-user sign-in, Account linking and the MCP consent return path. Mocked
tests do not verify Google/GitHub console configuration or real account consent.
