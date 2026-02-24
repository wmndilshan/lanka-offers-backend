/**
 * HNB Bank Offers Scraper - Rule-Based Parser (No LLM)
 * Uses regex algorithms to extract structured data accurately
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
  maxConcurrent: 5,
  cacheDir: './cache_hnb',
  cacheExpiry: 24 * 60 * 60 * 1000,
  useCache: true,
  
  // Google Geocoding API
  googleApiKey: '',
  enableGeocoding: false,
  geocodeConcurrent: 5
};

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

if (!fs.existsSync(CONFIG.cacheDir)) {
  fs.mkdirSync(CONFIG.cacheDir, { recursive: true });
}

function getCacheKey(url) {
  return crypto.createHash('md5').update(url).digest('hex');
}

function getCachePath(url) {
  return path.join(CONFIG.cacheDir, `${getCacheKey(url)}.json`);
}

function isCacheValid(cachePath) {
  if (!fs.existsSync(cachePath)) return false;
  const stats = fs.statSync(cachePath);
  return Date.now() - stats.mtime.getTime() < CONFIG.cacheExpiry;
}

function saveToCache(url, data) {
  const cachePath = getCachePath(url);
  fs.writeFileSync(cachePath, JSON.stringify({
    url, cachedAt: new Date().toISOString(), data
  }, null, 2));
}

function loadFromCache(url) {
  if (!CONFIG.useCache) return null;
  const cachePath = getCachePath(url);
  if (isCacheValid(cachePath)) {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8')).data;
  }
  return null;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJSON(url, retryCount = 0) {
  const cachedData = loadFromCache(url);
  if (cachedData) return { data: cachedData, fromCache: true };
  
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      },
      timeout: CONFIG.timeout
    });
    
    saveToCache(url, response.data);
    return { data: response.data, fromCache: false };
  } catch (error) {
    if (retryCount < CONFIG.maxRetries) {
      await sleep(CONFIG.retryDelay * (retryCount + 1));
      return fetchJSON(url, retryCount + 1);
    }
    throw error;
  }
}

async function fetchAllParallel(urls, label = 'items') {
  const results = [];
  let completed = 0;
  
  for (let i = 0; i < urls.length; i += CONFIG.maxConcurrent) {
    const batch = urls.slice(i, i + CONFIG.maxConcurrent);
    const batchResults = await Promise.all(
      batch.map(async (url) => {
        try {
          const { data } = await fetchJSON(url);
          return { success: true, data, url };
        } catch (error) {
          return { success: false, error: error.message, url };
        }
      })
    );
    
    results.push(...batchResults);
    completed += batch.length;
    process.stdout.write(`\r  📊 ${label}: ${completed}/${urls.length}`);
  }
  
  console.log('');
  return results;
}

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

// Rule-based parser - extract structured data using regex
function parseOfferData(rawText, merchant, title) {
  const data = {
    merchant_name: merchant.trim(),
    addresses: [],
    location_details: [],
    discount_percentage: null,
    discount_description: '',
    applicable_cards: [],
    valid_from: null,
    valid_until: null,
    contact_phone: [],
    contact_email: [],
    booking_required: false,
    key_restrictions: [],
    days_applicable: null,
    special_conditions: []
  };

  // Extract merchant from "Merchant:" field (override if found)
  const merchantMatch = rawText.match(/Merchant:\s*([^\n]+)/i);
  if (merchantMatch) {
    const extractedMerchant = merchantMatch[1].trim();
    // Only use if it's not too long (avoid capturing full text)
    if (extractedMerchant.length < 200) {
      data.merchant_name = extractedMerchant;
    }
  }

  // Extract location from "Location:" field
  const locationMatch = rawText.match(/Location:\s*([^\n]+)/i);
  if (locationMatch) {
    const location = locationMatch[1].trim();
    // Validate location is reasonable length
    if (location.length > 0 && location.length < 100) {
      data.location_details.push(location);
      // Create clean address: "Merchant Name, Location, Sri Lanka"
      data.addresses.push(`${data.merchant_name}, ${location}, Sri Lanka`);
    }
  }

  // If no location found, use merchant name only
  if (data.addresses.length === 0) {
    data.addresses.push(`${data.merchant_name}, Sri Lanka`);
  }

  // Extract discount percentage
  const discountMatch = rawText.match(/(\d+(?:\.\d+)?)\s*%\s*(?:off|discount)/i);
  if (discountMatch) {
    data.discount_percentage = discountMatch[1];
  }

  // Extract discount range (e.g., "30-50%", "up to 50%")
  const rangeMatch = rawText.match(/(?:up to|upto)\s*(\d+)\s*%|(\d+)\s*-\s*(\d+)\s*%/i);
  if (rangeMatch) {
    if (rangeMatch[1]) {
      data.discount_percentage = `up to ${rangeMatch[1]}`;
    } else if (rangeMatch[2] && rangeMatch[3]) {
      data.discount_percentage = `${rangeMatch[2]}-${rangeMatch[3]}`;
    }
  }

  // Extract discount description from offer
  const offerMatch = rawText.match(/Offer:\s*([^\n]+(?:\n(?!(?:Period|Eligibility|Contact|Location|Special|General):)[^\n]+)*)/i);
  if (offerMatch) {
    data.discount_description = offerMatch[1].trim().replace(/\s+/g, ' ');
  }

  // Extract card types
  const cardTypes = [];
  if (/credit\s+card/i.test(rawText)) cardTypes.push('Credit Card');
  if (/debit\s+card/i.test(rawText)) cardTypes.push('Debit Card');
  if (/visa/i.test(rawText)) cardTypes.push('Visa');
  if (/mastercard/i.test(rawText)) cardTypes.push('Mastercard');
  data.applicable_cards = [...new Set(cardTypes)];

  // Extract dates from Period section
  const periodMatch = rawText.match(/Period:\s*([^\n]+(?:\n(?!(?:Eligibility|Contact|Location|Special|General):)[^\n]+)*)/i);
  if (periodMatch) {
    const periodText = periodMatch[1];
    
    // Extract date ranges
    const dateRanges = periodText.match(/(\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:to|–|-)\s+\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/gi);
    
    // Extract structured dates (YYYY-MM-DD format)
    const structuredDates = periodText.match(/\d{4}-\d{2}-\d{2}/g);
    
    if (structuredDates && structuredDates.length >= 2) {
      data.valid_from = structuredDates[0];
      data.valid_until = structuredDates[structuredDates.length - 1];
    }
  }

  // Fallback: extract dates directly
  if (!data.valid_from || !data.valid_until) {
    const allDates = rawText.match(/\d{4}-\d{2}-\d{2}/g);
    if (allDates && allDates.length >= 2) {
      data.valid_from = allDates[0];
      data.valid_until = allDates[allDates.length - 1];
    }
  }

  // Extract contact phone numbers
  const phoneMatches = rawText.match(/(?:Contact(?:\s+No)?|Tel|Phone):\s*([\d\s,/]+)/gi);
  if (phoneMatches) {
    phoneMatches.forEach(match => {
      const phones = match.replace(/(?:Contact(?:\s+No)?|Tel|Phone):/gi, '').trim();
      const phoneNumbers = phones.split(/[,\/]/).map(p => p.trim()).filter(p => p.length > 0);
      data.contact_phone.push(...phoneNumbers);
    });
  }

  // Extract email
  const emailMatch = rawText.match(/[\w.-]+@[\w.-]+\.\w+/g);
  if (emailMatch) {
    data.contact_email = emailMatch;
  }

  // Check if booking required
  data.booking_required = /reservation|booking|book|advance/i.test(rawText);

  // Extract days applicable
  const daysMatch = rawText.match(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:\s+to\s+|\s*-\s*)(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i);
  if (daysMatch) {
    data.days_applicable = `${daysMatch[1]} to ${daysMatch[2]}`;
  } else if (/weekday/i.test(rawText)) {
    data.days_applicable = 'Weekdays';
  } else if (/weekend/i.test(rawText)) {
    data.days_applicable = 'Weekends';
  } else if (/all days/i.test(rawText)) {
    data.days_applicable = 'All days';
  }

  // Extract special conditions
  const specialMatch = rawText.match(/Special Terms and Conditions:\s*([^\n]+(?:\n(?!General Terms)[^\n]+)*)/i);
  if (specialMatch) {
    const conditions = specialMatch[1]
      .split(/\n/)
      .map(c => c.trim())
      .filter(c => c.length > 0 && !c.startsWith('General'));
    data.special_conditions = conditions;
  }

  // Extract key restrictions
  const restrictions = [];
  if (/cannot be combined/i.test(rawText)) {
    restrictions.push('Cannot be combined with other offers');
  }
  if (/non-refundable/i.test(rawText)) {
    restrictions.push('Non-refundable');
  }
  if (/advance payment/i.test(rawText)) {
    restrictions.push('Advance payment required');
  }
  if (/subject to availability/i.test(rawText)) {
    restrictions.push('Subject to availability');
  }
  data.key_restrictions = restrictions;

  return data;
}

// Geocoding
async function geocodeAddress(address) {
  if (!CONFIG.enableGeocoding || !CONFIG.googleApiKey) {
    return null;
  }
  
  const cacheKey = `geo_${crypto.createHash('md5').update(address).digest('hex')}`;
  const cachePath = path.join(CONFIG.cacheDir, `${cacheKey}.json`);
  
  if (fs.existsSync(cachePath)) {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    return cached.data;
  }
  
  try {
    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: {
        address: address,
        key: CONFIG.googleApiKey,
        region: 'lk'
      },
      timeout: 10000
    });
    
    if (response.data.status === 'OK' && response.data.results.length > 0) {
      const result = response.data.results[0];
      const location = {
        latitude: result.geometry.location.lat,
        longitude: result.geometry.location.lng,
        formatted_address: result.formatted_address,
        place_id: result.place_id,
        types: result.types
      };
      
      fs.writeFileSync(cachePath, JSON.stringify({ data: location }, null, 2));
      return location;
    }
    
    return null;
    
  } catch (error) {
    return null;
  }
}

async function geocodeAddressesBatch(addresses) {
  if (!CONFIG.enableGeocoding || addresses.length === 0) {
    return [];
  }
  
  const results = [];
  
  for (let i = 0; i < addresses.length; i += CONFIG.geocodeConcurrent) {
    const batch = addresses.slice(i, i + CONFIG.geocodeConcurrent);
    
    const batchResults = await Promise.all(
      batch.map(async (addr) => {
        const location = await geocodeAddress(addr);
        return location ? { original_address: addr, ...location } : null;
      })
    );
    
    results.push(...batchResults.filter(r => r !== null));
    await sleep(200);
  }
  
  return results;
}

// Concurrent Pipeline
class ConcurrentPipeline {
  constructor() {
    this.stats = {
      parsed: 0,
      geocoded: 0,
      total: 0
    };
  }

  async processOffer(offer) {
    this.stats.total++;
    
    // Parse with rule-based algorithm
    const rawText = stripHtml(offer.htmlContent);
    const parsedData = parseOfferData(rawText, offer.merchant, offer.title);
    this.stats.parsed++;
    
    // Geocode addresses concurrently
    const geocodedLocations = await geocodeAddressesBatch(parsedData.addresses);
    this.stats.geocoded += geocodedLocations.length;
    
    return {
      id: offer.id,
      category: offer.category,
      structured_data: {
        ...parsedData,
        geocoded_locations: geocodedLocations
      }
    };
  }

  async processBatch(offers) {
    const results = [];
    
    for (let i = 0; i < offers.length; i += CONFIG.maxConcurrent) {
      const batch = offers.slice(i, i + CONFIG.maxConcurrent);
      
      const batchResults = await Promise.all(
        batch.map(offer => this.processOffer(offer))
      );
      
      results.push(...batchResults);
      
      process.stdout.write(
        `\r  🔄 Parsed: ${this.stats.parsed}/${this.stats.total} | ` +
        `🗺️  Geocoded: ${this.stats.geocoded} locations`
      );
    }
    
    console.log('');
    return results;
  }
}

async function scrapeCategoryOffers(category) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📂 Category: ${category.name} (ID: ${category.id})`);
  console.log('='.repeat(60));
  
  try {
    const firstPageUrl = category.url.replace('{page}', '1');
    const { data: firstPageData } = await fetchJSON(firstPageUrl);
    
    const totalPages = firstPageData.totalPages || 1;
    console.log(`  📊 Total pages: ${totalPages}`);
    
    let allOffers = [...(firstPageData.data || [])];
    
    if (totalPages > 1) {
      const pageUrls = [];
      for (let page = 2; page <= totalPages; page++) {
        pageUrls.push(category.url.replace('{page}', page));
      }
      
      const results = await fetchAllParallel(pageUrls, 'Fetching pages');
      results.forEach(r => {
        if (r.success && r.data.data) allOffers.push(...r.data.data);
      });
    }
    
    console.log(`  📦 Total offers: ${allOffers.length}`);
    
    const detailUrls = allOffers.map(o => 
      `https://venus.hnb.lk/api/get_web_card_promo?id=${o.id}`
    );
    
    const detailResults = await fetchAllParallel(detailUrls, 'Fetching details');
    
    const rawOffers = allOffers.map((offer, index) => {
      const detail = detailResults[index];
      const fullDetails = detail.success ? detail.data : null;
      
      return {
        id: offer.id,
        title: offer.title || '',
        merchant: offer.merchant || fullDetails?.merchant || '',
        cardType: offer.cardType || fullDetails?.cardType || '',
        category: category.name,
        categoryId: category.id,
        validFrom: offer.from || fullDetails?.from || '',
        validUntil: offer.to || fullDetails?.to || '',
        htmlContent: fullDetails?.content || ''
      };
    });
    
    console.log(`  🚀 Processing with rule-based parser...`);
    const pipeline = new ConcurrentPipeline();
    const processedOffers = await pipeline.processBatch(rawOffers);
    
    console.log(`  ✅ ${category.name} completed!`);
    console.log(`     Parsed: ${pipeline.stats.parsed}`);
    console.log(`     Locations geocoded: ${pipeline.stats.geocoded}`);
    
    return {
      success: true,
      category: category.name,
      categoryId: category.id,
      totalOffers: processedOffers.length,
      offers: processedOffers,
      stats: pipeline.stats
    };
    
  } catch (error) {
    console.error(`  ❌ Failed: ${error.message}`);
    return {
      success: false,
      category: category.name,
      error: error.message,
      offers: []
    };
  }
}

async function scrapeAllCategories(categoriesToScrape) {
  console.log(`\n🚀 Starting concurrent processing for ${categoriesToScrape.length} categories...\n`);
  
  const startTime = Date.now();
  const allResults = {};
  
  const categoryResults = await Promise.all(
    categoriesToScrape.map(category => scrapeCategoryOffers(category))
  );
  
  categoryResults.forEach(result => {
    allResults[result.category] = result;
  });
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  
  const stats = {
    totalOffers: 0,
    totalParsed: 0,
    totalGeocoded: 0,
    successfulCategories: 0,
    failedCategories: 0,
    duration
  };
  
  Object.values(allResults).forEach(r => {
    if (r.success) {
      stats.successfulCategories++;
      stats.totalOffers += r.totalOffers;
      stats.totalParsed += r.stats?.parsed || 0;
      stats.totalGeocoded += r.stats?.geocoded || 0;
    } else {
      stats.failedCategories++;
    }
  });
  
  return { results: allResults, stats };
}

async function main() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║   HNB Scraper - Rule-Based Parser v3.0        ║');
  console.log('║   🎯 No LLM - Pure Algorithm Extraction        ║');
  console.log('╚════════════════════════════════════════════════╝\n');
  
  const args = process.argv.slice(2);
  
  if (args.includes('--no-cache')) {
    CONFIG.useCache = false;
  }
  
  const googleKeyArg = args.find(arg => arg.startsWith('--google-api-key='));
  if (googleKeyArg) {
    CONFIG.googleApiKey = googleKeyArg.split('=')[1];
    CONFIG.enableGeocoding = true;
    console.log('✓ Google Geocoding enabled\n');
  }
  
  const categoryArg = args.find(arg => arg.startsWith('--category='));
  let categoriesToScrape = CATEGORIES;
  
  if (categoryArg) {
    const categoryName = categoryArg.split('=')[1];
    categoriesToScrape = CATEGORIES.filter(c => 
      c.name.toLowerCase().includes(categoryName.toLowerCase())
    );
    
    if (categoriesToScrape.length === 0) {
      console.log(`❌ Category "${categoryName}" not found`);
      return;
    }
  }
  
  const { results: allResults, stats } = await scrapeAllCategories(categoriesToScrape);
  
  const outputDir = './output';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  console.log('\n📁 Saving structured data...');
  
  Object.entries(allResults).forEach(([categoryName, result]) => {
    if (result.success && result.offers.length > 0) {
      const filename = `${categoryName.toLowerCase().replace(/\s+/g, '_')}_structured.json`;
      fs.writeFileSync(
        path.join(outputDir, filename),
        JSON.stringify({
          category: categoryName,
          totalOffers: result.totalOffers,
          processedAt: new Date().toISOString(),
          offers: result.offers
        }, null, 2)
      );
      console.log(`  ✓ ${filename}`);
    }
  });
  
  fs.writeFileSync(
    path.join(outputDir, 'all_offers_structured.json'),
    JSON.stringify({ 
      processedAt: new Date().toISOString(), 
      stats, 
      categories: allResults 
    }, null, 2)
  );
  console.log(`  ✓ all_offers_structured.json`);
  
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║              SUMMARY REPORT                    ║');
  console.log('╚════════════════════════════════════════════════╝\n');
  
  Object.entries(allResults).forEach(([category, result]) => {
    if (result.success) {
      const geoInfo = result.stats?.geocoded > 0 ? ` (🗺️  ${result.stats.geocoded})` : '';
      console.log(`✅ ${category.padEnd(20)}: ${result.totalOffers.toString().padStart(4)} offers${geoInfo}`);
    } else {
      console.log(`❌ ${category.padEnd(20)}: Failed`);
    }
  });
  
  console.log('\n' + '─'.repeat(60));
  console.log(`Total offers            : ${stats.totalOffers}`);
  console.log(`Parsed (rule-based)     : ${stats.totalParsed}`);
  console.log(`Locations geocoded      : ${stats.totalGeocoded}`);
  console.log(`Time taken              : ${stats.duration}s ⚡`);
  console.log('─'.repeat(60));
  
  console.log('\n✨ Rule-based processing completed!');
  console.log(`\n💡 Algorithm extracts:`);
  console.log(`   ✓ Merchant name from "Merchant:" field`);
  console.log(`   ✓ Locations from "Location:" field`);
  console.log(`   ✓ Address format: "Merchant, Location, Sri Lanka"`);
  console.log(`   ✓ Dates, discounts, cards, contacts via regex`);
  console.log(`\n📋 Usage:`);
  console.log(`   --google-api-key=KEY   Enable geocoding`);
  console.log(`   --category=<name>      Specific category`);
  console.log(`   --no-cache             Fresh downloads\n`);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { scrapeCategoryOffers, scrapeAllCategories };