# BRIEF: ENG-023 — Replace calendar API scraper with Browser Use for occupancy data

**Repo:** str-clinic-free-audit-generator  
**Priority:** High  
**Branch:** `feat/eng-023-browser-use-calendar` — branch from `origin/main` (NOT from any open PR branch)  
**PR title:** `[OC-ENG-023] feat: replace calendar API scraper with Browser Use`  
**PR #8 note:** PR #8 must stay open — this lands first, then PR #8 rebases on top

---

## Context

`scrapeCalendarOccupancy()` in `generate-free-audit.js` uses a hardcoded Airbnb API key (`d306zoyjsyarp7uqwjvs1o5h2`) that returns null and will rotate. Replace with Browser Use.

Browser Use is already live on this machine:
- Binary: `python3.11`
- Package: `browser-use==0.1.40` at `/opt/homebrew/lib/python3.11/site-packages`
- `langchain-anthropic==0.3.3` also installed
- Model: `claude-haiku-4-5-20251001`
- ANTHROPIC_API_KEY: load from `~/.zshrc` if not in env (see pattern below)

Reference implementation for imports and key loading: `/Users/robotmac/workspace/str-clinic-facebook-scraper/facebook_scraper.py`

---

## What to build

### 1. `scrape_calendar.py` (new file in repo root)

Standalone Python script. Accepts listing URL as CLI arg, outputs JSON to stdout.

```
python3.11 scrape_calendar.py https://www.airbnb.co.uk/rooms/1293583833228546059
```

Output (stdout only — no other print statements):
```json
{"occupancy": 72, "booked_days": 65, "available_days": 25}
```

**Script requirements:**
- Load ANTHROPIC_API_KEY from `~/.zshrc` if not in env (copy pattern from facebook_scraper.py lines 16-22)
- Use `Browser Use Agent` with `claude-haiku-4-5-20251001`
- Task prompt: navigate to the Airbnb listing URL, open the availability calendar, count booked vs available days across the next 90 days, return the counts
- Timeout: 90 seconds max
- On any error: print `{"occupancy": null, "error": "<message>"}` to stdout and exit 0 (never exit non-zero — caller treats non-zero as hard failure)
- No other output to stdout (use stderr for debug/logging)
- BrowserConfig: use headless=True

**Task prompt for the Browser Use agent:**
```
Go to this Airbnb listing: {url}

Open the availability calendar on the listing page. Count the number of days that are marked as booked/unavailable (greyed out, crossed out, or otherwise not selectable) across the next 90 days from today. Also count available days. 

Return ONLY a JSON object with no other text:
{{"booked_days": <integer>, "available_days": <integer>, "occupancy": <integer 0-100>}}

occupancy = round(booked_days / 90 * 100)
```

### 2. Update `scrapeCalendarOccupancy()` in `generate-free-audit.js`

Replace the existing API-based implementation with a child_process call to `scrape_calendar.py`.

```javascript
const { execFile } = require('child_process');
const path = require('path');

async function scrapeCalendarOccupancy(listingUrl) {
  const scriptPath = path.join(__dirname, 'scrape_calendar.py');
  return new Promise((resolve) => {
    execFile('python3.11', [scriptPath, listingUrl], { timeout: 100000 }, (err, stdout, stderr) => {
      if (err) {
        console.warn('[calendar] Browser Use script error:', err.message);
        return resolve(null);
      }
      try {
        const result = JSON.parse(stdout.trim());
        if (result.occupancy != null) {
          console.log(`[calendar] Occupancy: ${result.occupancy}% (${result.booked_days} booked, ${result.available_days} available)`);
          resolve(result.occupancy);
        } else {
          console.warn('[calendar] Browser Use returned null:', result.error);
          resolve(null);
        }
      } catch (e) {
        console.warn('[calendar] Failed to parse calendar output:', stdout);
        resolve(null);
      }
    });
  });
}
```

The existing fallback heuristic (review velocity) is already wired in `generate-free-audit.js` — `null` return from `scrapeCalendarOccupancy()` triggers it automatically. Do not remove it.

---

## Test

Run against Wyche Hut:
```bash
python3.11 scrape_calendar.py https://www.airbnb.co.uk/rooms/1293583833228546059
```

Expected: valid JSON with `occupancy` integer 0–100, no other stdout.

Then full pipeline test:
```bash
node generate-free-audit.js --input test-free-audit.json --output /tmp/test-eng023.pdf
```

Confirm logs show `[calendar] Occupancy: XX%` (not null/fallback).

---

## Handoff

Write session handoff to: `memory/YYYY-MM-DD-engineering-lead-ENG-023.md`  
Report `[STATUS TO PETER]` when PR is raised.
