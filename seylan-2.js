/**
 * Seylan Bank Card Promotions Deep Scraper - Enhanced Edition
 * Features:
 * - Persistent geo coordinate caching (never expires)
 * - Unique offer IDs (prevents database duplicates)
 * - Parallel processing with Google Geocoding API
 * - Database-ready structure
 * Requires: npm install axios cheerio p-limit
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// p-limit for concurrent geocoding
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

// Configuration
const CONFIG = {
  maxRetries: 3,
  retryDelay: 1000,
  timeout: 15000,
  delayBetweenRequests: 1000,
  delayBetweenDetailPages: 800,
  cacheDir: './cache_seylan',
  geoCacheDir: './cache_seylan/geocode',
  cacheExpiry: 24 * 60 * 60 * 1000,
  useCache: true,
  
  // Geocoding
  googleApiKey: '',
  enableGeocoding: false,
  geocodeConcurrent: 3
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
 * Uses: title, address, and phone for uniqueness
 * Same offer across scrapes gets same ID
 */
function generateUniqueOfferId(offer) {
  const components = [
    'seylan',
    offer.title || '',
    offer.address || '',
    offer.phone || ''
  ];
  
  const hashInput = components.join('|').toLowerCase().trim();
  const hash = crypto.createHash('sha256').update(hashInput).digest('hex');
  
  // Create readable slug from title
  const slug = (offer.title || 'offer')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .substring(0, 25);
  
  // Return: seylan_<hash12>_<slug>
  return `seylan_${hash.substring(0, 12)}_${slug}`;
}

// ============================================
// CACHE UTILITIES
// ============================================

function getCacheKey(url) {
  return crypto.createHash('md5').update(url).digest('hex');
}

function getCachePath(url) {
  return path.join(CONFIG.cacheDir, `${getCacheKey(url)}.html`);
}

function isCacheValid(cachePath) {
  if (!fs.existsSync(cachePath)) return false;
  const stats = fs.statSync(cachePath);
  return (Date.now() - stats.mtime.getTime()) < CONFIG.cacheExpiry;
}

function saveToCache(url, html) {
  fs.writeFileSync(getCachePath(url), JSON.stringify({ url, html, cachedAt: new Date().toISOString() }, null, 2));
}

function loadFromCache(url) {
  const cachePath = getCachePath(url);
  if (!CONFIG.useCache || !isCacheValid(cachePath)) return null;
  const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  return data.html;
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

/**
 * Build clean address for geocoding
 * Format: "Company Name, Street Address, City, Sri Lanka"
 */
function buildGeoAddress(offer) {
  const parts = [];
  
  // Add title (company name)
  if (offer.title) {
    parts.push(offer.title);
  }
  
  // Add address if available
  if (offer.address) {
    // Clean up address
    const cleanAddr = offer.address
      .replace(/\s+/g, ' ')
      .trim();
    parts.push(cleanAddr);
  }
  
  // Always add Sri Lanka
  parts.push('Sri Lanka');
  
  return parts.join(', ');
}

async function geocodeAddress(address, retryCount = 0) {
  if (!CONFIG.enableGeocoding || !CONFIG.googleApiKey) {
    return null;
  }

  // Normalize address for consistent caching
  const normalizedAddress = address.toLowerCase().trim();
  const cacheKey = crypto.createHash('md5').update(normalizedAddress).digest('hex');
  const cachePath = path.join(CONFIG.geoCacheDir, `${cacheKey}.json`);
  
  // Check permanent geo cache (never expires)
  if (fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      geocodingStats.cached++;
      return cached.data;
    } catch (error) {
      console.error(`      ⚠️  Corrupted geo cache for: ${address.substring(0, 50)}`);
    }
  }

  try {
    const url = 'https://maps.googleapis.com/maps/api/geocode/json';
    const response = await axios.get(url, {
      params: {
        address: address,
        key: CONFIG.googleApiKey,
        region: 'lk'
      },
      timeout: 10000
    });

    if (response.data.status === 'OK' && response.data.results.length > 0) {
      const result = response.data.results[0];
      const geoData = {
        original_address: address,
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
        address, 
        data: geoData 
      }, null, 2));
      
      geocodingStats.new++;
      console.log(`      🗺️  Geocoded (NEW): ${address.substring(0, 60)}`);
      
      return geoData;
      
    } else if (response.data.status === 'ZERO_RESULTS') {
      // Cache negative result
      const negativeResult = {
        original_address: address,
        status: 'NOT_FOUND',
        cached_at: new Date().toISOString()
      };
      fs.writeFileSync(cachePath, JSON.stringify({ 
        address, 
        data: negativeResult 
      }, null, 2));
      
      geocodingStats.failed++;
      console.log(`      ⚠️  No location found for: ${address.substring(0, 60)}`);
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
      return geocodeAddress(address, retryCount + 1);
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
// OFFER EXTRACTION
// ============================================

async function extractOfferUrls(listingUrl) {
  console.log(`\n📋 Fetching offer listing: ${listingUrl}`);
  
  try {
    const { html } = await fetchHTML(listingUrl);
    const $ = cheerio.load(html);
    const urls = new Set();

    $('.new-promotion-btn').each((i, el) => {
      const href = $(el).attr('href');
      if (href && href.includes('seylan.lk')) {
        const fullUrl = href.startsWith('http') ? href : `https://www.seylan.lk${href}`;
        urls.add(fullUrl);
      }
    });

    console.log(`✓ Found ${urls.size} unique offers`);
    return Array.from(urls);

  } catch (error) {
    console.error(`❌ Error fetching listing: ${error.message}`);
    return [];
  }
}

async function scrapeOfferDetail(offerUrl, index, total) {
  console.log(`\n  [${index}/${total}] Scraping: ${offerUrl.substring(offerUrl.lastIndexOf('/') + 1)}`);

  try {
    const { html, fromCache } = await fetchHTML(offerUrl);
    const $ = cheerio.load(html);

    const detailSection = $('.offer-detail');

    if (detailSection.length === 0) {
      console.log(`    ⚠️  No offer-detail section found`);
      return null;
    }

    const imageUrl = detailSection.find('.col-md-6').first().find('img').attr('src') || '';
    const rightCol = detailSection.find('.col-md-6').last();

    const title = rightCol.find('h2.h11').text().trim();
    const description = rightCol.find('p.h44').first().text().trim();

    let address = '';
    rightCol.find('div.h44').each((i, el) => {
      const html = $(el).html();
      if (html && html.includes('Address')) {
        address = $(el).text()
          .replace(/Address:/i, '')
          .replace(/\s+/g, ' ')
          .trim();
        return false;
      }
    });

    let phone = '';
    rightCol.find('div.h44').each((i, el) => {
      const text = $(el).text();
      if (text.includes('Tel')) {
        phone = text
          .replace(/Tel No\s*:|Tel\s*-\s*/i, '')
          .replace(/\s+/g, ' ')
          .trim();
        return false;
      }
    });

    let validity = '';
    rightCol.find('p, h4, div').each((i, el) => {
      const text = $(el).text().trim();
      if (text.match(/valid\s+until|valid\s+from/i)) {
        validity = text;
        return false;
      }
    });

    const terms = [];
    rightCol.find('div.des ul li').each((i, el) => {
      const term = $(el).text().trim();
      if (term && term.length > 0) {
        terms.push(term);
      }
    });

    let minTransaction = null;
    let maxTransaction = null;
    
    terms.forEach(term => {
      const minMatch = term.match(/Minimum\s+(?:Transaction\s+)?Value\s*[–-]?\s*Rs\.?\s*([\d,]+)/i);
      const maxMatch = term.match(/[Mm]aximum\s*Rs\.?\s*([\d,]+)/i);
      
      if (minMatch && !minTransaction) {
        minTransaction = parseInt(minMatch[1].replace(/,/g, ''));
      }
      if (maxMatch && !maxTransaction) {
        maxTransaction = parseInt(maxMatch[1].replace(/,/g, ''));
      }
    });

    const rawOffer = {
      title,
      url: offerUrl,
      description,
      address,
      phone,
      validity,
      imageUrl,
      minTransaction,
      maxTransaction,
      terms
    };

    // Generate unique ID
    const uniqueId = generateUniqueOfferId(rawOffer);

    // Build clean geocoding address
    const geoAddress = buildGeoAddress(rawOffer);

    const offer = {
      unique_id: uniqueId,
      source: 'Seylan',
      source_url: offerUrl,
      scraped_at: new Date().toISOString(),
      from_cache: fromCache,
      
      // Offer details
      title,
      description,
      address,
      phone,
      validity,
      image_url: imageUrl,
      min_transaction: minTransaction,
      max_transaction: maxTransaction,
      terms,
      
      // Geocoding address (clean format)
      geo_address: geoAddress,
      geocoding: null  // Will be populated later
    };

    console.log(`    ✓ ${title.substring(0, 45)}`);
    return offer;

  } catch (error) {
    console.error(`    ❌ Error: ${error.message}`);
    return null;
  }
}

// ============================================
// PARALLEL GEOCODING
// ============================================

async function geocodeOffersInParallel(offers) {
  if (!CONFIG.enableGeocoding || !CONFIG.googleApiKey) {
    console.log('\n⚠️  Geocoding disabled (no API key)');
    return offers;
  }

  geocodingStats = { cached: 0, new: 0, failed: 0 };

  console.log(`\n🗺️  Geocoding ${offers.length} locations with ${CONFIG.geocodeConcurrent} concurrent requests...`);
  
  const limit = pLimit(CONFIG.geocodeConcurrent);

  const promises = offers.map((offer, index) =>
    limit(async () => {
      console.log(`\n  [${index + 1}/${offers.length}] Processing: ${offer.title}`);
      const geoData = await geocodeAddress(offer.geo_address);
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
  console.log('║   Seylan Bank Offers Scraper v2.0             ║');
  console.log('║   ✓ Unique IDs (no duplicates)                ║');
  console.log('║   ✓ Persistent Geo Cache (cost-effective)     ║');
  console.log('╚════════════════════════════════════════════════╝');

  const args = process.argv.slice(2);
  
  if (args.includes('--clear-cache')) {
    if (fs.existsSync(CONFIG.cacheDir)) {
      const files = fs.readdirSync(CONFIG.cacheDir);
      files.forEach(f => fs.unlinkSync(path.join(CONFIG.cacheDir, f)));
      console.log(`🗑️  Cleared ${files.length} cache files\n`);
    }
    return;
  }

  if (args.includes('--no-cache')) {
    CONFIG.useCache = false;
    console.log('⚠️  Cache disabled\n');
  }

  // Google API key (check first before parsing other args)
  const googleKeyArg = args.find(arg => arg.startsWith('--google-api-key='));
  if (googleKeyArg) {
    CONFIG.googleApiKey = googleKeyArg.split('=')[1];
    CONFIG.enableGeocoding = true;
    console.log('✓ Google Geocoding enabled\n');
  }

  // Main listing URL (get --url value or use default)
  let listingUrl = 'https://www.seylan.lk/promotions/cards/solar';
  const urlIndex = args.indexOf('--url');
  if (urlIndex !== -1 && args[urlIndex + 1] && !args[urlIndex + 1].startsWith('--')) {
    listingUrl = args[urlIndex + 1];
  }
  
  // Support --category shorthand
  const categoryArg = args.find(arg => arg.startsWith('--category='));
  if (categoryArg) {
    const category = categoryArg.split('=')[1];
    listingUrl = `https://www.seylan.lk/promotions/cards/${category}`;
  }

  console.log(`⚙️  Configuration:`);
  console.log(`   Target URL: ${listingUrl}`);
  console.log(`   Geocoding: ${CONFIG.enableGeocoding ? 'Enabled ✓' : 'Disabled'}`);
  console.log(`   Cache: ${CONFIG.useCache ? 'Enabled ✓' : 'Disabled'}\n`);

  const startTime = Date.now();

  // Step 1: Extract all offer URLs
  const offerUrls = await extractOfferUrls(listingUrl);
  
  if (offerUrls.length === 0) {
    console.log('❌ No offers found');
    return;
  }

  // Step 2: Scrape details from each offer
  console.log('\n📝 Scraping offer details...');
  const offers = [];
  
  for (let i = 0; i < offerUrls.length; i++) {
    const offer = await scrapeOfferDetail(offerUrls[i], i + 1, offerUrls.length);
    if (offer) {
      offers.push(offer);
    }
    
    if (i < offerUrls.length - 1) {
      await sleep(CONFIG.delayBetweenDetailPages);
    }
  }

  // Step 3: Geocode locations in parallel
  if (CONFIG.enableGeocoding) {
    await geocodeOffersInParallel(offers);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  // Step 4: Save results
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║              SUMMARY REPORT                    ║');
  console.log('╚════════════════════════════════════════════════╝\n');
  console.log(`Total offers scraped   : ${offers.length}`);
  console.log(`Successfully geocoded  : ${offers.filter(o => o.geocoding).length}`);
  console.log(`Total time             : ${duration}s ⚡`);

  const result = {
    metadata: {
      source: 'Seylan',
      listing_url: listingUrl,
      scraped_at: new Date().toISOString(),
      total_offers: offers.length,
      geocoding_enabled: CONFIG.enableGeocoding,
      duration: `${duration}s`,
      geocoding_stats: CONFIG.enableGeocoding ? geocodingStats : null
    },
    offers
  };

  // Create output directory
  const outputDir = './output';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Save JSON
  const jsonFile = path.join(outputDir, 'seylan_offers_detailed.json');
  fs.writeFileSync(jsonFile, JSON.stringify(result, null, 2));
  console.log(`\n💾 Data saved to: ${jsonFile}`);

  // Create CSV export
  if (offers.length > 0) {
    const csvFile = path.join(outputDir, 'seylan_offers.csv');
    const csvHeader = 'Unique_ID,Source,Title,Phone,Address,Geo_Address,Latitude,Longitude,Formatted_Address,Min_Transaction,Validity\n';
    const csvRows = offers.map(o => {
      const lat = o.geocoding?.latitude || '';
      const lng = o.geocoding?.longitude || '';
      const formattedAddr = (o.geocoding?.formatted_address || '').replace(/"/g, '""');
      return `"${o.unique_id}","${o.source}","${o.title}","${o.phone}","${o.address}","${o.geo_address}","${lat}","${lng}","${formattedAddr}","${o.min_transaction || ''}","${o.validity}"`;
    }).join('\n');
    fs.writeFileSync(csvFile, csvHeader + csvRows);
    console.log(`💾 CSV export saved to: ${csvFile}`);
  }

  console.log(`\n✨ Scraping completed in ${duration}s!`);
  console.log(`\n💡 Key Features:`);
  console.log(`   ✓ Unique IDs: seylan_<hash>_<slug>`);
  console.log(`   ✓ Clean geo addresses: "Company, Street, City, Sri Lanka"`);
  console.log(`   ✓ Geo cache: ${CONFIG.geoCacheDir} (never expires)`);
  console.log(`   ✓ DB-ready structure with unique_id field`);
  console.log(`\n📋 Usage:`);
  console.log(`   --google-api-key=KEY   Enable geocoding`);
  console.log(`   --url <URL>            Custom listing page`);
  console.log(`   --no-cache             Fresh downloads`);
  console.log(`   --clear-cache          Clear all caches\n`);
  
  // Display geo cache stats
  if (CONFIG.enableGeocoding) {
    const geoCacheFiles = fs.readdirSync(CONFIG.geoCacheDir);
    console.log(`💾 Geo cache: ${geoCacheFiles.length} addresses cached\n`);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { 
  extractOfferUrls, 
  scrapeOfferDetail,
  generateUniqueOfferId,
  buildGeoAddress,
  geocodeAddress
};