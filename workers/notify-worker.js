'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fetch = require('node-fetch');

const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL || 'http://localhost:3210';
const PETER_TELEGRAM_TOKEN = process.env.PETER_TELEGRAM_TOKEN;
const BRANDON_CHAT_ID = process.env.BRANDON_CHAT_ID;

function log(line) {
  process.stdout.write(`[notify-worker] ${line}\n`);
}

function buildMessage(payload = {}) {
  const {
    message_type,
    message_text,
    task_id,
    pr_number,
    deploy_url,
    attempts,
    error
  } = payload;

  if (message_type === 'deploy_complete') {
    return `✅ [${task_id}] deployed live.\n${deploy_url}`;
  }

  if (message_type === 'changes_requested') {
    return `⚠️ PR #${pr_number} needs changes.\n[${task_id}] — Builder fix required.`;
  }

  if (message_type === 'task_blocked') {
    return `🚨 Task ${task_id} is blocked after ${attempts} attempts.\nManual intervention required.`;
  }

  if (message_type === 'merge_failed') {
    return `⚠️ Merge failed for ${task_id}:\n${error}`;
  }

  return message_text || `Task ${task_id || 'unknown'} status update`;
}

async function pollOnce() {
  try {
    const pendingRes = await fetch(`${CONTROL_PLANE_URL}/actions/pending`, { timeout: 10000 });
    if (!pendingRes.ok) return;
    const actions = await pendingRes.json();
    const action = actions.find(a => a.action_type === 'notify_telegram' && a.status === 'pending');
    if (!action) return;

    const claimRes = await fetch(`${CONTROL_PLANE_URL}/actions/${action.id}/claim`, {
      method: 'POST',
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id: 'notify-worker' })
    });
    if (claimRes.status === 409) return;
    if (!claimRes.ok) {
      log(`claim_failed ${action.id}`);
      return;
    }

    const claimed = await claimRes.json();
    log(`claimed ${claimed.id}`);
    const payload = JSON.parse(claimed.payload_json || '{}');
    const message = buildMessage(payload);

    const notifyRes = await fetch(`https://api.telegram.org/bot${PETER_TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: BRANDON_CHAT_ID, text: message, parse_mode: 'Markdown' })
    });

    if (notifyRes.ok) {
      await fetch(`${CONTROL_PLANE_URL}/actions/${claimed.id}/complete`, {
        method: 'POST',
        timeout: 10000
      });
      log(`completed ${claimed.id}`);
      return;
    }

    const errorBody = await notifyRes.text();
    await fetch(`${CONTROL_PLANE_URL}/actions/${claimed.id}/fail`, {
      method: 'POST',
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: errorBody })
    });
    log(`fail ${claimed.id}`);
  } catch (err) {
    log(`error ${err.message}`);
  }
}

setInterval(pollOnce, 10000);
pollOnce();
