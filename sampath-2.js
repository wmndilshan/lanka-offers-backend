/**
 * Geocoding System for Sampath Bank Offers
 * Uses Google Geocoding API with caching and parallelism
 * Requires: npm install axios p-limit
 * 
 * Setup: Set environment variable GOOGLE_MAPS_API_KEY
 * Usage: node geocode.js
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Dynamic import for p-limit (ES module)
let pLimit;
(async () => {
  pLimit = (await import('p-limit')).default;
})();

// Configuration
const CONFIG = {
  apiKey: process.env.GOOGLE_MAPS_API_KEY,
  cacheDir: './cache',
  offersFile: './sampath_offers_detailed.json',
  outputFile: './sampath_offers_geocoded.json',
  parallelRequests: 5, // Concurrent API calls
  requestDelay: 100, // ms delay between requests
  timeout: 10000,
  retries: 2
};

// Ensure cache directory exists
function ensureCacheDir() {
  if (!fs.existsSync(CONFIG.cacheDir)) {
    fs.mkdirSync(CONFIG.cacheDir, { recursive: true });
    console.log(`📁 Created cache directory: ${CONFIG.cacheDir}`);
  }
}

// Generate cache key from address
function getCacheKey(address) {
  const normalized = address.toLowerCase().trim().replace(/\s+/g, '_');
  const hash = normalized.substring(0, 100); // Limit length
  return `${hash}.json`;
}

// Load from cache
function loadFromCache(cacheKey) {
  const cachePath = path.join(CONFIG.cacheDir, cacheKey);
  if (fs.existsSync(cachePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      return data;
    } catch (error) {
      console.warn(`⚠️  Cache read error for ${cacheKey}`);
      return null;
    }
  }
  return null;
}

// Save to cache
function saveToCache(cacheKey, data) {
  const cachePath = path.join(CONFIG.cacheDir, cacheKey);
  try {
    fs.writeFileSync(cachePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.warn(`⚠️  Cache write error for ${cacheKey}`);
  }
}

// Build search address
function buildSearchAddress(offer) {
  const parts = [];
  
  if (offer.company_name) parts.push(offer.company_name);
  if (offer.location) parts.push(offer.location);
  if (offer.city) parts.push(offer.city);
  parts.push('Sri Lanka');
  
  return parts.filter(p => p && p.trim()).join(', ');
}

// Sleep utility
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Geocode address using Google API
async function geocodeAddress(address, retryCount = 0) {
  if (!CONFIG.apiKey) {
    throw new Error('GOOGLE_MAPS_API_KEY environment variable not set');
  }

  const url = 'https://maps.googleapis.com/maps/api/geocode/json';
  
  try {
    const response = await axios.get(url, {
      params: {
        address: address,
        key: CONFIG.apiKey,
        region: 'lk' // Bias towards Sri Lanka
      },
      timeout: CONFIG.timeout
    });

    if (response.data.status === 'OK' && response.data.results.length > 0) {
      const result = response.data.results[0];
      return {
        success: true,
        latitude: result.geometry.location.lat,
        longitude: result.geometry.location.lng,
        formatted_address: result.formatted_address,
        place_id: result.place_id,
        types: result.types,
        timestamp: new Date().toISOString()
      };
    } else if (response.data.status === 'ZERO_RESULTS') {
      return {
        success: false,
        error: 'NO_RESULTS',
        message: 'Address not found',
        timestamp: new Date().toISOString()
      };
    } else {
      return {
        success: false,
        error: response.data.status,
        message: response.data.error_message || 'Geocoding failed',
        timestamp: new Date().toISOString()
      };
    }

  } catch (error) {
    if (retryCount < CONFIG.retries) {
      console.log(`  🔄 Retry ${retryCount + 1}/${CONFIG.retries} for: ${address.substring(0, 50)}...`);
      await sleep(1000 * (retryCount + 1));
      return geocodeAddress(address, retryCount + 1);
    }
    
    return {
      success: false,
      error: 'API_ERROR',
      message: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

// Process single offer
async function processOffer(offer, index, total) {
  const address = buildSearchAddress(offer);
  const cacheKey = getCacheKey(address);
  
  // Check cache first
  let geocodeResult = loadFromCache(cacheKey);
  let fromCache = false;
  
  if (geocodeResult) {
    fromCache = true;
  } else {
    // Make API call
    console.log(`[${index + 1}/${total}] Geocoding: ${address.substring(0, 60)}...`);
    geocodeResult = await geocodeAddress(address);
    
    // Save to cache
    saveToCache(cacheKey, {
      address: address,
      result: geocodeResult
    });
    
    // Polite delay
    await sleep(CONFIG.requestDelay);
  }
  
  return {
    ...offer,
    geocoding: {
      search_address: address,
      ...geocodeResult,
      cached: fromCache
    }
  };
}

// Main geocoding function
async function geocodeAllOffers() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║   Sampath Offers Geocoding System     ║');
  console.log('║   Google Maps API + Smart Caching     ║');
  console.log('╚════════════════════════════════════════╝\n');

  // Load p-limit dynamically
  if (!pLimit) {
    pLimit = (await import('p-limit')).default;
  }

  // Validate API key
  if (!CONFIG.apiKey) {
    console.error('❌ Error: GOOGLE_MAPS_API_KEY not set');
    console.error('   PowerShell: $env:GOOGLE_MAPS_API_KEY="your-api-key"');
    console.error('   Bash/Linux: export GOOGLE_MAPS_API_KEY="your-api-key"');
    process.exit(1);
  }

  // Ensure cache directory
  ensureCacheDir();

  // Load offers
  if (!fs.existsSync(CONFIG.offersFile)) {
    console.error(`❌ Error: ${CONFIG.offersFile} not found`);
    console.error('   Run the scraper first to generate offers data');
    process.exit(1);
  }

  console.log(`📖 Loading offers from: ${CONFIG.offersFile}`);
  const offersData = JSON.parse(fs.readFileSync(CONFIG.offersFile, 'utf8'));
  
  // Flatten all offers
  const allOffers = [];
  Object.entries(offersData.categories).forEach(([category, offers]) => {
    offers.forEach(offer => {
      allOffers.push({ ...offer, category });
    });
  });

  console.log(`📍 Total offers to geocode: ${allOffers.length}`);
  console.log(`⚡ Parallel requests: ${CONFIG.parallelRequests}`);
  console.log(`💾 Cache directory: ${CONFIG.cacheDir}\n`);

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
    cached: geocodedOffers.filter(o => o.geocoding.cached).length,
    api_calls: geocodedOffers.filter(o => !o.geocoding.cached).length,
    duration_seconds: parseFloat(duration)
  };

  // Save results
  const output = {
    source: 'Sampath Bank with Geocoding',
    geocoded_at: new Date().toISOString(),
    statistics: stats,
    categories: categorizedOffers
  };

  fs.writeFileSync(CONFIG.outputFile, JSON.stringify(output, null, 2));

  // Print summary
  console.log('\n📊 GEOCODING SUMMARY');
  console.log('═'.repeat(50));
  console.log(`Total offers:      ${stats.total}`);
  console.log(`✓ Successful:      ${stats.successful} (${((stats.successful/stats.total)*100).toFixed(1)}%)`);
  console.log(`✗ Failed:          ${stats.failed}`);
  console.log(`💾 From cache:     ${stats.cached}`);
  console.log(`🌐 API calls made: ${stats.api_calls}`);
  console.log(`⏱️  Duration:       ${duration}s`);
  console.log(`⚡ Rate:           ${(stats.total / parseFloat(duration)).toFixed(1)} offers/sec`);
  console.log('═'.repeat(50));

  // Category breakdown
  console.log('\n📂 BY CATEGORY:');
  Object.entries(categorizedOffers).forEach(([category, offers]) => {
    const successful = offers.filter(o => o.geocoding.success).length;
    console.log(`  ${category.padEnd(15)}: ${successful}/${offers.length} geocoded`);
  });

  console.log(`\n💾 Results saved to: ${CONFIG.outputFile}`);
  
  // Create simple CSV export with coordinates
  const csvRows = [];
  csvRows.push('Category,Company,City,Location,Latitude,Longitude,Formatted Address,Success');

  geocodedOffers.forEach(offer => {
    const row = [
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

  const csvFile = 'sampath_offers_geocoded.csv';
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

  console.log('\n✨ Geocoding completed!\n');
}

// CLI
if (require.main === module) {
  geocodeAllOffers().catch(error => {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  });
}

module.exports = { geocodeAllOffers, geocodeAddress, buildSearchAddress };