/**
 * People's Bank Offers Scraper v4.0 - PeoplesOffer + PeriodParser
 * Features:
 * - Parallel processing (p-limit) for detail pages & PDF downloads
 * - PeoplesOffer class with structured validity periods
 * - PeriodParser handles: Till dates, date ranges, recurring weekdays,
 *   monthly ranges, exclusions, blackout dates, specific dates
 * - Optimized PDF extraction with parallel downloads
 * - DB-ready validity rows (same schema as HNB/BOC v5)
 * Requires: npm install axios cheerio p-limit
 * Optional: npm install pdf-parse@1.1.1
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
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
  retryDelay: 2000,
  timeout: 15000,
  cacheDir: './cache_peoples_bank',
  pdfCacheDir: './cache_peoples_bank_pdfs',
  cacheExpiry: 24 * 60 * 60 * 1000,
  useCache: true,
  fetchDetailPages: true,
  extractPDFTerms: true,
  concurrentDetailRequests: 5,
  concurrentPDFRequests: 3
};

[CONFIG.cacheDir, CONFIG.pdfCacheDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const PEOPLES_CATEGORIES = [
  { name: 'Leisure', slug: 'leisure' },
  { name: 'Restaurants', slug: 'restaurants' },
  { name: 'Clothing', slug: 'clothing' },
  { name: 'Jewellery', slug: 'jewellers' },
  { name: 'Travel', slug: 'travel' },
  { name: 'Online Stores', slug: 'online-stores' },
  { name: 'Supermarkets', slug: 'supermarkets' }
];

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

// ─── Unique ID Generation ──────────────────────────────────────────────────

function generateUniqueId(offer) {
  const components = ['peoples', offer.detailPageUrl || '', offer.merchantName || '', offer.validityRaw || ''];
  const hash = crypto.createHash('sha256').update(components.join('|').toLowerCase().trim()).digest('hex');
  const slug = (offer.merchantName || 'offer').toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 20);
  return `peoples_${hash.substring(0, 12)}_${slug}`;
}

// ─── HTML Fetching ─────────────────────────────────────────────────────────

async function fetchHTML(url, retryCount = 0) {
  const cached = loadFromCache(url);
  if (cached) return { html: cached, fromCache: true };

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
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

  // Check cache
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

function parsePDFTerms(pdfText, offerTitle) {
  if (!pdfText) return null;
  const lines = pdfText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const idx = lines.findIndex(l => l.toLowerCase().includes(offerTitle.toLowerCase().split('–')[0].trim().toLowerCase()));
  if (idx === -1) return { source: 'pdf_general', allTerms: lines.slice(0, 30) };

  const offerTerms = [];
  for (let i = idx; i < lines.length && i < idx + 30; i++) {
    if (i > idx && /^\d+\.|\bOffer\b|\bPromotion\b/i.test(lines[i])) break;
    offerTerms.push(lines[i]);
  }
  return { source: 'pdf_specific', offerTerms };
}

// ─── PeriodParser ──────────────────────────────────────────────────────────
// People's Bank validity formats:
// A: "Till April 30, 2026"
// B: "Till February 28, 2026((Excluding special promotional events & festive days))"
// C: "From February 1, 2026 to April 30, 2026"
// D: "From April 1, 2026 to October 31, 2026(Blackout Dates 10th to 16th April 2026)"
// E: "Till April 30, 2026(Weekend Only)" / "(Every Tuesday)" / "(23rd to 30th of Every Month)"
// F: "(1st,4th,20th,25th,26th,31st March 2026)"

class PeriodParser {

  static parseHumanDate(text, fallbackYear) {
    const cleaned = text.replace(/(\d+)(?:st|nd|rd|th)/gi, '$1').trim();
    // Try UK format first (more specific): "30 April 2026", "01 May 2026"
    // Must check before US format to avoid "September 2026" matching as "September 20, 26"
    const mUK = cleaned.match(/(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?/i);
    if (mUK) {
      const day = parseInt(mUK[1], 10);
      const month = MONTH_MAP[mUK[2].toLowerCase()];
      const year = mUK[3] ? parseInt(mUK[3], 10) : fallbackYear || new Date().getFullYear();
      return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    // US format: "April 30, 2026" — day must not be followed by more digits
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
   * Extract recurring weekday info from parenthetical condition
   * "(Every Tuesday)", "(Every Monday & Wednesday)", "(Weekend Only)",
   * "(Friday, Saturday, Sunday, & Poya Day)"
   */
  static extractRecurrenceDays(conditionText) {
    if (!conditionText) return [];
    const lower = conditionText.toLowerCase();
    const days = [];

    // "Weekend Only" or "Weekends"
    if (/weekend/i.test(lower)) {
      days.push('saturday', 'sunday');
    }

    // "Every Tuesday", "Every Monday & Wednesday", etc.
    const everyMatches = lower.match(/every\s+(\w+)/g);
    if (everyMatches) {
      everyMatches.forEach(m => {
        const word = m.match(/every\s+(\w+)/)[1];
        if (DAY_NAMES.includes(word)) days.push(word);
      });
    }

    // "Every Monday & Wednesday" — the "&" joined day
    const ampMatch = lower.match(/every\s+(\w+)\s*&\s*(\w+)/);
    if (ampMatch) {
      if (DAY_NAMES.includes(ampMatch[2])) days.push(ampMatch[2]);
    }

    // "Friday, Saturday, Sunday, & Poya Day" — comma-separated days
    if (days.length === 0) {
      DAY_NAMES.forEach(d => {
        if (lower.includes(d)) days.push(d);
      });
    }

    return [...new Set(days)];
  }

  /**
   * Extract monthly range like "23rd to 30th of Every Month"
   */
  static extractMonthlyRange(conditionText) {
    if (!conditionText) return null;
    const m = conditionText.match(/(\d{1,2})(?:st|nd|rd|th)?\s+to\s+(\d{1,2})(?:st|nd|rd|th)?\s+of\s+every\s+month/i);
    if (m) return { from_day: parseInt(m[1], 10), to_day: parseInt(m[2], 10) };
    return null;
  }

  /**
   * Extract blackout date ranges from condition text
   * "Blackout Dates 10th to 16th April 2026"
   */
  static extractBlackoutDates(conditionText) {
    if (!conditionText) return [];
    const ranges = [];
    // "Blackout Dates 10th to 16th April 2026"
    const m = conditionText.match(/blackout\s+dates?\s+(\d{1,2})(?:st|nd|rd|th)?\s+to\s+(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?/i);
    if (m) {
      const year = m[4] ? parseInt(m[4], 10) : PeriodParser.extractYear(conditionText) || new Date().getFullYear();
      const month = MONTH_MAP[m[3].toLowerCase()];
      const fromDay = parseInt(m[1], 10);
      const toDay = parseInt(m[2], 10);
      const from = `${year}-${String(month + 1).padStart(2, '0')}-${String(fromDay).padStart(2, '0')}`;
      const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(toDay).padStart(2, '0')}`;
      ranges.push(`${from}:${to}`);
    }
    return ranges;
  }

  /**
   * Extract exclusion notes from condition text
   */
  static extractExclusionNotes(conditionText) {
    if (!conditionText) return null;
    const notes = [];
    if (/excluding\s+special\s+promotional\s+events/i.test(conditionText)) {
      notes.push('Excludes special promotional events & festive days');
    }
    if (/except\s+on\s+blackout\s+dates/i.test(conditionText)) {
      notes.push('Except on blackout dates');
    }
    if (/poya\s+day/i.test(conditionText)) {
      notes.push('Includes Poya Days');
    }
    return notes.length > 0 ? notes.join('; ') : null;
  }

  /**
   * Parse specific dates list: "(1st,4th,20th,25th,26th,31st March 2026)"
   */
  static parseSpecificDates(text) {
    const m = text.match(/\(?([\d\s,stndrdth]+)(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?\)?/i);
    if (!m) return [];
    const month = MONTH_MAP[m[2].toLowerCase()];
    const year = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();
    const dayMatches = m[1].match(/\d{1,2}/g);
    if (!dayMatches) return [];
    return dayMatches.map(d => {
      const day = parseInt(d, 10);
      return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }).sort();
  }

  /**
   * Split validity text into base date and condition parts
   * "Till April 30, 2026((Every Tuesday))" => { base: "Till April 30, 2026", condition: "Every Tuesday" }
   */
  static splitValidityParts(validityRaw) {
    if (!validityRaw) return { base: '', condition: '' };
    // Remove all outer/double parens and extract condition
    // Patterns: "...((condition))" or "...(condition)"
    const condMatch = validityRaw.match(/^(.*?)\s*\(\(?([^)]*(?:\([^)]*\))?[^)]*)\)?\)?\s*$/);
    if (condMatch) {
      return { base: condMatch[1].trim(), condition: condMatch[2].trim() };
    }
    return { base: validityRaw.trim(), condition: '' };
  }

  /**
   * Main parse: given raw validity string, return OfferValidity[]
   */
  static parse(validityRaw) {
    if (!validityRaw || validityRaw.trim().length === 0) {
      return [new OfferValidity({ raw_period_text: '' })];
    }

    const today = new Date().toISOString().split('T')[0];
    const year = PeriodParser.extractYear(validityRaw) || new Date().getFullYear();

    // Check for specific dates list first: "(1st,4th,20th,25th,26th,31st March 2026)"
    if (/\d{1,2}(?:st|nd|rd|th)?\s*,\s*\d{1,2}(?:st|nd|rd|th)?/.test(validityRaw) && !/till|from/i.test(validityRaw)) {
      const dates = PeriodParser.parseSpecificDates(validityRaw);
      if (dates.length > 0) {
        return [new OfferValidity({
          valid_from: dates[0],
          valid_to: dates[dates.length - 1],
          period_type: 'offer',
          recurrence_type: 'specific_dates',
          recurrence_days: dates.join(','),
          raw_period_text: validityRaw
        })];
      }
    }

    const { base, condition } = PeriodParser.splitValidityParts(validityRaw);

    // Parse base date range
    let fromDate = null;
    let toDate = null;

    // "Till April 30, 2026"
    const tillMatch = base.match(/till\s+(.+)/i);
    if (tillMatch) {
      toDate = PeriodParser.parseHumanDate(tillMatch[1], year);
      fromDate = today;
    }

    // "From February 1, 2026 to April 30, 2026"
    const rangeMatch = base.match(/from\s+(.+?)\s+to\s+(.+)/i);
    if (rangeMatch) {
      fromDate = PeriodParser.parseHumanDate(rangeMatch[1], year);
      toDate = PeriodParser.parseHumanDate(rangeMatch[2], year);
    }

    // Fallback
    if (!fromDate) fromDate = today;
    if (!toDate) toDate = null;

    // Clamp
    if (fromDate && toDate && fromDate > toDate) fromDate = toDate;

    // Parse condition for recurrence, exclusions, etc.
    let recurrenceType = 'daily';
    let recurrenceDays = null;
    let exclusionNotes = null;
    let blackoutPeriods = null;

    if (condition) {
      // Monthly range: "23rd to 30th of Every Month"
      const monthlyRange = PeriodParser.extractMonthlyRange(condition);
      if (monthlyRange) {
        recurrenceType = 'monthly_range';
        recurrenceDays = `${monthlyRange.from_day}-${monthlyRange.to_day}`;
      }

      // Recurring weekdays
      if (!monthlyRange) {
        const days = PeriodParser.extractRecurrenceDays(condition);
        if (days.length > 0) {
          recurrenceType = 'specific_weekdays';
          recurrenceDays = days.join(',');
        }
      }

      // Blackout dates
      const blackouts = PeriodParser.extractBlackoutDates(condition);
      if (blackouts.length > 0) blackoutPeriods = blackouts.join(';');

      // Exclusion notes
      exclusionNotes = PeriodParser.extractExclusionNotes(condition);

      // Check for travel period sub-period
      // "Travel Period: 01st May to 30th September 2026"
      const travelMatch = condition.match(/travel\s+period\s*:\s*(\d{1,2}(?:st|nd|rd|th)?\s+\w+)\s+to\s+(\d{1,2}(?:st|nd|rd|th)?\s+\w+\s*\d{4})/i);
      if (travelMatch) {
        const travelFrom = PeriodParser.parseHumanDate(travelMatch[1], year);
        const travelTo = PeriodParser.parseHumanDate(travelMatch[2], year);
        // Return two validities: booking period and travel period
        return [
          new OfferValidity({
            valid_from: fromDate,
            valid_to: toDate,
            period_type: 'booking',
            recurrence_type: recurrenceType,
            recurrence_days: recurrenceDays,
            exclusion_notes: exclusionNotes,
            blackout_periods: blackoutPeriods,
            raw_period_text: validityRaw
          }),
          new OfferValidity({
            valid_from: travelFrom,
            valid_to: travelTo,
            period_type: 'travel',
            recurrence_type: 'daily',
            raw_period_text: condition
          })
        ];
      }
    }

    return [new OfferValidity({
      valid_from: fromDate,
      valid_to: toDate,
      period_type: 'offer',
      recurrence_type: recurrenceType,
      recurrence_days: recurrenceDays,
      exclusion_notes: exclusionNotes,
      blackout_periods: blackoutPeriods,
      raw_period_text: validityRaw
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

  isActiveOn(dateStr) {
    if (!this.valid_from || !this.valid_to) return false;
    if (dateStr < this.valid_from || dateStr > this.valid_to) return false;

    if (this.recurrence_type === 'specific_weekdays' && this.recurrence_days) {
      const d = new Date(dateStr + 'T00:00:00');
      const dayName = DAY_NAMES[d.getDay()];
      if (!this.recurrence_days.split(',').includes(dayName)) return false;
    }

    if (this.recurrence_type === 'specific_dates' && this.recurrence_days) {
      if (!this.recurrence_days.split(',').includes(dateStr)) return false;
    }

    if (this.recurrence_type === 'monthly_range' && this.recurrence_days) {
      const [fromDay, toDay] = this.recurrence_days.split('-').map(Number);
      const dayOfMonth = parseInt(dateStr.split('-')[2], 10);
      if (dayOfMonth < fromDay || dayOfMonth > toDay) return false;
    }

    // Check blackout periods
    if (this.blackout_periods) {
      const ranges = this.blackout_periods.split(';');
      for (const range of ranges) {
        const [bFrom, bTo] = range.split(':');
        if (dateStr >= bFrom && dateStr <= bTo) return false;
      }
    }

    return true;
  }
}

// ─── PeoplesOffer ──────────────────────────────────────────────────────────

class PeoplesOffer {
  constructor(listingData, detailData, category) {
    this.unique_id = generateUniqueId(listingData);
    this.source = 'PEOPLES';
    this.source_url = listingData.detailPageUrl || '';
    this.category = category.name;
    this.category_slug = category.slug;
    this.scraped_at = new Date().toISOString();

    this.title = detailData?.title || listingData.merchantName;
    this.merchant_name = listingData.merchantName;
    this.discount = listingData.discount;
    this.short_description = listingData.shortDescription;
    this.image_url = detailData?.imageUrl || listingData.imageUrl;
    this.location = detailData?.location || listingData.merchantName;

    this.terms = detailData?.terms || [];
    this.terms_url = detailData?.termsUrl || '';
    this.pdf_terms = detailData?.pdfTerms || null;
    this.structured_terms = detailData?.structuredTerms || {};

    this.validity_raw = listingData.validityRaw;

    // Parse validity
    this.validities = PeriodParser.parse(listingData.validityRaw);
  }

  isActiveOn(dateStr) {
    return this.validities.some(v => v.isActiveOn(dateStr));
  }

  toJSON() {
    return {
      unique_id: this.unique_id,
      source: this.source,
      source_url: this.source_url,
      category: this.category,
      category_slug: this.category_slug,
      scraped_at: this.scraped_at,
      title: this.title,
      merchant_name: this.merchant_name,
      discount: this.discount,
      short_description: this.short_description,
      image_url: this.image_url,
      location: this.location,
      terms: this.terms,
      terms_url: this.terms_url,
      pdf_terms: this.pdf_terms,
      structured_terms: this.structured_terms,
      validity_raw: this.validity_raw,
      validities: this.validities
    };
  }
}

// ─── Scraping: Detail Page ─────────────────────────────────────────────────

async function scrapePromotionDetails(url) {
  try {
    const { html } = await fetchHTML(url);
    const $ = cheerio.load(html);
    const $card = $('.single-card');
    if ($card.length === 0) return null;

    const imageUrl = $card.find('.hero-left img').attr('src') || '';
    const title = $card.find('.title').text().trim();

    const descHTML = $card.find('.desc').html() || '';
    const $d = cheerio.load(descHTML);
    const terms = [];
    $d('p').each((i, el) => {
      const text = cheerio.load(el.outerHTML || '').text().trim();
      if (text) terms.push(text);
    });

    const validityText = $card.find('.validity').text().replace('Validity:', '').trim();
    const location = $card.find('.meta-row div').filter((i, el) =>
      $(el).text().includes('Location:')
    ).text().replace('Location:', '').trim();

    const termsUrl = $card.find('a.terms-link').attr('href') || '';

    // Extract structured data from terms
    let minimumSpend = null, maximumBill = null, minimumPax = null, maximumPax = null;
    terms.forEach(term => {
      const ms = term.match(/Minimum\s+Spend[:\s-]*Rs\.?\s*([\d,]+)/i);
      if (ms) minimumSpend = parseInt(ms[1].replace(/,/g, ''));
      const mb = term.match(/Maximum\s+Bill\s+Value[:\s-]*Rs\.?\s*([\d,]+)/i);
      if (mb) maximumBill = parseInt(mb[1].replace(/,/g, ''));
      const mnp = term.match(/Minimum\s+(\d+)\s+Pax/i);
      if (mnp) minimumPax = parseInt(mnp[1]);
      const mxp = term.match(/Maximum\s+(\d+)\s+Pax/i);
      if (mxp) maximumPax = parseInt(mxp[1]);
    });

    return {
      imageUrl, title, location, validityText, terms, termsUrl,
      structuredTerms: { minimumSpend, maximumBill, minimumPax, maximumPax }
    };
  } catch (error) {
    return null;
  }
}

// ─── Scraping: Category Listing ────────────────────────────────────────────

async function scrapeCategoryListing(url) {
  try {
    const { html } = await fetchHTML(url);
    const $ = cheerio.load(html);
    const cards = [];

    $('.offer-card').each((i, card) => {
      const $card = $(card);
      cards.push({
        merchantName: $card.find('.promo-short').text().trim(),
        discount: $card.find('.discount-badge').text().trim(),
        shortDescription: $card.find('.merchant-name').clone().children().remove().end().text().trim(),
        validityRaw: $card.find('.valid-date').text().trim(),
        imageUrl: $card.find('.offer-image img').attr('src') || '',
        detailPageUrl: $card.find('.offer-image a').attr('href') || $card.find('.promo-short a').attr('href') || ''
      });
    });

    return cards;
  } catch (error) {
    console.error(`    Error fetching listing: ${error.message}`);
    return [];
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║  People\'s Bank Scraper v4.0 - PeoplesOffer + Parser   ║');
  console.log('║  ✓ Parallel processing (detail pages + PDFs)         ║');
  console.log('║  ✓ Structured validity (DB-ready, same as HNB/BOC)  ║');
  console.log('║  ✓ Recurrence, exclusions, blackouts, monthly range ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  const args = process.argv.slice(2);

  if (args.includes('--clear-cache')) {
    [CONFIG.cacheDir, CONFIG.pdfCacheDir].forEach(dir => {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        files.forEach(f => fs.unlinkSync(path.join(dir, f)));
        console.log(`Cleared ${files.length} files from ${dir}`);
      }
    });
    return;
  }

  if (args.includes('--no-cache')) { CONFIG.useCache = false; console.log('Cache disabled\n'); }
  if (args.includes('--no-details')) { CONFIG.fetchDetailPages = false; console.log('Detail pages disabled\n'); }
  if (args.includes('--no-pdf')) { CONFIG.extractPDFTerms = false; }

  console.log(`PDF extraction: ${CONFIG.extractPDFTerms && pdfParseAvailable ? 'Enabled' : 'Disabled'}`);
  console.log(`Detail pages: ${CONFIG.fetchDetailPages ? 'Enabled' : 'Disabled'}`);
  console.log(`Concurrent detail requests: ${CONFIG.concurrentDetailRequests}\n`);

  let categoriesToScrape = PEOPLES_CATEGORIES;
  const catArg = args.find(a => a.startsWith('--category='));
  if (catArg) {
    const slug = catArg.split('=')[1];
    categoriesToScrape = PEOPLES_CATEGORIES.filter(c => c.slug === slug);
    if (categoriesToScrape.length === 0) categoriesToScrape = [{ name: slug, slug }];
  }

  const startTime = Date.now();
  const allOffers = [];
  const allRawListings = [];
  const categorySummary = {};
  const pdfCache = {}; // avoid downloading same PDF multiple times

  for (const cat of categoriesToScrape) {
    const catUrl = `https://www.peoplesbank.lk/promotion-category/${cat.slug}/?cardType=credit_card`;
    console.log(`\n============================================================`);
    console.log(`Category: ${cat.name}`);
    console.log(`============================================================`);

    // Step 1: Get listing
    const listings = await scrapeCategoryListing(catUrl);
    if (listings.length === 0) {
      categorySummary[cat.name] = 0;
      continue;
    }
    console.log(`  Found ${listings.length} offers in listing.`);

    // Step 2: Fetch detail pages in parallel
    let detailsMap = {};
    if (CONFIG.fetchDetailPages) {
      const limit = pLimit(CONFIG.concurrentDetailRequests);
      const detailPromises = listings.map((listing, i) => {
        if (!listing.detailPageUrl) return Promise.resolve(null);
        return limit(async () => {
          const detail = await scrapePromotionDetails(listing.detailPageUrl);
          if ((i + 1) % 5 === 0 || i === listings.length - 1) {
            process.stdout.write(`  Details: ${i + 1}/${listings.length}\r`);
          }
          return { url: listing.detailPageUrl, detail };
        });
      });

      const detailResults = await Promise.all(detailPromises);
      detailResults.forEach(r => {
        if (r && r.detail) detailsMap[r.url] = r.detail;
      });
      console.log(`  Details: ${Object.keys(detailsMap).length}/${listings.length} fetched.`);
    }

    // Step 3: Extract PDFs in parallel (unique URLs only)
    if (CONFIG.extractPDFTerms && pdfParseAvailable) {
      const uniquePdfUrls = [...new Set(
        Object.values(detailsMap).map(d => d.termsUrl).filter(u => u && !pdfCache[u])
      )];

      if (uniquePdfUrls.length > 0) {
        console.log(`  Extracting ${uniquePdfUrls.length} unique PDFs...`);
        const pdfLimit = pLimit(CONFIG.concurrentPDFRequests);
        const pdfPromises = uniquePdfUrls.map(url =>
          pdfLimit(async () => {
            const text = await extractPDFText(url);
            return { url, text };
          })
        );
        const pdfResults = await Promise.all(pdfPromises);
        pdfResults.forEach(r => { if (r.text) pdfCache[r.url] = r.text; });
        console.log(`  PDFs extracted: ${pdfResults.filter(r => r.text).length}/${uniquePdfUrls.length}`);
      }

      // Attach PDF terms to details
      Object.values(detailsMap).forEach(detail => {
        if (detail.termsUrl && pdfCache[detail.termsUrl]) {
          detail.pdfTerms = parsePDFTerms(pdfCache[detail.termsUrl], detail.title);
        }
      });
    }

    // Step 4: Build PeoplesOffer objects
    const offers = listings.map(listing => {
      const detail = detailsMap[listing.detailPageUrl] || null;
      return new PeoplesOffer(listing, detail, cat);
    });

    allOffers.push(...offers);
    allRawListings.push(...listings.map(l => ({ ...l, category: cat.name })));
    categorySummary[cat.name] = offers.length;
    console.log(`  ${offers.length} PeoplesOffer objects built.`);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  // ── Save output ─────────────────────────────────────────────────────
  const outputDir = './output';
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // 1. All offers
  const allFile = path.join(outputDir, 'peoples_all_v4.json');
  fs.writeFileSync(allFile, JSON.stringify({
    metadata: {
      source: 'PEOPLES',
      scraped_at: new Date().toISOString(),
      total_offers: allOffers.length,
      categories: categorySummary,
      scrape_duration: `${duration}s`
    },
    offers: allOffers.map(o => o.toJSON())
  }, null, 2));
  console.log(`\n  Saved: ${allFile}`);

  // 2. Flattened validity rows
  const validityRows = [];
  allOffers.forEach(offer => {
    offer.validities.forEach(v => {
      validityRows.push({
        offer_unique_id: offer.unique_id,
        offer_title: offer.title,
        merchant_name: offer.merchant_name,
        category: offer.category,
        valid_from: v.valid_from,
        valid_to: v.valid_to,
        period_type: v.period_type,
        recurrence_type: v.recurrence_type,
        recurrence_days: v.recurrence_days,
        time_from: v.time_from,
        time_to: v.time_to,
        exclusion_days: v.exclusion_days,
        blackout_periods: v.blackout_periods,
        exclusion_notes: v.exclusion_notes,
        raw_period_text: v.raw_period_text
      });
    });
  });

  const rowsFile = path.join(outputDir, 'peoples_validity_rows_v4.json');
  fs.writeFileSync(rowsFile, JSON.stringify({ totalRows: validityRows.length, rows: validityRows }, null, 2));
  console.log(`  Saved: ${rowsFile} (${validityRows.length} rows)`);

  // 3. Raw data
  const rawFile = path.join(outputDir, 'peoples_raw_v4.json');
  fs.writeFileSync(rawFile, JSON.stringify({
    metadata: { source: 'PEOPLES', scraped_at: new Date().toISOString(), total: allRawListings.length },
    listings: allRawListings
  }, null, 2));
  console.log(`  Saved: ${rawFile}`);

  // 4. Per-category files
  for (const [catName, count] of Object.entries(categorySummary)) {
    if (count === 0) continue;
    const slug = PEOPLES_CATEGORIES.find(c => c.name === catName)?.slug || catName.toLowerCase().replace(/\s+/g, '-');
    const catOffers = allOffers.filter(o => o.category === catName);
    const catFile = path.join(outputDir, `peoples_${slug.replace(/-/g, '_')}_v4.json`);
    fs.writeFileSync(catFile, JSON.stringify(catOffers.map(o => o.toJSON()), null, 2));
    console.log(`  Saved: ${catFile}`);
  }

  // ── Summary ─────────────────────────────────────────────────────────
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║                    SUMMARY REPORT                      ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  for (const [name, count] of Object.entries(categorySummary)) {
    if (count > 0) console.log(`  ${name.padEnd(25)} : ${count} offers`);
  }

  // Recurrence breakdown
  const recBreakdown = {};
  validityRows.forEach(r => {
    recBreakdown[r.recurrence_type] = (recBreakdown[r.recurrence_type] || 0) + 1;
  });

  console.log(`\n  Total offers              : ${allOffers.length}`);
  console.log(`  Total validity rows       : ${validityRows.length}`);
  console.log(`  ── Recurrence breakdown ──`);
  Object.entries(recBreakdown).forEach(([type, count]) => {
    console.log(`     ${type.padEnd(22)} : ${count}`);
  });
  console.log(`  Time taken                : ${duration}s`);

  const today = new Date().toISOString().split('T')[0];
  const activeToday = allOffers.filter(o => o.isActiveOn(today)).length;
  console.log(`\n  Active today (${today}): ${activeToday}/${allOffers.length} offers`);

  if (allOffers.length > 0) {
    console.log('\n  Sample (first 5):');
    allOffers.slice(0, 5).forEach(o => {
      const v = o.validities[0];
      console.log(`    - ${o.title} | ${v.valid_from} to ${v.valid_to} [${v.recurrence_type}]`);
    });
  }

  // Check for issues
  const issues = [];
  validityRows.forEach((r, i) => {
    if (!r.valid_from) issues.push({ row: i, type: 'NULL_FROM', detail: r.offer_title });
    if (!r.valid_to) issues.push({ row: i, type: 'NULL_TO', detail: r.offer_title });
    if (r.valid_from && r.valid_to && r.valid_from > r.valid_to)
      issues.push({ row: i, type: 'FROM_AFTER_TO', detail: `${r.valid_from} > ${r.valid_to}` });
  });

  if (issues.length > 0) {
    console.log(`\n  Issues found: ${issues.length}`);
    issues.forEach(iss => console.log(`    row ${iss.row}: ${iss.type} - ${iss.detail || ''}`));
  } else {
    console.log('\n  No issues found!');
  }

  console.log('\n  Done!\n');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { PeoplesOffer, OfferValidity, PeriodParser, PEOPLES_CATEGORIES };
