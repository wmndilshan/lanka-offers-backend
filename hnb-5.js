/**
 * HNB Bank Offers Scraper v5.0 - Structured Period Parsing + HNBOffer Class
 *
 * Features:
 * - HNBOffer class: clean objects with structured validity periods
 * - PeriodParser: handles all messy date formats -> DB-ready rows
 * - Multi-period support (booking/stay/travel/installment/offer)
 * - Recurrence detection (every Sunday, weekdays, monthly ranges)
 * - Exclusion detection (exclude Friday, blackout periods)
 * - Time restriction parsing (3pm to 9pm)
 * - Unique IDs, caching, optional geocoding from v4
 *
 * Requires: npm install axios
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Configuration ───────────────────────────────────────────────────────────

const CONFIG = {
  maxRetries: 3,
  retryDelay: 2000,
  timeout: 15000,
  maxConcurrent: 5,
  cacheDir: './cache_hnb',
  geoCacheDir: './cache_hnb/geocode',
  cacheExpiry: 24 * 60 * 60 * 1000,
  useCache: true,
  googleApiKey: '',
  enableGeocoding: false,
  geocodeConcurrent: 5
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
[CONFIG.cacheDir, CONFIG.geoCacheDir].forEach(dir => {
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
 * Previous format included dates/merchant/title which changed between scrapes
 */
function generateUniqueOfferId(sourceId) {
  return `hnb_${sourceId}`;
}

// ─── PeriodParser ────────────────────────────────────────────────────────────
// Parses messy human-readable period text into structured validity rows

const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
};

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

class PeriodParser {

  /**
   * Parse a single human date like "28th February 2026" or "01st January" into YYYY-MM-DD
   * If no year, uses fallbackYear
   */
  static parseHumanDate(text, fallbackYear = null) {
    if (!text) return null;
    const cleaned = text.replace(/\s+/g, ' ').trim();

    // "28th February 2026" or "1st January" or "8th March 2026"
    const m = cleaned.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?/i);
    if (!m) return null;

    const day = parseInt(m[1], 10);
    const month = MONTHS[m[2].toLowerCase()];
    const year = m[3] ? parseInt(m[3], 10) : (fallbackYear || new Date().getFullYear());

    if (month === undefined || day < 1 || day > 31) return null;

    const d = new Date(year, month, day);
    // Validate the date is real (e.g., Feb 30 would roll over)
    if (d.getMonth() !== month) return null;

    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  /**
   * Extract year from a period text string (looks for 4-digit year)
   */
  static extractYear(text) {
    const m = text.match(/\b(20\d{2})\b/);
    return m ? parseInt(m[1], 10) : null;
  }

  /**
   * Extract weekday names from parenthetical like "(Every Sunday)" or "(Every Monday)"
   * Also handles common typos like "Mondy", "Tuesdy", "Wenesday" etc.
   */
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
    // Fallback: check if the word starts with a known day prefix (3+ chars)
    for (const entry of fuzzyMap) {
      if (w.length >= 3 && entry.canonical.startsWith(w.substring(0, 3))) return entry.canonical;
    }
    return null;
  }

  static extractRecurrenceDays(text) {
    const days = [];
    // Strip out exclusion clauses before detecting recurrence
    // e.g. "(Exclude on Friday, Saturday & Long Weekends)" should not trigger weekend recurrence
    const withoutExclusions = text.replace(/\(?\s*exclude\s+(?:on\s+)?[^)]*\)?/gi, '')
      .replace(/\(?\s*blackout\s+[^)]*\)?/gi, '');
    const lower = withoutExclusions.toLowerCase();

    // "Every Sunday", "Every Monday", "Every Mondy" (typo), etc.
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

    // "Weekdays"
    if (/weekday/i.test(lower)) {
      days.push('monday', 'tuesday', 'wednesday', 'thursday', 'friday');
    }

    // "Weekends"
    if (/weekend/i.test(lower)) {
      days.push('saturday', 'sunday');
    }

    // "Sunday to Friday only"
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

  /**
   * Extract time restrictions like "3pm to 9pm" or "from 7pm onwards"
   */
  static extractTimeRestriction(text) {
    // "3pm to 9pm", "from 7pm onwards"
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

    // "from 7pm onwards"
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

  /**
   * Extract exclusion info like "Exclude on Friday, Saturday & Long Weekends"
   * or "Blackout Period: 10th to 20th April 2026"
   */
  static extractExclusions(text) {
    const exclusions = {
      excluded_days: [],      // e.g. ["friday", "saturday"]
      blackout_ranges: [],    // e.g. [{ from: "2026-04-10", to: "2026-04-20" }]
      notes: []               // free-text exclusion notes
    };

    const year = PeriodParser.extractYear(text);

    // "Exclude on Friday, Saturday & Long Weekends"
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

    // "Blackout Period: 10th to 20th April 2026"
    const blackoutMatch = text.match(/blackout\s+(?:period)?:?\s*(\d{1,2})(?:st|nd|rd|th)?\s+to\s+(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?/i);
    if (blackoutMatch) {
      const bMonth = MONTHS[blackoutMatch[3].toLowerCase()];
      const bYear = blackoutMatch[4] ? parseInt(blackoutMatch[4], 10) : (year || new Date().getFullYear());
      exclusions.blackout_ranges.push({
        from: `${bYear}-${String(bMonth + 1).padStart(2, '0')}-${String(parseInt(blackoutMatch[1])).padStart(2, '0')}`,
        to: `${bYear}-${String(bMonth + 1).padStart(2, '0')}-${String(parseInt(blackoutMatch[2])).padStart(2, '0')}`
      });
    }

    // "except Corporate, Business & Fuel cards"
    const exceptMatch = text.match(/\(except\s+([^)]+)\)/i);
    if (exceptMatch) {
      exclusions.notes.push(`Except: ${exceptMatch[1].trim()}`);
    }

    return exclusions;
  }

  /**
   * Extract monthly recurrence like "23rd to 30th of every month"
   */
  static extractMonthlyRange(text) {
    const m = text.match(/(\d{1,2})(?:st|nd|rd|th)?\s+to\s+(\d{1,2})(?:st|nd|rd|th)?\s+of\s+every\s+month/i);
    if (m) {
      return { from_day: parseInt(m[1], 10), to_day: parseInt(m[2], 10) };
    }
    return null;
  }

  /**
   * Parse a list of specific dates like "01st,04th,20th,25th,26th & 31st March 2026"
   */
  static parseSpecificDates(text) {
    const year = PeriodParser.extractYear(text);
    // Match month name
    const monthMatch = text.match(/(january|february|march|april|may|june|july|august|september|october|november|december)/i);
    if (!monthMatch) return [];

    const month = MONTHS[monthMatch[1].toLowerCase()];
    const yr = year || new Date().getFullYear();

    // Extract all day numbers before the month name
    const beforeMonth = text.substring(0, text.toLowerCase().indexOf(monthMatch[1].toLowerCase()));
    const dayMatches = beforeMonth.match(/\d{1,2}/g);
    if (!dayMatches) return [];

    return dayMatches.map(d => {
      const day = parseInt(d, 10);
      return `${yr}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    });
  }

  /**
   * Parse a simple range like "01st January to 28th February 2026"
   * Returns { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
   */
  static parseDateRange(text) {
    const year = PeriodParser.extractYear(text);
    const fallback = year || new Date().getFullYear();

    // "01st January to 28th February 2026"
    // "01st to 28th February 2026" (same month)
    // "Till 28th February 2026"

    // Full range: both have month names
    const fullRange = text.match(
      /(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?\s+to\s+(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?/i
    );
    if (fullRange) {
      const fromDate = PeriodParser.parseHumanDate(`${fullRange[1]} ${fullRange[2]} ${fullRange[3] || fallback}`, fallback);
      const toDate = PeriodParser.parseHumanDate(`${fullRange[4]} ${fullRange[5]} ${fullRange[6] || fallback}`, fallback);
      return { from: fromDate, to: toDate };
    }

    // Same-month range: "01st to 28th February 2026" or "17th to 25th February 2026"
    const sameMonth = text.match(
      /(\d{1,2})(?:st|nd|rd|th)?\s+to\s+(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?/i
    );
    if (sameMonth) {
      const fromDate = PeriodParser.parseHumanDate(`${sameMonth[1]} ${sameMonth[3]} ${sameMonth[4] || fallback}`, fallback);
      const toDate = PeriodParser.parseHumanDate(`${sameMonth[2]} ${sameMonth[3]} ${sameMonth[4] || fallback}`, fallback);
      return { from: fromDate, to: toDate };
    }

    // "Till [date]"
    const tillMatch = text.match(/till\s+(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?/i);
    if (tillMatch) {
      const toDate = PeriodParser.parseHumanDate(`${tillMatch[1]} ${tillMatch[2]} ${tillMatch[3] || fallback}`, fallback);
      return { from: null, to: toDate }; // from = null means use API from date
    }

    // Single date: "14th February 2026"
    const singleDate = PeriodParser.parseHumanDate(text, fallback);
    if (singleDate) {
      return { from: singleDate, to: singleDate };
    }

    return null;
  }

  /**
   * Split the Period: text into sub-periods by type labels.
   * e.g. "Booking Period: X Stay Period: Y Installment Period: Z"
   * Returns array of { type, text }
   */
  static splitSubPeriods(periodText) {
    const subPeriods = [];

    // Known period type labels
    const labels = [
      { pattern: /\b(?:offer\s+period|offer\s+Period)\s*:\s*/gi, type: 'offer' },
      { pattern: /\b(?:booking\s+period|book(?:ing)?)\s*:\s*/gi, type: 'booking' },
      { pattern: /\b(?:stay(?:ing)?\s+period)\s*:\s*/gi, type: 'stay' },
      { pattern: /\b(?:travel(?:l?ing)?\s+period)\s*:\s*/gi, type: 'travel' },
      { pattern: /\b(?:installment\s+period|instalment\s+period)\s*:\s*/gi, type: 'installment' },
      { pattern: /\b(?:reserv(?:e|ation)\s+period)\s*:\s*/gi, type: 'reservation' },
      { pattern: /\b(?:event\s+period)\s*:\s*/gi, type: 'event' }
    ];

    // Find all label positions
    const markers = [];
    for (const label of labels) {
      let match;
      label.pattern.lastIndex = 0;
      while ((match = label.pattern.exec(periodText)) !== null) {
        markers.push({ type: label.type, index: match.index, length: match[0].length });
      }
    }

    if (markers.length === 0) {
      // No sub-period labels found - treat entire text as 'offer' type
      return [{ type: 'offer', text: periodText.trim() }];
    }

    // Sort by position
    markers.sort((a, b) => a.index - b.index);

    // Extract text between markers
    for (let i = 0; i < markers.length; i++) {
      const start = markers[i].index + markers[i].length;
      const end = i + 1 < markers.length ? markers[i + 1].index : periodText.length;
      const text = periodText.substring(start, end).trim();
      if (text.length > 0) {
        subPeriods.push({ type: markers[i].type, text });
      }
    }

    // If there's text before the first marker, treat it as 'offer'
    if (markers[0].index > 0) {
      const beforeText = periodText.substring(0, markers[0].index).trim();
      if (beforeText.length > 2) {
        subPeriods.unshift({ type: 'offer', text: beforeText });
      }
    }

    return subPeriods;
  }

  /**
   * Main entry: parse a full Period: text + API dates into validity rows
   * Returns array of OfferValidity objects
   */
  static parse(periodText, apiFrom, apiTo) {
    const validities = [];

    const today = new Date().toISOString().split('T')[0];

    if (!periodText || periodText.trim().length === 0) {
      // No period text - use API dates only, fallback from to today
      let fromDate = (apiFrom && apiFrom.length >= 10) ? apiFrom : today;
      const toDate = (apiTo && apiTo.length >= 10) ? apiTo : null;
      // Clamp: don't let from exceed to (expired offers)
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

    const cleaned = periodText.trim();

    // Check for specific dates list: "01st,04th,20th,25th,26th & 31st March 2026"
    // Must have comma-separated ordinals before a month name (not in unrelated text)
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

    // Check for "X & Y [month] [year]" (two specific dates): "12th & 13th March 2026"
    // Reject if there's a date-range "to" (e.g. "January to February"), but allow time-range "to" (e.g. "3pm to 8pm")
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

    // Split into sub-periods (booking/stay/travel/installment/offer)
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

    // If no validities were created (parser couldn't handle it), fallback to API dates
    if (validities.length === 0) {
      validities.push(new OfferValidity({
        valid_from: apiFrom || null,
        valid_to: apiTo || null,
        period_type: 'offer',
        recurrence_type: 'daily',
        raw_period_text: cleaned
      }));
    }

    // Fill in missing dates: prefer API dates, fallback to today for from
    for (const v of validities) {
      if (!v.valid_from) v.valid_from = (apiFrom && apiFrom.length >= 10) ? apiFrom : today;
      if (!v.valid_to) v.valid_to = (apiTo && apiTo.length >= 10) ? apiTo : null;
      // Clamp: if from > to (expired offer got today as fallback), set from = to
      if (v.valid_from && v.valid_to && v.valid_from > v.valid_to) {
        v.valid_from = v.valid_to;
      }
    }

    return validities;
  }
}

// ─── OfferValidity ───────────────────────────────────────────────────────────
// Represents one validity period row (an offer can have multiple)

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
    this.period_type = period_type;           // offer|booking|stay|travel|installment|reservation|event
    this.recurrence_type = recurrence_type;   // daily|specific_weekdays|specific_dates|monthly_range
    this.recurrence_days = recurrence_days;   // "sunday" or "monday,wednesday" or "23-30" or "2026-03-01,2026-03-04"
    this.time_from = time_from;               // "15:00" or null
    this.time_to = time_to;                   // "21:00" or null
    this.exclusion_days = exclusion_days;      // "friday,saturday" or null
    this.blackout_periods = blackout_periods;  // "2026-04-10:2026-04-20" or null
    this.exclusion_notes = exclusion_notes;    // free-text like "Excludes long weekends"
    this.raw_period_text = raw_period_text;
  }

  /**
   * Check if this validity covers a given date (YYYY-MM-DD string)
   */
  isActiveOn(dateStr) {
    if (!this.valid_from || !this.valid_to) return false;
    if (dateStr < this.valid_from || dateStr > this.valid_to) return false;

    const d = new Date(dateStr + 'T00:00:00');
    const dayName = DAY_NAMES[d.getDay()];
    const dayOfMonth = d.getDate();

    // Check exclusion days
    if (this.exclusion_days && this.exclusion_days.split(',').includes(dayName)) {
      return false;
    }

    // Check blackout periods
    if (this.blackout_periods) {
      const ranges = this.blackout_periods.split(',');
      for (const range of ranges) {
        const [bFrom, bTo] = range.split(':');
        if (dateStr >= bFrom && dateStr <= bTo) return false;
      }
    }

    // Check recurrence
    switch (this.recurrence_type) {
      case 'daily':
        return true;
      case 'specific_weekdays':
        return this.recurrence_days ? this.recurrence_days.split(',').includes(dayName) : true;
      case 'specific_dates':
        return this.recurrence_days ? this.recurrence_days.split(',').includes(dateStr) : true;
      case 'monthly_range':
        if (this.recurrence_days) {
          const [fromDay, toDay] = this.recurrence_days.split('-').map(Number);
          return dayOfMonth >= fromDay && dayOfMonth <= toDay;
        }
        return true;
      default:
        return true;
    }
  }

  toJSON() {
    return {
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
    };
  }
}

// ─── HNBOffer Class ──────────────────────────────────────────────────────────

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
    this.title = title;
    this.category = category;
    this.category_id = categoryId;
    this.card_type = cardType;
    this.scraped_at = new Date().toISOString();

    // Raw API dates (always YYYY-MM-DD from HNB API)
    this.api_from = apiFrom || null;
    this.api_to = apiTo || null;

    // Strip HTML -> plain text for parsing
    const plainText = stripHtml(htmlContent);

    // Parse merchant info
    this.merchant = this._parseMerchant(plainText);

    // Parse offer details
    this.offer = this._parseOfferDetails(plainText);

    // Parse Period: text from HTML content and structure it
    const periodText = this._extractPeriodText(plainText);
    this.validity_periods = PeriodParser.parse(periodText, this.api_from, this.api_to);

    // Generate stable unique ID (uses only source_id, stable across scrapes)
    this.unique_id = generateUniqueOfferId(sourceId);

    // Store raw data for reference
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
      // Clean up: remove phone numbers and URLs that got mixed in
      let text = m[1].trim();
      // Remove trailing "Reservations: 077XXXXXXX" etc
      text = text.replace(/\s*Reservations?\s*:\s*[\d\s]+$/i, '');
      // Remove trailing website URLs
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
      website: null
    };

    const merchantMatch = rawText.match(/Merchant:\s*([^\n]+)/i);
    if (merchantMatch) {
      const name = merchantMatch[1].trim();
      if (name.length < 200) data.name = name;
    }
    if (!data.name) data.name = this.title;

    const locationMatch = rawText.match(/Location:\s*([^\n]+)/i);
    if (locationMatch) {
      const loc = locationMatch[1].trim();
      if (loc.length > 0 && loc.length < 150) {
        data.location = loc;
        data.addresses.push(`${data.name}, ${loc}, Sri Lanka`);
      }
    }
    if (data.addresses.length === 0) {
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

    return data;
  }

  _parseOfferDetails(rawText) {
    const data = {
      description: '',
      discount_percentage: null,
      applicable_cards: [],
      booking_required: false,
      restrictions: [],
      special_conditions: []
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

    return data;
  }

  /**
   * Check if this offer is active on a given date
   */
  isActiveOn(dateStr) {
    return this.validity_periods.some(v => v.period_type === 'offer' && v.isActiveOn(dateStr));
  }

  /**
   * Get the primary validity (the 'offer' type period, or first one)
   */
  get primaryValidity() {
    return this.validity_periods.find(v => v.period_type === 'offer') || this.validity_periods[0];
  }

  /**
   * Serialize for JSON output (without internal _raw unless requested)
   */
  toJSON(includeRaw = false) {
    const obj = {
      unique_id: this.unique_id,
      source: this.source,
      source_id: this.source_id,
      title: this.title,
      category: this.category,
      category_id: this.category_id,
      card_type: this.card_type,
      scraped_at: this.scraped_at,
      merchant: this.merchant,
      offer: this.offer,
      validity_periods: this.validity_periods.map(v => v.toJSON())
    };
    if (includeRaw) {
      obj._raw = this._raw;
    }
    return obj;
  }
}

// ─── Geocoding (from v4, unchanged) ──────────────────────────────────────────

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
  console.log(`\n🚀 Starting v5 pipeline for ${categoriesToScrape.length} categories...\n`);
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
    duration: ((Date.now() - startTime) / 1000).toFixed(2)
  };

  for (const result of categoryResults) {
    if (result.success) {
      stats.successfulCategories++;
      stats.totalOffers += result.offers.length;

      for (const offer of result.offers) {
        allOffers.push(offer);

        // Collect period stats
        if (offer.validity_periods.length > 1) stats.multiPeriodOffers++;
        stats.totalValidityRows += offer.validity_periods.length;
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
  console.log('║   HNB Scraper v5.0 - HNBOffer + PeriodParser       ║');
  console.log('║   ✓ Structured validity periods (DB-ready)        ║');
  console.log('║   ✓ Multi-period: booking/stay/travel/installment ║');
  console.log('║   ✓ Recurrence: weekdays, monthly ranges          ║');
  console.log('║   ✓ Exclusions & time restrictions                ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  const args = process.argv.slice(2);

  if (args.includes('--no-cache')) {
    CONFIG.useCache = false;
    console.log('⚠️  Cache disabled\n');
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
      const filename = `${result.category.toLowerCase().replace(/\s+/g, '_')}_v5.json`;
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
    path.join(outputDir, 'hnb_all_v5.json'),
    JSON.stringify({
      processedAt: new Date().toISOString(),
      stats,
      offers: allOffers.map(o => o.toJSON())
    }, null, 2)
  );
  console.log(`  ✓ hnb_all_v5.json`);

  // 3. Flattened validity rows (one row per validity period - DB import ready)
  const validityRows = [];
  for (const offer of allOffers) {
    for (const v of offer.validity_periods) {
      validityRows.push({
        offer_unique_id: offer.unique_id,
        offer_source_id: offer.source_id,
        offer_title: offer.title,
        merchant_name: offer.merchant.name,
        category: offer.category,
        ...v.toJSON()
      });
    }
  }
  fs.writeFileSync(
    path.join(outputDir, 'hnb_validity_rows_v5.json'),
    JSON.stringify({
      processedAt: new Date().toISOString(),
      totalRows: validityRows.length,
      rows: validityRows
    }, null, 2)
  );
  console.log(`  ✓ hnb_validity_rows_v5.json (${validityRows.length} rows - DB import ready)`);

  // 4. Raw data (for debugging / reprocessing)
  fs.writeFileSync(
    path.join(outputDir, 'hnb_raw_v5.json'),
    JSON.stringify({
      scrapedAt: new Date().toISOString(),
      totalOffers: allOffers.length,
      offers: allOffers.map(o => o.toJSON(true))  // includeRaw = true
    }, null, 2)
  );
  console.log(`  ✓ hnb_raw_v5.json (with raw data)`);

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
      console.log(`    - ${o.merchant.name || o.title} | ${pv.valid_from} to ${pv.valid_to}${recurrence}`);
    });
  }

  console.log('\n✨ v5 completed!');
  console.log(`\n📋 Usage:`);
  console.log(`   --google-api-key=KEY   Enable geocoding`);
  console.log(`   --category=<name>      Specific category`);
  console.log(`   --no-cache             Fresh downloads\n`);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { HNBOffer, OfferValidity, PeriodParser, scrapeCategoryOffers, scrapeAllCategories };
