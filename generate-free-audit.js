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

        // Photo count — unique hosting image URLs (various Airbnb CDN subdomains)
        const photoUrls = new Set([
          ...(html.match(/https:\/\/a0\.muscache\.com\/im\/pictures\/hosting\/[^\s"?]+/g) || []),
          ...(html.match(/https:\/\/a0\.muscache\.com\/im\/pictures\/[^\s"?]+/g) || []),
          ...(html.match(/https:\/\/a\d\.muscache\.com\/im\/pictures\/[^\s"?]+/g) || []),
        ]);
        const photoCount = photoUrls.size;
        const heroImage = (html.match(/property="og:image"\s+content="([^"]+)"/) || html.match(/content="([^"]+)"\s+property="og:image"/) || [])[1] || [...photoUrls][0] || null;

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

        // Nightly rate — try several Airbnb JSON patterns
        let nightlyRate = null;
        const ratePatterns = [
          /"amount":([0-9.]+),"amountMicros"/,
          /"basePrice":([0-9.]+)/,
          /"discountedAmount":([0-9.]+)/,
          /"price":{"amount":([0-9.]+)/,
          /"nightly_price":([0-9.]+)/,
        ];
        for (const pat of ratePatterns) {
          const m = html.match(pat);
          if (m) { const v = parseFloat(m[1]); if (v > 1 && v < 5000) { nightlyRate = v; break; } }
        }

        // is_superhost
        const isSuperhost = /["']isSuperhost["']\s*:\s*true/i.test(html) || /"superhost":true/i.test(html);

        // is_guest_favourite
        const isGuestFavourite = /["']isGuestFavorite["']\s*:\s*true/i.test(html) || /"guestFavorite":true/i.test(html);

        // amenities_count
        const amenitiesCount = amenitiesAvailable.length;

        resolve({
          propertyName,
          location,
          heroImage,
          description,
          photoCount,
          amenitiesAvailable,
          amenitiesUnavailable,
          amenitiesCount,
          rating:      rating ? parseFloat(rating) : null,
          reviewCount,
          roomType,
          ogTitle,
          nightlyRate,
          isSuperhost,
          isGuestFavourite,
          calendarOccupancy: null, // populated separately
        });
      });
    });
    req.on('error', () => resolve({ propertyName: null, location: null, heroImage: null, description: null, photoCount: 0, amenitiesAvailable: [], amenitiesUnavailable: [], amenitiesCount: 0, rating: null, reviewCount: null, roomType: null, ogTitle: '', nightlyRate: null, isSuperhost: false, isGuestFavourite: false, calendarOccupancy: null }));
    req.setTimeout(20000, () => { req.destroy(); resolve({ propertyName: null, location: null, heroImage: null, description: null, photoCount: 0, amenitiesAvailable: [], amenitiesUnavailable: [], amenitiesCount: 0, rating: null, reviewCount: null, roomType: null, ogTitle: '', nightlyRate: null, isSuperhost: false, isGuestFavourite: false, calendarOccupancy: null }); });
  });
}

// Attempt to fetch calendar occupancy for the next ~90 days via Airbnb's calendar API.
// Returns an integer 0–100 (% of days booked) or null if unavailable.
async function scrapeCalendarOccupancy(listingUrl) {
  const idMatch = listingUrl.match(/\/rooms\/(\d+)/);
  if (!idMatch) return null;
  const listingId = idMatch[1];
  const apiKey = 'd306zoyjsyarp7uqwjvs1o5h2';

  const now = new Date();
  let totalDays = 0;
  let bookedDays = 0;

  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const month = d.getMonth() + 1;
    const year = d.getFullYear();
    const url = `https://www.airbnb.co.uk/api/v2/calendar_months?listing_id=${listingId}&month=${month}&year=${year}&count=1&_api_key=${apiKey}`;
    try {
      const raw = await new Promise((resolve, reject) => {
        const req = https.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'X-Airbnb-API-Key': apiKey,
            'Accept': 'application/json',
          }
        }, (res) => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
            catch (e) { reject(e); }
          });
        });
        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
      });
      const days = raw?.calendar_months?.[0]?.days || [];
      for (const day of days) {
        if (day.available === false || day.availability === 'unavailable' || day.available_for_checkin === false) {
          bookedDays++;
        }
        totalDays++;
      }
    } catch (_) { /* API unavailable — skip */ }
  }

  if (totalDays < 20) {
    // API unavailable — estimate from review velocity as proxy
    return null;
  }
  return Math.round((bookedDays / totalDays) * 100);
}

async function generateAIFields(data, market, scraped, persona) {
  const propertyName = data.property_name || scraped?.propertyName || 'this listing';

  // Persona-appropriate fallback defaults
  const personaDefaults = {
    A: {
      MAIN_INSIGHT:        `${propertyName} looks to be attracting demand, but the current rate may be a little soft for how well the calendar appears to be moving.`,
      QUICK_WIN:           `Test a modest rate lift of around 10–15% on your strongest dates, then watch booking pace for two to three weeks before going further.`,
      FREE_TIP:            `Try a three-night weekend minimum on higher-demand periods. It can lift average booking value without needing a full repricing pass.`,
      BRANDON_NOTE_LINE_1: `${propertyName} appears to be drawing demand already.`,
      BRANDON_NOTE_LINE_2: `That usually points to pricing headroom rather than a visibility problem.`,
      BRANDON_NOTE_LINE_3: `The fuller review is where we test how far that headroom likely goes.`,
      cta_strength:        'medium',
    },
    B: {
      MAIN_INSIGHT:        `${propertyName} appears to be in good shape already. The next opportunity is less about repair and more about sharpening reach and commercial consistency.`,
      QUICK_WIN:           `Consider trialling a second platform once the title, cover image and lead copy all express the same guest promise.`,
      FREE_TIP:            `Rotate two strong hero images across different periods. It is a simple way to learn which visual angle draws better engagement.`,
      BRANDON_NOTE_LINE_1: `${propertyName} already reads stronger than many listings we review.`,
      BRANDON_NOTE_LINE_2: `The next gain may be in reach and positioning, not a full rewrite.`,
      BRANDON_NOTE_LINE_3: `A fuller clinic would show where expansion is most likely to pay off.`,
      cta_strength:        'soft',
    },
    C: {
      MAIN_INSIGHT:        `${propertyName} has a solid foundation, but it may not be converting the attention it earns as well as it could. That usually points to pricing, title clarity, or distribution rather than a fundamentally weak property.`,
      QUICK_WIN:           `Test one clearer title angle and one small pricing adjustment at the same time, then watch whether booking pace improves over the next few weeks.`,
      FREE_TIP:            `Make sure the title includes a recognisable location or feature term guests are likely to search for in your market.`,
      BRANDON_NOTE_LINE_1: `${propertyName} looks better than the booking pace suggests.`,
      BRANDON_NOTE_LINE_2: `That often means positioning or pricing needs a closer look first.`,
      BRANDON_NOTE_LINE_3: `The fuller review helps isolate which lever is most worth pulling.`,
      cta_strength:        'medium',
    },
    D: {
      MAIN_INSIGHT:        `${propertyName} has meaningful listing gaps that are likely making it harder for guests to understand the value quickly. The title, description and photo sequence all look like early priorities.`,
      QUICK_WIN:           `Rewrite the title around the clearest guest-facing differentiator so the strongest reason to click appears immediately.`,
      FREE_TIP:            `Add check-in details, practical stay information and local context to the description so more booking questions get answered upfront.`,
      BRANDON_NOTE_LINE_1: `${propertyName} looks better than the listing currently communicates.`,
      BRANDON_NOTE_LINE_2: `The early presentation may be creating avoidable conversion friction.`,
      BRANDON_NOTE_LINE_3: `The full clinic turns that into a clearer order of fixes.`,
      cta_strength:        'hard',
    },
  };
  const pDef = personaDefaults[persona] || personaDefaults['D'];

  const fallback = {
    title_score:         5,
    desc_score:          5,
    photo_score:         5,
    pricing_score:       5,
    platform_score:      5,
    overall_score:       50,
    persona:             persona || 'D',
    cta_strength:        pDef.cta_strength,
    MAIN_INSIGHT:        pDef.MAIN_INSIGHT,
    QUICK_WIN:           pDef.QUICK_WIN,
    FREE_TIP:            pDef.FREE_TIP,
    BRANDON_NOTE_LINE_1: pDef.BRANDON_NOTE_LINE_1,
    BRANDON_NOTE_LINE_2: pDef.BRANDON_NOTE_LINE_2,
    BRANDON_NOTE_LINE_3: pDef.BRANDON_NOTE_LINE_3,
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

  const personaDescriptions = {
    A: 'PERSONA A — BUSY BUT UNDERCHARGING: High occupancy (>70%) but nightly rate is low for the market. Hook: They think they\'re winning but they\'re subsidising guests.',
    B: 'PERSONA B — WELL OPTIMISED, WELL PRICED: Strong overall score (>74), occupancy >65%, review score >4.7. Hook: Genuine praise. No hard sell. These people share audits.',
    C: 'PERSONA C — GOOD LISTING, LOW BOOKINGS: Decent score (>60) but occupancy <40%. Hook: Visibility, pricing or platform problem — not a content problem.',
    D: 'PERSONA D — NEEDS WORK: Low score, weak bookings, low/few reviews. Hook: Direct, specific, urgent.',
  };
  const ctaInstructions = {
    A: 'cta_strength: return "medium"',
    B: 'cta_strength: return "soft"',
    C: 'cta_strength: return "medium"',
    D: 'cta_strength: return "hard"',
  };

  // Infer property type for dynamic platform recommendations
  const titleAndDesc = `${scraped?.ogTitle || propertyName} ${scraped?.description || ''}`.toLowerCase();
  const uniqueRuralKeywords = ['shepherd', 'treehouse', 'tree house', 'cabin', 'yurt', 'glamping', 'glamp', 'cottage', 'barn', 'hut', 'lodge', 'pod', 'tipi', 'wigwam', 'boathouse', 'windmill', 'farmhouse', 'bothy', 'bell tent', 'geodome', 'dome', 'roundhouse', 'canopy', 'rural', 'woodland', 'countryside', 'forest', 'lakeside', 'riverside', 'coastal cottage'];
  const cityKeywords = ['apartment', 'flat', 'studio', 'city centre', 'city center', 'central london', 'central manchester', 'central edinburgh', 'central bristol', 'penthouse', 'loft', 'serviced apartment'];
  const isUniqueRural = uniqueRuralKeywords.some(k => titleAndDesc.includes(k));
  const isCity = !isUniqueRural && cityKeywords.some(k => titleAndDesc.includes(k));
  const propertyTypeLabel = isUniqueRural ? 'unique/rural stay' : isCity ? 'city/urban apartment' : 'standard holiday let';
  const platformRecommendations = isUniqueRural
    ? `This is a unique/rural property. Platform recommendations:\n- Airbnb: primary platform (already listed)\n- Vrbo: strong fit — families and longer stays, mention first among additional platforms\n- Booking.com: valid secondary platform\n- Also relevant for this property type: Coolstays, Canopy & Stars, Hipcamp UK\n- Do NOT recommend corporate or city-focused platforms`
    : isCity
    ? `This is a city/urban property. Platform recommendations:\n- Airbnb: primary platform (already listed)\n- Booking.com: strong fit for urban properties — international reach, shoulder season fill, mention first\n- Vrbo: weaker fit for urban apartments — deprioritise or omit\n- If workspace amenities detected, mention corporate travel platforms`
    : `This appears to be a standard holiday let. Platform recommendations:\n- Airbnb: primary platform (already listed)\n- Vrbo: good secondary option — families, longer stays\n- Booking.com: strong international reach, fills gaps\n- If property type is unclear from the data, use these generic recommendations but note uncertainty`;

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
Guest rating: ${scraped?.rating ?? 'unknown'} / 5 | Review count: ${scraped?.reviewCount ?? 'unknown'}
Nightly rate: ${scraped?.nightlyRate ? `${market.sym}${scraped.nightlyRate}` : 'unknown'}
Is Superhost: ${scraped?.isSuperhost ?? 'unknown'}
Is Guest Favourite: ${scraped?.isGuestFavourite ?? 'unknown'}
Calendar occupancy (next 90 days): ${scraped?.calendarOccupancy != null ? `${scraped.calendarOccupancy}%` : 'unknown'}
Detected property type: ${propertyTypeLabel}

## Platform Recommendations
${platformRecommendations}
Use these recommendations when writing MAIN_INSIGHT, QUICK_WIN, or FREE_TIP if platform distribution is relevant to the persona angle.

## Persona Classification
This listing has been pre-classified as: PERSONA ${persona}
${personaDescriptions[persona] || personaDescriptions['D']}

Write ALL text fields (MAIN_INSIGHT, QUICK_WIN, FREE_TIP, BRANDON_NOTE lines) in the persona-appropriate tone and angle described above.
- Persona A: Acknowledge the busy listing, pivot to the pricing opportunity. Don't call them out harshly — they're doing well, just undervaluing.
- Persona B: Lead with genuine praise. Be specific. Soft sell only — mention what the full report adds (platform copy, multi-channel), but don't push hard.
- Persona C: Focus on distribution, visibility, or pricing as the likely lever. NOT a content criticism — the listing has good bones.
- Persona D: Be direct and specific. Name what's weak and why it costs them. The full report is the clear next step.

## Occupancy Rules — MANDATORY
Calendar occupancy (next 90 days) is a primary diagnostic signal. You MUST reference it explicitly in your copy — never leave it unmentioned if the data is present.

Apply these rules based on the occupancy figure provided above:
- Occupancy < 50%: This is the LEAD finding. Name the number directly in MAIN_INSIGHT. Example: "Your calendar is X% booked over the next 90 days — that's the gap we need to close."
- Occupancy 50–70%: Mid-tier finding. Reference the exact percentage in context of the revenue gap. Frame as "you're part-way there but leaving significant income on the table."
- Occupancy > 70%: Positive signal. Acknowledge it explicitly, then pivot to rate optimisation. "At X% occupancy you're clearly converting — the opportunity now is in rate, not volume."
- Occupancy is null / unknown: Do NOT invent a number. Reference review velocity (review count + rating) as a proxy signal instead, and note that calendar data was unavailable for this audit.

This rule applies regardless of persona. The number must appear in at least one of: MAIN_INSIGHT, QUICK_WIN, or BRANDON_NOTE lines.

## Language Rules
CRITICAL: Never refer to the listing as the host's "home", "house", or imply it is their primary residence. The property may be an investment, a second property, or a dedicated STR. Use instead: "your property", "your listing", "the space", or the specific property name (e.g. "${propertyName}") where known.
- "your home" → "your property" or "this listing"
- "your house" → "your property"
- Any language implying the host lives there → rephrase using the property name or "the space"

## Scoring Instructions
Score each dimension 0–10 based on what you can infer from the listing data above.
Use STR Clinic scoring criteria:
- title_score: Does the title lead with a specific compelling feature? Is it keyword-rich, differentiated, and benefit-led? Penalise generic or vague titles.
- desc_score: Is the description detailed, sensory, and specific? Does it answer guest objections pre-emptively? Penalise short or cliché copy.
- photo_score: Is the photo count strong? (10+ good, 20+ excellent, <10 poor). Infer from count only — you cannot see the photos.
- pricing_score: Infer from rating/review volume and nightly rate. High reviews + high rating = likely well-priced. Low rate with high occupancy = undercharging (score lower).
- platform_score: Infer from platform presence signals. Airbnb-only listing with no cross-platform signals = lower score.
- overall_score: Weighted average (title 25%, description 25%, photos 20%, pricing 15%, platform 15%). Round to nearest integer.

## Output Instructions
Tone: STR Clinic — direct, expert, no fluff. Written for UK short-term rental hosts. Brandon's voice: experienced host, host-to-host, practical.
BRANDON_NOTE lines must feel personal and specific to THIS listing — reference actual property name, location, or a specific detail from the description or amenities.
No generic phrases like "I noticed" or "it seems" — state observations directly. Max 20 words per BRANDON_NOTE line.
${ctaInstructions[persona] || ctaInstructions['D']}
Return ONLY valid JSON, no commentary, no markdown:
{
  "title_score": <0-10>,
  "desc_score": <0-10>,
  "photo_score": <0-10>,
  "pricing_score": <0-10>,
  "platform_score": <0-10>,
  "overall_score": <0-100>,
  "persona": "${persona}",
  "cta_strength": "<soft|medium|hard>",
  "MAIN_INSIGHT": "2-3 sentences, persona-appropriate, references actual listing data",
  "QUICK_WIN": "1 specific actionable thing referencing actual listing details",
  "FREE_TIP": "genuinely useful, not a teaser for paid report",
  "BRANDON_NOTE_LINE_1": "Specific detail about this property (max 20 words)",
  "BRANDON_NOTE_LINE_2": "Revenue/booking implication (max 20 words)",
  "BRANDON_NOTE_LINE_3": "Encouraging close with next step (max 20 words)"
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
        persona:             fields.persona              || fallback.persona,
        cta_strength:        fields.cta_strength         || fallback.cta_strength,
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

// Classify listing into persona A/B/C/D based on scraped data.
// Call this BEFORE generateAIFields so the persona can be included in the brief.
function classifyPersona(scraped, market) {
  const occupancy   = scraped.calendarOccupancy; // % or null
  const nightlyRate = scraped.nightlyRate;        // number or null
  const reviewScore = scraped.rating;             // float or null
  const reviewCount = scraped.reviewCount || 0;

  // Estimate occupancy from review velocity + quality signals when calendar data unavailable
  let effectiveOccupancy = occupancy;
  if (effectiveOccupancy === null) {
    // Base estimate from review count (proxy for booking velocity)
    if (reviewCount > 200)      effectiveOccupancy = 75;
    else if (reviewCount > 100) effectiveOccupancy = 65;
    else if (reviewCount > 50)  effectiveOccupancy = 52;
    else if (reviewCount > 20)  effectiveOccupancy = 38;
    else if (reviewCount > 10)  effectiveOccupancy = 28;
    else                        effectiveOccupancy = 15;

    // Boost estimate for quality signals that correlate with high occupancy
    if (scraped.isSuperhost)      effectiveOccupancy += 8;
    if (scraped.isGuestFavourite) effectiveOccupancy += 10;
    if (reviewScore !== null && reviewScore >= 4.9) effectiveOccupancy += 5;
  }

  // Low-rate threshold: UK rural < £120, UK urban < £150; others proportional
  const isRuralUK = market.code === 'GBP' &&
    !/london|manchester|edinburgh|bristol|oxford|cambridge|bath|brighton|york|birmingham|liverpool/i.test(scraped.location || '');
  const lowRateThreshold = market.code === 'GBP' ? (isRuralUK ? 120 : 150) :
    market.code === 'USD' ? 180 : market.code === 'EUR' ? 140 : 150;

  const isLowRate        = nightlyRate !== null && nightlyRate < lowRateThreshold;
  const isHighOccupancy  = effectiveOccupancy > 70;
  const isMediumOccupancy = effectiveOccupancy > 65;
  const isLowOccupancy   = effectiveOccupancy < 40;
  const isHighRating     = reviewScore !== null && reviewScore > 4.7;

  // Persona A: Busy but undercharging
  if (isHighOccupancy && isLowRate) return 'A';

  // Persona B: Well optimised — needs overall_score > 74, but we don't have that yet.
  // Use strong review signals as a proxy: high rating + many reviews + medium+ occupancy.
  if (isHighRating && reviewCount > 50 && isMediumOccupancy) return 'B';

  // Persona C: Good listing, low bookings
  if (isLowOccupancy && (isHighRating || reviewCount > 20)) return 'C';

  // Persona D: Needs work
  return 'D';
}

function buildCtaBlock(ctaStrength, currency, stripeUrl) {
  if (ctaStrength === 'hard') {
    return `<div class="cta-block">
    <div class="cta-lbl">One report. One payment. Your listing fixed.</div>
    <div class="cta-price">${currency}199</div>
    <div class="cta-price-sub">One-off &nbsp;·&nbsp; No subscription &nbsp;·&nbsp; Yours to keep</div>
    <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;color:rgba(255,255,255,0.3);letter-spacing:0.12em;margin-bottom:10px;position:relative;z-index:1;">Personally reviewed by Brandon before it leaves us</div>
    <a class="cta-btn" href="${stripeUrl}">Order Your Full Report</a>
    <div class="cta-url">strclinic.com &nbsp;·&nbsp; Secure checkout via Stripe</div>
  </div>`;
  } else if (ctaStrength === 'medium') {
    return `<div class="cta-block">
    <div class="cta-lbl">Want to see what the full report covers?</div>
    <div class="cta-price">${currency}199</div>
    <div class="cta-price-sub">One-off &nbsp;·&nbsp; No subscription &nbsp;·&nbsp; Yours to keep</div>
    <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;color:rgba(255,255,255,0.3);letter-spacing:0.12em;margin-bottom:10px;position:relative;z-index:1;">Personally reviewed by Brandon before it leaves us</div>
    <a class="cta-btn" href="${stripeUrl}">See What the Full Report Covers</a>
    <div class="cta-url">strclinic.com &nbsp;·&nbsp; Secure checkout via Stripe</div>
  </div>`;
  } else {
    // soft
    return `<div class="cta-block" style="background:rgba(26,26,46,0.06);border:1px solid rgba(26,26,46,0.12);box-shadow:none;padding:20px 24px;">
    <div class="cta-lbl" style="color:#374151;font-size:12px;">Your listing is performing well. If you ever want to go deeper —</div>
    <a class="cta-btn" href="${stripeUrl}" style="background:#1A1A2E;color:#E8C840;margin-top:12px;display:inline-block;padding:10px 24px;text-decoration:none;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:0.08em;">strclinic.com</a>
  </div>`;
  }
}

function populate(template, vars) {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => key in vars ? String(vars[key]) : match);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function coarseTenScore(value) {
  const n = Number(value) || 0;
  if (n <= 2) return 2;
  if (n <= 4) return 4;
  if (n <= 6) return 6;
  if (n <= 8) return 8;
  return 10;
}

function coarseHundredScore(value) {
  const n = Math.max(0, Math.min(100, Number(value) || 0));
  return Math.round(n / 5) * 5;
}

function scoreBandLabel(value) {
  const n = Number(value) || 0;
  if (n <= 4) return 'Needs attention';
  if (n <= 6) return 'Fair';
  if (n <= 8) return 'Good';
  return 'Strong';
}

function softenClaim(text) {
  return String(text || '')
    .replace(/the algorithm is ranking your listing lower/gi, 'the listing may be earning less visibility than it could')
    .replace(/algorithm-optimised/gi, 'search-aware')
    .replace(/reviews drive algorithm ranking/gi, 'early booking momentum can help the listing build stronger traction')
    .replace(/is estimated to materially improve conversion/gi, 'could improve conversion if the rest of the listing backs it up')
    .replace(/you are currently leaving those premiums uncaptured/gi, 'there may be seasonal pricing headroom that is not yet being reflected')
    .replace(/comparable ([^.]+?) achieve /gi, 'comparable $1 can achieve ')
    .replace(/you are estimated to be running at approximately/gi, 'you may currently be running closer to')
    .replace(/the gap is real, it is measurable, and the fixes are all implementable within a week/gi, 'The gap looks meaningful, but the exact upside needs a fuller commercial review')
    .replace(/directly costing bookings right now/gi, 'likely making bookings harder to win than they should be')
    .replace(/suppress search ranking and conversion/gi, 'can weaken visibility and conversion')
    .replace(/exactly where to raise rates without losing occupancy/gi, 'where pricing may have room to move, and how cautiously to test it')
    .replace(/exact copy and photo sequence to fix this/gi, 'a clearer copy direction and photo order to test next')
    .replace(/Est\. impact:/gi, 'Directional opportunity:')
    .replace(/missed bookings/gi, 'under-converted demand')
    .replace(/missed conversions/gi, 'conversion drag')
    .replace(/missed peak revenue/gi, 'peak-season upside not yet captured');
}

function renderIssueCards(data) {
  const fallback = [
    {
      issue: 'Title clarity is underselling the listing',
      description: 'The current headline does not front-load the feature or guest promise most likely to earn the click.',
      revenue_impact: 'Likely limiting click-through from search rather than clearly signalling what makes the stay worth opening.'
    },
    {
      issue: 'Photo order is not doing the selling early enough',
      description: 'The strongest visual cues should appear immediately, because most guests form a view before they reach the middle of the gallery.',
      revenue_impact: 'This usually affects confidence and enquiry quality before price becomes the deciding factor.'
    },
    {
      issue: 'Pricing and positioning need to work together',
      description: 'When copy, sequence and nightly rate are slightly out of step, a listing can look weaker than the property itself really is.',
      revenue_impact: 'The opportunity is directional rather than guaranteed, but tightening the offer typically improves booking quality.'
    }
  ];

  const issues = Array.isArray(data.top_3_issues) && data.top_3_issues.length ? data.top_3_issues.slice(0, 3) : fallback;
  return issues.map((item, idx) => `
    <article class="issue-card">
      <div class="issue-head">
        <div class="issue-kicker">Opportunity ${idx + 1}</div>
        <div class="issue-index">0${idx + 1}</div>
      </div>
      <div class="issue-layout">
        <div>
          <h3 class="issue-title">${escapeHtml(item.issue || 'Missed opportunity')}</h3>
          <p class="issue-body">${escapeHtml(softenClaim(item.description || ''))}</p>
        </div>
        <div class="issue-aside">
          <div class="issue-why">Why it matters</div>
          <p class="issue-impact">${escapeHtml(softenClaim(item.revenue_impact || 'This is a directional improvement opportunity rather than a guaranteed outcome.'))}</p>
        </div>
      </div>
    </article>`).join('');
}

function renderActionPlan(data) {
  const actions = [
    {
      title: 'Sharpen the first impression',
      body: data.rewritten_title
        ? `Use a clearer, search-friendly title such as “${data.rewritten_title}”, then align the lead photo to the same promise.`
        : 'Rewrite the title around the clearest guest-facing differentiator, then make sure the first photo proves that promise immediately.'
    },
    {
      title: 'Re-sequence for trust, not just completeness',
      body: 'Bring the most persuasive visual proof into the first three images, then use the rest of the gallery to remove booking friction.'
    },
    {
      title: 'Treat pricing as a second pass',
      body: 'Once the listing reads more clearly, review seasonal pricing and minimum-stay settings so the commercial signal matches the presentation.'
    }
  ];

  return actions.map((item, idx) => `
    <div class="action-item">
      <div class="action-num">0${idx + 1}</div>
      <div>
        <div class="action-title">${escapeHtml(item.title)}</div>
        <div class="action-body">${escapeHtml(item.body)}</div>
      </div>
    </div>`).join('');
}

// Scrape calendar occupancy via Playwright script (ENG-034).
// Returns float 0–1 (occupancy ratio) or null on any failure.
// Falls back gracefully — never throws, always returns null on error.
async function scrapeCalendarOccupancy(listingUrl) {
  if (!listingUrl) return null;
  const scriptPath = path.join(__dirname, 'scrape_calendar_playwright.js');
  if (!fs.existsSync(scriptPath)) {
    console.warn('[calendar] scrape_calendar_playwright.js not found — skipping');
    return null;
  }
  return new Promise((resolve) => {
    execFile('node', [scriptPath, listingUrl], { timeout: 35000 }, (err, stdout, stderr) => {
      if (err && !stdout) {
        console.warn('[calendar] Playwright scraper error:', err.message);
        return resolve(null);
      }
      try {
        const result = JSON.parse(stdout.trim());
        if (result.occupancy != null) {
          const pct = Math.round(result.occupancy * 100);
          console.log(`[calendar] Occupancy: ${pct}% (${result.booked_days} booked / ${result.total_days} days)`);
          resolve(result.occupancy);
        } else {
          console.warn('[calendar] Playwright returned null:', result.error || 'unknown');
          resolve(null);
        }
      } catch (e) {
        console.warn('[calendar] Failed to parse Playwright output:', (stdout || '').slice(0, 200));
        resolve(null);
      }
    });
  });
}

async function main() {
  let vars;

  if (directMode) {
    // --direct: input JSON contains all vars ready to use
    vars = { ...data };
    // Ensure DATE has a fallback
    if (!vars.DATE) vars.DATE = new Date().toLocaleDateString('en-GB',{month:'long',year:'numeric'});
    // Build CTA_BLOCK if not pre-supplied (backward compat with old direct JSONs)
    if (!vars.CTA_BLOCK) {
      const ctaStr = vars.CTA_STRENGTH || 'hard';
      const currency = vars.CURRENCY || '£';
      const stripeUrl = vars.STRIPE_URL || STRIPE_GBP;
      vars.CTA_BLOCK = buildCtaBlock(ctaStr, currency, stripeUrl);
    }
    console.log('Direct mode — using vars from JSON, skipping market detection and AI calls');
  } else {
    // Scrape full listing content from Airbnb
    const shouldScrape = data.listing_url && (
      !data.property_name || /^(your\s+property|)$/i.test(data.property_name.trim()) ||
      !data.location      || /^(uk|unknown|unknown location|)$/i.test(data.location.trim()) ||
      !data.title_score   // always scrape if scores not pre-filled
    );
    let scraped = { propertyName: null, location: null, heroImage: null, description: null, photoCount: 0, amenitiesAvailable: [], amenitiesUnavailable: [], amenitiesCount: 0, rating: null, reviewCount: null, roomType: null, ogTitle: '', nightlyRate: null, isSuperhost: false, isGuestFavourite: false, calendarOccupancy: null };
    if (shouldScrape) {
      console.log('Scraping full listing content from Airbnb...');
      scraped = await scrapeListingContent(data.listing_url);
      if (scraped.propertyName) { data.property_name = scraped.propertyName; console.log(`  Property: ${data.property_name}`); }
      if (scraped.location)     { data.location = scraped.location; console.log(`  Location: ${data.location}`); }
      console.log(`  Photos: ${scraped.photoCount} | Amenities: ${scraped.amenitiesCount} | Rating: ${scraped.rating} (${scraped.reviewCount} reviews)`);
      console.log(`  Nightly rate: ${scraped.nightlyRate ?? 'unknown'} | Superhost: ${scraped.isSuperhost} | Guest Fave: ${scraped.isGuestFavourite}`);

      // Fetch calendar occupancy separately
      console.log('Fetching calendar occupancy...');
      scraped.calendarOccupancy = await scrapeCalendarOccupancy(data.listing_url);
      console.log(`  Calendar occupancy: ${scraped.calendarOccupancy != null ? scraped.calendarOccupancy + '%' : 'unavailable (using estimate)'}`);
    }

    // Scrape calendar occupancy via Browser Use (non-blocking — null triggers fallback heuristic)
    if (data.listing_url && !data.occupancy_rate) {
      console.log('[calendar] Scraping occupancy via Browser Use...');
      const occ = await scrapeCalendarOccupancy(data.listing_url);
      if (occ != null) data.occupancy_rate = occ;
    }

    const market = detectMarket(data);
    const sym = market.sym;

    // Classify persona before AI call so it can inform the brief
    const persona = classifyPersona(scraped, market);
    console.log(`  Persona: ${persona}`);

    const aiFields = await generateAIFields(data, market, scraped, persona);
    const p2 = PLATFORM_INFO[market.p2] || { desc:'', bench:()=>'' };
    const p3 = PLATFORM_INFO[market.p3] || { desc:'', bench:()=>'' };
    const stripeUrl = market.code === 'GBP' ? STRIPE_GBP : STRIPE_USD;

    // Use CDR-WRITER scores if returned, otherwise fall back to data fields or zero
    const scoreField = (key, cdrKey) => aiFields[cdrKey ?? key] ?? data[key] ?? (data.scores && data.scores[key]) ?? 0;

    // Convert a raw score to a bar-width percentage.
    // Scores from CDR-WRITER are on a 0–10 scale; template uses width:N%.
    // Multiply by 10 when ≤ 10 so a score of 7.5 → 75% bar width, not 7.5%.
    const toBarPct = (v) => { const n = Number(v) || 0; return n > 10 ? Math.round(n) : Math.round(n * 10); };

    // Final persona: use AI-confirmed persona if returned, else keep pre-classified
    const finalPersona   = aiFields.persona || persona;
    const ctaStrength    = aiFields.cta_strength || (finalPersona === 'B' ? 'soft' : finalPersona === 'D' ? 'hard' : 'medium');
    const ctaBlock       = buildCtaBlock(ctaStrength, sym, stripeUrl);
    console.log(`  Final persona: ${finalPersona} | CTA strength: ${ctaStrength}`);

    const rawTitleScore = scoreField('title_score');
    const rawDescScore = scoreField('desc_score');
    const rawPhotoScore = scoreField('photo_score');
    const rawPricingScore = scoreField('pricing_score');
    const rawPlatformScore = scoreField('platform_score');
    const rawOverallScore = aiFields.overall_score || data.overall_score || 0;

    const titleScore = coarseTenScore(rawTitleScore);
    const descScore = coarseTenScore(rawDescScore);
    const photoScore = coarseTenScore(rawPhotoScore);
    const pricingScore = coarseTenScore(rawPricingScore);
    const platformScore = coarseTenScore(rawPlatformScore);
    const overallScore = coarseHundredScore(rawOverallScore);

    const confidenceNote = scraped.calendarOccupancy != null
      ? `This free audit uses visible listing signals plus a ${scraped.calendarOccupancy}% near-term calendar snapshot. Scores are shown in broad bands to stay honest about free-data certainty.`
      : 'This free audit uses visible listing signals. Calendar access was unavailable for this run, so scores stay in broad bands rather than pretending to exact precision.';

    vars = {
      PROPERTY_NAME:       data.property_name || '',
      LOCATION:            data.location || '',
      DATE:                data.date || new Date().toLocaleDateString('en-GB',{month:'long',year:'numeric'}),
      HERO_IMAGE:          scraped.heroImage || 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1600&q=80',
      STRIPE_URL:          stripeUrl,
      CURRENCY:            sym,
      MARKET_LABEL:        market.marketLabel,
      SCORE:               overallScore,
      TITLE_SCORE:         titleScore,
      DESC_SCORE:          descScore,
      PHOTO_SCORE:         photoScore,
      PRICING_SCORE:       pricingScore,
      PLATFORM_SCORE:      platformScore,
      TITLE_PCT:           toBarPct(titleScore),
      DESC_PCT:            toBarPct(descScore),
      PHOTO_PCT:           toBarPct(photoScore),
      PRICING_PCT:         toBarPct(pricingScore),
      PLATFORM_PCT:        toBarPct(platformScore),
      TITLE_BAND:          scoreBandLabel(titleScore),
      DESC_BAND:           scoreBandLabel(descScore),
      PHOTO_BAND:          scoreBandLabel(photoScore),
      PRICING_BAND:        scoreBandLabel(pricingScore),
      PLATFORM_BAND:       scoreBandLabel(platformScore),
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
      CONFIDENCE_NOTE:     confidenceNote,
      ISSUE_CARDS:         renderIssueCards(data),
      ACTION_PLAN:         renderActionPlan(data),
      SCORE_NARRATIVE:     escapeHtml(softenClaim(data.score_narrative || 'Your property looks more capable than the current listing presentation suggests. The biggest upside appears to be in how clearly the value is being communicated.')),
      OPPORTUNITY_SUMMARY: escapeHtml(softenClaim(data.opportunity_summary || 'The upside here looks real, but this free audit should be read as directional. The paid clinic is where we pressure-test the commercial case, confidence level and implementation order.')),
      PERSONA:             finalPersona,
      CTA_STRENGTH:        ctaStrength,
      CTA_BLOCK:           ctaBlock,
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
