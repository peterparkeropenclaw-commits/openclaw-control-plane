'use strict';
require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'control-plane.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    repo TEXT,
    origin TEXT,
    owner TEXT DEFAULT 'peter',
    state TEXT DEFAULT 'brief_received',
    pr_number INTEGER,
    pr_url TEXT,
    deploy_url TEXT,
    brandon_chat_id TEXT,
    discord_channel TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_progress_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME DEFAULT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  );

  CREATE TABLE IF NOT EXISTS escalations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    acked_at DATETIME,
    resolved_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS action_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    status TEXT DEFAULT 'pending',
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 5,
    not_before DATETIME NULL,
    locked_at DATETIME NULL,
    locked_by TEXT NULL,
    last_error TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_aq_status_notbefore ON action_queue(status, not_before);
  CREATE INDEX IF NOT EXISTS idx_aq_task ON action_queue(task_id);

  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    agent TEXT,
    memory_type TEXT NOT NULL,
    content TEXT NOT NULL,
    importance INTEGER DEFAULT 5,
    created_at DATETIME DEFAULT (datetime('now')),
    expires_at DATETIME,
    task_id TEXT,
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  );

  CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope);
  CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type);
  CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);

  CREATE INDEX IF NOT EXISTS idx_tasks_state
    ON tasks(state);

  CREATE INDEX IF NOT EXISTS idx_tasks_state_pr
    ON tasks(state, pr_number)
    WHERE pr_number IS NOT NULL;

  CREATE TABLE IF NOT EXISTS worker_registry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_type TEXT NOT NULL UNIQUE,
    worker_script TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT 'gpt-4.1',
    max_tokens INTEGER DEFAULT 16000,
    timeout_seconds INTEGER DEFAULT 300,
    max_attempts INTEGER DEFAULT 3,
    prompt_template TEXT NOT NULL DEFAULT '{}',
    expected_output_fields TEXT NOT NULL DEFAULT '[]',
    routable_states TEXT NOT NULL DEFAULT '[]',
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS task_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 1,
    worker_type TEXT NOT NULL,
    status TEXT NOT NULL,
    result_json TEXT,
    branch TEXT,
    commit_sha TEXT,
    pr_number INTEGER,
    pr_url TEXT,
    changed_files TEXT,
    summary TEXT,
    error TEXT,
    spawned_at DATETIME,
    completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  );
`);

// Add columns to tasks table if missing
const addColIfMissing = (table, col, definition) => {
  const cols = db.pragma(`table_info(${table})`).map(c => c.name);
  if (!cols.includes(col)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${definition}`).run();
    console.log(`[db] Added column ${table}.${col}`);
  }
};

addColIfMissing('tasks', 'task_type', "TEXT DEFAULT 'build'");
addColIfMissing('tasks', 'briefing', 'TEXT');
addColIfMissing('tasks', 'constraints', 'TEXT');
addColIfMissing('tasks', 'acceptance_criteria', 'TEXT');
addColIfMissing('tasks', 'verification_steps', 'TEXT');
addColIfMissing('tasks', 'base_branch', "TEXT DEFAULT 'main'");
addColIfMissing('tasks', 'attempt_count', 'INTEGER DEFAULT 0');
addColIfMissing('tasks', 'worker_locked_until', 'DATETIME');
addColIfMissing('tasks', 'risk_level', "TEXT DEFAULT 'low'");

// Seed build worker in registry if not present
const existingBuild = db.prepare('SELECT id FROM worker_registry WHERE task_type = ?').get('build');
if (!existingBuild) {
  db.prepare(`
    INSERT INTO worker_registry (task_type, worker_script, model, timeout_seconds, max_attempts, prompt_template, expected_output_fields, routable_states)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'build',
    '/Users/robotmac/workspace/builder-worker/index.js',
    'gpt-4.1',
    300,
    3,
    'You are a software engineer. Write production-quality code. No placeholders. No demo content.',
    JSON.stringify(['status', 'branch', 'commit', 'pr_number', 'pr_url', 'changed_files', 'summary', 'error']),
    JSON.stringify(['contract_written', 'review_changes_requested', 'qa_failed'])
  );
  console.log('[db] Seeded build worker in worker_registry');
}

module.exports = db;
