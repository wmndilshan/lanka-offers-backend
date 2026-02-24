/**
 * BOC Bank Card Offers Scraper v5.0 - BOCOffer + PeriodParser
 * Features:
 * - BOCOffer class with structured validity periods
 * - PeriodParser for date range extraction from descriptions
 * - All categories scraped
 * - DB-ready validity rows (same schema as HNB v5)
 * - OfferValidity.isActiveOn(date) for querying
 * Requires: npm install axios cheerio p-limit
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

// ─── Unique ID Generation ──────────────────────────────────────────────────

function generateUniqueOfferId(offer) {
  const components = [
    'boc',
    offer.url || '',
    offer.title || '',
    offer.expirationDate || '',
    offer.location || ''
  ];
  const hash = crypto.createHash('sha256')
    .update(components.join('|').toLowerCase().trim())
    .digest('hex');
  const urlMatch = offer.url ? offer.url.match(/\/([^/]+)\/product$/) : null;
  const urlId = urlMatch ? urlMatch[1].substring(0, 15) : 'offer';
  return `boc_${hash.substring(0, 12)}_${urlId}`;
}

// ─── Geocoding ─────────────────────────────────────────────────────────────

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

// ─── HTML Fetching ─────────────────────────────────────────────────────────

async function fetchHTML(url, retryCount = 0) {
  const cachedHTML = loadFromCache(url);
  if (cachedHTML) return { html: cachedHTML, fromCache: true };

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
      const delay = CONFIG.retryDelay * (retryCount + 1);
      console.log(`  Retry in ${delay}ms (${retryCount + 1}/${CONFIG.maxRetries})`);
      await sleep(delay);
      return fetchHTML(url, retryCount + 1);
    }
    throw error;
  }
}

// ─── Pagination & URL Extraction ───────────────────────────────────────────

async function extractOfferUrlsFromPage(pageUrl) {
  try {
    const { html } = await fetchHTML(pageUrl);
    const $ = cheerio.load(html);
    const urls = [];
    $('a.swiper-slide.product').each((i, el) => {
      const href = $(el).attr('href');
      if (href && href.includes('/product')) {
        urls.push(href.startsWith('http') ? href : `https://www.boc.lk${href}`);
      }
    });
    return urls;
  } catch (error) {
    console.error(`    Error fetching page: ${error.message}`);
    return [];
  }
}

async function getAllOffersFromPagination(baseUrl, maxPages = 100) {
  const allUrls = [];
  let page = 0;
  let hasMorePages = true;

  while (hasMorePages && page < maxPages) {
    const pageUrl = `${baseUrl}?page=${page}`;
    const pageUrls = await extractOfferUrlsFromPage(pageUrl);
    if (pageUrls.length === 0) {
      hasMorePages = false;
    } else {
      allUrls.push(...pageUrls);
      page++;
      await sleep(CONFIG.delayBetweenRequests);
    }
  }
  return [...new Set(allUrls)];
}

// ─── PeriodParser ──────────────────────────────────────────────────────────
// Parses BOC date formats:
//   "From 12th January to 20th December 2026"
//   "From 01st October 2025 to 31st March 2026"
//   "From 01st to 28th February 2026"
//   expiration_date: "20 Dec 2026"

class PeriodParser {
  /**
   * Parse "28th February 2026" or "28 Feb 2026" into "2026-02-28"
   */
  static parseHumanDate(text, fallbackYear) {
    const cleaned = text.replace(/(\d+)(?:st|nd|rd|th)/gi, '$1').trim();
    // "28 February 2026" or "28 Feb 2026"
    const m = cleaned.match(/(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s*(\d{4})?/i);
    if (!m) return null;
    const day = parseInt(m[1], 10);
    const month = MONTH_MAP[m[2].toLowerCase()];
    const year = m[3] ? parseInt(m[3], 10) : fallbackYear || new Date().getFullYear();
    if (month === undefined) return null;
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  /**
   * Extract year from text
   */
  static extractYear(text) {
    const m = text.match(/\b(20\d{2})\b/);
    return m ? parseInt(m[1], 10) : null;
  }

  /**
   * Extract period from description lines.
   * Looks for "From X to Y" pattern.
   */
  static extractPeriodFromDescription(descriptionLines) {
    for (const line of descriptionLines) {
      // Pattern 1: "From DDth Month YYYY to DDth Month YYYY"
      // Pattern 2: "From DDth Month to DDth Month YYYY"
      // Pattern 3: "From DDth to DDth Month YYYY" (same month)
      const fromToMatch = line.match(/from\s+(.+?)\s+to\s+(.+)/i);
      if (fromToMatch) {
        return { rawLine: line, fromPart: fromToMatch[1].trim(), toPart: fromToMatch[2].trim() };
      }
    }
    return null;
  }

  /**
   * Parse expiration date "20 Dec 2026" -> "2026-12-20"
   */
  static parseExpirationDate(expText) {
    if (!expText || expText.trim().length === 0) return null;
    return PeriodParser.parseHumanDate(expText, new Date().getFullYear());
  }

  /**
   * Main parser: given description lines + expiration date, return OfferValidity[]
   */
  static parse(descriptionLines, expirationDate) {
    const today = new Date().toISOString().split('T')[0];
    const expDate = PeriodParser.parseExpirationDate(expirationDate);

    // Try to extract "From X to Y" from description
    const periodInfo = PeriodParser.extractPeriodFromDescription(descriptionLines);

    if (periodInfo) {
      const year = PeriodParser.extractYear(periodInfo.rawLine) || new Date().getFullYear();
      let fromDate = null;
      let toDate = null;

      // Parse the "to" part first (usually has month + year)
      toDate = PeriodParser.parseHumanDate(periodInfo.toPart, year);

      // Parse the "from" part
      fromDate = PeriodParser.parseHumanDate(periodInfo.fromPart, year);

      // Handle same-month pattern: "From 01st to 28th February 2026"
      // In this case, fromPart is just "01st" (no month), so parseHumanDate returns null
      if (!fromDate && toDate) {
        const dayMatch = periodInfo.fromPart.match(/(\d{1,2})/);
        if (dayMatch) {
          // Use the month and year from the toDate
          const toMonth = toDate.substring(5, 7);
          const toYear = toDate.substring(0, 4);
          const day = String(parseInt(dayMatch[1], 10)).padStart(2, '0');
          fromDate = `${toYear}-${toMonth}-${day}`;
        }
      }

      // Clamp: if from > to (expired offer), set from = to
      if (fromDate && toDate && fromDate > toDate) fromDate = toDate;

      return [new OfferValidity({
        valid_from: fromDate || today,
        valid_to: toDate || expDate,
        period_type: 'offer',
        recurrence_type: 'daily',
        raw_period_text: periodInfo.rawLine
      })];
    }

    // No period in description - use expiration date only
    // valid_from = today (or earlier if we had it), valid_to = expiration date
    let fromDate = today;
    const toDate = expDate;

    // Clamp
    if (fromDate && toDate && fromDate > toDate) fromDate = toDate;

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
}

// ─── BOCOffer ──────────────────────────────────────────────────────────────

class BOCOffer {
  constructor(rawOffer, category) {
    this.unique_id = rawOffer.unique_id;
    this.source = 'BOC';
    this.source_url = rawOffer.url;
    this.category = category.name;
    this.category_slug = category.slug;
    this.scraped_at = rawOffer.scraped_at;

    this.title = rawOffer.title;
    this.offer_value = rawOffer.offerValue;
    this.image_url = rawOffer.imageUrl;

    this.phone = rawOffer.phone;
    this.location = rawOffer.location;
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
      phone: this.phone,
      location: this.location,
      description: this.description,
      expiration_date_raw: this.expiration_date_raw,
      geocoding: this.geocoding,
      validities: this.validities
    };
  }
}

// ─── Offer Detail Scraping ─────────────────────────────────────────────────

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

    let phone = '';
    description.forEach(line => {
      const phoneMatch = line.match(/(\d{3}\s*\d{3}\s*\d{4}|\d{2}\s*\d{3}\s*\d{4})/g);
      if (phoneMatch && !phone) phone = phoneMatch.join(' / ');
    });

    const locationMatch = $('.location-name, .product-detail .location-name').first().text();
    const location = locationMatch || title;

    const rawOffer = {
      url: offerUrl,
      title,
      offerValue,
      expirationDate: expireText,
      imageUrl,
      phone,
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

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║   BOC Scraper v5.0 - BOCOffer + PeriodParser       ║');
  console.log('║   ✓ Structured validity periods (DB-ready)        ║');
  console.log('║   ✓ All categories scraped                        ║');
  console.log('║   ✓ OfferValidity.isActiveOn(date) queries        ║');
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

  for (const cat of categoriesToScrape) {
    const baseUrl = `https://www.boc.lk/personal-banking/card-offers/${cat.slug}`;
    console.log(`\n============================================================`);
    console.log(`Category: ${cat.name}`);
    console.log(`============================================================`);

    const offerUrls = await getAllOffersFromPagination(baseUrl);
    if (offerUrls.length === 0) {
      categorySummary[cat.name] = 0;
      continue;
    }

    console.log(`  Pages done. ${offerUrls.length} offers found.`);
    const rawOffers = await scrapeOffersInParallel(offerUrls);
    console.log(`  Scraped ${rawOffers.length} offer details.`);

    // Build BOCOffer objects
    const bocOffers = rawOffers.map(raw => new BOCOffer(raw, cat));
    allBOCOffers.push(...bocOffers);
    allRawOffers.push(...rawOffers);
    categorySummary[cat.name] = bocOffers.length;
    console.log(`  ${bocOffers.length} BOCOffer objects built.`);
  }

  // Geocode if enabled
  if (CONFIG.geocodingEnabled && allBOCOffers.length > 0) {
    console.log('\nGeocoding...');
    const limit = pLimit(CONFIG.concurrentGeoRequests);
    const promises = allBOCOffers.map(offer =>
      limit(async () => {
        const geo = await geocodeLocation(offer.location, offer.phone);
        offer.geocoding = geo;
      })
    );
    await Promise.all(promises);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  // ── Save output ─────────────────────────────────────────────────────
  const outputDir = './output';
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // 1. All offers as BOCOffer JSON
  const allFile = path.join(outputDir, 'boc_all_v5.json');
  fs.writeFileSync(allFile, JSON.stringify({
    metadata: {
      source: 'BOC',
      scraped_at: new Date().toISOString(),
      total_offers: allBOCOffers.length,
      categories: categorySummary,
      scrape_duration: `${duration}s`
    },
    offers: allBOCOffers.map(o => o.toJSON())
  }, null, 2));
  console.log(`\n  Saved: ${allFile}`);

  // 2. Flattened validity rows (DB-ready)
  const validityRows = [];
  allBOCOffers.forEach(offer => {
    offer.validities.forEach(v => {
      validityRows.push({
        offer_unique_id: offer.unique_id,
        offer_source_id: offer.unique_id,
        offer_title: offer.title,
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

  const rowsFile = path.join(outputDir, 'boc_validity_rows_v5.json');
  fs.writeFileSync(rowsFile, JSON.stringify({
    totalRows: validityRows.length,
    rows: validityRows
  }, null, 2));
  console.log(`  Saved: ${rowsFile} (${validityRows.length} rows)`);

  // 3. Raw data
  const rawFile = path.join(outputDir, 'boc_raw_v5.json');
  fs.writeFileSync(rawFile, JSON.stringify({
    metadata: { source: 'BOC', scraped_at: new Date().toISOString(), total: allRawOffers.length },
    offers: allRawOffers
  }, null, 2));
  console.log(`  Saved: ${rawFile}`);

  // 4. Per-category files
  for (const [catName, count] of Object.entries(categorySummary)) {
    if (count === 0) continue;
    const slug = BOC_CATEGORIES.find(c => c.name === catName)?.slug || catName.toLowerCase().replace(/\s+/g, '-');
    const catOffers = allBOCOffers.filter(o => o.category === catName);
    const catFile = path.join(outputDir, `boc_${slug.replace(/-/g, '_')}_v5.json`);
    fs.writeFileSync(catFile, JSON.stringify(catOffers.map(o => o.toJSON()), null, 2));
    console.log(`  Saved: ${catFile}`);
  }

  // ── Summary ─────────────────────────────────────────────────────────
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║                 SUMMARY REPORT                     ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  for (const [name, count] of Object.entries(categorySummary)) {
    if (count > 0) console.log(`  ${name.padEnd(25)} : ${count} offers`);
  }
  console.log(`\n  Total offers              : ${allBOCOffers.length}`);
  console.log(`  Total validity rows       : ${validityRows.length}`);
  console.log(`  Time taken                : ${duration}s`);

  // Active today count
  const today = new Date().toISOString().split('T')[0];
  const activeToday = allBOCOffers.filter(o => o.isActiveOn(today)).length;
  console.log(`\n  Active today (${today}): ${activeToday}/${allBOCOffers.length} offers`);

  if (allBOCOffers.length > 0) {
    console.log('\n  Sample (first 5):');
    allBOCOffers.slice(0, 5).forEach(o => {
      const v = o.validities[0];
      console.log(`    - ${o.title} | ${v.valid_from} to ${v.valid_to}`);
    });
  }

  // Check for issues
  const issues = [];
  validityRows.forEach((r, i) => {
    if (!r.valid_from) issues.push({ row: i, type: 'NULL_FROM' });
    if (!r.valid_to) issues.push({ row: i, type: 'NULL_TO', detail: r.offer_title });
    if (r.valid_from && r.valid_to && r.valid_from > r.valid_to) {
      issues.push({ row: i, type: 'FROM_AFTER_TO', detail: `${r.valid_from} > ${r.valid_to}` });
    }
  });

  if (issues.length > 0) {
    console.log(`\n  Issues found: ${issues.length}`);
    issues.forEach(iss => console.log(`    row ${iss.row}: ${iss.type} ${iss.detail || ''}`));
  } else {
    console.log('\n  No issues found!');
  }

  console.log('\n  Done!\n');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { BOCOffer, OfferValidity, PeriodParser, BOC_CATEGORIES };
