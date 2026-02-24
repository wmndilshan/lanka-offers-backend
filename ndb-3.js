/**
 * NDB Bank Card Offers Scraper - Updated for New Website Structure (2026)
 * Requires: npm install puppeteer pdf-parse
 * 
 * New structure uses Bootstrap cards instead of Ant Design
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

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
    cacheDir: './cache_ndb_bank',
    pdfCacheDir: './cache_ndb_bank/pdfs',
    cacheExpiry: 24 * 60 * 60 * 1000, // 24 hours
    useCache: true,
    extractPdfContent: true,
    fetchDetailPages: true, // Fetch individual offer pages for more details
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
 * Scrape detail page for additional information
 */
async function scrapeOfferDetails(browser, offerUrl) {
    try {
        const page = await browser.newPage();

        await page.setViewport({ width: 1920, height: 1080 });

        console.log(`    📄 Fetching details: ${offerUrl}`);
        await page.goto(offerUrl, {
            waitUntil: 'networkidle2',
            timeout: CONFIG.navigationTimeout
        });

        await sleep(2000);

        const details = await page.evaluate(() => {
            const result = {
                title: '',
                category: '',
                validPeriod: '',
                cardType: '',
                specialConditions: '',
                merchantDescription: '',
                address: '',
                hotline: '',
                website: '',
                image: ''
            };

            // Extract title
            const titleEl = document.querySelector('h1.ndbcolor');
            if (titleEl) result.title = titleEl.textContent.trim();

            // Extract category
            const categoryBadge = document.querySelector('.badge');
            if (categoryBadge) result.category = categoryBadge.textContent.trim();

            // Extract valid period
            const validPeriodMatch = document.body.textContent.match(/Offer valid period\s*:\s*([^\n]+)/);
            if (validPeriodMatch) result.validPeriod = validPeriodMatch[1].trim();

            // Extract image
            const imgEl = document.querySelector('.col-md-8 img.img-fluid');
            if (imgEl) result.image = imgEl.src;

            // Extract card type
            const typeMatch = document.body.textContent.match(/Type:\s*([^\n]+)/);
            if (typeMatch) result.cardType = typeMatch[1].trim();

            // Extract special conditions
            const conditionsHeading = Array.from(document.querySelectorAll('h5')).find(h =>
                h.textContent.includes('Special Conditions')
            );
            if (conditionsHeading && conditionsHeading.nextElementSibling) {
                result.specialConditions = conditionsHeading.nextElementSibling.textContent.trim();
            }

            // Extract merchant info from sidebar
            const sidebarCard = document.querySelector('.col-md-4 .card');
            if (sidebarCard) {
                const merchantImg = sidebarCard.querySelector('img');
                if (merchantImg) result.merchantLogo = merchantImg.src;

                const merchantName = sidebarCard.querySelector('h3');
                if (merchantName) result.merchantName = merchantName.textContent.trim();

                const headings = sidebarCard.querySelectorAll('h5');
                headings.forEach(h => {
                    const text = h.textContent.trim();
                    const nextP = h.nextElementSibling;

                    if (!nextP) return;

                    if (text === 'Address') {
                        result.address = nextP.textContent.trim();
                    } else if (text === 'Hotline') {
                        result.hotline = nextP.textContent.trim();
                    } else if (text === 'Website') {
                        const link = nextP.querySelector('a');
                        result.website = link ? link.href : nextP.textContent.trim();
                    }
                });
            }

            return result;
        });

        await page.close();
        return details;

    } catch (error) {
        console.error(`    ❌ Error scraping details: ${error.message}`);
        return null;
    }
}

/**
 * Parse offer text to extract structured data
 */
function parseOfferText(text) {
    const result = {
        discount: null,
        minimumBill: null,
        maximumTransaction: null,
        restrictions: []
    };

    if (!text) return result;

    // Extract discount percentage
    const discountMatch = text.match(/(\d+)%\s*(?:Savings|Off|Discount)/i);
    if (discountMatch) result.discount = discountMatch[1] + '%';

    // Extract minimum bill
    const minMatch = text.match(/Minimum\s+(?:bill|transaction)\s+value\s+Rs\.?\s*([\d,]+)/i);
    if (minMatch) result.minimumBill = parseInt(minMatch[1].replace(/,/g, ''));

    // Extract maximum transaction
    const maxMatch = text.match(/Maximum\s+(?:transaction|bill)\s+value\s+Rs\.?\s*([\d,]+)/i);
    if (maxMatch) result.maximumTransaction = parseInt(maxMatch[1].replace(/,/g, ''));

    return result;
}

async function scrapeNDBCardOffers(url, retryCount = 0) {
    // Check cache first
    const cachedData = loadFromCache(url);
    if (cachedData) {
        return { ...cachedData, fromCache: true };
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

        await page.setViewport({ width: 1920, height: 1080 });

        console.log('📥 Loading page...');
        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: CONFIG.navigationTimeout
        });

        console.log('⏳ Waiting for content to render...');

        // Wait for the new Bootstrap-based card structure
        await page.waitForSelector('.offer-card', { timeout: 15000 });

        // Additional wait for dynamic content
        await sleep(CONFIG.waitForContent);

        console.log('📊 Extracting offers...');

        // Extract all offer data from listing page
        const offers = await page.evaluate(() => {
            const cardContainers = document.querySelectorAll('.col-12.col-md-6.col-lg-4');
            const results = [];

            cardContainers.forEach((container, index) => {
                try {
                    const card = container.querySelector('.offer-card');
                    if (!card) return;

                    // Extract detail page URL
                    const link = container.querySelector('a[href*="/offer-details/"]');
                    const detailUrl = link ? link.href : '';

                    // Extract images
                    const coverImg = card.querySelector('.card-img-top:not(.offercompanylogo)');
                    const logoImg = card.querySelector('.offercompanylogo');

                    const coverImageUrl = coverImg ? coverImg.src : '';
                    const logoImageUrl = logoImg ? logoImg.src : '';

                    // Extract title
                    const titleEl = card.querySelector('.card-title.ndbcolor');
                    const title = titleEl ? titleEl.textContent.trim() : '';

                    // Extract merchant name
                    const merchantEl = card.querySelector('.card-body p.card-title:not(.text-muted)');
                    const merchantName = merchantEl ? merchantEl.textContent.trim() : '';

                    // Extract card type
                    const cardTypeEl = card.querySelector('.text-muted');
                    const cardType = cardTypeEl ? cardTypeEl.textContent.trim() : '';

                    // Extract phone number
                    const phoneMatch = card.textContent.match(/(\d{3}\s?\d{7})/);
                    const phone = phoneMatch ? phoneMatch[1].trim() : '';

                    // Extract validity date
                    const dateEl = card.querySelector('.offer-date');
                    const validityDate = dateEl ? dateEl.textContent.replace(/\s+/g, ' ').trim() : '';

                    results.push({
                        id: index + 1,
                        title,
                        merchantName,
                        cardType,
                        phone,
                        validityDate,
                        coverImage: coverImageUrl,
                        merchantLogo: logoImageUrl,
                        detailUrl
                    });

                } catch (err) {
                    console.error('Error parsing card:', err);
                }
            });

            return results;
        });

        console.log(`✅ Found ${offers.length} offers on listing page`);

        // Process each offer
        const processedOffers = [];

        for (let i = 0; i < offers.length; i++) {
            const offer = offers[i];

            console.log(`\n  Processing offer ${i + 1}/${offers.length}: ${offer.merchantName}`);

            const parsed = parseOfferText(offer.title);

            // Fetch detail page if enabled
            let detailData = null;
            let pdfTerms = null;

            if (CONFIG.fetchDetailPages && offer.detailUrl) {
                detailData = await scrapeOfferDetails(browser, offer.detailUrl);

                // Extract PDF if available (would need to be in detail page)
                // Note: The detail page structure doesn't show PDF link in the provided HTML
                // but we can add it if it exists

                await sleep(CONFIG.delayBetweenDetailPages);
            }

            processedOffers.push({
                id: offer.id,
                merchant: {
                    name: detailData?.merchantName || offer.merchantName,
                    phone: offer.phone,
                    address: detailData?.address || '',
                    website: detailData?.website || '',
                    logo: offer.merchantLogo
                },
                offer: {
                    title: offer.title,
                    description: detailData?.specialConditions || offer.title,
                    discount: parsed.discount,
                    minimumBill: parsed.minimumBill,
                    maximumTransaction: parsed.maximumTransaction,
                    cardType: detailData?.cardType || offer.cardType
                },
                validity: {
                    raw: detailData?.validPeriod || offer.validityDate,
                    parsed: detailData?.validPeriod || offer.validityDate
                },
                category: detailData?.category || '',
                images: {
                    cover: detailData?.image || offer.coverImage,
                    logo: offer.merchantLogo
                },
                detailUrl: offer.detailUrl,
                termsAndConditions: pdfTerms
            });
        }

        await browser.close();

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
        { name: 'Privilege Weekend', url: 'https://www.ndbbank.com/cards/card-offers/privilege-weekend' },
        { name: 'Clothing & Accessories', url: 'https://www.ndbbank.com/cards/card-offers/clothing-accessories' },
        { name: 'Restaurants & Pubs', url: 'https://www.ndbbank.com/cards/card-offers/restaurants-pubs' },
        { name: 'Special Promotions', url: 'https://www.ndbbank.com/cards/card-offers/special-ipp-promotions' },
        { name: 'Supermarkets', url: 'https://www.ndbbank.com/cards/card-offers/supermarkets' },
        { name: 'Jewellery & Watches', url: 'https://www.ndbbank.com/cards/card-offers/jewellery-watches' },
    ];

    const allResults = {};
    let cachedCount = 0;
    let freshCount = 0;

    for (const category of categories) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Scraping ${category.name}...`);
        console.log('='.repeat(60));

        const result = await scrapeNDBCardOffers(category.url);

        if (result.success) {
            console.log(`✅ Success: Found ${result.totalOffers} offers in ${category.name}`);
            allResults[category.name] = result;

            if (result.fromCache) cachedCount++;
            else freshCount++;
        } else {
            console.log(`❌ Failed: ${category.name}`);
            console.log(`   Error: ${result.error}`);
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
    console.log('║   NDB Bank Card Offers Scraper v4.0    ║');
    console.log('║     NEW BOOTSTRAP STRUCTURE 2026       ║');
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
            'https://www.ndbbank.com/cards/card-offers/restaurants-pubs';
        const result = await scrapeNDBCardOffers(url);

        if (result.success && result.totalOffers > 0) {
            console.log(`\n✅ Success! Found ${result.totalOffers} offers\n`);

            result.offers.forEach((offer, i) => {
                console.log(`${i + 1}. ${offer.merchant.name}`);
                console.log(`   Offer: ${offer.offer.title}`);
                console.log(`   Discount: ${offer.offer.discount || 'N/A'}`);
                console.log(`   Valid: ${offer.validity.raw}`);
                console.log(`   Phone: ${offer.merchant.phone || 'N/A'}`);
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
                console.log(`❌ ${category.padEnd(28)}: Failed`);
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

        // Save results
        fs.writeFileSync('ndb_all_offers.json', JSON.stringify(allResults, null, 2));
        console.log('\n💾 Complete data saved to: ndb_all_offers.json');

        // Create simple version
        const simpleData = [];
        Object.entries(allResults).forEach(([category, result]) => {
            if (result.success && result.offers) {
                result.offers.forEach(offer => {
                    simpleData.push({
                        category: category,
                        merchant: offer.merchant.name,
                        offerTitle: offer.offer.title,
                        discount: offer.offer.discount,
                        minBill: offer.offer.minimumBill,
                        maxTransaction: offer.offer.maximumTransaction,
                        cardType: offer.offer.cardType,
                        validUntil: offer.validity.parsed,
                        phone: offer.merchant.phone,
                        address: offer.merchant.address,
                        website: offer.merchant.website,
                        detailUrl: offer.detailUrl
                    });
                });
            }
        });

        fs.writeFileSync('ndb_offers_simple.json', JSON.stringify(simpleData, null, 2));
        console.log('💾 Simple data saved to: ndb_offers_simple.json');

        // Create CSV
        if (simpleData.length > 0) {
            const csvHeader = 'Category,Merchant,Offer,Discount,Min Bill,Max Transaction,Card Type,Valid Until,Phone,Address,Website,Detail URL\n';
            const csvRows = simpleData.map(o =>
                `"${o.category}","${o.merchant}","${o.offerTitle}","${o.discount || ''}","${o.minBill || ''}","${o.maxTransaction || ''}","${o.cardType}","${o.validUntil}","${o.phone}","${o.address}","${o.website}","${o.detailUrl}"`
            ).join('\n');
            fs.writeFileSync('ndb_offers.csv', csvHeader + csvRows);
            console.log('💾 CSV export saved to: ndb_offers.csv');
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
    scrapeNDBCardOffers,
    scrapeMultipleCategories,
    clearCache,
    processPdfTerms
};