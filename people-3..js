/**
 * People's Bank Offers Scraper - Updated for New Website Structure
 * Requires: npm install axios cheerio
 * Optional: npm install pdf-parse@1.1.1 (for PDF terms extraction)
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { createLogger } = require('./lib/logger');
const log = createLogger('peoples');

// Try to load pdf-parse, but continue if not available
let pdfParse;
let pdfParseAvailable = false;

try {
    const pdfParseModule = require('pdf-parse');

    // Debug: Check what we actually got
    const moduleType = typeof pdfParseModule;
    const hasDefault = pdfParseModule && typeof pdfParseModule.default === 'function';
    const hasPDFParse = pdfParseModule && pdfParseModule.PDFParse;

    // Handle different module export patterns
    if (moduleType === 'function') {
        // Standard pdf-parse: exports a function directly
        pdfParse = pdfParseModule;
        pdfParseAvailable = true;
    } else if (hasDefault) {
        // ES module with default export
        pdfParse = pdfParseModule.default;
        pdfParseAvailable = true;
    } else if (hasPDFParse && typeof hasPDFParse === 'function') {
        // Fork or variant with PDFParse export
        pdfParse = pdfParseModule.PDFParse;
        pdfParseAvailable = true;
    } else if (hasPDFParse) {
        // PDFParse exists but might be a class or object
        console.log('   Found PDFParse but type is:', typeof pdfParseModule.PDFParse);
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
    retryDelay: 2000,
    timeout: 15000,
    delayBetweenRequests: 2000,
    delayBetweenDetailPages: 1000,
    cacheDir: './cache_peoples_bank',
    pdfCacheDir: './cache_peoples_bank_pdfs',
    cacheExpiry: 24 * 60 * 60 * 1000, // 24 hours
    useCache: true,
    fetchDetailPages: true, // Set to false to only scrape listing pages
    extractPDFTerms: true // Set to false to skip PDF extraction
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
    return path.join(CONFIG.cacheDir, `${key}.html`);
}

function isCacheValid(cachePath) {
    if (!fs.existsSync(cachePath)) return false;

    const stats = fs.statSync(cachePath);
    const age = Date.now() - stats.mtime.getTime();
    return age < CONFIG.cacheExpiry;
}

function saveToCache(url, html) {
    const cachePath = getCachePath(url);
    const metadata = {
        url: url,
        cachedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + CONFIG.cacheExpiry).toISOString()
    };

    const cacheData = { metadata, html };
    fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2));
    console.log(`📦 Cached: ${url}`);
}

function loadFromCache(url) {
    const cachePath = getCachePath(url);

    if (!CONFIG.useCache) return null;

    if (isCacheValid(cachePath)) {
        const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        console.log(`💾 Cache hit: ${url} (cached at ${cacheData.metadata.cachedAt})`);
        return cacheData.html;
    }

    return null;
}

function clearCache() {
    if (fs.existsSync(CONFIG.cacheDir)) {
        const files = fs.readdirSync(CONFIG.cacheDir);
        files.forEach(file => {
            fs.unlinkSync(path.join(CONFIG.cacheDir, file));
        });
        console.log(`🗑️  Cleared ${files.length} cached HTML files`);
    }

    if (fs.existsSync(CONFIG.pdfCacheDir)) {
        const pdfFiles = fs.readdirSync(CONFIG.pdfCacheDir);
        pdfFiles.forEach(file => {
            fs.unlinkSync(path.join(CONFIG.pdfCacheDir, file));
        });
        console.log(`🗑️  Cleared ${pdfFiles.length} cached PDF files`);
    }
}

/**
 * Download PDF file
 */
async function downloadPDF(url) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;

        protocol.get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                // Handle redirects
                downloadPDF(response.headers.location).then(resolve).catch(reject);
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
 * Get PDF cache path
 */
function getPDFCachePath(url) {
    const key = getCacheKey(url);
    return path.join(CONFIG.pdfCacheDir, `${key}.json`);
}

/**
 * Check if PDF is cached
 */
function isPDFCached(url) {
    const cachePath = getPDFCachePath(url);

    if (!CONFIG.useCache) return false;

    if (!fs.existsSync(cachePath)) return false;

    const stats = fs.statSync(cachePath);
    const age = Date.now() - stats.mtime.getTime();
    return age < CONFIG.cacheExpiry;
}

/**
 * Load PDF from cache
 */
function loadPDFFromCache(url) {
    const cachePath = getPDFCachePath(url);

    if (!CONFIG.useCache) return null;

    if (isPDFCached(url)) {
        const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        console.log(`    💾 PDF cache hit: ${path.basename(url)}`);
        return cacheData.text;
    }

    return null;
}

/**
 * Save PDF text to cache
 */
function savePDFToCache(url, text) {
    const cachePath = getPDFCachePath(url);
    const metadata = {
        url: url,
        cachedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + CONFIG.cacheExpiry).toISOString()
    };

    const cacheData = { metadata, text };
    fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2));
    console.log(`    📦 PDF cached: ${path.basename(url)}`);
}

/**
 * Extract text from PDF
 */
async function extractPDFText(url) {
    if (!pdfParseAvailable) {
        console.log(`    ⚠️  Skipping PDF extraction (pdf-parse not available): ${url}`);
        return null;
    }

    try {
        // Check cache first
        const cachedText = loadPDFFromCache(url);
        if (cachedText) {
            return cachedText;
        }

        console.log(`    📄 Downloading PDF: ${path.basename(url)}`);

        // Download PDF
        const pdfBuffer = await downloadPDF(url);

        // Extract text
        console.log(`    🔍 Extracting text from PDF...`);
        const data = await pdfParse(pdfBuffer);

        const text = data.text;

        // Cache the extracted text
        savePDFToCache(url, text);

        return text;

    } catch (error) {
        console.error(`    ❌ Error extracting PDF text from ${url}: ${error.message}`);
        return null;
    }
}

/**
 * Parse terms and conditions from PDF text
 */
function parsePDFTerms(pdfText, offerTitle) {
    if (!pdfText) return null;

    try {
        // Try to find the specific offer's terms in the PDF
        // Many banks use a single PDF with all offers listed

        const lines = pdfText.split('\n').map(line => line.trim()).filter(line => line.length > 0);

        // Look for the offer by title
        const offerIndex = lines.findIndex(line =>
            line.toLowerCase().includes(offerTitle.toLowerCase().split('–')[0].trim().toLowerCase())
        );

        if (offerIndex === -1) {
            // If specific offer not found, return general terms
            return {
                source: 'pdf_general',
                allTerms: lines.slice(0, 50) // First 50 lines as general terms
            };
        }

        // Extract terms for this specific offer
        // Typically they're grouped together until the next offer or section
        const offerTerms = [];
        for (let i = offerIndex; i < lines.length && i < offerIndex + 30; i++) {
            const line = lines[i];

            // Stop if we hit another offer (usually starts with a merchant name or number)
            if (i > offerIndex && /^\d+\.|\bOffer\b|\bPromotion\b/i.test(line)) {
                break;
            }

            offerTerms.push(line);
        }

        return {
            source: 'pdf_specific',
            offerTerms: offerTerms,
            // Also extract some general terms
            generalTerms: lines.filter(line =>
                /general|all promotions|validity|cardholder|bank|liable|subject to/i.test(line)
            ).slice(0, 10)
        };

    } catch (error) {
        console.error(`    Error parsing PDF terms: ${error.message}`);
        return null;
    }
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchHTML(url, retryCount = 0) {
    // Try cache first
    const cachedHTML = loadFromCache(url);
    if (cachedHTML) {
        return { html: cachedHTML, fromCache: true };
    }

    // Fetch from server
    try {
        console.log(`🌐 Downloading: ${url}`);

        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Cache-Control': 'no-cache'
            },
            timeout: CONFIG.timeout,
            maxRedirects: 5
        });

        const html = response.data;
        saveToCache(url, html);

        return { html, fromCache: false };

    } catch (error) {
        console.error(`❌ Error fetching ${url}: ${error.message}`);

        // Retry logic
        if (retryCount < CONFIG.maxRetries) {
            const delay = CONFIG.retryDelay * (retryCount + 1);
            console.log(`🔄 Retrying in ${delay}ms... (Attempt ${retryCount + 1}/${CONFIG.maxRetries})`);
            await sleep(delay);
            return fetchHTML(url, retryCount + 1);
        }

        throw error;
    }
}

/**
 * Parse validity date string
 * Examples: "Till February 28, 2026", "January 15, 2026 to March 31, 2026"
 */
function parseValidityDate(validityStr) {
    if (!validityStr) return null;

    const tillMatch = validityStr.match(/Till\s+(\w+)\s+(\d+),?\s+(\d{4})/i);
    if (tillMatch) {
        return {
            raw: validityStr,
            endMonth: tillMatch[1],
            endDay: tillMatch[2],
            endYear: tillMatch[3]
        };
    }

    const rangeMatch = validityStr.match(/(\w+)\s+(\d+),?\s+(\d{4})\s+to\s+(\w+)\s+(\d+),?\s+(\d{4})/i);
    if (rangeMatch) {
        return {
            raw: validityStr,
            startMonth: rangeMatch[1],
            startDay: rangeMatch[2],
            startYear: rangeMatch[3],
            endMonth: rangeMatch[4],
            endDay: rangeMatch[5],
            endYear: rangeMatch[6]
        };
    }

    return { raw: validityStr };
}

/**
 * Extract detailed information from individual promotion page
 */
async function scrapePromotionDetails(url) {
    try {
        const { html, fromCache } = await fetchHTML(url);
        const $ = cheerio.load(html);

        const $card = $('.single-card');
        if ($card.length === 0) {
            console.log(`⚠️  No single-card found on ${url}`);
            return null;
        }

        // Extract image
        const imageUrl = $card.find('.hero-left img').attr('src') || '';

        // Extract title
        const title = $card.find('.title').text().trim();

        // Extract description (terms)
        const descriptionHTML = $card.find('.desc').html() || '';
        const $tempDesc = cheerio.load(descriptionHTML);
        const terms = [];
        $tempDesc('p').each((i, elem) => {
            const text = $(elem).text().trim();
            if (text) terms.push(text);
        });

        // Extract validity
        const validityText = $card.find('.validity').text().replace('Validity:', '').trim();
        const validity = parseValidityDate(validityText);

        // Extract location
        const location = $card.find('.meta-row div').filter((i, el) => {
            return $(el).text().includes('Location:');
        }).text().replace('Location:', '').trim();

        // Extract terms & conditions PDF link
        const termsUrl = $card.find('a.terms-link').attr('href') || '';

        // Extract PDF terms if enabled and URL exists
        let pdfTerms = null;
        if (CONFIG.extractPDFTerms && termsUrl && pdfParseAvailable) {
            console.log(`    📋 Extracting terms from PDF...`);
            const pdfText = await extractPDFText(termsUrl);
            if (pdfText) {
                pdfTerms = parsePDFTerms(pdfText, title);
            }
        }

        // Try to extract structured data from terms
        let minimumSpend = null;
        let maximumBill = null;
        let minimumPax = null;
        let maximumPax = null;

        terms.forEach(term => {
            const minSpendMatch = term.match(/Minimum\s+Spend[:\s-]*Rs\.?\s*([\d,]+)/i);
            if (minSpendMatch) {
                minimumSpend = parseInt(minSpendMatch[1].replace(/,/g, ''));
            }

            const maxBillMatch = term.match(/Maximum\s+Bill\s+Value[:\s-]*Rs\.?\s*([\d,]+)/i);
            if (maxBillMatch) {
                maximumBill = parseInt(maxBillMatch[1].replace(/,/g, ''));
            }

            const minPaxMatch = term.match(/Minimum\s+(\d+)\s+Pax/i);
            if (minPaxMatch) {
                minimumPax = parseInt(minPaxMatch[1]);
            }

            const maxPaxMatch = term.match(/Maximum\s+(\d+)\s+Pax/i);
            if (maxPaxMatch) {
                maximumPax = parseInt(maxPaxMatch[1]);
            }
        });

        return {
            detailPageUrl: url,
            imageUrl,
            title,
            location,
            validity,
            terms,
            termsUrl,
            pdfTerms,
            structuredTerms: {
                minimumSpend,
                maximumBill,
                minimumPax,
                maximumPax
            }
        };

    } catch (error) {
        console.error(`❌ Error scraping details from ${url}: ${error.message}`);
        return null;
    }
}

/**
 * Scrape offers from a category listing page
 */
async function scrapePeoplesBankOffers(url, categoryName = '') {
    try {
        const { html, fromCache } = await fetchHTML(url);
        const $ = cheerio.load(html);

        // Find all offer cards
        const offerCards = $('.offer-card');
        const offers = [];

        log.info('Category', `Found ${offerCards.length} offers`, { fromCache, url, category: categoryName });

        for (let index = 0; index < offerCards.length; index++) {
            const card = offerCards[index];

            try {
                const $card = $(card);

                // Extract discount percentage from badge
                const discount = $card.find('.discount-badge').text().trim();

                // Extract image URL
                const imageUrl = $card.find('.offer-image img').attr('src') || '';

                // Extract merchant/offer name
                const merchantName = $card.find('.promo-short').text().trim();

                // Extract short description
                const shortDescription = $card.find('.merchant-name').clone().children().remove().end().text().trim();

                // Extract validity
                const validityText = $card.find('.valid-date').text().trim();
                const validity = parseValidityDate(validityText);

                // Extract detail page URL
                const detailPageUrl = $card.find('.offer-image a').attr('href') ||
                    $card.find('.promo-short a').attr('href') || '';

                // Generate deterministic unique_id — stable across re-scrapes
                // Hash based on: bank prefix + merchant name + category + detail URL
                // (we deliberately EXCLUDE discount/validity — they change, merchant identity doesn't)
                const idComponents = [
                    'peoples',
                    (merchantName || '').toLowerCase().trim(),
                    (categoryName || '').toLowerCase().trim(),
                    (detailPageUrl || '').toLowerCase().trim(),
                ];
                const hashInput = idComponents.join('|');
                const hash = crypto.createHash('sha256').update(hashInput).digest('hex');
                const slug = (merchantName || 'offer')
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, '')
                    .substring(0, 20);
                const unique_id = `peoples_${hash.substring(0, 12)}_${slug}`;

                // Base offer data
                const offer = {
                    unique_id,
                    category: categoryName,
                    merchantName,
                    discount,
                    shortDescription,
                    validity,
                    imageUrl,
                    detailPageUrl
                };

                // Fetch detailed information if enabled
                if (CONFIG.fetchDetailPages && detailPageUrl) {
                    console.log(`  📄 Fetching details (${index + 1}/${offerCards.length}): ${merchantName}`);

                    const details = await scrapePromotionDetails(detailPageUrl);
                    if (details) {
                        offer.details = details;
                        // Override with more detailed data if available
                        if (details.imageUrl) offer.imageUrl = details.imageUrl;
                        if (details.location) offer.location = details.location;
                        if (details.terms) offer.terms = details.terms;
                        if (details.termsUrl) offer.termsUrl = details.termsUrl;
                        if (details.structuredTerms) offer.structuredTerms = details.structuredTerms;
                    }

                    // Rate limiting for detail pages
                    if (index < offerCards.length - 1) {
                        await sleep(CONFIG.delayBetweenDetailPages);
                    }
                }

                offers.push(offer);

            } catch (err) {
                console.error(`Error parsing card ${index}:`, err.message);
            }
        }

        return {
            success: true,
            timestamp: new Date().toISOString(),
            sourceUrl: url,
            totalOffers: offers.length,
            fromCache: fromCache,
            offers: offers
        };

    } catch (error) {
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
        { name: 'Leisure', url: 'https://www.peoplesbank.lk/promotion-category/leisure/?cardType=credit_card' },
        { name: 'Restaurants', url: 'https://www.peoplesbank.lk/promotion-category/restaurants/?cardType=credit_card' },
        { name: 'Clothing', url: 'https://www.peoplesbank.lk/promotion-category/clothing/?cardType=credit_card' },
        { name: 'Jewellery', url: 'https://www.peoplesbank.lk/promotion-category/jewellers/?cardType=credit_card' },
        { name: 'Travel', url: 'https://www.peoplesbank.lk/promotion-category/travel/?cardType=credit_card' },
        { name: 'Online Stores', url: 'https://www.peoplesbank.lk/promotion-category/online-stores/?cardType=credit_card' },
        { name: 'Supermarkets', url: 'https://www.peoplesbank.lk/promotion-category/supermarkets/?cardType=credit_card' }
    ];

    const allResults = {};
    let cachedCount = 0;
    let freshCount = 0;

    for (const category of categories) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Scraping ${category.name}...`);
        console.log('='.repeat(60));

        const result = await scrapePeoplesBankOffers(category.url, category.name);

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
            console.log(`⏳ Waiting ${CONFIG.delayBetweenRequests}ms before next category...`);
            await sleep(CONFIG.delayBetweenRequests);
        }
    }

    return { results: allResults, stats: { cachedCount, freshCount } };
}

async function main() {
    console.log('╔════════════════════════════════════════╗');
    console.log('║  People\'s Bank Offers Scraper v3.0    ║');
    console.log('║     NEW WEBSITE STRUCTURE SUPPORT      ║');
    console.log('╚════════════════════════════════════════╝\n');

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

    if (args.includes('--no-details')) {
        CONFIG.fetchDetailPages = false;
        console.log('⚠️  Detail page fetching disabled - listing pages only\n');
    }

    if (args.includes('--no-pdf')) {
        CONFIG.extractPDFTerms = false;
        console.log('⚠️  PDF extraction disabled\n');
    }

    const scrapeSingle = args.includes('--single');

    if (scrapeSingle) {
        // Scrape single category
        const url = args[args.indexOf('--single') + 1] ||
            'https://www.peoplesbank.lk/promotion-category/restaurants/?cardType=credit_card';
        const result = await scrapePeoplesBankOffers(url, 'Single');

        if (result.success && result.totalOffers > 0) {
            console.log(`\n✅ Success! Found ${result.totalOffers} offers\n`);

            result.offers.forEach((offer, i) => {
                console.log(`${i + 1}. ${offer.merchantName}`);
                console.log(`   Discount: ${offer.discount}`);
                console.log(`   Valid: ${offer.validity?.raw || 'N/A'}`);
                if (offer.structuredTerms) {
                    console.log(`   Min Spend: Rs. ${offer.structuredTerms.minimumSpend || 'N/A'}`);
                    console.log(`   Max Bill: Rs. ${offer.structuredTerms.maximumBill || 'N/A'}`);
                }
                console.log(`   Location: ${offer.location || 'N/A'}`);
                console.log('');
            });

            fs.writeFileSync('peoples_bank_offers.json', JSON.stringify(result, null, 2));
            console.log('💾 Data saved to: peoples_bank_offers.json');

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
                console.log(`✅ ${cacheIndicator} ${category.padEnd(22)}: ${result.totalOffers} offers`);
                totalCount += result.totalOffers;
                successCount++;
            } else {
                console.log(`❌ ${category.padEnd(25)}: Failed (${result.errorCode || result.error})`);
                failCount++;
            }
        });

        console.log('\n' + '─'.repeat(50));
        console.log(`Total offers scraped: ${totalCount}`);
        console.log(`Successful categories: ${successCount}`);
        console.log(`Failed categories: ${failCount}`);
        console.log(`From cache: ${stats.cachedCount} | Fresh downloads: ${stats.freshCount}`);
        console.log(`Time taken: ${duration}s`);
        console.log('─'.repeat(50));

        // Save complete results
        fs.writeFileSync('peoples_bank_all_offers.json', JSON.stringify(allResults, null, 2));
        console.log('\n💾 Complete data saved to: peoples_bank_all_offers.json');

        // Create flattened simple version
        const simpleData = [];
        Object.entries(allResults).forEach(([category, result]) => {
            if (result.success && result.offers) {
                result.offers.forEach(offer => {
                    simpleData.push({
                        category: category,
                        merchantName: offer.merchantName,
                        discount: offer.discount,
                        validity: offer.validity?.raw || '',
                        validityEndDate: offer.validity?.endDay && offer.validity?.endMonth && offer.validity?.endYear
                            ? `${offer.validity.endDay} ${offer.validity.endMonth} ${offer.validity.endYear}`
                            : '',
                        location: offer.location || '',
                        minimumSpend: offer.structuredTerms?.minimumSpend || null,
                        maximumBill: offer.structuredTerms?.maximumBill || null,
                        minimumPax: offer.structuredTerms?.minimumPax || null,
                        maximumPax: offer.structuredTerms?.maximumPax || null,
                        termsUrl: offer.termsUrl || '',
                        detailPageUrl: offer.detailPageUrl || '',
                        imageUrl: offer.imageUrl || '',
                        terms: offer.terms || [],
                        pdfTerms: offer.details?.pdfTerms || null
                    });
                });
            }
        });

        fs.writeFileSync('peoples_bank_offers_simple.json', JSON.stringify(simpleData, null, 2));
        console.log('💾 Simple data saved to: peoples_bank_offers_simple.json');

        // Create CSV export
        if (simpleData.length > 0) {
            const csvHeader = 'Category,Merchant,Discount,Validity,Location,Min Spend,Max Bill,Min Pax,Max Pax,Terms URL,Detail Page URL\n';
            const csvRows = simpleData.map(o =>
                `"${o.category}","${o.merchantName}","${o.discount}","${o.validity}","${o.location}","${o.minimumSpend || ''}","${o.maximumBill || ''}","${o.minimumPax || ''}","${o.maximumPax || ''}","${o.termsUrl}","${o.detailPageUrl}"`
            ).join('\n');
            fs.writeFileSync('peoples_bank_offers.csv', csvHeader + csvRows);
            console.log('💾 CSV export saved to: peoples_bank_offers.csv');
        }

        console.log('\n✨ Scraping completed!');
        console.log(`📦 Cache directory: ${CONFIG.cacheDir}`);
        console.log(`📦 PDF Cache directory: ${CONFIG.pdfCacheDir}`);
        console.log(`⏰ Cache expires after: ${CONFIG.cacheExpiry / (60 * 60 * 1000)} hours`);
        console.log(`📋 Detail pages: ${CONFIG.fetchDetailPages ? 'Enabled' : 'Disabled'}`);
        console.log(`📄 PDF extraction: ${CONFIG.extractPDFTerms && pdfParseAvailable ? 'Enabled' : 'Disabled'}\n`);
    }
}

// Run
if (require.main === module) {
    main().catch(console.error);
}

module.exports = {
    scrapePeoplesBankOffers,
    scrapeMultipleCategories,
    scrapePromotionDetails,
    clearCache
};