import Database from "better-sqlite3";
import { dbPath } from "./util/paths.js";

let cached: Database.Database | null = null;

export function getDb(): Database.Database {
  if (cached) return cached;
  const db = new Database(dbPath());
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  cached = db;
  return db;
}

export function closeDb(): void {
  if (cached) {
    cached.close();
    cached = null;
  }
}

interface ColumnInfo {
  name: string;
}

function tableColumns(db: Database.Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
  return new Set(rows.map((r) => r.name));
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      name           TEXT PRIMARY KEY,
      capabilities   TEXT NOT NULL DEFAULT '[]',
      registered_at  INTEGER NOT NULL,
      last_seen      INTEGER NOT NULL,
      paused         INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS messages (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      from_agent    TEXT NOT NULL,
      to_agent      TEXT NOT NULL,
      kind          TEXT NOT NULL CHECK (kind IN ('msg','ask','reply')),
      content       TEXT NOT NULL,
      reply_to      INTEGER REFERENCES messages(id) ON DELETE SET NULL,
      status        TEXT NOT NULL CHECK (status IN ('pending','delivered','answered')),
      created_at    INTEGER NOT NULL,
      delivered_at  INTEGER,
      replied_at    INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_messages_to_status
      ON messages(to_agent, status, id);
    CREATE INDEX IF NOT EXISTS idx_messages_reply_to
      ON messages(reply_to);

    CREATE TABLE IF NOT EXISTS subscriptions (
      channel        TEXT NOT NULL,
      agent          TEXT NOT NULL REFERENCES agents(name) ON DELETE CASCADE,
      subscribed_at  INTEGER NOT NULL,
      PRIMARY KEY (channel, agent)
    );

    CREATE INDEX IF NOT EXISTS idx_subscriptions_channel
      ON subscriptions(channel);

    CREATE TABLE IF NOT EXISTS tasks (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      title               TEXT NOT NULL,
      description         TEXT,
      thread_id           TEXT NOT NULL,
      requested_by        TEXT NOT NULL REFERENCES agents(name),
      claimed_by          TEXT REFERENCES agents(name),
      state               TEXT NOT NULL CHECK (state IN ('open','claimed','working','blocked','completed','failed','canceled')),
      priority            INTEGER NOT NULL DEFAULT 0,
      cwd                 TEXT,
      blocked_reason      TEXT,
      blocked_on_task_id  INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      result              TEXT,
      created_at          INTEGER NOT NULL,
      updated_at          INTEGER NOT NULL,
      claimed_at          INTEGER,
      finished_at         INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_state_claimed
      ON tasks(state, claimed_by);
    CREATE INDEX IF NOT EXISTS idx_tasks_requested_by
      ON tasks(requested_by);
    CREATE INDEX IF NOT EXISTS idx_tasks_thread
      ON tasks(thread_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_blocked_on
      ON tasks(blocked_on_task_id);
  `);

  const messageCols = tableColumns(db, "messages");
  if (!messageCols.has("thread_id")) {
    db.exec(`ALTER TABLE messages ADD COLUMN thread_id TEXT`);
  }
  if (!messageCols.has("claim_deadline")) {
    db.exec(`ALTER TABLE messages ADD COLUMN claim_deadline INTEGER`);
  }
  if (!messageCols.has("claimed_by")) {
    db.exec(`ALTER TABLE messages ADD COLUMN claimed_by TEXT`);
  }
  if (!messageCols.has("channel")) {
    db.exec(`ALTER TABLE messages ADD COLUMN channel TEXT`);
  }
  if (!messageCols.has("project")) {
    db.exec(`ALTER TABLE messages ADD COLUMN project TEXT`);
  }
  if (!messageCols.has("area")) {
    db.exec(`ALTER TABLE messages ADD COLUMN area TEXT`);
  }
  if (!messageCols.has("priority")) {
    db.exec(`ALTER TABLE messages ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'`);
  }

  const agentCols = tableColumns(db, "agents");
  if (!agentCols.has("project")) {
    db.exec(`ALTER TABLE agents ADD COLUMN project TEXT`);
  }
  if (!agentCols.has("area")) {
    db.exec(`ALTER TABLE agents ADD COLUMN area TEXT`);
  }
  if (!agentCols.has("role")) {
    db.exec(`ALTER TABLE agents ADD COLUMN role TEXT`);
  }
  if (!agentCols.has("routing_weight")) {
    db.exec(`ALTER TABLE agents ADD COLUMN routing_weight INTEGER NOT NULL DEFAULT 0`);
  }
  if (!agentCols.has("status")) {
    db.exec(`ALTER TABLE agents ADD COLUMN status TEXT NOT NULL DEFAULT 'idle'`);
  }

  const taskCols = tableColumns(db, "tasks");
  if (!taskCols.has("project")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN project TEXT`);
  }
  if (!taskCols.has("area")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN area TEXT`);
  }
  if (!taskCols.has("required_capability")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN required_capability TEXT`);
  }
  if (!taskCols.has("mode")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN mode TEXT NOT NULL DEFAULT 'edit_files'`);
  }
  if (!taskCols.has("expected_output")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN expected_output TEXT`);
  }
  if (!taskCols.has("deadline_at")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN deadline_at INTEGER`);
  }
  if (!taskCols.has("checkin_at")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN checkin_at INTEGER`);
  }
  if (!taskCols.has("final_answer")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN final_answer TEXT`);
  }
  if (!taskCols.has("manager_reviewed")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN manager_reviewed INTEGER NOT NULL DEFAULT 0`);
  }
  if (!taskCols.has("file_scope")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN file_scope TEXT NOT NULL DEFAULT '[]'`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS decisions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      by_agent        TEXT NOT NULL REFERENCES agents(name),
      decision        TEXT NOT NULL,
      rationale       TEXT,
      implemented     INTEGER NOT NULL DEFAULT 0,
      project         TEXT,
      area            TEXT,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_thread
      ON messages(thread_id);
    CREATE INDEX IF NOT EXISTS idx_messages_claim
      ON messages(claim_deadline);
    CREATE INDEX IF NOT EXISTS idx_messages_project
      ON messages(project);
    CREATE INDEX IF NOT EXISTS idx_messages_area
      ON messages(area);
    CREATE INDEX IF NOT EXISTS idx_messages_priority
      ON messages(priority);
    CREATE INDEX IF NOT EXISTS idx_agents_project
      ON agents(project);
    CREATE INDEX IF NOT EXISTS idx_agents_area
      ON agents(area);
    CREATE INDEX IF NOT EXISTS idx_agents_role
      ON agents(role);
    CREATE INDEX IF NOT EXISTS idx_agents_status
      ON agents(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_project
      ON tasks(project);
    CREATE INDEX IF NOT EXISTS idx_tasks_area
      ON tasks(area);
    CREATE INDEX IF NOT EXISTS idx_tasks_required_capability
      ON tasks(required_capability);
    CREATE INDEX IF NOT EXISTS idx_tasks_mode
      ON tasks(mode);
    CREATE INDEX IF NOT EXISTS idx_tasks_manager_reviewed
      ON tasks(manager_reviewed);
    CREATE INDEX IF NOT EXISTS idx_decisions_scope
      ON decisions(project, area);
  `);
}
