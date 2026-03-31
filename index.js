'use strict';
require('dotenv').config();

const express = require('express');
const db = require('./db');
const { isValidTransition, isTerminalState } = require('./state-machine');
const { notifyState, sendAlert } = require('./notify');
const { startTimeouts } = require('./timeouts');
const { generateDashboardHTML } = require('./dashboard');


function fetchWithTimeout(url, options = {}, ms = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

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

  // Fix 4: cap not_before at 10 minutes max
  const MAX_NOT_BEFORE_SECONDS = 10 * 60;
  const cappedSeconds = Number.isFinite(notBeforeSeconds) && notBeforeSeconds > 0
    ? Math.min(notBeforeSeconds, MAX_NOT_BEFORE_SECONDS)
    : null;

  if (cappedSeconds) {
    const delay = `+${Math.floor(cappedSeconds)} seconds`;
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
  const {
    title, repo, origin, brandon_chat_id,
    // Phase 1 router fields — accept both 'brief' and 'briefing' for compatibility
    task_type, briefing, brief, constraints, acceptance_criteria,
    verification_steps, base_branch, risk_level, state: initialState,
  } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });

  const existing = db.prepare(
    `SELECT id FROM tasks WHERE title = ? AND repo = ? AND created_at > datetime('now', '-60 seconds')`
  ).get(title, repo || null);
  if (existing) return res.json({ task_id: existing.id, deduplicated: true });

  const id = `OC-${Date.now()}`;
  const resolvedBrief = briefing || brief || null;
  const resolvedState = initialState || 'brief_received';
  db.prepare(`
    INSERT INTO tasks (id, title, repo, origin, brandon_chat_id, state,
      task_type, briefing, constraints, acceptance_criteria, verification_steps, base_branch, risk_level)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, title, repo || null, origin || null, brandon_chat_id || null, resolvedState,
    task_type || 'build',
    resolvedBrief,
    constraints || null,
    typeof acceptance_criteria === 'string' ? acceptance_criteria : JSON.stringify(acceptance_criteria || []),
    typeof verification_steps === 'string' ? verification_steps : JSON.stringify(verification_steps || []),
    base_branch || 'main',
    risk_level || 'low',
  );

  db.prepare(`INSERT INTO events (task_id, event_type, payload) VALUES (?, ?, ?)`).run(id, 'created', null);

  const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
  await notifyState(task, resolvedState).catch(() => {});

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

  db.prepare(`UPDATE tasks SET state = ?, updated_at = CURRENT_TIMESTAMP, last_progress_at = CURRENT_TIMESTAMP WHERE id = ?`).run(state, id);
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

// GET /tasks/by-state/:state — returns all tasks with the given state, ordered by created_at DESC
app.get('/tasks/by-state/:state', (req, res) => {
  const state = req.params.state;
  const tasks = db.prepare(`
    SELECT * FROM tasks
    WHERE state = ?
    ORDER BY created_at DESC
  `).all(state);
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
    db.prepare(`UPDATE tasks SET state = 'blocked', updated_at = CURRENT_TIMESTAMP, last_progress_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
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

  db.prepare(`UPDATE tasks SET state = 'contract_written', updated_at = CURRENT_TIMESTAMP, last_progress_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
  db.prepare(`INSERT INTO events (task_id, event_type, payload) VALUES (?, ?, ?)`).run(id, 'brief_validated', briefPayload);

  return res.json({ task_id: id, state: 'contract_written', approved: true });
});

// POST /tasks/:id/pr
// Idempotent: if PR data is already set and state has advanced past pr_opened, just update
// pr_number/pr_url without re-running the state transition. This prevents 400 errors when
// Builder retries /pr after a state race or retry.
app.post('/tasks/:id/pr', async (req, res) => {
  const { id } = req.params;
  const { pr_number, pr_url } = req.body;

  const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const terminalStates = ['completed', 'blocked', 'archived', 'failed'];
  if (terminalStates.includes(task.state)) {
    return res.status(400).json({ error: `Task is in terminal state: ${task.state}` });
  }

  // Idempotent path: state has already advanced past pr_opened — just attach PR data if missing
  if (!isValidTransition(task.state, 'pr_opened')) {
    const needsUpdate = (pr_number && !task.pr_number) || (pr_url && !task.pr_url);
    if (needsUpdate) {
      db.prepare(`UPDATE tasks SET pr_number = COALESCE(pr_number, ?), pr_url = COALESCE(pr_url, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(pr_number || null, pr_url || null, id);
      db.prepare(`INSERT INTO events (task_id, event_type, payload) VALUES (?, ?, ?)`)
        .run(id, 'pr_attached', pr_url || null);
    }
    const updated = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
    return res.json({ task_id: id, state: updated.state, pr_number: updated.pr_number, pr_url: updated.pr_url, idempotent: true });
  }

  db.prepare(`UPDATE tasks SET pr_number = ?, pr_url = ?, state = 'pr_opened', updated_at = CURRENT_TIMESTAMP, last_progress_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(pr_number || null, pr_url || null, id);
  db.prepare(`INSERT INTO events (task_id, event_type, payload) VALUES (?, ?, ?)`).run(id, 'pr_opened', pr_url || null);

  // Auto-advance to review_pending immediately — Reviewer Bot will fire verdict against this state
  db.prepare(`UPDATE tasks SET state = 'review_pending', updated_at = CURRENT_TIMESTAMP, last_progress_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
  db.prepare(`INSERT INTO events (task_id, event_type, payload) VALUES (?, ?, ?)`).run(id, 'review_pending', null);

  const updated = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
  await notifyState(updated, 'review_pending').catch(() => {});

  res.json({ task_id: id, state: 'review_pending', pr_number: updated.pr_number, pr_url: updated.pr_url });
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

  db.prepare(`UPDATE tasks SET state = ?, updated_at = CURRENT_TIMESTAMP, last_progress_at = CURRENT_TIMESTAMP WHERE id = ?`).run(newState, id);
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

  db.prepare(`UPDATE tasks SET deploy_url = ?, state = 'deployed', updated_at = CURRENT_TIMESTAMP, last_progress_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP WHERE id = ?`)
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

  if (!isValidTransition(task.state, 'archived')) {
    return res.status(400).json({ error: `Invalid transition: ${task.state} → archived` });
  }

  db.prepare(`UPDATE tasks SET state = 'archived', updated_at = CURRENT_TIMESTAMP, last_progress_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
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
    db.prepare(`UPDATE tasks SET state = 'qa_passed', updated_at = CURRENT_TIMESTAMP, last_progress_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
    db.prepare(`INSERT INTO events (task_id, event_type, payload) VALUES (?, ?, ?)`).run(id, 'qa_passed', null);
  }

  // Transition to completed
  db.prepare(`UPDATE tasks SET state = 'completed', updated_at = CURRENT_TIMESTAMP, last_progress_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
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

  db.prepare(`UPDATE tasks SET state = 'qa_failed', updated_at = CURRENT_TIMESTAMP, last_progress_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
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
      const hooksRes = await fetchWithTimeout(`https://api.github.com/repos/${GITHUB_OWNER}/${task.repo}/hooks`, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28'
      }
    }, 10000);

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
      const r = await fetchWithTimeout('http://localhost:3205/health', { method: 'GET' }, 10000);
      return r.status === 200 ? 'PASS' : `FAIL:HTTP_${r.status}`;
    } catch (e) { return `FAIL:${e.message}`; }
  }

  async function getPm2List() {
    const { execFile } = require('child_process');
    const result = await new Promise((resolve, reject) => {
      execFile('pm2', ['jlist'], { timeout: timeout10s }, (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout);
      });
    });
    return JSON.parse(result);
  }

  function checkWorkerFromList(list, name) {
    try {
      const proc = list.find(p => p.name === name);
      if (!proc) return `FAIL:not_found`;
      return proc.pm2_env && proc.pm2_env.status === 'online' ? 'PASS' : `FAIL:status_${proc.pm2_env && proc.pm2_env.status}`;
    } catch (e) { return `FAIL:${e.message}`; }
  }

  async function checkCloudflareTunnel() {
    if (!REVIEWER_TUNNEL_URL) return 'not_configured';
    try {
      const r = await fetchWithTimeout(REVIEWER_TUNNEL_URL, { method: 'HEAD' }, 10000);
      return r.status < 500 ? 'PASS' : `FAIL:HTTP_${r.status}`;
    } catch (e) { return `FAIL:${e.message}`; }
  }

  async function checkGithubToken() {
    if (!GITHUB_TOKEN) return 'FAIL:token_not_set';
    try {
      const r = await fetchWithTimeout('https://api.github.com/user', {
        headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github+json' }
      }, 10000);
      if (!r.ok) return `FAIL:HTTP_${r.status}`;
      const body = await r.json();
      return body.login ? 'PASS' : 'FAIL:no_login';
    } catch (e) { return `FAIL:${e.message}`; }
  }

  async function checkTelegram() {
    if (!PETER_TELEGRAM_TOKEN || !BRANDON_CHAT_ID) return 'FAIL:token_or_chat_not_set';
    try {
      const r = await fetchWithTimeout(`https://api.telegram.org/bot${PETER_TELEGRAM_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: BRANDON_CHAT_ID, text: '[health-check] ping', disable_notification: true })
      }, 10000);
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

  // Fetch PM2 process list once; reuse for all worker checks
  let pm2List = [];
  try { pm2List = await getPm2List(); } catch (_) {}

  const [
    reviewer_bot,
    cloudflare_tunnel,
    github_token,
    telegram
  ] = await Promise.all([
    checkReviewerBot(),
    checkCloudflareTunnel(),
    checkGithubToken(),
    checkTelegram()
  ]);

  const merge_worker     = checkWorkerFromList(pm2List, 'openclaw-merge-worker');
  const deploy_worker    = checkWorkerFromList(pm2List, 'openclaw-deploy-worker');
  const verify_worker    = checkWorkerFromList(pm2List, 'openclaw-verify-worker');
  const notify_worker    = checkWorkerFromList(pm2List, 'openclaw-notify-worker');
  const bootstrap_worker = checkWorkerFromList(pm2List, 'openclaw-bootstrap-worker');
  const qa_worker        = checkWorkerFromList(pm2List, 'openclaw-qa-worker');

  const deploy_hooks = checkDeployHooks();

  const checks = {
    control_plane: 'PASS',
    reviewer_bot,
    merge_worker,
    deploy_worker,
    verify_worker,
    notify_worker,
    bootstrap_worker,
    qa_worker,
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
function handleTaskAction(req, res) {
  const { id } = req.params;
  const { action_type, payload, not_before_seconds } = req.body || {};

  if (!ACTION_TYPES.has(action_type)) {
    return res.status(400).json({ error: 'Invalid action_type' });
  }

  const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const existing = getExistingAction(id, action_type);
  if (existing) return res.status(409).json({ error: 'Action already pending or claimed' });

  // Fix 4: cap not_before at 10 minutes max
  const MAX_NOT_BEFORE_SECONDS = 10 * 60; // 10 minutes
  const parsedNotBefore = Number(not_before_seconds);
  const cappedSeconds = Number.isFinite(parsedNotBefore)
    ? Math.min(parsedNotBefore, MAX_NOT_BEFORE_SECONDS)
    : undefined;

  // Fix 2: always inject repo into payload
  const mergedPayload = { ...(payload || {}), repo: task.repo };

  const result = enqueueAction({
    taskId: id,
    actionType: action_type,
    payload: mergedPayload,
    notBeforeSeconds: cappedSeconds
  });

  if (result.existing) {
    return res.status(409).json({ error: 'Action already pending or claimed' });
  }

  return res.json({ action_id: result.action_id, task_id: id, action_type, status: 'pending' });
}

app.post('/tasks/:id/actions', handleTaskAction);

// Fix 3 — /actions/enqueue alias
app.post('/actions/enqueue', (req, res) => {
  const { task_id, action_type, payload } = req.body || {};
  if (!task_id) return res.status(400).json({ error: 'task_id required' });
  req.params = { id: task_id };
  req.body = { action_type, ...(payload || {}) };
  handleTaskAction(req, res);
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
      db.prepare(`UPDATE tasks SET state = 'blocked', updated_at = CURRENT_TIMESTAMP, last_progress_at = CURRENT_TIMESTAMP WHERE id = ?`).run(task.id);
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

// [OC-1774900171118] Architecture V2 Phase 1 — worker registry + task results endpoints
// NOTE: Built using temporary Builder v2 migration carve-out. Router (Phase 2) is not yet the active execution path.

// GET /registry
app.get('/registry', (req, res) => {
  const rows = db.prepare('SELECT * FROM worker_registry WHERE active = 1 ORDER BY task_type').all();
  res.json(rows);
});

// GET /registry/:task_type
app.get('/registry/:task_type', (req, res) => {
  const row = db.prepare('SELECT * FROM worker_registry WHERE task_type = ? AND active = 1').get(req.params.task_type);
  if (!row) return res.status(404).json({ error: `No active worker registered for task_type: ${req.params.task_type}` });
  res.json(row);
});

// POST /registry — upsert a worker registration
app.post('/registry', (req, res) => {
  const { task_type, worker_script, model, max_tokens, timeout_seconds, max_attempts, prompt_template, expected_output_fields, routable_states } = req.body;
  if (!task_type || !worker_script) return res.status(400).json({ error: 'task_type and worker_script are required' });
  db.prepare(`
    INSERT INTO worker_registry (task_type, worker_script, model, max_tokens, timeout_seconds, max_attempts, prompt_template, expected_output_fields, routable_states, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(task_type) DO UPDATE SET
      worker_script = excluded.worker_script,
      model = excluded.model,
      max_tokens = excluded.max_tokens,
      timeout_seconds = excluded.timeout_seconds,
      max_attempts = excluded.max_attempts,
      prompt_template = excluded.prompt_template,
      expected_output_fields = excluded.expected_output_fields,
      routable_states = excluded.routable_states,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    task_type, worker_script,
    model || 'gpt-4.1',
    max_tokens || 16000,
    timeout_seconds || 300,
    max_attempts || 3,
    prompt_template || '{}',
    typeof expected_output_fields === 'string' ? expected_output_fields : JSON.stringify(expected_output_fields || []),
    typeof routable_states === 'string' ? routable_states : JSON.stringify(routable_states || [])
  );
  const row = db.prepare('SELECT * FROM worker_registry WHERE task_type = ?').get(task_type);
  res.json({ ok: true, registry: row });
});

// POST /tasks/:id/result — worker posts evidence-backed result; CP advances state from evidence
app.post('/tasks/:id/result', async (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const { status, branch, commit, pr_number, pr_url, changed_files, summary, error, worker_type, spawned_at } = req.body;
  if (!status) return res.status(400).json({ error: 'status is required' });

  const attempt = (task.attempt_count || 0) + 1;

  db.prepare(`
    INSERT INTO task_results (task_id, attempt, worker_type, status, result_json, branch, commit_sha, pr_number, pr_url, changed_files, summary, error, spawned_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    task.id, attempt, worker_type || 'build', status,
    JSON.stringify(req.body),
    branch || null, commit || null,
    pr_number ? Number(pr_number) : null,
    pr_url || null,
    typeof changed_files === 'string' ? changed_files : JSON.stringify(changed_files || []),
    summary || null, error || null, spawned_at || null
  );

  db.prepare('UPDATE tasks SET attempt_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(attempt, task.id);
  db.prepare('INSERT INTO events (task_id, event_type, payload) VALUES (?, ?, ?)').run(
    task.id, 'worker_result', JSON.stringify({ status, summary, error, attempt })
  );

  const cpBase = `http://localhost:${process.env.PORT || 3210}`;

  if (status === 'success') {
    if (pr_url && pr_number) {
      db.prepare('UPDATE tasks SET pr_number = ?, pr_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(Number(pr_number), pr_url, task.id);
      const r = await fetchWithTimeout(`${cpBase}/tasks/${task.id}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'pr_opened', actor: 'worker', note: summary || 'Worker result: success with PR' })
      });
      const d = await r.json();
      return res.json({ ok: true, state: d.state, attempt });
    }
    return res.json({ ok: true, state: task.state, attempt, note: 'success but no pr_url — state not advanced' });
  }

  const registry = db.prepare('SELECT max_attempts FROM worker_registry WHERE task_type = ?').get(task.task_type || 'build');
  const maxAttempts = registry ? registry.max_attempts : 3;

  if (status === 'retryable_failure') {
    if (attempt >= maxAttempts) {
      await fetchWithTimeout(`${cpBase}/tasks/${task.id}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'blocked', actor: 'cp', note: `Max retries (${maxAttempts}) reached. Last error: ${error}` })
      });
      enqueueAction({ taskId: task.id, actionType: 'notify_telegram', payload: { message_type: 'task_blocked', task_id: task.id, attempts: attempt, error } });
      return res.json({ ok: true, state: 'blocked', attempt });
    }
    const backoffSeconds = Math.pow(2, attempt) * 60;
    db.prepare("UPDATE tasks SET worker_locked_until = datetime('now', ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(`+${backoffSeconds} seconds`, task.id);
    return res.json({ ok: true, state: 'retrying', attempt, backoff_seconds: backoffSeconds });
  }

  if (status === 'non_retryable_failure') {
    await fetchWithTimeout(`${cpBase}/tasks/${task.id}/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'failed', actor: 'cp', note: `Non-retryable failure: ${error}` })
    });
    enqueueAction({ taskId: task.id, actionType: 'notify_telegram', payload: { message_type: 'task_blocked', task_id: task.id, attempts: attempt, error } });
    return res.json({ ok: true, state: 'failed', attempt });
  }

  return res.status(400).json({ error: `Unknown status value: ${status}` });
});

// POST /tasks/:id/attempt — increment attempt count with optional backoff
app.post('/tasks/:id/attempt', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const { backoff_seconds } = req.body;
  const newAttempt = (task.attempt_count || 0) + 1;
  if (backoff_seconds && Number(backoff_seconds) > 0) {
    db.prepare("UPDATE tasks SET attempt_count = ?, worker_locked_until = datetime('now', ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(newAttempt, `+${Math.floor(Number(backoff_seconds))} seconds`, task.id);
  } else {
    db.prepare('UPDATE tasks SET attempt_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newAttempt, task.id);
  }
  res.json({ ok: true, attempt_count: newAttempt });
});

// ── Memory endpoints ──────────────────────────────────────────────────────────

// GET /memory/context — formatted context block for prompt injection
app.get('/memory/context', (req, res) => {
  const { scope, include_global = 'true' } = req.query;
  if (!scope) return res.status(400).json({ error: 'scope is required' });
  const limit = Math.min(parseInt(req.query.limit) || 15, 50);
  const includeGlobal = include_global !== 'false';

  let rows;
  if (includeGlobal && scope !== 'global') {
    rows = db.prepare(
      `SELECT * FROM memories WHERE scope IN (?, 'global') ORDER BY importance DESC, created_at DESC LIMIT ?`
    ).all(scope, limit);
  } else {
    rows = db.prepare(
      `SELECT * FROM memories WHERE scope = ? ORDER BY importance DESC, created_at DESC LIMIT ?`
    ).all(scope, limit);
  }

  const groups = { rule: [], decision: [], failure: [], success: [], pattern: [], preference: [], context: [] };
  for (const row of rows) {
    const key = groups[row.memory_type] ? row.memory_type : 'context';
    groups[key].push(row.content);
  }

  const labels = { rule: 'Standing Rules', decision: 'Decisions', failure: 'Known Failures', success: 'Successes', pattern: 'Patterns', preference: 'Preferences', context: 'Context' };
  let block = '## Memory Context\n';
  for (const [type, items] of Object.entries(groups)) {
    if (items.length === 0) continue;
    block += `\n**${labels[type]}:**\n`;
    for (const item of items) block += `- ${item}\n`;
  }

  res.json({ context_block: block.trim(), memory_count: rows.length, scope, generated_at: new Date().toISOString() });
});

// GET /memory — list memories with filters
app.get('/memory', (req, res) => {
  const { scope, memory_type, agent, min_importance } = req.query;
  let sql = 'SELECT * FROM memories WHERE 1=1';
  const params = [];
  if (scope) { sql += ' AND scope = ?'; params.push(scope); }
  if (memory_type) { sql += ' AND memory_type = ?'; params.push(memory_type); }
  if (agent) { sql += ' AND agent = ?'; params.push(agent); }
  if (min_importance) { sql += ' AND importance >= ?'; params.push(parseInt(min_importance)); }
  sql += ' ORDER BY importance DESC, created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// POST /memory — create a memory
app.post('/memory', (req, res) => {
  const { scope, agent, memory_type, content, importance = 5, task_id } = req.body;
  if (!scope || !memory_type || !content) return res.status(400).json({ error: 'scope, memory_type, content are required' });
  const result = db.prepare(
    `INSERT INTO memories (scope, agent, memory_type, content, importance, task_id) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(scope, agent || null, memory_type, content, importance, task_id || null);
  const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(row);
});

// DELETE /memory/:id — remove a memory
app.delete('/memory/:id', (req, res) => {
  const result = db.prepare('DELETE FROM memories WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Memory not found' });
  res.json({ ok: true, deleted_id: parseInt(req.params.id) });
});

// ─────────────────────────────────────────────────────────────────────────────

// Fix 1 — POST /tasks/:id/recover
app.post('/tasks/:id/recover', (req, res) => {
  const { reason } = req.body || {};
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const recoveryState = task.pr_number ? 'review_approved' : 'registered';

  db.prepare(`UPDATE tasks SET state = ?, updated_at = datetime('now'), last_progress_at = datetime('now') WHERE id = ?`).run(recoveryState, task.id);
  db.prepare(`INSERT INTO events (task_id, event_type, payload) VALUES (?, 'recovered', ?)`).run(task.id, JSON.stringify({ reason: reason || 'manual recovery', from: task.state, to: recoveryState }));

  res.json({ recovered: true, from: task.state, to: recoveryState });
});

// Fix 6 — GET /endpoints discovery
app.get('/endpoints', (req, res) => {
  res.json({
    tasks: [
      'GET /tasks',
      'GET /tasks/:id',
      'GET /tasks/by-state/:state',
      'POST /tasks',
      'POST /tasks/:id/state',
      'POST /tasks/:id/pr',
      'POST /tasks/:id/result',
      'POST /tasks/:id/attempt',
      'POST /tasks/:id/actions',
      'POST /tasks/:id/recover',
      'POST /actions/enqueue (alias)'
    ],
    memory: [
      'GET /memory',
      'GET /memory/context',
      'POST /memory',
      'DELETE /memory/:id'
    ],
    registry: [
      'GET /registry',
      'GET /registry/:task_type',
      'POST /registry'
    ],
    system: [
      'GET /health',
      'GET /health/full',
      'GET /endpoints'
    ]
  });
});

// Reconcile runs every 5min, max 10 tasks per run,
// 500ms between GitHub calls to respect rate limits
const GITHUB_TOKEN_FOR_RECONCILE = process.env.GITHUB_TOKEN;

async function runAutoReconcile() {
  const blockedWithPR = db.prepare(`
    SELECT * FROM tasks
    WHERE state = 'blocked'
    AND pr_number IS NOT NULL
    LIMIT 10
  `).all();

  if (blockedWithPR.length === 0) return;

  // Process sequentially with delay to avoid GitHub
  // rate limiting — not parallel
  for (const task of blockedWithPR) {
    try {
      if (!GITHUB_TOKEN_FOR_RECONCILE || !task.repo) continue;
      const reviewsUrl = `https://api.github.com/repos/${task.repo}/pulls/${task.pr_number}/reviews`;
      const resp = await fetchWithTimeout(reviewsUrl, {
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN_FOR_RECONCILE}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      }, 10000);
      if (!resp.ok) {
        process.stderr.write(`[reconcile] GitHub reviews API error for task ${task.id}: ${resp.status}\n`);
        // Rate limit: 500ms between GitHub calls
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      const reviews = await resp.json();
      const approved = Array.isArray(reviews) && reviews.some(r => r.state === 'APPROVED');
      if (approved) {
        db.prepare(`UPDATE tasks SET state = 'review_approved', updated_at = datetime('now'), last_progress_at = datetime('now') WHERE id = ?`).run(task.id);
        db.prepare(`INSERT INTO events (task_id, event_type, payload) VALUES (?, 'recovered', ?)`).run(task.id, JSON.stringify({ reason: 'auto-reconcile: PR approved', from: 'blocked', to: 'review_approved' }));
        enqueueAction({ taskId: task.id, actionType: 'merge_pr', payload: { pr_number: task.pr_number, pr_url: task.pr_url, repo: task.repo } });
        process.stdout.write(`[reconcile] task ${task.id} auto-advanced to review_approved (PR #${task.pr_number} approved)\n`);
      }
      // Rate limit: 500ms between GitHub calls
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.warn('[reconcile] Task', task.id, err.message);
    }
  }
}

app.listen(PORT, () => {
  startTimeouts();
  setInterval(() => { runAutoReconcile().catch(err => process.stderr.write(`[reconcile] unhandled: ${err.message}\n`)); }, 5 * 60 * 1000);
});
