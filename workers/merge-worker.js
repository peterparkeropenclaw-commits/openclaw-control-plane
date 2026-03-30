'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fetch = require('node-fetch');

const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL || 'http://localhost:3210';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'peterparkeropenclaw-commits';
const PETER_TELEGRAM_TOKEN = process.env.PETER_TELEGRAM_TOKEN;
const BRANDON_CHAT_ID = process.env.BRANDON_CHAT_ID;

const DEPLOY_HOOKS = {
  'review-responder': process.env.DEPLOY_HOOK_REVIEW_RESPONDER,
  'airbnb-optimiser': process.env.DEPLOY_HOOK_AIRBNB,
  'optilyst-app': process.env.DEPLOY_HOOK_OPTILYST,
};

function log(line) {
  process.stdout.write(`[merge-worker] ${line}\n`);
}

async function sendTelegram(text) {
  if (!PETER_TELEGRAM_TOKEN || !BRANDON_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${PETER_TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    timeout: 10000,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: BRANDON_CHAT_ID, text, parse_mode: 'Markdown' })
  });
}

async function pollOnce() {
  try {
    const pendingRes = await fetch(`${CONTROL_PLANE_URL}/actions/pending`, { timeout: 10000 });
    if (!pendingRes.ok) return;
    const actions = await pendingRes.json();
    const action = actions.find(a => a.action_type === 'merge_pr' && a.status === 'pending');
    if (!action) return;

    const claimRes = await fetch(`${CONTROL_PLANE_URL}/actions/${action.id}/claim`, {
      method: 'POST',
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id: 'merge-worker' })
    });
    if (claimRes.status === 409) return;
    if (!claimRes.ok) {
      log(`claim_failed ${action.id}`);
      return;
    }

    const claimed = await claimRes.json();
    log(`claimed ${claimed.id}`);

    const payload = JSON.parse(claimed.payload_json || '{}');

    const taskRes = await fetch(`${CONTROL_PLANE_URL}/tasks/${claimed.task_id}`, { timeout: 10000 });
    if (!taskRes.ok) {
      await fetch(`${CONTROL_PLANE_URL}/actions/${claimed.id}/fail`, {
        method: 'POST',
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker_id: 'merge-worker', error: 'task_not_found' })
      });
      log(`fail ${claimed.id}`);
      return;
    }

    const task = await taskRes.json();

    const stateOk = task.state === 'review_approved' || task.state === 'merge_in_progress';
    const repoOk = payload.repo && payload.repo === task.repo;
    // PR URL must be on the correct repo and task must have a registered PR number
    const prUrlOk = task.pr_url && task.pr_url.includes(`/${task.repo}/pull/`) && task.pr_number;

    if (!stateOk || !repoOk || !prUrlOk) {
      const reason = !stateOk
        ? `invalid_state:${task.state}`
        : !repoOk
          ? `repo_mismatch:${payload.repo}!=${task.repo}`
          : 'pr_url_invalid_or_missing';

      await fetch(`${CONTROL_PLANE_URL}/actions/${claimed.id}/fail`, {
        method: 'POST',
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker_id: 'merge-worker', error: `invariant_failed: ${reason}`, retry_after_seconds: 999999 })
      });

      await fetch(`${CONTROL_PLANE_URL}/tasks/${claimed.task_id}/state`, {
        method: 'POST',
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'blocked', actor: 'merge-worker', note: reason })
      });

      await sendTelegram(`🚨 Invariant failed for ${claimed.task_id}: ${reason}`);
      log(`invariant_fail ${claimed.id}`);
      return;
    }

    const mergeRes = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${task.repo}/pulls/${payload.pr_number}/merge`,
      {
        method: 'PUT',
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Authorization': `Bearer ${GITHUB_TOKEN}`
        },
        body: JSON.stringify({
          merge_method: 'squash',
          commit_title: `[OC-${task.id}] ${task.title}`
        })
      }
    );

    if (mergeRes.ok) {
      await fetch(`${CONTROL_PLANE_URL}/actions/${claimed.id}/complete`, {
        method: 'POST',
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker_id: 'merge-worker' })
      });
      await fetch(`${CONTROL_PLANE_URL}/tasks/${claimed.task_id}/state`, {
        method: 'POST',
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'merge_in_progress', actor: 'merge-worker', note: 'merge complete' })
      });

      const deploy_hook_url = DEPLOY_HOOKS[task.repo];
      await fetch(`${CONTROL_PLANE_URL}/tasks/${claimed.task_id}/actions`, {
        method: 'POST',
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action_type: 'trigger_deploy',
          payload: { repo: task.repo, deploy_hook_url }
        })
      });

      log(`completed ${claimed.id}`);
      return;
    }

    const errorBody = await mergeRes.text();
    await fetch(`${CONTROL_PLANE_URL}/actions/${claimed.id}/fail`, {
      method: 'POST',
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id: 'merge-worker', error: errorBody })
    });
    log(`fail ${claimed.id}`);
  } catch (err) {
    log(`error ${err.message}`);
  }
}

setInterval(pollOnce, 30000);
pollOnce();
