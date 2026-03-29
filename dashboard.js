'use strict';

const STALE_THRESHOLDS = {
  build_in_progress: 90 * 60 * 1000,
  review_pending: 30 * 60 * 1000,
  pr_opened: 15 * 60 * 1000,
  merge_pending: 10 * 60 * 1000,
  builder_dispatched: 20 * 60 * 1000,
};

const ESCALATED_STATES = new Set(['blocked', 'review_changes_requested', 'deploy_verification_failed']);

const ACTIVE_STATES = new Set([
  'brief_received', 'contract_written', 'builder_dispatched', 'build_in_progress',
  'pr_opened', 'review_pending', 'review_approved', 'merge_pending', 'deployed',
  'review_changes_requested',
]);

const COMPLETED_STATES = new Set(['completed', 'deployed']);
const BLOCKED_STATES = new Set(['blocked', 'failed', 'deploy_verification_failed']);

function formatAge(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function isStale(task) {
  const threshold = STALE_THRESHOLDS[task.state];
  if (!threshold) return false;
  const ageMs = Date.now() - new Date(task.updated_at).getTime();
  return ageMs > threshold;
}

function rowBgColor(task, stale) {
  if (BLOCKED_STATES.has(task.state)) return '#ffe5e5';
  if (task.state === 'completed') return '#e5ffe5';
  if (task.state === 'review_approved' || task.state === 'deployed') return '#d4f5d4';
  if (task.state === 'review_changes_requested') return '#fff3e0';
  if (stale) return '#fff8e1';
  return '';
}

function stateBadgeColor(state) {
  if (BLOCKED_STATES.has(state)) return '#d32f2f';
  if (state === 'completed') return '#388e3c';
  if (state === 'review_approved' || state === 'deployed') return '#2e7d32';
  if (state === 'review_changes_requested') return '#e65100';
  if (state === 'build_in_progress' || state === 'builder_dispatched') return '#1565c0';
  if (state === 'pr_opened' || state === 'review_pending') return '#6a1b9a';
  return '#546e7a';
}

function escHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function generateDashboardHTML(allTasks, allEvents, filter, sort) {
  const now = Date.now();

  // Build events map grouped by task_id
  const eventsMap = {};
  for (const ev of allEvents) {
    if (!eventsMap[ev.task_id]) eventsMap[ev.task_id] = [];
    eventsMap[ev.task_id].push(ev);
  }

  // Filter
  let tasks = allTasks;
  if (filter === 'active') {
    tasks = allTasks.filter(t => ACTIVE_STATES.has(t.state) && !BLOCKED_STATES.has(t.state));
  } else if (filter === 'completed') {
    tasks = allTasks.filter(t => COMPLETED_STATES.has(t.state));
  } else if (filter === 'blocked') {
    tasks = allTasks.filter(t => BLOCKED_STATES.has(t.state));
  }

  // Sort
  if (sort === 'state') {
    tasks = [...tasks].sort((a, b) => a.state.localeCompare(b.state));
  } else if (sort === 'created') {
    tasks = [...tasks].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  } else {
    // age: most recently updated first (youngest age in state = updated most recently)
    tasks = [...tasks].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  }

  const timestamp = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' });

  function tabLink(f, label) {
    const active = f === filter;
    return `<a href="?filter=${f}&sort=${escHtml(sort)}" class="tab${active ? ' tab-active' : ''}">${label}</a>`;
  }

  function sortLink(s, label) {
    const active = s === sort;
    return `<a href="?filter=${escHtml(filter)}&sort=${s}" class="sort-link${active ? ' sort-active' : ''}">${label}</a>`;
  }

  const rows = tasks.map(task => {
    const stale = isStale(task);
    const escalated = ESCALATED_STATES.has(task.state);
    const ageMs = now - new Date(task.updated_at).getTime();
    const ageStr = formatAge(ageMs);
    const bg = rowBgColor(task, stale);
    const badgeColor = stateBadgeColor(task.state);
    const events = eventsMap[task.id] || [];

    const prCell = task.pr_url
      ? `<a href="${escHtml(task.pr_url)}" target="_blank">#${escHtml(String(task.pr_number || ''))}</a>`
      : '—';

    const deployCell = task.deploy_url
      ? `<a href="${escHtml(task.deploy_url)}" target="_blank">${escHtml(task.deploy_url)}</a>`
      : '—';

    const staleCell = stale
      ? `<span class="badge badge-amber">⚠ Stale</span>`
      : '—';

    const escalatedCell = escalated
      ? `<span class="badge badge-red">🚨 Escalated</span>`
      : '—';

    const eventRows = events.map(ev => {
      const evAge = formatAge(now - new Date(ev.created_at).getTime());
      let payloadStr = '';
      if (ev.payload) {
        try {
          payloadStr = JSON.stringify(JSON.parse(ev.payload), null, 2);
        } catch {
          payloadStr = ev.payload;
        }
      }
      return `<tr>
        <td>${escHtml(evAge)}</td>
        <td><code>${escHtml(ev.event_type)}</code></td>
        <td><pre class="payload">${escHtml(payloadStr)}</pre></td>
      </tr>`;
    }).join('');

    const eventsHtml = events.length
      ? `<table class="events-table"><thead><tr><th>When</th><th>Event</th><th>Payload</th></tr></thead><tbody>${eventRows}</tbody></table>`
      : '<p style="color:#888;font-style:italic">No events.</p>';

    const bgStyle = bg ? ` style="background:${bg}"` : '';

    return `<tr class="task-row" onclick="toggleEvents('${escHtml(task.id)}')"${bgStyle}>
      <td><code class="task-id">${escHtml(task.id)}</code></td>
      <td>${escHtml(task.title)}</td>
      <td><span class="badge" style="background:${badgeColor}">${escHtml(task.state)}</span></td>
      <td>${escHtml(ageStr)}</td>
      <td>${escHtml(task.repo || '—')}</td>
      <td onclick="event.stopPropagation()">${prCell}</td>
      <td onclick="event.stopPropagation()">${deployCell}</td>
      <td>${staleCell}</td>
      <td>${escalatedCell}</td>
    </tr>
    <tr id="events-${escHtml(task.id)}" class="events-row" style="display:none">
      <td colspan="9" class="events-cell">${eventsHtml}</td>
    </tr>`;
  }).join('');

  const emptyRow = tasks.length === 0
    ? `<tr><td colspan="9" style="text-align:center;color:#888;padding:2rem">No tasks found.</td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="30">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OpenClaw Control Plane</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-size: 14px;
      color: #1a1a1a;
      background: #f5f5f5;
      padding: 1.5rem;
    }
    h1 { font-size: 1.4rem; font-weight: 700; margin-bottom: 0.25rem; }
    .subtitle { color: #666; margin-bottom: 1.25rem; font-size: 0.85rem; }
    nav.tabs { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; flex-wrap: wrap; }
    .tab {
      padding: 0.35rem 0.9rem;
      border-radius: 4px;
      border: 1px solid #ccc;
      background: #fff;
      color: #333;
      text-decoration: none;
      font-size: 0.85rem;
    }
    .tab:hover { background: #eee; }
    .tab-active { background: #1a1a1a; color: #fff; border-color: #1a1a1a; }
    .sort-bar { margin-bottom: 1rem; font-size: 0.82rem; color: #555; }
    .sort-link { color: #555; text-decoration: none; margin: 0 0.25rem; }
    .sort-link:hover { text-decoration: underline; }
    .sort-active { font-weight: 700; color: #1a1a1a; }
    .table-wrap { overflow-x: auto; }
    table.tasks {
      width: 100%;
      border-collapse: collapse;
      background: #fff;
      border-radius: 6px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    }
    table.tasks th {
      background: #f0f0f0;
      text-align: left;
      padding: 0.6rem 0.75rem;
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #555;
      border-bottom: 1px solid #ddd;
      white-space: nowrap;
    }
    table.tasks td {
      padding: 0.6rem 0.75rem;
      border-bottom: 1px solid #eee;
      vertical-align: middle;
    }
    .task-row { cursor: pointer; }
    .task-row:hover { filter: brightness(0.97); }
    .task-id { font-size: 0.78rem; color: #444; }
    .badge {
      display: inline-block;
      padding: 0.2rem 0.5rem;
      border-radius: 3px;
      font-size: 0.72rem;
      font-weight: 600;
      color: #fff;
      white-space: nowrap;
    }
    .badge-amber { background: #f59e0b; color: #fff; }
    .badge-red { background: #dc2626; color: #fff; }
    a { color: #1565c0; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .events-row { background: #fafafa; }
    .events-cell { padding: 1rem 1.5rem !important; }
    table.events-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.82rem;
    }
    table.events-table th {
      text-align: left;
      padding: 0.3rem 0.5rem;
      color: #666;
      border-bottom: 1px solid #ddd;
      font-size: 0.75rem;
      text-transform: uppercase;
    }
    table.events-table td {
      padding: 0.3rem 0.5rem;
      border-bottom: 1px solid #f0f0f0;
      vertical-align: top;
    }
    pre.payload {
      font-size: 0.75rem;
      white-space: pre-wrap;
      word-break: break-all;
      color: #333;
      max-height: 150px;
      overflow-y: auto;
      background: #f5f5f5;
      padding: 0.25rem 0.5rem;
      border-radius: 3px;
    }
    code { font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; }
  </style>
</head>
<body>
  <h1>🦾 OpenClaw Control Plane</h1>
  <p class="subtitle">Last updated: ${escHtml(timestamp)} · Auto-refreshes every 30s · ${tasks.length} task${tasks.length !== 1 ? 's' : ''} shown</p>

  <nav class="tabs">
    ${tabLink('all', 'All')}
    ${tabLink('active', 'Active')}
    ${tabLink('completed', 'Completed')}
    ${tabLink('blocked', 'Blocked')}
  </nav>

  <div class="sort-bar">
    Sort by: ${sortLink('age', 'Age')} · ${sortLink('state', 'State')} · ${sortLink('created', 'Created')}
  </div>

  <div class="table-wrap">
    <table class="tasks">
      <thead>
        <tr>
          <th>Task ID</th>
          <th>Title</th>
          <th>State</th>
          <th>Age in State</th>
          <th>Repo</th>
          <th>PR</th>
          <th>Deploy URL</th>
          <th>Stale?</th>
          <th>Escalated?</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        ${emptyRow}
      </tbody>
    </table>
  </div>

  <script>
    function toggleEvents(taskId) {
      var row = document.getElementById('events-' + taskId);
      if (!row) return;
      row.style.display = row.style.display === 'none' ? 'table-row' : 'none';
    }
  </script>
</body>
</html>`;
}

module.exports = { generateDashboardHTML };
