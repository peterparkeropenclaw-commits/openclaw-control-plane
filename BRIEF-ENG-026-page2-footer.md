# BRIEF: ENG-026 — Fix page 2 footer overflow in str-clinic-free-audit-v3.html

**Repo:** str-clinic-free-audit-generator  
**File:** str-clinic-free-audit-v3.html  
**Priority:** High  
**PR required:** Yes — raise against main, title `[OC-ENG-026] fix: page 2 footer positioning`

---

## Problem

Page 2 of the free audit PDF renders as a blank page with a corrupted/misplaced footer. Root cause: `.page-foot` uses `position:absolute; bottom:0` inside `.page` which has `position:relative; min-height:297mm`. When page 2 content overflows 297mm, the absolute footer follows the overflow and renders on what becomes PDF page 3 instead of page 2.

---

## Fix

### 1. Change `.page` layout to flexbox (CSS, ~line 24)

Replace:
```css
.page{break-after:page;page-break-after:always;position:relative;min-height:297mm;}
```
With:
```css
.page{break-after:page;page-break-after:always;min-height:297mm;display:flex;flex-direction:column;}
```

Remove `position:relative` — it's only needed because the footer was absolute-positioned.

Also update the `@media print` duplicate at line 28 to match.

### 2. Change `.page-foot` to flow naturally (CSS, ~line 38)

Replace:
```css
.page-foot{position:absolute;bottom:0;left:0;right:0;height:36px;display:flex;align-items:center;justify-content:space-between;padding:0 64px;}
```
With:
```css
.page-foot{margin-top:auto;height:36px;display:flex;align-items:center;justify-content:space-between;padding:0 64px;}
```

`margin-top:auto` in a flex column pushes the footer to the bottom regardless of content height.

### 3. Tighten page 2 content to fit A4 (HTML, ~lines 309–372)

The `.one-thing-body` text is long and causes overflow. Shorten it to fit. Target: page 2 content must fit in 297mm minus padding (top 52px, bottom 56px + 36px footer = ~92px total). Trim the one-thing body to max 3 lines of text:

Current (too long):
> "Your title has 50 characters. It should lead with your single most compelling feature (the view, the hot tub, the location), include a guest-type signal (couples retreat, family hideaway, dog-friendly), and avoid filler words like "lovely", "cosy" or "beautiful" — guests search for specifics, not adjectives. If your title doesn't pass all three, rewriting it is the highest-ROI change you can make for free."

Replace with:
> "Lead with your best feature (the view, the hot tub, the location). Add a guest-type signal (couples retreat, dog-friendly). Cut filler words — guests search for specifics. If your title fails any of these, rewriting it is the single highest-ROI change you can make today."

---

## Test plan

1. Run `node generate-free-audit.js --input test-free-audit.json --output /tmp/test-p2.pdf`
2. Open PDF — page 2 must show platform opportunity section with footer `STR CLINIC · STRCLINIC.COM · 02 · FREE AUDIT` at the bottom of page 2
3. Page 3 must start cleanly with "From Brandon"
4. No blank pages anywhere in the PDF
5. Run `node generate-free-audit.js --input test-free-audit.json --output /tmp/test-p2.html --html` — confirm `✓ Zero unpopulated {{variables}}`

---

## Handoff

Session handoff file: `memory/YYYY-MM-DD-engineering-lead-ENG-026.md`  
Report `[STATUS TO PETER]` when PR is raised and test passes.
