CREATE TABLE IF NOT EXISTS auth_identities (
  provider TEXT NOT NULL CHECK(provider IN ('google', 'github')),
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(provider, subject),
  UNIQUE(user_id, provider)
);

CREATE TABLE IF NOT EXISTS auth_login_states (
  state_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  provider TEXT NOT NULL,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  return_to TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_login_states_expiry ON auth_login_states(expires_at);
