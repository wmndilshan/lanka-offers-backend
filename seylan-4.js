/**
 * Seylan Bank Card Offers Scraper v3.0 — SeylanOffer + PeriodParser
 * Features:
 * - All 20 categories scraped automatically
 * - Parallel detail page scraping with p-limit
 * - SeylanOffer class with structured validity periods (DB-ready)
 * - PeriodParser handles: Valid until, Valid from-to, EPP valid until,
 *   Offer/Discount valid from, date ranges, multi-line, notes, compact ranges
 * - Output to ./output/ with per-category files
 * - Unique IDs via SHA-256
 * Requires: npm install axios cheerio p-limit
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { normalizeValidity } = require('./lib/period-normalize');
const PeriodEngine = require('./lib/period-engine');
const crypto = require('crypto');

// ─── p-limit ───────────────────────────────────────────────────────────────

let pLimit;
try {
  pLimit = require('p-limit');
  if (pLimit.default) pLimit = pLimit.default;
} catch (e) {
  pLimit = (concurrency) => {
    const queue = [];
    let active = 0;
    const next = () => { active--; if (queue.length > 0) { const { fn, resolve, reject } = queue.shift(); run(fn, resolve, reject); } };
    const run = async (fn, resolve, reject) => { active++; try { resolve(await fn()); } catch (err) { reject(err); } finally { next(); } };
    return (fn) => new Promise((resolve, reject) => { if (active < concurrency) run(fn, resolve, reject); else queue.push({ fn, resolve, reject }); });
  };
}

// ─── Config ────────────────────────────────────────────────────────────────

const CONFIG = {
  maxRetries: 3,
  retryDelay: 1000,
  timeout: 15000,
  cacheDir: './cache_seylan',
  outputDir: './output',
  cacheExpiry: 24 * 60 * 60 * 1000,
  useCache: true,
  concurrentDetailRequests: 5
};

[CONFIG.cacheDir, CONFIG.outputDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── Seylan Categories ─────────────────────────────────────────────────────

const SEYLAN_CATEGORIES = [
  { name: 'Supermarket', slug: 'supermarket' },
  { name: 'Dining', slug: 'dining' },
  { name: 'Solar', slug: 'solar' },
  { name: 'Health', slug: 'health' },
  { name: 'Clothing', slug: 'style' },
  { name: 'Electronics', slug: 'electronics' },
  { name: 'Education', slug: 'education' },
  { name: 'Lifestyle', slug: 'lifestyle' },
  { name: 'Local Travel', slug: 'local-travel' },
  { name: 'Jewelry', slug: 'jewelry' },
  { name: 'Online Deals', slug: 'online-deals' },
  { name: 'Auto', slug: 'auto' },
  { name: 'Insurance', slug: 'insurance' },
  { name: 'Salon & SPA', slug: 'salon-spa' },
  { name: 'Overseas Travel', slug: 'overseas-travel' },
  { name: 'Pay Plans', slug: 'pay-plans' },
  { name: 'Harasara', slug: 'harasara' },
  { name: 'Kiddies', slug: 'kiddies' },
  { name: 'Shoes & Accessories', slug: 'shoes-accessories' },
  { name: 'Special Promotions', slug: 'special-promotions' }
];

const BASE_URL = 'https://www.seylan.lk/promotions/cards';

// ─── Constants ─────────────────────────────────────────────────────────────

const MONTH_MAP = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Cache Utilities ───────────────────────────────────────────────────────

function getCacheKey(input) { return crypto.createHash('md5').update(input).digest('hex'); }

function loadFromCache(url) {
  if (!CONFIG.useCache) return null;
  const p = path.join(CONFIG.cacheDir, `${getCacheKey(url)}.html`);
  if (!fs.existsSync(p)) return null;
  const stats = fs.statSync(p);
  if ((Date.now() - stats.mtime.getTime()) >= CONFIG.cacheExpiry) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8')).html;
}

function saveToCache(url, html) {
  const p = path.join(CONFIG.cacheDir, `${getCacheKey(url)}.html`);
  fs.writeFileSync(p, JSON.stringify({ url, html, cachedAt: new Date().toISOString() }, null, 2));
}

// ─── HTML Fetching ─────────────────────────────────────────────────────────

async function fetchHTML(url, retryCount = 0) {
  const cached = loadFromCache(url);
  if (cached) return { html: cached, fromCache: true };

  try {
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: CONFIG.timeout,
      maxRedirects: 5
    });
    saveToCache(url, response.data);
    return { html: response.data, fromCache: false };
  } catch (error) {
    if (retryCount < CONFIG.maxRetries) {
      await sleep(CONFIG.retryDelay * (retryCount + 1));
      return fetchHTML(url, retryCount + 1);
    }
    throw error;
  }
}

// ─── Unique ID Generation ──────────────────────────────────────────────────

function generateUniqueId(title, address, phone) {
  const hash = crypto.createHash('sha256')
    .update(`seylan|${title}|${address}|${phone}`.toLowerCase().trim())
    .digest('hex');
  const slug = (title || 'offer').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 25);
  return `seylan_${hash.substring(0, 12)}_${slug}`;
}

// ─── PeriodParser ──────────────────────────────────────────────────────────
// Seylan validity formats:
// A: "Valid until 31st December 2026"
// B: "Valid until 30 April 2026"                         (no ordinal suffix)
// C: "Valid from 01st March - 30th June 2026"
// D: "Valid from 14th - 28th February 2026"              (same-month range)
// E: "Valid from 01st-15th February 2026"                (no spaces around dash)
// F: "Valid from 02-03 April 2026"                       (no ordinal, no spaces)
// G: "Valid from 01st November - 28th February 2026"     (cross-year range)
// H: "Valid from 10th January to 31st March 2026"        ("to" instead of "-")
// I: "Offer valid until 30th June 2026"                  ("Offer" prefix)
// J: "EPP valid until 30th June 2026"                    ("EPP" prefix)
// K: "Discount valid from 09th - 12th April 2026"        ("Discount" prefix)
// L: "Offer valid until 31st March 2026 (Refer grid...)" (parenthetical note)
// M: "Offer valid until 30 October 2025\nEPP valid until 31 December 2025" (multi-line)
// N: "Valid  from 01st November..." (extra whitespace)
// O: "" (empty)

class PeriodParser {

  static parseHumanDate(text, fallbackYear) {
    if (!text) return null;
    const cleaned = text.replace(/(\d+)(?:st|nd|rd|th)/gi, '$1').trim();
    // UK format first: "28 February 2026", "1 February"
    const mUK = cleaned.match(/(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?/i);
    if (mUK) {
      const day = parseInt(mUK[1], 10);
      const month = MONTH_MAP[mUK[2].toLowerCase()];
      const year = mUK[3] ? parseInt(mUK[3], 10) : fallbackYear || new Date().getFullYear();
      return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    // US format: "February 28, 2026"
    const mUS = cleaned.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?!\d),?\s*(\d{4})?/i);
    if (mUS) {
      const month = MONTH_MAP[mUS[1].toLowerCase()];
      const day = parseInt(mUS[2], 10);
      const year = mUS[3] ? parseInt(mUS[3], 10) : fallbackYear || new Date().getFullYear();
      return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return null;
  }

  static extractYear(text) {
    const m = text.match(/\b(20\d{2})\b/);
    return m ? parseInt(m[1], 10) : null;
  }

  /** Propagate month/year between range parts: "14th" + "28th February 2026" */
  static parseDateRangeParts(part1, part2, fallbackYear) {
    let date1 = PeriodParser.parseHumanDate(part1, fallbackYear);
    let date2 = PeriodParser.parseHumanDate(part2, fallbackYear);
    const monthRe = /(january|february|march|april|may|june|july|august|september|october|november|december)/i;
    const yearRe = /\b(\d{4})\b/;
    if (!date1 && date2) {
      const mm = part2.match(monthRe);
      const yy = part2.match(yearRe);
      if (mm) date1 = PeriodParser.parseHumanDate(part1 + ' ' + mm[1] + (yy ? ' ' + yy[1] : ''), fallbackYear);
    }
    if (!date2 && date1) {
      const mm = part1.match(monthRe);
      const yy = part1.match(yearRe);
      if (mm) date2 = PeriodParser.parseHumanDate(part2 + ' ' + mm[1] + (yy ? ' ' + yy[1] : ''), fallbackYear);
    }
    // Cross-year fix: if from > to and from has no explicit year, it's likely previous year
    // e.g., "01st November" (2026) - "28th February 2026" → Nov is actually 2025
    if (date1 && date2 && date1 > date2) {
      const hasYear1 = /\b\d{4}\b/.test(part1);
      const hasYear2 = /\b\d{4}\b/.test(part2);
      if (!hasYear1 && hasYear2) {
        // part1 has no year — try previous year
        const prevYear = fallbackYear ? fallbackYear - 1 : new Date().getFullYear() - 1;
        date1 = PeriodParser.parseHumanDate(part1, prevYear);
      }
    }
    return { fromDate: date1, toDate: date2 };
  }

  /** Extract parenthetical note: "(Refer grid...)" */
  static extractNote(text) {
    const m = text.match(/\(([^)]+)\)/);
    return m ? m[1].trim() : null;
  }

  /**
   * Parse a single validity line.
   * Returns { valid_from, valid_to, period_type, note }
   */
  static parseLine(line, fallbackYear) {
    const today = new Date().toISOString().split('T')[0];
    const note = PeriodParser.extractNote(line);
    // Remove parenthetical note for date parsing
    const clean = line.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();

    // Determine period_type from prefix
    let periodType = 'offer';
    if (/^epp\s+valid/i.test(clean)) periodType = 'installment';
    else if (/^discount\s+valid/i.test(clean)) periodType = 'offer';

    // Strip prefix: "Valid", "Offer valid", "EPP valid", "Discount valid"
    const stripped = clean
      .replace(/^(?:offer|epp|discount)?\s*valid\s*/i, '')
      .trim();

    // "until [date]"
    const untilMatch = stripped.match(/^until\s+(.+)/i);
    if (untilMatch) {
      const toDate = PeriodParser.parseHumanDate(untilMatch[1], fallbackYear);
      return { valid_from: today, valid_to: toDate, period_type: periodType, note };
    }

    // "from [date] to [date]" (with "to" keyword)
    const fromToMatch = stripped.match(/^from\s+(.+?)\s+to\s+(.+)/i);
    if (fromToMatch) {
      const { fromDate, toDate } = PeriodParser.parseDateRangeParts(fromToMatch[1], fromToMatch[2], fallbackYear);
      return { valid_from: fromDate, valid_to: toDate, period_type: periodType, note };
    }

    // "from [date] - [date]" or "from [date]-[date]" (dash separator)
    const fromDashMatch = stripped.match(/^from\s+(.+?)\s*[-–—]\s*(.+)/i);
    if (fromDashMatch) {
      const { fromDate, toDate } = PeriodParser.parseDateRangeParts(fromDashMatch[1], fromDashMatch[2], fallbackYear);
      return { valid_from: fromDate, valid_to: toDate, period_type: periodType, note };
    }

    // Fallback: try to parse as a single date
    const singleDate = PeriodParser.parseHumanDate(stripped, fallbackYear);
    if (singleDate) {
      return { valid_from: today, valid_to: singleDate, period_type: periodType, note };
    }

    return { valid_from: null, valid_to: null, period_type: periodType, note };
  }

  /** Main parse: raw validity → OfferValidity[] */
  static parse(rawText) {
    if (!rawText || rawText.trim().length === 0) {
      return [new OfferValidity({ raw_period_text: rawText || '' })];
    }

    const engine = PeriodEngine.parse(rawText, { defaultPeriodType: 'offer' });
    if (engine.length > 0) {
      return engine.map(p => new OfferValidity(p));
    }

    const year = PeriodParser.extractYear(rawText) || new Date().getFullYear();

    // Split multi-line (e.g., "Offer valid until...\nEPP valid until...")
    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    if (lines.length > 1) {
      // Multi-line: each line is a separate validity
      const results = [];
      for (const line of lines) {
        if (/valid/i.test(line)) {
          const parsed = PeriodParser.parseLine(line, year);
          results.push(new OfferValidity({
            valid_from: parsed.valid_from,
            valid_to: parsed.valid_to,
            period_type: parsed.period_type,
            recurrence_type: 'daily',
            exclusion_notes: parsed.note,
            raw_period_text: line
          }));
        }
      }
      if (results.length > 0) return results;
    }

    // Single line
    const parsed = PeriodParser.parseLine(rawText, year);
    return [new OfferValidity({
      valid_from: parsed.valid_from,
      valid_to: parsed.valid_to,
      period_type: parsed.period_type,
      recurrence_type: 'daily',
      exclusion_notes: parsed.note,
      raw_period_text: rawText
    })];
  }
}

// ─── OfferValidity ─────────────────────────────────────────────────────────

class OfferValidity {
  constructor({
    valid_from = null, valid_to = null, period_type = 'offer',
    recurrence_type = 'daily', recurrence_days = null,
    time_from = null, time_to = null,
    exclusion_days = null, blackout_periods = null,
    exclusion_notes = null, raw_period_text = ''
  } = {}) {
    this.valid_from = valid_from;
    this.valid_to = valid_to;
    this.period_type = period_type;
    this.recurrence_type = recurrence_type;
    this.recurrence_days = recurrence_days;
    this.time_from = time_from;
    this.time_to = time_to;
    this.exclusion_days = exclusion_days;
    this.blackout_periods = blackout_periods;
    this.exclusion_notes = exclusion_notes;
    this.raw_period_text = raw_period_text;
  }

  toJSON() {
    return normalizeValidity({
      valid_from: this.valid_from,
      valid_to: this.valid_to,
      period_type: this.period_type,
      recurrence_type: this.recurrence_type,
      recurrence_days: this.recurrence_days,
      time_from: this.time_from,
      time_to: this.time_to,
      exclusion_days: this.exclusion_days,
      blackout_periods: this.blackout_periods,
      exclusion_notes: this.exclusion_notes,
      raw_period_text: this.raw_period_text
    });
  }
}

// ─── SeylanOffer ───────────────────────────────────────────────────────────

class SeylanOffer {
  constructor(raw, category) {
    this.id = generateUniqueId(raw.title, raw.address, raw.phone);
    this.bank = 'Seylan';
    this.category = category;

    this.merchantName = raw.title || '';
    this.description = raw.description || '';
    this.address = raw.address || '';
    this.phone = raw.phone || '';
    this.validityRaw = raw.validity || '';
    this.imageUrl = raw.imageUrl || '';
    this.sourceUrl = raw.url || '';
    this.minTransaction = raw.minTransaction || null;
    this.maxTransaction = raw.maxTransaction || null;
    this.terms = raw.terms || [];

    // Parse validity
    this.validity_periods = PeriodParser.parse(this.validityRaw);
  }

  toJSON() {
    return {
      id: this.id,
      bank: this.bank,
      category: this.category,
      merchant: {
        name: this.merchantName,
        address: this.address,
        phone: this.phone
      },
      offer: {
        description: this.description,
        minTransaction: this.minTransaction,
        maxTransaction: this.maxTransaction,
        terms: this.terms
      },
      validity: {
        raw: this.validityRaw,
        periods: this.validity_periods.map(v => v.toJSON())
      },
      images: { cover: this.imageUrl },
      sourceUrl: this.sourceUrl
    };
  }

  toValidityRows() {
    return this.validity_periods.map(vp => ({
      offer_id: this.id,
      bank: this.bank,
      category: this.category,
      merchant_name: this.merchantName,
      offer_description: this.description.substring(0, 100),
      ...vp.toJSON()
    }));
  }
}

// ─── Scraping Functions ────────────────────────────────────────────────────

async function extractOfferUrls(listingUrl) {
  try {
    const { html } = await fetchHTML(listingUrl);
    const $ = cheerio.load(html);
    const urls = new Set();

    $('.new-promotion-btn').each((i, el) => {
      const href = $(el).attr('href');
      if (href && href.includes('seylan.lk')) {
        urls.add(href.startsWith('http') ? href : `https://www.seylan.lk${href}`);
      }
    });

    return Array.from(urls);
  } catch (error) {
    console.log(`  ❌ Error fetching listing: ${error.message}`);
    return [];
  }
}

function scrapeOfferFromHTML(html, offerUrl) {
  const $ = cheerio.load(html);
  const detailSection = $('.offer-detail');
  if (detailSection.length === 0) return null;

  const rightCol = detailSection.find('.col-md-6').last();
  const title = rightCol.find('h2.h11').text().trim();
  const description = rightCol.find('p.h44').first().text().trim();

  let address = '';
  rightCol.find('div.h44').each((i, el) => {
    if ($(el).html() && $(el).html().includes('Address')) {
      address = $(el).text().replace(/Address:/i, '').replace(/\s+/g, ' ').trim();
      return false;
    }
  });

  let phone = '';
  rightCol.find('div.h44').each((i, el) => {
    const text = $(el).text();
    if (text.includes('Tel')) {
      phone = text.replace(/Tel No\s*:|Tel\s*-\s*/i, '').replace(/\s+/g, ' ').trim();
      return false;
    }
  });

  let validity = '';
  rightCol.find('p, h4, div').each((i, el) => {
    const text = $(el).text().trim();
    if (text.match(/valid\s+until|valid\s+from|valid\s+till/i)) {
      validity = text;
      return false;
    }
  });

  const terms = [];
  rightCol.find('div.des ul li').each((i, el) => {
    const term = $(el).text().trim();
    if (term) terms.push(term);
  });

  let minTransaction = null;
  let maxTransaction = null;
  terms.forEach(term => {
    const minMatch = term.match(/Minimum\s+(?:Transaction\s+)?Value\s*[–-]?\s*Rs\.?\s*([\d,]+)/i);
    const maxMatch = term.match(/[Mm]aximum\s*Rs\.?\s*([\d,]+)/i);
    if (minMatch && !minTransaction) minTransaction = parseInt(minMatch[1].replace(/,/g, ''));
    if (maxMatch && !maxTransaction) maxTransaction = parseInt(maxMatch[1].replace(/,/g, ''));
  });

  const imageUrl = detailSection.find('.col-md-6').first().find('img').attr('src') || '';

  return { title, description, address, phone, validity, imageUrl, url: offerUrl, minTransaction, maxTransaction, terms };
}

async function scrapeOfferDetail(offerUrl) {
  const { html } = await fetchHTML(offerUrl);
  return scrapeOfferFromHTML(html, offerUrl);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║  Seylan Bank Offers Scraper v3.0              ║');
  console.log('║  SeylanOffer + PeriodParser + Parallel Detail ║');
  console.log('╚═══════════════════════════════════════════════╝\n');

  const args = process.argv.slice(2);
  if (args.includes('--no-cache')) { CONFIG.useCache = false; console.log('⚠️  Cache disabled\n'); }

  const startTime = Date.now();

  const allRawOffers = [];
  const allSeylanOffers = [];
  const categoryStats = [];

  // Scrape all categories
  for (const cat of SEYLAN_CATEGORIES) {
    const listingUrl = `${BASE_URL}/${cat.slug}`;
    console.log(`${'─'.repeat(50)}`);
    console.log(`📂 ${cat.name} (${cat.slug})`);

    const offerUrls = await extractOfferUrls(listingUrl);
    if (offerUrls.length === 0) {
      console.log(`  No offers found`);
      categoryStats.push({ name: cat.name, count: 0 });
      continue;
    }

    console.log(`  Found ${offerUrls.length} offers, scraping in parallel...`);

    // Parallel detail scraping
    const limit = pLimit(CONFIG.concurrentDetailRequests);
    const rawOffers = (await Promise.all(
      offerUrls.map(url => limit(() => scrapeOfferDetail(url)))
    )).filter(Boolean);

    // Build SeylanOffer objects
    const catOffers = [];
    for (const raw of rawOffers) {
      allRawOffers.push({ ...raw, _category: cat.name });
      const seylanOffer = new SeylanOffer(raw, cat.name);
      catOffers.push(seylanOffer);
      allSeylanOffers.push(seylanOffer);
    }

    console.log(`  ✅ ${rawOffers.length} offers processed`);
    categoryStats.push({ name: cat.name, count: rawOffers.length });

    // Per-category file
    const catSlug = cat.slug.replace(/-/g, '_');
    fs.writeFileSync(
      path.join(CONFIG.outputDir, `seylan_${catSlug}_v3.json`),
      JSON.stringify(catOffers.map(o => o.toJSON()), null, 2)
    );
  }

  // ── Build validity rows ─────────────────────────────────────────────────
  const allValidityRows = [];
  for (const offer of allSeylanOffers) {
    allValidityRows.push(...offer.toValidityRows());
  }

  // ── Audit ───────────────────────────────────────────────────────────────
  console.log('\n═══ AUDIT ═══');
  let issues = 0;

  for (const row of allValidityRows) {
    const flags = [];
    const raw = row.raw_period_text || '';

    if (!row.valid_to && raw.trim().length > 0) flags.push('DATE_MISSING');
    if (row.valid_from && row.valid_to && row.valid_from > row.valid_to) flags.push('DATE_MISMATCH');

    if (flags.length > 0) {
      issues++;
      console.log(`  ⚠️  [${flags.join(',')}] ${row.merchant_name} | raw: "${raw}"`);
      console.log(`       from=${row.valid_from} to=${row.valid_to}`);
    }
  }

  console.log(`\n  Total validity rows: ${allValidityRows.length}`);
  console.log(`  Issues: ${issues}`);

  // Period type breakdown
  const ptBreakdown = {};
  for (const row of allValidityRows) {
    ptBreakdown[row.period_type] = (ptBreakdown[row.period_type] || 0) + 1;
  }
  console.log(`  Period types: ${JSON.stringify(ptBreakdown)}`);

  // ── Save output files ───────────────────────────────────────────────────
  fs.writeFileSync(
    path.join(CONFIG.outputDir, 'seylan_all_v3.json'),
    JSON.stringify(allSeylanOffers.map(o => o.toJSON()), null, 2)
  );
  fs.writeFileSync(
    path.join(CONFIG.outputDir, 'seylan_validity_rows_v3.json'),
    JSON.stringify(allValidityRows, null, 2)
  );
  fs.writeFileSync(
    path.join(CONFIG.outputDir, 'seylan_raw_v3.json'),
    JSON.stringify(allRawOffers, null, 2)
  );

  // ── Summary ─────────────────────────────────────────────────────────────
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('\n╔═══════════════════════════════════════════════╗');
  console.log('║              SUMMARY REPORT                    ║');
  console.log('╚═══════════════════════════════════════════════╝\n');

  let total = 0;
  for (const stat of categoryStats) {
    if (stat.count > 0) {
      console.log(`  ${stat.name.padEnd(25)} ${stat.count} offers`);
    }
    total += stat.count;
  }

  console.log(`\n  Total offers:       ${total}`);
  console.log(`  Validity rows:      ${allValidityRows.length}`);
  console.log(`  Issues:             ${issues}`);
  console.log(`  Time:               ${duration}s`);
  console.log(`\n  Output files:`);
  console.log(`    ${path.join(CONFIG.outputDir, 'seylan_all_v3.json')}`);
  console.log(`    ${path.join(CONFIG.outputDir, 'seylan_validity_rows_v3.json')}`);
  console.log(`    ${path.join(CONFIG.outputDir, 'seylan_raw_v3.json')}`);
  console.log('');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { SeylanOffer, PeriodParser, OfferValidity, SEYLAN_CATEGORIES };
