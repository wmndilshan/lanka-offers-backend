/**
 * BOC Bank Card Offers Scraper with Google Geocoding API
 * Features: Pagination, Parallel Processing, Location Geocoding
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
  // Handle default export for newer versions
  if (pLimit.default) pLimit = pLimit.default;
} catch (e) {
  // Fallback: use a simple implementation if p-limit is not available
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
      try {
        const result = await fn();
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        next();
      }
    };
    
    return (fn) => {
      return new Promise((resolve, reject) => {
        if (active < concurrency) {
          run(fn, resolve, reject);
        } else {
          queue.push({ fn, resolve, reject });
        }
      });
    };
  };
}

const CONFIG = {
  maxRetries: 3,
  retryDelay: 1000,
  timeout: 15000,
  delayBetweenRequests: 1000,
  delayBetweenDetailPages: 800,
  cacheDir: './cache_boc',
  geoCacheDir: './cache_geo',
  cacheExpiry: 24 * 60 * 60 * 1000,
  useCache: true,
  
  // Parallel processing config
  concurrentDetailRequests: 5,  // Max concurrent detail page scrapes
  concurrentGeoRequests: 3,     // Max concurrent geocoding requests
  
  // Google Geocoding API
  googleApiKey: process.env.GOOGLE_MAPS_API_KEY || 'YOUR_API_KEY_HERE',
  geocodingEnabled: true
};

// Create cache directories
[CONFIG.cacheDir, CONFIG.geoCacheDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// ============================================
// CACHE UTILITIES
// ============================================

function getCacheKey(url) {
  return crypto.createHash('md5').update(url).digest('hex');
}

function getCachePath(url, cacheDir = CONFIG.cacheDir) {
  return path.join(cacheDir, `${getCacheKey(url)}.json`);
}

function isCacheValid(cachePath) {
  if (!fs.existsSync(cachePath)) return false;
  const stats = fs.statSync(cachePath);
  return (Date.now() - stats.mtime.getTime()) < CONFIG.cacheExpiry;
}

function saveToCache(url, data, cacheDir = CONFIG.cacheDir) {
  const cachePath = getCachePath(url, cacheDir);
  fs.writeFileSync(cachePath, JSON.stringify({ url, data, cachedAt: new Date().toISOString() }, null, 2));
}

function loadFromCache(url, cacheDir = CONFIG.cacheDir) {
  const cachePath = getCachePath(url, cacheDir);
  if (!CONFIG.useCache || !isCacheValid(cachePath)) return null;
  const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  return cached.data;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// GEOCODING WITH GOOGLE API
// ============================================

async function geocodeLocation(locationName, phone = '', retryCount = 0) {
  if (!CONFIG.geocodingEnabled || !CONFIG.googleApiKey || CONFIG.googleApiKey === 'YOUR_API_KEY_HERE') {
    return null;
  }

  // Check cache first
  const cacheKey = `${locationName}_${phone}`;
  const cached = loadFromCache(cacheKey, CONFIG.geoCacheDir);
  if (cached) {
    console.log(`      🗺️  Geo cache hit: ${locationName}`);
    return cached;
  }

  try {
    // Build search query - prioritize Sri Lanka context
    let searchQuery = locationName;
    if (!searchQuery.toLowerCase().includes('sri lanka')) {
      searchQuery += ', Sri Lanka';
    }

    const url = 'https://maps.googleapis.com/maps/api/geocode/json';
    const response = await axios.get(url, {
      params: {
        address: searchQuery,
        key: CONFIG.googleApiKey,
        region: 'lk'  // Bias results to Sri Lanka
      },
      timeout: 10000
    });

    if (response.data.status === 'OK' && response.data.results.length > 0) {
      const result = response.data.results[0];
      const geoData = {
        formattedAddress: result.formatted_address,
        latitude: result.geometry.location.lat,
        longitude: result.geometry.location.lng,
        placeId: result.place_id,
        types: result.types,
        addressComponents: result.address_components.map(comp => ({
          longName: comp.long_name,
          shortName: comp.short_name,
          types: comp.types
        }))
      };

      // Save to cache
      saveToCache(cacheKey, geoData, CONFIG.geoCacheDir);
      console.log(`      🗺️  Geocoded: ${geoData.formattedAddress}`);
      
      return geoData;
    } else if (response.data.status === 'ZERO_RESULTS') {
      console.log(`      ⚠️  No location found for: ${locationName}`);
      return null;
    } else {
      console.log(`      ⚠️  Geocoding error: ${response.data.status}`);
      return null;
    }

  } catch (error) {
    if (error.response?.status === 429 && retryCount < CONFIG.maxRetries) {
      // Rate limit hit - wait longer and retry
      const delay = 2000 * (retryCount + 1);
      console.log(`      ⏳ Rate limit, retrying in ${delay}ms...`);
      await sleep(delay);
      return geocodeLocation(locationName, phone, retryCount + 1);
    }
    
    console.error(`      ❌ Geocoding error: ${error.message}`);
    return null;
  }
}

// ============================================
// HTML FETCHING
// ============================================

async function fetchHTML(url, retryCount = 0) {
  const cachedHTML = loadFromCache(url);
  if (cachedHTML) return { html: cachedHTML, fromCache: true };

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: CONFIG.timeout,
      maxRedirects: 5
    });

    saveToCache(url, response.data);
    return { html: response.data, fromCache: false };

  } catch (error) {
    if (retryCount < CONFIG.maxRetries) {
      const delay = CONFIG.retryDelay * (retryCount + 1);
      console.log(`  🔄 Retry in ${delay}ms (${retryCount + 1}/${CONFIG.maxRetries})`);
      await sleep(delay);
      return fetchHTML(url, retryCount + 1);
    }
    throw error;
  }
}

// ============================================
// PAGINATION & URL EXTRACTION
// ============================================

async function extractOfferUrlsFromPage(pageUrl) {
  console.log(`\n📋 Fetching page: ${pageUrl}`);
  
  try {
    const { html } = await fetchHTML(pageUrl);
    const $ = cheerio.load(html);
    const urls = [];

    $('a.swiper-slide.product').each((i, el) => {
      const href = $(el).attr('href');
      if (href && href.includes('/product')) {
        const fullUrl = href.startsWith('http') ? href : `https://www.boc.lk${href}`;
        urls.push(fullUrl);
      }
    });

    console.log(`✓ Found ${urls.length} offers on this page`);
    return urls;

  } catch (error) {
    console.error(`❌ Error fetching page: ${error.message}`);
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
      console.log(`\n✓ Pagination complete. No more offers found.`);
    } else {
      allUrls.push(...pageUrls);
      page++;
      await sleep(CONFIG.delayBetweenRequests);
    }
  }

  return [...new Set(allUrls)]; // Remove duplicates
}

// ============================================
// OFFER DETAIL SCRAPING
// ============================================

async function scrapeOfferDetail(offerUrl, index, total) {
  const offerName = offerUrl.substring(offerUrl.lastIndexOf('/') + 1, offerUrl.lastIndexOf('/product'));
  console.log(`\n  [${index}/${total}] Scraping: ${offerName}`);

  try {
    const { html, fromCache } = await fetchHTML(offerUrl);
    const $ = cheerio.load(html);

    const section = $('.white-section').first();

    if (section.length === 0) {
      console.log(`    ⚠️  No white-section found`);
      return null;
    }

    // Extract basic info
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
      if (text && text.length > 0) {
        description.push(text);
      }
    });

    // Extract phone
    let phone = '';
    description.forEach(line => {
      const phoneMatch = line.match(/(\d{3}\s*\d{3}\s*\d{4}|\d{2}\s*\d{3}\s*\d{4})/g);
      if (phoneMatch && !phone) {
        phone = phoneMatch.join(' / ');
      }
    });

    // Location
    const locationMatch = $('.location-name, .product-detail .location-name').first().text();
    const location = locationMatch || title;

    const offer = {
      title,
      url: offerUrl,
      offerValue,
      expirationDate: expireText,
      imageUrl,
      phone,
      location,
      description,
      scrapedAt: new Date().toISOString(),
      fromCache,
      geocoding: null  // Will be populated later
    };

    console.log(`    ✓ ${title} - ${offerValue}`);
    return offer;

  } catch (error) {
    console.error(`    ❌ Error: ${error.message}`);
    return null;
  }
}

// ============================================
// PARALLEL PROCESSING
// ============================================

async function scrapeOffersInParallel(offerUrls) {
  console.log(`\n🚀 Scraping ${offerUrls.length} offers with ${CONFIG.concurrentDetailRequests} concurrent requests...`);
  
  const limit = pLimit(CONFIG.concurrentDetailRequests);
  const total = offerUrls.length;

  const promises = offerUrls.map((url, index) =>
    limit(() => scrapeOfferDetail(url, index + 1, total))
  );

  const results = await Promise.all(promises);
  return results.filter(r => r !== null);
}

async function geocodeOffersInParallel(offers) {
  if (!CONFIG.geocodingEnabled || !CONFIG.googleApiKey || CONFIG.googleApiKey === 'YOUR_API_KEY_HERE') {
    console.log('\n⚠️  Geocoding disabled (no API key)');
    return offers;
  }

  console.log(`\n🗺️  Geocoding ${offers.length} locations with ${CONFIG.concurrentGeoRequests} concurrent requests...`);
  
  const limit = pLimit(CONFIG.concurrentGeoRequests);

  const promises = offers.map((offer, index) =>
    limit(async () => {
      console.log(`\n  [${index + 1}/${offers.length}] Geocoding: ${offer.title}`);
      const geoData = await geocodeLocation(offer.location, offer.phone);
      offer.geocoding = geoData;
      return offer;
    })
  );

  return await Promise.all(promises);
}

// ============================================
// MAIN FUNCTION
// ============================================

async function main() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║   BOC Bank Offers Scraper v2.0                 ║');
  console.log('║   • Auto-pagination                            ║');
  console.log('║   • Parallel Processing                        ║');
  console.log('║   • Google Geocoding API                       ║');
  console.log('╚════════════════════════════════════════════════╝');

  const args = process.argv.slice(2);
  
  // Handle command-line arguments
  if (args.includes('--clear-cache')) {
    [CONFIG.cacheDir, CONFIG.geoCacheDir].forEach(dir => {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        files.forEach(f => fs.unlinkSync(path.join(dir, f)));
        console.log(`🗑️  Cleared ${files.length} files from ${dir}`);
      }
    });
    return;
  }

  if (args.includes('--no-cache')) {
    CONFIG.useCache = false;
    console.log('⚠️  Cache disabled\n');
  }

  if (args.includes('--no-geo')) {
    CONFIG.geocodingEnabled = false;
    console.log('⚠️  Geocoding disabled\n');
  }

  // Parse base URL from arguments
  let baseUrl = 'https://www.boc.lk/personal-banking/card-offers/travel-and-leisure';
  
  const urlIndex = args.indexOf('--url');
  if (urlIndex !== -1 && args[urlIndex + 1]) {
    baseUrl = args[urlIndex + 1];
  }
  
  // Support --category shorthand
  const categoryArg = args.find(arg => arg.startsWith('--category='));
  if (categoryArg) {
    const category = categoryArg.split('=')[1];
    baseUrl = `https://www.boc.lk/personal-banking/card-offers/${category}`;
  }

  console.log(`\n⚙️  Configuration:`);
  console.log(`   Base URL: ${baseUrl}`);
  console.log(`   Concurrent detail scrapes: ${CONFIG.concurrentDetailRequests}`);
  console.log(`   Concurrent geocoding: ${CONFIG.concurrentGeoRequests}`);
  console.log(`   Geocoding: ${CONFIG.geocodingEnabled ? 'Enabled' : 'Disabled'}`);
  console.log(`   Cache: ${CONFIG.useCache ? 'Enabled' : 'Disabled'}\n`);

  const startTime = Date.now();

  // Step 1: Collect all offer URLs
  console.log('📖 STEP 1: Crawling all pages...');
  const allOfferUrls = await getAllOffersFromPagination(baseUrl);

  if (allOfferUrls.length === 0) {
    console.log('❌ No offers found');
    return;
  }

  console.log(`\n✓ Total unique offers found: ${allOfferUrls.length}`);

  // Step 2: Scrape details in parallel
  console.log('\n📝 STEP 2: Scraping offer details (parallel)...');
  let offers = await scrapeOffersInParallel(allOfferUrls);

  // Step 3: Geocode locations in parallel
  if (CONFIG.geocodingEnabled) {
    console.log('\n🗺️  STEP 3: Geocoding locations (parallel)...');
    offers = await geocodeOffersInParallel(offers);
  }

  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  // Step 4: Save results
  console.log('\n\n📊 SUMMARY');
  console.log('═'.repeat(60));
  console.log(`Total offers scraped: ${offers.length}`);
  console.log(`Successfully geocoded: ${offers.filter(o => o.geocoding).length}`);
  console.log(`Total time: ${duration}s`);
  console.log(`Average time per offer: ${(duration / offers.length).toFixed(2)}s`);

  const result = {
    metadata: {
      baseUrl,
      scrapedAt: new Date().toISOString(),
      totalPages: Math.ceil(allOfferUrls.length / 12),
      totalOffers: offers.length,
      geocodingEnabled: CONFIG.geocodingEnabled,
      scrapeDuration: `${duration}s`
    },
    offers
  };

  // Save JSON
  fs.writeFileSync('boc_offers_detailed.json', JSON.stringify(result, null, 2));
  console.log('\n💾 Data saved to: boc_offers_detailed.json');

  // Save CSV
  if (offers.length > 0) {
    const csvHeader = 'Title,Offer,Expiration,Phone,Location,Latitude,Longitude,Address,Description\n';
    const csvRows = offers.map(o => {
      const lat = o.geocoding?.latitude || '';
      const lng = o.geocoding?.longitude || '';
      const addr = o.geocoding?.formattedAddress || '';
      return `"${o.title}","${o.offerValue}","${o.expirationDate}","${o.phone}","${o.location}","${lat}","${lng}","${addr}","${o.description[0] || ''}"`;
    }).join('\n');
    fs.writeFileSync('boc_offers.csv', csvHeader + csvRows);
    console.log('💾 CSV export saved to: boc_offers.csv');
  }

  console.log(`\n✨ Scraping completed in ${duration}s!`);
  console.log(`📦 HTML Cache: ${CONFIG.cacheDir}`);
  console.log(`🗺️  Geo Cache: ${CONFIG.geoCacheDir}`);
  console.log(`⏰ Cache expires after: ${CONFIG.cacheExpiry / (60 * 60 * 1000)} hours\n`);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { 
  getAllOffersFromPagination, 
  scrapeOfferDetail,
  geocodeLocation,
  scrapeOffersInParallel,
  geocodeOffersInParallel
};