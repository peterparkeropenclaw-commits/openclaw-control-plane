#!/usr/bin/env node
/**
 * ENG-034: Playwright calendar occupancy scraper for STR Clinic.
 * Replaces scrape_calendar.py (Browser Use + Claude).
 *
 * Strategy: Airbnb exposes a public calendar_months JSON API. We call it
 * via Playwright's request context (real browser headers + cookies) which
 * passes bot-detection checks that raw curl/https does not.
 *
 * Usage:  node scrape_calendar_playwright.js <airbnb_listing_url>
 *
 * Output (stdout, always exits 0):
 *   Success: {"occupancy": 0.84, "booked_days": 76, "total_days": 90}
 *   Failure: {"occupancy": null, "error": "<reason>"}
 *
 * Timeout: 30s total hard cap.
 */

'use strict';

const { chromium, request: pwRequest } = require('playwright');
const https = require('https');

const TIMEOUT_MS = 28000;
const LOOK_AHEAD_DAYS = 90;
const AIRBNB_API_KEY = 'd306zoyjsyarp7uqwjvs1o5h2';

function out(data) {
  process.stdout.write(JSON.stringify(data) + '\n');
}

function fail(msg) {
  out({ occupancy: null, error: String(msg) });
  process.exit(0);
}

const listingUrl = process.argv[2];
if (!listingUrl) fail('No listing URL provided');
if (!/airbnb\./i.test(listingUrl)) fail('URL does not appear to be an Airbnb listing');

function extractListingId(url) {
  const m = url.match(/\/rooms\/(?:plus\/)?(\d+)/i);
  return m ? m[1] : null;
}

function getMonthsToFetch() {
  const now = new Date();
  const months = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.push({ month: d.getMonth() + 1, year: d.getFullYear() });
  }
  return months;
}

function countOccupancy(calendarMonths) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() + LOOK_AHEAD_DAYS);

  let totalDays = 0;
  let bookedDays = 0;

  for (const month of calendarMonths) {
    const days = month.days || [];
    for (const day of days) {
      // Airbnb returns day_string ("2026-04-15") or date
      const rawDate = day.date || day.day_string || day.dateString;
      if (!rawDate) continue;
      const d = new Date(rawDate);
      if (isNaN(d)) continue;
      d.setHours(0, 0, 0, 0);
      if (d < now || d >= cutoff) continue;

      totalDays++;
      const isBooked = day.available === false
        || day.availability === 'unavailable'
        || day.available_for_checkin === false
        || day.min_nights_error === true;
      if (isBooked) bookedDays++;
    }
  }

  return { totalDays, bookedDays };
}

// --- Strategy 1: Playwright request context (browser-like, no full page render) ---
async function tryPlaywrightRequest(listingId) {
  const ctx = await pwRequest.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    extraHTTPHeaders: {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-GB,en;q=0.9',
      'X-Airbnb-API-Key': AIRBNB_API_KEY,
      'Referer': `https://www.airbnb.co.uk/rooms/${listingId}`,
    },
  });

  const months = getMonthsToFetch();
  const calendarMonths = [];

  for (const { month, year } of months) {
    const url = `https://www.airbnb.co.uk/api/v2/calendar_months?listing_id=${listingId}&month=${month}&year=${year}&count=1&_api_key=${AIRBNB_API_KEY}`;
    const resp = await ctx.get(url, { timeout: 8000 });
    if (!resp.ok()) continue;
    const json = await resp.json();
    const monthData = json?.calendar_months?.[0];
    if (monthData) calendarMonths.push(monthData);
  }

  await ctx.dispose();
  return calendarMonths;
}

// --- Strategy 2: Full browser visit then API (acquires real cookies first) ---
async function tryBrowserThenApi(listingId) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'en-GB',
      viewport: { width: 1280, height: 900 },
    });

    // Visit listing page to pick up session cookies
    const page = await context.newPage();
    try {
      await page.goto(`https://www.airbnb.co.uk/rooms/${listingId}`, {
        waitUntil: 'domcontentloaded',
        timeout: 10000,
      });
      await page.waitForTimeout(1500);
    } catch (_) { /* non-fatal — continue with whatever cookies we have */ }

    const months = getMonthsToFetch();
    const calendarMonths = [];

    for (const { month, year } of months) {
      const url = `https://www.airbnb.co.uk/api/v2/calendar_months?listing_id=${listingId}&month=${month}&year=${year}&count=1&_api_key=${AIRBNB_API_KEY}`;
      try {
        const resp = await context.request.get(url, {
          headers: {
            'Accept': 'application/json',
            'X-Airbnb-API-Key': AIRBNB_API_KEY,
          },
          timeout: 8000,
        });
        if (!resp.ok()) continue;
        const json = await resp.json();
        const monthData = json?.calendar_months?.[0];
        if (monthData) calendarMonths.push(monthData);
      } catch (_) { /* skip this month */ }
    }

    return calendarMonths;
  } finally {
    await browser.close();
  }
}

async function run() {
  const listingId = extractListingId(listingUrl);
  if (!listingId) return fail('Could not extract listing ID from URL');

  let calendarMonths = [];

  // Try lightweight API request first
  try {
    calendarMonths = await tryPlaywrightRequest(listingId);
  } catch (e) {
    console.warn('[calendar] Playwright request failed:', e.message);
  }

  // If that didn't get enough data, try full browser + API
  if (calendarMonths.length === 0) {
    try {
      calendarMonths = await tryBrowserThenApi(listingId);
    } catch (e) {
      console.warn('[calendar] Browser+API fallback failed:', e.message);
    }
  }

  if (calendarMonths.length === 0) {
    return fail('All strategies failed — Airbnb API returned no calendar data');
  }

  const { totalDays, bookedDays } = countOccupancy(calendarMonths);

  if (totalDays < 15) {
    return fail(`Too few calendar days found (${totalDays}) — listing may not exist or API blocked`);
  }

  const occupancy = Math.round((bookedDays / totalDays) * 100) / 100;
  out({ occupancy, booked_days: bookedDays, total_days: totalDays });
  process.exit(0);
}

// Hard timeout
const timer = setTimeout(() => fail('Playwright scraper timed out after 30s'), TIMEOUT_MS);
timer.unref();

run().catch((err) => fail(err.message || String(err)));
