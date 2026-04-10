# BRIEF — ENG-023: Route AI Content Generation Through CDR-WRITER
From: Peter (via Brandon)
Priority: High
Created: 2026-04-10

---

## Objective

Both PDF generators currently call OpenAI directly for AI content fields. Brandon has instructed that all AI content generation must route through CDR-WRITER instead. Remove all direct OpenAI API calls from both generators. Replace with a POST to the CDR webhook.

---

## Repos to Update

1. `/Users/robotmac/workspace/str-clinic-free-audit-generator/generate-free-audit.js`
2. `/Users/robotmac/workspace/str-clinic-pdf-generator/generate-report.js`

---

## CDR Webhook

**Endpoint:** `POST http://localhost:3104/task`
**Auth:** Bearer token from env `TRIGGER_AUTH_TOKEN` (check peter-heartbeat/index.js or trigger-server.js for the token value)
**Payload:**
```json
{
  "task_id": "CDR-AI-FIELDS-<timestamp>",
  "brief": "<full brief text — see below>",
  "priority": "high",
  "from": "generate-script"
}
```

The endpoint writes the brief to a memory file and fires a turn into the CDR agent session. CDR then spawns CDR-WRITER to produce the copy.

**Response from /task:** Immediate `{ status: "received", ... }` — the AI fields are NOT returned synchronously.

---

## Required Architecture Change

Because `/task` is fire-and-forget (no synchronous response with the generated copy), the generators need a different approach:

**Option A — Poll for result file (recommended):**
1. POST to `/task` with a unique task_id
2. CDR-WRITER writes output to a predictable file: `~/.openclaw/workspace/memory/CDR-AI-RESULT-<task_id>.json`
3. Generator polls for that file (max 120s, check every 3s)
4. On receipt, parse and inject the AI fields
5. Delete the result file after use

**Option B — Inline generation via direct agent message:**
POST directly to CDR session via openclaw CLI:
```bash
openclaw message --session agent:client-delivery-director:main --message "<brief>" --wait --timeout 60
```
Parse AI fields from the response text.

**Recommendation: Option A** — more reliable, doesn't depend on CLI parsing.

---

## CDR-WRITER Brief Template

When POSTing to /task, the `brief` field should contain:

```
Generate AI content fields for an STR Clinic audit report.

Property: {{PROPERTY_NAME}}
Location: {{LOCATION}}
Score: {{SCORE}}/100
Title score: {{TITLE_SCORE}}/10
Photo score: {{PHOTO_SCORE}}/10
Description score: {{DESC_SCORE}}/10
Pricing score: {{PRICING_SCORE}}/10
Platform score: {{PLATFORM_SCORE}}/10

Generate the following fields. Use STR Clinic tone: direct, expert, no fluff. Written for UK Airbnb hosts. Brandon's voice — experienced host, practical advice.

Return as JSON only, no other text:
{
  "MAIN_INSIGHT": "2-3 sentences — the single most important thing this host needs to know about their listing performance",
  "QUICK_WIN": "1-2 sentences — the fastest highest-impact change they can make today",
  "FREE_TIP": "1-2 sentences — a useful tactical tip not covered elsewhere in the report",
  "BRANDON_NOTE_LINE_1": "First line of a personal note from Brandon — warm, direct, host-to-host",
  "BRANDON_NOTE_LINE_2": "Second line — a specific observation based on their scores",
  "BRANDON_NOTE_LINE_3": "Third line — encouraging close with clear next step"
}

Write result to: ~/.openclaw/workspace/memory/CDR-AI-RESULT-<TASK_ID>.json
```

---

## Result File Format

CDR-WRITER must write a JSON file to:
`~/.openclaw/workspace/memory/CDR-AI-RESULT-<task_id>.json`

Format:
```json
{
  "task_id": "...",
  "fields": {
    "MAIN_INSIGHT": "...",
    "QUICK_WIN": "...",
    "FREE_TIP": "...",
    "BRANDON_NOTE_LINE_1": "...",
    "BRANDON_NOTE_LINE_2": "...",
    "BRANDON_NOTE_LINE_3": "..."
  },
  "completed_at": "ISO timestamp"
}
```

---

## What to Remove

From both generators:
- `generateAIFields()` function and all its contents
- Any `require('openai')` or OpenAI client instantiation
- Any reference to `OPENAI_API_KEY` for content generation
- The openai npm package dependency (remove from package.json if present)

---

## Fallback

If CDR webhook is unreachable OR polling times out after 120s:
- Log a warning
- Use the existing hardcoded fallback copy (keep the fallback strings, just remove the OpenAI path)
- Do NOT fail the PDF generation — a fallback copy audit is better than no audit

---

## Acceptance Criteria

- [ ] Zero OpenAI API calls in either generator
- [ ] Both generators POST to `localhost:3104/task` for AI field generation
- [ ] Polling mechanism in place (max 120s, 3s interval)
- [ ] Fallback copy used on timeout — PDF still generates
- [ ] `verify-report.js` exits 0
- [ ] End-to-end test: run `node generate-free-audit.js` — confirm CDR-WRITER produced the AI fields (check log output confirms CDR path taken, not fallback)
- [ ] PR raised for each repo with title prefix `[OC-ENG-023-*]` for Reviewer Bot

---

## PRs Required

1. `str-clinic-free-audit-generator` — branch `feat/eng-023-cdr-writer-ai-fields`
2. `str-clinic-pdf-generator` — branch `feat/eng-023-cdr-writer-ai-fields`

Both PRs can be raised in parallel.

---

## Report Back

[STATUS TO PETER] with both PR links when done.
