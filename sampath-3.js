/**
 * Geocoding System for Sampath Bank Offers - Enhanced Edition
 * Features:
 * - Persistent geo coordinate caching (never expires)
 * - Unique offer IDs (prevents database duplicates)
 * - Parallel processing with Google Geocoding API
 * - Database-ready structure
 * Requires: npm install axios p-limit
 * 
 * Setup: Set environment variable GOOGLE_MAPS_API_KEY
 * Usage: node geocode.js
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Dynamic import for p-limit (ES module)
let pLimit;
(async () => {
  pLimit = (await import('p-limit')).default;
})();

// Configuration
const CONFIG = {
  apiKey: process.env.GOOGLE_MAPS_API_KEY,
  cacheDir: './cache_sampath',
  geoCacheDir: './cache_sampath/geocode',
  offersFile: './sampath_offers_detailed.json',
  outputFile: './output/sampath_offers_geocoded.json',
  parallelRequests: 5,
  requestDelay: 100,
  timeout: 10000,
  retries: 2
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
 * Uses: company name, location, city, and offer type
 * Same offer across scrapes gets same ID
 */
function generateUniqueOfferId(offer) {
  const components = [
    'sampath',
    offer.company_name || '',
    offer.location || '',
    offer.city || '',
    offer.offer_type || '',
    offer.discount || ''
  ];
  
  const hashInput = components.join('|').toLowerCase().trim();
  const hash = crypto.createHash('sha256').update(hashInput).digest('hex');
  
  // Create readable slug from company name
  const slug = (offer.company_name || 'offer')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .substring(0, 20);
  
  // Return: sampath_<hash12>_<slug>
  return `sampath_${hash.substring(0, 12)}_${slug}`;
}

// ============================================
// GEOCODING CACHE (PERSISTENT)
// ============================================

let geocodingStats = {
  cached: 0,
  new: 0,
  failed: 0
};

/**
 * Get cache key for geocoding
 * Uses MD5 hash of normalized address
 */
function getGeoCacheKey(address) {
  const normalized = address.toLowerCase().trim();
  return crypto.createHash('md5').update(normalized).digest('hex');
}

/**
 * Load from persistent geo cache
 * Geo cache never expires - coordinates don't change!
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
      console.warn(`⚠️  Corrupted geo cache: ${address.substring(0, 50)}`);
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
    console.warn(`⚠️  Cache write error for ${address.substring(0, 50)}`);
  }
}

// ============================================
// ADDRESS BUILDING
// ============================================

/**
 * Build search address from offer data
 */
function buildSearchAddress(offer) {
  const parts = [];
  
  if (offer.company_name) parts.push(offer.company_name);
  if (offer.location) parts.push(offer.location);
  if (offer.city) parts.push(offer.city);
  parts.push('Sri Lanka');
  
  return parts.filter(p => p && p.trim()).join(', ');
}

// ============================================
// GEOCODING API
// ============================================

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Geocode address using Google API with persistent caching
 */
async function geocodeAddress(address, retryCount = 0) {
  if (!CONFIG.apiKey) {
    throw new Error('GOOGLE_MAPS_API_KEY environment variable not set');
  }

  // Check persistent cache first
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
        region: 'lk'
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
        address_components: apiResult.address_components.map(comp => ({
          long_name: comp.long_name,
          short_name: comp.short_name,
          types: comp.types
        })),
        timestamp: new Date().toISOString()
      };
      
      geocodingStats.new++;
      console.log(`      🗺️  Geocoded (NEW): ${address.substring(0, 60)}`);
      
    } else if (response.data.status === 'ZERO_RESULTS') {
      result = {
        success: false,
        original_address: address,
        error: 'NO_RESULTS',
        message: 'Address not found',
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

    // Save to persistent cache (even failures to avoid repeated API calls)
    saveGeoToCache(address, result);
    return result;

  } catch (error) {
    if (retryCount < CONFIG.retries) {
      console.log(`  🔄 Retry ${retryCount + 1}/${CONFIG.retries} for: ${address.substring(0, 50)}...`);
      await sleep(1000 * (retryCount + 1));
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
 * Process single offer: generate unique ID and geocode
 */
async function processOffer(offer, index, total) {
  const address = buildSearchAddress(offer);
  
  // Generate unique ID
  const uniqueId = generateUniqueOfferId(offer);
  
  // Geocode with caching
  console.log(`[${index + 1}/${total}] Processing: ${offer.company_name || 'Unknown'}`);
  const geocodeResult = await geocodeAddress(address);
  
  // Polite delay for non-cached requests
  if (!geocodeResult.cached && geocodingStats.new > 0) {
    await sleep(CONFIG.requestDelay);
  }
  
  return {
    unique_id: uniqueId,
    source: 'Sampath',
    category: offer.category,
    scraped_at: new Date().toISOString(),
    
    // Original offer data
    company_name: offer.company_name,
    location: offer.location,
    city: offer.city,
    offer_type: offer.offer_type,
    discount: offer.discount,
    description: offer.description,
    terms_and_conditions: offer.terms_and_conditions,
    contact_numbers: offer.contact_numbers,
    
    // Geocoding result
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
  console.log('║   Sampath Offers Geocoding System v2.0        ║');
  console.log('║   ✓ Unique IDs (no duplicates)                ║');
  console.log('║   ✓ Persistent Geo Cache (cost-effective)     ║');
  console.log('║   ✓ Google Maps API Integration               ║');
  console.log('╚════════════════════════════════════════════════╝\n');

  // Load p-limit dynamically
  if (!pLimit) {
    pLimit = (await import('p-limit')).default;
  }

  // Check for command-line API key FIRST (before validation)
  const args = process.argv.slice(2);
  const googleKeyArg = args.find(arg => arg.startsWith('--google-api-key='));
  if (googleKeyArg) {
    CONFIG.apiKey = googleKeyArg.split('=')[1];
    console.log('✓ Using API key from command line\n');
  }

  // Validate API key
  if (!CONFIG.apiKey) {
    console.error('❌ Error: GOOGLE_MAPS_API_KEY not set');
    console.error('\n📋 Please provide API key using one of these methods:\n');
    console.error('   1. Command line (recommended):');
    console.error('      node sampath-3.js --google-api-key=YOUR_KEY\n');
    console.error('   2. Environment variable:');
    console.error('      PowerShell: $env:GOOGLE_MAPS_API_KEY="your-api-key"');
    console.error('      Bash/Linux: export GOOGLE_MAPS_API_KEY="your-api-key"\n');
    process.exit(1);
  }

  // Load offers
  if (!fs.existsSync(CONFIG.offersFile)) {
    console.error(`❌ Error: ${CONFIG.offersFile} not found`);
    console.error('   Run the Sampath scraper first to generate offers data');
    process.exit(1);
  }

  console.log(`📖 Loading offers from: ${CONFIG.offersFile}`);
  const offersData = JSON.parse(fs.readFileSync(CONFIG.offersFile, 'utf8'));
  
  // Flatten all offers
  const allOffers = [];
  Object.entries(offersData.categories || {}).forEach(([category, offers]) => {
    if (Array.isArray(offers)) {
      offers.forEach(offer => {
        allOffers.push({ ...offer, category });
      });
    }
  });

  if (allOffers.length === 0) {
    console.error('❌ No offers found in the input file');
    process.exit(1);
  }

  // Reset stats
  geocodingStats = { cached: 0, new: 0, failed: 0 };

  console.log(`📍 Total offers to geocode: ${allOffers.length}`);
  console.log(`⚡ Parallel requests: ${CONFIG.parallelRequests}`);
  console.log(`💾 Geo cache directory: ${CONFIG.geoCacheDir}\n`);

  // Create rate limiter
  const limit = pLimit(CONFIG.parallelRequests);
  
  // Process all offers in parallel with rate limiting
  const startTime = Date.now();
  const geocodedOffers = await Promise.all(
    allOffers.map((offer, index) => 
      limit(() => processOffer(offer, index, allOffers.length))
    )
  );

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  // Organize results by category
  const categorizedOffers = {};
  geocodedOffers.forEach(offer => {
    if (!categorizedOffers[offer.category]) {
      categorizedOffers[offer.category] = [];
    }
    categorizedOffers[offer.category].push(offer);
  });

  // Calculate statistics
  const stats = {
    total: geocodedOffers.length,
    successful: geocodedOffers.filter(o => o.geocoding.success).length,
    failed: geocodedOffers.filter(o => !o.geocoding.success).length,
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
    categories: categorizedOffers,
    offers: geocodedOffers
  };

  fs.writeFileSync(CONFIG.outputFile, JSON.stringify(output, null, 2));

  // Print summary
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║              SUMMARY REPORT                    ║');
  console.log('╚════════════════════════════════════════════════╝\n');
  console.log(`Total offers           : ${stats.total}`);
  console.log(`✓ Successful          : ${stats.successful} (${((stats.successful/stats.total)*100).toFixed(1)}%)`);
  console.log(`✗ Failed              : ${stats.failed}`);
  console.log(`💾 From cache         : ${stats.cached}`);
  console.log(`🌐 API calls made     : ${stats.api_calls}`);
  console.log(`⏱️  Duration           : ${duration}s`);
  console.log(`⚡ Rate               : ${(stats.total / parseFloat(duration)).toFixed(1)} offers/sec`);

  // Category breakdown
  console.log('\n📂 BY CATEGORY:');
  Object.entries(categorizedOffers).forEach(([category, offers]) => {
    const successful = offers.filter(o => o.geocoding.success).length;
    console.log(`  ${category.padEnd(15)}: ${successful}/${offers.length} geocoded`);
  });

  console.log(`\n💾 Results saved to: ${CONFIG.outputFile}`);
  
  // Create simple CSV export with coordinates
  const csvRows = [];
  csvRows.push('Unique_ID,Source,Category,Company,City,Location,Latitude,Longitude,Formatted_Address,Success');

  geocodedOffers.forEach(offer => {
    const row = [
      offer.unique_id,
      offer.source,
      offer.category,
      offer.company_name,
      offer.city || '',
      offer.location || '',
      offer.geocoding.success ? offer.geocoding.latitude : '',
      offer.geocoding.success ? offer.geocoding.longitude : '',
      offer.geocoding.success ? offer.geocoding.formatted_address : '',
      offer.geocoding.success ? 'Yes' : 'No'
    ].map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',');
    
    csvRows.push(row);
  });

  const csvFile = path.join(outputDir, 'sampath_offers_geocoded.csv');
  fs.writeFileSync(csvFile, csvRows.join('\n'));
  console.log(`💾 CSV export saved to: ${csvFile}`);

  // Show failed geocoding attempts
  const failed = geocodedOffers.filter(o => !o.geocoding.success);
  if (failed.length > 0) {
    console.log(`\n⚠️  FAILED GEOCODING (${failed.length}):`);
    failed.slice(0, 10).forEach(offer => {
      console.log(`  • ${offer.company_name} - ${offer.geocoding.error}`);
    });
    if (failed.length > 10) {
      console.log(`  ... and ${failed.length - 10} more`);
    }
  }

  console.log('\n✨ Geocoding completed!');
  console.log(`\n💡 Key Features:`);
  console.log(`   ✓ Unique IDs: sampath_<hash>_<slug>`);
  console.log(`   ✓ Geo cache: ${CONFIG.geoCacheDir} (never expires)`);
  console.log(`   ✓ DB-ready structure with unique_id field`);
  console.log(`\n📋 Usage:`);
  console.log(`   --google-api-key=KEY   Override env variable`);
  
  // Display geo cache stats
  const geoCacheFiles = fs.readdirSync(CONFIG.geoCacheDir);
  console.log(`\n💾 Geo cache: ${geoCacheFiles.length} addresses cached\n`);
}

// ============================================
// CLI
// ============================================

if (require.main === module) {
  geocodeAllOffers().catch(error => {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  });
}

module.exports = { 
  geocodeAllOffers, 
  geocodeAddress, 
  buildSearchAddress,
  generateUniqueOfferId
};