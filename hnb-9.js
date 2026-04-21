/**
 * HNB Bank Offers Scraper v6.0 - Enhanced Data Extraction
 *
 * NEW in v6:
 * - Merchant logo/image URL extraction from assets.hnb.lk
 * - Structured installment plan parsing (months, interest rate)
 * - Transaction amount range extraction (min/max)
 * - Detailed card eligibility/restrictions parsing
 * - Enhanced terms and conditions extraction
 * - Source URL tracking
 * - Image metadata (dimensions, alt text)
 *
 * Inherits from v5:
 * - HNBOffer class with structured validity periods
 * - PeriodParser for date/recurrence handling
 * - Multi-period support (booking/stay/travel/installment)
 * - Unique IDs, caching, optional geocoding
 *
 * Requires: npm install axios cheerio
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');
const { normalizeValidity } = require('./lib/period-normalize');
const PeriodEngine = require('./lib/period-engine');
const AddressEngine = require('./lib/address-engine');

// ─── Configuration ───────────────────────────────────────────────────────────

const CONFIG = {
  maxRetries: 3,
  retryDelay: 2000,
  timeout: 15000,
  maxConcurrent: 5,
  cacheDir: './cache_hnb',
  geoCacheDir: './cache_hnb/geocode',
  imageCacheDir: './cache_hnb/images',
  cacheExpiry: 24 * 60 * 60 * 1000,
  useCache: true,
  googleApiKey: '',
  enableGeocoding: false,
  geocodeConcurrent: 5,
  downloadImages: false // Set to true to download merchant logos locally
};

const CATEGORIES = [
  { id: 1, name: 'Hotel', url: 'https://venus.hnb.lk/api/get_all_web_card_promos?cat=1&page={page}&cardType=all' },
  { id: 2, name: 'Travel', url: 'https://venus.hnb.lk/api/get_all_web_card_promos?cat=2&page={page}&cardType=all' },
  { id: 3, name: 'Dining', url: 'https://venus.hnb.lk/api/get_all_web_card_promos?cat=3&page={page}&cardType=all' },
  { id: 4, name: 'Shopping', url: 'https://venus.hnb.lk/api/get_all_web_card_promos?cat=4&page={page}&cardType=all' },
  { id: 5, name: 'Lifestyle', url: 'https://venus.hnb.lk/api/get_all_web_card_promos?cat=5&page={page}&cardType=all' },
  { id: 6, name: 'Online', url: 'https://venus.hnb.lk/api/get_all_web_card_promos?cat=6&page={page}&cardType=all' },
  { id: 7, name: 'Autocare', url: 'https://venus.hnb.lk/api/get_all_web_card_promos?cat=7&page={page}&cardType=all' },
  { id: 8, name: 'Other', url: 'https://venus.hnb.lk/api/get_all_web_card_promos?cat=8&page={page}&cardType=all' },
  { id: 9, name: 'Fashion', url: 'https://venus.hnb.lk/api/get_all_web_card_promos?cat=9&page={page}&cardType=all' },
  { id: 10, name: 'Hospitals', url: 'https://venus.hnb.lk/api/get_all_web_card_promos?cat=10&page={page}&cardType=all' },
  { id: 11, name: 'Jewellery', url: 'https://venus.hnb.lk/api/get_all_web_card_promos?cat=11&page={page}&cardType=all' },
  { id: 12, name: 'Education', url: 'https://venus.hnb.lk/api/get_all_web_card_promos?cat=12&page={page}&cardType=all' },
  { id: 13, name: 'Solar Solutions', url: 'https://venus.hnb.lk/api/get_all_web_card_promos?cat=13&page={page}&cardType=all' }
];

// Create cache directories
[CONFIG.cacheDir, CONFIG.geoCacheDir, CONFIG.imageCacheDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── Caching Layer ───────────────────────────────────────────────────────────

function getCacheKey(url) {
  return crypto.createHash('md5').update(url).digest('hex');
}

function getCachePath(url) {
  return path.join(CONFIG.cacheDir, `${getCacheKey(url)}.json`);
}

function isCacheValid(cachePath) {
  if (!fs.existsSync(cachePath)) return false;
  return Date.now() - fs.statSync(cachePath).mtime.getTime() < CONFIG.cacheExpiry;
}

function saveToCache(url, data) {
  fs.writeFileSync(getCachePath(url), JSON.stringify({
    url, cachedAt: new Date().toISOString(), data
  }, null, 2));
}

function loadFromCache(url) {
  if (!CONFIG.useCache) return null;
  const cachePath = getCachePath(url);
  if (isCacheValid(cachePath)) {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8')).data;
  }
  return null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Network Layer ───────────────────────────────────────────────────────────

async function fetchJSON(url, retryCount = 0) {
  const cachedData = loadFromCache(url);
  if (cachedData) return { data: cachedData, fromCache: true };

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      },
      timeout: CONFIG.timeout
    });
    saveToCache(url, response.data);
    return { data: response.data, fromCache: false };
  } catch (error) {
    if (retryCount < CONFIG.maxRetries) {
      await sleep(CONFIG.retryDelay * (retryCount + 1));
      return fetchJSON(url, retryCount + 1);
    }
    throw error;
  }
}

async function fetchAllParallel(urls, label = 'items') {
  const results = [];
  let completed = 0;

  for (let i = 0; i < urls.length; i += CONFIG.maxConcurrent) {
    const batch = urls.slice(i, i + CONFIG.maxConcurrent);
    const batchResults = await Promise.all(
      batch.map(async (url) => {
        try {
          const { data } = await fetchJSON(url);
          return { success: true, data, url };
        } catch (error) {
          return { success: false, error: error.message, url };
        }
      })
    );
    results.push(...batchResults);
    completed += batch.length;
    process.stdout.write(`\r  📊 ${label}: ${completed}/${urls.length}`);
  }
  console.log('');
  return results;
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generate stable unique ID for an offer
 * Uses only source_id from bank's website (stable across scrapes)
 * Format: hnb_{sourceId}
 */
function generateContentHash(offer) {
  const content = [
    offer.title,
    offer.merchant?.name,
    offer.discount,
    offer.validity_raw,
    offer.installment_raw,
    offer.range_raw,
    offer.eligibility_raw,
    offer.category
  ].filter(Boolean).join("|");
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(content).digest("hex");
}

function normalizeMerchantNameSL(name) {
  if (!name) return "";
  return name.trim()
    .replace(/\s+/g, " ")
    .replace(/Jewellers/i, "Jeweller")
    .replace(/Restaurant/i, "")
    .replace(/Pvt Ltd/i, "")
    .replace(/PLC/i, "")
    .trim();
}
function generateUniqueOfferId(sourceId) {
  return `hnb_${sourceId}`;
}

// ─── Image Extraction (NEW in v6) ────────────────────────────────────────────

/**
 * Extract all image URLs from HTML content
 * Prioritizes merchant logos from assets.hnb.lk
 */
function extractImages(htmlContent, sourceId) {
  if (!htmlContent) return { logo: null, images: [] };

  const $ = cheerio.load(htmlContent);
  const images = [];
  const imageData = { logo: null, images: [], gallery: [] };

  // Find merchant logo (typically in header or with specific class)
  $('img').each((i, elem) => {
    const src = $(elem).attr('src');
    const alt = $(elem).attr('alt') || '';
    const className = $(elem).attr('class') || '';

    if (!src) return;

    // Normalize URL
    let fullUrl = src;
    if (src.startsWith('//')) fullUrl = 'https:' + src;
    else if (src.startsWith('/')) fullUrl = 'https://assets.hnb.lk' + src;
    else if (!src.startsWith('http')) fullUrl = 'https://assets.hnb.lk/' + src;

    const imageObj = {
      url: fullUrl,
      alt: alt.trim(),
      type: 'unknown'
    };

    // Identify logo vs gallery images
    if (alt.toLowerCase().includes('logo') ||
        className.includes('logo') ||
        fullUrl.includes('logo') ||
        fullUrl.includes('/merchants/')) {
      imageObj.type = 'logo';
      if (!imageData.logo) imageData.logo = imageObj;
    } else if (fullUrl.includes('assets.hnb.lk')) {
      imageObj.type = 'gallery';
      imageData.gallery.push(imageObj);
    }

    images.push(imageObj);
  });

  imageData.images = images;
  return imageData;
}

/**
 * Download image to local cache (optional)
 */
async function downloadImage(url, offerId) {
  if (!CONFIG.downloadImages) return null;

  try {
    const ext = url.split('.').pop().split('?')[0] || 'jpg';
    const filename = `${offerId}_${getCacheKey(url)}.${ext}`;
    const filepath = path.join(CONFIG.imageCacheDir, filename);

    if (fs.existsSync(filepath)) return filepath;

    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    fs.writeFileSync(filepath, response.data);
    return filepath;
  } catch (error) {
    return null;
  }
}

// ─── Installment Plan Parser (NEW in v6) ────────────────────────────────────

/**
 * Parse installment plan information from text
 * Examples:
 * - "0% + 3, 6 & 12 months installment plans"
 * - "Up to 12 months 0% installments"
 * - "6 months interest-free installments"
 */
function parseInstallmentPlans(text) {
  const plans = [];

  if (!text || !/installment|instalment/i.test(text)) return plans;

  // "0% + 3, 6 & 12 months"
  const listMatch = text.match(/(\d+(?:\.\d+)?)\s*%.*?(\d+(?:\s*,\s*\d+)*(?:\s*&\s*\d+)?)\s*months?/i);
  if (listMatch) {
    const interestRate = parseFloat(listMatch[1]);
    const months = listMatch[2].replace(/&/g, ',').split(',').map(m => parseInt(m.trim(), 10));
    months.forEach(m => {
      if (m > 0) plans.push({ months: m, interest_rate: interestRate, type: 'installment' });
    });
  }

  // "Up to 12 months 0% installments"
  if (plans.length === 0) {
    const upToMatch = text.match(/up\s+to\s+(\d+)\s*months?\s*(\d+(?:\.\d+)?)\s*%/i);
    if (upToMatch) {
      const maxMonths = parseInt(upToMatch[1], 10);
      const interestRate = parseFloat(upToMatch[2]);
      // Generate common plans up to max
      [3, 6, 12, 18, 24].filter(m => m <= maxMonths).forEach(m => {
        plans.push({ months: m, interest_rate: interestRate, type: 'installment' });
      });
    }
  }

  // "6 months interest-free"
  if (plans.length === 0) {
    const freeMatch = text.match(/(\d+)\s*months?\s*(?:interest[- ]free|0%)/i);
    if (freeMatch) {
      plans.push({ months: parseInt(freeMatch[1], 10), interest_rate: 0, type: 'installment' });
    }
  }

  return plans;
}

// ─── Transaction Amount Parser (NEW in v6) ──────────────────────────────────

/**
 * Extract minimum and maximum transaction amounts
 * Examples:
 * - "Rs.10,000 to Rs.1 million"
 * - "Minimum spend Rs. 5,000"
 * - "Up to Rs. 500,000"
 */
function parseTransactionRange(text) {
  const range = { min: null, max: null, currency: 'LKR' };

  if (!text) return range;

  // "Rs.10,000 to Rs.1 million" or "Rs. 10,000 to Rs. 1,000,000"
  const rangeMatch = text.match(/Rs\.?\s*([\d,]+(?:\.\d+)?)\s*(?:to|[-–])\s*Rs\.?\s*([\d,]+(?:\.\d+)?(?:\s*million)?)/i);
  if (rangeMatch) {
    range.min = parseAmount(rangeMatch[1]);
    range.max = parseAmount(rangeMatch[2]);
  }

  // "Minimum spend Rs. 5,000"
  if (!range.min) {
    const minMatch = text.match(/minimum\s+(?:spend|transaction|purchase)?\s*:?\s*Rs\.?\s*([\d,]+(?:\.\d+)?)/i);
    if (minMatch) range.min = parseAmount(minMatch[1]);
  }

  // "Up to Rs. 500,000"
  if (!range.max) {
    const maxMatch = text.match(/up\s+to\s+Rs\.?\s*([\d,]+(?:\.\d+)?(?:\s*million)?)/i);
    if (maxMatch) range.max = parseAmount(maxMatch[1]);
  }

  return range;
}

function parseAmount(str) {
  if (!str) return null;

  // Handle "1 million", "1.5 million" etc
  const millionMatch = str.match(/([\d.]+)\s*million/i);
  if (millionMatch) return parseFloat(millionMatch[1]) * 1000000;

  // Remove commas and parse
  return parseFloat(str.replace(/,/g, ''));
}

// ─── Card Eligibility Parser (NEW in v6) ────────────────────────────────────

/**
 * Parse detailed card eligibility and restrictions
 * Examples:
 * - "All HNB Credit Cards (except Corporate, Business & Fuel cards)"
 * - "HNB Visa Credit Cards only"
 * - "Debit and Credit Cards"
 */
function parseCardEligibility(text) {
  const eligibility = {
    included_cards: [],
    excluded_cards: [],
    card_types: [],
    networks: [],
    restrictions: []
  };

  if (!text) return eligibility;

  const lower = text.toLowerCase();

  // Card types
  if (/credit\s+card/i.test(text)) eligibility.card_types.push('Credit Card');
  if (/debit\s+card/i.test(text)) eligibility.card_types.push('Debit Card');
  if (/prepaid\s+card/i.test(text)) eligibility.card_types.push('Prepaid Card');

  // Networks
  if (/\bvisa\b/i.test(text)) eligibility.networks.push('Visa');
  if (/\bmastercard\b/i.test(text)) eligibility.networks.push('Mastercard');
  if (/\bamex\b|american\s+express/i.test(text)) eligibility.networks.push('American Express');
  if (/\bunionpay\b/i.test(text)) eligibility.networks.push('UnionPay');

  // Exclusions
  const exceptMatch = text.match(/\(except\s+([^)]+)\)/i);
  if (exceptMatch) {
    const excluded = exceptMatch[1].split(/,|&/).map(c => c.trim());
    eligibility.excluded_cards = excluded;
    eligibility.restrictions.push(`Except: ${exceptMatch[1].trim()}`);
  }

  // "only" restrictions
  const onlyMatch = text.match(/(\w+(?:\s+\w+)*)\s+(?:cards?\s+)?only/i);
  if (onlyMatch) {
    eligibility.restrictions.push(`Only: ${onlyMatch[1].trim()}`);
  }

  // All cards detection
  if (/all\s+hnb/i.test(text) && !exceptMatch) {
    eligibility.included_cards.push('All HNB Cards');
  }

  return eligibility;
}

// ─── PeriodParser (from v5, unchanged) ──────────────────────────────────────

const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
};

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

class PeriodParser {
  static parseHumanDate(text, fallbackYear = null) {
    if (!text) return null;
    const cleaned = text.replace(/\s+/g, ' ').trim();

    const m = cleaned.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?/i);
    if (!m) return null;

    const day = parseInt(m[1], 10);
    const month = MONTHS[m[2].toLowerCase()];
    const year = m[3] ? parseInt(m[3], 10) : (fallbackYear || new Date().getFullYear());

    if (month === undefined || day < 1 || day > 31) return null;

    const d = new Date(year, month, day);
    if (d.getMonth() !== month) return null;

    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  static extractYear(text) {
    const m = text.match(/\b(20\d{2})\b/);
    return m ? parseInt(m[1], 10) : null;
  }

  static normalizeWeekday(word) {
    const w = word.toLowerCase().trim();
    const fuzzyMap = [
      { canonical: 'monday', patterns: ['monday', 'mondy', 'monady', 'mnday'] },
      { canonical: 'tuesday', patterns: ['tuesday', 'tuesdy', 'tusday', 'tuseday'] },
      { canonical: 'wednesday', patterns: ['wednesday', 'wenesday', 'wednseday', 'wednsday'] },
      { canonical: 'thursday', patterns: ['thursday', 'thrusday', 'thursdy', 'thurday'] },
      { canonical: 'friday', patterns: ['friday', 'friady', 'firday', 'fridy'] },
      { canonical: 'saturday', patterns: ['saturday', 'satruday', 'saturdy', 'satuday'] },
      { canonical: 'sunday', patterns: ['sunday', 'sundy', 'sunady', 'snday'] }
    ];
    for (const entry of fuzzyMap) {
      if (entry.patterns.includes(w)) return entry.canonical;
    }
    for (const entry of fuzzyMap) {
      if (w.length >= 3 && entry.canonical.startsWith(w.substring(0, 3))) return entry.canonical;
    }
    return null;
  }

  static extractRecurrenceDays(text) {
    const days = [];
    const withoutExclusions = text.replace(/\(?\s*exclude\s+(?:on\s+)?[^)]*\)?/gi, '')
      .replace(/\(?\s*blackout\s+[^)]*\)?/gi, '');
    const lower = withoutExclusions.toLowerCase();

    const everyMatch = lower.match(/every\s+(\w+)/g);
    if (everyMatch) {
      everyMatch.forEach(m => {
        const wordMatch = m.match(/every\s+(\w+)/);
        if (wordMatch) {
          const normalized = PeriodParser.normalizeWeekday(wordMatch[1]);
          if (normalized) days.push(normalized);
        }
      });
    }

    if (/weekday/i.test(lower)) {
      days.push('monday', 'tuesday', 'wednesday', 'thursday', 'friday');
    }

    if (/weekend/i.test(lower)) {
      days.push('saturday', 'sunday');
    }

    const rangeMatch = lower.match(/(\w+day\w*)\s+to\s+(\w+day\w*)/);
    if (rangeMatch && days.length === 0) {
      const startDay = PeriodParser.normalizeWeekday(rangeMatch[1]);
      const endDay = PeriodParser.normalizeWeekday(rangeMatch[2]);
      const startIdx = startDay ? DAY_NAMES.indexOf(startDay) : -1;
      const endIdx = endDay ? DAY_NAMES.indexOf(endDay) : -1;
      if (startIdx >= 0 && endIdx >= 0) {
        for (let i = startIdx; i !== (endIdx + 1) % 7; i = (i + 1) % 7) {
          days.push(DAY_NAMES[i]);
        }
      }
    }

    return [...new Set(days)];
  }

  static extractTimeRestriction(text) {
    const rangeMatch = text.match(/(\d{1,2})\s*(am|pm)\s+to\s+(\d{1,2})\s*(am|pm)/i);
    if (rangeMatch) {
      let fromH = parseInt(rangeMatch[1], 10);
      let toH = parseInt(rangeMatch[3], 10);
      if (rangeMatch[2].toLowerCase() === 'pm' && fromH !== 12) fromH += 12;
      if (rangeMatch[2].toLowerCase() === 'am' && fromH === 12) fromH = 0;
      if (rangeMatch[4].toLowerCase() === 'pm' && toH !== 12) toH += 12;
      if (rangeMatch[4].toLowerCase() === 'am' && toH === 12) toH = 0;
      return {
        time_from: `${String(fromH).padStart(2, '0')}:00`,
        time_to: `${String(toH).padStart(2, '0')}:00`
      };
    }

    const onwardsMatch = text.match(/from\s+(\d{1,2})\s*(am|pm)\s+onwards/i);
    if (onwardsMatch) {
      let fromH = parseInt(onwardsMatch[1], 10);
      if (onwardsMatch[2].toLowerCase() === 'pm' && fromH !== 12) fromH += 12;
      if (onwardsMatch[2].toLowerCase() === 'am' && fromH === 12) fromH = 0;
      return {
        time_from: `${String(fromH).padStart(2, '0')}:00`,
        time_to: null
      };
    }

    return null;
  }

  static extractExclusions(text) {
    const exclusions = {
      excluded_days: [],
      blackout_ranges: [],
      notes: []
    };

    const year = PeriodParser.extractYear(text);

    const excludeMatch = text.match(/exclude\s+(?:on\s+)?([^)]+)/i);
    if (excludeMatch) {
      const excludeText = excludeMatch[1].toLowerCase();
      DAY_NAMES.forEach(day => {
        if (excludeText.includes(day)) exclusions.excluded_days.push(day);
      });
      if (/long\s+weekend/i.test(excludeText)) {
        exclusions.notes.push('Excludes long weekends');
      }
    }

    const blackoutMatch = text.match(/blackout\s+(?:period)?:?\s*(\d{1,2})(?:st|nd|rd|th)?\s+to\s+(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?/i);
    if (blackoutMatch) {
      const bMonth = MONTHS[blackoutMatch[3].toLowerCase()];
      const bYear = blackoutMatch[4] ? parseInt(blackoutMatch[4], 10) : (year || new Date().getFullYear());
      exclusions.blackout_ranges.push({
        from: `${bYear}-${String(bMonth + 1).padStart(2, '0')}-${String(parseInt(blackoutMatch[1])).padStart(2, '0')}`,
        to: `${bYear}-${String(bMonth + 1).padStart(2, '0')}-${String(parseInt(blackoutMatch[2])).padStart(2, '0')}`
      });
    }

    const exceptMatch = text.match(/\(except\s+([^)]+)\)/i);
    if (exceptMatch) {
      exclusions.notes.push(`Except: ${exceptMatch[1].trim()}`);
    }

    return exclusions;
  }

  static extractMonthlyRange(text) {
    const m = text.match(/(\d{1,2})(?:st|nd|rd|th)?\s+to\s+(\d{1,2})(?:st|nd|rd|th)?\s+of\s+every\s+month/i);
    if (m) {
      return { from_day: parseInt(m[1], 10), to_day: parseInt(m[2], 10) };
    }
    return null;
  }

  static parseSpecificDates(text) {
    const year = PeriodParser.extractYear(text);
    const monthMatch = text.match(/(january|february|march|april|may|june|july|august|september|october|november|december)/i);
    if (!monthMatch) return [];

    const month = MONTHS[monthMatch[1].toLowerCase()];
    const yr = year || new Date().getFullYear();

    const beforeMonth = text.substring(0, text.toLowerCase().indexOf(monthMatch[1].toLowerCase()));
    const dayMatches = beforeMonth.match(/\d{1,2}/g);
    if (!dayMatches) return [];

    return dayMatches.map(d => {
      const day = parseInt(d, 10);
      return `${yr}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    });
  }

  static parseDateRange(text) {
    const year = PeriodParser.extractYear(text);
    const fallback = year || new Date().getFullYear();

    const fullRange = text.match(
      /(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?\s+to\s+(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?/i
    );
    if (fullRange) {
      const fromDate = PeriodParser.parseHumanDate(`${fullRange[1]} ${fullRange[2]} ${fullRange[3] || fallback}`, fallback);
      const toDate = PeriodParser.parseHumanDate(`${fullRange[4]} ${fullRange[5]} ${fullRange[6] || fallback}`, fallback);
      return { from: fromDate, to: toDate };
    }

    const sameMonth = text.match(
      /(\d{1,2})(?:st|nd|rd|th)?\s+to\s+(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?/i
    );
    if (sameMonth) {
      const fromDate = PeriodParser.parseHumanDate(`${sameMonth[1]} ${sameMonth[3]} ${sameMonth[4] || fallback}`, fallback);
      const toDate = PeriodParser.parseHumanDate(`${sameMonth[2]} ${sameMonth[3]} ${sameMonth[4] || fallback}`, fallback);
      return { from: fromDate, to: toDate };
    }

    const tillMatch = text.match(/till\s+(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?/i);
    if (tillMatch) {
      const toDate = PeriodParser.parseHumanDate(`${tillMatch[1]} ${tillMatch[2]} ${tillMatch[3] || fallback}`, fallback);
      return { from: null, to: toDate };
    }

    const singleDate = PeriodParser.parseHumanDate(text, fallback);
    if (singleDate) {
      return { from: singleDate, to: singleDate };
    }

    return null;
  }

  static splitSubPeriods(periodText) {
    const subPeriods = [];

    const labels = [
      { pattern: /\b(?:offer\s+period|offer\s+Period)\s*:\s*/gi, type: 'offer' },
      { pattern: /\b(?:booking\s+period|book(?:ing)?)\s*:\s*/gi, type: 'booking' },
      { pattern: /\b(?:stay(?:ing)?\s+period)\s*:\s*/gi, type: 'stay' },
      { pattern: /\b(?:travel(?:l?ing)?\s+period)\s*:\s*/gi, type: 'travel' },
      { pattern: /\b(?:installment\s+period|instalment\s+period)\s*:\s*/gi, type: 'installment' },
      { pattern: /\b(?:reserv(?:e|ation)\s+period)\s*:\s*/gi, type: 'reservation' },
      { pattern: /\b(?:event\s+period)\s*:\s*/gi, type: 'event' }
    ];

    const markers = [];
    for (const label of labels) {
      let match;
      label.pattern.lastIndex = 0;
      while ((match = label.pattern.exec(periodText)) !== null) {
        markers.push({ type: label.type, index: match.index, length: match[0].length });
      }
    }

    if (markers.length === 0) {
      return [{ type: 'offer', text: periodText.trim() }];
    }

    markers.sort((a, b) => a.index - b.index);

    for (let i = 0; i < markers.length; i++) {
      const start = markers[i].index + markers[i].length;
      const end = i + 1 < markers.length ? markers[i + 1].index : periodText.length;
      const text = periodText.substring(start, end).trim();
      if (text.length > 0) {
        subPeriods.push({ type: markers[i].type, text });
      }
    }

    if (markers[0].index > 0) {
      const beforeText = periodText.substring(0, markers[0].index).trim();
      if (beforeText.length > 2) {
        subPeriods.unshift({ type: 'offer', text: beforeText });
      }
    }

    return subPeriods;
  }

  static parse(periodText, apiFrom, apiTo) {
    const validities = [];
    const today = new Date().toISOString().split('T')[0];

    if (!periodText || periodText.trim().length === 0) {
      let fromDate = (apiFrom && apiFrom.length >= 10) ? apiFrom : today;
      const toDate = (apiTo && apiTo.length >= 10) ? apiTo : null;
      if (fromDate && toDate && fromDate > toDate) fromDate = toDate;
      validities.push(new OfferValidity({
        valid_from: fromDate,
        valid_to: toDate,
        period_type: 'offer',
        recurrence_type: 'daily',
        raw_period_text: ''
      }));
      return validities;
    }

    const engine = PeriodEngine.parse(periodText, { defaultPeriodType: 'offer', today });
    if (engine.length > 0) {
      return engine.map(p => new OfferValidity(p));
    }

    const cleaned = periodText.trim();

    const beforeMonth = cleaned.match(/([\d\s,stndrdth]+)(january|february|march|april|may|june|july|august|september|october|november|december)/i);
    const hasCommaDateList = beforeMonth && /\d{1,2}(?:st|nd|rd|th)?\s*,\s*\d{1,2}(?:st|nd|rd|th)?/.test(beforeMonth[1]);
    if (hasCommaDateList) {
      const specificDates = PeriodParser.parseSpecificDates(cleaned);
      if (specificDates.length > 0) {
        validities.push(new OfferValidity({
          valid_from: specificDates[0],
          valid_to: specificDates[specificDates.length - 1],
          period_type: 'offer',
          recurrence_type: 'specific_dates',
          recurrence_days: specificDates.join(','),
          raw_period_text: cleaned
        }));
        return validities;
      }
    }

    const ampDates = cleaned.match(/^(\d{1,2})(?:st|nd|rd|th)?\s*&\s*(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?/i);
    const hasDateRangeTo = /\d{1,2}(?:st|nd|rd|th)?\s+(?:january|february|march|april|may|june|july|august|september|october|november|december).*?\bto\b.*?(?:january|february|march|april|may|june|july|august|september|october|november|december)/i.test(cleaned)
      || /\d{1,2}(?:st|nd|rd|th)?\s+to\s+\d{1,2}(?:st|nd|rd|th)?\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)/i.test(cleaned);
    if (ampDates && !hasDateRangeTo) {
      const year = ampDates[4] ? parseInt(ampDates[4], 10) : PeriodParser.extractYear(cleaned) || new Date().getFullYear();
      const d1 = PeriodParser.parseHumanDate(`${ampDates[1]} ${ampDates[3]} ${year}`, year);
      const d2 = PeriodParser.parseHumanDate(`${ampDates[2]} ${ampDates[3]} ${year}`, year);
      if (d1 && d2) {
        validities.push(new OfferValidity({
          valid_from: d1,
          valid_to: d2,
          period_type: 'offer',
          recurrence_type: 'specific_dates',
          recurrence_days: [d1, d2].join(','),
          raw_period_text: cleaned
        }));
        return validities;
      }
    }

    const subPeriods = PeriodParser.splitSubPeriods(cleaned);

    for (const sub of subPeriods) {
      const range = PeriodParser.parseDateRange(sub.text);
      const recurrenceDays = PeriodParser.extractRecurrenceDays(sub.text);
      const timeRestriction = PeriodParser.extractTimeRestriction(sub.text);
      const exclusions = PeriodParser.extractExclusions(sub.text);
      const monthlyRange = PeriodParser.extractMonthlyRange(sub.text);

      let recurrenceType = 'daily';
      let recurrenceDaysStr = null;

      if (monthlyRange) {
        recurrenceType = 'monthly_range';
        recurrenceDaysStr = `${monthlyRange.from_day}-${monthlyRange.to_day}`;
      } else if (recurrenceDays.length > 0) {
        recurrenceType = 'specific_weekdays';
        recurrenceDaysStr = recurrenceDays.join(',');
      }

      const excludedDaysStr = exclusions.excluded_days.length > 0
        ? exclusions.excluded_days.join(',')
        : null;
      const blackoutStr = exclusions.blackout_ranges.length > 0
        ? exclusions.blackout_ranges.map(r => `${r.from}:${r.to}`).join(',')
        : null;
      const exclusionNotes = exclusions.notes.length > 0
        ? exclusions.notes.join('; ')
        : null;

      validities.push(new OfferValidity({
        valid_from: range?.from || apiFrom || null,
        valid_to: range?.to || apiTo || null,
        period_type: sub.type,
        recurrence_type: recurrenceType,
        recurrence_days: recurrenceDaysStr,
        time_from: timeRestriction?.time_from || null,
        time_to: timeRestriction?.time_to || null,
        exclusion_days: excludedDaysStr,
        blackout_periods: blackoutStr,
        exclusion_notes: exclusionNotes,
        raw_period_text: sub.text
      }));
    }

    if (validities.length === 0) {
      validities.push(new OfferValidity({
        valid_from: apiFrom || null,
        valid_to: apiTo || null,
        period_type: 'offer',
        recurrence_type: 'daily',
        raw_period_text: cleaned
      }));
    }

    for (const v of validities) {
      if (!v.valid_from) v.valid_from = (apiFrom && apiFrom.length >= 10) ? apiFrom : today;
      if (!v.valid_to) v.valid_to = (apiTo && apiTo.length >= 10) ? apiTo : null;
      if (v.valid_from && v.valid_to && v.valid_from > v.valid_to) {
        v.valid_from = v.valid_to;
      }
    }

    return validities;
  }
}

// ─── OfferValidity ───────────────────────────────────────────────────────────

class OfferValidity {
  constructor({
    valid_from = null,
    valid_to = null,
    period_type = 'offer',
    recurrence_type = 'daily',
    recurrence_days = null,
    time_from = null,
    time_to = null,
    exclusion_days = null,
    blackout_periods = null,
    exclusion_notes = null,
    raw_period_text = ''
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

    const d = new Date(dateStr + 'T00:00:00');
    const dayName = DAY_NAMES[d.getDay()];
    const dayOfMonth = d.getDate();

    const exclusionDays = Array.isArray(this.exclusion_days)
      ? this.exclusion_days
      : (this.exclusion_days ? this.exclusion_days.split(',') : []);
    if (exclusionDays.includes(dayName)) {
      return false;
    }

    if (this.blackout_periods) {
      const ranges = Array.isArray(this.blackout_periods)
        ? this.blackout_periods
        : String(this.blackout_periods).split(',').map(s => {
            const [bFrom, bTo] = s.split(':');
            return { from: bFrom, to: bTo };
          });
      for (const range of ranges) {
        const bFrom = range.from;
        const bTo = range.to;
        if (bFrom && bTo && dateStr >= bFrom && dateStr <= bTo) return false;
      }
    }

    switch (this.recurrence_type) {
      case 'daily':
        return true;
      case 'specific_weekdays':
        if (!this.recurrence_days) return true;
        if (Array.isArray(this.recurrence_days)) return this.recurrence_days.includes(dayName);
        return this.recurrence_days.split(',').includes(dayName);
      case 'specific_dates':
        if (!this.recurrence_days) return true;
        if (Array.isArray(this.recurrence_days)) return this.recurrence_days.includes(dateStr);
        return this.recurrence_days.split(',').includes(dateStr);
      case 'monthly_range':
        if (this.recurrence_days) {
          const range = Array.isArray(this.recurrence_days)
            ? this.recurrence_days
            : String(this.recurrence_days).split('-').map(Number);
          const [fromDay, toDay] = range;
          return dayOfMonth >= fromDay && dayOfMonth <= toDay;
        }
        return true;
      default:
        return true;
    }
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

// ─── HNBOffer Class v6 ───────────────────────────────────────────────────────

class HNBOffer {
  constructor({
    sourceId,
    title = '',
    category = '',
    categoryId = null,
    cardType = '',
    apiFrom = '',
    apiTo = '',
    htmlContent = '',
    rawListItem = null,
    rawDetail = null
  }) {
    this.source = 'HNB';
    this.source_id = sourceId;
    this.source_url = `https://venus.hnb.lk/api/get_web_card_promo?id=${sourceId}`;
    this.title = title;
    this.category = category;
    this.category_id = categoryId;
    this.card_type = cardType;
    this.scraped_at = new Date().toISOString();

    this.api_from = apiFrom || null;
    this.api_to = apiTo || null;

    const plainText = stripHtml(htmlContent);

    // NEW v6: Extract images
    this.images = extractImages(htmlContent, sourceId);

    // Parse merchant info
    this.merchant = this._parseMerchant(plainText);
    if (this.merchant) { this.merchant.name = normalizeMerchantNameSL(this.merchant.name); }

    // Parse offer details
    this.offer = this._parseOfferDetails(plainText);

    // NEW v6: Parse installment plans
    this.installment_plans = parseInstallmentPlans(plainText);

    // NEW v6: Parse transaction range
    this.transaction_range = parseTransactionRange(plainText);

    // NEW v9: Generate content hash
    this.content_hash = generateContentHash(this);

    // NEW v6: Parse card eligibility
    this.card_eligibility = parseCardEligibility(plainText);

    // Parse Period: text
    const periodText = this._extractPeriodText(plainText);
    this.validity_periods = PeriodParser.parse(periodText, this.api_from, this.api_to);

    // Generate stable unique ID
    this.unique_id = generateUniqueOfferId(sourceId);

    // Store raw data
    this._raw = {
      api_from: apiFrom,
      api_to: apiTo,
      period_text: periodText,
      html_content: htmlContent,
      list_item: rawListItem,
      detail: rawDetail
    };
  }

  _extractPeriodText(plainText) {
    const m = plainText.match(/[Pp]eriod\s*:\s*(.+?)(?=\s*(?:Eligibility\s*:|Contact\s*(?:No)?:|Location:|Special\s+Terms|General\s+Terms|Offer:|Merchant:))/i);
    if (m) {
      let text = m[1].trim();
      text = text.replace(/\s*Reservations?\s*:\s*[\d\s]+$/i, '');
      text = text.replace(/\s*Website\s*:\s*https?:\/\/\S+$/i, '');
      return text;
    }
    return '';
  }

  _parseMerchant(rawText) {
    const data = {
      name: '',
      location: null,
      addresses: [],
      phone: [],
      email: [],
      website: null,
      logo: this.images.logo
    };

    const merchantMatch = rawText.match(/Merchant:\s*([^\n]{2,100}?(?=\s*(?:Offer|Period|Eligibility|Contact|Location|$)))/is);
    if (merchantMatch) {
      const name = merchantMatch[1].trim();
      if (name.length < 200) data.name = name;
    }
    if (!data.name) data.name = this.title;

    // Use AddressEngine for extraction
    const extractedAddresses = AddressEngine.extract(rawText, data.name);
    data.addresses = extractedAddresses;
    if (extractedAddresses.length > 0) {
      // Set location to the city/area of the first address
      const firstAddr = extractedAddresses[0];
      const areaPart = firstAddr.split(',')[0].trim();
      data.location = areaPart;
    } else {
      data.addresses.push(`${data.name}, Sri Lanka`);
    }

    const phoneMatches = rawText.match(/(?:Contact(?:\s+No)?|Tel|Phone|Reservations?)\s*:\s*([\d\s,/]+)/gi);
    if (phoneMatches) {
      phoneMatches.forEach(match => {
        const phones = match.replace(/(?:Contact(?:\s+No)?|Tel|Phone|Reservations?)\s*:/gi, '').trim();
        phones.split(/[,\/]/).map(p => p.trim()).filter(p => p.length >= 7).forEach(p => {
          data.phone.push(p.replace(/\s+/g, ''));
        });
      });
      data.phone = [...new Set(data.phone)];
    }

    const emailMatch = rawText.match(/[\w.-]+@[\w.-]+\.\w+/g);
    if (emailMatch) data.email = [...new Set(emailMatch)];

    const websiteMatch = rawText.match(/(?:Website|Web)\s*:\s*(https?:\/\/[^\s]+)/i);
    if (websiteMatch) data.website = websiteMatch[1];

    return data;
  }

  _parseOfferDetails(rawText) {
    const data = {
      description: '',
      discount_percentage: null,
      applicable_cards: [],
      booking_required: false,
      restrictions: [],
      special_conditions: [],
      general_terms: []
    };

    const offerMatch = rawText.match(/Offer:\s*([^\n]+(?:\n(?!(?:Period|Eligibility|Contact|Location|Special|General):)[^\n]+)*)/i);
    if (offerMatch) {
      data.description = offerMatch[1].trim().replace(/\s+/g, ' ');
    }

    const discountMatch = rawText.match(/(\d+(?:\.\d+)?)\s*%\s*(?:off|discount|savings)/i);
    if (discountMatch) {
      data.discount_percentage = parseFloat(discountMatch[1]);
    } else {
      const upToMatch = rawText.match(/(?:up\s*to|upto)\s*(\d+)\s*%/i);
      if (upToMatch) data.discount_percentage = `up to ${upToMatch[1]}`;
      const rangeMatch = rawText.match(/(\d+)\s*%?\s*-\s*(\d+)\s*%/);
      if (rangeMatch) data.discount_percentage = `${rangeMatch[1]}-${rangeMatch[2]}`;
    }

    const cardTypes = [];
    if (/credit\s+card/i.test(rawText)) cardTypes.push('Credit Card');
    if (/debit\s+card/i.test(rawText)) cardTypes.push('Debit Card');
    if (/\bvisa\b/i.test(rawText)) cardTypes.push('Visa');
    if (/\bmastercard\b/i.test(rawText)) cardTypes.push('Mastercard');
    data.applicable_cards = [...new Set(cardTypes)];

    data.booking_required = /reservation|booking|book\s+in\s+advance|advance\s+booking/i.test(rawText);

    if (/cannot be combined/i.test(rawText)) data.restrictions.push('Cannot be combined with other offers');
    if (/non-refundable/i.test(rawText)) data.restrictions.push('Non-refundable');
    if (/advance payment/i.test(rawText)) data.restrictions.push('Advance payment required');
    if (/subject to availability/i.test(rawText)) data.restrictions.push('Subject to availability');

    const specialMatch = rawText.match(/Special Terms and Conditions:\s*(.+?)(?=General Terms|$)/is);
    if (specialMatch) {
      data.special_conditions = specialMatch[1]
        .split(/[.\n]/)
        .map(c => c.trim())
        .filter(c => c.length > 5 && !c.startsWith('General'));
    }

    const generalMatch = rawText.match(/General Terms and Conditions:\s*(.+?)$/is);
    if (generalMatch) {
      data.general_terms = generalMatch[1]
        .split(/[.\n]/)
        .map(c => c.trim())
        .filter(c => c.length > 5);
    }

    return data;
  }

  isActiveOn(dateStr) {
    return this.validity_periods.some(v => v.period_type === 'offer' && v.isActiveOn(dateStr));
  }

  get primaryValidity() {
    return this.validity_periods.find(v => v.period_type === 'offer') || this.validity_periods[0];
  }

  toJSON(includeRaw = false) {
    const obj = {
      unique_id: this.unique_id,
      source: this.source,
      source_id: this.source_id,
      source_url: this.source_url,
      title: this.title,
      category: this.category,
      category_id: this.category_id,
      card_type: this.card_type,
      scraped_at: this.scraped_at,
      merchant: this.merchant,
      offer: this.offer,
      installment_plans: this.installment_plans,
      transaction_range: this.transaction_range,
      card_eligibility: this.card_eligibility,
      images: this.images,
      validity_periods: this.validity_periods.map(v => v.toJSON()),
      content_hash: this.content_hash
    };
    if (includeRaw) {
      obj._raw = this._raw;
    }
    return obj;
  }
}

// ─── Geocoding (from v5, unchanged) ──────────────────────────────────────────

async function geocodeAddress(address) {
  if (!CONFIG.enableGeocoding || !CONFIG.googleApiKey) return null;

  const addressHash = crypto.createHash('md5').update(address.toLowerCase().trim()).digest('hex');
  const cachePath = path.join(CONFIG.geoCacheDir, `${addressHash}.json`);

  if (fs.existsSync(cachePath)) {
    try { return JSON.parse(fs.readFileSync(cachePath, 'utf8')); }
    catch (e) { /* corrupted cache */ }
  }

  try {
    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: { address, key: CONFIG.googleApiKey, region: 'lk' },
      timeout: 10000
    });
    if (response.data.status === 'OK' && response.data.results.length > 0) {
      const result = response.data.results[0];
      const location = {
        original_address: address,
        latitude: result.geometry.location.lat,
        longitude: result.geometry.location.lng,
        formatted_address: result.formatted_address,
        place_id: result.place_id,
        cached_at: new Date().toISOString()
      };
      fs.writeFileSync(cachePath, JSON.stringify(location, null, 2));
      return location;
    }
    fs.writeFileSync(cachePath, JSON.stringify({ original_address: address, status: 'NOT_FOUND', cached_at: new Date().toISOString() }, null, 2));
    return null;
  } catch (error) {
    return null;
  }
}

async function geocodeBatch(addresses) {
  if (!CONFIG.enableGeocoding || addresses.length === 0) return [];
  const results = [];
  for (let i = 0; i < addresses.length; i += CONFIG.geocodeConcurrent) {
    const batch = addresses.slice(i, i + CONFIG.geocodeConcurrent);
    const batchResults = await Promise.all(batch.map(addr => geocodeAddress(addr)));
    results.push(...batchResults.filter(r => r && r.status !== 'NOT_FOUND'));
    await sleep(200);
  }
  return results;
}

// ─── Scraping Pipeline ───────────────────────────────────────────────────────

async function scrapeCategoryOffers(category) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📂 Category: ${category.name} (ID: ${category.id})`);
  console.log('='.repeat(60));

  try {
    const firstPageUrl = category.url.replace('{page}', '1');
    const { data: firstPageData } = await fetchJSON(firstPageUrl);
    const totalPages = firstPageData.totalPages || 1;
    console.log(`  📊 Total pages: ${totalPages}`);

    let allOffers = [...(firstPageData.data || [])];

    if (totalPages > 1) {
      const pageUrls = [];
      for (let page = 2; page <= totalPages; page++) {
        pageUrls.push(category.url.replace('{page}', page));
      }
      const results = await fetchAllParallel(pageUrls, 'Fetching pages');
      results.forEach(r => {
        if (r.success && r.data.data) allOffers.push(...r.data.data);
      });
    }

    console.log(`  📦 Total offers: ${allOffers.length}`);

    const detailUrls = allOffers.map(o =>
      `https://venus.hnb.lk/api/get_web_card_promo?id=${o.id}`
    );
    const detailResults = await fetchAllParallel(detailUrls, 'Fetching details');

    console.log(`  🚀 Building HNBOffer objects...`);

    const offers = [];
    let processed = 0;

    for (let i = 0; i < allOffers.length; i++) {
      const listItem = allOffers[i];
      const detail = detailResults[i];
      const fullDetails = detail.success ? detail.data : null;

      const offer = new HNBOffer({
        sourceId: listItem.id,
        title: listItem.title || '',
        category: category.name,
        categoryId: category.id,
        cardType: listItem.cardType || fullDetails?.cardType || '',
        apiFrom: listItem.from || fullDetails?.from || '',
        apiTo: listItem.to || fullDetails?.to || '',
        htmlContent: fullDetails?.content || '',
        rawListItem: listItem,
        rawDetail: fullDetails
      });

      // Geocode if enabled
      if (CONFIG.enableGeocoding) {
        const geoResults = await geocodeBatch(offer.merchant.addresses);
        if (geoResults.length > 0) {
          offer.merchant.geocoded_locations = geoResults;
        }
      }

      // Download logo if enabled
      if (CONFIG.downloadImages && offer.images.logo) {
        const localPath = await downloadImage(offer.images.logo.url, offer.unique_id);
        if (localPath) {
          offer.images.logo.local_path = localPath;
        }
      }

      offers.push(offer);
      processed++;

      if (processed % 10 === 0 || processed === allOffers.length) {
        process.stdout.write(`\r  🔄 Processed: ${processed}/${allOffers.length}`);
      }
    }
    console.log('');

    console.log(`  ✅ ${category.name} completed! ${offers.length} offers`);
    return { success: true, category: category.name, categoryId: category.id, offers };

  } catch (error) {
    console.error(`  ❌ Failed: ${error.message}`);
    return { success: false, category: category.name, error: error.message, offers: [] };
  }
}

async function scrapeAllCategories(categoriesToScrape) {
  console.log(`\n🚀 Starting v6 pipeline for ${categoriesToScrape.length} categories...\n`);
  const startTime = Date.now();

  const categoryResults = await Promise.all(
    categoriesToScrape.map(cat => scrapeCategoryOffers(cat))
  );

  const allOffers = [];
  const stats = {
    totalOffers: 0,
    successfulCategories: 0,
    failedCategories: 0,
    periodStats: { daily: 0, specific_weekdays: 0, specific_dates: 0, monthly_range: 0 },
    multiPeriodOffers: 0,
    totalValidityRows: 0,
    offersWithLogos: 0,
    offersWithInstallments: 0,
    offersWithTransactionRange: 0,
    duration: ((Date.now() - startTime) / 1000).toFixed(2)
  };

  for (const result of categoryResults) {
    if (result.success) {
      stats.successfulCategories++;
      stats.totalOffers += result.offers.length;

      for (const offer of result.offers) {
        allOffers.push(offer);

        if (offer.validity_periods.length > 1) stats.multiPeriodOffers++;
        stats.totalValidityRows += offer.validity_periods.length;
        if (offer.images.logo) stats.offersWithLogos++;
        if (offer.installment_plans.length > 0) stats.offersWithInstallments++;
        if (offer.transaction_range.min || offer.transaction_range.max) stats.offersWithTransactionRange++;

        for (const v of offer.validity_periods) {
          stats.periodStats[v.recurrence_type] = (stats.periodStats[v.recurrence_type] || 0) + 1;
        }
      }
    } else {
      stats.failedCategories++;
    }
  }

  return { results: categoryResults, allOffers, stats };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║   HNB Scraper v6.0 - Enhanced Data Extraction     ║');
  console.log('║   ✓ Merchant logos & images (assets.hnb.lk)       ║');
  console.log('║   ✓ Installment plan parsing                      ║');
  console.log('║   ✓ Transaction amount ranges                     ║');
  console.log('║   ✓ Card eligibility & restrictions               ║');
  console.log('║   ✓ Source URL tracking                           ║');
  console.log('║   + All v5 features (validity periods, etc)       ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  const args = process.argv.slice(2);

  if (args.includes('--no-cache')) {
    CONFIG.useCache = false;
    console.log('⚠️  Cache disabled\n');
  }

  if (args.includes('--download-images')) {
    CONFIG.downloadImages = true;
    console.log('📥 Image download enabled\n');
  }

  const googleKeyArg = args.find(a => a.startsWith('--google-api-key='));
  if (googleKeyArg) {
    CONFIG.googleApiKey = googleKeyArg.split('=')[1];
    CONFIG.enableGeocoding = true;
    console.log('✓ Google Geocoding enabled\n');
  }

  let categoriesToScrape = CATEGORIES;
  const categoryArg = args.find(a => a.startsWith('--category='));
  if (categoryArg) {
    const name = categoryArg.split('=')[1];
    categoriesToScrape = CATEGORIES.filter(c => c.name.toLowerCase().includes(name.toLowerCase()));
    if (categoriesToScrape.length === 0) {
      console.log(`❌ Category "${name}" not found`);
      return;
    }
  }

  const { results: categoryResults, allOffers, stats } = await scrapeAllCategories(categoriesToScrape);

  // ── Save output ──
  const outputDir = './output';
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  console.log('\n📁 Saving output...');

  // 1. Per-category files
  for (const result of categoryResults) {
    if (result.success && result.offers.length > 0) {
      const filename = `${result.category.toLowerCase().replace(/\s+/g, '_')}_v9.json`;
      fs.writeFileSync(
        path.join(outputDir, filename),
        JSON.stringify({
          category: result.category,
          totalOffers: result.offers.length,
          processedAt: new Date().toISOString(),
          offers: result.offers.map(o => o.toJSON())
        }, null, 2)
      );
      console.log(`  ✓ ${filename}`);
    }
  }

  // 2. All offers combined
  fs.writeFileSync(
    path.join(outputDir, 'hnb_all_v9.json'),
    JSON.stringify({
      processedAt: new Date().toISOString(),
      stats,
      offers: allOffers.map(o => o.toJSON())
    }, null, 2)
  );
  console.log(`  ✓ hnb_all_v9.json`);

  // 3. Flattened validity rows
  const validityRows = [];
  for (const offer of allOffers) {
    for (const v of offer.validity_periods) {
      validityRows.push({
        offer_unique_id: offer.unique_id,
        offer_source_id: offer.source_id,
        offer_title: offer.title,
        merchant_name: offer.merchant.name,
        merchant_logo: offer.images.logo?.url || null,
        category: offer.category,
        ...v.toJSON()
      });
    }
  }
  fs.writeFileSync(
    path.join(outputDir, 'hnb_validity_rows_v9.json'),
    JSON.stringify({
      processedAt: new Date().toISOString(),
      totalRows: validityRows.length,
      rows: validityRows
    }, null, 2)
  );
  console.log(`  ✓ hnb_validity_rows_v9.json (${validityRows.length} rows - DB import ready)`);

  // 4. Raw data
  fs.writeFileSync(
    path.join(outputDir, 'hnb_raw_v9.json'),
    JSON.stringify({
      scrapedAt: new Date().toISOString(),
      totalOffers: allOffers.length,
      offers: allOffers.map(o => o.toJSON(true))
    }, null, 2)
  );
  console.log(`  ✓ hnb_raw_v9.json (with raw data)`);

  // ── Summary Report ──
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║                 SUMMARY REPORT                     ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  for (const result of categoryResults) {
    if (result.success) {
      console.log(`  ✅ ${result.category.padEnd(20)}: ${result.offers.length.toString().padStart(4)} offers`);
    } else {
      console.log(`  ❌ ${result.category.padEnd(20)}: Failed`);
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`  Total offers              : ${stats.totalOffers}`);
  console.log(`  Total validity rows       : ${stats.totalValidityRows}`);
  console.log(`  Multi-period offers       : ${stats.multiPeriodOffers}`);
  console.log(`  ── NEW v6 Enhancements ──`);
  console.log(`     Offers with logos      : ${stats.offersWithLogos} (${(stats.offersWithLogos/stats.totalOffers*100).toFixed(1)}%)`);
  console.log(`     Offers with installments: ${stats.offersWithInstallments}`);
  console.log(`     Offers with tx ranges  : ${stats.offersWithTransactionRange}`);
  console.log(`  ── Recurrence breakdown ──`);
  console.log(`     daily                  : ${stats.periodStats.daily || 0}`);
  console.log(`     specific_weekdays      : ${stats.periodStats.specific_weekdays || 0}`);
  console.log(`     specific_dates         : ${stats.periodStats.specific_dates || 0}`);
  console.log(`     monthly_range          : ${stats.periodStats.monthly_range || 0}`);
  console.log(`  Time taken                : ${stats.duration}s`);
  console.log('─'.repeat(60));

  // ── Quick demo: today's active offers ──
  const today = new Date().toISOString().split('T')[0];
  const todayOffers = allOffers.filter(o => o.isActiveOn(today));
  console.log(`\n📅 Active today (${today}): ${todayOffers.length}/${allOffers.length} offers`);

  if (todayOffers.length > 0) {
    console.log(`\n  Sample (first 5):`);
    todayOffers.slice(0, 5).forEach(o => {
      const pv = o.primaryValidity;
      const recurrence = pv.recurrence_type !== 'daily' ? ` [${pv.recurrence_type}: ${pv.recurrence_days}]` : '';
      const logo = o.images.logo ? ' 🖼️' : '';
      const installments = o.installment_plans.length > 0 ? ` 💳(${o.installment_plans.map(p => p.months).join(',')})` : '';
      console.log(`    - ${o.merchant.name || o.title}${logo}${installments} | ${pv.valid_from} to ${pv.valid_to}${recurrence}`);
    });
  }

  console.log('\n✨ v6 completed!');
  console.log(`\n📋 Usage:`);
  console.log(`   --google-api-key=KEY   Enable geocoding`);
  console.log(`   --category=<name>      Specific category`);
  console.log(`   --no-cache             Fresh downloads`);
  console.log(`   --download-images      Download merchant logos locally\n`);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { HNBOffer, OfferValidity, PeriodParser, scrapeCategoryOffers, scrapeAllCategories };
