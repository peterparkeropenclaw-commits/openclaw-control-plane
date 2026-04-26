# HEARTBEAT.md — Peter's Periodic Checks

Heartbeat fires every 1h. Run the checks below in rotation — not all every time.
Check `memory/heartbeat-state.json` to see what was last checked and when.

---

## Check Rotation

### 🔴 Always check (every heartbeat)
- [ ] Any new tasks from Brandon in recent messages?
- [ ] Any [STATUS TO PETER] blocks from dept heads that haven't been actioned?
- [ ] Any PM2 processes in error state? (`pm2 list` — look for stopped/errored)

### 🟡 Check every 2-3 hours
- [ ] **Email** — any urgent unread messages at brandon@strclinic.com or related accounts?
- [ ] **Telegram** — any missed messages from Brandon or Mission Control?
- [ ] **Calendar** — upcoming events in next 24-48h?
- [ ] **CP tasks** — any tasks stuck in `in_progress` or `routed` for >2h without update?

### 🟢 Check once per day (morning)
- [ ] **Router health** — `curl http://localhost:3220/health` — respond to Mission Control if down
- [ ] **CP health** — `curl http://localhost:3210/health`
- [ ] **Agent-triggers health** — `curl http://localhost:3101/health` through 3104
- [ ] **Open PRs** — any PRs awaiting Reviewer Bot action? Check openclaw-control-plane and openclaw-router repos
- [ ] **Blocked tasks** — any tasks in CP with state=blocked that need Brandon action?

---

## Standing alerts (always notify Mission Control if true)

- Router (port 3220) is down or crash-looping
- CP (port 3210) is not responding
- Any dept head has a [STATUS TO PETER] block with `status: failed` or `status: blocked`
- A PR has been open for >24h without Reviewer Bot action
- Brandon sends a direct Telegram message that hasn't been actioned

---

## What NOT to do during heartbeats

- Do not send Brandon a message just to say "all clear" — stay silent (HEARTBEAT_OK) unless something needs attention
- Do not re-run checks that ran <30 min ago
- Do not wake Brandon between 23:00-08:00 unless genuinely urgent
