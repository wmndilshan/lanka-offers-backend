/**
 * Sampath Bank Card Promotions Scraper v6.0
 * Enhanced with detail page scraping for structured data
 *
 * NEW in v6:
 * - Detail page fetching for full addresses and structured info boxes
 * - Image URL extraction from both API and detail pages
 * - Partner, Location, Reservation Number from detail boxes
 * - Detailed terms & conditions as numbered array
 * - Source URL tracking (detail page links)
 * - Enhanced merchant address data
 *
 * Inherits from v5:
 * - Direct JSON API consumer
 * - SampathOffer class with structured validity
 * - PeriodParser for date extraction
 * - Unique SHA-256 IDs (unchanged - stable!)
 * - API response caching
 *
 * Requires: npm install axios cheerio
 * Usage: node sampath-6.js [--no-cache] [--category=hotels] [--skip-details]
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { normalizeValidity } = require('./lib/period-normalize');
const PeriodEngine = require('./lib/period-engine');
const AddressEngine = require('./lib/address-engine');
const crypto = require('crypto');
const { createLogger } = require('./lib/logger');
const log = createLogger('sampath');

// ─── Configuration ──────────────────────────────────────────────────────────
const CONFIG = {
  baseApiUrl: 'https://www.sampath.lk/api/card-promotions',
  baseWebUrl: 'https://www.sampath.lk',
  timeout: 15000,
  retries: 3,
  retryDelay: 1000,
  delayBetweenRequests: 500,
  cacheDir: './cache_sampath',
  detailCacheDir: './cache_sampath/details',
  cacheExpiry: 24 * 60 * 60 * 1000,
  useCache: true,
  fetchDetails: true, // Set to false with --skip-details flag
  maxConcurrent: 5
};

// All Sampath API categories with offers
const SAMPATH_CATEGORIES = [
  { name: 'Hotels', slug: 'hotels' },
  { name: 'Dining', slug: 'dining' },
  { name: 'Online', slug: 'online' },
  { name: 'Fashion', slug: 'fashion' },
  { name: 'Supermarket', slug: 'super_market' }
];

// Create cache directories
[CONFIG.cacheDir, CONFIG.detailCacheDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── Utilities ──────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Cache ──────────────────────────────────────────────────────────────────
function getCachePath(key, subdir = null) {
  const hash = crypto.createHash('md5').update(key).digest('hex');
  const dir = subdir ? path.join(CONFIG.cacheDir, subdir) : CONFIG.cacheDir;
  return path.join(dir, `${hash}.json`);
}

function loadFromCache(key, subdir = null) {
  if (!CONFIG.useCache) return null;
  const p = getCachePath(key, subdir);
  if (!fs.existsSync(p)) return null;
  const stats = fs.statSync(p);
  if (Date.now() - stats.mtime.getTime() > CONFIG.cacheExpiry) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8')).data;
}

function saveToCache(key, data, subdir = null) {
  const p = getCachePath(key, subdir);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ key, data, cachedAt: new Date().toISOString() }, null, 2));
}

// ─── Month map ──────────────────────────────────────────────────────────────
const MONTH_MAP = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
};
const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// ─── Detail Page Scraping (NEW in v6) ──────────────────────────────────────

/**
 * Fetch and parse detail page HTML
 * @param {string} detailPath - e.g. "/sampath-cards/credit-card-offer/2150"
 * @returns {object|null} - parsed detail data
 */
async function fetchDetailPage(detailPath) {
  if (!CONFIG.fetchDetails) return null;

  const cacheKey = `detail_${detailPath}`;
  const cached = loadFromCache(cacheKey, 'details');
  if (cached) return cached;

  try {
    await sleep(CONFIG.delayBetweenRequests);
    const url = `${CONFIG.baseWebUrl}${detailPath}`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html'
      },
      timeout: CONFIG.timeout
    });

    const details = parseDetailPage(response.data, url);
    saveToCache(cacheKey, details, 'details');
    return details;
  } catch (error) {
    console.warn(`    ⚠️  Failed to fetch detail page ${detailPath}: ${error.message}`);
    return null;
  }
}

/**
 * Parse detail page HTML to extract structured info
 */
function parseDetailPage(html, sourceUrl) {
  const $ = cheerio.load(html);
  const details = {
    source_url: sourceUrl,
    images: [],
    partner: null,
    location: null,
    full_address: null,
    promotion_period: null,
    eligible_cards: null,
    reservation_number: null,
    promotion_details_text: null,
    terms_array: []
  };

  // Extract images
  $('img[src*="/api/uploads/"]').each((i, elem) => {
    const src = $(elem).attr('src');
    const alt = $(elem).attr('alt') || '';
    if (src && src.includes('/api/uploads/')) {
      const fullUrl = src.startsWith('http') ? src : `${CONFIG.baseWebUrl}${src}`;
      details.images.push({
        url: fullUrl,
        alt: alt,
        type: alt.toLowerCase().includes('promotion') ? 'promotion' : 'general'
      });
    }
  });

  // Extract structured info boxes (aliya-resort-and-spa-box)
  $('.aliya-resort-and-spa-box').each((i, box) => {
    const heading = $(box).find('.box-heading').text().trim();
    const content = $(box).find('.box-txt').text().trim();

    if (!content) return;

    if (/partner/i.test(heading)) {
      details.partner = content;
    } else if (/location/i.test(heading)) {
      details.location = content;
      // This is the full address like "724 Matara Road, Talpe, Galle"
      details.full_address = content;
    } else if (/promotion\s+period/i.test(heading)) {
      details.promotion_period = content;
    } else if (/eligible\s+card/i.test(heading)) {
      details.eligible_cards = content;
    } else if (/reservation\s+number/i.test(heading)) {
      details.reservation_number = content;
    }
  });

  // Extract Promotion Details text
  const promoDetailsHeading = $('h1:contains("Promotion Details")');
  if (promoDetailsHeading.length > 0) {
    const promoText = promoDetailsHeading.next('p').text().trim();
    details.promotion_details_text = promoText;
  }

  // Extract Terms & Conditions as numbered array
  const termsHeading = $('h1:contains("Terms")').last();
  if (termsHeading.length > 0) {
    const termsContainer = termsHeading.next('p');
    const termsHtml = termsContainer.html() || '';

    // Split by <br><br> or numbered patterns
    const termsParts = termsHtml.split(/<br\s*\/?>\s*<br\s*\/?>/i);
    termsParts.forEach(part => {
      const cleanText = stripHtml(part);
      // Remove leading number and clean
      const termText = cleanText.replace(/^\d+\.\s*/, '').trim();
      if (termText.length > 10) {
        details.terms_array.push(termText);
      }
    });
  }

  return details;
}

/**
 * Batch fetch detail pages with concurrency control
 */
async function fetchDetailsBatch(detailPaths) {
  if (!CONFIG.fetchDetails || detailPaths.length === 0) return [];

  const results = [];
  let completed = 0;

  for (let i = 0; i < detailPaths.length; i += CONFIG.maxConcurrent) {
    const batch = detailPaths.slice(i, i + CONFIG.maxConcurrent);
    const batchResults = await Promise.all(
      batch.map(async (path) => {
        const details = await fetchDetailPage(path);
        return { path, details };
      })
    );
    results.push(...batchResults);
    completed += batch.length;
    process.stdout.write(`\r    🔍 Fetching details: ${completed}/${detailPaths.length}`);
  }
  if (detailPaths.length > 0) console.log('');

  return results;
}

// ─── OfferValidity ──────────────────────────────────────────────────────────
class OfferValidity {
  constructor(opts = {}) {
    this.valid_from = opts.valid_from || null;
    this.valid_to = opts.valid_to || null;
    this.period_type = opts.period_type || 'offer';
    this.recurrence_type = opts.recurrence_type || 'daily';
    this.recurrence_days = opts.recurrence_days || null;
    this.time_from = opts.time_from || null;
    this.time_to = opts.time_to || null;
    this.exclusion_days = opts.exclusion_days || null;
    this.blackout_periods = opts.blackout_periods || null;
    this.exclusion_notes = opts.exclusion_notes || null;
    this.raw_period_text = opts.raw_period_text || '';
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

// ─── PeriodParser (from v5, unchanged) ─────────────────────────────────────
class PeriodParser {

  static parseHumanDate(text, fallbackYear) {
    const cleaned = text.replace(/(\d+)(?:st|nd|rd|th)/gi, '$1').trim();
    // UK format first: "30 April 2026"
    const mUK = cleaned.match(/(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?/i);
    if (mUK) {
      const day = parseInt(mUK[1], 10);
      const month = MONTH_MAP[mUK[2].toLowerCase()];
      const year = mUK[3] ? parseInt(mUK[3], 10) : fallbackYear || new Date().getFullYear();
      return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    // US format: "April 30, 2026"
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

    return { fromDate: date1, toDate: date2 };
  }

  static parseLine(text, year) {
    const periods = [];

    // "Valid from X to Y" or "Valid till Y"
    const validRe = /valid\s+(?:from\s+(.+?)\s+to\s+(.+?)|(?:till|until)\s+(.+?))[.;,]?(?:\s|$)/i;
    const validMatch = text.match(validRe);
    if (validMatch) {
      if (validMatch[1] && validMatch[2]) {
        const { fromDate, toDate } = PeriodParser.parseDateRangeParts(validMatch[1].trim(), validMatch[2].trim(), year);
        periods.push(new OfferValidity({ valid_from: fromDate, valid_to: toDate, raw_period_text: text }));
      } else if (validMatch[3]) {
        const toDate = PeriodParser.parseHumanDate(validMatch[3].trim(), year);
        periods.push(new OfferValidity({ valid_to: toDate, raw_period_text: text }));
      }
    }

    return periods;
  }

  static extractBlackouts(text) {
    const result = { exclusion_days: null, blackout_periods: null, exclusion_notes: null };
    if (!text) return result;

    const lower = text.toLowerCase();
    const notes = [];

    // "Blackout periods may apply"
    if (/blackout\s+period/i.test(text)) {
      notes.push('Blackout periods may apply');
    }

    // Specific blackouts: "Blackout Periods: 24th to 26th December 2026"
    const blackoutRe = /blackout\s+period[s]?\s*:\s*(\d{1,2})(?:st|nd|rd|th)?\s+to\s+(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?/i;
    const blackoutMatch = text.match(blackoutRe);
    if (blackoutMatch) {
      const month = MONTH_MAP[blackoutMatch[3].toLowerCase()];
      const year = blackoutMatch[4] ? parseInt(blackoutMatch[4], 10) : new Date().getFullYear();
      const from = `${year}-${String(month + 1).padStart(2, '0')}-${String(parseInt(blackoutMatch[1])).padStart(2, '0')}`;
      const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(parseInt(blackoutMatch[2])).padStart(2, '0')}`;
      result.blackout_periods = `${from}:${to}`;
    }

    if (notes.length > 0) result.exclusion_notes = notes.join('; ');
    return result;
  }

  static parseDetails(text, year) {
    const results = [];
    if (!text) return { periods: results, periodType: 'offer' };

    const TERM = '(?:\\.|;|$|\\s*(?:eligibility|terms|conditions|general|special|note|\\*))';

    // "Booking Period – Valid from X to Y" or "Booking Period – Valid till Y"
    const bookingRe = new RegExp('booking\\s+period\\s*[-:]\\s*valid\\s+(?:from\\s+(.+?)\\s+to\\s+(.+?)' + TERM + '|(?:till|until)\\s+(.+?)' + TERM + ')', 'i');
    const bookingMatch = text.match(bookingRe);
    if (bookingMatch) {
      if (bookingMatch[1] && bookingMatch[2]) {
        const { fromDate, toDate } = PeriodParser.parseDateRangeParts(bookingMatch[1].trim(), bookingMatch[2].trim(), year);
        results.push({ type: 'booking', from: fromDate, to: toDate });
      } else if (bookingMatch[3]) {
        results.push({ type: 'booking', from: null, to: PeriodParser.parseHumanDate(bookingMatch[3].trim(), year) });
      }
    }

    // "Stay Period" or "Travel Period"
    const stayRe = new RegExp('(?:stay|travel)\\s+period\\s*[-:]\\s*valid\\s+(?:from\\s+(.+?)\\s+to\\s+(.+?)' + TERM + '|(?:till|until)\\s+(.+?)' + TERM + ')', 'i');
    const stayMatch = text.match(stayRe);
    if (stayMatch) {
      const type = /travel/i.test(stayMatch[0]) ? 'travel' : 'stay';
      if (stayMatch[1] && stayMatch[2]) {
        const { fromDate, toDate } = PeriodParser.parseDateRangeParts(stayMatch[1].trim(), stayMatch[2].trim(), year);
        results.push({ type, from: fromDate, to: toDate });
      } else if (stayMatch[3]) {
        results.push({ type, from: null, to: PeriodParser.parseHumanDate(stayMatch[3].trim(), year) });
      }
    }

    // Also try "Promotion Period – Valid till/from" as generic offer
    if (results.length === 0) {
      const promoRe = new RegExp('(?:promotion\\s+)?period\\s*[-:]\\s*valid\\s+(?:from\\s+(.+?)\\s+to\\s+(.+?)' + TERM + '|(?:till|until)\\s+(.+?)' + TERM + ')', 'i');
      const promoMatch = text.match(promoRe);
      if (promoMatch) {
        if (promoMatch[1] && promoMatch[2]) {
          const { fromDate, toDate } = PeriodParser.parseDateRangeParts(promoMatch[1].trim(), promoMatch[2].trim(), year);
          results.push({ type: 'offer', from: fromDate, to: toDate });
        } else if (promoMatch[3]) {
          results.push({ type: 'offer', from: null, to: PeriodParser.parseHumanDate(promoMatch[3].trim(), year) });
        }
      }
    }

    // Detect period type from prefix
    let periodType = 'offer';
    if (/booking\s+period/i.test(text) && !stayMatch) periodType = 'booking';

    return { periods: results, periodType };
  }

  static parse(cardPeriodText, detailsText, expireTs, displayTs) {
    const rawText = cardPeriodText || detailsText || '';
    const year = PeriodParser.extractYear(rawText) || new Date().getFullYear();

    const engine = PeriodEngine.parse(rawText, { defaultPeriodType: 'offer' });
    if (engine.length > 0) {
      return engine.map(p => new OfferValidity(p));
    }

    // Extract blackout info from details
    const blackouts = PeriodParser.extractBlackouts(detailsText);

    // Check if details has booking/stay split
    const detailsParsed = PeriodParser.parseDetails(detailsText, year);

    // If we have booking/stay splits from details, use those
    if (detailsParsed.periods.length > 0) {
      return detailsParsed.periods.map(p => new OfferValidity({
        valid_from: p.from,
        valid_to: p.to,
        period_type: p.type,
        exclusion_days: blackouts.exclusion_days,
        blackout_periods: blackouts.blackout_periods,
        exclusion_notes: blackouts.exclusion_notes,
        raw_period_text: detailsText
      }));
    }

    // Parse cards_new period text (cleanest source)
    let periods = [];
    if (cardPeriodText) {
      periods = PeriodParser.parseLine(cardPeriodText, year);
    }

    // If no card text, try parsing details for dates
    if (periods.length === 0 && detailsText) {
      const detailClean = detailsText.replace(/^(?:promotion|booking)\s+period\s*[-:]\s*/i, '').trim();
      if (/valid\s+(?:till|until|from)/i.test(detailClean)) {
        periods = PeriodParser.parseLine(detailClean, year);
      }
    }

    // Fallback: use expire_on timestamp
    if (periods.length === 0 && expireTs) {
      const expDate = new Date(parseInt(expireTs)).toISOString().split('T')[0];
      const dispDate = displayTs ? new Date(parseInt(displayTs)).toISOString().split('T')[0] : null;
      periods = [new OfferValidity({
        valid_from: dispDate,
        valid_to: expDate,
        raw_period_text: rawText || `(from timestamp: expires ${expDate})`
      })];
    }

    // If still empty, return single empty validity
    if (periods.length === 0) {
      periods = [new OfferValidity({ raw_period_text: rawText || '(none)' })];
    }

    // Apply blackout info and period type to all periods
    const periodType = detailsParsed.periodType;
    periods.forEach(p => {
      if (periodType !== 'offer' && p.period_type === 'offer') p.period_type = periodType;
      if (!p.exclusion_days && blackouts.exclusion_days) p.exclusion_days = blackouts.exclusion_days;
      if (!p.blackout_periods && blackouts.blackout_periods) p.blackout_periods = blackouts.blackout_periods;
      if (!p.exclusion_notes && blackouts.exclusion_notes) p.exclusion_notes = blackouts.exclusion_notes;
    });

    return periods;
  }
}

// ─── SampathOffer v6 ────────────────────────────────────────────────────────
class SampathOffer {
  constructor(raw, category, detailData = null) {
    // Unique ID — stable identity: merchant + city + category only.
    // short_discount was removed: promotional wording changes between scrapes and
    // caused a new unique_id (and duplicate DB row) each time the bank updated text.
    const hashInput = ['sampath', raw.company_name || '', raw.city || '', category || ''].join('|').toLowerCase().trim();
    const hash = crypto.createHash('sha256').update(hashInput).digest('hex');
    const slug = (raw.company_name || 'offer').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 20);
    this.unique_id = `sampath_${hash.substring(0, 12)}_${slug}`;

    this.source = 'Sampath';
    this.category = category;
    this.scraped_at = new Date().toISOString();

    // Source URL (NEW in v6)
    this.source_url = null;
    this.detail_page_url = null;
    if (raw.url) {
      this.source_url = `${CONFIG.baseWebUrl}${raw.url}`;
      this.detail_page_url = `${CONFIG.baseWebUrl}${raw.url}`;
    }
    if (detailData?.source_url) {
      this.source_url = detailData.source_url;
    }

    // Images (NEW in v6)
    this.images = {
      api_image: raw.image_url || null,
      detail_images: detailData?.images || [],
      primary_image: null
    };
    // Set primary image (prefer API image, fallback to first detail image)
    this.images.primary_image = this.images.api_image || (this.images.detail_images[0]?.url) || null;

    // Merchant info (ENHANCED in v6)
    const merchantName = stripHtml(raw.company_name);
    const rawAddressText = (detailData?.full_address || '') + ' ' + (raw.location || '') + ' ' + (stripHtml(raw.promotion_details) || '');
    const extractedAddresses = AddressEngine.extract(rawAddressText, merchantName);

    this.merchant = {
      name: merchantName,
      city: raw.city || '',
      location: raw.location || '',
      addresses: extractedAddresses,
      full_address: extractedAddresses[0] || detailData?.full_address || raw.location || '',
      partner: detailData?.partner || null,
      contact_number: this._extractContact(raw),
      reservation_number: detailData?.reservation_number || null
    };

    // Offer details
    this.offer = {
      discount: raw.short_discount || stripHtml(raw.discounts) || '',
      description: stripHtml(raw.description),
      short_description: stripHtml(raw.short_description),
      terms_conditions: this._parseTerms(raw.terms_and_conditions),
      terms_array: detailData?.terms_array || [], // NEW in v6
      eligible_cards: this._extractCards(raw),
      eligible_cards_detail: detailData?.eligible_cards || null // NEW in v6
    };

    // Validity source texts
    const cardPeriodText = this._getCardPeriod(raw);
    const detailsText = stripHtml(raw.promotion_details);
    this.validityRaw = cardPeriodText || detailsText || '';
    this.promotionDetails = detailsText;
    this.promotionDetailsFromPage = detailData?.promotion_details_text || null; // NEW in v6

    // Timestamps
    this.expireOn = raw.expire_on || null;
    this.displayOn = raw.display_on || null;

    // Parse validity periods
    this.validity_periods = PeriodParser.parse(cardPeriodText, detailsText, raw.expire_on, raw.display_on);

    // Raw API ID
    this.apiId = raw.id;

    // Detail page data flag
    this.has_detail_data = !!detailData;
  }

  _getCardPeriod(raw) {
    if (!Array.isArray(raw.cards_new)) return '';
    const card = raw.cards_new.find(c => c.title === 'Promotion Period');
    return card ? stripHtml(card.description) : '';
  }

  _extractContact(raw) {
    const contacts = [];
    if (raw.contact_number_1) contacts.push(raw.contact_number_1);
    if (raw.contact_number_2) contacts.push(raw.contact_number_2);
    if (raw.reservation_number) contacts.push(raw.reservation_number);

    // Also check cards_new
    if (Array.isArray(raw.cards_new)) {
      raw.cards_new.forEach(c => {
        const title = c.title?.toLowerCase() || '';
        if (/contact|phone|reservation/.test(title) && c.description) {
          const nums = stripHtml(c.description).match(/\d{7,}/g);
          if (nums) contacts.push(...nums);
        }
      });
    }

    return contacts.length > 0 ? [...new Set(contacts)].join(', ') : '';
  }

  _parseTerms(termsHtml) {
    if (!termsHtml) return [];
    const clean = stripHtml(termsHtml);
    return clean.split(/\.\s+/).map(t => t.trim()).filter(t => t.length > 10);
  }

  _extractCards(raw) {
    const cards = [];
    if (Array.isArray(raw.cards_new)) {
      raw.cards_new.forEach(c => {
        const title = c.title?.toLowerCase() || '';
        if (/card|visa|master|amex/i.test(title) && c.description) {
          cards.push(stripHtml(c.description));
        }
      });
    }
    if (cards.length === 0 && raw.eligible_cards) {
      cards.push(stripHtml(raw.eligible_cards));
    }
    return cards.filter(c => c.length > 0);
  }

  toJSON() {
    return {
      unique_id: this.unique_id,
      source: this.source,
      source_url: this.source_url,
      detail_page_url: this.detail_page_url,
      category: this.category,
      scraped_at: this.scraped_at,
      images: this.images,
      merchant: this.merchant,
      offer: this.offer,
      validity_periods: this.validity_periods.map(v => v.toJSON()),
      has_detail_data: this.has_detail_data,
      api_id: this.apiId
    };
  }
}

// ─── API Fetcher ────────────────────────────────────────────────────────────
async function fetchCategory(categorySlug) {
  const cacheKey = `sampath_api_${categorySlug}`;
  const cached = loadFromCache(cacheKey);
  if (cached) return cached;

  const url = `${CONFIG.baseApiUrl}/${categorySlug}`;
  let attempt = 0;

  while (attempt < CONFIG.retries) {
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json'
        },
        timeout: CONFIG.timeout
      });

      saveToCache(cacheKey, response.data);
      return response.data;
    } catch (error) {
      attempt++;
      if (attempt >= CONFIG.retries) throw error;
      await sleep(CONFIG.retryDelay * attempt);
    }
  }
}

// ─── Main Scraping Pipeline ────────────────────────────────────────────────
async function scrapeCategory(category) {
  log.info('Category', `Starting: ${category.name}`, { slug: category.slug });

  try {
    // Fetch API data
    log.debug('API', `Fetching ${category.slug} offers...`);
    const t = log.timer('API', `Fetch ${category.slug}`);
    const apiData = await fetchCategory(category.slug);
    t.done();

    if (!apiData || !Array.isArray(apiData)) {
      log.warn('API', `No data returned for ${category.name}`);
      return { success: false, category: category.name, offers: [] };
    }

    log.info('API', `Found ${apiData.length} offers in ${category.name}`, { count: apiData.length });

    // Extract detail page URLs
    const detailPaths = apiData
      .map(offer => offer.url)
      .filter(url => url && url.length > 0);

    // Fetch detail pages (NEW in v6)
    let detailsMap = {};
    if (CONFIG.fetchDetails && detailPaths.length > 0) {
      log.debug('Details', `Fetching ${detailPaths.length} detail pages...`);
      const detailResults = await fetchDetailsBatch(detailPaths);
      detailResults.forEach(r => {
        if (r.details) detailsMap[r.path] = r.details;
      });
      log.debug('Details', `Loaded ${Object.keys(detailsMap).length} detail pages`);
    }

    // Build SampathOffer objects
    const offers = apiData.map(raw => {
      const detailData = detailsMap[raw.url] || null;
      return new SampathOffer(raw, category.name, detailData);
    });

    log.success('Category', `${category.name} complete`, { count: offers.length, withDetails: Object.keys(detailsMap).length });
    return { success: true, category: category.name, offers };

  } catch (error) {
    log.error('Category', `Failed: ${category.name} — ${error.message}`, { stack: error.stack?.split('\n')[1] });
    return { success: false, category: category.name, error: error.message, offers: [] };
  }
}

async function scrapeAll(categoriesToScrape) {
  log.info('Scraper', `Sampath v6 starting — ${categoriesToScrape.length} categories`, { categories: categoriesToScrape.map(c => c.name) });
  const startTime = Date.now();

  const results = [];
  for (const cat of categoriesToScrape) {
    const result = await scrapeCategory(cat);
    results.push(result);
    await sleep(CONFIG.delayBetweenRequests);
  }

  const allOffers = [];
  const stats = {
    totalOffers: 0,
    successfulCategories: 0,
    failedCategories: 0,
    offersWithDetails: 0,
    offersWithImages: 0,
    offersWithFullAddress: 0,
    offersWithTermsArray: 0,
    duration: ((Date.now() - startTime) / 1000).toFixed(2)
  };

  results.forEach(r => {
    if (r.success) {
      stats.successfulCategories++;
      stats.totalOffers += r.offers.length;
      r.offers.forEach(offer => {
        allOffers.push(offer);
        if (offer.has_detail_data) stats.offersWithDetails++;
        if (offer.images.primary_image) stats.offersWithImages++;
        if (offer.merchant.full_address) stats.offersWithFullAddress++;
        if (offer.offer.terms_array.length > 0) stats.offersWithTermsArray++;
      });
    } else {
      stats.failedCategories++;
    }
  });

  return { results, allOffers, stats };
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║   Sampath Scraper v6.0 - Enhanced Data Extraction ║');
  console.log('║   ✓ Detail page scraping for full addresses       ║');
  console.log('║   ✓ Image URL extraction                          ║');
  console.log('║   ✓ Structured info boxes (Partner, Location)     ║');
  console.log('║   ✓ Numbered terms & conditions array             ║');
  console.log('║   ✓ Source URL tracking                           ║');
  console.log('║   + All v5 features (API, periods, unique IDs)    ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  const args = process.argv.slice(2);

  if (args.includes('--no-cache')) {
    CONFIG.useCache = false;
    console.log('⚠️  Cache disabled\n');
  }

  if (args.includes('--skip-details')) {
    CONFIG.fetchDetails = false;
    console.log('⚠️  Detail page fetching disabled\n');
  }

  let categoriesToScrape = SAMPATH_CATEGORIES;
  const categoryArg = args.find(a => a.startsWith('--category='));
  if (categoryArg) {
    const name = categoryArg.split('=')[1];
    categoriesToScrape = SAMPATH_CATEGORIES.filter(c =>
      c.name.toLowerCase().includes(name.toLowerCase()) ||
      c.slug.toLowerCase().includes(name.toLowerCase())
    );
    if (categoriesToScrape.length === 0) {
      console.log(`❌ Category "${name}" not found`);
      return;
    }
  }

  const { results, allOffers, stats } = await scrapeAll(categoriesToScrape);

  // Save output
  const outputDir = './output';
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  console.log('\n📁 Saving output...');

  // Per-category files
  results.forEach(r => {
    if (r.success && r.offers.length > 0) {
      const filename = `${r.category.toLowerCase().replace(/\s+/g, '_')}_v6.json`;
      fs.writeFileSync(
        path.join(outputDir, filename),
        JSON.stringify({
          category: r.category,
          totalOffers: r.offers.length,
          processedAt: new Date().toISOString(),
          offers: r.offers.map(o => o.toJSON())
        }, null, 2)
      );
      console.log(`  ✓ ${filename}`);
    }
  });

  // All offers combined
  fs.writeFileSync(
    path.join(outputDir, 'sampath_all_v6.json'),
    JSON.stringify({
      processedAt: new Date().toISOString(),
      stats,
      offers: allOffers.map(o => o.toJSON())
    }, null, 2)
  );
  console.log(`  ✓ sampath_all_v6.json`);

  // Summary
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║                 SUMMARY REPORT                     ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  results.forEach(r => {
    if (r.success) {
      console.log(`  ✅ ${r.category.padEnd(20)}: ${r.offers.length.toString().padStart(4)} offers`);
    } else {
      console.log(`  ❌ ${r.category.padEnd(20)}: Failed`);
    }
  });

  console.log('\n' + '─'.repeat(60));
  console.log(`  Total offers              : ${stats.totalOffers}`);
  console.log(`  ── NEW v6 Enhancements ──`);
  console.log(`     Offers with detail data: ${stats.offersWithDetails} (${(stats.offersWithDetails / stats.totalOffers * 100).toFixed(1)}%)`);
  console.log(`     Offers with images     : ${stats.offersWithImages} (${(stats.offersWithImages / stats.totalOffers * 100).toFixed(1)}%)`);
  console.log(`     Offers with full address: ${stats.offersWithFullAddress} (${(stats.offersWithFullAddress / stats.totalOffers * 100).toFixed(1)}%)`);
  console.log(`     Offers with terms array: ${stats.offersWithTermsArray} (${(stats.offersWithTermsArray / stats.totalOffers * 100).toFixed(1)}%)`);
  console.log(`  Time taken                : ${stats.duration}s`);
  console.log('─'.repeat(60));

  console.log('\n✨ v6 completed!');
  console.log(`\n📋 Usage:`);
  console.log(`   --category=<name>      Specific category`);
  console.log(`   --no-cache             Fresh downloads`);
  console.log(`   --skip-details         Skip detail page fetching (faster)\n`);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { SampathOffer, OfferValidity, PeriodParser, scrapeCategory, scrapeAll };
