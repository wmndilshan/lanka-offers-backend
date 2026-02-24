/**
 * Pan Asia Bank Card Offers Scraper v2.0
 * Features: Puppeteer, Geocoding API, Parallel Processing
 * Requires: npm install puppeteer axios
 */

const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Parallel processing implementation
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
  retryDelay: 3000,
  timeout: 60000,
  cacheDir: './cache_pabc',
  geoCacheDir: './cache_pabc_geo',
  cacheExpiry: 24 * 60 * 60 * 1000,
  useCache: true,
  headless: 'new',
  navigationTimeout: 60000,
  waitForContent: 5000,
  
  // Geocoding config
  concurrentGeoRequests: 3,
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
  const key = getCacheKey(url);
  return path.join(cacheDir, `${key}.json`);
}

function isCacheValid(cachePath) {
  if (!fs.existsSync(cachePath)) return false;
  const stats = fs.statSync(cachePath);
  const age = Date.now() - stats.mtime.getTime();
  return age < CONFIG.cacheExpiry;
}

function saveToCache(url, data, cacheDir = CONFIG.cacheDir) {
  const cachePath = getCachePath(url, cacheDir);
  const cacheData = {
    url: url,
    cachedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + CONFIG.cacheExpiry).toISOString(),
    data: data
  };
  fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2));
}

function loadFromCache(url, cacheDir = CONFIG.cacheDir) {
  const cachePath = getCachePath(url, cacheDir);
  if (!CONFIG.useCache) return null;
  if (isCacheValid(cachePath)) {
    const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    return cacheData.data;
  }
  return null;
}

function clearCache() {
  [CONFIG.cacheDir, CONFIG.geoCacheDir].forEach(dir => {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      files.forEach(file => fs.unlinkSync(path.join(dir, file)));
      console.log(`🗑️  Cleared ${files.length} files from ${dir}`);
    }
  });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// GEOCODING WITH GOOGLE API
// ============================================

async function geocodeLocation(locationName, retryCount = 0) {
  if (!CONFIG.geocodingEnabled || !CONFIG.googleApiKey || CONFIG.googleApiKey === 'YOUR_API_KEY_HERE') {
    return null;
  }

  const cacheKey = locationName;
  const cached = loadFromCache(cacheKey, CONFIG.geoCacheDir);
  if (cached) {
    console.log(`      🗺️  Geo cache hit: ${locationName}`);
    return cached;
  }

  try {
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
      const delay = 2000 * (retryCount + 1);
      console.log(`      ⏳ Rate limit, retrying in ${delay}ms...`);
      await sleep(delay);
      return geocodeLocation(locationName, retryCount + 1);
    }
    
    console.error(`      ❌ Geocoding error: ${error.message}`);
    return null;
  }
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
      console.log(`\n  [${index + 1}/${offers.length}] Geocoding: ${offer.merchantName}`);
      const geoData = await geocodeLocation(offer.merchantName);
      offer.geocoding = geoData;
      return offer;
    })
  );

  return await Promise.all(promises);
}

// ============================================
// PARSING UTILITIES
// ============================================

function parseDate(dateStr) {
  try {
    const parts = dateStr.trim().split('/');
    if (parts.length === 3) {
      return {
        day: parts[0],
        month: parts[1],
        year: parts[2],
        formatted: dateStr
      };
    }
    return { raw: dateStr };
  } catch (err) {
    return { raw: dateStr };
  }
}

function extractMerchantName(description) {
  // Try to extract merchant name from description
  const atMatch = description.match(/at\s+([^–\-,\.!]+)/i);
  if (atMatch) {
    return atMatch[1].trim();
  }
  
  // Try "OFF at" pattern
  const offAtMatch = description.match(/OFF\s+at\s+([^–\-,\.!]+)/i);
  if (offAtMatch) {
    return offAtMatch[1].trim();
  }
  
  // Try to get from beginning
  const firstSentence = description.split(/[\.!]/)[0];
  const words = firstSentence.split(' ');
  
  // Look for capitalized words that might be merchant names
  const capitalWords = words.filter(w => /^[A-Z]/.test(w));
  if (capitalWords.length > 0) {
    return capitalWords.slice(0, 3).join(' ').trim();
  }
  
  return firstSentence.substring(0, 50).trim();
}

// ============================================
// MAIN SCRAPING FUNCTION
// ============================================

async function scrapePABCOffers(url, retryCount = 0) {
  const cachedData = loadFromCache(url);
  if (cachedData) {
    console.log(`💾 Cache hit: ${url}`);
    return { ...cachedData, fromCache: true };
  }
  
  let browser;
  
  try {
    console.log(`🌐 Launching browser for: ${url}`);
    browser = await puppeteer.launch({
      headless: CONFIG.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled'
      ]
    });
    
    const page = await browser.newPage();
    
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (['stylesheet', 'font', 'media'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });
    
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
    });
    
    console.log('📥 Loading page...');
    
    try {
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: CONFIG.navigationTimeout
      });
    } catch (navError) {
      console.log('⚠️  Initial navigation timeout, trying alternative...');
      await page.goto(url, { 
        waitUntil: 'load',
        timeout: CONFIG.navigationTimeout
      });
    }
    
    console.log('⏳ Waiting for content to render...');
    
    try {
      await page.waitForSelector('.flip-card', { timeout: 15000 });
    } catch (err) {
      console.log('⚠️  Primary selector not found, trying alternatives...');
      try {
        await page.waitForSelector('.flip-card-inner', { timeout: 5000 });
      } catch (err2) {
        console.log('⚠️  Proceeding without selector match...');
      }
    }
    
    await sleep(CONFIG.waitForContent);
    
    console.log('📊 Extracting offers...');
    
    const offers = await page.evaluate(() => {
      const flipCards = document.querySelectorAll('.flip-card');
      const results = [];
      
      flipCards.forEach((card, index) => {
        try {
          const front = card.querySelector('.flip-card-front');
          const back = card.querySelector('.flip-card-back');
          
          if (!front || !back) return;
          
          const img = front.querySelector('img');
          const imageUrl = img ? img.src : '';
          const imageAlt = img ? img.alt : '';
          const discountH2 = front.querySelector('h2');
          const discountText = discountH2 ? discountH2.textContent.trim() : '';
          const dateP = front.querySelector('p');
          const dateText = dateP ? dateP.textContent.trim() : '';
          
          const descP = back.querySelector('p');
          const description = descP ? descP.textContent.trim() : '';
          
          results.push({
            id: index + 1,
            imageUrl: imageUrl,
            imageAlt: imageAlt,
            discount: discountText,
            validityDate: dateText,
            description: description
          });
          
        } catch (err) {
          console.error('Error parsing card:', err);
        }
      });
      
      return results;
    });
    
    await browser.close();
    console.log(`✅ Found ${offers.length} offers`);
    
    const processedOffers = offers.map(offer => {
      const parsedDate = parseDate(offer.validityDate);
      const merchantName = extractMerchantName(offer.description);
      
      const discountMatch = offer.description.match(/(\d+)%\s*OFF/i);
      const discount = discountMatch ? `${discountMatch[1]}%` : offer.discount;
      
      const terms = [];
      if (offer.description.toLowerCase().includes('credit card')) terms.push('Valid with Credit Card');
      if (offer.description.toLowerCase().includes('debit card')) terms.push('Valid with Debit Card');
      if (offer.description.toLowerCase().includes('credit or debit')) terms.push('Valid with Credit or Debit Card');
      
      return {
        id: offer.id,
        merchantName: merchantName,
        discount: discount,
        validityDate: parsedDate,
        description: offer.description,
        media: {
          imageUrl: offer.imageUrl,
          imageAlt: offer.imageAlt
        },
        terms: terms,
        geocoding: null
      };
    });
    
    const result = {
      success: true,
      timestamp: new Date().toISOString(),
      sourceUrl: url,
      totalOffers: processedOffers.length,
      offers: processedOffers,
      fromCache: false
    };
    
    saveToCache(url, result);
    return result;
    
  } catch (error) {
    if (browser) await browser.close();
    
    console.error(`❌ Error scraping ${url}: ${error.message}`);
    
    if (retryCount < CONFIG.maxRetries) {
      const delay = CONFIG.retryDelay * (retryCount + 1);
      console.log(`🔄 Retrying in ${delay}ms... (${retryCount + 1}/${CONFIG.maxRetries})`);
      await sleep(delay);
      return scrapePABCOffers(url, retryCount + 1);
    }
    
    return {
      success: false,
      error: error.message,
      errorCode: error.code,
      timestamp: new Date().toISOString()
    };
  }
}

// ============================================
// MAIN FUNCTION
// ============================================

async function main() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║   Pan Asia Bank Scraper v2.0                  ║');
  console.log('║   • Puppeteer (Bypasses WAF)                  ║');
  console.log('║   • Google Geocoding API                      ║');
  console.log('║   • Parallel Processing                       ║');
  console.log('╚════════════════════════════════════════════════╝\n');
  
  const args = process.argv.slice(2);
  
  if (args.includes('--clear-cache')) {
    clearCache();
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
  
  if (args.includes('--show-browser')) {
    CONFIG.headless = false;
    console.log('👁️  Browser window will be visible\n');
  }

  console.log(`⚙️  Configuration:`);
  console.log(`   Geocoding: ${CONFIG.geocodingEnabled ? 'Enabled' : 'Disabled'}`);
  console.log(`   Cache: ${CONFIG.useCache ? 'Enabled' : 'Disabled'}`);
  console.log(`   Concurrent geocoding: ${CONFIG.concurrentGeoRequests}\n`);
  
  const url = 'https://www.pabcbank.com/card-offers/';
  const startTime = Date.now();
  
  console.log(`Scraping: ${url}\n`);
  let result = await scrapePABCOffers(url);
  
  if (result.success && result.totalOffers > 0) {
    // Geocode offers if enabled (even from cache if not already geocoded)
    if (CONFIG.geocodingEnabled) {
      const needsGeocoding = result.offers.some(o => !o.geocoding);
      if (needsGeocoding) {
        console.log('\n🔄 Geocoding offers (not in geo cache)...');
        result.offers = await geocodeOffersInParallel(result.offers);
      } else {
        console.log('\n✓ All offers already geocoded');
      }
    }
    
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    console.log(`\n✅ Success! Found ${result.totalOffers} offers\n`);
    
    result.offers.forEach((offer, i) => {
      console.log(`${i + 1}. ${offer.merchantName}`);
      console.log(`   Discount: ${offer.discount}`);
      console.log(`   Valid Until: ${offer.validityDate.formatted || offer.validityDate.raw}`);
      if (offer.geocoding) {
        console.log(`   Location: ${offer.geocoding.formattedAddress}`);
      }
      console.log(`   Description: ${offer.description.substring(0, 80)}...`);
      console.log('');
    });
    
    // Save detailed JSON
    fs.writeFileSync('pabc_offers.json', JSON.stringify(result, null, 2));
    console.log('💾 Detailed data saved to: pabc_offers.json');
    
    // Save simple JSON
    const simpleData = result.offers.map(offer => ({
      merchantName: offer.merchantName,
      discount: offer.discount,
      validityDate: offer.validityDate.formatted || offer.validityDate.raw,
      description: offer.description,
      imageUrl: offer.media.imageUrl,
      terms: offer.terms,
      latitude: offer.geocoding?.latitude || null,
      longitude: offer.geocoding?.longitude || null,
      address: offer.geocoding?.formattedAddress || null
    }));
    
    fs.writeFileSync('pabc_offers_simple.json', JSON.stringify(simpleData, null, 2));
    console.log('💾 Simple data saved to: pabc_offers_simple.json');
    
    // Save CSV with geocoding
    const csvHeader = 'Merchant,Discount,Validity Date,Latitude,Longitude,Address,Description,Image URL\n';
    const csvRows = simpleData.map(o => 
      `"${o.merchantName}","${o.discount}","${o.validityDate}","${o.latitude || ''}","${o.longitude || ''}","${o.address || ''}","${o.description.replace(/"/g, '""')}","${o.imageUrl}"`
    ).join('\n');
    fs.writeFileSync('pabc_offers.csv', csvHeader + csvRows);
    console.log('💾 CSV export saved to: pabc_offers.csv');
    
    console.log('\n' + '─'.repeat(60));
    console.log(`Total offers: ${result.totalOffers}`);
    console.log(`Successfully geocoded: ${result.offers.filter(o => o.geocoding).length}`);
    console.log(`Source: ${result.fromCache ? 'Cache' : 'Fresh scrape'}`);
    console.log(`Time taken: ${duration}s`);
    console.log('─'.repeat(60));
    
    console.log('\n✨ Scraping completed!');
    console.log(`📦 HTML Cache: ${CONFIG.cacheDir}`);
    console.log(`🗺️  Geo Cache: ${CONFIG.geoCacheDir}`);
    console.log(`⏰ Cache expires after: ${CONFIG.cacheExpiry / (60 * 60 * 1000)} hours\n`);
    
  } else if (result.success && result.totalOffers === 0) {
    console.log('⚠️  No offers found');
  } else {
    console.log('❌ Error:', result.error);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  scrapePABCOffers,
  geocodeLocation,
  geocodeOffersInParallel,
  clearCache
};