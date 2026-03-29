'use strict';
require('dotenv').config();

const express = require('express');
const db = require('./db');
const { isValidTransition } = require('./state-machine');
const { notifyState } = require('./notify');
const { startTimeouts } = require('./timeouts');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3210;

// POST /tasks
app.post('/tasks', async (req, res) => {
  const { title, repo, origin, brandon_chat_id, discord_channel } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });

  const id = `OC-${Date.now()}`;
  db.prepare(`
    INSERT INTO tasks (id, title, repo, origin, brandon_chat_id, discord_channel, state)
    VALUES (?, ?, ?, ?, ?, ?, 'brief_received')
  `).run(id, title, repo || null, origin || null, brandon_chat_id || null, discord_channel || null);

  db.prepare(`INSERT INTO events (task_id, event_type, payload) VALUES (?, ?, ?)`).run(id, 'created', null);

  const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
  await notifyState(task, 'brief_received').catch(() => {});

  res.json({ task_id: id });
});

// POST /tasks/:id/state
app.post('/tasks/:id/state', async (req, res) => {
  const { id } = req.params;
  const { state, payload } = req.body;

  const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (!isValidTransition(task.state, state)) {
    return res.status(400).json({ error: `Invalid transition: ${task.state} → ${state}` });
  }

  db.prepare(`UPDATE tasks SET state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(state, id);
  db.prepare(`INSERT INTO events (task_id, event_type, payload) VALUES (?, ?, ?)`).run(id, state, payload ? String(payload) : null);

  const updated = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
  await notifyState(updated, state, payload ? { reason: payload } : {}).catch(() => {});

  res.json({ task_id: id, state });
});

// GET /tasks/active  — must come before /tasks/:id
app.get('/tasks/active', (req, res) => {
  const tasks = db.prepare(`
    SELECT * FROM tasks
    WHERE state NOT IN ('completed', 'blocked')
    ORDER BY created_at DESC
  `).all();
  res.json(tasks);
});

// GET /tasks/:id
app.get('/tasks/:id', (req, res) => {
  const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const events = db.prepare(`SELECT * FROM events WHERE task_id = ? ORDER BY created_at ASC`).all(req.params.id);
  res.json({ ...task, events });
});

// POST /tasks/:id/pr
app.post('/tasks/:id/pr', async (req, res) => {
  const { id } = req.params;
  const { pr_number, pr_url } = req.body;

  const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (!isValidTransition(task.state, 'pr_opened')) {
    return res.status(400).json({ error: `Invalid transition: ${task.state} → pr_opened` });
  }

  db.prepare(`UPDATE tasks SET pr_number = ?, pr_url = ?, state = 'pr_opened', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(pr_number || null, pr_url || null, id);
  db.prepare(`INSERT INTO events (task_id, event_type, payload) VALUES (?, ?, ?)`).run(id, 'pr_opened', pr_url || null);

  const updated = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
  await notifyState(updated, 'pr_opened').catch(() => {});

  res.json({ task_id: id, state: 'pr_opened' });
});

// POST /tasks/:id/verdict
app.post('/tasks/:id/verdict', async (req, res) => {
  const { id } = req.params;
  const { verdict, issues } = req.body;

  const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const newState = verdict === 'approved' ? 'review_approved' : 'review_changes_requested';

  if (!isValidTransition(task.state, newState)) {
    return res.status(400).json({ error: `Invalid transition: ${task.state} → ${newState}` });
  }

  db.prepare(`UPDATE tasks SET state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(newState, id);
  db.prepare(`INSERT INTO events (task_id, event_type, payload) VALUES (?, ?, ?)`).run(id, newState, issues || null);

  const updated = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
  await notifyState(updated, newState, { issues }).catch(() => {});

  res.json({ task_id: id, state: newState });
});

// POST /tasks/:id/deployed
app.post('/tasks/:id/deployed', async (req, res) => {
  const { id } = req.params;
  const { deploy_url } = req.body;

  const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (!isValidTransition(task.state, 'deployed')) {
    return res.status(400).json({ error: `Invalid transition: ${task.state} → deployed` });
  }

  db.prepare(`UPDATE tasks SET deploy_url = ?, state = 'deployed', updated_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(deploy_url || null, id);
  db.prepare(`INSERT INTO events (task_id, event_type, payload) VALUES (?, ?, ?)`).run(id, 'deployed', deploy_url || null);

  const updated = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
  await notifyState(updated, 'deployed').catch(() => {});

  res.json({ task_id: id, state: 'deployed' });
});

// POST /events
app.post('/events', (req, res) => {
  const { task_id, event_type, payload } = req.body;
  if (!task_id || !event_type) return res.status(400).json({ error: 'task_id and event_type are required' });

  const task = db.prepare(`SELECT id FROM tasks WHERE id = ?`).get(task_id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const result = db.prepare(`INSERT INTO events (task_id, event_type, payload) VALUES (?, ?, ?)`).run(task_id, event_type, payload ? String(payload) : null);
  res.json({ event_id: result.lastInsertRowid });
});

// GET /health
app.get('/health', (req, res) => {
  const row = db.prepare(`SELECT COUNT(*) as count FROM tasks WHERE state NOT IN ('completed', 'blocked')`).get();
  res.json({ status: 'ok', uptime: process.uptime(), tasks_active: row.count });
});

app.listen(PORT, () => {
  startTimeouts();
});
