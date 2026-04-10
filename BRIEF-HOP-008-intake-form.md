# BRIEF: HOP-008 — Paid Audit Intake Form
From: Peter (COO)
Priority: high
Repo: str-clinic-pdf-generator (peterparkeropenclaw-commits/str-clinic-pdf-generator)

## Objective
Build a paid audit intake form at `/intake` in the `str-clinic-pdf-generator` repo.
This is the form paid customers complete after purchasing — it collects listing data and host context so CDR can generate a personalised report.

## Form Fields (in order)
1. **Airbnb URL** — text input, validated as a valid airbnb.com or airbnb.co.uk URL, required
2. **Other platforms you're on** — checkboxes (multi-select):
   - Vrbo
   - Booking.com
   - Coolstays
   - Canopy & Stars
   - None (exclusive — deselects others if chosen)
   - Other (with a free-text field that appears when selected)
3. **Your ideal guest** — free text, placeholder: "e.g. couples, families, remote workers, dog owners"
4. **Your biggest frustration with your listing right now** — free text/textarea
5. **Anything else we should know?** — optional textarea
6. **Email address** — validated email, required
7. **Order reference** — text input, required (from Stripe receipt)

## On Submit
- POST JSON to `strclinic-audit-webhook` (port 3215 on localhost, endpoint `/intake` — add this endpoint to the audit webhook server)
- Show a confirmation screen: "Thanks — we'll have your report ready within 48 hours."
- POST a Telegram notification to Mission Control (-5085897499) via the existing bot token (read from env MISSION_CONTROL_BOT_TOKEN / MISSION_CONTROL_CHAT_ID), formatted as:

```
📋 New Paid Audit Intake
Email: <email>
Order ref: <order_ref>
URL: <airbnb_url>
Other platforms: <comma-separated or "None">
Ideal guest: <ideal_guest>
Frustration: <frustration>
Notes: <host_notes or "—">
```

## Design
- Match strclinic.com aesthetic: dark navy background (#0D1117 or similar), gold/yellow accents (#E8C840 or similar)
- Use IBM Plex Mono for labels, Barlow Condensed for headings
- Clean, minimal — single column, mobile-friendly
- Form lives at `/intake` as a standalone HTML page served by the existing Express server (or a new lightweight Express route)

## Implementation Notes
- Add `/intake` GET route to serve the HTML form
- Add `/intake` POST route (or reuse `/webhook` with a type flag) on the audit-webhook side to receive paid intake submissions
- Keep it simple — no framework needed, plain HTML + inline CSS or a single `<style>` block
- Validation: client-side for UX, but also validate server-side before forwarding

## PR
- Branch from `origin/main`
- PR title: `[OC-HOP-008] feat: paid audit intake form at /intake`
- Report PR URL to Mission Control (-5085897499) on raise

## Handoff
Follow ENG-019-PR-C handoff protocol — write handoff file to workspace memory before reporting STATUS TO PETER.
