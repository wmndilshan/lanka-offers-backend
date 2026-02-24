/**
 * DFCC Bank Promotions Scraper - Updated for New Website Structure (2026)
 * Requires: npm install puppeteer pdf-parse
 * 
 * New structure uses card-based layout with Next.js
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { createLogger } = require('./lib/logger');
const log = createLogger('dfcc');

/**
 * Generate deterministic unique ID from stable fields
 * Format: dfcc_{sha256(bank|detailUrl|cardType)[0:12]}_{urlSlug}
 */
function generateUniqueId(detailUrl, cardType) {
  const bank = 'DFCC Bank';

  // Extract slug from detail URL
  const urlParts = detailUrl.split('/');
  const slug = urlParts[urlParts.length - 1] || 'unknown';

  // Create hash from stable fields
  const hashInput = `${bank}|${detailUrl}|${cardType}`.toLowerCase();
  const hash = crypto.createHash('sha256').update(hashInput).digest('hex');
  const shortHash = hash.substring(0, 12);

  // Create slug (max 30 chars, alphanumeric + hyphens)
  const cleanSlug = slug
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 30);

  return `dfcc_${shortHash}_${cleanSlug}`;
}

// Try to load pdf-parse, but continue if not available
let pdfParse;
let pdfParseAvailable = false;

try {
  const pdfParseModule = require('pdf-parse');

  const moduleType = typeof pdfParseModule;
  const hasDefault = pdfParseModule && typeof pdfParseModule.default === 'function';
  const hasPDFParse = pdfParseModule && pdfParseModule.PDFParse;

  if (moduleType === 'function') {
    pdfParse = pdfParseModule;
    pdfParseAvailable = true;
  } else if (hasDefault) {
    pdfParse = pdfParseModule.default;
    pdfParseAvailable = true;
  } else if (hasPDFParse && typeof hasPDFParse === 'function') {
    pdfParse = pdfParseModule.PDFParse;
    pdfParseAvailable = true;
  } else if (hasPDFParse) {
    pdfParse = pdfParseModule.PDFParse;
    pdfParseAvailable = true;
  }

  if (pdfParseAvailable) {
    console.log('✅ pdf-parse module loaded successfully');
  } else {
    console.log('⚠️  Incompatible pdf-parse package detected');
    console.log('   Please reinstall: npm uninstall pdf-parse && npm install pdf-parse@1.1.1');
  }
} catch (err) {
  console.log('⚠️  pdf-parse not installed. PDF extraction will be skipped.');
  console.log('   Install with: npm install pdf-parse@1.1.1');
}

// Configuration
const CONFIG = {
  maxRetries: 3,
  retryDelay: 3000,
  timeout: 60000,
  delayBetweenRequests: 3000,
  delayBetweenDetailPages: 2000,
  cacheDir: './cache_dfcc',
  pdfCacheDir: './cache_dfcc/pdfs',
  cacheExpiry: 24 * 60 * 60 * 1000, // 24 hours
  useCache: true,
  extractPdfContent: true,
  fetchDetailPages: true,
  headless: 'new',
  navigationTimeout: 60000,
  waitForContent: 3000
};

// Create cache directories
if (!fs.existsSync(CONFIG.cacheDir)) {
  fs.mkdirSync(CONFIG.cacheDir, { recursive: true });
}
if (!fs.existsSync(CONFIG.pdfCacheDir)) {
  fs.mkdirSync(CONFIG.pdfCacheDir, { recursive: true });
}

function getCacheKey(url) {
  return crypto.createHash('md5').update(url).digest('hex');
}

function getCachePath(url) {
  const key = getCacheKey(url);
  return path.join(CONFIG.cacheDir, `${key}.json`);
}

function getPdfCachePath(url) {
  const key = getCacheKey(url);
  return path.join(CONFIG.pdfCacheDir, `${key}.json`);
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
      if (file.endsWith('.json')) {
        fs.unlinkSync(path.join(CONFIG.cacheDir, file));
      }
    });
    console.log(`🗑️  Cleared ${files.length} cached files`);
  }

  if (fs.existsSync(CONFIG.pdfCacheDir)) {
    const pdfFiles = fs.readdirSync(CONFIG.pdfCacheDir);
    pdfFiles.forEach(file => {
      fs.unlinkSync(path.join(CONFIG.pdfCacheDir, file));
    });
    console.log(`🗑️  Cleared ${pdfFiles.length} cached PDF files`);
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Download PDF file from URL
 */
async function downloadPdf(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    protocol.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        downloadPdf(response.headers.location).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${url}`));
        return;
      }

      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Extract text content from PDF buffer
 */
async function extractPdfText(pdfBuffer) {
  if (!pdfParseAvailable || !pdfParse) {
    return { success: false, error: 'pdf-parse not available' };
  }

  try {
    const data = await pdfParse(pdfBuffer);

    return {
      success: true,
      text: data.text,
      pages: data.numpages,
      info: data.info
    };
  } catch (err) {
    console.error('    ❌ PDF extraction error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Process PDF terms & conditions
 */
async function processPdfTerms(pdfUrl) {
  if (!pdfUrl || !CONFIG.extractPdfContent) {
    return null;
  }

  try {
    // Check cache first
    const cachePath = getPdfCachePath(pdfUrl);
    if (isCacheValid(cachePath)) {
      const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      console.log(`    💾 PDF cache hit: ${path.basename(pdfUrl)}`);
      return cacheData.data;
    }

    console.log(`    📄 Downloading PDF: ${path.basename(pdfUrl)}`);

    // Download PDF
    const pdfBuffer = await downloadPdf(pdfUrl);

    // Extract text content
    console.log(`    🔍 Extracting text from PDF...`);
    const extraction = await extractPdfText(pdfBuffer);

    const result = {
      url: pdfUrl,
      extracted: extraction.success,
      pages: extraction.pages || 0,
      content: extraction.text || null,
      error: extraction.error || null
    };

    // Cache the result
    const cacheData = {
      url: pdfUrl,
      cachedAt: new Date().toISOString(),
      data: result
    };
    fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2));

    if (extraction.success) {
      console.log(`    ✅ Extracted ${extraction.pages} pages from PDF`);
    } else {
      console.log(`    ⚠️  Could not extract PDF: ${extraction.error}`);
    }

    return result;

  } catch (err) {
    console.error(`    ❌ Error processing PDF: ${err.message}`);
    return {
      url: pdfUrl,
      extracted: false,
      error: err.message
    };
  }
}

/**
 * Scrape detail page for complete information
 */
async function scrapePromotionDetails(browser, detailUrl) {
  try {
    const page = await browser.newPage();

    await page.setViewport({ width: 1920, height: 1080 });

    console.log(`    📄 Fetching details: ${detailUrl}`);
    await page.goto(detailUrl, {
      waitUntil: 'networkidle2',
      timeout: CONFIG.navigationTimeout
    });

    await sleep(2000);

    const details = await page.evaluate(() => {
      const result = {
        title: '',
        description: '',
        image: '',
        termsAndConditions: []
      };

      // Extract title
      const titleEl = document.querySelector('.pageMainBlock-main-title-1');
      if (titleEl) result.title = titleEl.textContent.trim();

      // Extract description
      const descEl = document.querySelector('.pageMainBlock-description p');
      if (descEl) result.description = descEl.textContent.trim();

      // Extract main image
      const imgEl = document.querySelector('.pageMainBlock-image-block img');
      if (imgEl) result.image = imgEl.src;

      // Try to find terms and conditions or details
      const contentBlocks = document.querySelectorAll('p, li, div[class*="content"]');
      const terms = [];
      contentBlocks.forEach(block => {
        const text = block.textContent.trim();
        if (text && text.length > 10 && text.length < 500) {
          // Filter out navigation and header text
          if (!text.includes('DFCC Bank') && !text.includes('Contact Us')) {
            terms.push(text);
          }
        }
      });

      result.termsAndConditions = [...new Set(terms)].slice(0, 20); // Remove duplicates, limit to 20

      return result;
    });

    await page.close();
    return details;

  } catch (error) {
    console.error(`    ❌ Error scraping details: ${error.message}`);
    return null;
  }
}

async function scrapeDFCCPromotions(url, categoryName = '', retryCount = 0) {
  // Check cache first
  const cachedData = loadFromCache(url);
  if (cachedData) {
    return { ...cachedData, fromCache: true };
  }

  let browser;

  try {
    log.info('Scraper', `Launching browser for: ${url}`);
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

    await page.setViewport({ width: 1920, height: 1080 });

    console.log('📥 Loading page...');
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: CONFIG.navigationTimeout
    });

    console.log('⏳ Waiting for content to render...');

    // Wait for the new card-based structure - cardd is on <a> tags
    await page.waitForSelector('a.cardd', { timeout: 15000 });

    // Additional wait for dynamic content
    await sleep(CONFIG.waitForContent);

    console.log('📊 Extracting promotions...');

    // Extract all promotion data from listing page
    const promotions = await page.evaluate(() => {
      const cards = document.querySelectorAll('a.cardd');
      const results = [];

      cards.forEach((card, index) => {
        try {
          // Extract detail page URL (card itself is the link)
          const detailUrl = card.getAttribute('href') || '';

          // Extract card type tag
          const tagEl = card.querySelector('.tag');
          const cardType = tagEl ? tagEl.textContent.trim() : '';

          // Extract image
          const imgEl = card.querySelector('.offerMainImage, img');
          const imageUrl = imgEl ? imgEl.src : '';
          const imageAlt = imgEl ? imgEl.alt : '';

          // Extract offer text
          const offerTextEl = card.querySelector('.cardOfferText');
          const offerText = offerTextEl ? offerTextEl.textContent.trim() : '';

          results.push({
            id: index + 1, // Legacy sequential ID (kept for backward compatibility)
            cardType,
            offerText,
            imageUrl,
            imageAlt,
            detailUrl: detailUrl.startsWith('http') ? detailUrl : `https://www.dfcc.lk${detailUrl}`
          });

        } catch (err) {
          console.error('Error parsing card:', err);
        }
      });

      return results;
    });

    log.info('Parser', `Found ${promotions.length} promotions on listing page`, { count: promotions.length, url });

    // Process each promotion
    const processedPromotions = [];

    for (let i = 0; i < promotions.length; i++) {
      const promo = promotions[i];

      console.log(`\n  Processing promotion ${i + 1}/${promotions.length}`);

      // Generate deterministic unique ID
      const uniqueId = generateUniqueId(promo.detailUrl, promo.cardType);

      // Fetch detail page if enabled
      let detailData = null;

      if (CONFIG.fetchDetailPages && promo.detailUrl) {
        detailData = await scrapePromotionDetails(browser, promo.detailUrl);
        await sleep(CONFIG.delayBetweenDetailPages);
      }

      processedPromotions.push({
        id: promo.id, // Legacy sequential ID
        unique_id: uniqueId, // ✅ Deterministic hash-based ID
        category: categoryName,
        title: detailData?.title || promo.imageAlt || promo.offerText.substring(0, 50),
        offerDescription: promo.offerText,
        fullDescription: detailData?.description || promo.offerText,
        cardType: promo.cardType,
        termsAndConditions: detailData?.termsAndConditions || [],
        images: {
          listing: promo.imageUrl,
          detail: detailData?.image || promo.imageUrl
        },
        detailUrl: promo.detailUrl
      });
    }

    await browser.close();

    const result = {
      success: true,
      timestamp: new Date().toISOString(),
      sourceUrl: url,
      totalPromotions: processedPromotions.length,
      promotions: processedPromotions,
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
      return scrapeDFCCPromotions(url, categoryName, retryCount + 1);
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
    // Try new URL structure first, then fall back to old
    {
      name: 'Dining', urls: [
        'https://www.dfcc.lk/cards/cards-promotions/category/dining',
        'https://www.dfcc.lk/dining-promotion'
      ]
    },
    {
      name: 'Supermarket', urls: [
        'https://www.dfcc.lk/cards/cards-promotions/category/supermarket',
        'https://www.dfcc.lk/supermarkets-credit'
      ]
    },
    {
      name: 'Online', urls: [
        'https://www.dfcc.lk/cards/cards-promotions/category/online',
        'https://www.dfcc.lk/online-promotion'
      ]
    },
    {
      name: 'Clothing & Retail', urls: [
        'https://www.dfcc.lk/cards/cards-promotions/category/clothing-retail',
        'https://www.dfcc.lk/clothing-and-retail-credit'
      ]
    },
    {
      name: 'Utility', urls: [
        'https://www.dfcc.lk/cards/cards-promotions/category/utility',
        'https://www.dfcc.lk/utility-promotion'
      ]
    },
    {
      name: 'Travel', urls: [
        'https://www.dfcc.lk/cards/cards-promotions/category/travel',
        'https://www.dfcc.lk/travel-promotion'
      ]
    },
    {
      name: 'Hotels', urls: [
        'https://www.dfcc.lk/cards/cards-promotions/category/hotels',
        'https://www.dfcc.lk/hotels'
      ]
    },
    {
      name: 'Pinnacle', urls: [
        'https://www.dfcc.lk/cards/cards-promotions/category/pinnacle',
        'https://www.dfcc.lk/pinnacle-2'
      ]
    }
  ];

  const allResults = {};
  let cachedCount = 0;
  let freshCount = 0;

  for (const category of categories) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Scraping ${category.name}...`);
    console.log('='.repeat(60));

    let result = null;
    let successUrl = null;

    // Try each URL until one works
    for (const url of category.urls) {
      console.log(`Trying URL: ${url}`);
      result = await scrapeDFCCPromotions(url, category.name);

      if (result.success && result.totalPromotions > 0) {
        successUrl = url;
        break;
      } else if (result.success && result.totalPromotions === 0) {
        console.log(`   No promotions found at ${url}, trying next URL...`);
      } else {
        console.log(`   Failed at ${url}, trying next URL...`);
      }
    }

    if (result && result.success) {
      console.log(`✅ Success: Found ${result.totalPromotions} promotions in ${category.name} (from ${successUrl})`);
      allResults[category.name] = result;

      if (result.fromCache) cachedCount++;
      else freshCount++;
    } else {
      console.log(`❌ Failed: ${category.name} (all URLs failed)`);
      allResults[category.name] = result || {
        success: false,
        error: 'All URLs failed',
        timestamp: new Date().toISOString()
      };
    }

    // Only delay if making fresh requests
    if (result && !result.fromCache && freshCount < categories.length) {
      console.log(`⏳ Waiting ${CONFIG.delayBetweenRequests}ms before next category...`);
      await sleep(CONFIG.delayBetweenRequests);
    }
  }

  return { results: allResults, stats: { cachedCount, freshCount } };
}

async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║   DFCC Bank Promotions Scraper v3.0    ║');
  console.log('║     NEW NEXT.JS STRUCTURE 2026         ║');
  console.log('╚════════════════════════════════════════╝\n');

  const args = process.argv.slice(2);

  if (args.includes('--clear-cache')) {
    clearCache();
    return;
  }

  if (args.includes('--no-cache')) {
    CONFIG.useCache = false;
    console.log('⚠️  Cache disabled\n');
  }

  if (args.includes('--no-pdf')) {
    CONFIG.extractPdfContent = false;
    console.log('⚠️  PDF extraction disabled\n');
  }

  if (args.includes('--no-details')) {
    CONFIG.fetchDetailPages = false;
    console.log('⚠️  Detail page fetching disabled\n');
  }

  const scrapeSingle = args.includes('--single');

  if (scrapeSingle) {
    const url = args[args.indexOf('--single') + 1] ||
      'https://www.dfcc.lk/cards/cards-promotions/category/dining';
    const result = await scrapeDFCCPromotions(url, 'Single');

    if (result.success && result.totalPromotions > 0) {
      console.log(`\n✅ Success! Found ${result.totalPromotions} promotions\n`);

      result.promotions.forEach((promo, i) => {
        console.log(`${i + 1}. ${promo.title}`);
        console.log(`   Offer: ${promo.offerDescription.substring(0, 60)}...`);
        console.log(`   Card Type: ${promo.cardType}`);
        console.log('');
      });

      fs.writeFileSync('dfcc_promotions.json', JSON.stringify(result, null, 2));
      console.log('💾 Data saved to: dfcc_promotions.json');

    } else if (result.success && result.totalPromotions === 0) {
      console.log('⚠️  No promotions found');
    } else {
      console.log('❌ Error:', result.error);
    }

  } else {
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
        console.log(`✅ ${cacheIndicator} ${category.padEnd(25)}: ${result.totalPromotions} promotions`);
        totalCount += result.totalPromotions;
        successCount++;
      } else {
        console.log(`❌ ${category.padEnd(28)}: Failed`);
        failCount++;
      }
    });

    console.log('\n' + '─'.repeat(50));
    console.log(`Total promotions scraped: ${totalCount}`);
    console.log(`Successful categories: ${successCount}`);
    console.log(`Failed categories: ${failCount}`);
    console.log(`From cache: ${stats.cachedCount} | Fresh scrapes: ${stats.freshCount}`);
    console.log(`Time taken: ${duration}s`);
    console.log('─'.repeat(50));

    // Save results
    fs.writeFileSync('dfcc_all_promotions.json', JSON.stringify(allResults, null, 2));
    console.log('\n💾 Complete data saved to: dfcc_all_promotions.json');

    // Create simple version
    const simpleData = [];
    Object.entries(allResults).forEach(([category, result]) => {
      if (result.success && result.promotions) {
        result.promotions.forEach(promo => {
          simpleData.push({
            category: category,
            title: promo.title,
            offer: promo.offerDescription,
            fullDescription: promo.fullDescription,
            cardType: promo.cardType,
            detailUrl: promo.detailUrl,
            hasTerms: promo.termsAndConditions.length > 0
          });
        });
      }
    });

    fs.writeFileSync('dfcc_promotions_simple.json', JSON.stringify(simpleData, null, 2));
    console.log('💾 Simple data saved to: dfcc_promotions_simple.json');

    // Create CSV
    if (simpleData.length > 0) {
      const csvHeader = 'Category,Title,Offer,Card Type,Detail URL\n';
      const csvRows = simpleData.map(p =>
        `"${p.category}","${p.title}","${p.offer}","${p.cardType}","${p.detailUrl}"`
      ).join('\n');
      fs.writeFileSync('dfcc_promotions.csv', csvHeader + csvRows);
      console.log('💾 CSV export saved to: dfcc_promotions.csv');
    }

    console.log('\n✨ Scraping completed!');
    console.log(`📦 Cache directory: ${CONFIG.cacheDir}`);
    console.log(`⏰ Cache expires after: ${CONFIG.cacheExpiry / (60 * 60 * 1000)} hours\n`);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  scrapeDFCCPromotions,
  scrapeMultipleCategories,
  clearCache,
  processPdfTerms
};