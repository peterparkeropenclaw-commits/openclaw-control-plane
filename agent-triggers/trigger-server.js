'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Manual .env loader — no external deps
(function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
})();

const WORKSPACE = path.join(process.env.HOME, '.openclaw/workspace/memory');
const OPENCLAW_BIN = 'openclaw';

// ─── Auth ─────────────────────────────────────────────────────────────────────
// Bearer token loaded from env (set TRIGGER_AUTH_TOKEN=<gateway token> in PM2 env or .env)
const TRIGGER_AUTH_TOKEN = process.env.TRIGGER_AUTH_TOKEN || '';

// Permanent session IDs for each dept head — pin to existing session, never spawn new
const AGENTS = {
  'engineering-lead': {
    port:      3101,
    agentId:   'engineering-lead',
    sessionId: null, // resolved at startup
  },
  'commercial-director': {
    port:      3102,
    agentId:   'commercial-director',
    sessionId: null,
  },
  'head-of-product': {
    port:      3103,
    agentId:   'head-of-product',
    sessionId: null,
  },
  'client-delivery-director': {
    port:      3104,
    agentId:   'client-delivery-director',
    sessionId: null,
  },
};

fs.mkdirSync(WORKSPACE, { recursive: true });

// ─── Resolve permanent session IDs at startup ────────────────────────────────
function resolveSessionId(agentId) {
  return new Promise((resolve) => {
    const proc = spawn(OPENCLAW_BIN, ['sessions', '--agent', agentId, '--json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('close', () => {
      try {
        const data = JSON.parse(out);
        const sessions = data.sessions || [];
        // Pick the permanent "main" session (key ends with :main, not :heartbeat or :subagent:*)
        const main = sessions.find(
          (s) => s.key === `agent:${agentId}:main`
        );
        if (main?.sessionId) {
          console.log(`[${agentId}] Resolved session ID: ${main.sessionId}`);
          resolve(main.sessionId);
        } else {
          console.warn(`[${agentId}] Could not resolve session ID — will use --agent flag only`);
          resolve(null);
        }
      } catch {
        console.warn(`[${agentId}] Failed to parse sessions JSON — will use --agent flag only`);
        resolve(null);
      }
    });
    proc.on('error', () => resolve(null));
  });
}

// ─── Fire-and-forget agent turn ──────────────────────────────────────────────
// Targets the permanent session via --session-id when available.
// Falls back to --agent <id> (which routes to the same main session).
function fireAgentTurn(agentId, sessionId, message, taskId) {
  const args = [
    'agent',
    '--agent', agentId,
    '--message', message,
    '--timeout', '300',
  ];

  // Pin to the existing permanent session if we have its ID
  if (sessionId) {
    args.push('--session-id', sessionId);
  }

  console.log(`[${agentId}] Firing agent turn for task ${taskId} (session: ${sessionId || 'main'})`);

  const proc = spawn(OPENCLAW_BIN, args, {
    detached: true,
    stdio:    ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (d) => { stdout += d.toString(); });
  proc.stderr.on('data', (d) => { stderr += d.toString(); });

  proc.on('close', (code) => {
    const preview = stdout.slice(0, 200).replace(/\n/g, ' ');
    console.log(`[${agentId}] Task ${taskId} finished (code ${code}): ${preview}`);
    if (stderr) console.error(`[${agentId}] stderr: ${stderr.slice(0, 200)}`);
  });

  proc.on('error', (err) => {
    console.error(`[${agentId}] Spawn error for task ${taskId}: ${err.message}`);

    // REST fallback: retry with a detached long-timeout CLI call
    console.log(`[${agentId}] Retrying via fallback spawn (no session-id)...`);
    const fallback = spawn(OPENCLAW_BIN, [
      'agent', '--agent', agentId, '--message', message, '--timeout', '300',
    ], { detached: true, stdio: 'ignore' });
    fallback.unref();
  });

  // Unref immediately — fire-and-forget, don't block the event loop
  proc.unref();
}

// ─── Build one Express server per agent ──────────────────────────────────────
function startServer(agentName, config) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.post('/task', (req, res) => {
    // ─── Bearer token auth ────────────────────────────────────────────────────
    if (TRIGGER_AUTH_TOKEN) {
      const authHeader = req.headers['authorization'] || '';
      const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (provided !== TRIGGER_AUTH_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    const { task_id, brief, priority = 'normal', from = 'peter' } = req.body;

    if (!task_id || !brief) {
      return res.status(400).json({ error: 'task_id and brief are required' });
    }

    const timestamp = new Date().toISOString();
    const filename  = `TASK-${task_id}-${agentName}.md`;
    const filepath  = path.join(WORKSPACE, filename);

    // 1. Write brief to memory file for durable record
    const content = [
      `# TASK: ${task_id}`,
      `From: ${from}`,
      `Priority: ${priority}`,
      `Timestamp: ${timestamp}`,
      ``,
      brief,
      ``,
    ].join('\n');
    fs.writeFileSync(filepath, content);

    // 2. Respond immediately — agent spawn is async
    res.json({
      status:     'received',
      agent:      agentName,
      task_id,
      timestamp,
      brief_file: `memory/${filename}`,
      session_id: config.sessionId || null,
      spawning:   true,
    });

    // 3. Fire agent turn into the permanent session (fire-and-forget)
    const prompt = [
      `[TASK — ${task_id}] Priority: ${priority} | From: ${from}`,
      `Brief saved to: memory/${filename}`,
      ``,
      brief,
      ``,
      `Start working on this now. Report [STATUS TO PETER] when complete.`,
    ].join('\n');

    fireAgentTurn(agentName, config.sessionId, prompt, task_id);
  });

  app.get('/health', (_req, res) => {
    res.json({
      agent:      agentName,
      port:       config.port,
      session_id: config.sessionId || null,
      status:     'ok',
      timestamp:  new Date().toISOString(),
    });
  });

  app.listen(config.port, '127.0.0.1', () => {
    console.log(`[${agentName}] Listening on localhost:${config.port} (session: ${config.sessionId || 'pending'})`);
  });
}

// ─── Main: resolve session IDs then start all servers ────────────────────────
(async () => {
  console.log('[trigger-server] Resolving permanent session IDs...');

  await Promise.all(
    Object.entries(AGENTS).map(async ([name, cfg]) => {
      cfg.sessionId = await resolveSessionId(cfg.agentId);
    })
  );

  for (const [name, config] of Object.entries(AGENTS)) {
    startServer(name, config);
  }

  console.log('[trigger-server] All servers started (ENG-022 — session-pinned spawn).');
})();
