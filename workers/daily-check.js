#!/usr/bin/env node
/**
 * daily-check.js — OpenClaw Daily System Check
 * Runs at 8:00 AM, sends Telegram report to Brandon.
 * Implements OPERATOR CHECKLIST per Golden Path Freeze.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const CP_URL = process.env.CONTROL_PLANE_URL || 'http://localhost:3210';
const BOT_TOKEN = process.env.PETER_TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.BRANDON_CHAT_ID;
const STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: message, parse_mode: 'Markdown' })
  });
}

async function getHealth() {
  try {
    const res = await fetchWithTimeout(`${CP_URL}/health/full`);
    return await res.json();
  } catch (e) {
    return { status: 'FAIL', error: e.message, checks: [] };
  }
}

async function getTasks() {
  try {
    const res = await fetchWithTimeout(`${CP_URL}/tasks`);
    return await res.json();
  } catch (e) {
    return [];
  }
}

async function getQueue() {
  try {
    const res = await fetchWithTimeout(`${CP_URL}/actions/pending`);
    return await res.json();
  } catch (e) {
    return { count: 0, items: [] };
  }
}

async function getWorkers() {
  try {
    const { execSync } = require('child_process');
    const raw = execSync('pm2 jlist', { timeout: 5000 }).toString();
    const procs = JSON.parse(raw);
    const workers = procs.filter(p =>
      p.name && p.name.startsWith('openclaw-') && p.name !== 'openclaw-daily-check'
    );
    return workers.map(p => ({
      name: p.name,
      status: p.pm2_env?.status,
      restarts: p.pm2_env?.restart_time || 0
    }));
  } catch (e) {
    return [];
  }
}

const TERMINAL_STATES = ['completed', 'failed', 'cancelled', 'qa_failed'];

async function run() {
  const now = new Date();
  const lines = [];
  lines.push(`*🔍 OPENCLAW DAILY SYSTEM CHECK*`);
  lines.push(`_${now.toUTCString()}_`);
  lines.push('');

  // ── Health ──────────────────────────────────────────────
  const health = await getHealth();
  const healthStatus = health.status === 'PASS' ? '✅ PASS' : '❌ FAIL';
  lines.push(`*HEALTH*`);
  lines.push(`Status: ${healthStatus}`);
  if (health.status !== 'PASS' && health.checks) {
    const failing = health.checks.filter(c => c.status !== 'ok' && c.status !== 'pass');
    failing.forEach(c => lines.push(`  ⚠️ ${c.name}: ${c.status}${c.detail ? ' — ' + c.detail : ''}`));
  }
  lines.push('');

  // ── Active Tasks ─────────────────────────────────────────
  const allTasks = await getTasks();
  const activeTasks = Array.isArray(allTasks)
    ? allTasks.filter(t => !TERMINAL_STATES.includes(t.state))
    : [];
  lines.push(`*ACTIVE TASKS*`);
  lines.push(`Count: ${activeTasks.length}`);
  if (activeTasks.length > 0) {
    activeTasks.forEach(t => {
      const updatedAt = t.updated_at ? new Date(t.updated_at) : null;
      const stuckMs = updatedAt ? now - updatedAt : 0;
      const stuck = stuckMs > STUCK_THRESHOLD_MS;
      const stuckLabel = stuck ? ` ⚠️ STUCK (${Math.round(stuckMs / 60000)}m)` : '';
      lines.push(`  • OC-${t.id} [${t.state}]${stuckLabel} — ${t.title || '(no title)'}`);
    });
  } else {
    lines.push(`  (none)`);
  }
  lines.push('');

  // ── Workers ───────────────────────────────────────────────
  const workers = await getWorkers();
  const allOnline = workers.length > 0 && workers.every(w => w.status === 'online');
  const anyRestarts = workers.some(w => w.restarts > 0);
  lines.push(`*WORKERS*`);
  lines.push(`All online: ${allOnline ? '✅ Yes' : '❌ No'}`);
  if (!allOnline) {
    workers.filter(w => w.status !== 'online').forEach(w =>
      lines.push(`  ⚠️ ${w.name}: ${w.status}`)
    );
  }
  if (anyRestarts) {
    workers.filter(w => w.restarts > 0).forEach(w =>
      lines.push(`  🔄 ${w.name}: ${w.restarts} restart(s)`)
    );
  }
  lines.push('');

  // ── Action Queue ──────────────────────────────────────────
  const queue = await getQueue();
  const pendingCount = queue.count ?? (Array.isArray(queue) ? queue.length : 0);
  lines.push(`*ACTION QUEUE*`);
  lines.push(`Pending: ${pendingCount}`);
  if (pendingCount > 0) {
    lines.push(`  ⚠️ Actions awaiting processing`);
  }
  lines.push('');

  // ── Deploy Hooks ──────────────────────────────────────────
  const hooks = [
    'DEPLOY_HOOK_REVIEW_RESPONDER',
    'DEPLOY_HOOK_AIRBNB',
    'DEPLOY_HOOK_OPTILYST'
  ];
  const missingHooks = hooks.filter(h => !process.env[h]);
  lines.push(`*DEPLOY HOOKS*`);
  lines.push(`All configured: ${missingHooks.length === 0 ? '✅ Yes' : '❌ No'}`);
  if (missingHooks.length > 0) {
    missingHooks.forEach(h => lines.push(`  ⚠️ Missing: ${h}`));
  }
  lines.push('');

  // ── Summary ───────────────────────────────────────────────
  const hasFailingHealth = health.status !== 'PASS';
  const hasStuckTask = activeTasks.some(t => {
    const updatedAt = t.updated_at ? new Date(t.updated_at) : null;
    return updatedAt && (now - updatedAt) > STUCK_THRESHOLD_MS;
  });
  const hasOfflineWorker = !allOnline;
  const hasMissingHook = missingHooks.length > 0;

  let summary;
  if (hasFailingHealth || hasOfflineWorker) {
    summary = '🔴 UNSAFE — do not trust automation';
  } else if (hasStuckTask || hasMissingHook || anyRestarts) {
    summary = '🟡 DEGRADED — non-critical issues present';
  } else {
    summary = '🟢 SAFE — system fully autonomous';
  }

  lines.push(`*STATUS: ${summary}*`);

  await sendTelegram(lines.join('\n'));
  console.log('[daily-check] Report sent:', summary);
}

run().catch(e => {
  console.error('[daily-check] Fatal:', e);
  process.exit(1);
});
