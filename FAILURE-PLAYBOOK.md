# FAILURE PLAYBOOK — OpenClaw Pipeline
# Locked: 2026-03-30 (Golden Path Freeze)

## Core Rule
Fix systems, never symptoms. Never manually execute happy-path steps.

---

## Failure Types

### 1. TASK STUCK
**Definition:** Task not progressing > 30 minutes in same state

**Response order:**
1. Check Control Plane state (`GET /tasks/:id`)
2. Check action queue (`GET /actions/pending`)
3. Check worker logs (`pm2 logs <worker>`)
4. Trigger reconcile if available
5. If still blocked → notify Brandon with full state dump

**NEVER:** manually advance state without explicit Brandon instruction

---

### 2. REVIEW LOOP (CHANGES REQUESTED)
**Definition:** PR repeatedly failing review

**Response:**
- Builder auto-fixes per reviewer feedback
- Loop continues until APPROVED or Brandon stops it
- Escalate only if: repeated low-quality output OR unclear requirements

---

### 3. MERGE FAILURE
**Definition:** merge-worker fails action

**Check:**
- PR still open and exists
- PR repo matches task repo
- GitHub token valid (`GITHUB_TOKEN`)

**If invariant violated:** block task, notify Brandon
**NEVER:** manually merge unless Brandon explicitly instructs

---

### 4. DEPLOY FAILURE
**Definition:** deploy-worker fails

**Check:**
- Deploy hook env var exists and is non-empty
- Correct Vercel project for repo
- Vercel reachable

**Response:** automatic retry first
**Escalate if:** hook missing or 3+ consecutive failures

---

### 5. VERIFY FAILURE
**Definition:** deployed URL not returning healthy response

**Response:**
1. Retry with backoff (3x)
2. Confirm correct URL in task record

**If persistent:** mark `deploy_failed`, notify Brandon

---

### 6. QA FAILURE
**Definition:** qa-worker smoke checks fail

**Response:**
- Mark `qa_failed`
- Notify Brandon immediately
- DO NOT auto-complete task

---

### 7. SYSTEM HEALTH FAIL
**Definition:** `GET /health/full` returns FAIL

**Response:**
1. Identify failing component(s)
2. Fix root cause (CP logic, worker, config)
3. System is NOT trusted while FAIL — Peter escalates immediately

---

## Escalation Rule
Escalate to Brandon ONLY when:
- System cannot self-recover after retries
- An invariant is violated (wrong repo, missing PR, bad state)
- Configuration is missing (env var, deploy hook)
- Repeated failure pattern (3+ times same failure)

---

## Forbidden Actions (Peter)
- ❌ Manually merge PRs in happy path
- ❌ Manually deploy
- ❌ Manually advance states without Brandon instruction
- ❌ Bypass Control Plane
- ❌ Ignore failing health checks
- ❌ Patch symptoms instead of fixing root cause

---

## Invariants (must always be true)
- Every task has a defined repo
- PR title contains `[OC-{id}]`
- PR repo matches task repo
- Control Plane is source of truth
- Workers handle all execution
- Heartbeat does not mutate state
- Archived tasks never appear active
- `/health/full` = PASS before trusting automation

---

## Session Handoff Protocol (ENG-019-PR-C)

**Mandatory at every session end.** All department heads must write a handoff file before reporting [STATUS TO PETER].

### File path convention
```
~/.openclaw/workspace/memory/YYYY-MM-DD-[agent-name]-[task-id].md
```

### Required content
```markdown
## Completed
- What was done this session

## Pending
- What remains to be done

## Blockers
- Any blockers (or "none")
```

### Enforcement
- Department heads: must write handoff before status report
- Peter: will reject status reports without accompanying handoff file for multi-session tasks
- Workers: not required (session-scoped only)
