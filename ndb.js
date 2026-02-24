/**
 * NDB Bank Card Offers Scraper - Enhanced with Smart Caching
 * Requires: npm install puppeteer
 * 
 * NOTE: For dynamic JS sites, we cache the EXTRACTED DATA, not HTML
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configuration
const CONFIG = {
  maxRetries: 3,
  retryDelay: 3000,
  timeout: 60000,
  delayBetweenRequests: 3000,
  cacheDir: './cache_ndb_bank',
  cacheExpiry: 24 * 60 * 60 * 1000, // 24 hours
  useCache: true,
  headless: 'new', // Use new headless mode (faster)
  navigationTimeout: 60000,
  waitForContent: 5000 // Wait time for JS to render
};

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
  console.log(`📦 Cached: ${url}`);
}

function loadFromCache(url) {
  const cachePath = getCachePath(url);
  
  if (!CONFIG.useCache) return null;
  
  if (isCacheValid(cachePath)) {
    const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    console.log(`💾 Cache hit: ${url} (cached at ${cacheData.cachedAt})`);
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

function parseOfferText(text) {
  const result = {
    discount: null,
    minimumBill: null,
    maximumDiscount: null,
    restrictions: [],
    terms: []
  };
  
  if (!text) return result;
  
  // Extract discount
  const discountMatch = text.match(/(\d+)%\s*(?:Savings|Off|Discount)/i);
  if (discountMatch) result.discount = discountMatch[1] + '%';
  
  // Extract minimum bill
  const minMatch = text.match(/Minimum\s+bill\s+value\s+is\s+Rs\.?\s*([\d,]+)/i);
  if (minMatch) result.minimumBill = parseInt(minMatch[1].replace(/,/g, ''));
  
  // Extract maximum discount
  const maxMatch = text.match(/Maximum\s+discount\s+is\s+Rs\.?\s*([\d,]+)/i);
  if (maxMatch) result.maximumDiscount = parseInt(maxMatch[1].replace(/,/g, ''));
  
  // Extract restrictions
  const restrictMatch = text.match(/not\s+valid\s+on\s+([^.]+)/i);
  if (restrictMatch) result.restrictions.push(restrictMatch[1].trim());
  
  // Extract terms
  const terms = text.split(/\s{2,}/).filter(t => t.trim().length > 0);
  result.terms = terms;
  
  return result;
}

function parseValidityText(text) {
  const result = {
    endDate: null,
    cardTypes: []
  };
  
  if (!text) return result;
  
  // Extract date
  const dateMatch = text.match(/(\d+(?:st|nd|rd|th)?\s+\w+\s+\d{4})/i);
  if (dateMatch) result.endDate = dateMatch[1];
  
  // Extract card types
  if (text.includes('Credit Cards')) result.cardTypes.push('Credit Cards');
  if (text.includes('Debit Cards')) result.cardTypes.push('Debit Cards');
  
  return result;
}

async function scrapeNDBCardOffers(url, retryCount = 0) {
  // Check cache first
  const cachedData = loadFromCache(url);
  if (cachedData) {
    return {
      ...cachedData,
      fromCache: true
    };
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
        '--disable-gpu'
      ]
    });
    
    const page = await browser.newPage();
    
    // Block unnecessary resources for faster loading
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });
    
    await page.setViewport({ width: 1920, height: 1080 });
    
    console.log('📥 Loading page...');
    await page.goto(url, { 
      waitUntil: 'networkidle2',
      timeout: CONFIG.navigationTimeout
    });
    
    console.log('⏳ Waiting for content to render...');
    try {
      await page.waitForSelector('.ant-col.DesktopBlock_col__2q7cK', { 
        timeout: 15000 
      });
    } catch (err) {
      console.log('⚠️  Primary selector not found, trying alternative...');
      await page.waitForSelector('.ant-card', { timeout: 10000 });
    }
    
    // Additional wait for dynamic content
    await sleep(CONFIG.waitForContent);
    
    console.log('📊 Extracting offers...');
    
    // Extract all offer data
    const offers = await page.evaluate(() => {
      const cardContainers = document.querySelectorAll('.ant-col.DesktopBlock_col__2q7cK');
      const results = [];
      
      cardContainers.forEach((container, index) => {
        try {
          const card = container.querySelector('.ant-card');
          if (!card) return;
          
          // Extract cover image
          const coverImg = card.querySelector('.ant-card-cover img.PromotionMobile_cover__2YUwz');
          const imageUrl = coverImg ? coverImg.src : '';
          const imageAlt = coverImg ? coverImg.alt : '';
          
          // Extract merchant logo
          const merchantLogo = card.querySelector('.PromotionMobile_avatar__11ePi img');
          const logoUrl = merchantLogo ? merchantLogo.src : '';
          
          // Extract merchant name
          const merchantNameEl = card.querySelector('.ant-card-meta-title');
          const merchantName = merchantNameEl ? merchantNameEl.textContent.trim() : '';
          
          // Extract website
          const websiteLink = card.querySelector('.PromotionMobile_website__5kRF6');
          const website = websiteLink ? websiteLink.href : '';
          
          // Extract offer details
          const detailsEl = card.querySelector('.PromotionMobile_details__z7myj h5.ant-typography');
          const offerDetails = detailsEl ? detailsEl.textContent.trim() : '';
          
          // Extract validity
          const validityEl = card.querySelector('.PromotionMobile_validity__39zdc span.ant-typography');
          const validity = validityEl ? validityEl.textContent.trim() : '';
          
          // Extract phone numbers
          const phoneItems = card.querySelectorAll('.PromotionMobile_phone__3t2ws li');
          const phones = [];
          phoneItems.forEach(li => {
            const phone = li.textContent.trim();
            if (phone) phones.push(phone);
          });
          
          // Extract location
          const locationEl = card.querySelector('.PromotionMobile_merchantDescription__1BkVS > span.ant-typography');
          const location = locationEl ? locationEl.textContent.trim() : '';
          
          results.push({
            id: index + 1,
            merchantName: merchantName,
            website: website,
            location: location,
            phoneNumbers: phones,
            offerDetails: offerDetails,
            validity: validity,
            coverImage: imageUrl,
            merchantLogo: logoUrl,
            imageAlt: imageAlt
          });
          
        } catch (err) {
          console.error('Error parsing card:', err);
        }
      });
      
      return results;
    });
    
    await browser.close();
    console.log(`✅ Found ${offers.length} offers`);
    
    // Process offers
    const processedOffers = offers.map(offer => {
      const parsed = parseOfferText(offer.offerDetails);
      const validityParsed = parseValidityText(offer.validity);
      
      return {
        id: offer.id,
        merchant: {
          name: offer.merchantName,
          website: offer.website,
          location: offer.location,
          phoneNumbers: offer.phoneNumbers,
          logo: offer.merchantLogo
        },
        offer: {
          description: offer.offerDetails,
          discount: parsed.discount,
          minimumBill: parsed.minimumBill,
          maximumDiscount: parsed.maximumDiscount,
          restrictions: parsed.restrictions,
          terms: parsed.terms
        },
        validity: {
          raw: offer.validity,
          endDate: validityParsed.endDate,
          cardTypes: validityParsed.cardTypes
        },
        images: {
          cover: offer.coverImage,
          logo: offer.merchantLogo
        }
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
    
    // Save to cache
    saveToCache(url, result);
    
    return result;
    
  } catch (error) {
    if (browser) await browser.close();
    
    console.error(`❌ Error scraping ${url}: ${error.message}`);
    
    // Retry logic
    if (retryCount < CONFIG.maxRetries) {
      const delay = CONFIG.retryDelay * (retryCount + 1);
      console.log(`🔄 Retrying in ${delay}ms... (Attempt ${retryCount + 1}/${CONFIG.maxRetries})`);
      await sleep(delay);
      return scrapeNDBCardOffers(url, retryCount + 1);
    }
    
    return {
      success: false,
      error: error.message,
      errorCode: error.code,
      timestamp: new Date().toISOString()
    };
  }
}

async function scrapeMultipleCategories() {
  const categories = [
    { name: 'Privilege Weekend', url: 'https://www.ndbbank.com/cards/card-offers/Privilege%20Weekend' },
    { name: 'Clothing & Accessories', url: 'https://www.ndbbank.com/cards/card-offers/clothing-accessories' },
    { name: 'Restaurants & Pubs', url: 'https://www.ndbbank.com/cards/card-offers/restaurants-pubs' },
    { name: 'Special Promotions', url: 'https://www.ndbbank.com/cards/card-offers/special-ipp-promotions' },
    { name: 'Supermarkets', url: 'https://www.ndbbank.com/cards/card-offers/supermarkets' },
    { name: 'Jewellery & Watches', url: 'https://www.ndbbank.com/cards/card-offers/jewellery-watches' },
    // { name: 'Fashion & Lifestyle', url: 'https://www.ndbbank.com/cards/card-offers/fashion-lifestyle' },
    // { name: 'Hotels & Travels', url: 'https://www.ndbbank.com/cards/card-offers/hotels-travels' },
    // { name: 'Online Shopping', url: 'https://www.ndbbank.com/cards/card-offers/online-shopping' },
    // { name: 'Electronics', url: 'https://www.ndbbank.com/cards/card-offers/electronics' },
    // { name: 'Healthcare', url: 'https://www.ndbbank.com/cards/card-offers/healthcare' },
    // { name: 'Entertainment', url: 'https://www.ndbbank.com/cards/card-offers/entertainment' },
    // { name: 'Salons & Spas', url: 'https://www.ndbbank.com/cards/card-offers/salons-spas' },
    // { name: 'Education', url: 'https://www.ndbbank.com/cards/card-offers/education' }
  ];
  
  const allResults = {};
  let cachedCount = 0;
  let freshCount = 0;
  
  for (const category of categories) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Scraping ${category.name}...`);
    console.log('='.repeat(50));
    
    const result = await scrapeNDBCardOffers(category.url);
    
    if (result.success) {
      console.log(`✅ Success: Found ${result.totalOffers} offers in ${category.name}`);
      allResults[category.name] = result;
      
      if (result.fromCache) cachedCount++;
      else freshCount++;
    } else {
      console.log(`❌ Failed: ${category.name}`);
      console.log(`   Error: ${result.error}`);
      console.log(`   Code: ${result.errorCode || 'N/A'}`);
      allResults[category.name] = result;
    }
    
    // Only delay if making fresh requests
    if (!result.fromCache && freshCount < categories.length) {
      console.log(`⏳ Waiting ${CONFIG.delayBetweenRequests}ms before next request...`);
      await sleep(CONFIG.delayBetweenRequests);
    }
  }
  
  return { results: allResults, stats: { cachedCount, freshCount } };
}

async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║   NDB Bank Card Offers Scraper v2.0    ║');
  console.log('║    WITH SMART DATA CACHING             ║');
  console.log('╚════════════════════════════════════════╝\n');
  
  // Handle command-line arguments
  const args = process.argv.slice(2);
  
  if (args.includes('--clear-cache')) {
    clearCache();
    return;
  }
  
  if (args.includes('--no-cache')) {
    CONFIG.useCache = false;
    console.log('⚠️  Cache disabled - forcing fresh scraping\n');
  }
  
  const scrapeSingle = args.includes('--single');
  
  if (scrapeSingle) {
    // Scrape single category
    const url = args[args.indexOf('--single') + 1] || 
                'https://www.ndbbank.com/cards/card-offers/restaurants-pubs';
    const result = await scrapeNDBCardOffers(url);
    
    if (result.success && result.totalOffers > 0) {
      console.log(`\n✅ Success! Found ${result.totalOffers} offers\n`);
      
      result.offers.forEach((offer, i) => {
        console.log(`${i + 1}. ${offer.merchant.name}`);
        console.log(`   Discount: ${offer.offer.discount || 'N/A'}`);
        console.log(`   Valid until: ${offer.validity.endDate || 'N/A'}`);
        console.log(`   Phone: ${offer.merchant.phoneNumbers.join(', ') || 'N/A'}`);
        console.log('');
      });
      
      fs.writeFileSync('ndb_offers.json', JSON.stringify(result, null, 2));
      console.log('💾 Data saved to: ndb_offers.json');
      
    } else if (result.success && result.totalOffers === 0) {
      console.log('⚠️  No offers found');
    } else {
      console.log('❌ Error:', result.error);
    }
    
  } else {
    // Scrape all categories
    console.log('Scraping all categories...\n');
    const startTime = Date.now();
    const { results: allResults, stats } = await scrapeMultipleCategories();
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    // Summary
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║            SUMMARY REPORT              ║');
    console.log('╚════════════════════════════════════════╝\n');
    
    let totalCount = 0;
    let successCount = 0;
    let failCount = 0;
    
    Object.entries(allResults).forEach(([category, result]) => {
      if (result.success) {
        const cacheIndicator = result.fromCache ? '💾' : '🌐';
        console.log(`✅ ${cacheIndicator} ${category.padEnd(25)}: ${result.totalOffers} offers`);
        totalCount += result.totalOffers;
        successCount++;
      } else {
        console.log(`❌ ${category.padEnd(28)}: Failed (${result.errorCode || result.error})`);
        failCount++;
      }
    });
    
    console.log('\n' + '─'.repeat(50));
    console.log(`Total offers scraped: ${totalCount}`);
    console.log(`Successful categories: ${successCount}`);
    console.log(`Failed categories: ${failCount}`);
    console.log(`From cache: ${stats.cachedCount} | Fresh scrapes: ${stats.freshCount}`);
    console.log(`Time taken: ${duration}s`);
    console.log('─'.repeat(50));
    
    // Save complete results
    fs.writeFileSync('ndb_all_offers.json', JSON.stringify(allResults, null, 2));
    console.log('\n💾 Complete data saved to: ndb_all_offers.json');
    
    // Create flattened simple version
    const simpleData = [];
    Object.entries(allResults).forEach(([category, result]) => {
      if (result.success && result.offers) {
        result.offers.forEach(offer => {
          simpleData.push({
            category: category,
            merchant: offer.merchant.name,
            discount: offer.offer.discount,
            minBill: offer.offer.minimumBill,
            maxDiscount: offer.offer.maximumDiscount,
            validUntil: offer.validity.endDate,
            cardTypes: offer.validity.cardTypes.join(', '),
            phone: offer.merchant.phoneNumbers.join(', '),
            location: offer.merchant.location,
            website: offer.merchant.website
          });
        });
      }
    });
    
    fs.writeFileSync('ndb_offers_simple.json', JSON.stringify(simpleData, null, 2));
    console.log('💾 Simple data saved to: ndb_offers_simple.json');
    
    // Create CSV export
    if (simpleData.length > 0) {
      const csvHeader = 'Category,Merchant,Discount,Min Bill,Max Discount,Valid Until,Card Types,Phone,Location,Website\n';
      const csvRows = simpleData.map(o => 
        `"${o.category}","${o.merchant}","${o.discount || ''}","${o.minBill || ''}","${o.maxDiscount || ''}","${o.validUntil || ''}","${o.cardTypes}","${o.phone}","${o.location}","${o.website}"`
      ).join('\n');
      fs.writeFileSync('ndb_offers.csv', csvHeader + csvRows);
      console.log('💾 CSV export saved to: ndb_offers.csv');
    }
    
    console.log('\n✨ Scraping completed!');
    console.log(`📦 Cache directory: ${CONFIG.cacheDir}`);
    console.log(`⏰ Cache expires after: ${CONFIG.cacheExpiry / (60 * 60 * 1000)} hours`);
    console.log(`💡 Tip: Cached data makes subsequent runs 10-20x faster!\n`);
  }
}

// Run
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  scrapeNDBCardOffers,
  scrapeMultipleCategories,
  clearCache
};