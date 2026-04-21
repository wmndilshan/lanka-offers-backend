/**
 * NDB Bank Card Offers Scraper v4.0 — NDBOffer + PeriodParser
 * Features:
 * - NDBOffer class with structured validity periods (DB-ready)
 * - PeriodParser handles: Until dates, single dates, date ranges,
 *   recurring weekdays, every weekend, enumerated dates, booking & stay,
 *   recurring + range hybrid, time windows, dirty "Credit Cards" suffix
 * - Reuses single browser instance across all 6 categories
 * - Parallel PDF downloads with p-limit
 * - Output to ./output/ with per-category files
 * - Unique IDs via SHA-256
 * Requires: npm install puppeteer p-limit
 * Optional: npm install pdf-parse@1.1.1
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { normalizeValidity } = require('./lib/period-normalize');
const PeriodEngine = require('./lib/period-engine');
const AddressEngine = require('./lib/address-engine');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

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

// ─── pdf-parse ─────────────────────────────────────────────────────────────

let pdfParse;
let pdfParseAvailable = false;
try {
  const mod = require('pdf-parse');
  if (typeof mod === 'function') { pdfParse = mod; pdfParseAvailable = true; }
  else if (mod && typeof mod.default === 'function') { pdfParse = mod.default; pdfParseAvailable = true; }
  else if (mod && typeof mod.PDFParse === 'function') { pdfParse = mod.PDFParse; pdfParseAvailable = true; }
} catch (e) { /* pdf-parse not installed */ }

// ─── Config ────────────────────────────────────────────────────────────────

const CONFIG = {
  maxRetries: 3,
  retryDelay: 3000,
  timeout: 60000,
  cacheDir: './cache_ndb_bank',
  pdfCacheDir: './cache_ndb_bank/pdfs',
  outputDir: './output',
  cacheExpiry: 24 * 60 * 60 * 1000,
  useCache: true,
  extractPDFTerms: true,
  concurrentPDFRequests: 4,
  headless: 'new',
  navigationTimeout: 60000,
  waitForContent: 5000
};

[CONFIG.cacheDir, CONFIG.pdfCacheDir, CONFIG.outputDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── NDB Categories ────────────────────────────────────────────────────────

const NDB_CATEGORIES = [
  { name: 'Privilege Weekend', slug: 'privilege-weekend' },
  { name: 'Clothing & Accessories', slug: 'clothing-accessories' },
  { name: 'Restaurants & Pubs', slug: 'restaurants-pubs' },
  { name: 'Special Promotions', slug: 'special-ipp-promotions' },
  { name: 'Supermarkets', slug: 'supermarkets' },
  { name: 'Jewellery & Watches', slug: 'jewellery-watches' }
];

const BASE_URL = 'https://www.ndbbank.com/cards/card-offers';

// ─── Constants ─────────────────────────────────────────────────────────────

const MONTH_MAP = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Cache Utilities ───────────────────────────────────────────────────────

function getCacheKey(input) { return crypto.createHash('md5').update(input).digest('hex'); }

function loadFromCache(url, cacheDir = CONFIG.cacheDir) {
  if (!CONFIG.useCache) return null;
  const p = path.join(cacheDir, `${getCacheKey(url)}.json`);
  if (!fs.existsSync(p)) return null;
  const stats = fs.statSync(p);
  if ((Date.now() - stats.mtime.getTime()) >= CONFIG.cacheExpiry) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8')).data;
}

function saveToCache(url, data, cacheDir = CONFIG.cacheDir) {
  const p = path.join(cacheDir, `${getCacheKey(url)}.json`);
  fs.writeFileSync(p, JSON.stringify({ url, data, cachedAt: new Date().toISOString() }, null, 2));
}

// ─── PDF Handling ──────────────────────────────────────────────────────────

async function downloadPDF(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        return downloadPDF(response.headers.location).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) return reject(new Error(`HTTP ${response.statusCode}`));
      const chunks = [];
      response.on('data', c => chunks.push(c));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}

async function extractPDFText(url) {
  if (!pdfParseAvailable) return null;
  const cached = loadFromCache(url, CONFIG.pdfCacheDir);
  if (cached) return cached;
  try {
    const pdfBuffer = await downloadPDF(url);
    const data = await pdfParse(pdfBuffer);
    saveToCache(url, data.text, CONFIG.pdfCacheDir);
    return data.text;
  } catch (error) {
    return null;
  }
}

// ─── Unique ID Generation ──────────────────────────────────────────────────

function generateUniqueId(merchantName, offerTitle, category) {
  const hash = crypto.createHash('sha256')
    .update(`ndb|${merchantName}|${offerTitle}|${category}`.toLowerCase().trim())
    .digest('hex');
  const slug = (merchantName || 'offer').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 30);
  return `ndb_${hash.substring(0, 12)}_${slug}`;
}

// ─── PeriodParser ──────────────────────────────────────────────────────────
// NDB validity formats:
// A: "Until 28th February 2026"                                  → end date only
// B: "21st February 2026"                                        → single end date
// C: "Every Tuesday till 28th February 2026"                     → recurring weekday
// D: "Every Weekend 1st -28th February 2026 (Saturday & Sunday)" → weekend + range
// E: "Every Weekend till 28th February 2026 (Saturday & Sunday)" → weekend till date
// F: "12th - 14th February 2026"                                 → date range
// G: "Until 28th February 2025 Credit Cards"                     → dirty suffix
// H: "Booking & Stay Period : 1st February – 30 April 2026"      → booking/stay
// I: "12th , 13th & 14th February 2026"                          → enumerated dates
// J: "Every Thursday 29th January - 31st July 2026"              → recurring + range
// K: "11th & 25th February 2026"                                 → ampersand dates
// L: "13th February 2026  (From 3.00 PM to 6.00 PM )"           → date + time
// M: "" (empty)

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
    // US format: "February 28, 2026" — day must not be followed by more digits
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

  /**
   * Parse two parts of a date range, propagating month/year from one to the other.
   * "12th" + "14th February 2026" → both get February 2026
   * "1st" + "28th February 2026" → both get February 2026
   */
  static parseDateRangeParts(part1, part2, fallbackYear) {
    let date1 = PeriodParser.parseHumanDate(part1, fallbackYear);
    let date2 = PeriodParser.parseHumanDate(part2, fallbackYear);

    const monthRe = /(january|february|march|april|may|june|july|august|september|october|november|december)/i;
    const yearRe = /\b(\d{4})\b/;

    // If part1 lacks month, borrow from part2
    if (!date1 && date2) {
      const mMonth = part2.match(monthRe);
      const mYear = part2.match(yearRe);
      if (mMonth) {
        const enriched = part1 + ' ' + mMonth[1] + (mYear ? ' ' + mYear[1] : '');
        date1 = PeriodParser.parseHumanDate(enriched, fallbackYear);
      }
    }
    // If part2 lacks month, borrow from part1
    if (!date2 && date1) {
      const mMonth = part1.match(monthRe);
      const mYear = part1.match(yearRe);
      if (mMonth) {
        const enriched = part2 + ' ' + mMonth[1] + (mYear ? ' ' + mYear[1] : '');
        date2 = PeriodParser.parseHumanDate(enriched, fallbackYear);
      }
    }
    return { fromDate: date1, toDate: date2 };
  }

  /** Extract time range: "(From 3.00 PM to 6.00 PM)" */
  static extractTimeRange(text) {
    const m = text.match(/from\s+(\d{1,2})[.:]+(\d{2})\s*(am|pm)\s+to\s+(\d{1,2})[.:]+(\d{2})\s*(am|pm)/i);
    if (!m) return null;
    const toHH = (h, min, ampm) => {
      let hour = parseInt(h, 10);
      if (ampm.toLowerCase() === 'pm' && hour < 12) hour += 12;
      if (ampm.toLowerCase() === 'am' && hour === 12) hour = 0;
      return `${String(hour).padStart(2, '0')}:${min}`;
    };
    return { time_from: toHH(m[1], m[2], m[3]), time_to: toHH(m[4], m[5], m[6]) };
  }

  /** Extract recurring weekday info */
  static extractRecurrenceDays(text) {
    if (!text) return [];
    const lower = text.toLowerCase();
    const days = [];
    if (/weekend/i.test(lower) || /saturday\s*&\s*sunday/i.test(lower)) {
      days.push('saturday', 'sunday');
    }
    const everyMatch = lower.match(/every\s+(\w+)/);
    if (everyMatch) {
      const word = everyMatch[1];
      if (DAY_NAMES.includes(word)) days.push(word);
    }
    if (days.length === 0) {
      DAY_NAMES.forEach(d => { if (lower.includes(d)) days.push(d); });
    }
    return [...new Set(days)];
  }

  /**
   * Parse enumerated/ampersand-separated dates
   * "12th , 13th & 14th February 2026" → dates array
   * "11th & 25th February 2026" → dates array
   */
  static parseEnumeratedDates(text, fallbackYear) {
    const m = text.match(/^([\d\s,&stndrdth]+?)\s*(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?/i);
    if (!m) return [];
    const month = MONTH_MAP[m[2].toLowerCase()];
    const year = m[3] ? parseInt(m[3], 10) : fallbackYear || new Date().getFullYear();
    const dayMatches = m[1].match(/\d{1,2}/g);
    if (!dayMatches) return [];
    return dayMatches.map(d => {
      const day = parseInt(d, 10);
      return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }).sort();
  }

  /** Strip trailing "Credit Cards" / "Debit Cards" from validity text */
  static cleanRaw(rawText) {
    return rawText.replace(/\s+(credit|debit)\s+cards?\s*$/i, '').trim();
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

    const text = PeriodParser.cleanRaw(rawText);
    const today = new Date().toISOString().split('T')[0];
    const year = PeriodParser.extractYear(text) || new Date().getFullYear();

    // ── H: Booking & Stay Period ──────────────────────────────────────────
    const bookingMatch = text.match(/booking\s*&\s*stay\s+period\s*:\s*(.+)/i);
    if (bookingMatch) {
      const rangePart = bookingMatch[1].replace(/[–—]/g, '-');
      const rangeM = rangePart.match(/(.+?)\s*-\s*(.+)/);
      if (rangeM) {
        const { fromDate, toDate } = PeriodParser.parseDateRangeParts(rangeM[1], rangeM[2], year);
        return [
          new OfferValidity({ valid_from: fromDate, valid_to: toDate, period_type: 'booking', raw_period_text: rawText }),
          new OfferValidity({ valid_from: fromDate, valid_to: toDate, period_type: 'stay', raw_period_text: rawText })
        ];
      }
    }

    // ── Extract time range ────────────────────────────────────────────────
    const timeRange = PeriodParser.extractTimeRange(text);
    const textNoTime = text.replace(/\(?\s*from\s+\d{1,2}[.:]\d{2}\s*(?:am|pm)\s+to\s+\d{1,2}[.:]\d{2}\s*(?:am|pm)\s*\)?\s*/i, '').trim();

    // ── J: Recurring + date range ─────────────────────────────────────────
    // "Every Thursday 29th January - 31st July 2026"
    const recurRangeMatch = textNoTime.match(/every\s+(\w+)\s+(.+?)\s*-\s*(.+)/i);
    if (recurRangeMatch) {
      const dayName = recurRangeMatch[1].toLowerCase();
      if (DAY_NAMES.includes(dayName)) {
        const { fromDate, toDate } = PeriodParser.parseDateRangeParts(recurRangeMatch[2], recurRangeMatch[3], year);
        return [new OfferValidity({
          valid_from: fromDate,
          valid_to: toDate,
          period_type: 'offer',
          recurrence_type: 'specific_weekdays',
          recurrence_days: dayName,
          time_from: timeRange?.time_from || null,
          time_to: timeRange?.time_to || null,
          raw_period_text: rawText
        })];
      }
    }

    // ── C/E: Every [Day/Weekend] till [date] ──────────────────────────────
    const everyTillMatch = textNoTime.match(/every\s+(\w+)\s+till\s+(.+?)(?:\s*\(.*\))?\s*$/i);
    if (everyTillMatch) {
      const keyword = everyTillMatch[1].toLowerCase();
      let days;
      if (keyword === 'weekend') days = ['saturday', 'sunday'];
      else if (DAY_NAMES.includes(keyword)) days = [keyword];
      else days = PeriodParser.extractRecurrenceDays(textNoTime);
      return [new OfferValidity({
        valid_from: today,
        valid_to: PeriodParser.parseHumanDate(everyTillMatch[2], year),
        period_type: 'offer',
        recurrence_type: 'specific_weekdays',
        recurrence_days: days.join(','),
        time_from: timeRange?.time_from || null,
        time_to: timeRange?.time_to || null,
        raw_period_text: rawText
      })];
    }

    // ── D: Every Weekend [range] (Saturday & Sunday) ──────────────────────
    const weekendRangeMatch = textNoTime.match(/every\s+weekend\s+(.+?)\s*-\s*(.+?)(?:\s*\(.*\))?\s*$/i);
    if (weekendRangeMatch) {
      const { fromDate: wkFrom, toDate: wkTo } = PeriodParser.parseDateRangeParts(weekendRangeMatch[1], weekendRangeMatch[2], year);
      return [new OfferValidity({
        valid_from: wkFrom,
        valid_to: wkTo,
        period_type: 'offer',
        recurrence_type: 'specific_weekdays',
        recurrence_days: 'saturday,sunday',
        time_from: timeRange?.time_from || null,
        time_to: timeRange?.time_to || null,
        raw_period_text: rawText
      })];
    }

    // ── I/K: Enumerated dates ─────────────────────────────────────────────
    if (/\d{1,2}(?:st|nd|rd|th)?\s*[,&]\s*\d{1,2}(?:st|nd|rd|th)?/.test(textNoTime) &&
        !/until|till|every|from/i.test(textNoTime)) {
      const dates = PeriodParser.parseEnumeratedDates(textNoTime, year);
      if (dates.length > 0) {
        return [new OfferValidity({
          valid_from: dates[0],
          valid_to: dates[dates.length - 1],
          period_type: 'offer',
          recurrence_type: 'specific_dates',
          recurrence_days: dates.join(','),
          time_from: timeRange?.time_from || null,
          time_to: timeRange?.time_to || null,
          raw_period_text: rawText
        })];
      }
    }

    // ── A/G: Until [date] ─────────────────────────────────────────────────
    const untilMatch = textNoTime.match(/until\s+(.+)/i);
    if (untilMatch) {
      return [new OfferValidity({
        valid_from: today,
        valid_to: PeriodParser.parseHumanDate(untilMatch[1], year),
        period_type: 'offer',
        recurrence_type: 'daily',
        time_from: timeRange?.time_from || null,
        time_to: timeRange?.time_to || null,
        raw_period_text: rawText
      })];
    }

    // ── F: Date range (DDth - DDth Month YYYY) ────────────────────────────
    const rangeMatch = textNoTime.match(/(.+?)\s*-\s*(.+)/);
    if (rangeMatch) {
      const { fromDate, toDate } = PeriodParser.parseDateRangeParts(rangeMatch[1], rangeMatch[2], year);
      if (fromDate && toDate) {
        return [new OfferValidity({
          valid_from: fromDate, valid_to: toDate,
          period_type: 'offer', recurrence_type: 'daily',
          time_from: timeRange?.time_from || null,
          time_to: timeRange?.time_to || null,
          raw_period_text: rawText
        })];
      }
    }

    // ── B/L: Single date ──────────────────────────────────────────────────
    const singleDate = PeriodParser.parseHumanDate(textNoTime, year);
    if (singleDate) {
      return [new OfferValidity({
        valid_from: today, valid_to: singleDate,
        period_type: 'offer', recurrence_type: 'daily',
        time_from: timeRange?.time_from || null,
        time_to: timeRange?.time_to || null,
        raw_period_text: rawText
      })];
    }

    // ── Fallback ──────────────────────────────────────────────────────────
    return [new OfferValidity({ raw_period_text: rawText })];
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

// ─── NDBOffer ──────────────────────────────────────────────────────────────

class NDBOffer {
  constructor(raw, category) {
    // Normalize fields — handle both ndb-2 (Ant Design) and ndb-3 (Bootstrap) cache formats
    this.merchantName = raw.merchant?.name || raw.merchantName || '';
    this.offerTitle = raw.offer?.title || raw.offerDetails || raw.title || '';

    this.id = generateUniqueId(this.merchantName, this.offerTitle, category);
    this.bank = 'NDB';
    this.category = category;

    this.merchantWebsite = raw.merchant?.website || raw.website || '';
    this.merchantLocation = raw.merchant?.address || raw.merchant?.location || raw.location || '';
    this.merchantPhone = raw.merchant?.phone
      || (Array.isArray(raw.merchant?.phoneNumbers) ? raw.merchant.phoneNumbers.join(', ') : '')
      || (Array.isArray(raw.phoneNumbers) ? raw.phoneNumbers.join(', ') : '')
      || raw.phone || '';
    this.merchantLogo = raw.merchant?.logo || raw.merchantLogo || raw.images?.logo || '';

    // Use AddressEngine for extraction
    const rawAddressText = (this.merchantLocation || '') + ' ' + (raw.offer?.description || raw.offerDetails || '');
    this.addresses = AddressEngine.extract(rawAddressText, this.merchantName);
    this.merchantLocation = this.addresses[0] || this.merchantLocation || '';


    this.offerDescription = raw.offer?.description || raw.offerDetails || '';
    this.discount = raw.offer?.discount || null;
    this.minimumBill = raw.offer?.minimumBill || null;
    this.maximumTransaction = raw.offer?.maximumTransaction || raw.offer?.maximumDiscount || null;
    this.cardType = raw.offer?.cardType || raw.cardType || '';

    // validity can be: { raw: "...", parsed: "..." } or a plain string
    this.validityRaw = (typeof raw.validity === 'object' && raw.validity !== null)
      ? (raw.validity.raw ?? '')
      : (raw.validityDate || raw.validity || '');
    this.coverImage = raw.images?.cover || raw.coverImage || '';
    this.detailUrl = raw.detailUrl || '';

    this.pdfUrl = raw.termsAndConditions?.url || raw.termsAndConditionsPdfUrl || null;
    this.pdfText = null;

    // Parse validity periods
    this.validity_periods = PeriodParser.parse(this.validityRaw);
  }

  toJSON() {
    return {
      id: this.id,
      bank: this.bank,
      category: this.category,
      merchant: {
        name: this.merchantName,
        website: this.merchantWebsite,
        location: this.merchantLocation,
        addresses: this.addresses,
        phone: this.merchantPhone,
        logo: this.merchantLogo
      },
      offer: {
        title: this.offerTitle,
        description: this.offerDescription,
        discount: this.discount,
        minimumBill: this.minimumBill,
        maximumTransaction: this.maximumTransaction,
        cardType: this.cardType
      },
      validity: {
        raw: this.validityRaw,
        periods: this.validity_periods.map(v => v.toJSON())
      },
      images: { cover: this.coverImage, logo: this.merchantLogo },
      detailUrl: this.detailUrl,
      pdfUrl: this.pdfUrl,
      pdfText: this.pdfText
    };
  }

  toValidityRows() {
    return this.validity_periods.map(vp => ({
      offer_id: this.id,
      bank: this.bank,
      category: this.category,
      merchant_name: this.merchantName,
      offer_title: this.offerTitle,
      card_type: this.cardType,
      ...vp.toJSON()
    }));
  }
}

// ─── Puppeteer Scraping ────────────────────────────────────────────────────

async function scrapeCategoryPage(browser, url) {
  const page = await browser.newPage();

  // Block heavy resources
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const rt = req.resourceType();
    if (['image', 'stylesheet', 'font', 'media'].includes(rt)) req.abort();
    else req.continue();
  });

  await page.setViewport({ width: 1920, height: 1080 });

  try {
    console.log(`  🌐 Loading: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: CONFIG.navigationTimeout });

    // Try both old (Ant Design) and new (Bootstrap) selectors
    let selectorType = 'ant';
    try {
      await page.waitForSelector('.ant-col.DesktopBlock_col__2q7cK', { timeout: 8000 });
    } catch {
      try {
        await page.waitForSelector('.offer-card, .ant-card', { timeout: 8000 });
        selectorType = 'bootstrap';
      } catch {
        console.log(`  ⚠️  No card elements found`);
        await page.close();
        return [];
      }
    }

    await sleep(CONFIG.waitForContent);

    const offers = await page.evaluate((selType) => {
      const results = [];

      if (selType === 'ant') {
        // Ant Design structure (ndb-2 style)
        const cardContainers = document.querySelectorAll('.ant-col.DesktopBlock_col__2q7cK');
        cardContainers.forEach((container) => {
          try {
            const card = container.querySelector('.ant-card');
            if (!card) return;
            const coverImg = card.querySelector('.ant-card-cover img.PromotionMobile_cover__2YUwz');
            const merchantLogo = card.querySelector('.PromotionMobile_avatar__11ePi img');
            const merchantNameEl = card.querySelector('.ant-card-meta-title');
            const websiteLink = card.querySelector('.PromotionMobile_website__5kRF6');
            const detailsEl = card.querySelector('.PromotionMobile_details__z7myj h5.ant-typography');
            const validityEl = card.querySelector('.PromotionMobile_validity__39zdc span.ant-typography');
            const locationEl = card.querySelector('.PromotionMobile_merchantDescription__1BkVS > span.ant-typography');
            const pdfLink = card.querySelector('.PromotionMobile_terms__3OCeo a[href*=".pdf"]');
            const phoneItems = card.querySelectorAll('.PromotionMobile_phone__3t2ws li');
            const phones = [];
            phoneItems.forEach(li => { const p = li.textContent.trim(); if (p) phones.push(p); });

            results.push({
              merchantName: merchantNameEl ? merchantNameEl.textContent.trim() : '',
              website: websiteLink ? websiteLink.href : '',
              location: locationEl ? locationEl.textContent.trim() : '',
              phoneNumbers: phones,
              offerDetails: detailsEl ? detailsEl.textContent.trim() : '',
              validity: validityEl ? validityEl.textContent.trim() : '',
              coverImage: coverImg ? coverImg.src : '',
              merchantLogo: merchantLogo ? merchantLogo.src : '',
              termsAndConditionsPdfUrl: pdfLink ? pdfLink.href : null
            });
          } catch (err) { /* skip */ }
        });
      } else {
        // Bootstrap structure (ndb-3 style)
        const cardContainers = document.querySelectorAll('.col-12.col-md-6.col-lg-4');
        cardContainers.forEach((container) => {
          try {
            const card = container.querySelector('.offer-card') || container.querySelector('.ant-card');
            if (!card) return;
            const link = container.querySelector('a[href*="/offer-details/"]');
            const coverImg = card.querySelector('.card-img-top:not(.offercompanylogo)');
            const logoImg = card.querySelector('.offercompanylogo');
            const titleEl = card.querySelector('.card-title.ndbcolor');
            const merchantEl = card.querySelector('.card-body p.card-title:not(.text-muted)');
            const cardTypeEl = card.querySelector('.text-muted');
            const dateEl = card.querySelector('.offer-date');
            const phoneMatch = card.textContent.match(/(\d{3}\s?\d{7})/);

            results.push({
              merchantName: merchantEl ? merchantEl.textContent.trim() : '',
              offerDetails: titleEl ? titleEl.textContent.trim() : '',
              cardType: cardTypeEl ? cardTypeEl.textContent.trim() : '',
              validity: dateEl ? dateEl.textContent.replace(/\s+/g, ' ').trim() : '',
              coverImage: coverImg ? coverImg.src : '',
              merchantLogo: logoImg ? logoImg.src : '',
              phone: phoneMatch ? phoneMatch[1].trim() : '',
              detailUrl: link ? link.href : '',
              termsAndConditionsPdfUrl: null
            });
          } catch (err) { /* skip */ }
        });
      }

      return results;
    }, selectorType);

    await page.close();
    console.log(`  ✅ Scraped ${offers.length} offers`);
    return offers;

  } catch (error) {
    await page.close();
    throw error;
  }
}

// ─── Load category: from cache or fresh scrape ─────────────────────────────

async function loadCategory(browser, catName, url) {
  // Check cache
  const cached = loadFromCache(url);
  if (cached) {
    console.log(`  💾 Cache hit: ${catName}`);
    // Handle both ndb-2 cache (has .offers) and ndb-3 cache (has .offers or is direct array)
    const offers = cached.offers || cached;
    return { offers: Array.isArray(offers) ? offers : [], fromCache: true };
  }

  // Fresh scrape
  const offers = await scrapeCategoryPage(browser, url);

  // Save to cache
  saveToCache(url, { offers, scrapedAt: new Date().toISOString() });

  return { offers, fromCache: false };
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║  NDB Bank Card Offers Scraper v4.0            ║');
  console.log('║  NDBOffer + PeriodParser + Parallel PDFs      ║');
  console.log('╚═══════════════════════════════════════════════╝\n');

  const args = process.argv.slice(2);
  if (args.includes('--no-cache')) { CONFIG.useCache = false; console.log('⚠️  Cache disabled\n'); }
  if (args.includes('--no-pdf')) { CONFIG.extractPDFTerms = false; console.log('⚠️  PDF extraction disabled\n'); }

  const startTime = Date.now();

  // Launch browser once
  console.log('🌐 Launching browser...');
  const browser = await puppeteer.launch({
    headless: CONFIG.headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
           '--disable-accelerated-2d-canvas', '--disable-gpu']
  });

  const allRawOffers = [];
  const allNDBOffers = [];
  const categoryStats = [];

  // Scrape categories sequentially (Puppeteer single browser)
  for (const cat of NDB_CATEGORIES) {
    const url = `${BASE_URL}/${cat.slug}`;
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`📂 ${cat.name}`);

    let offers = [];
    let fromCache = false;
    let retries = 0;

    while (retries <= CONFIG.maxRetries) {
      try {
        const result = await loadCategory(browser, cat.name, url);
        offers = result.offers;
        fromCache = result.fromCache;
        break;
      } catch (error) {
        retries++;
        if (retries > CONFIG.maxRetries) {
          console.log(`  ❌ Failed after ${CONFIG.maxRetries} retries: ${error.message}`);
          break;
        }
        console.log(`  🔄 Retry ${retries}/${CONFIG.maxRetries}...`);
        await sleep(CONFIG.retryDelay * retries);
      }
    }

    // Build NDBOffer objects
    const catOffers = [];
    for (const raw of offers) {
      allRawOffers.push({ ...raw, _category: cat.name, _sourceUrl: url });
      const ndbOffer = new NDBOffer(raw, cat.name);
      catOffers.push(ndbOffer);
      allNDBOffers.push(ndbOffer);
    }

    categoryStats.push({ name: cat.name, count: offers.length, fromCache });

    // Save per-category file
    const catSlug = cat.slug.replace(/-/g, '_');
    const catPath = path.join(CONFIG.outputDir, `ndb_${catSlug}_v4.json`);
    fs.writeFileSync(catPath, JSON.stringify(catOffers.map(o => o.toJSON()), null, 2));
  }

  await browser.close();
  console.log('\n🌐 Browser closed');

  // ── Parallel PDF extraction ─────────────────────────────────────────────
  if (CONFIG.extractPDFTerms && pdfParseAvailable) {
    const offersWithPDF = allNDBOffers.filter(o => o.pdfUrl);
    if (offersWithPDF.length > 0) {
      console.log(`\n📄 Extracting PDFs (${offersWithPDF.length} offers)...`);
      const limit = pLimit(CONFIG.concurrentPDFRequests);
      await Promise.all(offersWithPDF.map(offer =>
        limit(async () => {
          try {
            const text = await extractPDFText(offer.pdfUrl);
            if (text) offer.pdfText = text;
          } catch (err) {
            console.log(`  ⚠️  PDF failed: ${offer.merchantName}: ${err.message}`);
          }
        })
      ));
      const extracted = offersWithPDF.filter(o => o.pdfText).length;
      console.log(`  ✅ PDFs extracted: ${extracted}/${offersWithPDF.length}`);
    }
  }

  // ── Build validity rows ─────────────────────────────────────────────────
  const allValidityRows = [];
  for (const offer of allNDBOffers) {
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
    if ((row.recurrence_type === 'specific_weekdays' || row.recurrence_type === 'specific_dates')
        && !row.recurrence_days) flags.push('RECURRENCE_NO_DAYS');

    if (flags.length > 0) {
      issues++;
      console.log(`  ⚠️  [${flags.join(',')}] ${row.merchant_name} | raw: "${raw}"`);
      console.log(`       from=${row.valid_from} to=${row.valid_to} rec=${row.recurrence_type} days=${row.recurrence_days}`);
    }
  }

  console.log(`\n  Total validity rows: ${allValidityRows.length}`);
  console.log(`  Issues: ${issues}`);

  // Recurrence breakdown
  const recBreakdown = {};
  for (const row of allValidityRows) {
    recBreakdown[row.recurrence_type] = (recBreakdown[row.recurrence_type] || 0) + 1;
  }
  console.log(`  Recurrence: ${JSON.stringify(recBreakdown)}`);

  // Period type breakdown
  const ptBreakdown = {};
  for (const row of allValidityRows) {
    ptBreakdown[row.period_type] = (ptBreakdown[row.period_type] || 0) + 1;
  }
  console.log(`  Period types: ${JSON.stringify(ptBreakdown)}`);

  // ── Save output files ───────────────────────────────────────────────────
  const allJSON = allNDBOffers.map(o => o.toJSON());

  fs.writeFileSync(path.join(CONFIG.outputDir, 'ndb_all_v4.json'), JSON.stringify(allJSON, null, 2));
  fs.writeFileSync(path.join(CONFIG.outputDir, 'ndb_validity_rows_v4.json'), JSON.stringify(allValidityRows, null, 2));
  fs.writeFileSync(path.join(CONFIG.outputDir, 'ndb_raw_v4.json'), JSON.stringify(allRawOffers, null, 2));

  // ── Summary ─────────────────────────────────────────────────────────────
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('\n╔═══════════════════════════════════════════════╗');
  console.log('║              SUMMARY REPORT                    ║');
  console.log('╚═══════════════════════════════════════════════╝\n');

  let total = 0;
  for (const stat of categoryStats) {
    const icon = stat.fromCache ? '💾' : '🌐';
    console.log(`  ${icon} ${stat.name.padEnd(28)} ${stat.count} offers`);
    total += stat.count;
  }

  console.log(`\n  Total offers:       ${total}`);
  console.log(`  Validity rows:      ${allValidityRows.length}`);
  console.log(`  Issues:             ${issues}`);
  console.log(`  Time:               ${duration}s`);
  console.log(`\n  Output files:`);
  console.log(`    ${path.join(CONFIG.outputDir, 'ndb_all_v4.json')}`);
  console.log(`    ${path.join(CONFIG.outputDir, 'ndb_validity_rows_v4.json')}`);
  console.log(`    ${path.join(CONFIG.outputDir, 'ndb_raw_v4.json')}`);
  console.log('');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { NDBOffer, PeriodParser, OfferValidity, NDB_CATEGORIES };
