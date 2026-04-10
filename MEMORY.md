# MEMORY.md — Peter's Long-Term Memory

_Curated decisions, standing constraints, and key context. Raw logs live in memory/YYYY-MM-DD.md._

---

## Who I'm working with

- **Brandon** — Founder/CEO. Direct Telegram: 5821364140 (retired for agent use). All agent comms → Mission Control.
- **Engineering Lead** — owns all code implementation. Session label: `agent:engineering-lead:main`
- **Commercial Director** — owns outreach, leads, revenue. Session label: `agent:commercial-director:main`
- **Head of Product** — owns specs, design, direction. Session label: `agent:head-of-product:main`
- **Client Delivery Director** — owns delivery tracking. Soul file created 2026-04-10.

## Active projects

### ReplyWave (replywave.io)
- SaaS review-reply tool for SMEs
- Design: Bricolage Grotesque + Figtree, #2d3de8, pill buttons, lowercase
- Repo: peterparkeropenclaw-commits/review-responder
- Status: Active build, seeking first paying customers
- Outreach: Manual 5-10/day while pipeline builds; target high-review SME industries

### Optilyst (optilyst.app)
- Listing optimisation for Etsy/eBay sellers
- Design: Fraunces + Instrument Sans, #1e4535 green, #c4730a amber
- Repo: peterparkeropenclaw-commits/optilyst-app
- Status: Active build + outreach
- Vercel deploy: secrets set (VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID)

### Airbnb Optimiser
- Repo: peterparkeropenclaw-commits/airbnb-optimiser
- Status: Active

### STR Clinic
- Brandon's existing business (health/wellness)
- Email: brandon@strclinic.com
- Current: Facebook warm-up campaign (14 posts, April 2026)

## Infrastructure

| Service | Port | Status |
|---|---|---|
| Control Plane (CP) | 3210 | Running |
| Router | 3220 | Running (47 restarts fixed 2026-04-10) |
| Dept head webhooks | 3101-3104 | Running (agent-triggers PM2) |

### Reviewer Bot webhook
Registered on: review-responder, airbnb-optimiser, openclaw-control-plane, optilyst-app, openclaw-agents-workspace, openclaw-mission-control
URL: https://reviewer.ocpipe.live/webhook
Secret: rr-reviewer-secret-2026 (env var only — never commit)

## Standing rules (Brandon-set)

1. **Telegram → Mission Control only.** Use `process.env.MISSION_CONTROL_BOT_TOKEN` / `process.env.MISSION_CONTROL_CHAT_ID`. Never hardcode credentials.
2. **No outreach or public posts** without explicit Brandon approval.
3. **Research tasks never go to build** without explicit YES from Brandon.
4. **Reviewer Bot must approve all PRs** before merge — no exceptions.
5. **No hardcoded credentials** in any committed file — Reviewer Bot will reject the PR.
6. **CP is the source of truth** — never treat worker self-reports as completion evidence.
7. **task.repo already contains owner/repo** — never prepend owner in CP tasks.

## Architecture decisions

- **Architecture V2 (2026-03-30):** Router is live and proven. All dispatch goes through Router. Ops Director retired. No permanent Builder/Researcher/Analyst agents. Builder v2 carve-out CLOSED.
- **Department heads (2026-03):** Permanent LLM sessions for Eng Lead, Commercial Director, Head of Product, Client Delivery Director. They brief workers, never execute directly.
- **Memory layer:** CP `/memory/context` endpoint. Scopes: global, build, research, commercial, replywave, optilyst.
- **Webhook triggers (ENG-021):** Primary task routing. Ports 3101-3104. Fallback: sessions_send.

## Lessons learned

- **Router crash = missing node_modules** (2026-04-03). Fix: ecosystem.config.js with `pre_hook: npm install`.
- **Hardcoded creds → PR rejected** by Reviewer Bot. Always use env vars.
- **Dept head sessions go stale** — always have direct-spawn fallback.
- **Write everything to files.** Mental notes don't survive session restarts.
- **Exec tool IS available** to me and to subagents — was wrong to claim otherwise early on (2026-04-02).
- **[STATUS TO PETER] blocks** should trigger Mission Control Telegram notification even without explicit block format.

## Key PRs and outcomes

| PR | Repo | Status | Notes |
|---|---|---|---|
| #25 | openclaw-control-plane | Open | Mission Control Telegram config for all dept heads |
| #1 | openclaw-router | Open | ecosystem.config.js crash loop fix |
| OC-proof-task-001 | optilyst-app | Blocked | Vercel workflow; needs GitHub PAT with `workflow` scope |

## Things to follow up

- [ ] OC-proof-task-001: Brandon needs to generate GitHub PAT with `workflow` scope to unblock Vercel deploy PR
- [ ] X API keys needed from Brandon to activate xurl/autonomous X posting
- [ ] PR #25 (Mission Control config) — awaiting Reviewer Bot approval after credential fix
