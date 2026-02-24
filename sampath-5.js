/**
 * Sampath Bank Card Promotions Scraper v5.0
 * Direct JSON API consumer with structured validity parsing
 *
 * Features:
 * - All categories auto-discovered
 * - SampathOffer class with structured validity
 * - PeriodParser for date extraction
 * - OfferValidity (DB-ready schema)
 * - Unique SHA-256 IDs
 * - API response caching (24h)
 * - Blackout period extraction
 * - No geocoding
 *
 * Requires: npm install axios
 * Usage: node sampath-5.js [--no-cache] [--category=hotels]
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Configuration ──────────────────────────────────────────────────────────
const CONFIG = {
  baseApiUrl: 'https://www.sampath.lk/api/card-promotions',
  timeout: 15000,
  retries: 3,
  retryDelay: 1000,
  delayBetweenRequests: 500,
  cacheDir: './cache_sampath',
  cacheExpiry: 24 * 60 * 60 * 1000,
  useCache: true
};

// All Sampath API categories with offers
const SAMPATH_CATEGORIES = [
  { name: 'Hotels', slug: 'hotels' },
  { name: 'Dining', slug: 'dining' },
  { name: 'Online', slug: 'online' },
  { name: 'Fashion', slug: 'fashion' },
  { name: 'Supermarket', slug: 'super_market' }
];

// Create cache directory
if (!fs.existsSync(CONFIG.cacheDir)) {
  fs.mkdirSync(CONFIG.cacheDir, { recursive: true });
}

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
function getCachePath(key) {
  const hash = crypto.createHash('md5').update(key).digest('hex');
  return path.join(CONFIG.cacheDir, `${hash}.json`);
}

function loadFromCache(key) {
  if (!CONFIG.useCache) return null;
  const p = getCachePath(key);
  if (!fs.existsSync(p)) return null;
  const stats = fs.statSync(p);
  if (Date.now() - stats.mtime.getTime() > CONFIG.cacheExpiry) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8')).data;
}

function saveToCache(key, data) {
  fs.writeFileSync(getCachePath(key), JSON.stringify({ key, data, cachedAt: new Date().toISOString() }, null, 2));
}

// ─── Month map ──────────────────────────────────────────────────────────────
const MONTH_MAP = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
};
const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

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
}

// ─── PeriodParser ───────────────────────────────────────────────────────────
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
    // Cross-year fix
    if (date1 && date2 && date1 > date2) {
      const hasYear1 = /\b\d{4}\b/.test(part1);
      const hasYear2 = /\b\d{4}\b/.test(part2);
      if (!hasYear1 && hasYear2) {
        const prevYear = fallbackYear ? fallbackYear - 1 : new Date().getFullYear() - 1;
        date1 = PeriodParser.parseHumanDate(part1, prevYear);
      }
    }
    return { fromDate: date1, toDate: date2 };
  }

  /** Parse the clean date text from cards_new "Promotion Period" */
  static parseLine(line, fallbackYear) {
    const rawText = line;
    let text = line.replace(/\s+/g, ' ').trim();
    if (!text) return [];

    const year = PeriodParser.extractYear(text) || fallbackYear || new Date().getFullYear();

    // Normalize dashes
    text = text.replace(/[–—]/g, '-');

    // ── A: "Valid till [date]" / "Valid until [date]" ──────────────────────
    const tillMatch = text.match(/valid\s+(?:till|until)\s+(.+)/i);
    if (tillMatch) {
      const toDate = PeriodParser.parseHumanDate(tillMatch[1], year);
      return [new OfferValidity({ valid_to: toDate, raw_period_text: rawText })];
    }

    // ── B: "Valid from [date] to [date]" ──────────────────────────────────
    const fromToMatch = text.match(/valid\s+from\s+(.+?)\s+to\s+(.+)/i);
    if (fromToMatch) {
      const { fromDate, toDate } = PeriodParser.parseDateRangeParts(fromToMatch[1], fromToMatch[2], year);
      return [new OfferValidity({ valid_from: fromDate, valid_to: toDate, raw_period_text: rawText })];
    }

    // ── C: "[date] to [date]" (no prefix, common in cards_new) ────────────
    const rangeToMatch = text.match(/(.+?)\s+to\s+(.+)/i);
    if (rangeToMatch) {
      const { fromDate, toDate } = PeriodParser.parseDateRangeParts(rangeToMatch[1], rangeToMatch[2], year);
      if (fromDate && toDate) {
        return [new OfferValidity({ valid_from: fromDate, valid_to: toDate, raw_period_text: rawText })];
      }
    }

    // ── D: "[date] - [date]" dash range ───────────────────────────────────
    const rangeDashMatch = text.match(/(.+?)\s*-\s*(.+)/);
    if (rangeDashMatch) {
      const { fromDate, toDate } = PeriodParser.parseDateRangeParts(rangeDashMatch[1], rangeDashMatch[2], year);
      if (fromDate && toDate) {
        return [new OfferValidity({ valid_from: fromDate, valid_to: toDate, raw_period_text: rawText })];
      }
    }

    // ── E: Single date ────────────────────────────────────────────────────
    const singleDate = PeriodParser.parseHumanDate(text, year);
    if (singleDate) {
      return [new OfferValidity({ valid_to: singleDate, raw_period_text: rawText })];
    }

    // ── F: Unparseable ────────────────────────────────────────────────────
    return [new OfferValidity({ raw_period_text: rawText })];
  }

  /** Extract blackout info from promotion_details */
  static extractBlackouts(detailsText) {
    if (!detailsText) return { exclusion_days: null, blackout_periods: null, exclusion_notes: null };

    let exclusion_days = null;
    let blackout_periods = null;
    const notes = [];

    // "Blackout Days - Friday, Saturday & Long Weekends"
    const blackoutDaysMatch = detailsText.match(/blackout\s+days?\s*[-:–]\s*(.+?)(?:\.|$)/i);
    if (blackoutDaysMatch) {
      const dayText = blackoutDaysMatch[1].trim();
      const foundDays = [];
      DAY_NAMES.forEach(d => {
        if (dayText.toLowerCase().includes(d)) foundDays.push(d);
      });
      if (foundDays.length > 0) exclusion_days = foundDays.join(',');
      if (dayText.toLowerCase().includes('long weekend')) {
        notes.push('Long weekends excluded');
      }
    }

    // "from 20th December 2025 to 1st January 2026 and from 10th April 2026 to 20th April 2026"
    const blackoutDateRe = /(?:not\s+valid|blackout).*?from\s+(.+?)\s+to\s+(.+?)(?:\s+and\s+from\s+(.+?)\s+to\s+(.+?))?(?:\.|$)/i;
    const bdMatch = detailsText.match(blackoutDateRe);
    if (bdMatch) {
      const periods = [];
      const year = PeriodParser.extractYear(detailsText) || new Date().getFullYear();
      const d1 = PeriodParser.parseHumanDate(bdMatch[1], year);
      const d2 = PeriodParser.parseHumanDate(bdMatch[2], year);
      if (d1 && d2) periods.push({ from: d1, to: d2 });
      if (bdMatch[3] && bdMatch[4]) {
        const d3 = PeriodParser.parseHumanDate(bdMatch[3], year);
        const d4 = PeriodParser.parseHumanDate(bdMatch[4], year);
        if (d3 && d4) periods.push({ from: d3, to: d4 });
      }
      if (periods.length > 0) blackout_periods = periods;
    }

    return { exclusion_days, blackout_periods, exclusion_notes: notes.length > 0 ? notes.join('; ') : null };
  }

  /** Parse promotion_details for period_type and booking/stay split */
  static parseDetails(detailsText, fallbackYear) {
    if (!detailsText) return { periods: [], periodType: 'offer' };

    // Pre-process: insert breaks before concatenated section headers ("2026Stay" → "2026 | Stay")
    const text = detailsText
      .replace(/[–—]/g, '-')
      .replace(/(\d{4})((?:Booking|Stay|Promotion|Blackout|Participating)\s*)/gi, '$1 | $2')
      .replace(/\s+/g, ' ')
      .trim();
    const year = PeriodParser.extractYear(text) || fallbackYear || new Date().getFullYear();
    const results = [];

    // Terminator: stop at next section header, note marker, or end
    const TERM = '(?=\\s*(?:\\||Booking|Stay|Promotion|Blackout|Participating|\\*)|$)';

    // Booking Period
    const bookingRe = new RegExp('booking\\s+period\\s*[-:]\\s*valid\\s+(?:from\\s+(.+?)\\s+to\\s+(.+?)' + TERM + '|(?:till|until)\\s+(.+?)' + TERM + ')', 'i');
    const bookingMatch = text.match(bookingRe);

    // Stay Period
    const stayRe = new RegExp('stay\\s+period\\s*[-:]\\s*valid\\s+(?:from\\s+(.+?)\\s+to\\s+(.+?)' + TERM + '|(?:till|until)\\s+(.+?)' + TERM + ')', 'i');
    const stayMatch = text.match(stayRe);

    if (bookingMatch) {
      if (bookingMatch[1] && bookingMatch[2]) {
        const { fromDate, toDate } = PeriodParser.parseDateRangeParts(bookingMatch[1].trim(), bookingMatch[2].trim(), year);
        results.push({ type: 'booking', from: fromDate, to: toDate });
      } else if (bookingMatch[3]) {
        results.push({ type: 'booking', from: null, to: PeriodParser.parseHumanDate(bookingMatch[3].trim(), year) });
      }
    }

    if (stayMatch) {
      if (stayMatch[1] && stayMatch[2]) {
        const { fromDate, toDate } = PeriodParser.parseDateRangeParts(stayMatch[1].trim(), stayMatch[2].trim(), year);
        results.push({ type: 'stay', from: fromDate, to: toDate });
      } else if (stayMatch[3]) {
        results.push({ type: 'stay', from: null, to: PeriodParser.parseHumanDate(stayMatch[3].trim(), year) });
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

  /**
   * Main parse entry point.
   * @param {string} cardPeriodText - clean text from cards_new "Promotion Period"
   * @param {string} detailsText - text from promotion_details (may have blackouts, period types)
   * @param {number|null} expireTs - expire_on timestamp in ms
   * @param {number|null} displayTs - display_on timestamp in ms
   */
  static parse(cardPeriodText, detailsText, expireTs, displayTs) {
    const rawText = cardPeriodText || detailsText || '';
    const year = PeriodParser.extractYear(rawText) || new Date().getFullYear();

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
      // Try to extract "Valid till/from" from details
      const detailClean = detailsText.replace(/^(?:promotion|booking)\s+period\s*[-:]\s*/i, '').trim();
      // Only parse if it looks like a date line, not just terms
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

// ─── SampathOffer ───────────────────────────────────────────────────────────
class SampathOffer {
  constructor(raw, category) {
    // Unique ID
    const hashInput = ['sampath', raw.company_name || '', raw.city || '', category || '', raw.short_discount || ''].join('|').toLowerCase().trim();
    const hash = crypto.createHash('sha256').update(hashInput).digest('hex');
    const slug = (raw.company_name || 'offer').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 20);
    this.unique_id = `sampath_${hash.substring(0, 12)}_${slug}`;

    this.source = 'Sampath';
    this.category = category;
    this.scraped_at = new Date().toISOString();

    // Merchant info
    this.merchantName = stripHtml(raw.company_name);
    this.city = raw.city || '';
    this.location = raw.location || '';
    this.contactNumber = this._extractContact(raw);
    this.imageUrl = raw.image_url || '';

    // Offer details
    this.discount = raw.short_discount || stripHtml(raw.discounts) || '';
    this.description = stripHtml(raw.description);
    this.shortDescription = stripHtml(raw.short_description);
    this.termsConditions = this._parseTerms(raw.terms_and_conditions);
    this.eligibleCards = this._extractCards(raw);

    // Validity source texts
    const cardPeriodText = this._getCardPeriod(raw);
    const detailsText = stripHtml(raw.promotion_details);
    this.validityRaw = cardPeriodText || detailsText || '';
    this.promotionDetails = detailsText;

    // Timestamps
    this.expireOn = raw.expire_on || null;
    this.displayOn = raw.display_on || null;

    // Parse validity periods
    this.validity_periods = PeriodParser.parse(cardPeriodText, detailsText, raw.expire_on, raw.display_on);

    // Raw API ID
    this.apiId = raw.id;
  }

  _getCardPeriod(raw) {
    if (!Array.isArray(raw.cards_new)) return '';
    const card = raw.cards_new.find(c => c.title === 'Promotion Period');
    return card ? stripHtml(card.description) : '';
  }

  _extractContact(raw) {
    if (Array.isArray(raw.cards_new)) {
      const resCard = raw.cards_new.find(c => c.title === 'Reservation Numbers');
      if (resCard) return stripHtml(resCard.description);
    }
    return raw.contact_no || '';
  }

  _extractCards(raw) {
    if (!Array.isArray(raw.cards_new)) return [];
    const card = raw.cards_new.find(c => c.title === 'Eligible Card Categories');
    return card ? [stripHtml(card.description)] : [];
  }

  _parseTerms(termsHtml) {
    if (!termsHtml) return [];
    return termsHtml.split(/<br\s*\/?>/gi)
      .map(l => stripHtml(l))
      .filter(l => l && l.length > 5);
  }

  toJSON() {
    return {
      unique_id: this.unique_id,
      source: this.source,
      category: this.category,
      scraped_at: this.scraped_at,
      merchant_name: this.merchantName,
      city: this.city,
      location: this.location,
      contact_number: this.contactNumber,
      image_url: this.imageUrl,
      discount: this.discount,
      description: this.description,
      short_description: this.shortDescription,
      eligible_cards: this.eligibleCards,
      terms_conditions: this.termsConditions,
      validity_raw: this.validityRaw,
      promotion_details: this.promotionDetails,
      expire_on: this.expireOn,
      display_on: this.displayOn,
      validity_periods: this.validity_periods,
      api_id: this.apiId
    };
  }
}

// ─── API Fetching ───────────────────────────────────────────────────────────
async function fetchCategory(category, retryCount = 0) {
  const cacheKey = `sampath_api_${category}`;
  const cached = loadFromCache(cacheKey);
  if (cached) {
    console.log(`  ✓ ${category}: ${cached.length} offers (from cache)`);
    return { data: cached, fromCache: true };
  }

  const url = `${CONFIG.baseApiUrl}?category=${category}`;
  try {
    console.log(`  Fetching: ${category}`);
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      },
      timeout: CONFIG.timeout
    });

    const data = response.data?.data || [];
    console.log(`  ✓ ${category}: ${data.length} offers (live)`);
    saveToCache(cacheKey, data);
    return { data, fromCache: false };

  } catch (error) {
    if (retryCount < CONFIG.retries) {
      const delay = CONFIG.retryDelay * (retryCount + 1);
      console.log(`  🔄 Retry in ${delay}ms (${retryCount + 1}/${CONFIG.retries})`);
      await sleep(delay);
      return fetchCategory(category, retryCount + 1);
    }
    console.error(`  ❌ ${category}: ${error.message}`);
    return { data: [], fromCache: false };
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║   Sampath Bank Offers Scraper v5.0             ║');
  console.log('║   ✓ All categories (auto-discovered)          ║');
  console.log('║   ✓ Structured validity (DB-ready)            ║');
  console.log('║   ✓ PeriodParser + OfferValidity              ║');
  console.log('║   ✓ API response caching                      ║');
  console.log('║   ✓ Unique IDs (SHA-256)                      ║');
  console.log('╚════════════════════════════════════════════════╝');

  const args = process.argv.slice(2);

  if (args.includes('--no-cache')) {
    CONFIG.useCache = false;
    console.log('Cache disabled\n');
  }

  let categoriesToScrape = SAMPATH_CATEGORIES;
  const categoryArg = args.find(a => a.startsWith('--category='));
  if (categoryArg) {
    const slug = categoryArg.split('=')[1];
    categoriesToScrape = SAMPATH_CATEGORIES.filter(c => c.slug === slug);
    if (categoriesToScrape.length === 0) categoriesToScrape = [{ name: slug, slug }];
  }

  console.log(`\nScraping ${categoriesToScrape.length} categories...\n`);

  const startTime = Date.now();
  const allOffers = [];
  const categorySummary = {};
  const outputDir = './output';
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  for (const cat of categoriesToScrape) {
    const { data: rawOffers, fromCache } = await fetchCategory(cat.slug);

    const offers = rawOffers.map(raw => new SampathOffer(raw, cat.name));
    allOffers.push(...offers);
    categorySummary[cat.name] = offers.length;

    // Save per-category file
    if (offers.length > 0) {
      fs.writeFileSync(
        path.join(outputDir, `sampath_${cat.slug}_v5.json`),
        JSON.stringify({ category: cat.name, count: offers.length, offers: offers.map(o => o.toJSON()) }, null, 2)
      );
    }

    if (!fromCache && categoriesToScrape.indexOf(cat) < categoriesToScrape.length - 1) {
      await sleep(CONFIG.delayBetweenRequests);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  // ─── Build validity rows ──────────────────────────────────────────────
  const validityRows = [];
  const issues = [];

  allOffers.forEach(offer => {
    const json = offer.toJSON();
    offer.validity_periods.forEach((vp, idx) => {
      validityRows.push({
        offer_id: json.unique_id,
        merchant_name: json.merchant_name,
        category: json.category,
        period_index: idx,
        ...vp
      });

      // Audit: check for date issues
      const today = new Date().toISOString().split('T')[0];
      if (vp.valid_to && vp.valid_to < today) {
        issues.push({ offer_id: json.unique_id, merchant: json.merchant_name, issue: 'DATE_EXPIRED', detail: `valid_to ${vp.valid_to} is in the past` });
      }
      if (vp.valid_from && vp.valid_to && vp.valid_from > vp.valid_to) {
        issues.push({ offer_id: json.unique_id, merchant: json.merchant_name, issue: 'DATE_MISMATCH', detail: `valid_from ${vp.valid_from} > valid_to ${vp.valid_to}` });
      }
      if (!vp.valid_to && !vp.valid_from && vp.raw_period_text && vp.raw_period_text !== '(none)' && !vp.raw_period_text.startsWith('(from timestamp')) {
        issues.push({ offer_id: json.unique_id, merchant: json.merchant_name, issue: 'PARSE_FAIL', detail: `Could not parse: "${vp.raw_period_text.substring(0, 80)}"` });
      }
    });
  });

  // ─── Save output files ────────────────────────────────────────────────
  const allJson = {
    metadata: {
      source: 'Sampath',
      scraped_at: new Date().toISOString(),
      total_offers: allOffers.length,
      total_validity_rows: validityRows.length,
      categories: categorySummary,
      duration: `${duration}s`,
      issues_count: issues.length
    },
    offers: allOffers.map(o => o.toJSON())
  };

  fs.writeFileSync(path.join(outputDir, 'sampath_all_v5.json'), JSON.stringify(allJson, null, 2));
  fs.writeFileSync(path.join(outputDir, 'sampath_validity_rows_v5.json'), JSON.stringify(validityRows, null, 2));
  fs.writeFileSync(path.join(outputDir, 'sampath_raw_v5.json'), JSON.stringify(allOffers.map(o => o.toJSON()), null, 2));

  // ─── Summary ──────────────────────────────────────────────────────────
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║              SUMMARY REPORT                    ║');
  console.log('╚════════════════════════════════════════════════╝\n');

  Object.entries(categorySummary).forEach(([name, count]) => {
    console.log(`  ${name.padEnd(20)} : ${count} offers`);
  });
  console.log(`  ${'─'.repeat(40)}`);
  console.log(`  ${'Total'.padEnd(20)} : ${allOffers.length} offers`);
  console.log(`  ${'Validity rows'.padEnd(20)} : ${validityRows.length}`);
  console.log(`  ${'Time'.padEnd(20)} : ${duration}s`);

  // Period type breakdown
  const typeCounts = {};
  validityRows.forEach(r => {
    typeCounts[r.period_type] = (typeCounts[r.period_type] || 0) + 1;
  });
  console.log('\n  Period types:');
  Object.entries(typeCounts).forEach(([t, c]) => console.log(`    ${t.padEnd(15)} : ${c}`));

  // Blackout summary
  const withBlackouts = validityRows.filter(r => r.exclusion_days || r.blackout_periods);
  if (withBlackouts.length > 0) {
    console.log(`\n  With blackout info: ${withBlackouts.length} rows`);
  }

  // Issues
  if (issues.length > 0) {
    console.log(`\n  ⚠️  Issues (${issues.length}):`);
    issues.forEach(i => console.log(`    ${i.issue.padEnd(15)} ${i.merchant.padEnd(35).substring(0, 35)} ${i.detail}`));
  } else {
    console.log('\n  ✅ No issues found');
  }

  console.log(`\n  Output files:`);
  console.log(`    sampath_all_v5.json`);
  console.log(`    sampath_validity_rows_v5.json`);
  console.log(`    sampath_raw_v5.json`);
  console.log(`    + per-category files`);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { SampathOffer, PeriodParser, OfferValidity, fetchCategory };
