/**
 * Seylan Bank Card Promotions Deep Scraper
 * Crawls offer listings and extracts detailed information from each offer
 * Requires: npm install axios cheerio
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createLogger } = require('./lib/logger');
const log = createLogger('seylan');

// Configuration
const CONFIG = {
  maxRetries: 3,
  retryDelay: 1000,
  timeout: 15000,
  delayBetweenRequests: 1000,
  delayBetweenDetailPages: 800,
  cacheDir: './cache_seylan',
  cacheExpiry: 24 * 60 * 60 * 1000,
  useCache: true
};

if (!fs.existsSync(CONFIG.cacheDir)) {
  fs.mkdirSync(CONFIG.cacheDir, { recursive: true });
}

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
  console.log(`  💾 Cached: ${url}`);
}

function loadFromCache(url) {
  const cachePath = getCachePath(url);
  if (!CONFIG.useCache || !isCacheValid(cachePath)) return null;
  const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  console.log(`  ✓ Cache hit`);
  return data.html;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

async function extractOfferUrls(listingUrl) {
  console.log(`\n📋 Fetching offer listing: ${listingUrl}`);

  try {
    const { html } = await fetchHTML(listingUrl);
    const $ = cheerio.load(html);
    const urls = new Set();

    // Find all "READ MORE" links in promotion cards
    $('.new-promotion-btn').each((i, el) => {
      const href = $(el).attr('href');
      if (href && href.includes('seylan.lk')) {
        const fullUrl = href.startsWith('http') ? href : `https://www.seylan.lk${href}`;
        urls.add(fullUrl);
      }
    });

    log.info('Listing', `Found ${urls.size} unique offer URLs`, { count: urls.size, url: listingUrl });
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

    // Target the offer-detail container for precise extraction
    const detailSection = $('.offer-detail');

    if (detailSection.length === 0) {
      console.log(`    ⚠️  No offer-detail section found`);
      return null;
    }

    // Extract image from col-md-6 first child
    const imageUrl = detailSection.find('.col-md-6').first().find('img').attr('src') || '';

    // Extract from second col-md-6 (right side)
    const rightCol = detailSection.find('.col-md-6').last();

    // Extract title - h2.h11
    const title = rightCol.find('h2.h11').text().trim();

    // Extract description - first p.h44 after title
    const description = rightCol.find('p.h44').first().text().trim();

    // Extract address - div.h44 containing "Address"
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

    // Extract phone - div.h44 containing "Tel"
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

    // Extract validity - look for "Valid until" text
    let validity = '';
    rightCol.find('p, h4, div').each((i, el) => {
      const text = $(el).text().trim();
      if (text.match(/valid\s+until|valid\s+from/i)) {
        validity = text;
        return false;
      }
    });

    // Extract terms from ul > li under "Terms and Conditions"
    const terms = [];
    rightCol.find('div.des ul li').each((i, el) => {
      const term = $(el).text().trim();
      if (term && term.length > 0) {
        terms.push(term);
      }
    });

    // Extract minimum transaction value from terms
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

    // Generate deterministic unique_id — stable across re-scrapes
    // Use the offer page URL as it is the most stable identifier for Seylan offers
    const idComponents = [
      'seylan',
      (offerUrl || '').toLowerCase().trim(),
    ];
    const seylanHash = crypto.createHash('sha256').update(idComponents.join('|')).digest('hex');
    const seylanSlug = (title || 'offer')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 24);
    const unique_id = `seylan_${seylanHash.substring(0, 12)}_${seylanSlug}`;

    const offer = {
      unique_id,
      title,
      url: offerUrl,
      description,
      address,
      phone,
      validity,
      imageUrl,
      minTransaction,
      maxTransaction,
      terms,
      scrapedAt: new Date().toISOString(),
      fromCache
    };

    console.log(`    ✓ ${title.substring(0, 35)}`);
    return offer;

  } catch (error) {
    console.error(`    ❌ Error: ${error.message}`);
    return null;
  }
}

async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║  Seylan Bank Offers Deep Scraper      ║');
  console.log('║        Extract All Offer Details       ║');
  console.log('╚════════════════════════════════════════╝');

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

  // Main listing URL
  const listingUrl = args[args.indexOf('--url') + 1] ||
    'https://www.seylan.lk/promotions/cards/solar';

  console.log(`Target: ${listingUrl}\n`);

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

  // Step 3: Save results
  console.log('\n📊 SUMMARY');
  console.log('═'.repeat(50));
  console.log(`Total offers scraped: ${offers.length}`);
  console.log(`Successful: ${offers.filter(o => o).length}`);
  console.log(`Failed: ${offerUrls.length - offers.length}`);

  const result = {
    listingUrl,
    scrapedAt: new Date().toISOString(),
    totalOffers: offers.length,
    offers
  };

  fs.writeFileSync('seylan_offers_detailed.json', JSON.stringify(result, null, 2));
  console.log('\n💾 Data saved to: seylan_offers_detailed.json');

  // Create CSV export
  if (offers.length > 0) {
    const csvHeader = 'Title,Phone,Address,Validity,Min Transaction,Description\n';
    const csvRows = offers.map(o =>
      `"${o.title}","${o.phone}","${o.address}","${o.validity}","${o.minTransaction || ''}","${o.description.substring(0, 100)}"`
    ).join('\n');
    fs.writeFileSync('seylan_offers.csv', csvHeader + csvRows);
    console.log('💾 CSV export saved to: seylan_offers.csv');
  }

  console.log(`\n✨ Scraping completed!`);
  console.log(`📦 Cache: ${CONFIG.cacheDir}`);
  console.log(`⏰ Cache expires after: ${CONFIG.cacheExpiry / (60 * 60 * 1000)} hours\n`);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { extractOfferUrls, scrapeOfferDetail };