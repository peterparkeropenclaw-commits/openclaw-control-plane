'use strict';
require('dotenv').config();
const fetch = require('node-fetch');
const db = require('./db');
const { sendAlert } = require('./notify');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const BRANDON_CHAT = process.env.BRANDON_CHAT_ID;

// ─── Timestamp utilities ─────────────────────────────────────────────────────
//
// SQLite CURRENT_TIMESTAMP returns "YYYY-MM-DD HH:MM:SS" with NO timezone marker.
// These are always stored as UTC by SQLite, but new Date('YYYY-MM-DD HH:MM:SS')
// in Node.js interprets the string as LOCAL time, not UTC.
// On BST (UTC+1) this adds a phantom 60-minute offset, making every task appear
// 60 minutes older than it actually is — causing immediate false stale alerts.
//
// Fix: normalise all SQLite timestamps to ISO-8601 UTC before parsing.
// "2026-03-30 16:19:42" → "2026-03-30T16:19:42Z"

function sqliteToUtcMs(dateStr) {
  if (!dateStr) return Date.now(); // treat missing as now (never stale)
  // Already has timezone info — parse as-is
  if (dateStr.endsWith('Z') || dateStr.includes('+')) return new Date(dateStr).getTime();
  // SQLite format "YYYY-MM-DD HH:MM:SS" — treat as UTC
  return new Date(dateStr.replace(' ', 'T') + 'Z').getTime();
}

function minutesAgo(dateStr) {
  return (Date.now() - sqliteToUtcMs(dateStr)) / 60000;
}

// ─── Per-state thresholds (minutes) ──────────────────────────────────────────
const STATE_THRESHOLDS = {
  brief_received:              480,  // 120min to write contract
  contract_written:            60,   // Builder dispatch should happen within 60min
  builder_dispatched:          480,  // Builder has 120min to open a PR
  build_in_progress:           480,  // Active build allowed 120min
  registered:                  60,   // Registered tasks should be picked up within 60min
  in_progress:                 480,  // In-progress tasks allowed 120min
  pr_opened:                   90,   // Reviewer should fire within 90min
  review_pending:              15,   // Review result expected within 15min
  review_changes_requested:    480,  // Builder should fix and re-push within 120min
  blocked:                     30,   // Blocked tasks should be recovered within 30min
  merge_pending:                5,   // Merge worker should act within 5min
  merge_in_progress:           10,   // Merge should complete within 10min
  deploy_in_progress:          15,   // Deploy should complete within 15min
  deployed:                    15,   // Verify should run within 15min
  qa_in_progress:              15,   // QA should complete within 15min
};

// ─── Escalation dedup ────────────────────────────────────────────────────────

function hasRecentEscalation(taskId, reason) {
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const row = db.prepare(
    `SELECT id FROM escalations WHERE task_id = ? AND reason = ? AND sent_at > ?`
  ).get(taskId, reason, cutoff);
  return !!row;
}

function recordEscalation(taskId, reason) {
  db.prepare(
    `INSERT INTO escalations (task_id, reason) VALUES (?, ?)`
  ).run(taskId, reason);
}

// ─── GitHub comment helper ───────────────────────────────────────────────────

async function postGitHubComment(repo, prNumber, body) {
  if (!repo || !prNumber) return;
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${repo}/issues/${prNumber}/comments`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'openclaw-control-plane'
      },
      body: JSON.stringify({ body }),
      signal: controller.signal
    });
  } catch (_) {
    // non-fatal
  } finally {
    clearTimeout(timer);
  }
}

// ─── Stale check ─────────────────────────────────────────────────────────────

async function runTimeoutChecks() {
  const TERMINAL = ['completed', 'blocked', 'escalated', 'cancelled', 'archived', 'failed', 'qa_failed'];
  const tasks = db.prepare(
    `SELECT * FROM tasks WHERE state NOT IN (${TERMINAL.map(() => '?').join(',')})`,
  ).all(...TERMINAL);

  for (const task of tasks) {
    // Use updated_at as the progress timestamp — every state transition bumps it.
    // If last_progress_at is added in future, prefer it here.
    const progressField = task.last_progress_at || task.updated_at;
    const ageMin = minutesAgo(progressField);
    const threshold = STATE_THRESHOLDS[task.state];

    if (!threshold) continue; // unknown state — skip silently

    const isStale = ageMin > threshold;

    console.log(
      `[stale-check] task=${task.id} state=${task.state}` +
      ` progress_field=${progressField}` +
      ` age=${ageMin.toFixed(1)}min` +
      ` threshold=${threshold}min` +
      ` stale=${isStale}`
    );

    if (!isStale) continue;

    const reason = `${task.state}_timeout`;
    if (hasRecentEscalation(task.id, reason)) continue;

    recordEscalation(task.id, reason);

    // ── State-specific actions ──────────────────────────────────────────────

    if (task.state === 'builder_dispatched' || task.state === 'build_in_progress') {
      await sendAlert(task.brandon_chat_id || BRANDON_CHAT,
        `⏰ Task ${task.id} has been in \`${task.state}\` for ${ageMin.toFixed(0)} minutes (threshold: ${threshold}min). Builder may need attention.`);
    }

    else if (task.state === 'pr_opened' || task.state === 'review_pending') {
      const prRef = task.pr_number ? `PR #${task.pr_number}` : `Task ${task.id}`;
      await sendAlert(task.brandon_chat_id || BRANDON_CHAT,
        `⏰ ${prRef} on ${task.repo} has had no review in ${ageMin.toFixed(0)} minutes. Re-triggering Reviewer Bot.`);
      await postGitHubComment(task.repo, task.pr_number,
        '@openclawreviewer-a11y please review this PR');
    }

    else if (task.state === 'review_changes_requested') {
      await sendAlert(task.brandon_chat_id || BRANDON_CHAT,
        `⏰ Task ${task.id} has been in \`review_changes_requested\` for ${ageMin.toFixed(0)} minutes (threshold: ${threshold}min). Escalating.`);
    }

    else if (task.state === 'merge_pending' || task.state === 'merge_in_progress') {
      await sendAlert(task.brandon_chat_id || BRANDON_CHAT,
        `⏰ Task ${task.id} has been in \`${task.state}\` for ${ageMin.toFixed(0)} minutes. Checking deploy hook.`);
      if (task.deploy_url) {
        const ctrl = new AbortController();
        setTimeout(() => ctrl.abort(), 5000);
        fetch(task.deploy_url, { method: 'HEAD', signal: ctrl.signal }).catch(() => {});
      }
    }

    else if (task.state === 'deploy_in_progress' || task.state === 'deployed') {
      await sendAlert(task.brandon_chat_id || BRANDON_CHAT,
        `⏰ Task ${task.id} has been in \`${task.state}\` for ${ageMin.toFixed(0)} minutes. Verify worker may be stuck.`);
    }

    else if (task.state === 'qa_in_progress') {
      await sendAlert(task.brandon_chat_id || BRANDON_CHAT,
        `⏰ Task ${task.id} has been in \`qa_in_progress\` for ${ageMin.toFixed(0)} minutes. QA worker may be stuck.`);
    }

    else {
      // Generic catch-all for any other non-terminal state
      await sendAlert(task.brandon_chat_id || BRANDON_CHAT,
        `⏰ Task ${task.id} in state \`${task.state}\` for ${ageMin.toFixed(0)} minutes (threshold: ${threshold}min).`);
    }
  }
}

function startTimeouts() {
  setInterval(() => { runTimeoutChecks().catch(console.error); }, 5 * 60 * 1000);

  // Auto-expiry sweep: mark `brief_received` tasks older than 8 hours as failed.
  setInterval(() => {
    try {
      const cutoff = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString().replace('T', ' ').replace('Z','');
      // updated_at stored as "YYYY-MM-DD HH:MM:SS" (UTC); compare using sqlite datetime
      const rows = db.prepare("SELECT id FROM tasks WHERE state = 'brief_received' AND datetime(updated_at) < datetime(?)").all(cutoff);
      if (rows.length === 0) return;
      const update = db.prepare("UPDATE tasks SET state = 'failed', failure_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
      for (const r of rows) update.run('auto-expired: brief_received > 8h', r.id);
      console.log(`[auto-expiry] expired ${rows.length} brief_received tasks`);
    } catch (err) {
      console.error('auto-expiry sweep failed', err);
    }
  }, 10 * 60 * 1000);
}

module.exports = { startTimeouts };
