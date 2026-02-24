/**
 * BOC Bank Card Offers Scraper - Enhanced Edition
 * Features:
 * - Persistent geo coordinate caching (never expires)
 * - Unique offer IDs (prevents database duplicates)
 * - Parallel processing for speed
 * - Database-ready structure
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
  // Fallback: simple implementation
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
  geoCacheDir: './cache_boc/geocode',
  cacheExpiry: 24 * 60 * 60 * 1000,
  useCache: true,
  
  // Parallel processing config
  concurrentDetailRequests: 5,
  concurrentGeoRequests: 3,
  
  // Google Geocoding API
  googleApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
  geocodingEnabled: false
};

// Create cache directories
[CONFIG.cacheDir, CONFIG.geoCacheDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// ============================================
// UNIQUE ID GENERATION
// ============================================

/**
 * Generate unique ID for an offer
 * Uses: URL, title, and expiration date for uniqueness
 * Same offer across scrapes gets same ID
 */
function generateUniqueOfferId(offer) {
  const components = [
    'boc',
    offer.url || '',
    offer.title || '',
    offer.expirationDate || '',
    offer.location || ''
  ];
  
  const hashInput = components.join('|').toLowerCase().trim();
  const hash = crypto.createHash('sha256').update(hashInput).digest('hex');
  
  // Extract simple identifier from URL
  const urlMatch = offer.url ? offer.url.match(/\/([^/]+)\/product$/) : null;
  const urlId = urlMatch ? urlMatch[1].substring(0, 15) : 'offer';
  
  // Return: boc_<hash12>_<url_slug>
  return `boc_${hash.substring(0, 12)}_${urlId}`;
}

// ============================================
// CACHE UTILITIES
// ============================================

function getCacheKey(input) {
  return crypto.createHash('md5').update(input).digest('hex');
}

function getCachePath(input, cacheDir = CONFIG.cacheDir) {
  return path.join(cacheDir, `${getCacheKey(input)}.json`);
}

function isCacheValid(cachePath, ignoreExpiry = false) {
  if (!fs.existsSync(cachePath)) return false;
  if (ignoreExpiry) return true; // For geo cache that never expires
  const stats = fs.statSync(cachePath);
  return (Date.now() - stats.mtime.getTime()) < CONFIG.cacheExpiry;
}

function saveToCache(input, data, cacheDir = CONFIG.cacheDir) {
  const cachePath = getCachePath(input, cacheDir);
  fs.writeFileSync(cachePath, JSON.stringify({ 
    input, 
    data, 
    cachedAt: new Date().toISOString() 
  }, null, 2));
}

function loadFromCache(input, cacheDir = CONFIG.cacheDir, ignoreExpiry = false) {
  const cachePath = getCachePath(input, cacheDir);
  if (!CONFIG.useCache || !isCacheValid(cachePath, ignoreExpiry)) return null;
  const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  return cached.data;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// GEOCODING WITH PERSISTENT CACHE
// ============================================

let geocodingStats = {
  cached: 0,
  new: 0,
  failed: 0
};

async function geocodeLocation(locationName, phone = '', retryCount = 0) {
  if (!CONFIG.geocodingEnabled || !CONFIG.googleApiKey) {
    return null;
  }

  // Normalize location for consistent caching
  const normalizedLocation = locationName.toLowerCase().trim();
  const cacheKey = crypto.createHash('md5')
    .update(`${normalizedLocation}_${phone}`)
    .digest('hex');

  // Check permanent geo cache (never expires)
  const cachePath = path.join(CONFIG.geoCacheDir, `${cacheKey}.json`);
  
  if (fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      geocodingStats.cached++;
      return cached.data;
    } catch (error) {
      console.error(`      ⚠️  Corrupted geo cache for: ${locationName}`);
    }
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
        region: 'lk'
      },
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
        address_components: result.address_components.map(comp => ({
          long_name: comp.long_name,
          short_name: comp.short_name,
          types: comp.types
        })),
        cached_at: new Date().toISOString()
      };

      // Save to permanent cache
      fs.writeFileSync(cachePath, JSON.stringify({ 
        input: locationName, 
        data: geoData 
      }, null, 2));
      
      geocodingStats.new++;
      console.log(`      🗺️  Geocoded (NEW): ${locationName}`);
      
      return geoData;
      
    } else if (response.data.status === 'ZERO_RESULTS') {
      // Cache negative result to avoid repeated API calls
      const negativeResult = {
        original_address: locationName,
        status: 'NOT_FOUND',
        cached_at: new Date().toISOString()
      };
      fs.writeFileSync(cachePath, JSON.stringify({ 
        input: locationName, 
        data: negativeResult 
      }, null, 2));
      
      geocodingStats.failed++;
      console.log(`      ⚠️  No location found for: ${locationName}`);
      return null;
      
    } else {
      geocodingStats.failed++;
      console.log(`      ⚠️  Geocoding error: ${response.data.status}`);
      return null;
    }

  } catch (error) {
    if (error.response?.status === 429 && retryCount < CONFIG.maxRetries) {
      const delay = 2000 * (retryCount + 1);
      console.log(`      ⏳ Rate limit, retrying in ${delay}ms...`);
      await sleep(delay);
      return geocodeLocation(locationName, phone, retryCount + 1);
    }
    
    geocodingStats.failed++;
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

    const rawOffer = {
      url: offerUrl,
      title,
      offerValue,
      expirationDate: expireText,
      imageUrl,
      phone,
      location,
      description
    };

    // Generate unique ID
    const uniqueId = generateUniqueOfferId(rawOffer);

    const offer = {
      unique_id: uniqueId,
      source: 'BOC',
      source_url: offerUrl,
      scraped_at: new Date().toISOString(),
      from_cache: fromCache,
      
      // Offer details
      title,
      offer_value: offerValue,
      expiration_date: expireText,
      image_url: imageUrl,
      
      // Contact & Location
      phone,
      location,
      description: description.join('\n'),
      
      // Geocoding (to be populated)
      geocoding: null
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
  if (!CONFIG.geocodingEnabled || !CONFIG.googleApiKey) {
    console.log('\n⚠️  Geocoding disabled (no API key)');
    return offers;
  }

  // Reset stats
  geocodingStats = { cached: 0, new: 0, failed: 0 };

  console.log(`\n🗺️  Geocoding ${offers.length} locations with ${CONFIG.concurrentGeoRequests} concurrent requests...`);
  
  const limit = pLimit(CONFIG.concurrentGeoRequests);

  const promises = offers.map((offer, index) =>
    limit(async () => {
      console.log(`\n  [${index + 1}/${offers.length}] Processing: ${offer.title}`);
      const geoData = await geocodeLocation(offer.location, offer.phone);
      offer.geocoding = geoData;
      return offer;
    })
  );

  const result = await Promise.all(promises);
  
  console.log(`\n  📊 Geocoding Stats:`);
  console.log(`     💾 Cached: ${geocodingStats.cached}`);
  console.log(`     🆕 New: ${geocodingStats.new}`);
  console.log(`     ❌ Failed: ${geocodingStats.failed}`);
  
  return result;
}

// ============================================
// MAIN FUNCTION
// ============================================

async function main() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║   BOC Bank Offers Scraper v3.0                 ║');
  console.log('║   ✓ Unique IDs (no duplicates)                ║');
  console.log('║   ✓ Persistent Geo Cache (cost-effective)     ║');
  console.log('║   ✓ Parallel Processing                        ║');
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

  // Google API key
  const googleKeyArg = args.find(arg => arg.startsWith('--google-api-key='));
  if (googleKeyArg) {
    CONFIG.googleApiKey = googleKeyArg.split('=')[1];
    CONFIG.geocodingEnabled = true;
  }

  if (args.includes('--no-geo')) {
    CONFIG.geocodingEnabled = false;
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
  console.log(`   Geocoding: ${CONFIG.geocodingEnabled ? 'Enabled ✓' : 'Disabled'}`);
  console.log(`   Cache: ${CONFIG.useCache ? 'Enabled ✓' : 'Disabled'}\n`);

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
  console.log('\n\n╔════════════════════════════════════════════════╗');
  console.log('║              SUMMARY REPORT                    ║');
  console.log('╚════════════════════════════════════════════════╝\n');
  console.log(`Total offers scraped    : ${offers.length}`);
  console.log(`Successfully geocoded   : ${offers.filter(o => o.geocoding).length}`);
  console.log(`Total time              : ${duration}s ⚡`);
  console.log(`Average per offer       : ${(duration / offers.length).toFixed(2)}s`);

  const result = {
    metadata: {
      source: 'BOC',
      base_url: baseUrl,
      scraped_at: new Date().toISOString(),
      total_pages: Math.ceil(allOfferUrls.length / 12),
      total_offers: offers.length,
      geocoding_enabled: CONFIG.geocodingEnabled,
      scrape_duration: `${duration}s`,
      geocoding_stats: CONFIG.geocodingEnabled ? geocodingStats : null
    },
    offers
  };

  // Create output directory
  const outputDir = './output';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Save JSON
  const jsonFile = path.join(outputDir, 'boc_offers_detailed.json');
  fs.writeFileSync(jsonFile, JSON.stringify(result, null, 2));
  console.log(`\n💾 Data saved to: ${jsonFile}`);

  // Save CSV
  if (offers.length > 0) {
    const csvFile = path.join(outputDir, 'boc_offers.csv');
    const csvHeader = 'Unique_ID,Source,Title,Offer,Expiration,Phone,Location,Latitude,Longitude,Formatted_Address,URL\n';
    const csvRows = offers.map(o => {
      const lat = o.geocoding?.latitude || '';
      const lng = o.geocoding?.longitude || '';
      const addr = (o.geocoding?.formatted_address || '').replace(/"/g, '""');
      const desc = (o.description || '').substring(0, 100).replace(/"/g, '""');
      return `"${o.unique_id}","${o.source}","${o.title}","${o.offer_value}","${o.expiration_date}","${o.phone}","${o.location}","${lat}","${lng}","${addr}","${o.source_url}"`;
    }).join('\n');
    fs.writeFileSync(csvFile, csvHeader + csvRows);
    console.log(`💾 CSV export saved to: ${csvFile}`);
  }

  console.log(`\n✨ Scraping completed in ${duration}s!`);
  console.log(`\n💡 Key Features:`);
  console.log(`   ✓ Unique IDs: boc_<hash>_<slug>`);
  console.log(`   ✓ Geo cache: ${CONFIG.geoCacheDir} (never expires)`);
  console.log(`   ✓ DB-ready structure with unique_id field`);
  console.log(`\n📋 Usage:`);
  console.log(`   --google-api-key=KEY   Enable geocoding`);
  console.log(`   --category=<name>      Specific category`);
  console.log(`   --no-cache             Fresh downloads`);
  console.log(`   --clear-cache          Clear all caches\n`);
  
  // Display geo cache stats
  if (CONFIG.geocodingEnabled) {
    const geoCacheFiles = fs.readdirSync(CONFIG.geoCacheDir);
    console.log(`💾 Geo cache: ${geoCacheFiles.length} addresses cached\n`);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { 
  getAllOffersFromPagination, 
  scrapeOfferDetail,
  geocodeLocation,
  scrapeOffersInParallel,
  geocodeOffersInParallel,
  generateUniqueOfferId
};