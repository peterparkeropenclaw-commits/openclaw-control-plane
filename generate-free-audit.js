#!/usr/bin/env node
'use strict';

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
const safeName = data.property_name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
const outputFile = outputArg || `${safeName}-strclinic-free-audit.pdf`;

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
    background: #FFFFFF;
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
    color: #1A1A2E;
    line-height: 1;
    display: inline;
  }

  .score-suffix {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 40px;
    color: rgba(26,26,46,0.35);
    display: inline;
    margin-left: 4px;
  }

  .score-narrative {
    font-family: 'Inter', sans-serif;
    font-weight: 400;
    font-size: 13px;
    color: rgba(26,26,46,0.7);
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
    color: #1A1A2E;
    text-transform: uppercase;
    margin-bottom: 6px;
  }

  .issue-desc {
    font-family: 'Inter', sans-serif;
    font-weight: 400;
    font-size: 12px;
    color: rgba(26,26,46,0.75);
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
    border-top: 1px solid rgba(26,26,46,0.1);
    margin: 16px 0;
  }

  .score-note {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    color: rgba(26,26,46,0.35);
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
    background: #FFFFFF;
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
  <div class="title-page-note">Description, photo plan, pricing calendar, competitor analysis, amenity rewrite and guest templates included in the full report.</div>
</div>

<!-- PAGE 4: OPPORTUNITY + UPSELL -->
<div class="page opp-page">
  <div class="section-label">The Opportunity</div>
  <div class="opp-title">What Your Listing Could Achieve</div>
  <div class="gold-rule-2"></div>
  <div class="opp-para">${escHtml(d.opportunity_summary)}</div>
  <div class="opp-separator"></div>
  <div class="upsell-heading">Ready to Fix It?</div>
  <div class="upsell-body">This audit identified issues holding your listing back. The STR Clinic full report fixes all of them — rewritten title, description, photo plan, 12-month pricing calendar, competitor analysis, amenity rewrite, and guest templates. Everything done for you, ready to paste in.</div>
  <div class="price-block">
    <div class="price-amount">£199</div>
    <div class="price-note">one-off · no subscription</div>
  </div>
  <div class="cta-pill">Reply to this email to get started</div>
  <span class="cta-note">No subscription. No ongoing commitment. One payment, everything fixed.</span>
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
