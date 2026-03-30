'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fetch = require('node-fetch');

const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL || 'http://localhost:3210';

function log(line) {
  console.log(`[verify-worker] ${line}`);
}

async function pollOnce() {
  try {
    const pendingRes = await fetch(`${CONTROL_PLANE_URL}/actions/pending`, { timeout: 10000 });
    if (!pendingRes.ok) return;
    const actions = await pendingRes.json();
    const action = actions.find(a => a.action_type === 'verify_deploy' && a.status === 'pending');
    if (!action) return;

    const claimRes = await fetch(`${CONTROL_PLANE_URL}/actions/${action.id}/claim`, {
      method: 'POST',
      timeout: 10000,
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
      const taskRes = await fetch(`${CONTROL_PLANE_URL}/tasks/${claimed.task_id}`, { timeout: 10000 });
      if (taskRes.ok) {
        const task = await taskRes.json();
        deploy_url = task.deploy_url || '';
      }
    }

    if (!deploy_url) {
      await fetch(`${CONTROL_PLANE_URL}/actions/${claimed.id}/fail`, {
        method: 'POST',
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'missing_deploy_url', retry_after_seconds: 999999 })
      });
      log(`fail ${claimed.id}`);
      return;
    }

    try {
      const headRes = await fetch(deploy_url, { method: 'HEAD', timeout: 10000, redirect: 'follow' });
      if (headRes.status >= 200 && headRes.status < 400) {
        await fetch(`${CONTROL_PLANE_URL}/actions/${claimed.id}/complete`, {
          method: 'POST',
          timeout: 10000
        });

        await fetch(`${CONTROL_PLANE_URL}/tasks/${claimed.task_id}/state`, {
          method: 'POST',
          timeout: 10000,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: 'completed', actor: 'verify-worker', note: 'deploy verified' })
        });

        await fetch(`${CONTROL_PLANE_URL}/tasks/${claimed.task_id}/actions`, {
          method: 'POST',
          timeout: 10000,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action_type: 'notify_telegram',
            payload: { message_type: 'deploy_complete', deploy_url, task_id: claimed.task_id }
          })
        });

        log(`completed ${claimed.id}`);
        return;
      }

      await fetch(`${CONTROL_PLANE_URL}/actions/${claimed.id}/fail`, {
        method: 'POST',
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `HTTP ${headRes.status}`, retry_after_seconds: 60 })
      });
      log(`fail ${claimed.id}`);
    } catch (err) {
      await fetch(`${CONTROL_PLANE_URL}/actions/${claimed.id}/fail`, {
        method: 'POST',
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: err.message, retry_after_seconds: 60 })
      });
      log(`fail ${claimed.id}`);
    }
  } catch (err) {
    log(`error ${err.message}`);
  }
}

setInterval(pollOnce, 30000);
pollOnce();
