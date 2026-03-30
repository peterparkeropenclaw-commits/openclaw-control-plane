'use strict';
require('dotenv').config();

const express = require('express');
const db = require('./db');
const { isValidTransition } = require('./state-machine');
const { notifyState, sendAlert } = require('./notify');
const { startTimeouts } = require('./timeouts');
const { generateDashboardHTML } = require('./dashboard');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3210;
const ACTION_TYPES = new Set(['merge_pr', 'trigger_deploy', 'verify_deploy', 'notify_telegram']);

function getExistingAction(taskId, actionType) {
  return db.prepare(
    `SELECT * FROM action_queue WHERE task_id = ? AND action_type = ? AND status IN ('pending', 'claimed') ORDER BY created_at ASC LIMIT 1`
  ).get(taskId, actionType);
}

function enqueueAction({ taskId, actionType, payload, notBeforeSeconds } = {}) {
  const existing = getExistingAction(taskId, actionType);
  if (existing) return { existing, deduplicated: true };

  const payloadJson = JSON.stringify(payload || {});

  if (Number.isFinite(notBeforeSeconds) && notBeforeSeconds > 0) {
    const delay = `+${Math.floor(notBeforeSeconds)} seconds`;
    const result = db.prepare(`
      INSERT INTO action_queue (task_id, action_type, payload_json, status, not_before, updated_at)
      VALUES (?, ?, ?, 'pending', datetime('now', ?), CURRENT_TIMESTAMP)
    `).run(taskId, actionType, payloadJson, delay);
    return { action_id: result.lastInsertRowid, deduplicated: false };
  }

  const result = db.prepare(`
    INSERT INTO action_queue (task_id, action_type, payload_json, status, updated_at)
    VALUES (?, ?, ?, 'pending', CURRENT_TIMESTAMP)
  `).run(taskId, actionType, payloadJson);
  return { action_id: result.lastInsertRowid, deduplicated: false };
}


// POST /tasks
app.post('/tasks', async (req, res) => {
  const { title, repo, origin, brandon_chat_id, discord_channel } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });

  const existing = db.prepare(
    `SELECT id FROM tasks WHERE title = ? AND repo = ? AND created_at > datetime('now', '-60 seconds')`
  ).get(title, repo || null);
  if (existing) return res.json({ task_id: existing.id, deduplicated: true });

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

// POST /tasks/:id/validate-brief
app.post('/tasks/:id/validate-brief', async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};

  const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const missing = [];

  if (typeof body.objective !== 'string' || body.objective.length < 20) missing.push('objective');
  if (typeof body.scope !== 'string' || body.scope.length < 1) missing.push('scope');
  if (typeof body.constraints !== 'string' || body.constraints.length < 1) missing.push('constraints');
  if (!Array.isArray(body.acceptance_criteria) || body.acceptance_criteria.length < 2) missing.push('acceptance_criteria');
  if (!Array.isArray(body.verification_steps) || body.verification_steps.length < 1) missing.push('verification_steps');
  if (typeof body.repo !== 'string' || body.repo.length < 1) missing.push('repo');
  if (!['low', 'medium', 'high'].includes(body.risk_level)) missing.push('risk_level');

  if (missing.length > 0) {
    db.prepare(`UPDATE tasks SET state = 'blocked', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
    db.prepare(`INSERT INTO events (task_id, event_type, payload) VALUES (?, ?, ?)`).run(
      id, 'brief_rejected', JSON.stringify({ missing })
    );

    const chatId = task.brandon_chat_id || process.env.BRANDON_CHAT_ID;
    await sendAlert(
      chatId,
      `⚠️ Brief for OC-${id} rejected.\nMissing: ${missing.join(', ')}\nComplete brief before dispatching Builder.`
    ).catch(() => {});

    return res.status(400).json({ error: `Brief rejected: missing ${missing.join(', ')}` });
  }

  const briefPayload = JSON.stringify({
    objective: body.objective,
    scope: body.scope,
    constraints: body.constraints,
    acceptance_criteria: body.acceptance_criteria,
    verification_steps: body.verification_steps,
    repo: body.repo,
    risk_level: body.risk_level
  });

  db.prepare(`UPDATE tasks SET state = 'contract_written', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
  db.prepare(`INSERT INTO events (task_id, event_type, payload) VALUES (?, ?, ?)`).run(id, 'brief_validated', briefPayload);

  return res.json({ task_id: id, state: 'contract_written', approved: true });
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

  const existingVerdict = db.prepare(
    `SELECT id FROM events WHERE task_id = ? AND event_type = 'verdict_received' AND created_at > datetime('now', '-5 minutes')`
  ).get(id);
  if (existingVerdict) return res.json({ task_id: id, state: task.state, deduplicated: true });

  const newState = verdict === 'approved' ? 'review_approved' : 'review_changes_requested';

  if (!isValidTransition(task.state, newState)) {
    return res.status(400).json({ error: `Invalid transition: ${task.state} → ${newState}` });
  }

  db.prepare(`UPDATE tasks SET state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(newState, id);
  db.prepare(`INSERT INTO events (task_id, event_type, payload) VALUES (?, ?, ?)`).run(id, 'verdict_received', verdict);
  db.prepare(`INSERT INTO events (task_id, event_type, payload) VALUES (?, ?, ?)`).run(id, newState, issues || null);

  const updated = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
  await notifyState(updated, newState, { issues }).catch(() => {});

  if (verdict === 'approved') {
    enqueueAction({
      taskId: id,
      actionType: 'merge_pr',
      payload: { pr_number: updated.pr_number, pr_url: updated.pr_url, repo: updated.repo }
    });
  }

  if (verdict === 'changes_requested') {
    enqueueAction({
      taskId: id,
      actionType: 'notify_telegram',
      payload: { message_type: 'changes_requested', pr_number: updated.pr_number, task_id: id }
    });
  }

  res.json({ task_id: id, state: newState });
});

// POST /tasks/:id/deployed
app.post('/tasks/:id/deployed', async (req, res) => {
  const { id } = req.params;
  const { deploy_url } = req.body;

  const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const existingDeploy = db.prepare(
    `SELECT id FROM events WHERE task_id = ? AND event_type = 'deployed' AND created_at > datetime('now', '-60 seconds')`
  ).get(id);
  if (existingDeploy) return res.json({ task_id: id, state: task.state, deduplicated: true });

  if (!isValidTransition(task.state, 'deployed')) {
    return res.status(400).json({ error: `Invalid transition: ${task.state} → deployed` });
  }

  db.prepare(`UPDATE tasks SET deploy_url = ?, state = 'deployed', updated_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(deploy_url || null, id);
  db.prepare(`INSERT INTO events (task_id, event_type, payload) VALUES (?, ?, ?)`).run(id, 'deployed', deploy_url || null);

  const updated = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
  await notifyState(updated, 'deployed').catch(() => {});

  // Enqueue verify_deploy via action queue — verify-worker owns verification, not inline code.
  // Short not_before delay gives Vercel time to propagate; verify-worker retries on failure.
  enqueueAction({
    taskId: id,
    actionType: 'verify_deploy',
    payload: { deploy_url: updated.deploy_url || '' },
    notBeforeSeconds: 60
  });

  res.json({ task_id: id, state: 'deployed' });
});


// POST /tasks/:id/actions
app.post('/tasks/:id/actions', (req, res) => {
  const { id } = req.params;
  const { action_type, payload, not_before_seconds } = req.body || {};

  if (!ACTION_TYPES.has(action_type)) {
    return res.status(400).json({ error: 'Invalid action_type' });
  }

  const task = db.prepare(`SELECT id FROM tasks WHERE id = ?`).get(id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const existing = getExistingAction(id, action_type);
  if (existing) return res.status(409).json({ error: 'Action already pending or claimed' });

  const parsedNotBefore = Number(not_before_seconds);
  const result = enqueueAction({
    taskId: id,
    actionType: action_type,
    payload: payload || {},
    notBeforeSeconds: Number.isFinite(parsedNotBefore) ? parsedNotBefore : undefined
  });

  if (result.existing) {
    return res.status(409).json({ error: 'Action already pending or claimed' });
  }

  return res.json({ action_id: result.action_id, task_id: id, action_type, status: 'pending' });
});

// GET /actions/pending
app.get('/actions/pending', (req, res) => {
  const actions = db.prepare(`
    SELECT * FROM action_queue
    WHERE status = 'pending'
      AND (not_before IS NULL OR not_before <= datetime('now'))
    ORDER BY created_at ASC
    LIMIT 20
  `).all();
  res.json(actions);
});

// POST /actions/:id/claim
app.post('/actions/:id/claim', (req, res) => {
  const { id } = req.params;
  const { worker_id } = req.body || {};

  if (!worker_id) return res.status(400).json({ error: 'worker_id is required' });

  const result = db.prepare(`
    UPDATE action_queue
    SET status = 'claimed', locked_at = CURRENT_TIMESTAMP, locked_by = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'pending' AND (not_before IS NULL OR not_before <= datetime('now'))
  `).run(worker_id, id);

  if (result.changes === 0) {
    return res.status(409).json({ error: 'already claimed or not pending' });
  }

  const action = db.prepare(`SELECT * FROM action_queue WHERE id = ?`).get(id);
  return res.json(action);
});

// POST /actions/:id/complete
app.post('/actions/:id/complete', (req, res) => {
  const { id } = req.params;

  const action = db.prepare(`SELECT * FROM action_queue WHERE id = ?`).get(id);
  if (!action) return res.status(404).json({ error: 'Action not found' });

  db.prepare(`UPDATE action_queue SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
  db.prepare(`INSERT INTO events (task_id, event_type, payload) VALUES (?, ?, ?)`).run(
    action.task_id, 'action_complete', action.action_type
  );

  return res.json({ action_id: id, status: 'completed' });
});

// POST /actions/:id/fail
app.post('/actions/:id/fail', (req, res) => {
  const { id } = req.params;
  const { error, retry_after_seconds } = req.body || {};

  const action = db.prepare(`SELECT * FROM action_queue WHERE id = ?`).get(id);
  if (!action) return res.status(404).json({ error: 'Action not found' });

  const newAttempts = Number(action.attempts || 0) + 1;
  const maxAttempts = Number(action.max_attempts || 5);
  const lastError = error ? String(error) : 'unknown error';

  let status = 'pending';
  let willRetry = true;
  let delaySeconds = null;

  if (Number.isFinite(retry_after_seconds)) {
    delaySeconds = Number(retry_after_seconds);
  } else {
    if (newAttempts === 1) delaySeconds = 60;
    else if (newAttempts === 2) delaySeconds = 300;
    else if (newAttempts === 3) delaySeconds = 900;
    else delaySeconds = 1800;
  }

  if (newAttempts >= maxAttempts) {
    status = 'failed';
    willRetry = false;
    db.prepare(`
      UPDATE action_queue
      SET status = 'failed', attempts = ?, last_error = ?, locked_at = NULL, locked_by = NULL, not_before = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newAttempts, lastError, id);

    const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(action.task_id);
    if (task && isValidTransition(task.state, 'blocked')) {
      db.prepare(`UPDATE tasks SET state = 'blocked', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(task.id);
      db.prepare(`INSERT INTO events (task_id, event_type, payload) VALUES (?, ?, ?)`).run(
        task.id, 'blocked', 'action_failed_max_attempts'
      );
    }

    enqueueAction({
      taskId: action.task_id,
      actionType: 'notify_telegram',
      payload: { message_type: 'task_blocked', task_id: action.task_id, attempts: newAttempts }
    });

    return res.json({ action_id: id, status, attempts: newAttempts, will_retry: willRetry });
  }

  const delaySql = `+${Math.floor(delaySeconds)} seconds`;
  db.prepare(`
    UPDATE action_queue
    SET status = 'pending', attempts = ?, last_error = ?, locked_at = NULL, locked_by = NULL,
        not_before = datetime('now', ?), updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(newAttempts, lastError, delaySql, id);

  return res.json({ action_id: id, status, attempts: newAttempts, will_retry: willRetry });
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

// GET /dashboard
app.get('/dashboard', (req, res) => {
  const filter = req.query.filter || 'active';
  const sort = req.query.sort || 'age';
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all();
  const events = db.prepare('SELECT * FROM events ORDER BY created_at ASC').all();
  res.setHeader('Content-Type', 'text/html');
  res.send(generateDashboardHTML(tasks, events, filter, sort));
});

// GET /health
app.get('/health', (req, res) => {
  const row = db.prepare(`SELECT COUNT(*) as count FROM tasks WHERE state NOT IN ('completed', 'blocked')`).get();
  res.json({ status: 'ok', uptime: process.uptime(), tasks_active: row.count, autonomy_engine: true });
});

app.listen(PORT, () => {
  startTimeouts();
});
