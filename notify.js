'use strict';
require('dotenv').config();
const fetch = require('node-fetch');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEFAULT_CHAT = process.env.BRANDON_CHAT_ID;

// Suppress duplicate alerts for the same task+state within this window (ms).
// Prevents spam when Reviewer Bot posts multiple comments or verdict re-fires.
const DEDUP_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours
const _alerted = new Map(); // key: `${taskId}:${state}` → timestamp

function isDuplicate(taskId, state) {
  const key = `${taskId}:${state}`;
  const last = _alerted.get(key);
  if (last && Date.now() - last < DEDUP_WINDOW_MS) return true;
  _alerted.set(key, Date.now());
  return false;
}

async function sendTelegram(chatId, text) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
  }).catch(() => {});
}

async function notifyState(task, newState, extra) {
  const chatId = task.brandon_chat_id || DEFAULT_CHAT;

  // States that must fire exactly once per task; subsequent calls within DEDUP_WINDOW_MS are dropped.
  const deduplicatedStates = new Set([
    'review_changes_requested',
    'blocked',
    'escalated',
  ]);

  if (deduplicatedStates.has(newState) && isDuplicate(task.id, newState)) return;

  let text;

  switch (newState) {
    case 'brief_received':
      text = `📋 Task ${task.id} created: ${task.title}`;
      break;
    case 'builder_dispatched':
      text = `🔨 Builder spawned on ${task.title}\nETA ~10 minutes.`;
      break;
    case 'pr_opened': {
      const prRef = task.pr_number ? `PR #${task.pr_number}` : `task ${task.id}`;
      text = `📬 ${prRef} open on ${task.repo}.\nReviewer Bot reviewing now.`;
      break;
    }
    case 'review_approved': {
      const prRef = task.pr_number ? `PR #${task.pr_number}` : `task ${task.id}`;
      text = `✅ ${prRef} approved.\nMerging and deploying now.`;
      break;
    }
    case 'review_changes_requested': {
      const prRef = task.pr_number ? `PR #${task.pr_number}` : `task ${task.id}`;
      text = `⚠️ ${prRef} needs changes:\n${extra && extra.issues ? extra.issues : ''}\nSpawning Builder to fix.`;
      break;
    }
    case 'deployed':
      text = `🚀 ${task.title} is live.\n${task.deploy_url}`;
      break;
    case 'blocked':
      text = `🚨 Task ${task.id} is blocked:\n${extra && extra.reason ? extra.reason : ''}\nAction required.`;
      break;
    case 'completed':
      text = `✓ ${task.title} complete.`;
      break;
    default:
      return;
  }

  await sendTelegram(chatId, text);
}

async function sendAlert(chatId, text) {
  await sendTelegram(chatId || DEFAULT_CHAT, text);
}

module.exports = { notifyState, sendAlert };
