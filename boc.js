/**
 * BOC Bank Card Offers Scraper
 * Handles pagination and extracts detailed offer information
 * Requires: npm install axios cheerio
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG = {
  maxRetries: 3,
  retryDelay: 1000,
  timeout: 15000,
  delayBetweenRequests: 1000,
  delayBetweenDetailPages: 800,
  cacheDir: './cache_boc',
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
  console.log(`  💾 Cached`);
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

async function extractOfferUrlsFromPage(pageUrl) {
  console.log(`\n📋 Fetching page: ${pageUrl}`);
  
  try {
    const { html } = await fetchHTML(pageUrl);
    const $ = cheerio.load(html);
    const urls = [];

    // Find all offer cards - look for swiper-slide product links
    $('a.swiper-slide.product').each((i, el) => {
      const href = $(el).attr('href');
      if (href && href.includes('/product')) {
        const fullUrl = href.startsWith('http') ? href : `https://www.boc.lk${href}`;
        urls.push(fullUrl);
      }
    });

    console.log(`✓ Found ${urls.length} offers on this page`);
    return urls;

  } catch (error) {
    console.error(`❌ Error fetching page: ${error.message}`);
    return [];
  }
}

async function getAllOffersFromPagination(baseUrl, maxPages = 100) {
  const allUrls = [];
  let page = 0;
  let hasMorePages = true;

  while (hasMorePages && page < maxPages) {
    const pageUrl = `${baseUrl}?page=${page}`;
    const pageUrls = await extractOfferUrlsFromPage(pageUrl);

    if (pageUrls.length === 0) {
      hasMorePages = false;
      console.log(`\n✓ Pagination complete. No more offers found.`);
    } else {
      allUrls.push(...pageUrls);
      page++;
      await sleep(CONFIG.delayBetweenRequests);
    }
  }

  return allUrls;
}

async function scrapeOfferDetail(offerUrl, index, total) {
  const offerName = offerUrl.substring(offerUrl.lastIndexOf('/') + 1, offerUrl.lastIndexOf('/product'));
  console.log(`\n  [${index}/${total}] Scraping: ${offerName}`);

  try {
    const { html, fromCache } = await fetchHTML(offerUrl);
    const $ = cheerio.load(html);

    // Target the white-section container
    const section = $('.white-section').first();

    if (section.length === 0) {
      console.log(`    ⚠️  No white-section found`);
      return null;
    }

    // Extract from offer-logo-info
    const logoSection = section.find('.offer-logo-info .offer-logo');
    const title = logoSection.find('h2').text().trim();
    const imageUrl = logoSection.find('img').attr('src') || '';

    // Extract offer value (discount/offer)
    const infoSection = section.find('.offer-logo-info .offer-info');
    const offerValue = infoSection.find('.offer-value strong').text().trim();
    
    // Extract expiration date
    let expirationDate = '';
    const expireText = infoSection.find('.offer-expire strong').text().trim();
    if (expireText) {
      expirationDate = expireText;
    }

    // Extract offer details from expand-block
    const detailsSection = section.find('.offer-txt-info .expand-block');
    const description = [];

    detailsSection.find('p').each((i, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 0) {
        description.push(text);
      }
    });

    // Parse contact info (typically in first description line)
    let phone = '';
    let location = '';
    
    description.forEach(line => {
      const phoneMatch = line.match(/(\d{3}\s*\d{3}\s*\d{4}|\d{2}\s*\d{3}\s*\d{4})/g);
      if (phoneMatch && !phone) {
        phone = phoneMatch.join(' / ');
      }
    });

    // Try to extract location from description or product name
    if (title && title.length > 0) {
      // Check if there's location info in page
      const locationMatch = $('.location-name, .product-detail .location-name').first().text();
      location = locationMatch || title;
    }

    const offer = {
      title,
      url: offerUrl,
      offerValue,
      expirationDate,
      imageUrl,
      phone,
      location,
      description,
      scrapedAt: new Date().toISOString(),
      fromCache
    };

    console.log(`    ✓ ${title} - ${offerValue}`);
    return offer;

  } catch (error) {
    console.error(`    ❌ Error: ${error.message}`);
    return null;
  }
}

async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║   BOC Bank Offers Scraper with Pages   ║');
  console.log('║      Auto-paginate & Extract Details   ║');
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

  // Base URL without pagination
  const baseUrl = args[args.indexOf('--url') + 1] || 
                  'https://www.boc.lk/personal-banking/card-offers/travel-and-leisure';

  console.log(`Base URL: ${baseUrl}\n`);

  // Step 1: Crawl all pages and collect offer URLs
  console.log('📖 Crawling all pages...');
  const allOfferUrls = await getAllOffersFromPagination(baseUrl);

  if (allOfferUrls.length === 0) {
    console.log('❌ No offers found');
    return;
  }

  console.log(`\n✓ Total unique offers found across all pages: ${allOfferUrls.length}`);

  // Step 2: Scrape details from each offer
  console.log('\n📝 Scraping offer details...');
  const offers = [];
  
  for (let i = 0; i < allOfferUrls.length; i++) {
    const offer = await scrapeOfferDetail(allOfferUrls[i], i + 1, allOfferUrls.length);
    if (offer) {
      offers.push(offer);
    }
    
    if (i < allOfferUrls.length - 1) {
      await sleep(CONFIG.delayBetweenDetailPages);
    }
  }

  // Step 3: Save results
  console.log('\n📊 SUMMARY');
  console.log('═'.repeat(50));
  console.log(`Total offers scraped: ${offers.length}`);
  console.log(`Successful: ${offers.filter(o => o).length}`);
  console.log(`Failed: ${allOfferUrls.length - offers.length}`);

  const result = {
    baseUrl,
    scrapedAt: new Date().toISOString(),
    totalPages: Math.ceil(allOfferUrls.length / 12), // Approx 12 per page
    totalOffers: offers.length,
    offers
  };

  fs.writeFileSync('boc_offers_detailed.json', JSON.stringify(result, null, 2));
  console.log('\n💾 Data saved to: boc_offers_detailed.json');

  // Create CSV export
  if (offers.length > 0) {
    const csvHeader = 'Title,Offer,Expiration,Phone,Location,Description\n';
    const csvRows = offers.map(o => 
      `"${o.title}","${o.offerValue}","${o.expirationDate}","${o.phone}","${o.location}","${o.description[0] || ''}"`
    ).join('\n');
    fs.writeFileSync('boc_offers.csv', csvHeader + csvRows);
    console.log('💾 CSV export saved to: boc_offers.csv');
  }

  console.log(`\n✨ Scraping completed!`);
  console.log(`📦 Cache: ${CONFIG.cacheDir}`);
  console.log(`⏰ Cache expires after: ${CONFIG.cacheExpiry / (60 * 60 * 1000)} hours\n`);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { getAllOffersFromPagination, scrapeOfferDetail };