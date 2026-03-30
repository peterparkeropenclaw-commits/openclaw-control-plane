'use strict';
require('dotenv').config();

const express = require('express');
const db = require('./db');
const { isValidTransition, isTerminalState } = require('./state-machine');
const { notifyState, sendAlert } = require('./notify');
const { startTimeouts } = require('./timeouts');
const { generateDashboardHTML } = require('./dashboard');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3210;
const ACTION_TYPES = new Set(['merge_pr', 'trigger_deploy', 'verify_deploy', 'notify_telegram', 'bootstrap_repo', 'qa_smoke_test']);

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
    WHERE state NOT IN ('completed', 'blocked', 'archived', 'cancelled', 'abandoned')
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
    if (!updated.pr_number || !updated.pr_url) {
      process.stderr.write(`[cp] BLOCKED merge_pr for ${id}: pr_number=${updated.pr_number} pr_url=${updated.pr_url} — cannot proceed without valid PR metadata\n`);
    } else {
      enqueueAction({
        taskId: id,
        actionType: 'merge_pr',
        payload: { pr_number: updated.pr_number, pr_url: updated.pr_url, repo: updated.repo }
      });
    }
  }

  if (verdict === 'changes_requested') {
    enqueueAction({
      taskId: id,
      actionType: 'notify_telegram',
      payload: { message_type: 'changes_requested', pr_number: updated.pr_number || 'unknown', task_id: id }
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

// POST /tasks/:id/archive
app.post('/tasks/:id/archive', async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body || {};

  const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (isTerminalState(task.state)) {
    return res.status(400).json({ error: `Task is already in terminal state: ${task.state}` });
  }

  db.prepare(`UPDATE tasks SET state = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
  db.prepare(`INSERT INTO events (task_id, event_type, payload) VALUES (?, ?, ?)`).run(id, 'archived', reason ? String(reason) : null);

  res.json({ task_id: id, state: 'archived' });
});

// POST /tasks/:id/qa_passed
app.post('/tasks/:id/qa_passed', async (req, res) => {
  const { id } = req.params;

  const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (task.state !== 'deployed' && task.state !== 'qa_passed') {
    return res.status(400).json({ error: `Expected deployed state, got: ${task.state}` });
  }

  if (task.state === 'deployed') {
    db.prepare(`UPDATE tasks SET state = 'qa_passed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
    db.prepare(`INSERT INTO events (task_id, event_type, payload) VALUES (?, ?, ?)`).run(id, 'qa_passed', null);
  }

  // Transition to completed
  db.prepare(`UPDATE tasks SET state = 'completed', updated_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
  db.prepare(`INSERT INTO events (task_id, event_type, payload) VALUES (?, ?, ?)`).run(id, 'completed', 'qa_passed');

  const updated = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
  await notifyState(updated, 'completed', { reason: 'qa_passed' }).catch(() => {});

  res.json({ task_id: id, state: 'completed' });
});

// POST /tasks/:id/qa_failed
app.post('/tasks/:id/qa_failed', async (req, res) => {
  const { id } = req.params;
  const { failing_checks } = req.body || {};

  const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (task.state !== 'deployed') {
    return res.status(400).json({ error: `Expected deployed state, got: ${task.state}` });
  }

  db.prepare(`UPDATE tasks SET state = 'qa_failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
  db.prepare(`INSERT INTO events (task_id, event_type, payload) VALUES (?, ?, ?)`).run(id, 'qa_failed', failing_checks ? JSON.stringify(failing_checks) : null);

  const updated = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
  await notifyState(updated, 'qa_failed', { failing_checks }).catch(() => {});

  enqueueAction({
    taskId: id,
    actionType: 'notify_telegram',
    payload: { message_type: 'qa_failed', task_id: id, failing_checks }
  });

  res.json({ task_id: id, state: 'qa_failed' });
});

// POST /tasks/:id/validate-repo
app.post('/tasks/:id/validate-repo', async (req, res) => {
  const { id } = req.params;
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_OWNER = process.env.GITHUB_OWNER;
  const REVIEWER_TUNNEL_URL = process.env.REVIEWER_TUNNEL_URL;

  const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (!task.repo) return res.status(400).json({ error: 'Task has no repo' });
  if (!GITHUB_OWNER || !GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_OWNER or GITHUB_TOKEN not configured' });
  if (!REVIEWER_TUNNEL_URL) return res.status(500).json({ error: 'REVIEWER_TUNNEL_URL not configured' });

  try {
    const hooksRes = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${task.repo}/hooks`, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28'
      },
      timeout: 10000
    });

    if (!hooksRes.ok) {
      return res.status(502).json({ error: `GitHub API error: ${hooksRes.status}` });
    }

    const hooks = await hooksRes.json();
    const validHook = hooks.find(h =>
      h.active &&
      h.config && h.config.url && h.config.url.includes(REVIEWER_TUNNEL_URL) &&
      Array.isArray(h.events) && h.events.includes('pull_request')
    );

    if (validHook) {
      return res.json({ valid: true });
    }

    enqueueAction({
      taskId: id,
      actionType: 'bootstrap_repo',
      payload: { repo: task.repo, task_id: id }
    });

    return res.json({ valid: false, action: 'bootstrap_repo_enqueued' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /health/full
app.get('/health/full', async (req, res) => {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const PETER_TELEGRAM_TOKEN = process.env.PETER_TELEGRAM_TOKEN;
  const BRANDON_CHAT_ID = process.env.BRANDON_CHAT_ID;
  const REVIEWER_TUNNEL_URL = process.env.REVIEWER_TUNNEL_URL;

  const timeout10s = 10000;

  async function checkReviewerBot() {
    try {
      const r = await fetch('http://localhost:3205/health', { method: 'HEAD', timeout: timeout10s });
      return r.status === 200 ? 'PASS' : `FAIL:HTTP_${r.status}`;
    } catch (e) { return `FAIL:${e.message}`; }
  }

  async function checkPm2Worker(name) {
    try {
      const { execFile } = require('child_process');
      const result = await new Promise((resolve, reject) => {
        execFile('pm2', ['jlist'], { timeout: timeout10s }, (err, stdout) => {
          if (err) return reject(err);
          resolve(stdout);
        });
      });
      const list = JSON.parse(result);
      const proc = list.find(p => p.name === name);
      if (!proc) return `FAIL:not_found`;
      return proc.pm2_env && proc.pm2_env.status === 'online' ? 'PASS' : `FAIL:status_${proc.pm2_env && proc.pm2_env.status}`;
    } catch (e) { return `FAIL:${e.message}`; }
  }

  async function checkCloudflareTunnel() {
    if (!REVIEWER_TUNNEL_URL) return 'not_configured';
    try {
      const r = await fetch(REVIEWER_TUNNEL_URL, { method: 'HEAD', timeout: timeout10s });
      return r.status < 500 ? 'PASS' : `FAIL:HTTP_${r.status}`;
    } catch (e) { return `FAIL:${e.message}`; }
  }

  async function checkGithubToken() {
    if (!GITHUB_TOKEN) return 'FAIL:token_not_set';
    try {
      const r = await fetch('https://api.github.com/user', {
        headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github+json' },
        timeout: timeout10s
      });
      if (!r.ok) return `FAIL:HTTP_${r.status}`;
      const body = await r.json();
      return body.login ? 'PASS' : 'FAIL:no_login';
    } catch (e) { return `FAIL:${e.message}`; }
  }

  async function checkTelegram() {
    if (!PETER_TELEGRAM_TOKEN || !BRANDON_CHAT_ID) return 'FAIL:token_or_chat_not_set';
    try {
      const r = await fetch(`https://api.telegram.org/bot${PETER_TELEGRAM_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: BRANDON_CHAT_ID, text: '[health-check] ping', disable_notification: true }),
        timeout: timeout10s
      });
      const body = await r.json();
      return body.ok ? 'PASS' : `FAIL:${JSON.stringify(body.description || body)}`;
    } catch (e) { return `FAIL:${e.message}`; }
  }

  function checkDeployHooks() {
    const hookKeys = Object.keys(process.env).filter(k => k.startsWith('DEPLOY_HOOK_'));
    if (hookKeys.length === 0) return 'not_configured';
    const empty = hookKeys.filter(k => !process.env[k]);
    return empty.length === 0 ? 'PASS' : `FAIL:empty_hooks:${empty.join(',')}`;
  }

  const [
    reviewer_bot,
    merge_worker,
    deploy_worker,
    verify_worker,
    notify_worker,
    cloudflare_tunnel,
    github_token,
    telegram
  ] = await Promise.all([
    checkReviewerBot(),
    checkPm2Worker('openclaw-merge-worker'),
    checkPm2Worker('openclaw-deploy-worker'),
    checkPm2Worker('openclaw-verify-worker'),
    checkPm2Worker('openclaw-notify-worker'),
    checkCloudflareTunnel(),
    checkGithubToken(),
    checkTelegram()
  ]);

  const deploy_hooks = checkDeployHooks();

  const checks = {
    control_plane: 'PASS',
    reviewer_bot,
    merge_worker,
    deploy_worker,
    verify_worker,
    notify_worker,
    cloudflare_tunnel,
    github_token,
    telegram,
    deploy_hooks
  };

  const failing = Object.entries(checks)
    .filter(([, v]) => v !== 'PASS' && v !== 'not_configured')
    .map(([k, v]) => ({ check: k, result: v }));

  const summary = failing.length === 0 ? 'PASS' : 'FAIL';

  res.json({ summary, failing, checks, checked_at: new Date().toISOString() });
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
  const { worker_id } = req.body || {};

  const action = db.prepare(`SELECT * FROM action_queue WHERE id = ?`).get(id);
  if (!action) return res.status(404).json({ error: 'Action not found' });
  if (action.status !== 'claimed') return res.status(409).json({ error: 'Action is not claimed' });
  if (worker_id && action.locked_by && action.locked_by !== worker_id) {
    return res.status(403).json({ error: 'Worker does not own this action' });
  }

  db.prepare(`UPDATE action_queue SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
  db.prepare(`INSERT INTO events (task_id, event_type, payload) VALUES (?, ?, ?)`).run(
    action.task_id, 'action_complete', action.action_type
  );

  return res.json({ action_id: id, status: 'completed' });
});

// POST /actions/:id/fail
app.post('/actions/:id/fail', (req, res) => {
  const { id } = req.params;
  const { error, retry_after_seconds, worker_id } = req.body || {};

  const action = db.prepare(`SELECT * FROM action_queue WHERE id = ?`).get(id);
  if (!action) return res.status(404).json({ error: 'Action not found' });
  if (action.status !== 'claimed') return res.status(409).json({ error: 'Action is not claimed' });
  if (worker_id && action.locked_by && action.locked_by !== worker_id) {
    return res.status(403).json({ error: 'Worker does not own this action' });
  }
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
  const row = db.prepare(`SELECT COUNT(*) as count FROM tasks WHERE state NOT IN ('completed', 'blocked', 'archived', 'cancelled', 'abandoned')`).get();
  res.json({ status: 'ok', uptime: process.uptime(), tasks_active: row.count, autonomy_engine: true });
});

app.listen(PORT, () => {
  startTimeouts();
});
