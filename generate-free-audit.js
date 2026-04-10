#!/usr/bin/env node
'use strict';

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

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
async function scrapeListingBasics(listingUrl) {
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
        const ogTitle = (html.match(/property="og:title"\s+content="([^"]+)"/) || html.match(/content="([^"]+)"\s+property="og:title"/) || [])[1] || '';
        const propertyName = (html.match(/"name":"([^"]+)"/)||[])[1]?.split('·')[0]?.trim()
          || ogTitle.replace(/·.*$/, '').replace(/Entire.*?in /i, '').trim()
          || null;
        const locMatch = html.match(/"addressLocality"\s*:\s*"([^"]+)"/) || html.match(/"city"\s*:\s*"([^"]+)"/);
        const location = locMatch ? locMatch[1] : null;
        const regionMatch = html.match(/"addressRegion"\s*:\s*"([^"]+)"/);
        const region = regionMatch ? regionMatch[1] : null;
        const fullLocation = [location, region].filter(Boolean).join(', ') || null;
        resolve({ propertyName: propertyName || null, location: fullLocation || null });
      });
    });
    req.on('error', () => resolve({ propertyName: null, location: null }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ propertyName: null, location: null }); });
  });
}

async function generateAIFields(data, market) {
  const fallback = {
    MAIN_INSIGHT:        `Your listing score of ${data.overall_score}/100 points to specific gaps directly impacting your search ranking and conversion rate.`,
    QUICK_WIN:           `Rewrite your title to lead with your single best feature — the one thing a guest would pay more for. Paste it in today.`,
    FREE_TIP:            `Add your check-in and check-out times to your listing description. It reduces pre-booking messages and signals a professional host.`,
    BRANDON_NOTE_LINE_1: `${data.property_name} has real differentiators that your current listing doesn't surface clearly.`,
    BRANDON_NOTE_LINE_2: `Guests who would choose you aren't seeing what makes you different — that's a direct revenue gap.`,
    BRANDON_NOTE_LINE_3: `The full report gives you the exact copy, sequence, and pricing to close it — ready to paste in.`,
  };

  let OpenAIClass;
  try { const mod = require('openai'); OpenAIClass = mod.OpenAI || mod.default || mod; } catch(e) { console.warn('openai not found — using fallback'); return fallback; }
  if (!process.env.OPENAI_API_KEY) { console.warn('OPENAI_API_KEY not set — using fallback'); return fallback; }

  try {
    const client = new OpenAIClass({ apiKey: process.env.OPENAI_API_KEY });
    const prompt = `You are an expert short-term rental analyst writing a personalised free audit report.\n\nProperty: ${data.property_name}\nLocation: ${data.location}\nScore: ${data.overall_score}/100\nTop issues: ${JSON.stringify((data.top_3_issues||[]).map(i=>i.issue))}\n\nReturn ONLY a JSON object (no markdown) with these exact keys:\n{\n  "MAIN_INSIGHT": "one direct observation about the biggest gap. No hedging. Max 2 sentences.",\n  "QUICK_WIN": "one concrete thing to do today. Specific to this property. Max 2 sentences.",\n  "FREE_TIP": "a universally useful tip. Evergreen. Max 2 sentences.",\n  "BRANDON_NOTE_LINE_1": "max 20 words. Specific observation that stood out. State it, no I noticed.",\n  "BRANDON_NOTE_LINE_2": "max 20 words. What that means for revenue or bookings.",\n  "BRANDON_NOTE_LINE_3": "max 20 words. Honest pitch — what changes and why the paid report is the right next step."\n}`;
    const resp = await client.chat.completions.create({ model:'gpt-4o-mini', messages:[{role:'user',content:prompt}], temperature:0.7, max_tokens:600 });
    const txt = resp.choices[0].message.content.trim().replace(/^```(?:json)?\n?/,'').replace(/\n?```$/,'');
    return JSON.parse(txt);
  } catch(e) { console.warn('AI failed:', e.message, '— using fallback'); return fallback; }
}

function populate(template, vars) {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => key in vars ? String(vars[key]) : match);
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
    // Scrape property name and location if not provided or left blank by caller
    const isGenericName = !data.property_name || /^(your\s+property|)$/i.test(data.property_name.trim());
    const isGenericLocation = !data.location || /^(uk|unknown|unknown location|)$/i.test(data.location.trim());
    if (data.listing_url && (isGenericName || isGenericLocation)) {
      console.log('Scraping listing basics from Airbnb...');
      const scraped = await scrapeListingBasics(data.listing_url);
      if (isGenericName && scraped.propertyName) {
        data.property_name = scraped.propertyName;
        console.log(`  Property name: ${data.property_name}`);
      }
      if (isGenericLocation && scraped.location) {
        data.location = scraped.location;
        console.log(`  Location: ${data.location}`);
      }
    }

    const market = detectMarket(data);
    const sym = market.sym;
    const aiFields = await generateAIFields(data, market);
    const p2 = PLATFORM_INFO[market.p2] || { desc:'', bench:()=>'' };
    const p3 = PLATFORM_INFO[market.p3] || { desc:'', bench:()=>'' };
    const stripeUrl = market.code === 'GBP' ? STRIPE_GBP : STRIPE_USD;
    const s = (key, fallback=0) => data[key] || (data.scores && data.scores[key]) || fallback;

    vars = {
      PROPERTY_NAME:       data.property_name || '',
      LOCATION:            data.location || '',
      DATE:                data.date || new Date().toLocaleDateString('en-GB',{month:'long',year:'numeric'}),
      STRIPE_URL:          stripeUrl,
      CURRENCY:            sym,
      MARKET_LABEL:        market.marketLabel,
      SCORE:               data.overall_score || 0,
      TITLE_SCORE:         s('title_score'),
      DESC_SCORE:          s('desc_score'),
      PHOTO_SCORE:         s('photo_score'),
      PRICING_SCORE:       s('pricing_score'),
      PLATFORM_SCORE:      s('platform_score'),
      TITLE_PCT:           s('title_score'),
      DESC_PCT:            s('desc_score'),
      PHOTO_PCT:           s('photo_score'),
      PRICING_PCT:         s('pricing_score'),
      PLATFORM_PCT:        s('platform_score'),
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
