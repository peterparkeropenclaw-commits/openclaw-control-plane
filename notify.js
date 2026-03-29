'use strict';
require('dotenv').config();
const fetch = require('node-fetch');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEFAULT_CHAT = process.env.BRANDON_CHAT_ID;

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
  let text;

  switch (newState) {
    case 'brief_received':
      text = `📋 Task ${task.id} created: ${task.title}`;
      break;
    case 'builder_dispatched':
      text = `🔨 Builder spawned on ${task.title}\nETA ~10 minutes.`;
      break;
    case 'pr_opened':
      text = `📬 PR #${task.pr_number} open on ${task.repo}.\nReviewer Bot reviewing now.`;
      break;
    case 'review_approved':
      text = `✅ PR #${task.pr_number} approved.\nMerging and deploying now.`;
      break;
    case 'review_changes_requested':
      text = `⚠️ PR #${task.pr_number} needs changes:\n${extra && extra.issues ? extra.issues : ''}\nSpawning Builder to fix.`;
      break;
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
