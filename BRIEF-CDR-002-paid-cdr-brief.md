# BRIEF: CDR-002 — Wire expanded scraper into paid CDR worker chain
From: Peter (COO)
Priority: high

## Objective
The paid report generator (`str-clinic-pdf-generator`) currently passes limited listing data to the CDR worker. Expand the paid CDR brief to include all enriched scraper fields and intake form data, and update the CDR-WRITER rules to match the standards already live in the free audit generator.

## Paid CDR Brief — Add These Fields

### From the scraper (already extracted in free audit — replicate for paid):
- `nightly_rate`
- `review_score`
- `review_count`
- `is_superhost`
- `is_guest_favourite`
- `amenities_count` (count of available amenities)
- `calendarOccupancy` (% booked next 90 days, from Browser Use calendar scraper)
- `photo_count`
- `property_type` (inferred: unique/rural | city/urban | standard — same detection logic as free audit)
- `persona` (A/B/C/D — same classification logic as free audit)

### From the intake form (new — passed via POST body):
- `other_platforms` — array of platforms the host is already on
- `ideal_guest` — free text from host
- `frustration` — host's stated biggest frustration
- `host_notes` — optional anything-else field

## CDR-WRITER Rules for Paid Reports (add to brief)

These mirror and extend the rules already in the free audit CDR brief:

1. **Occupancy — mandatory reference**: Name the occupancy number explicitly. Apply same thresholds:
   - < 50%: lead finding
   - 50–70%: mid-tier, revenue gap context
   - > 70%: positive signal, pivot to rate
   - null: use review velocity, note calendar unavailable

2. **Ideal guest — validate or challenge**: Use `ideal_guest` to either validate their target audience assumption ("Your listing aligns well with X") or challenge it constructively ("Your amenities and location suggest Y may actually convert better than X").

3. **Frustration — anchor the opening**: Use `frustration` to frame the report opening. The host has told us their pain point — acknowledge it directly before diagnosing it.

4. **Platform deduplication — never recommend what they're already on**: Cross-reference `other_platforms` against all platform recommendations. Never suggest a platform the host already uses. If they're on Vrbo, skip Vrbo. Adjust recommendations to only name new opportunities.

5. **Dynamic platform recommendations by property type**: Use `property_type` (same logic as free audit CDR-001):
   - unique/rural: Vrbo (if not already on it), Coolstays, Canopy & Stars, Hipcamp
   - city/urban: Booking.com (if not already on it), corporate travel platforms if workspace amenities detected
   - standard: Vrbo + Booking.com (if not already on them)

6. **Neutral property language**: Never call it "your home" or "your house". Use "your property", "your listing", "the space", or the property name.

## Where to Make Changes
- `generate-report.js` in `str-clinic-pdf-generator`
- The function that builds and sends the CDR brief (equivalent of `generateAIFields` in the free audit generator)
- Add scraper calls for fields not yet extracted in the paid flow (reuse or import scraper logic from free audit if possible)

## Deliverable
PR against `str-clinic-pdf-generator` main.
Title: `[OC-CDR-002] feat: expanded scraper data + intake fields in paid CDR brief`
Report PR URL to Mission Control (-5085897499) on raise.

## Handoff
Follow ENG-019-PR-C handoff protocol — write handoff file to workspace memory before reporting STATUS TO PETER.
