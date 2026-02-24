/**
 * Pan Asia Bank Card Offers Scraper - Puppeteer Version (Fixed)
 * Based on working NDB scraper pattern
 * Requires: npm install puppeteer
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
  cacheDir: './cache_pabc',
  cacheExpiry: 24 * 60 * 60 * 1000, // 24 hours
  useCache: true,
  headless: 'new',
  navigationTimeout: 60000,
  waitForContent: 5000
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
  const atMatch = description.match(/at\s+([^–\-,\.!]+)/i);
  if (atMatch) {
    return atMatch[1].trim();
  }
  
  const firstSentence = description.split(/[\.!]/)[0];
  return firstSentence.substring(0, 50).trim();
}

async function scrapePABCOffers(url, retryCount = 0) {
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
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled'
      ]
    });
    
    const page = await browser.newPage();
    
    // Block unnecessary resources for faster loading
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      // Don't block images for this site since they're part of the offer
      if (['stylesheet', 'font', 'media'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });
    
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Set user agent to avoid detection
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    
    // Remove webdriver flag
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
    });
    
    console.log('📥 Loading page...');
    
    // Try to load the page with extended timeout
    try {
      await page.goto(url, { 
        waitUntil: 'domcontentloaded', // Less strict than networkidle2
        timeout: CONFIG.navigationTimeout
      });
    } catch (navError) {
      console.log('⚠️  Initial navigation timeout, trying alternative approach...');
      await page.goto(url, { 
        waitUntil: 'load',
        timeout: CONFIG.navigationTimeout
      });
    }
    
    console.log('⏳ Waiting for content to render...');
    
    // Wait for flip cards with multiple fallback strategies
    let cardsFound = false;
    try {
      await page.waitForSelector('.flip-card', { timeout: 15000 });
      cardsFound = true;
    } catch (err) {
      console.log('⚠️  Primary selector not found, trying alternatives...');
      
      // Try alternative selectors
      try {
        await page.waitForSelector('.flip-card-inner', { timeout: 5000 });
        cardsFound = true;
      } catch (err2) {
        try {
          await page.waitForSelector('[class*="flip"]', { timeout: 5000 });
          cardsFound = true;
        } catch (err3) {
          console.log('⚠️  No cards found with selectors, proceeding anyway...');
        }
      }
    }
    
    // Additional wait for dynamic content
    await sleep(CONFIG.waitForContent);
    
    console.log('📊 Extracting offers...');
    
    // Extract all offer data
    const offers = await page.evaluate(() => {
      const flipCards = document.querySelectorAll('.flip-card');
      const results = [];
      
      flipCards.forEach((card, index) => {
        try {
          const front = card.querySelector('.flip-card-front');
          const back = card.querySelector('.flip-card-back');
          
          if (!front || !back) return;
          
          // Extract front data
          const img = front.querySelector('img');
          const imageUrl = img ? img.src : '';
          const imageAlt = img ? img.alt : '';
          const discountH2 = front.querySelector('h2');
          const discountText = discountH2 ? discountH2.textContent.trim() : '';
          const dateP = front.querySelector('p');
          const dateText = dateP ? dateP.textContent.trim() : '';
          
          // Extract back data
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
    
    // Process offers
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
        terms: terms
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

async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║  Pan Asia Bank Scraper (Puppeteer)    ║');
  console.log('║    Bypasses Sucuri WAF Protection     ║');
  console.log('╚════════════════════════════════════════╝\n');
  
  const args = process.argv.slice(2);
  
  if (args.includes('--clear-cache')) {
    clearCache();
    return;
  }
  
  if (args.includes('--no-cache')) {
    CONFIG.useCache = false;
    console.log('⚠️  Cache disabled - forcing fresh scraping\n');
  }
  
  if (args.includes('--show-browser')) {
    CONFIG.headless = false;
    console.log('👁️  Browser window will be visible\n');
  }
  
  const url = 'https://www.pabcbank.com/card-offers/';
  const startTime = Date.now();
  
  console.log(`Scraping: ${url}\n`);
  const result = await scrapePABCOffers(url);
  
  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);
  
  if (result.success && result.totalOffers > 0) {
    console.log(`\n✅ Success! Found ${result.totalOffers} offers\n`);
    
    result.offers.forEach((offer, i) => {
      console.log(`${i + 1}. ${offer.merchantName}`);
      console.log(`   Discount: ${offer.discount}`);
      console.log(`   Valid Until: ${offer.validityDate.formatted || offer.validityDate.raw}`);
      console.log(`   Description: ${offer.description.substring(0, 80)}...`);
      console.log('');
    });
    
    fs.writeFileSync('pabc_offers.json', JSON.stringify(result, null, 2));
    console.log('💾 Detailed data saved to: pabc_offers.json');
    
    const simpleData = result.offers.map(offer => ({
      merchantName: offer.merchantName,
      discount: offer.discount,
      validityDate: offer.validityDate.formatted || offer.validityDate.raw,
      description: offer.description,
      imageUrl: offer.media.imageUrl,
      terms: offer.terms
    }));
    
    fs.writeFileSync('pabc_offers_simple.json', JSON.stringify(simpleData, null, 2));
    console.log('💾 Simple data saved to: pabc_offers_simple.json');
    
    const csvHeader = 'Merchant,Discount,Validity Date,Description,Image URL\n';
    const csvRows = simpleData.map(o => 
      `"${o.merchantName}","${o.discount}","${o.validityDate}","${o.description.replace(/"/g, '""')}","${o.imageUrl}"`
    ).join('\n');
    fs.writeFileSync('pabc_offers.csv', csvHeader + csvRows);
    console.log('💾 CSV export saved to: pabc_offers.csv');
    
    console.log('\n' + '─'.repeat(50));
    console.log(`Total offers: ${result.totalOffers}`);
    console.log(`Source: ${result.fromCache ? 'Cache' : 'Fresh scrape'}`);
    console.log(`Time taken: ${duration}s`);
    console.log('─'.repeat(50));
    
    console.log('\n✨ Scraping completed!');
    console.log(`📦 Cache directory: ${CONFIG.cacheDir}`);
    console.log(`⏰ Cache expires after: ${CONFIG.cacheExpiry / (60 * 60 * 1000)} hours`);
    console.log(`💡 Tip: Cached data makes subsequent runs instant!\n`);
    
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
  clearCache
};