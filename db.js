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
    type TEXT NOT NULL DEFAULT 'build',
    pr_number INTEGER,
    pr_url TEXT,
    deploy_url TEXT,
    brandon_chat_id TEXT,
    discord_channel TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
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
`);

// Add `type` column to existing databases (idempotent)
try {
  db.exec(`ALTER TABLE tasks ADD COLUMN type TEXT NOT NULL DEFAULT 'build'`);
} catch (e) {
  if (!e.message.includes('duplicate column')) throw e;
}

module.exports = db;
