#!/usr/bin/env node
'use strict';

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execFile } = require('child_process');

const args = process.argv.slice(2);
const getArg = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i+1] : null; };
const inputFile = getArg('--input');
const outputArg = getArg('--output');
const htmlMode = args.includes('--html');
const directMode = args.includes('--direct'); // pass all 33 vars directly in JSON, skip detection/AI

if (!inputFile) {
  console.error('Usage: node generate-free-audit.js --input data.json [--output file] [--html]');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

const STRIPE_GBP = 'https://buy.stripe.com/aFa7sK0QV6sb8tjaQ7cfK00';
const STRIPE_USD = 'https://buy.stripe.com/aFa7sK0QV6sb8tjaQ7cfK00';

function detectMarket(data) {
  const loc = (data.location || '').toLowerCase();
  const url = (data.listing_url || '').toLowerCase();
  if (url.includes('airbnb.co.uk') || url.includes('airbnb.ie')) return ukMarket();
  if (url.includes('airbnb.com.au')) return auMarket();
  const ukTerms = ['uk','england','scotland','wales','ireland','london','cornwall','devon','yorkshire','edinburgh','dublin','belfast','falmouth','bath','oxford','cambridge','manchester','bristol','brighton','norfolk','suffolk','kent','surrey','cotswold'];
  const euTerms = ['france','spain','italy','germany','portugal','netherlands','belgium','switzerland','austria','greece','croatia','paris','barcelona','rome','berlin','amsterdam','lisbon','madrid','milan','prague','vienna'];
  const usTerms = ['usa','united states','canada','new york','los angeles','california','florida','texas','toronto','vancouver','chicago','miami','seattle','boston','nashville','colorado','arizona','utah','hawaii'];
  const auTerms = ['australia','new zealand','nsw','vic','qld','western australia','south australia','tasmania','sydney','melbourne','brisbane','perth','adelaide','auckland','byron bay','gold coast','cairns'];
  if (ukTerms.some(t => loc.includes(t))) return ukMarket();
  if (euTerms.some(t => loc.includes(t))) return euMarket();
  if (usTerms.some(t => loc.includes(t))) return usMarket();
  if (auTerms.some(t => loc.includes(t))) return auMarket();
  return defaultMarket();
}

function ukMarket()      { return { marketLabel:'UK', sym:'£', code:'GBP', platformOppLow:8, platformOppHigh:18, airbnbBenchLow:28, airbnbBenchHigh:36, p2:'Vrbo', p3:'Booking.com' }; }
function euMarket()      { return { marketLabel:'European', sym:'€', code:'EUR', platformOppLow:8, platformOppHigh:18, airbnbBenchLow:25, airbnbBenchHigh:35, p2:'Vrbo', p3:'Booking.com' }; }
function usMarket()      { return { marketLabel:'North American', sym:'$', code:'USD', platformOppLow:10, platformOppHigh:22, airbnbBenchLow:30, airbnbBenchHigh:42, p2:'Vrbo', p3:'Furnished Finder' }; }
function auMarket()      { return { marketLabel:'Australian', sym:'A$', code:'AUD', platformOppLow:8, platformOppHigh:16, airbnbBenchLow:25, airbnbBenchHigh:35, p2:'Stayz', p3:'Booking.com' }; }
function defaultMarket() { return { marketLabel:'', sym:'$', code:'USD', platformOppLow:8, platformOppHigh:18, airbnbBenchLow:25, airbnbBenchHigh:38, p2:'Vrbo', p3:'Booking.com' }; }

const PLATFORM_INFO = {
  'Vrbo':             { desc: 'Different audience — families, longer stays, fewer competitors. Same property, new market.',                                                       bench: (s) => `${s}6k–10k additional per year for well-listed properties` },
  'Booking.com':      { desc: 'Massive international reach. Fills gaps between Airbnb bookings, strong for shoulder seasons.',                                                  bench: (s) => `${s}4k–8k additional per year` },
  'Furnished Finder': { desc: 'Mid-term rentals — 30+ days. Travel nurses, remote workers, relocations. Low competition, high occupancy.',                                      bench: () => '$4k–10k additional per year depending on availability' },
  'Stayz':            { desc: "Australia's leading holiday rental platform. Reaches domestic travellers who don't use Airbnb.",                                                  bench: () => 'A$5k–9k additional per year for well-listed properties' },
};

// Scrape property name and location from an Airbnb listing page.
// Returns { propertyName, location } — either may be null if not found.
async function scrapeListingContent(listingUrl) {
  return new Promise((resolve) => {
    const protocol = listingUrl.startsWith('https') ? https : http;
    const req = protocol.get(listingUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-GB,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const html = Buffer.concat(chunks).toString('utf8');

        // Property name — prefer listingTitle, fall back to og:title
        const listingTitle = (html.match(/"listingTitle":"([^"]+)"/) || [])[1] || null;
        const ogTitle = (html.match(/property="og:title"\s+content="([^"]+)"/) || html.match(/content="([^"]+)"\s+property="og:title"/) || [])[1] || '';
        const propertyName = listingTitle
          || ogTitle.replace(/·.*$/, '').replace(/Entire.*?in /i, '').trim()
          || null;

        // Location
        const localizedLocation = (html.match(/"localizedLocation":"([^"]+)"/) || [])[1] || null;
        const locMatch = html.match(/"addressLocality"\s*:\s*"([^"]+)"/) || html.match(/"city"\s*:\s*"([^"]+)"/);
        const regionMatch = html.match(/"addressRegion"\s*:\s*"([^"]+)"/);
        const location = localizedLocation
          || [locMatch?.[1], regionMatch?.[1]].filter(Boolean).join(', ')
          || null;

        // Description
        const descMatch = html.match(/"description":"((?:[^"\\]|\\.){30,1500}?)"/);
        let description = null;
        try { description = descMatch ? JSON.parse('"' + descMatch[1] + '"') : null; } catch (_) { description = descMatch?.[1] || null; }

        // Photo count — unique hosting image URLs
        const photoUrls = new Set(html.match(/https:\/\/a0\.muscache\.com\/im\/pictures\/hosting\/[^\s"?]+/g) || []);
        const photoCount = photoUrls.size;

        // Amenities
        const amenBlock = html.match(/"amenities":\[([\s\S]{10,4000}?)\]/);
        let amenitiesAvailable = [];
        let amenitiesUnavailable = [];
        if (amenBlock) {
          const titles = [...amenBlock[1].matchAll(/"title":"([^"]+)"/g)].map(m => m[1]);
          const avail  = [...amenBlock[1].matchAll(/"available":(true|false)/g)].map(m => m[1]);
          amenitiesAvailable   = titles.filter((_, i) => avail[i] !== 'false');
          amenitiesUnavailable = titles.filter((_, i) => avail[i] === 'false');
        }

        // Rating and review count
        const rating     = (html.match(/"reviewsScore":([0-9.]+)/) || html.match(/"starRating":([0-9.]+)/) || html.match(/"guestSatisfactionOverall":([0-9.]+)/) || [])[1] || null;
        const reviewText = html.match(/(\d+)\s+reviews?/i);
        const reviewCount = reviewText ? parseInt(reviewText[1], 10) : null;

        // Room type / property type
        const roomType = (html.match(/"roomType":"([^"]+)"/) || [])[1] || null;

        // Bedrooms / beds / bathrooms from og:title pattern e.g. "★5.0 · 1 bedroom · 1 bed · 1 bathroom"
        const bedsInfo = ogTitle.match(/(\d+)\s+bed(?:room)?s?.*?(\d+)\s+bath/i);

        resolve({
          propertyName,
          location,
          description,
          photoCount,
          amenitiesAvailable,
          amenitiesUnavailable,
          rating:      rating ? parseFloat(rating) : null,
          reviewCount,
          roomType,
          ogTitle,
        });
      });
    });
    req.on('error', () => resolve({ propertyName: null, location: null, description: null, photoCount: 0, amenitiesAvailable: [], amenitiesUnavailable: [], rating: null, reviewCount: null, roomType: null, ogTitle: '' }));
    req.setTimeout(20000, () => { req.destroy(); resolve({ propertyName: null, location: null, description: null, photoCount: 0, amenitiesAvailable: [], amenitiesUnavailable: [], rating: null, reviewCount: null, roomType: null, ogTitle: '' }); });
  });
}

async function generateAIFields(data, market, scraped) {
  const propertyName = data.property_name || scraped?.propertyName || 'this listing';
  const fallback = {
    title_score:         5,
    desc_score:          5,
    photo_score:         5,
    pricing_score:       5,
    platform_score:      5,
    overall_score:       50,
    MAIN_INSIGHT:        `${propertyName} has specific gaps in its listing that are directly impacting search visibility and conversion rate.`,
    QUICK_WIN:           `Rewrite your title to lead with your single best feature — the one thing a guest would pay more for. Paste it in today.`,
    FREE_TIP:            `Add your check-in and check-out times to your listing description. It reduces pre-booking messages and signals a professional host.`,
    BRANDON_NOTE_LINE_1: `${propertyName} has real differentiators that your current listing doesn't surface clearly.`,
    BRANDON_NOTE_LINE_2: `Guests who would choose you aren't seeing what makes you different — that's a direct revenue gap.`,
    BRANDON_NOTE_LINE_3: `The full report gives you the exact copy, sequence, and pricing to close it — ready to paste in.`,
  };

  const taskId = `CDR-AI-FIELDS-${Date.now()}`;
  const workspaceMemory = process.env.CDR_RESULT_DIR
    || path.join(process.env.HOME || '/tmp', '.openclaw', 'workspace', 'memory');
  const resultPath = path.join(workspaceMemory, `CDR-AI-RESULT-${taskId}.json`);
  const authToken = process.env.TRIGGER_AUTH_TOKEN || '';

  // Build rich context from scraped content
  const amenList = scraped?.amenitiesAvailable?.length
    ? scraped.amenitiesAvailable.join(', ')
    : 'not extracted';
  const amenMissing = scraped?.amenitiesUnavailable?.length
    ? scraped.amenitiesUnavailable.join(', ')
    : 'none noted';

  const brief = `You are CDR-WRITER for STR Clinic. Analyse this Airbnb listing and return scored output as JSON.

## Listing Data
Property name: ${propertyName}
Location: ${data.location || scraped?.location || 'Unknown'}
Listing title: ${scraped?.ogTitle || propertyName}
Room type: ${scraped?.roomType || 'Unknown'}
Description: ${scraped?.description || '(not available)'}
Photo count: ${scraped?.photoCount ?? 'unknown'}
Amenities available (${scraped?.amenitiesAvailable?.length ?? 0}): ${amenList}
Amenities unavailable/missing: ${amenMissing}
Guest rating: ${scraped?.rating ?? 'unknown'} | Review count: ${scraped?.reviewCount ?? 'unknown'}

## Scoring Instructions
Score each dimension 0–10 based on what you can infer from the listing data above.
Use STR Clinic scoring criteria:
- title_score: Does the title lead with a specific compelling feature? Is it keyword-rich, differentiated, and benefit-led? Penalise generic or vague titles.
- desc_score: Is the description detailed, sensory, and specific? Does it answer guest objections pre-emptively? Penalise short or cliché copy.
- photo_score: Is the photo count strong? (10+ good, 20+ excellent, <10 poor). Infer from count only — you cannot see the photos.
- pricing_score: Infer from rating/review volume. High reviews + high rating = likely well-priced. Unknown = score 5.
- platform_score: Infer from platform presence signals. Airbnb-only listing with no cross-platform signals = lower score.
- overall_score: Weighted average (title 25%, description 25%, photos 20%, pricing 15%, platform 15%). Round to nearest integer.

## Output Instructions
Tone: STR Clinic — direct, expert, no fluff. Written for UK short-term rental hosts. Brandon's voice: experienced host, host-to-host, practical.
BRANDON_NOTE lines must feel personal and specific to THIS listing — reference actual property name, location, or a specific detail from the description or amenities.
Return ONLY valid JSON, no commentary, no markdown:
{
  "title_score": <0-10>,
  "desc_score": <0-10>,
  "photo_score": <0-10>,
  "pricing_score": <0-10>,
  "platform_score": <0-10>,
  "overall_score": <0-100>,
  "MAIN_INSIGHT": "2-3 sentences — the single most important thing this host needs to know, specific to their listing",
  "QUICK_WIN": "1-2 sentences — the fastest highest-impact change they can make today, specific to their listing",
  "FREE_TIP": "1-2 sentences — a useful tactical tip not covered elsewhere",
  "BRANDON_NOTE_LINE_1": "Warm, direct, host-to-host — reference a specific detail about this property (max 20 words)",
  "BRANDON_NOTE_LINE_2": "Specific observation tied to their scores or listing content (max 20 words)",
  "BRANDON_NOTE_LINE_3": "Encouraging close with a clear next step (max 20 words)"
}

Write result to: ${resultPath}`;

  // POST to CDR webhook — endpoint configured via CDR_WEBHOOK_URL env var
  const cdrWebhookUrl = process.env.CDR_WEBHOOK_URL;
  if (!cdrWebhookUrl) {
    console.warn('CDR_WEBHOOK_URL not set — using fallback AI fields');
    return fallback;
  }

  try {
    await new Promise((resolve, reject) => {
      const payload = JSON.stringify({ task_id: taskId, brief, priority: 'high', from: 'generate-script' });
      const parsed = new URL(cdrWebhookUrl);
      const useHttps = parsed.protocol === 'https:';
      const transport = useHttps ? require('https') : http;
      const req = transport.request({
        hostname: parsed.hostname,
        port: parsed.port || (useHttps ? 443 : 80),
        path: parsed.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Authorization': `Bearer ${authToken}`,
        },
      }, (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error(`CDR webhook returned ${res.statusCode}`));
      });
      req.on('error', reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('CDR webhook timeout')); });
      req.write(payload);
      req.end();
    });
    console.log(`CDR task posted: ${taskId}`);
  } catch (e) {
    console.warn(`CDR webhook unreachable: ${e.message} — using fallback`);
    return fallback;
  }

  // Poll for result file (max 120s, every 3s) — async fs only
  const maxAttempts = 40;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const raw = JSON.parse(await fs.promises.readFile(resultPath, 'utf8'));
      await fs.promises.unlink(resultPath).catch(() => {});
      const fields = raw.fields || raw;
      console.log('CDR AI fields received.');
      return {
        title_score:         typeof fields.title_score    === 'number' ? fields.title_score    : fallback.title_score,
        desc_score:          typeof fields.desc_score     === 'number' ? fields.desc_score     : fallback.desc_score,
        photo_score:         typeof fields.photo_score    === 'number' ? fields.photo_score    : fallback.photo_score,
        pricing_score:       typeof fields.pricing_score  === 'number' ? fields.pricing_score  : fallback.pricing_score,
        platform_score:      typeof fields.platform_score === 'number' ? fields.platform_score : fallback.platform_score,
        overall_score:       typeof fields.overall_score  === 'number' ? fields.overall_score  : fallback.overall_score,
        MAIN_INSIGHT:        fields.MAIN_INSIGHT        || fallback.MAIN_INSIGHT,
        QUICK_WIN:           fields.QUICK_WIN           || fallback.QUICK_WIN,
        FREE_TIP:            fields.FREE_TIP            || fallback.FREE_TIP,
        BRANDON_NOTE_LINE_1: fields.BRANDON_NOTE_LINE_1 || fallback.BRANDON_NOTE_LINE_1,
        BRANDON_NOTE_LINE_2: fields.BRANDON_NOTE_LINE_2 || fallback.BRANDON_NOTE_LINE_2,
        BRANDON_NOTE_LINE_3: fields.BRANDON_NOTE_LINE_3 || fallback.BRANDON_NOTE_LINE_3,
      };
    } catch (e) {
      if (e.code !== 'ENOENT') {
        console.warn('Failed to parse CDR result:', e.message, '— using fallback');
        await fs.promises.unlink(resultPath).catch(() => {});
        return fallback;
      }
      // ENOENT = file not yet written, keep polling
    }
  }

  console.warn('CDR result timed out after 120s — using fallback');
  return fallback;
}

function populate(template, vars) {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => key in vars ? String(vars[key]) : match);
}

// Scrape calendar occupancy via Browser Use Python script.
// Returns integer 0–100 (% booked) or null on any failure.
async function scrapeCalendarOccupancy(listingUrl) {
  if (!listingUrl) return null;
  const scriptPath = path.join(__dirname, 'scrape_calendar.py');
  if (!fs.existsSync(scriptPath)) {
    console.warn('[calendar] scrape_calendar.py not found — skipping');
    return null;
  }
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

async function main() {
  let vars;

  if (directMode) {
    // --direct: input JSON contains all 33 vars ready to use
    vars = { ...data };
    // Ensure DATE has a fallback
    if (!vars.DATE) vars.DATE = new Date().toLocaleDateString('en-GB',{month:'long',year:'numeric'});
    console.log('Direct mode — using vars from JSON, skipping market detection and AI calls');
  } else {
    // Scrape full listing content from Airbnb
    const shouldScrape = data.listing_url && (
      !data.property_name || /^(your\s+property|)$/i.test(data.property_name.trim()) ||
      !data.location      || /^(uk|unknown|unknown location|)$/i.test(data.location.trim()) ||
      !data.title_score   // always scrape if scores not pre-filled
    );
    let scraped = { propertyName: null, location: null, description: null, photoCount: 0, amenitiesAvailable: [], amenitiesUnavailable: [], rating: null, reviewCount: null, roomType: null, ogTitle: '' };
    if (shouldScrape) {
      console.log('Scraping full listing content from Airbnb...');
      scraped = await scrapeListingContent(data.listing_url);
      if (scraped.propertyName) { data.property_name = scraped.propertyName; console.log(`  Property: ${data.property_name}`); }
      if (scraped.location)     { data.location = scraped.location; console.log(`  Location: ${data.location}`); }
      console.log(`  Photos: ${scraped.photoCount} | Amenities: ${scraped.amenitiesAvailable.length} | Rating: ${scraped.rating} (${scraped.reviewCount} reviews)`);
    }

    // Scrape calendar occupancy via Browser Use (non-blocking — null triggers fallback heuristic)
    if (data.listing_url && !data.occupancy_rate) {
      console.log('[calendar] Scraping occupancy via Browser Use...');
      const occ = await scrapeCalendarOccupancy(data.listing_url);
      if (occ != null) data.occupancy_rate = occ;
    }

    const market = detectMarket(data);
    const sym = market.sym;
    const aiFields = await generateAIFields(data, market, scraped);
    const p2 = PLATFORM_INFO[market.p2] || { desc:'', bench:()=>'' };
    const p3 = PLATFORM_INFO[market.p3] || { desc:'', bench:()=>'' };
    const stripeUrl = market.code === 'GBP' ? STRIPE_GBP : STRIPE_USD;

    // Use CDR-WRITER scores if returned, otherwise fall back to data fields or zero
    const scoreField = (key, cdrKey) => aiFields[cdrKey ?? key] ?? data[key] ?? (data.scores && data.scores[key]) ?? 0;

    // Convert a raw score to a bar-width percentage.
    // Scores from CDR-WRITER are on a 0–10 scale; template uses width:N%.
    // Multiply by 10 when ≤ 10 so a score of 7.5 → 75% bar width, not 7.5%.
    const toBarPct = (v) => { const n = Number(v) || 0; return n > 10 ? Math.round(n) : Math.round(n * 10); };

    vars = {
      PROPERTY_NAME:       data.property_name || '',
      LOCATION:            data.location || '',
      DATE:                data.date || new Date().toLocaleDateString('en-GB',{month:'long',year:'numeric'}),
      STRIPE_URL:          stripeUrl,
      CURRENCY:            sym,
      MARKET_LABEL:        market.marketLabel,
      SCORE:               aiFields.overall_score || data.overall_score || 0,
      TITLE_SCORE:         scoreField('title_score'),
      DESC_SCORE:          scoreField('desc_score'),
      PHOTO_SCORE:         scoreField('photo_score'),
      PRICING_SCORE:       scoreField('pricing_score'),
      PLATFORM_SCORE:      scoreField('platform_score'),
      TITLE_PCT:           toBarPct(scoreField('title_score')),
      DESC_PCT:            toBarPct(scoreField('desc_score')),
      PHOTO_PCT:           toBarPct(scoreField('photo_score')),
      PRICING_PCT:         toBarPct(scoreField('pricing_score')),
      PLATFORM_PCT:        toBarPct(scoreField('platform_score')),
      PLATFORM_OPP_LOW:    market.platformOppLow,
      PLATFORM_OPP_HIGH:   market.platformOppHigh,
      AIRBNB_BENCH_LOW:    market.airbnbBenchLow,
      AIRBNB_BENCH_HIGH:   market.airbnbBenchHigh,
      PLATFORM_2_NAME:     market.p2,
      PLATFORM_2_DESC:     p2.desc,
      PLATFORM_2_BENCH:    p2.bench(sym),
      PLATFORM_3_NAME:     market.p3,
      PLATFORM_3_DESC:     p3.desc,
      PLATFORM_3_BENCH:    p3.bench(sym),
      MAIN_INSIGHT:        aiFields.MAIN_INSIGHT,
      QUICK_WIN:           aiFields.QUICK_WIN,
      FREE_TIP:            aiFields.FREE_TIP,
      BRANDON_NOTE_LINE_1: aiFields.BRANDON_NOTE_LINE_1,
      BRANDON_NOTE_LINE_2: aiFields.BRANDON_NOTE_LINE_2,
      BRANDON_NOTE_LINE_3: aiFields.BRANDON_NOTE_LINE_3,
    };
  }

  // (end of if/else vars block)

  const templatePath = path.join(__dirname, 'str-clinic-free-audit-v3.html');
  const html = populate(fs.readFileSync(templatePath, 'utf8'), vars);

  const remaining = (html.match(/\{\{[A-Z0-9_]+\}\}/g) || []);
  if (remaining.length > 0) console.warn('WARNING: unpopulated vars:', [...new Set(remaining)].join(', '));

  const safeName = (vars.PROPERTY_NAME || data.property_name || 'audit').replace(/[^a-z0-9]/gi,'-').toLowerCase();
  const outputFile = outputArg || `${safeName}-strclinic-free-audit${htmlMode?'.html':'.pdf'}`;
  const outputPath = path.resolve(outputFile);

  if (htmlMode) {
    fs.writeFileSync(outputPath, html, 'utf8');
    console.log('HTML saved:', outputPath);
    if (remaining.length === 0) console.log('✓ Zero unpopulated {{variables}}');
    return;
  }

  console.log('Launching Puppeteer...');
  const browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1500));
  await page.pdf({ path: outputPath, format: 'A4', printBackground: true });
  await browser.close();
  console.log('PDF saved:', outputPath);

  const folderId = '1nMysoqPplQT1S1C4f_Gjj75u_PSVEgpr';
  let driveLink = '';
  try {
    const { google } = require('/Users/robotmac/workspace/str-clinic-pdf-generator/node_modules/googleapis');
    const oauthConfig = JSON.parse(fs.readFileSync('/tmp/gog-oauth-config.json','utf8'));
    const oauth2Client = new google.auth.OAuth2(oauthConfig.client_id, oauthConfig.client_secret, 'urn:ietf:wg:oauth:2.0:oob');
    oauth2Client.setCredentials({ refresh_token: oauthConfig.refresh_token });
    const drive = google.drive({ version:'v3', auth:oauth2Client });
    const resp = await drive.files.create({ requestBody:{ name:`${safeName}-strclinic-free-audit.pdf`, parents:[folderId] }, media:{ mimeType:'application/pdf', body:fs.createReadStream(outputPath) }, fields:'id,webViewLink' });
    driveLink = resp.data.webViewLink || `https://drive.google.com/file/d/${resp.data.id}/view`;
  } catch(e) { console.warn('Drive upload failed:', e.message); }
  if (driveLink) console.log('Drive link:', driveLink);
}

main().catch(e => { console.error(e); process.exit(1); });
