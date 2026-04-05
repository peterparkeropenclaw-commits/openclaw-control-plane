#!/usr/bin/env node
'use strict';

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const STRIPE_LINKS = {
  GBP: 'https://buy.stripe.com/PLACEHOLDER_UK',
  USD: 'https://buy.stripe.com/PLACEHOLDER_US',
};

const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
};

const inputFile = getArg('--input');
const outputArg = getArg('--output');

if (!inputFile) {
  console.error('Usage: node generate-free-audit.js --input free-audit.json [--output output.pdf]');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
const currency = detectCurrency(data);
const sym = currency.symbol;
const stripeUrl = STRIPE_LINKS[currency.code] || STRIPE_LINKS.GBP;
const stripePriceLabel = currency.code === 'USD' ? '$199' : '£199';
const safeName = data.property_name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
const outputFile = outputArg || `${safeName}-strclinic-free-audit.pdf`;

/**
 * Detect currency from listing data.
 * Priority: explicit currency_code field > listing_url > location string > default GBP
 * Returns: { symbol: '£'|'$'|'AU$', code: 'GBP'|'USD'|'AUD', name: 'British Pounds'|'US Dollars'|'Australian Dollars' }
 */
function detectCurrency(data) {
  if (data.currency_code) {
    const map = { GBP: { symbol: '£', code: 'GBP', name: 'British Pounds' }, USD: { symbol: '$', code: 'USD', name: 'US Dollars' }, AUD: { symbol: 'AU$', code: 'AUD', name: 'Australian Dollars' } };
    return map[data.currency_code.toUpperCase()] || { symbol: '£', code: 'GBP', name: 'British Pounds' };
  }
  if (data.listing_url) {
    if (data.listing_url.includes('airbnb.com.au')) return { symbol: 'AU$', code: 'AUD', name: 'Australian Dollars' };
    if (data.listing_url.includes('airbnb.co.uk')) return { symbol: '£', code: 'GBP', name: 'British Pounds' };
    if (data.listing_url.includes('airbnb.com')) return { symbol: '$', code: 'USD', name: 'US Dollars' };
  }
  const loc = (data.location || '').toLowerCase();
  if (/\b(australia|au|nsw|vic|qld|wa|sa|tas|act)\b/.test(loc)) return { symbol: 'AU$', code: 'AUD', name: 'Australian Dollars' };
  if (/\b(usa|united states|us|new york|los angeles|california|florida|texas)\b/.test(loc)) return { symbol: '$', code: 'USD', name: 'US Dollars' };
  if (/\b(uk|united kingdom|england|scotland|wales|london|cornwall|devon|yorkshire)\b/.test(loc)) return { symbol: '£', code: 'GBP', name: 'British Pounds' };
  return { symbol: '£', code: 'GBP', name: 'British Pounds' };
}


function extractLowerBound(estimate) {
  if (!estimate) return '£199';
  const match = estimate.match(/[£$AU]+[\d,]+/);
  return match ? match[0] : estimate;
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}

function buildHtml(d) {
  const issuesHtml = (d.top_3_issues || []).map((item, i, arr) => `
    <div class="issue-block">
      <div class="issue-name">${escHtml(item.issue)}</div>
      <div class="issue-desc">${escHtml(item.description)}</div>
      <div class="issue-impact">${escHtml(item.revenue_impact)}</div>
    </div>
    ${i < arr.length - 1 ? '<hr class="issue-divider">' : ''}
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>STR Clinic Free Audit — ${escHtml(d.property_name)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;900&family=IBM+Plex+Mono:wght@400&family=Inter:wght@400;500&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'Inter', sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .page {
    width: 210mm;
    min-height: 297mm;
    position: relative;
    overflow: hidden;
    page-break-after: always;
  }

  /* ── PAGE 1: COVER ── */
  .cover {
    background: #1A1A2E;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 48px 40px;
  }

  .cover-logo {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    font-size: 64px;
    color: #E8C840;
    text-transform: uppercase;
    letter-spacing: 6px;
    text-align: center;
    line-height: 1;
  }

  .cover-divider {
    width: 60px;
    height: 2px;
    background: #E8C840;
    margin: 18px auto 16px;
  }

  .cover-subtitle {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    color: rgba(255,255,255,0.6);
    letter-spacing: 3px;
    text-transform: uppercase;
    text-align: center;
    margin-bottom: 40px;
  }

  .cover-property {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 28px;
    color: #FFFFFF;
    text-transform: uppercase;
    text-align: center;
    margin-bottom: 8px;
  }

  .cover-location {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    color: rgba(255,255,255,0.45);
    text-transform: uppercase;
    text-align: center;
    letter-spacing: 2px;
  }

  .cover-spacer { flex: 1; }

  .cover-from {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    color: rgba(232,200,64,0.55);
    text-align: center;
    margin-bottom: 6px;
  }

  .cover-date {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    color: rgba(255,255,255,0.25);
    text-align: center;
    margin-bottom: 48px;
  }

  .cover-footer {
    position: absolute;
    bottom: 28px;
    left: 0; right: 0;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 8px;
    color: rgba(232,200,64,0.4);
    text-align: center;
    letter-spacing: 2px;
    text-transform: uppercase;
  }

  /* ── PAGE 2: SCORE + ISSUES ── */
  .score-page {
    background: #1A1A2E;
    padding: 56px 56px 48px;
  }

  .section-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    color: #E8C840;
    letter-spacing: 3px;
    text-transform: uppercase;
    margin-bottom: 8px;
  }

  .score-number {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    font-size: 88px;
    color: #FFFFFF;
    line-height: 1;
    display: inline;
  }

  .score-suffix {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 40px;
    color: rgba(255,255,255,0.35);
    display: inline;
    margin-left: 4px;
  }

  .score-narrative {
    font-family: 'Inter', sans-serif;
    font-weight: 400;
    font-size: 13px;
    color: rgba(255,255,255,0.7);
    font-style: italic;
    max-width: 480px;
    line-height: 1.6;
    margin-top: 12px;
    margin-bottom: 24px;
  }

  .gold-rule {
    width: 100%;
    height: 1.5px;
    background: #E8C840;
    margin-bottom: 24px;
  }

  .issues-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    color: #E8C840;
    letter-spacing: 3px;
    text-transform: uppercase;
    margin-bottom: 20px;
  }

  .issue-block {
    margin-bottom: 16px;
  }

  .issue-name {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 18px;
    color: #FFFFFF;
    text-transform: uppercase;
    margin-bottom: 6px;
  }

  .issue-desc {
    font-family: 'Inter', sans-serif;
    font-weight: 400;
    font-size: 12px;
    color: rgba(255,255,255,0.75);
    line-height: 1.6;
    margin-bottom: 6px;
  }

  .issue-impact {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    color: #E8C840;
  }

  .issue-divider {
    border: none;
    border-top: 1px solid rgba(255,255,255,0.1);
    margin: 16px 0;
  }

  .score-note {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    color: rgba(255,255,255,0.35);
    font-style: italic;
    margin-top: 24px;
  }

  /* ── PAGE 3: TITLE REWRITE ── */
  .title-page {
    background: #F5F0E8;
    padding: 56px 56px 48px;
  }

  .title-page-title {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    font-size: 28px;
    color: #1A1A2E;
    text-transform: uppercase;
    margin-bottom: 16px;
    line-height: 1.1;
  }

  .gold-rule-2 {
    width: 100%;
    height: 2px;
    background: #E8C840;
    margin-bottom: 28px;
  }

  .block-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    color: rgba(26,26,46,0.4);
    text-transform: uppercase;
    letter-spacing: 2px;
    margin-bottom: 6px;
  }

  .before-box {
    background: #efefef;
    border-left: 3px solid #bbb;
    padding: 12px 16px;
    font-family: 'Inter', sans-serif;
    font-size: 14px;
    color: rgba(26,26,46,0.6);
    margin-bottom: 24px;
  }

  .after-label-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 6px;
  }

  .after-label-pill {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    background: #1A1A2E;
    color: #E8C840;
    padding: 3px 8px;
    border-radius: 3px;
    letter-spacing: 1px;
    text-transform: uppercase;
  }

  .after-box {
    background: #fdfbf0;
    border-left: 3px solid #E8C840;
    padding: 12px 16px;
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 18px;
    color: #1A1A2E;
    margin-bottom: 20px;
  }

  .rationale-box {
    background: #f0f4ff;
    border-left: 3px solid #1A1A2E;
    padding: 12px 16px;
    margin-bottom: 24px;
  }

  .rationale-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 8px;
    color: rgba(26,26,46,0.4);
    text-transform: uppercase;
    letter-spacing: 2px;
    margin-bottom: 6px;
  }

  .rationale-text {
    font-family: 'Inter', sans-serif;
    font-size: 12px;
    color: rgba(26,26,46,0.7);
    font-style: italic;
    line-height: 1.6;
  }

  .title-page-note {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 8px;
    color: rgba(26,26,46,0.35);
  }

  /* ── PAGE 4: OPPORTUNITY + UPSELL ── */
  .opp-page {
    background: #1A1A2E;
    padding: 56px 56px 48px;
  }

  .opp-title {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    font-size: 28px;
    color: #1A1A2E;
    text-transform: uppercase;
    margin-bottom: 16px;
    line-height: 1.1;
  }

  .opp-para {
    font-family: 'Inter', sans-serif;
    font-weight: 400;
    font-size: 13px;
    color: rgba(26,26,46,0.75);
    line-height: 1.7;
  }

  .opp-separator {
    width: 100%;
    height: 1px;
    background: rgba(26,26,46,0.1);
    margin: 32px 0;
  }

  .upsell-heading {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    font-size: 32px;
    color: #1A1A2E;
    text-transform: uppercase;
    margin-bottom: 12px;
  }

  .upsell-body {
    font-family: 'Inter', sans-serif;
    font-size: 13px;
    color: rgba(26,26,46,0.7);
    line-height: 1.65;
    margin-bottom: 24px;
  }

  .price-block {
    margin-bottom: 20px;
  }

  .price-amount {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    font-size: 48px;
    color: #1A1A2E;
    line-height: 1;
  }

  .price-note {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    color: rgba(26,26,46,0.4);
    margin-top: 4px;
  }

  .cta-pill {
    display: inline-block;
    background: #E8C840;
    color: #1A1A2E;
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 14px;
    text-transform: uppercase;
    padding: 10px 24px;
    border-radius: 4px;
    letter-spacing: 1px;
    margin-bottom: 12px;
  }

  .cta-note {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    color: rgba(26,26,46,0.35);
    display: block;
  }

  /* ── BACK PAGE ── */
  .back-page {
    background: #1A1A2E;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 48px;
    page-break-after: auto;
  }

  .back-logo {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    font-size: 48px;
    color: #E8C840;
    text-align: center;
    letter-spacing: 4px;
    margin-bottom: 16px;
  }

  .back-divider {
    width: 60px;
    height: 1px;
    background: #E8C840;
    margin: 0 auto 20px;
  }

  .back-contact {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    color: rgba(255,255,255,0.45);
    text-align: center;
    margin-bottom: 10px;
  }

  .back-copy {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 8px;
    color: rgba(255,255,255,0.25);
    text-align: center;
  }
</style>
</head>
<body>

<!-- PAGE 1: COVER -->
<div class="page cover">
  <div class="cover-logo">STR CLINIC</div>
  <div class="cover-divider"></div>
  <div class="cover-subtitle">Listing Health Audit</div>
  <div class="cover-property">${escHtml(d.property_name)}</div>
  <div class="cover-location">${escHtml(d.location)}</div>
  <div class="cover-spacer"></div>
  <div class="cover-from">From Brandon, Founder at STR Clinic</div>
  <div class="cover-date">${escHtml(d.date)}</div>
  <div class="cover-footer">DIAGNOSTIC REPORT · NOT THE FULL AUDIT</div>
</div>

<!-- PAGE 2: SCORE + TOP 3 ISSUES -->
<div class="page score-page">
  <div class="section-label">Listing Health Score</div>
  <div>
    <span class="score-number">${d.overall_score}</span><span class="score-suffix">/100</span>
  </div>
  <div class="score-narrative">${escHtml(d.score_narrative)}</div>
  <div style="text-align:center;margin:20px 0 8px;">
    <p style="font-family:'IBM Plex Mono',monospace;font-size:10pt;color:#E8C840;font-weight:600;letter-spacing:0.05em;margin:0;">
      Based on your listing's location, price, and current performance signals, we estimate your listing is leaving approximately
    </p>
    <p style="font-family:'Barlow Condensed',Arial,sans-serif;font-weight:900;font-size:36pt;color:#E8C840;line-height:1.1;margin:4px 0;">
      ${d.monthly_revenue_gap_estimate || `${sym}200–${sym}400/month`}
    </p>
    <p style="font-family:'IBM Plex Mono',monospace;font-size:9pt;color:#E8C840;opacity:0.8;letter-spacing:0.1em;margin:0;">
      on the table each month.
    </p>
  </div>
  <div style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);padding:12px 18px;border-radius:2px;margin-bottom:28px;text-align:center;">
    <p style="font-family:'Inter',Arial,sans-serif;font-size:9pt;color:rgba(255,255,255,0.65);line-height:1.6;margin:0;font-style:italic;">
      The average STR Clinic audit scores 58/100. Listings scoring below 50 typically underperform their local market by 20–30% on occupancy.
    </p>
  </div>
  <div class="gold-rule"></div>
  <div class="issues-label">Top 3 Issues Identified</div>
  ${issuesHtml}
  <div class="score-note">Sub-scores and section breakdown available in the full STR Clinic report.</div>
</div>

<!-- PAGE 3: TITLE REWRITE PREVIEW -->
<div class="page title-page">
  <div class="section-label">Deliverable Preview</div>
  <div class="title-page-title">Here's What Your Title Could Look Like</div>
  <div class="gold-rule-2"></div>
  <div class="block-label">Current Title</div>
  <div class="before-box">${escHtml(d.current_title)}</div>
  <div class="after-label-row">
    <span class="after-label-pill">Ready to Paste</span>
  </div>
  <div class="after-box">${escHtml(d.rewritten_title)}</div>
  <div class="rationale-box">
    <div class="rationale-label">Why This Works</div>
    <div class="rationale-text">${escHtml(d.title_rationale)}</div>
  </div>
  <div style="margin-top:20px;margin-bottom:4px;">
    <p style="font-family:'IBM Plex Mono',monospace;font-size:7.5pt;color:#E8C840;letter-spacing:0.3em;text-transform:uppercase;margin-bottom:12px;">A glimpse of what else we found</p>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div style="background:rgba(26,26,46,0.07);border-left:3px solid rgba(232,200,64,0.5);padding:12px 16px;border-radius:2px;">
        <p style="font-family:'IBM Plex Mono',monospace;font-size:7pt;color:#E8C840;letter-spacing:0.25em;text-transform:uppercase;margin-bottom:6px;">Description</p>
        <p style="font-family:'Inter',Arial,sans-serif;font-size:9.5pt;color:#1A1A2E;line-height:1.55;margin:0;">${d.description_teaser || ''}</p>
      </div>
      <div style="background:rgba(26,26,46,0.07);border-left:3px solid rgba(232,200,64,0.5);padding:12px 16px;border-radius:2px;">
        <p style="font-family:'IBM Plex Mono',monospace;font-size:7pt;color:#E8C840;letter-spacing:0.25em;text-transform:uppercase;margin-bottom:6px;">Pricing</p>
        <p style="font-family:'Inter',Arial,sans-serif;font-size:9.5pt;color:#1A1A2E;line-height:1.55;margin:0;">${d.pricing_teaser || ''}</p>
      </div>
    </div>
  </div>
  <div style="background:#1A1A2E;padding:20px 24px;border-radius:2px;margin-top:20px;">
    <p style="font-family:'IBM Plex Mono',monospace;font-size:7.5pt;color:#E8C840;letter-spacing:0.3em;text-transform:uppercase;margin-bottom:10px;">What's in your full report</p>
    <p style="font-family:'Inter',Arial,sans-serif;font-size:9.5pt;color:rgba(255,255,255,0.75);margin-bottom:12px;line-height:1.5;">
      This is Section 1 of 7. The complete report also includes:
    </p>
    <ul style="list-style:none;padding:0;margin:0;">
      ${['Section 2 — Rewritten listing description (three-part, ready to paste)',
         'Section 3 — Photo order and selection plan',
         'Section 4 — 12-month seasonal pricing calendar',
         'Section 5 — Competitor positioning analysis',
         'Section 6 — Amenity presentation rewrite',
         'Section 7 — Guest communication templates (3 ready-to-use)'
        ].map(item => `<li style="display:flex;gap:10px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.08);font-family:'Inter',Arial,sans-serif;font-size:9.5pt;color:rgba(255,255,255,0.75);"><span style="color:#E8C840;flex-shrink:0;">•</span><span>${item}</span></li>`).join('')}
    </ul>
  </div>
  <div class="title-page-note">Description, photo plan, pricing calendar, competitor analysis, amenity rewrite and guest templates included in the full report.</div>
</div>

<!-- PAGE 4: OPPORTUNITY + UPSELL -->
<div class="page opp-page">
  <div class="section-label">The Opportunity</div>
  <div class="gold-rule-2"></div>
  <h2 style="font-family:'Barlow Condensed',Arial,sans-serif;font-weight:900;font-size:36pt;color:#E8C840;text-transform:uppercase;letter-spacing:0.03em;line-height:1.05;margin-bottom:24px;">
    Ready to recover that ${extractLowerBound(d.monthly_revenue_gap_estimate || `${sym}200`)}/month?
  </h2>
  <p style="font-family:'Inter',Arial,sans-serif;font-size:11pt;color:rgba(255,255,255,0.85);line-height:1.7;margin-bottom:28px;max-width:560px;">
    Your full STR Clinic report addresses every issue identified in this audit — and the six sections we haven't shown you yet. Rewritten copy, photo plan, pricing calendar, competitor analysis, amenity audit, and guest communication templates. All personalised to your listing. All ready to paste in.
  </p>
  <div style="margin-bottom:28px;">
    <p style="font-family:'Barlow Condensed',Arial,sans-serif;font-weight:900;font-size:48pt;color:#E8C840;line-height:1;margin-bottom:4px;">£199</p>
    <p style="font-family:'IBM Plex Mono',monospace;font-size:8pt;color:rgba(255,255,255,0.5);letter-spacing:0.2em;">/ $199 USD</p>
  </div>
  <a href="${stripeUrl}" style="display:inline-block;background:#E8C840;color:#1A1A2E;font-family:'Barlow Condensed',Arial,sans-serif;font-weight:900;font-size:18pt;text-transform:uppercase;letter-spacing:0.04em;padding:16px 40px;border-radius:4px;text-decoration:none;margin-bottom:16px;">
    GET YOUR FULL REPORT — ${stripePriceLabel}
  </a>
  <p style="font-family:'Inter',Arial,sans-serif;font-size:10pt;color:rgba(255,255,255,0.65);line-height:1.6;margin-bottom:20px;max-width:480px;">
    Click above to go directly to secure checkout. Your report will be delivered by email within 5 working days of payment.
  </p>
  <p style="font-family:'IBM Plex Mono',monospace;font-size:8pt;color:rgba(255,255,255,0.4);letter-spacing:0.15em;">
    No subscription. One payment. Everything fixed.
  </p>
  <p style="font-family:'IBM Plex Mono',monospace;font-size:7pt;color:rgba(255,255,255,0.3);letter-spacing:0.05em;margin-top:12px;">
    Or reply directly to this email and we'll send you the invoice.
  </p>
</div>

<!-- BACK PAGE -->
<div class="page back-page">
  <div class="back-logo">STR CLINIC</div>
  <div class="back-divider"></div>
  <div class="back-contact">brandon@strclinic.com · strclinic.com</div>
  <div class="back-copy">© 2026 STR Clinic</div>
</div>

</body>
</html>`;
}

async function main() {
  const html = buildHtml(data);
  const outputPath = path.resolve(outputFile);

  console.log('Launching Puppeteer...');
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.pdf({
    path: outputPath,
    format: 'A4',
    printBackground: true,
  });
  await browser.close();
  console.log(`PDF saved: ${outputPath}`);

  // Upload to Drive (hardcoded free audits folder)
  const folderId = '1nMysoqPplQT1S1C4f_Gjj75u_PSVEgpr';
  const uploadName = `${safeName}-strclinic-free-audit.pdf`;
  let driveLink = '';
  try {
    console.log('Uploading to Drive...');
    const uploadArgs = `gog drive upload "${outputPath}" --name "${uploadName}" --parent ${folderId} --account brandon@strclinic.com`;
    const uploadOut = execSync(uploadArgs, { encoding: 'utf8' }).trim();
    try {
      const parsed = JSON.parse(uploadOut);
      driveLink = parsed.webViewLink || parsed.link || parsed.url || '';
    } catch {
      const match = uploadOut.match(/https:\/\/[^\s]+/);
      driveLink = match ? match[0] : uploadOut;
    }
  } catch (err) {
    console.warn('Drive upload failed:', err.message);
  }

  if (driveLink) {
    console.log('\nDrive link:', driveLink);
  } else {
    console.log('\nPDF generated locally:', outputPath);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
