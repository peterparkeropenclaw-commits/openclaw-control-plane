'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fetch = require('node-fetch');

const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL || 'http://localhost:3210';

function log(line) {
  console.log(`[deploy-worker] ${line}`);
}

async function pollOnce() {
  try {
    const pendingRes = await fetch(`${CONTROL_PLANE_URL}/actions/pending`, { timeout: 10000 });
    if (!pendingRes.ok) return;
    const actions = await pendingRes.json();
    const action = actions.find(a => a.action_type === 'trigger_deploy' && a.status === 'pending');
    if (!action) return;

    const claimRes = await fetch(`${CONTROL_PLANE_URL}/actions/${action.id}/claim`, {
      method: 'POST',
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id: 'deploy-worker' })
    });
    if (claimRes.status === 409) return;
    if (!claimRes.ok) {
      log(`claim_failed ${action.id}`);
      return;
    }

    const claimed = await claimRes.json();
    log(`claimed ${claimed.id}`);
    const payload = JSON.parse(claimed.payload_json || '{}');
    const deploy_hook_url = payload.deploy_hook_url;

    if (!deploy_hook_url) {
      await fetch(`${CONTROL_PLANE_URL}/actions/${claimed.id}/complete`, {
        method: 'POST',
        timeout: 10000
      });

      const taskRes = await fetch(`${CONTROL_PLANE_URL}/tasks/${claimed.task_id}`, { timeout: 10000 });
      if (taskRes.ok) {
        const task = await taskRes.json();
        await fetch(`${CONTROL_PLANE_URL}/tasks/${claimed.task_id}/actions`, {
          method: 'POST',
          timeout: 10000,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action_type: 'verify_deploy',
            payload: { deploy_url: task.deploy_url || '' },
            not_before_seconds: 0
          })
        });
      }

      log(`completed ${claimed.id}`);
      return;
    }

    const hookRes = await fetch(deploy_hook_url, { method: 'POST', timeout: 10000 });
    if (hookRes.ok) {
      await fetch(`${CONTROL_PLANE_URL}/actions/${claimed.id}/complete`, {
        method: 'POST',
        timeout: 10000
      });

      await fetch(`${CONTROL_PLANE_URL}/tasks/${claimed.task_id}/state`, {
        method: 'POST',
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'deploy_in_progress', actor: 'deploy-worker', note: 'deploy hook fired' })
      });

      const taskRes = await fetch(`${CONTROL_PLANE_URL}/tasks/${claimed.task_id}`, { timeout: 10000 });
      if (taskRes.ok) {
        const task = await taskRes.json();
        await fetch(`${CONTROL_PLANE_URL}/tasks/${claimed.task_id}/actions`, {
          method: 'POST',
          timeout: 10000,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action_type: 'verify_deploy',
            payload: { deploy_url: task.deploy_url || '' },
            not_before_seconds: 90
          })
        });
      }

      log(`completed ${claimed.id}`);
      return;
    }

    const errorBody = await hookRes.text();
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

setInterval(pollOnce, 15000);
pollOnce();
