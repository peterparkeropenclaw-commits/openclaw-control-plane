'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fetch = require('node-fetch');

const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL || 'http://localhost:3210';

// Startup env validation
(function validateStartup() {
  const required = ['CONTROL_PLANE_URL', 'PETER_TELEGRAM_TOKEN', 'BRANDON_CHAT_ID'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    process.stderr.write(`[verify-worker] FATAL: missing required env vars: ${missing.join(', ')}\n`);
    process.exit(1);
  }
  process.stdout.write(`[verify-worker] startup cwd=${process.cwd()} CONTROL_PLANE_URL=${CONTROL_PLANE_URL}\n`);
})();

function log(line) {
  process.stdout.write(`[verify-worker] ${line}\n`);
}

function fetchWithTimeout(url, options = {}, ms = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function pollOnce() {
  try {
    const pendingRes = await fetchWithTimeout(`${CONTROL_PLANE_URL}/actions/pending`);
    if (!pendingRes.ok) return;
    const actions = await pendingRes.json();
    const action = actions.find(a => a.action_type === 'verify_deploy' && a.status === 'pending');
    if (!action) return;

    const claimRes = await fetchWithTimeout(`${CONTROL_PLANE_URL}/actions/${action.id}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id: 'verify-worker' })
    });
    if (claimRes.status === 409) return;
    if (!claimRes.ok) {
      log(`claim_failed ${action.id}`);
      return;
    }

    const claimed = await claimRes.json();
    log(`claimed ${claimed.id}`);
    const payload = JSON.parse(claimed.payload_json || '{}');
    let deploy_url = payload.deploy_url || '';

    if (!deploy_url) {
      const taskRes = await fetchWithTimeout(`${CONTROL_PLANE_URL}/tasks/${claimed.task_id}`);
      if (taskRes.ok) {
        const task = await taskRes.json();
        deploy_url = task.deploy_url || '';
      }
    }

    if (!deploy_url) {
      await fetchWithTimeout(`${CONTROL_PLANE_URL}/actions/${claimed.id}/fail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker_id: 'verify-worker', error: 'missing_deploy_url', retry_after_seconds: 999999 })
      });
      log(`fail ${claimed.id}`);
      return;
    }

    try {
      const headRes = await fetchWithTimeout(deploy_url, { method: 'HEAD', redirect: 'follow' }, 15000);
      if (headRes.status >= 200 && headRes.status < 400) {
        await fetchWithTimeout(`${CONTROL_PLANE_URL}/actions/${claimed.id}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ worker_id: 'verify-worker' })
        });

        await fetchWithTimeout(`${CONTROL_PLANE_URL}/tasks/${claimed.task_id}/state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: 'completed', actor: 'verify-worker', note: 'deploy verified' })
        });

        await fetchWithTimeout(`${CONTROL_PLANE_URL}/tasks/${claimed.task_id}/actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action_type: 'notify_telegram',
            payload: { message_type: 'deploy_complete', deploy_url, task_id: claimed.task_id }
          })
        });

        log(`completed ${claimed.id}`);
        return;
      }

      await fetchWithTimeout(`${CONTROL_PLANE_URL}/actions/${claimed.id}/fail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker_id: 'verify-worker', error: `HTTP ${headRes.status}`, retry_after_seconds: 60 })
      });
      log(`fail ${claimed.id}`);
    } catch (err) {
      await fetchWithTimeout(`${CONTROL_PLANE_URL}/actions/${claimed.id}/fail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker_id: 'verify-worker', error: err.message, retry_after_seconds: 60 })
      });
      log(`fail ${claimed.id}`);
    }
  } catch (err) {
    log(`error ${err.message}`);
  }
}

setInterval(pollOnce, 30000);
pollOnce();
