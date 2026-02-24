/**
 * HNB Bank Offers Scraper - Parallel Fetching with Caching
 * Requires: npm install axios
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configuration
const CONFIG = {
  maxRetries: 3,
  retryDelay: 2000,
  timeout: 15000,
  maxConcurrent: 5, // Max parallel requests
  cacheDir: './cache_hnb',
  cacheExpiry: 24 * 60 * 60 * 1000, // 24 hours
  useCache: true
};

// Categories mapping
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

// Create cache directory
if (!fs.existsSync(CONFIG.cacheDir)) {
  fs.mkdirSync(CONFIG.cacheDir, { recursive: true });
}

function getCacheKey(url) {
  return crypto.createHash('md5').update(url).digest('hex');
}

function getCachePath(url) {
  const key = getCacheKey(url);
  return path.join(CONFIG.cacheDir, `${key}.json`);
}

function isCacheValid(cachePath) {
  if (!fs.existsSync(cachePath)) return false;
  
  const stats = fs.statSync(cachePath);
  const age = Date.now() - stats.mtime.getTime();
  return age < CONFIG.cacheExpiry;
}

function saveToCache(url, data) {
  const cachePath = getCachePath(url);
  const cacheData = {
    url: url,
    cachedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + CONFIG.cacheExpiry).toISOString(),
    data: data
  };
  
  fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2));
}

function loadFromCache(url) {
  if (!CONFIG.useCache) return null;
  
  const cachePath = getCachePath(url);
  
  if (isCacheValid(cachePath)) {
    const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    return cacheData.data;
  }
  
  return null;
}

function clearCache() {
  if (fs.existsSync(CONFIG.cacheDir)) {
    const files = fs.readdirSync(CONFIG.cacheDir);
    files.forEach(file => {
      fs.unlinkSync(path.join(CONFIG.cacheDir, file));
    });
    console.log(`🗑️  Cleared ${files.length} cached files`);
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJSON(url, retryCount = 0) {
  // Try cache first
  const cachedData = loadFromCache(url);
  if (cachedData) {
    return { data: cachedData, fromCache: true };
  }
  
  // Fetch from API
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'keep-alive'
      },
      timeout: CONFIG.timeout
    });
    
    const data = response.data;
    saveToCache(url, data);
    
    return { data, fromCache: false };
    
  } catch (error) {
    // Retry logic
    if (retryCount < CONFIG.maxRetries) {
      const delay = CONFIG.retryDelay * (retryCount + 1);
      await sleep(delay);
      return fetchJSON(url, retryCount + 1);
    }
    
    throw error;
  }
}

// Parallel fetch with concurrency control
async function fetchAllParallel(urls, label = 'items') {
  const results = [];
  let completed = 0;
  let cacheHits = 0;
  let freshDownloads = 0;
  
  // Process in batches
  for (let i = 0; i < urls.length; i += CONFIG.maxConcurrent) {
    const batch = urls.slice(i, i + CONFIG.maxConcurrent);
    
    const batchPromises = batch.map(async (url) => {
      try {
        const { data, fromCache } = await fetchJSON(url);
        if (fromCache) cacheHits++;
        else freshDownloads++;
        return { success: true, data, url, fromCache };
      } catch (error) {
        return { success: false, error: error.message, url };
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    completed += batch.length;
    process.stdout.write(`\r  📊 Progress: ${completed}/${urls.length} ${label} (💾 ${cacheHits} | 🌐 ${freshDownloads})`);
  }
  
  console.log(''); // New line
  return { results, stats: { cacheHits, freshDownloads } };
}

async function scrapeCategoryOffers(category) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📂 Category: ${category.name} (ID: ${category.id})`);
  console.log('='.repeat(60));
  
  try {
    // Step 1: Get first page to determine total pages
    const firstPageUrl = category.url.replace('{page}', '1');
    const { data: firstPageData } = await fetchJSON(firstPageUrl);
    
    const totalPages = firstPageData.totalPages || 1;
    const totalOffers = firstPageData.total || 0;
    
    console.log(`  📊 Total pages: ${totalPages}, Total offers: ${totalOffers}`);
    
    let allOffers = [...(firstPageData.data || [])];
    let pageStats = { cacheHits: 0, freshDownloads: 0 };
    
    // Step 2: Fetch remaining pages in parallel
    if (totalPages > 1) {
      console.log(`  🚀 Fetching ${totalPages - 1} remaining pages in parallel...`);
      
      const pageUrls = [];
      for (let page = 2; page <= totalPages; page++) {
        pageUrls.push(category.url.replace('{page}', page));
      }
      
      const parallelResult = await fetchAllParallel(pageUrls, 'pages');
      pageStats = parallelResult.stats;
      
      parallelResult.results.forEach(result => {
        if (result.success && result.data.data) {
          allOffers.push(...result.data.data);
        }
      });
      
      console.log(`  ✓ Pages fetched - Cache: ${pageStats.cacheHits}, Fresh: ${pageStats.freshDownloads}`);
    }
    
    console.log(`  📦 Total offers collected: ${allOffers.length}`);
    
    // Step 3: Fetch all offer details in parallel
    console.log(`  🔍 Fetching details for ${allOffers.length} offers in parallel...`);
    
    const detailUrls = allOffers.map(offer => 
      `https://venus.hnb.lk/api/get_web_card_promo?id=${offer.id}`
    );
    
    const { results: detailResults, stats: detailStats } = await fetchAllParallel(detailUrls, 'details');
    
    // Step 4: Combine data
    const detailedOffers = allOffers.map((offer, index) => {
      const detailResult = detailResults[index];
      
      return {
        ...offer,
        category: category.name,
        categoryId: category.id,
        details: detailResult.success ? detailResult.data : null,
        error: detailResult.success ? null : detailResult.error
      };
    });
    
    console.log(`  ✓ Details fetched - Cache: ${detailStats.cacheHits}, Fresh: ${detailStats.freshDownloads}`);
    console.log(`  ✅ ${category.name} completed!`);
    
    return {
      success: true,
      category: category.name,
      categoryId: category.id,
      totalOffers: detailedOffers.length,
      offers: detailedOffers,
      stats: {
        pagesCacheHits: pageStats?.cacheHits || 0,
        pagesFreshDownloads: pageStats?.freshDownloads || 0,
        detailsCacheHits: detailStats.cacheHits,
        detailsFreshDownloads: detailStats.freshDownloads
      }
    };
    
  } catch (error) {
    console.error(`  ❌ Failed: ${error.message}`);
    return {
      success: false,
      category: category.name,
      categoryId: category.id,
      error: error.message
    };
  }
}

async function scrapeAllCategories(categoriesToScrape) {
  console.log(`\n🚀 Starting parallel scraping of ${categoriesToScrape.length} categories...\n`);
  
  const startTime = Date.now();
  
  // Scrape all categories in parallel
  const categoryPromises = categoriesToScrape.map(category => scrapeCategoryOffers(category));
  const categoryResults = await Promise.all(categoryPromises);
  
  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);
  
  // Build results object
  const allResults = {};
  const stats = {
    totalOffers: 0,
    successfulCategories: 0,
    failedCategories: 0,
    totalCacheHits: 0,
    totalFreshDownloads: 0
  };
  
  categoryResults.forEach(result => {
    allResults[result.category] = result;
    
    if (result.success) {
      stats.successfulCategories++;
      stats.totalOffers += result.totalOffers;
      stats.totalCacheHits += (result.stats.pagesCacheHits + result.stats.detailsCacheHits);
      stats.totalFreshDownloads += (result.stats.pagesFreshDownloads + result.stats.detailsFreshDownloads);
    } else {
      stats.failedCategories++;
    }
  });
  
  stats.duration = duration;
  
  return { results: allResults, stats };
}

async function main() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║     HNB Bank Offers Scraper v3.0               ║');
  console.log('║     ⚡ PARALLEL FETCHING with Caching          ║');
  console.log('╚════════════════════════════════════════════════╝\n');
  
  // Handle command-line arguments
  const args = process.argv.slice(2);
  
  if (args.includes('--clear-cache')) {
    clearCache();
    return;
  }
  
  if (args.includes('--no-cache')) {
    CONFIG.useCache = false;
    console.log('⚠️  Cache disabled - forcing fresh downloads\n');
  }
  
  // Check for concurrency setting
  const concurrentArg = args.find(arg => arg.startsWith('--concurrent='));
  if (concurrentArg) {
    CONFIG.maxConcurrent = parseInt(concurrentArg.split('=')[1]);
    console.log(`⚙️  Max concurrent requests: ${CONFIG.maxConcurrent}\n`);
  }
  
  // Check for specific category
  const categoryArg = args.find(arg => arg.startsWith('--category='));
  let categoriesToScrape = CATEGORIES;
  
  if (categoryArg) {
    const categoryName = categoryArg.split('=')[1];
    categoriesToScrape = CATEGORIES.filter(c => 
      c.name.toLowerCase().includes(categoryName.toLowerCase())
    );
    
    if (categoriesToScrape.length === 0) {
      console.log(`❌ Category "${categoryName}" not found`);
      console.log('Available categories:', CATEGORIES.map(c => c.name).join(', '));
      return;
    }
  }
  
  console.log(`📂 Scraping ${categoriesToScrape.length} categories with parallel processing...`);
  console.log(`⚡ Max ${CONFIG.maxConcurrent} concurrent requests per batch`);
  
  const { results: allResults, stats } = await scrapeAllCategories(categoriesToScrape);
  
  // Print Summary
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║              SUMMARY REPORT                    ║');
  console.log('╚════════════════════════════════════════════════╝\n');
  
  Object.entries(allResults).forEach(([category, result]) => {
    if (result.success) {
      const cacheRatio = result.stats.pagesCacheHits + result.stats.detailsCacheHits;
      const cacheIndicator = cacheRatio > 0 ? '💾' : '🌐';
      console.log(`✅ ${cacheIndicator} ${category.padEnd(20)}: ${result.totalOffers.toString().padStart(4)} offers`);
    } else {
      console.log(`❌ ${category.padEnd(23)}: Failed`);
    }
  });
  
  console.log('\n' + '─'.repeat(60));
  console.log(`Total offers scraped    : ${stats.totalOffers}`);
  console.log(`Successful categories   : ${stats.successfulCategories}`);
  console.log(`Failed categories       : ${stats.failedCategories}`);
  console.log(`Cache hits              : ${stats.totalCacheHits}`);
  console.log(`Fresh downloads         : ${stats.totalFreshDownloads}`);
  console.log(`Time taken              : ${stats.duration}s ⚡`);
  console.log('─'.repeat(60));
  
  // Save complete results
  const outputDir = './output';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  fs.writeFileSync(
    path.join(outputDir, 'hnb_all_offers.json'),
    JSON.stringify({ 
      timestamp: new Date().toISOString(), 
      stats, 
      results: allResults 
    }, null, 2)
  );
  console.log('\n💾 Complete data saved to: ./output/hnb_all_offers.json');
  
  // Create flattened simple version
  const simpleData = [];
  Object.entries(allResults).forEach(([category, result]) => {
    if (result.success && result.offers) {
      result.offers.forEach(offer => {
        simpleData.push({
          category: category,
          id: offer.id,
          title: offer.title,
          merchant: offer.merchant,
          cardType: offer.cardType,
          validUntil: offer.to,
          thumbnail: offer.thumb,
          content: offer.details?.content || null,
          from: offer.details?.from || null
        });
      });
    }
  });
  
  fs.writeFileSync(
    path.join(outputDir, 'hnb_offers_simple.json'),
    JSON.stringify(simpleData, null, 2)
  );
  console.log('💾 Simple data saved to: ./output/hnb_offers_simple.json');
  
  // Create CSV export
  if (simpleData.length > 0) {
    const csvHeader = 'Category,ID,Title,Merchant,Card Type,Valid Until\n';
    const csvRows = simpleData.map(o => 
      `"${o.category}","${o.id}","${o.title.replace(/"/g, '""')}","${o.merchant}","${o.cardType}","${o.validUntil}"`
    ).join('\n');
    fs.writeFileSync(path.join(outputDir, 'hnb_offers.csv'), csvHeader + csvRows);
    console.log('💾 CSV export saved to: ./output/hnb_offers.csv');
  }
  
  console.log('\n✨ Scraping completed!');
  console.log(`📦 Cache directory: ${CONFIG.cacheDir}`);
  console.log(`⏰ Cache expires after: ${CONFIG.cacheExpiry / (60 * 60 * 1000)} hours`);
  console.log(`\n💡 Usage tips:`);
  console.log(`   --clear-cache              Clear all cached data`);
  console.log(`   --no-cache                 Force fresh downloads`);
  console.log(`   --category=<name>          Scrape specific category`);
  console.log(`   --concurrent=<n>           Set max concurrent requests (default: 5)\n`);
}

// Run
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  scrapeCategoryOffers,
  scrapeAllCategories,
  clearCache,
  CATEGORIES
};