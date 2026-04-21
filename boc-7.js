/**
 * BOC Bank Card Offers Scraper v6.0 - Enhanced Contact & Location Extraction
 *
 * NEW in v6:
 * - Enhanced location parsing from "Location : ..." format
 * - Better contact number extraction from "Contact No : ..." format
 * - Multiple contact numbers parsed separately
 * - Full address extraction with proper formatting
 * - Merchant info structured (name, address, contacts)
 * - Source URL tracking
 *
 * Inherits from v5:
 * - BOCOffer class with structured validity periods
 * - PeriodParser for date range extraction
 * - Geocoding support
 * - Detail page scraping with Cheerio
 * - Unique SHA-256 IDs (unchanged - stable!)
 *
 * Requires: npm install axios cheerio p-limit
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
const log = createLogger('boc');

// p-limit might be ESM or CJS depending on version
let pLimit;
try {
  pLimit = require('p-limit');
  if (pLimit.default) pLimit = pLimit.default;
} catch (e) {
  pLimit = (concurrency) => {
    const queue = [];
    let active = 0;
    const next = () => {
      active--;
      if (queue.length > 0) {
        const { fn, resolve, reject } = queue.shift();
        run(fn, resolve, reject);
      }
    };
    const run = async (fn, resolve, reject) => {
      active++;
      try { resolve(await fn()); }
      catch (error) { reject(error); }
      finally { next(); }
    };
    return (fn) => new Promise((resolve, reject) => {
      if (active < concurrency) run(fn, resolve, reject);
      else queue.push({ fn, resolve, reject });
    });
  };
}

const CONFIG = {
  maxRetries: 3,
  retryDelay: 1000,
  timeout: 15000,
  delayBetweenRequests: 1000,
  cacheDir: './cache_boc',
  geoCacheDir: './cache_boc/geocode',
  cacheExpiry: 24 * 60 * 60 * 1000,
  useCache: true,
  concurrentDetailRequests: 5,
  concurrentGeoRequests: 3,
  googleApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
  geocodingEnabled: false
};

// Create cache directories
[CONFIG.cacheDir, CONFIG.geoCacheDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// All BOC card offer categories
const BOC_CATEGORIES = [
  { name: 'Travel and Leisure', slug: 'travel-and-leisure' },
  { name: 'Supermarkets', slug: 'supermarkets' },
  { name: 'Lifestyle', slug: 'lifestyle' },
  { name: 'Utility & Insurance', slug: 'utility-insurance' },
  { name: 'Education', slug: 'education' },
  { name: 'Zero Plans', slug: 'zero-plans' },
  { name: 'Online', slug: 'online' },
  { name: 'Fashion', slug: 'fashion' },
  { name: 'Health & Beauty', slug: 'health-beauty' },
  { name: 'Automobile', slug: 'automobile' },
  { name: 'Dining', slug: 'dining' }
];

const MONTH_MAP = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

// ─── Cache Utilities ───────────────────────────────────────────────────────

function getCacheKey(input) {
  return crypto.createHash('md5').update(input).digest('hex');
}

function getCachePath(input, cacheDir = CONFIG.cacheDir) {
  return path.join(cacheDir, `${getCacheKey(input)}.json`);
}

function isCacheValid(cachePath, ignoreExpiry = false) {
  if (!fs.existsSync(cachePath)) return false;
  if (ignoreExpiry) return true;
  const stats = fs.statSync(cachePath);
  return (Date.now() - stats.mtime.getTime()) < CONFIG.cacheExpiry;
}

function saveToCache(input, data, cacheDir = CONFIG.cacheDir) {
  fs.writeFileSync(getCachePath(input, cacheDir), JSON.stringify({
    input, data, cachedAt: new Date().toISOString()
  }, null, 2));
}

function loadFromCache(input, cacheDir = CONFIG.cacheDir, ignoreExpiry = false) {
  const cachePath = getCachePath(input, cacheDir);
  if (!CONFIG.useCache || !isCacheValid(cachePath, ignoreExpiry)) return null;
  return JSON.parse(fs.readFileSync(cachePath, 'utf8')).data;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Unique ID Generation (UNCHANGED from v5 - stable!) ────────────────────

function generateUniqueOfferId(offer) {
  // Use only the URL slug — the bank's own stable page identifier.
  // title/expirationDate/location are volatile and caused duplicate rows when
  // a bank updated offer wording between scrapes.
  const urlMatch = offer.url ? offer.url.match(/\/([^/]+)\/product$/) : null;
  const urlId = urlMatch ? urlMatch[1] : null;
  if (urlId) {
    return `boc_${urlId}`;
  }
  // Fallback: hash of URL only (no title/dates) when slug pattern doesn't match.
  const hash = crypto.createHash('sha256')
    .update(('boc|' + (offer.url || '')).toLowerCase().trim())
    .digest('hex');
  return `boc_${hash.substring(0, 16)}`;
}

// ─── Enhanced Contact & Location Parsing (NEW in v6) ────────────────────────

/**
 * Parse location from detail page text
 * Handles formats like: "Location : No 106A, Templers Road, Mt. Lavinia - Contact No : ..."
 */
function parseLocation(descriptionLines) {
  for (const line of descriptionLines) {
    // Pattern: "Location : ADDRESS" or "Location: ADDRESS" or just "ADDRESS - Contact No:"
    const locationMatch = line.match(/(?:Location\s*:\s*)([^-]+?)(?:\s*-\s*Contact|\s*$)/i);
    if (locationMatch) {
      return locationMatch[1].trim();
    }

    // Alternative: look for address-like patterns (with "No" or street names)
    if (/No\s+\d+[A-Z]?,/.test(line) || /Road|Street|Avenue|Lane/i.test(line)) {
      // Extract before "Contact" if present
      const beforeContact = line.split(/Contact\s*(?:No)?:/i)[0].trim();
      if (beforeContact.length > 5 && beforeContact.length < 200) {
        return beforeContact.replace(/^Location\s*:\s*/i, '').trim();
      }
    }
  }
  return null;
}

/**
 * Parse contact numbers from detail page text
 * Handles formats like: "Contact No : 077 371 0139 / 011 273 8622"
 */
function parseContactNumbers(descriptionLines) {
  const contacts = [];

  for (const line of descriptionLines) {
    // Pattern: "Contact No : NUMBERS" or "Contact: NUMBERS"
    const contactMatch = line.match(/Contact\s*(?:No)?:\s*([0-9\s/,]+)/i);
    if (contactMatch) {
      const numbersText = contactMatch[1].trim();
      // Split by / or , and clean each number
      const numbers = numbersText.split(/[\/,]/)
        .map(n => n.trim().replace(/\s+/g, ' '))
        .filter(n => n.match(/\d{7,}/)); // At least 7 digits
      contacts.push(...numbers);
    }

    // Also extract phone numbers from anywhere in the line
    const phoneMatches = line.match(/\b\d{3}\s*\d{3}\s*\d{4}\b|\b\d{2}\s*\d{3}\s*\d{4}\b/g);
    if (phoneMatches) {
      phoneMatches.forEach(p => {
        const cleaned = p.replace(/\s+/g, ' ').trim();
        if (!contacts.includes(cleaned)) contacts.push(cleaned);
      });
    }
  }

  return [...new Set(contacts)]; // Remove duplicates
}

// ─── Geocoding (from v5, unchanged) ─────────────────────────────────────────

let geocodingStats = { cached: 0, new: 0, failed: 0 };

async function geocodeLocation(locationName, phone = '', retryCount = 0) {
  if (!CONFIG.geocodingEnabled || !CONFIG.googleApiKey) return null;

  const normalizedLocation = locationName.toLowerCase().trim();
  const cacheKey = crypto.createHash('md5')
    .update(`${normalizedLocation}_${phone}`)
    .digest('hex');
  const cachePath = path.join(CONFIG.geoCacheDir, `${cacheKey}.json`);

  if (fs.existsSync(cachePath)) {
    try {
      geocodingStats.cached++;
      return JSON.parse(fs.readFileSync(cachePath, 'utf8')).data;
    } catch (error) { /* corrupted cache */ }
  }

  try {
    let searchQuery = locationName;
    if (!searchQuery.toLowerCase().includes('sri lanka')) searchQuery += ', Sri Lanka';

    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: { address: searchQuery, key: CONFIG.googleApiKey, region: 'lk' },
      timeout: 10000
    });

    if (response.data.status === 'OK' && response.data.results.length > 0) {
      const result = response.data.results[0];
      const geoData = {
        original_address: locationName,
        formatted_address: result.formatted_address,
        latitude: result.geometry.location.lat,
        longitude: result.geometry.location.lng,
        place_id: result.place_id,
        types: result.types,
        cached_at: new Date().toISOString()
      };
      fs.writeFileSync(cachePath, JSON.stringify({ input: locationName, data: geoData }, null, 2));
      geocodingStats.new++;
      return geoData;
    } else {
      fs.writeFileSync(cachePath, JSON.stringify({
        input: locationName,
        data: { original_address: locationName, status: 'NOT_FOUND', cached_at: new Date().toISOString() }
      }, null, 2));
      geocodingStats.failed++;
      return null;
    }
  } catch (error) {
    if (error.response?.status === 429 && retryCount < CONFIG.maxRetries) {
      await sleep(2000 * (retryCount + 1));
      return geocodeLocation(locationName, phone, retryCount + 1);
    }
    geocodingStats.failed++;
    return null;
  }
}

// ─── HTML Fetcher ──────────────────────────────────────────────────────────

async function fetchHTML(url, retryCount = 0) {
  const cached = loadFromCache(url);
  if (cached) return { html: cached, fromCache: true };

  try {
    await sleep(CONFIG.delayBetweenRequests);
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html'
      },
      timeout: CONFIG.timeout
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

// ─── PeriodParser (from v5, unchanged) ─────────────────────────────────────

class PeriodParser {
  static parseHumanDate(text, fallbackYear = null) {
    if (!text) return null;
    const cleaned = text.replace(/(\d+)(?:st|nd|rd|th)/gi, '$1').trim();

    // "20 Dec 2026" or "31 December 2026"
    const match = cleaned.match(/(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?/i);
    if (!match) return null;

    const day = parseInt(match[1], 10);
    const monthKey = match[2].toLowerCase();
    const month = MONTH_MAP[monthKey];
    const year = match[3] ? parseInt(match[3], 10) : (fallbackYear || new Date().getFullYear());

    if (month === undefined || day < 1 || day > 31) return null;

    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  static extractYear(text) {
    const m = text.match(/\b(20\d{2})\b/);
    return m ? parseInt(m[1], 10) : null;
  }

  static extractPeriodFromDescription(descriptionLines) {
    for (const line of descriptionLines) {
      const fromToMatch = line.match(/from\s+(.+?)\s+to\s+(.+)/i);
      if (fromToMatch) {
        return { rawLine: line, fromPart: fromToMatch[1].trim(), toPart: fromToMatch[2].trim() };
      }
    }
    return null;
  }

  static parseExpirationDate(expText) {
    if (!expText || expText.trim().length === 0) return null;
    return PeriodParser.parseHumanDate(expText, new Date().getFullYear());
  }

  static parse(descriptionLines, expirationDate) {
    const today = new Date().toISOString().split('T')[0];
    const expDate = PeriodParser.parseExpirationDate(expirationDate);

    const periodInfo = PeriodParser.extractPeriodFromDescription(descriptionLines);

    if (periodInfo) {
      const engine = PeriodEngine.parse(periodInfo.rawLine, { defaultPeriodType: 'offer', today });
      if (engine.length > 0) {
        return engine.map(p => new OfferValidity(p));
      }
      const year = PeriodParser.extractYear(periodInfo.rawLine) || new Date().getFullYear();
      let fromDate = null;
      let toDate = null;

      toDate = PeriodParser.parseHumanDate(periodInfo.toPart, year);
      fromDate = PeriodParser.parseHumanDate(periodInfo.fromPart, year);

      if (!fromDate && toDate) {
        const dayMatch = periodInfo.fromPart.match(/(\d{1,2})/);
        if (dayMatch) {
          const toMonth = toDate.substring(5, 7);
          const toYear = toDate.substring(0, 4);
          const day = String(parseInt(dayMatch[1], 10)).padStart(2, '0');
          fromDate = `${toYear}-${toMonth}-${day}`;
        }
      }

      if (fromDate && toDate && fromDate > toDate) fromDate = toDate;

      return [new OfferValidity({
        valid_from: fromDate || today,
        valid_to: toDate || expDate,
        period_type: 'offer',
        recurrence_type: 'daily',
        raw_period_text: periodInfo.rawLine
      })];
    }

    let fromDate = today;
    const toDate = expDate;

    if (fromDate && toDate && fromDate > toDate) fromDate = toDate;

    if (expirationDate) {
      const engine = PeriodEngine.parse(`Till ${expirationDate}`, { defaultPeriodType: 'offer', today });
      if (engine.length > 0) {
        return engine.map(p => new OfferValidity(p));
      }
    }

    return [new OfferValidity({
      valid_from: fromDate,
      valid_to: toDate,
      period_type: 'offer',
      recurrence_type: 'daily',
      raw_period_text: expirationDate ? `Till ${expirationDate}` : ''
    })];
  }
}

// ─── OfferValidity ─────────────────────────────────────────────────────────

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
    return true;
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

// ─── BOCOffer v6 ───────────────────────────────────────────────────────────

class BOCOffer {
  constructor(rawOffer, category) {
    this.unique_id = rawOffer.unique_id;
    this.source = 'BOC';
    this.source_url = rawOffer.url ? `https://www.boc.lk${rawOffer.url}` : null;
    this.category = category.name;
    this.category_slug = category.slug;
    this.scraped_at = rawOffer.scraped_at;

    // Basic offer info
    this.title = rawOffer.title;
    this.offer_value = rawOffer.offerValue;
    this.image_url = rawOffer.imageUrl;

    // Merchant info (ENHANCED in v6)
    this.merchant = {
      name: rawOffer.title,
      full_address: rawOffer.fullAddress || null,
      location_name: rawOffer.location || rawOffer.title,
      addresses: rawOffer.addresses || [],
      contact_numbers: rawOffer.contactNumbers || [],
      primary_contact: rawOffer.contactNumbers?.[0] || null
    };

    // Offer details
    this.description = rawOffer.description.join('\n');
    this.expiration_date_raw = rawOffer.expirationDate;
    this.geocoding = rawOffer.geocoding || null;

    // Parse validity periods
    this.validities = PeriodParser.parse(rawOffer.description, rawOffer.expirationDate);
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
      offer_value: this.offer_value,
      image_url: this.image_url,
      merchant: this.merchant,
      description: this.description,
      expiration_date_raw: this.expiration_date_raw,
      geocoding: this.geocoding,
      validities: this.validities.map(v => v.toJSON())
    };
  }
}

// ─── Offer Detail Scraping (ENHANCED in v6) ────────────────────────────────

async function scrapeOfferDetail(offerUrl, index, total) {
  try {
    const { html, fromCache } = await fetchHTML(offerUrl);
    const $ = cheerio.load(html);

    const section = $('.white-section').first();
    if (section.length === 0) return null;

    const logoSection = section.find('.offer-logo-info .offer-logo');
    const title = logoSection.find('h2').text().trim();
    const imageUrl = logoSection.find('img').attr('src') || '';

    const infoSection = section.find('.offer-logo-info .offer-info');
    const offerValue = infoSection.find('.offer-value strong').text().trim();
    const expireText = infoSection.find('.offer-expire strong').text().trim();

    const detailsSection = section.find('.offer-txt-info .expand-block');
    const description = [];
    detailsSection.find('p').each((i, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 0) description.push(text);
    });

    // ENHANCED v6: Parse location and contacts using new functions and AddressEngine
    const initialLocation = parseLocation(description);
    const contactNumbers = parseContactNumbers(description);

    // Fallback location from card listing
    const locationMatch = $('.location-name, .product-detail .location-name').first().text();
    const listingLocation = locationMatch || title;

    // Use AddressEngine for multi-location extraction
    const rawAddressText = (initialLocation || '') + ' ' + description.join(' ') + ' ' + (listingLocation || '');
    const extractedAddresses = AddressEngine.extract(rawAddressText, title);
    const fullAddress = extractedAddresses[0] || initialLocation;
    const location = extractedAddresses[0] ? extractedAddresses[0].split(',')[0].trim() : listingLocation;


    const rawOffer = {
      url: offerUrl,
      title,
      offerValue,
      expirationDate: expireText,
      imageUrl,
      fullAddress,
      addresses: extractedAddresses,
      contactNumbers,
      location,
      description,

      scraped_at: new Date().toISOString(),
      from_cache: fromCache,
      geocoding: null,
      _raw_html: section.html()
    };

    rawOffer.unique_id = generateUniqueOfferId(rawOffer);

    if (index % 5 === 0 || index === total) {
      process.stdout.write(`  Scraped: ${index}/${total}\r`);
    }

    return rawOffer;
  } catch (error) {
    console.error(`    Error scraping ${offerUrl}: ${error.message}`);
    return null;
  }
}

async function scrapeOffersInParallel(offerUrls) {
  const limit = pLimit(CONFIG.concurrentDetailRequests);
  const total = offerUrls.length;
  const promises = offerUrls.map((url, index) =>
    limit(() => scrapeOfferDetail(url, index + 1, total))
  );
  const results = await Promise.all(promises);
  return results.filter(r => r !== null);
}

// ─── Category Listing Scraper ──────────────────────────────────────────────

async function scrapeCategoryListing(categoryUrl) {
  const { html } = await fetchHTML(categoryUrl);
  const $ = cheerio.load(html);
  const offerLinks = [];

  $('.swiper-slide.product a, a.swiper-slide.product').each((i, el) => {
    const href = $(el).attr('href');
    if (href && href.includes('/product')) {
      offerLinks.push(href);
    }
  });

  return [...new Set(offerLinks)];
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║   BOC Scraper v6.0 - Enhanced Contact & Location  ║');
  console.log('║   ✓ Better address parsing from detail pages      ║');
  console.log('║   ✓ Multiple contact numbers extracted            ║');
  console.log('║   ✓ Structured merchant info                      ║');
  console.log('║   ✓ Source URL tracking                           ║');
  console.log('║   + All v5 features (validity, geocoding)         ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  const args = process.argv.slice(2);

  if (args.includes('--clear-cache')) {
    [CONFIG.cacheDir, CONFIG.geoCacheDir].forEach(dir => {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        files.forEach(f => fs.unlinkSync(path.join(dir, f)));
        console.log(`Cleared ${files.length} files from ${dir}`);
      }
    });
    return;
  }

  if (args.includes('--no-cache')) {
    CONFIG.useCache = false;
    console.log('Cache disabled\n');
  }

  const googleKeyArg = args.find(arg => arg.startsWith('--google-api-key='));
  if (googleKeyArg) {
    CONFIG.googleApiKey = googleKeyArg.split('=')[1];
    CONFIG.geocodingEnabled = true;
  }
  if (args.includes('--no-geo')) CONFIG.geocodingEnabled = false;

  let categoriesToScrape = BOC_CATEGORIES;
  const categoryArg = args.find(arg => arg.startsWith('--category='));
  if (categoryArg) {
    const slug = categoryArg.split('=')[1];
    categoriesToScrape = BOC_CATEGORIES.filter(c => c.slug === slug);
    if (categoriesToScrape.length === 0) categoriesToScrape = [{ name: slug, slug }];
  }

  console.log(`Scraping ${categoriesToScrape.length} categories...\n`);

  const startTime = Date.now();
  const allBOCOffers = [];
  const allRawOffers = [];
  const categorySummary = {};
  let statsWithAddress = 0;
  let statsWithMultipleContacts = 0;

  for (const cat of categoriesToScrape) {
    const baseUrl = `https://www.boc.lk/personal-banking/card-offers/${cat.slug}`;
    log.info('Category', `Starting: ${cat.name}`, { slug: cat.slug, url: baseUrl });

    try {
      log.debug('HTTP', `Fetching listing: ${cat.slug}`);
      const offerUrls = await scrapeCategoryListing(baseUrl);
      log.info('Parser', `Found ${offerUrls.length} offers in ${cat.name}`, { count: offerUrls.length });

      if (offerUrls.length === 0) {
        log.warn('Parser', `No offers found in ${cat.name}`);
        categorySummary[cat.name] = 0;
        continue;
      }

      log.debug('Scraper', `Fetching details for ${offerUrls.length} offers...`);
      const rawOffers = await scrapeOffersInParallel(offerUrls);
      log.info('Scraper', `Scraped ${rawOffers.length} offer details`, { count: rawOffers.length });

      // Geocode if enabled
      if (CONFIG.geocodingEnabled) {
        log.info('Geocoder', `Geocoding ${rawOffers.length} locations...`);
        const geocodeLimit = pLimit(CONFIG.concurrentGeoRequests);
        await Promise.all(rawOffers.map(offer =>
          geocodeLimit(async () => {
            const locationToGeocode = offer.fullAddress || offer.location;
            if (locationToGeocode) {
              offer.geocoding = await geocodeLocation(locationToGeocode, offer.contactNumbers[0] || '');
            }
          })
        ));
      }

      const bocOffers = rawOffers.map(raw => new BOCOffer(raw, cat));

      // Collect stats
      bocOffers.forEach(o => {
        if (o.merchant.full_address) statsWithAddress++;
        if (o.merchant.contact_numbers.length > 1) statsWithMultipleContacts++;
      });

      allBOCOffers.push(...bocOffers);
      allRawOffers.push(...rawOffers);
      categorySummary[cat.name] = bocOffers.length;
      log.success('Category', `${cat.name} done`, { count: bocOffers.length, withAddress: bocOffers.filter(o => o.merchant.full_address).length });

    } catch (error) {
      log.error('Category', `Failed: ${cat.name} — ${error.message}`, { stack: error.stack?.split('\n')[1] });
      categorySummary[cat.name] = 0;
    }

    await sleep(1000);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  // Save output
  const outputDir = './output';
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  console.log('\n📁 Saving output...');

  // All offers
  fs.writeFileSync(
    path.join(outputDir, 'boc_all_v6.json'),
    JSON.stringify({
      processedAt: new Date().toISOString(),
      stats: {
        totalOffers: allBOCOffers.length,
        withFullAddress: statsWithAddress,
        withMultipleContacts: statsWithMultipleContacts,
        geocodingEnabled: CONFIG.geocodingEnabled,
        geocodingStats: CONFIG.geocodingEnabled ? geocodingStats : null,
        duration
      },
      offers: allBOCOffers.map(o => o.toJSON())
    }, null, 2)
  );
  console.log(`  ✓ boc_all_v6.json`);

  // Per-category files
  BOC_CATEGORIES.forEach(cat => {
    const catOffers = allBOCOffers.filter(o => o.category_slug === cat.slug);
    if (catOffers.length > 0) {
      const filename = `boc_${cat.slug}_v6.json`;
      fs.writeFileSync(
        path.join(outputDir, filename),
        JSON.stringify({
          category: cat.name,
          totalOffers: catOffers.length,
          processedAt: new Date().toISOString(),
          offers: catOffers.map(o => o.toJSON())
        }, null, 2)
      );
      console.log(`  ✓ ${filename}`);
    }
  });

  // Summary
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║                 SUMMARY REPORT                     ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  Object.entries(categorySummary).forEach(([cat, count]) => {
    console.log(`  ${cat.padEnd(25)}: ${count.toString().padStart(4)} offers`);
  });

  console.log('\n' + '─'.repeat(60));
  console.log(`  Total offers              : ${allBOCOffers.length}`);
  console.log(`  ── NEW v6 Enhancements ──`);
  console.log(`     With full addresses    : ${statsWithAddress} (${(statsWithAddress / allBOCOffers.length * 100).toFixed(1)}%)`);
  console.log(`     With multiple contacts : ${statsWithMultipleContacts} (${(statsWithMultipleContacts / allBOCOffers.length * 100).toFixed(1)}%)`);
  if (CONFIG.geocodingEnabled) {
    console.log(`  ── Geocoding Stats ──`);
    console.log(`     Cached                 : ${geocodingStats.cached}`);
    console.log(`     New                    : ${geocodingStats.new}`);
    console.log(`     Failed                 : ${geocodingStats.failed}`);
  }
  console.log(`  Time taken                : ${duration}s`);
  console.log('─'.repeat(60));

  console.log('\n✨ v6 completed!');
  console.log(`\n📋 Usage:`);
  console.log(`   --category=<slug>      Specific category`);
  console.log(`   --no-cache             Fresh downloads`);
  console.log(`   --google-api-key=KEY   Enable geocoding`);
  console.log(`   --no-geo               Disable geocoding`);
  console.log(`   --clear-cache          Clear all cache\n`);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { BOCOffer, OfferValidity, PeriodParser, scrapeOfferDetail };
