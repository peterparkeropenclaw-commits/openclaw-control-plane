'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fetch = require('node-fetch');

const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL || 'http://localhost:3210';

// Startup env validation
(function validateStartup() {
  const required = ['CONTROL_PLANE_URL', 'PETER_TELEGRAM_TOKEN', 'BRANDON_CHAT_ID'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    process.stderr.write(`[qa-worker] FATAL: missing required env vars: ${missing.join(', ')}\n`);
    process.exit(1);
  }
  process.stdout.write(`[qa-worker] startup cwd=${process.cwd()} CONTROL_PLANE_URL=${CONTROL_PLANE_URL}\n`);
})();

function log(line) {
  process.stdout.write(`[qa-worker] ${line}\n`);
}

async function headCheck(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', timeout: 10000, redirect: 'follow' });
    return r.status >= 200 && r.status < 400;
  } catch (_) {
    return false;
  }
}

async function pollOnce() {
  try {
    const pendingRes = await fetch(`${CONTROL_PLANE_URL}/actions/pending`, { timeout: 10000 });
    if (!pendingRes.ok) return;
    const actions = await pendingRes.json();
    const action = actions.find(a => a.action_type === 'qa_smoke_test' && a.status === 'pending');
    if (!action) return;

    const claimRes = await fetch(`${CONTROL_PLANE_URL}/actions/${action.id}/claim`, {
      method: 'POST',
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id: 'qa-worker' })
    });
    if (claimRes.status === 409) return;
    if (!claimRes.ok) {
      log(`claim_failed ${action.id}`);
      return;
    }

    const claimed = await claimRes.json();
    log(`claimed ${claimed.id}`);
    const payload = JSON.parse(claimed.payload_json || '{}');
    const { deploy_url, repo, task_id } = payload;
    const taskId = task_id || claimed.task_id;

    if (!deploy_url) {
      await fetch(`${CONTROL_PLANE_URL}/actions/${claimed.id}/fail`, {
        method: 'POST',
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker_id: 'qa-worker', error: 'missing_deploy_url', retry_after_seconds: 999999 })
      });
      log(`fail ${claimed.id}: missing deploy_url`);
      return;
    }

    const baseUrl = deploy_url.replace(/\/$/, '');

    const checks = [
      { name: `HEAD ${baseUrl}/`, pass: await headCheck(`${baseUrl}/`) },
      { name: `HEAD ${baseUrl}/api/health`, pass: await headCheck(`${baseUrl}/api/health`) || await headCheck(`${baseUrl}/health`) },
      { name: `HEAD ${baseUrl}/ (liveness)`, pass: await headCheck(`${baseUrl}/`) }
    ];

    const failing = checks.filter(c => !c.pass).map(c => c.name);

    await fetch(`${CONTROL_PLANE_URL}/actions/${claimed.id}/complete`, {
      method: 'POST',
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id: 'qa-worker' })
    });

    if (failing.length === 0) {
      await fetch(`${CONTROL_PLANE_URL}/tasks/${taskId}/qa_passed`, {
        method: 'POST',
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      log(`completed ${claimed.id}: qa_passed`);
    } else {
      await fetch(`${CONTROL_PLANE_URL}/tasks/${taskId}/qa_failed`, {
        method: 'POST',
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ failing_checks: failing })
      });
      log(`completed ${claimed.id}: qa_failed checks=${failing.join(',')}`);
    }
  } catch (err) {
    log(`error ${err.message}`);
  }
}

setInterval(pollOnce, 15000);
pollOnce();
