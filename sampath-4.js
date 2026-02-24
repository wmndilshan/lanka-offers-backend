/**
 * Geocoding System for Bank Card Offers - Fixed Edition
 * Takes scraped offers JSON and adds geocoding
 * 
 * Features:
 * - Persistent geo coordinate caching (never expires)
 * - Unique offer IDs (prevents database duplicates)
 * - Parallel processing with Google Geocoding API
 * - Handles all offer data formats properly
 * - Preserves ALL original fields from scraper
 * 
 * Requires: npm install axios p-limit
 * Setup: Set environment variable GOOGLE_MAPS_API_KEY
 * Usage: node geocode.js --input=./sampath_offers_detailed.json --google-api-key=YOUR_KEY
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Dynamic import for p-limit (ES module)
let pLimit;

async function initPLimit() {
  if (!pLimit) {
    pLimit = (await import('p-limit')).default;
  }
}

// Configuration
const CONFIG = {
  apiKey: process.env.GOOGLE_MAPS_API_KEY,
  cacheDir: './cache',
  geoCacheDir: './cache/geocode',
  offersFile: './sampath_offers_detailed.json',
  outputFile: './output/sampath_offers_geocoded.json',
  parallelRequests: 5,
  requestDelay: 100,
  timeout: 10000,
  retries: 2
};

// Ensure directories exist
function ensureDirectories() {
  [CONFIG.cacheDir, CONFIG.geoCacheDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

// ============================================
// UNIQUE ID GENERATION
// ============================================

/**
 * Generate unique ID for an offer
 * Uses all available identifying information
 */
function generateUniqueOfferId(offer) {
  const components = [
    'sampath', // bank identifier
    offer.company_name || '',
    offer.merchant_name || '',
    offer.location || '',
    offer.city || '',
    offer.offer_type || '',
    offer.discount || '',
    offer.title?.substring(0, 30) || ''
  ];
  
  const hashInput = components
    .join('|')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
  
  const hash = crypto.createHash('sha256').update(hashInput).digest('hex');
  
  // Create readable slug from company/merchant name
  const nameForSlug = offer.company_name || offer.merchant_name || offer.title || 'offer';
  const slug = nameForSlug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 20);
  
  return `sampath_${hash.substring(0, 12)}_${slug}`;
}

// ============================================
// GEOCODING CACHE (PERSISTENT)
// ============================================

let geocodingStats = {
  cached: 0,
  new: 0,
  failed: 0,
  no_address: 0
};

/**
 * Get cache key for geocoding
 */
function getGeoCacheKey(address) {
  const normalized = address.toLowerCase().trim().replace(/\s+/g, ' ');
  return crypto.createHash('md5').update(normalized).digest('hex');
}

/**
 * Load from persistent geo cache
 */
function loadGeoFromCache(address) {
  const cacheKey = getGeoCacheKey(address);
  const cachePath = path.join(CONFIG.geoCacheDir, `${cacheKey}.json`);
  
  if (fs.existsSync(cachePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      geocodingStats.cached++;
      return data.result;
    } catch (error) {
      console.warn(`⚠️  Corrupted cache: ${address.substring(0, 50)}`);
      return null;
    }
  }
  return null;
}

/**
 * Save to persistent geo cache
 */
function saveGeoToCache(address, result) {
  const cacheKey = getGeoCacheKey(address);
  const cachePath = path.join(CONFIG.geoCacheDir, `${cacheKey}.json`);
  
  try {
    fs.writeFileSync(cachePath, JSON.stringify({
      address: address,
      result: result,
      cached_at: new Date().toISOString()
    }, null, 2));
  } catch (error) {
    console.warn(`⚠️  Cache write failed: ${error.message}`);
  }
}

// ============================================
// ADDRESS BUILDING
// ============================================

/**
 * Build search address from offer data
 * Handles various field names from different scrapers
 */
function buildSearchAddress(offer) {
  const parts = [];
  
  // Company/Merchant name
  if (offer.company_name) parts.push(offer.company_name);
  else if (offer.merchant_name) parts.push(offer.merchant_name);
  
  // Address/Location
  if (offer.address) parts.push(offer.address);
  else if (offer.location) parts.push(offer.location);
  
  // City
  if (offer.city) parts.push(offer.city);
  
  // Always add Sri Lanka
  parts.push('Sri Lanka');
  
  return parts
    .filter(p => p && p.trim() && p.toLowerCase() !== 'n/a')
    .join(', ');
}

/**
 * Check if offer has address information
 */
function hasValidAddress(offer) {
  return !!(
    offer.company_name ||
    offer.merchant_name ||
    offer.location ||
    offer.address ||
    offer.city
  );
}

// ============================================
// GEOCODING API
// ============================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Geocode address using Google API
 */
async function geocodeAddress(address, retryCount = 0) {
  if (!CONFIG.apiKey) {
    throw new Error('GOOGLE_MAPS_API_KEY not set');
  }

  // Check cache first
  const cachedResult = loadGeoFromCache(address);
  if (cachedResult) {
    return cachedResult;
  }

  const url = 'https://maps.googleapis.com/maps/api/geocode/json';
  
  try {
    const response = await axios.get(url, {
      params: {
        address: address,
        key: CONFIG.apiKey,
        region: 'lk',
        components: 'country:LK'
      },
      timeout: CONFIG.timeout
    });

    let result;

    if (response.data.status === 'OK' && response.data.results.length > 0) {
      const apiResult = response.data.results[0];
      
      result = {
        success: true,
        original_address: address,
        formatted_address: apiResult.formatted_address,
        latitude: apiResult.geometry.location.lat,
        longitude: apiResult.geometry.location.lng,
        place_id: apiResult.place_id,
        types: apiResult.types,
        address_components: apiResult.address_components,
        viewport: apiResult.geometry.viewport,
        timestamp: new Date().toISOString()
      };
      
      geocodingStats.new++;
      console.log(`      🗺️  NEW: ${address.substring(0, 60)}`);
      
    } else if (response.data.status === 'ZERO_RESULTS') {
      result = {
        success: false,
        original_address: address,
        error: 'NO_RESULTS',
        message: 'Address not found',
        timestamp: new Date().toISOString()
      };
      geocodingStats.failed++;
      
    } else if (response.data.status === 'OVER_QUERY_LIMIT') {
      result = {
        success: false,
        original_address: address,
        error: 'QUOTA_EXCEEDED',
        message: 'API quota exceeded',
        timestamp: new Date().toISOString()
      };
      geocodingStats.failed++;
      
    } else {
      result = {
        success: false,
        original_address: address,
        error: response.data.status,
        message: response.data.error_message || 'Geocoding failed',
        timestamp: new Date().toISOString()
      };
      geocodingStats.failed++;
    }

    // Cache even failures
    saveGeoToCache(address, result);
    return result;

  } catch (error) {
    if (retryCount < CONFIG.retries) {
      const backoff = 1000 * Math.pow(2, retryCount);
      console.log(`      🔄 Retry ${retryCount + 1}/${CONFIG.retries} after ${backoff}ms`);
      await sleep(backoff);
      return geocodeAddress(address, retryCount + 1);
    }
    
    const errorResult = {
      success: false,
      original_address: address,
      error: 'API_ERROR',
      message: error.message,
      timestamp: new Date().toISOString()
    };
    
    geocodingStats.failed++;
    saveGeoToCache(address, errorResult);
    return errorResult;
  }
}

// ============================================
// OFFER PROCESSING
// ============================================

/**
 * Process single offer: add unique ID and geocode
 */
async function processOffer(offer, index, total) {
  const uniqueId = generateUniqueOfferId(offer);
  
  // Check if offer has address
  if (!hasValidAddress(offer)) {
    geocodingStats.no_address++;
    
    const displayName = offer.company_name || offer.merchant_name || offer.title || 'Unknown';
    console.log(`[${index + 1}/${total}] ⚠️  No address: ${displayName.substring(0, 50)}`);
    
    return {
      unique_id: uniqueId,
      ...offer, // Preserve ALL original fields
      geocoding: {
        success: false,
        error: 'NO_ADDRESS',
        message: 'No address information available',
        timestamp: new Date().toISOString()
      }
    };
  }
  
  const address = buildSearchAddress(offer);
  const displayName = offer.company_name || offer.merchant_name || offer.title || 'Unknown';
  
  console.log(`[${index + 1}/${total}] Processing: ${displayName.substring(0, 50)}`);
  
  const geocodeResult = await geocodeAddress(address);
  
  // Polite delay for new API calls
  if (!geocodeResult.cached && geocodingStats.new > 0) {
    await sleep(CONFIG.requestDelay);
  }
  
  return {
    unique_id: uniqueId,
    ...offer, // Preserve ALL original fields from scraper
    geocoding: {
      search_address: address,
      ...geocodeResult
    }
  };
}

// ============================================
// MAIN FUNCTION
// ============================================

async function geocodeAllOffers() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║   Sampath Offers Geocoding System v3.0        ║');
  console.log('║   ✓ Unique IDs (no duplicates)                ║');
  console.log('║   ✓ Persistent Geo Cache (cost-effective)     ║');
  console.log('║   ✓ Google Maps API Integration               ║');
  console.log('║   ✓ Preserves all scraper data                ║');
  console.log('╚════════════════════════════════════════════════╝\n');

  // Initialize
  await initPLimit();
  ensureDirectories();

  // Parse command line arguments
  const args = process.argv.slice(2);
  
  const googleKeyArg = args.find(arg => arg.startsWith('--google-api-key='));
  if (googleKeyArg) {
    CONFIG.apiKey = googleKeyArg.split('=')[1];
    console.log('✓ Using API key from command line\n');
  }
  
  const inputFileArg = args.find(arg => arg.startsWith('--input='));
  if (inputFileArg) {
    CONFIG.offersFile = inputFileArg.split('=')[1];
    console.log(`✓ Using input file: ${CONFIG.offersFile}\n`);
  }
  
  const outputFileArg = args.find(arg => arg.startsWith('--output='));
  if (outputFileArg) {
    CONFIG.outputFile = outputFileArg.split('=')[1];
    console.log(`✓ Using output file: ${CONFIG.outputFile}\n`);
  }

  // Validate API key
  if (!CONFIG.apiKey) {
    console.error('❌ Error: GOOGLE_MAPS_API_KEY not set\n');
    console.error('📋 Please provide API key:\n');
    console.error('   Method 1 (recommended):');
    console.error('      node geocode.js --google-api-key=YOUR_KEY\n');
    console.error('   Method 2 (environment variable):');
    console.error('      Windows (PowerShell): $env:GOOGLE_MAPS_API_KEY="YOUR_KEY"');
    console.error('      Windows (CMD):        set GOOGLE_MAPS_API_KEY=YOUR_KEY');
    console.error('      Linux/Mac:            export GOOGLE_MAPS_API_KEY="YOUR_KEY"\n');
    process.exit(1);
  }

  // Load offers file
  if (!fs.existsSync(CONFIG.offersFile)) {
    console.error(`❌ Error: ${CONFIG.offersFile} not found\n`);
    console.error('Please run your scraper first to generate the offers file.\n');
    console.error('Or specify a different input file:');
    console.error('   node geocode.js --input=./your_file.json --google-api-key=YOUR_KEY\n');
    process.exit(1);
  }

  console.log(`📖 Loading offers from: ${CONFIG.offersFile}`);
  const offersData = JSON.parse(fs.readFileSync(CONFIG.offersFile, 'utf8'));
  
  // Handle different JSON structures
  let allOffers = [];
  
  if (Array.isArray(offersData)) {
    // Simple array: [{...}, {...}]
    allOffers = offersData;
    
  } else if (offersData.offers && Array.isArray(offersData.offers)) {
    // Wrapped: {offers: [{...}, {...}]}
    allOffers = offersData.offers;
    
  } else if (offersData.categories) {
    // Categorized: {categories: {Dining: [...], Shopping: [...]}}
    Object.entries(offersData.categories).forEach(([category, offers]) => {
      if (Array.isArray(offers)) {
        offers.forEach(offer => {
          allOffers.push({ ...offer, category });
        });
      }
    });
    
  } else {
    console.error('❌ Error: Unsupported JSON structure\n');
    console.error('Expected one of:');
    console.error('  - Simple array: [{...}, {...}]');
    console.error('  - Wrapped: {offers: [{...}, {...}]}');
    console.error('  - Categorized: {categories: {Cat1: [...], Cat2: [...]}}\n');
    process.exit(1);
  }

  if (allOffers.length === 0) {
    console.error('❌ No offers found in input file\n');
    process.exit(1);
  }

  // Reset stats
  geocodingStats = { cached: 0, new: 0, failed: 0, no_address: 0 };

  console.log(`📍 Total offers to process: ${allOffers.length}`);
  console.log(`⚡ Parallel requests: ${CONFIG.parallelRequests}`);
  console.log(`💾 Geo cache: ${CONFIG.geoCacheDir}\n`);

  // Create rate limiter
  const limit = pLimit(CONFIG.parallelRequests);
  
  // Process all offers
  const startTime = Date.now();
  const geocodedOffers = await Promise.all(
    allOffers.map((offer, index) => 
      limit(() => processOffer(offer, index, allOffers.length))
    )
  );

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  // Organize by category if available
  const hasCategories = geocodedOffers.some(o => o.category);
  const categorizedOffers = {};
  
  if (hasCategories) {
    geocodedOffers.forEach(offer => {
      const cat = offer.category || 'Uncategorized';
      if (!categorizedOffers[cat]) {
        categorizedOffers[cat] = [];
      }
      categorizedOffers[cat].push(offer);
    });
  }

  // Calculate statistics
  const stats = {
    total: geocodedOffers.length,
    successful: geocodedOffers.filter(o => o.geocoding?.success).length,
    failed: geocodedOffers.filter(o => o.geocoding && !o.geocoding.success && o.geocoding.error !== 'NO_ADDRESS').length,
    no_address: geocodingStats.no_address,
    cached: geocodingStats.cached,
    api_calls: geocodingStats.new,
    duration_seconds: parseFloat(duration)
  };

  // Create output directory
  const outputDir = path.dirname(CONFIG.outputFile);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Save results
  const output = {
    metadata: {
      source: 'Sampath Bank',
      geocoded_at: new Date().toISOString(),
      total_offers: stats.total,
      geocoding_enabled: true,
      duration: `${duration}s`,
      api_calls_made: stats.api_calls,
      cache_hits: stats.cached
    },
    statistics: stats,
    ...(hasCategories ? { categories: categorizedOffers } : {}),
    offers: geocodedOffers
  };

  fs.writeFileSync(CONFIG.outputFile, JSON.stringify(output, null, 2));

  // Print summary
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║              📊 SUMMARY REPORT                 ║');
  console.log('╚════════════════════════════════════════════════╝');
  console.log(`Total offers:        ${stats.total}`);
  console.log(`✅ Geocoded:         ${stats.successful} (${((stats.successful/stats.total)*100).toFixed(1)}%)`);
  console.log(`❌ Failed:           ${stats.failed}`);
  console.log(`📍 No address:       ${stats.no_address}`);
  console.log(`💾 Cache hits:       ${stats.cached}`);
  console.log(`🌐 API calls:        ${stats.api_calls}`);
  console.log(`⏱️  Duration:         ${duration}s`);
  console.log(`⚡ Rate:             ${(stats.total / parseFloat(duration)).toFixed(1)} offers/sec`);

  // Category breakdown
  if (hasCategories && Object.keys(categorizedOffers).length > 0) {
    console.log('\n📂 BY CATEGORY:');
    Object.entries(categorizedOffers).forEach(([category, offers]) => {
      const successful = offers.filter(o => o.geocoding?.success).length;
      console.log(`  ${category.padEnd(20)}: ${successful}/${offers.length} geocoded`);
    });
  }

  console.log(`\n💾 Results saved to: ${CONFIG.outputFile}`);
  
  // Create CSV export
  const csvRows = [];
  csvRows.push('Unique_ID,Category,Company,City,Location,Offer_Type,Discount,Latitude,Longitude,Formatted_Address,Success');

  geocodedOffers.forEach(offer => {
    const row = [
      offer.unique_id,
      offer.category || '',
      offer.company_name || offer.merchant_name || '',
      offer.city || '',
      offer.location || offer.address || '',
      offer.offer_type || '',
      offer.discount || '',
      offer.geocoding?.success ? offer.geocoding.latitude : '',
      offer.geocoding?.success ? offer.geocoding.longitude : '',
      offer.geocoding?.success ? offer.geocoding.formatted_address : '',
      offer.geocoding?.success ? 'Yes' : 'No'
    ].map(cell => `"${String(cell).replace(/"/g, '""')}"`);
    
    csvRows.push(row.join(','));
  });

  const csvFile = path.join(outputDir, 'sampath_offers_geocoded.csv');
  fs.writeFileSync(csvFile, csvRows.join('\n'));
  console.log(`💾 CSV export: ${csvFile}`);

  // Show failed geocoding
  const failed = geocodedOffers.filter(o => 
    o.geocoding && !o.geocoding.success && o.geocoding.error !== 'NO_ADDRESS'
  );
  
  if (failed.length > 0) {
    console.log(`\n⚠️  FAILED GEOCODING (${failed.length}):`);
    failed.slice(0, 10).forEach(offer => {
      const name = offer.company_name || offer.merchant_name || offer.title || 'Unknown';
      console.log(`  • ${name.substring(0, 50)} - ${offer.geocoding.error}`);
    });
    if (failed.length > 10) {
      console.log(`  ... and ${failed.length - 10} more`);
    }
  }

  // Show offers without addresses
  if (stats.no_address > 0) {
    console.log(`\n📝 OFFERS WITHOUT ADDRESS (${stats.no_address}):`);
    const noAddr = geocodedOffers.filter(o => o.geocoding?.error === 'NO_ADDRESS');
    noAddr.slice(0, 5).forEach(offer => {
      const name = offer.title || offer.company_name || offer.merchant_name || 'Unknown';
      console.log(`  • ${name.substring(0, 60)}`);
    });
    if (noAddr.length > 5) {
      console.log(`  ... and ${noAddr.length - 5} more`);
    }
  }

  console.log('\n✨ Geocoding completed!');
  console.log(`\n💡 Features:`);
  console.log(`   ✓ Unique IDs: sampath_<hash12>_<slug>`);
  console.log(`   ✓ Persistent cache: ${CONFIG.geoCacheDir}`);
  console.log(`   ✓ All original scraper data preserved`);
  console.log(`   ✓ Database-ready JSON output`);
  
  // Cache stats
  const geoCacheFiles = fs.readdirSync(CONFIG.geoCacheDir).filter(f => f.endsWith('.json'));
  console.log(`\n💾 Total cached addresses: ${geoCacheFiles.length}`);
  
  console.log(`\n📋 Usage:`);
  console.log(`   node geocode.js --input=./your_file.json --google-api-key=YOUR_KEY`);
  console.log(`   node geocode.js --input=./input.json --output=./output.json --google-api-key=KEY\n`);
}

// ============================================
// CLI
// ============================================

if (require.main === module) {
  geocodeAllOffers().catch(error => {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  });
}

module.exports = { 
  geocodeAllOffers, 
  geocodeAddress, 
  buildSearchAddress,
  generateUniqueOfferId,
  hasValidAddress
};