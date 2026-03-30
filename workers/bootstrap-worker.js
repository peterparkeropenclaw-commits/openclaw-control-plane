'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fetch = require('node-fetch');

const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL || 'http://localhost:3210';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'peterparkeropenclaw-commits';
const REVIEWER_TUNNEL_URL = process.env.REVIEWER_TUNNEL_URL;
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

// Startup env validation
(function validateStartup() {
  const required = ['CONTROL_PLANE_URL', 'PETER_TELEGRAM_TOKEN', 'BRANDON_CHAT_ID', 'GITHUB_TOKEN', 'GITHUB_OWNER', 'REVIEWER_TUNNEL_URL'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    process.stderr.write(`[bootstrap-worker] FATAL: missing required env vars: ${missing.join(', ')}\n`);
    process.exit(1);
  }
  process.stdout.write(`[bootstrap-worker] startup cwd=${process.cwd()} CONTROL_PLANE_URL=${CONTROL_PLANE_URL}\n`);
})();

function log(line) {
  process.stdout.write(`[bootstrap-worker] ${line}\n`);
}

async function pollOnce() {
  try {
    const pendingRes = await fetch(`${CONTROL_PLANE_URL}/actions/pending`, { timeout: 10000 });
    if (!pendingRes.ok) return;
    const actions = await pendingRes.json();
    const action = actions.find(a => a.action_type === 'bootstrap_repo' && a.status === 'pending');
    if (!action) return;

    const claimRes = await fetch(`${CONTROL_PLANE_URL}/actions/${action.id}/claim`, {
      method: 'POST',
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id: 'bootstrap-worker' })
    });
    if (claimRes.status === 409) return;
    if (!claimRes.ok) {
      log(`claim_failed ${action.id}`);
      return;
    }

    const claimed = await claimRes.json();
    log(`claimed ${claimed.id}`);
    const payload = JSON.parse(claimed.payload_json || '{}');
    const repo = payload.repo;
    const taskId = payload.task_id || claimed.task_id;

    if (!repo) {
      await fetch(`${CONTROL_PLANE_URL}/actions/${claimed.id}/fail`, {
        method: 'POST',
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker_id: 'bootstrap-worker', error: 'missing_repo', retry_after_seconds: 999999 })
      });
      log(`fail ${claimed.id}: missing repo`);
      return;
    }

    const webhookUrl = REVIEWER_TUNNEL_URL.replace(/\/$/, '') + '/webhook';

    const hookBody = {
      name: 'web',
      active: true,
      events: ['pull_request'],
      config: {
        url: webhookUrl,
        content_type: 'json',
        insecure_ssl: '0',
        ...(GITHUB_WEBHOOK_SECRET ? { secret: GITHUB_WEBHOOK_SECRET } : {})
      }
    };

    const hookRes = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${repo}/hooks`, {
      method: 'POST',
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify(hookBody)
    });

    if (hookRes.ok) {
      await fetch(`${CONTROL_PLANE_URL}/actions/${claimed.id}/complete`, {
        method: 'POST',
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker_id: 'bootstrap-worker' })
      });

      await fetch(`${CONTROL_PLANE_URL}/tasks/${taskId}/state`, {
        method: 'POST',
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'contract_written', actor: 'bootstrap-worker', note: 'webhook registered' })
      }).catch(() => {});

      log(`completed ${claimed.id} webhook registered for ${repo}`);
      return;
    }

    const errorBody = await hookRes.text();
    await fetch(`${CONTROL_PLANE_URL}/actions/${claimed.id}/fail`, {
      method: 'POST',
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id: 'bootstrap-worker', error: errorBody })
    });
    log(`fail ${claimed.id}: ${errorBody}`);
  } catch (err) {
    log(`error ${err.message}`);
  }
}

setInterval(pollOnce, 15000);
pollOnce();
