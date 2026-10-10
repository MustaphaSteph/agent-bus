export const WORKSPACE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS agents (
  name TEXT PRIMARY KEY,
  capabilities TEXT NOT NULL DEFAULT '[]',
  registered_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0,
  project TEXT,
  area TEXT,
  team TEXT,
  role TEXT,
  routing_weight INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'idle',
  session_id TEXT,
  removed_at INTEGER,
  bus_version TEXT,
  listening_until INTEGER
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('msg','ask','reply')),
  content TEXT NOT NULL,
  reply_to INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','delivered','answered')),
  created_at INTEGER NOT NULL,
  delivered_at INTEGER,
  replied_at INTEGER,
  thread_id TEXT,
  claim_deadline INTEGER,
  claimed_by TEXT,
  channel TEXT,
  project TEXT,
  area TEXT,
  team TEXT,
  priority TEXT NOT NULL DEFAULT 'normal'
);

CREATE TABLE IF NOT EXISTS subscriptions (
  channel TEXT NOT NULL,
  agent TEXT NOT NULL REFERENCES agents(name) ON DELETE CASCADE,
  subscribed_at INTEGER NOT NULL,
  PRIMARY KEY (channel, agent)
);

CREATE TABLE IF NOT EXISTS human_participants (
  name TEXT PRIMARY KEY,
  display_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS human_chat_requests (
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  result TEXT NOT NULL,
  PRIMARY KEY (user_id, request_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  thread_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  claimed_by TEXT,
  state TEXT NOT NULL CHECK (state IN ('backlog','open','claimed','working','blocked','completed','failed','canceled')),
  milestone TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  cwd TEXT,
  blocked_reason TEXT,
  blocked_on_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  result TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  claimed_at INTEGER,
  finished_at INTEGER,
  project TEXT,
  area TEXT,
  team TEXT,
  required_capability TEXT,
  mode TEXT NOT NULL DEFAULT 'edit_files',
  expected_output TEXT,
  deadline_at INTEGER,
  checkin_at INTEGER,
  final_answer TEXT,
  manager_reviewed INTEGER NOT NULL DEFAULT 0,
  file_scope TEXT NOT NULL DEFAULT '[]',
  ack_required INTEGER NOT NULL DEFAULT 0,
  acknowledged_at INTEGER,
  acknowledged_by TEXT,
  review_required INTEGER NOT NULL DEFAULT 0,
  independent_review INTEGER NOT NULL DEFAULT 0,
  review_state TEXT NOT NULL DEFAULT 'none',
  reviewed_by TEXT,
  review_notes TEXT,
  changed_files TEXT NOT NULL DEFAULT '[]',
  edit_scope TEXT NOT NULL DEFAULT '[]',
  read_scope TEXT NOT NULL DEFAULT '[]',
  pending_assignee TEXT,
  phase TEXT,
  session_id TEXT
);

CREATE TABLE IF NOT EXISTS task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  by_agent TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('note','phase','progress','log','result','cancel')),
  message TEXT NOT NULL,
  phase TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  project TEXT,
  area TEXT,
  team TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS test_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  by_agent TEXT NOT NULL,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  command TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed','failed','skipped')),
  output_summary TEXT,
  git_ref TEXT,
  cwd TEXT,
  project TEXT,
  area TEXT,
  team TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  by_agent TEXT NOT NULL,
  decision TEXT NOT NULL,
  rationale TEXT,
  implemented INTEGER NOT NULL DEFAULT 0,
  project TEXT,
  area TEXT,
  team TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  by_agent TEXT NOT NULL,
  agent TEXT,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  project TEXT,
  area TEXT,
  team TEXT,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  thread_id TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  supersedes_id INTEGER REFERENCES memories(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_to_status ON messages(to_agent, status, id);
CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_team ON messages(team);
CREATE INDEX IF NOT EXISTS idx_agents_team ON agents(team);
CREATE INDEX IF NOT EXISTS idx_agents_role ON agents(role);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_tasks_state_claimed ON tasks(state, claimed_by);
CREATE INDEX IF NOT EXISTS idx_tasks_requested_by ON tasks(requested_by);
CREATE INDEX IF NOT EXISTS idx_tasks_thread ON tasks(thread_id);
CREATE INDEX IF NOT EXISTS idx_tasks_team ON tasks(team);
CREATE INDEX IF NOT EXISTS idx_memories_team ON memories(team);
CREATE INDEX IF NOT EXISTS idx_decisions_team ON decisions(team);
`;
