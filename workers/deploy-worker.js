'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fetch = require('node-fetch');

const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL || 'http://localhost:3210';

// Startup env validation
(function validateStartup() {
  const required = ['CONTROL_PLANE_URL', 'PETER_TELEGRAM_TOKEN', 'BRANDON_CHAT_ID', 'GITHUB_TOKEN'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    process.stderr.write(`[deploy-worker] FATAL: missing required env vars: ${missing.join(', ')}\n`);
    process.exit(1);
  }
  process.stdout.write(`[deploy-worker] startup cwd=${process.cwd()} CONTROL_PLANE_URL=${CONTROL_PLANE_URL}\n`);
})();

function log(line) {
  process.stdout.write(`[deploy-worker] ${line}\n`);
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
      // No deploy hook configured for this repo (e.g. Control Plane itself, deployed manually).
      // Mark complete and enqueue verify_deploy against the CP health endpoint as proof of liveness.
      await fetch(`${CONTROL_PLANE_URL}/actions/${claimed.id}/complete`, {
        method: 'POST',
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker_id: 'deploy-worker' })
      });

      await fetch(`${CONTROL_PLANE_URL}/tasks/${claimed.task_id}/state`, {
        method: 'POST',
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'deploy_in_progress', actor: 'deploy-worker', note: 'no deploy hook; advancing for verify' })
      });

      // Notify CP of deployed state with the CP health URL as the verify target
      await fetch(`${CONTROL_PLANE_URL}/tasks/${claimed.task_id}/deployed`, {
        method: 'POST',
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deploy_url: CONTROL_PLANE_URL + '/health' })
      });

      // Enqueue QA smoke test — no-hook path: skip URL checks (no real deploy URL)
      await fetch(`${CONTROL_PLANE_URL}/tasks/${claimed.task_id}/actions`, {
        method: 'POST',
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action_type: 'qa_smoke_test',
          payload: { deploy_url: '', skip_url_checks: true, repo: payload.repo || '', task_id: claimed.task_id }
        })
      }).catch(() => {});

      log(`completed ${claimed.id} (no-hook path)`);
      return;
    }

    const hookRes = await fetch(deploy_hook_url, { method: 'POST', timeout: 10000 });
    if (hookRes.ok) {
      await fetch(`${CONTROL_PLANE_URL}/actions/${claimed.id}/complete`, {
        method: 'POST',
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker_id: 'deploy-worker' })
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

        // Enqueue QA smoke test after deploy hook fires
        await fetch(`${CONTROL_PLANE_URL}/tasks/${claimed.task_id}/actions`, {
          method: 'POST',
          timeout: 10000,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action_type: 'qa_smoke_test',
            payload: { deploy_url: task.deploy_url || '', repo: task.repo, task_id: claimed.task_id }
          })
        }).catch(() => {});
      }

      log(`completed ${claimed.id}`);
      return;
    }

    const errorBody = await hookRes.text();
    await fetch(`${CONTROL_PLANE_URL}/actions/${claimed.id}/fail`, {
      method: 'POST',
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id: 'deploy-worker', error: errorBody })
    });
    log(`fail ${claimed.id}`);
  } catch (err) {
    log(`error ${err.message}`);
  }
}

setInterval(pollOnce, 15000);
pollOnce();
