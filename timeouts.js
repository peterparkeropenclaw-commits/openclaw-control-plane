'use strict';
require('dotenv').config();
const fetch = require('node-fetch');
const db = require('./db');
const { sendAlert } = require('./notify');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const BRANDON_CHAT = process.env.BRANDON_CHAT_ID;

function minutesAgo(dateStr) {
  return (Date.now() - new Date(dateStr).getTime()) / 60000;
}

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

async function postGitHubComment(repo, prNumber, body) {
  if (!repo || !prNumber) return;
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${repo}/issues/${prNumber}/comments`;
  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'openclaw-control-plane'
    },
    body: JSON.stringify({ body })
  }).catch(() => {});
}

async function runTimeoutChecks() {
  const tasks = db.prepare(`SELECT * FROM tasks WHERE state NOT IN ('completed', 'blocked', 'escalated')`).all();

  for (const task of tasks) {
    const updated = task.updated_at;

    if (task.state === 'builder_dispatched' && minutesAgo(updated) > 20) {
      const reason = 'builder_dispatched_timeout';
      if (!hasRecentEscalation(task.id, reason)) {
        recordEscalation(task.id, reason);
        await sendAlert(task.brandon_chat_id || BRANDON_CHAT,
          `⏰ Task ${task.id} has been in builder_dispatched for over 20 minutes. Needs attention.`);
      }
    }

    if (task.state === 'pr_opened' && minutesAgo(updated) > 10) {
      const reason = 'pr_opened_timeout';
      if (!hasRecentEscalation(task.id, reason)) {
        recordEscalation(task.id, reason);
        await sendAlert(task.brandon_chat_id || BRANDON_CHAT,
          `⏰ ${task.pr_number ? `PR #${task.pr_number}` : `Task ${task.id}`} on ${task.repo} has had no review in 10+ minutes. Re-triggering Reviewer Bot.`);
        await postGitHubComment(task.repo, task.pr_number, '@openclawreviewer-a11y please review this PR');
      }
    }

    if (task.state === 'merge_pending' && minutesAgo(updated) > 5) {
      const reason = 'merge_pending_timeout';
      if (!hasRecentEscalation(task.id, reason)) {
        recordEscalation(task.id, reason);
        await sendAlert(task.brandon_chat_id || BRANDON_CHAT,
          `⏰ Task ${task.id} has been merge_pending for over 5 minutes. Checking deploy...`);
        if (task.deploy_url) {
          fetch(task.deploy_url, { method: 'HEAD' }).catch(() => {});
        }
      }
    }

    if (task.state === 'review_changes_requested' && minutesAgo(updated) > 30) {
      const reason = 'review_changes_requested_timeout';
      if (!hasRecentEscalation(task.id, reason)) {
        recordEscalation(task.id, reason);
        await sendAlert(task.brandon_chat_id || BRANDON_CHAT,
          `⏰ Task ${task.id} has been in review_changes_requested for over 30 minutes. Escalating.`);
      }
    }
  }
}

function startTimeouts() {
  setInterval(() => { runTimeoutChecks().catch(() => {}); }, 5 * 60 * 1000);
}

module.exports = { startTimeouts };
