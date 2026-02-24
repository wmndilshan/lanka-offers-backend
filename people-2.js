/**
 * Bank Offers Scraper with Ollama AI Processing
 * Extracts raw HTML, uses AI to parse data, generates unique IDs
 * Requires: npm install axios cheerio
 * Requires: Ollama running locally (default: http://localhost:11434)
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configuration
const CONFIG = {
  maxRetries: 3,
  retryDelay: 2000,
  timeout: 15000,
  delayBetweenRequests: 2000,
  cacheDir: './cache_bank_offers',
  cacheExpiry: 24 * 60 * 60 * 1000,
  useCache: true,
  ollamaUrl: 'http://localhost:11434/api/generate', // Correct endpoint
  ollamaModel: 'deepseek-r1:1.5b',
  ollamaTimeout: 300000, // 5 minutes for slow models // Change this to your installed model
  bankName: 'Peoples Bank', // Will be set dynamically
  cardType: 'Credit Card' // Will be set dynamically
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
    console.log(`💾 Cache hit: ${url}`);
    return cacheData.html;
  }
  return null;
}

function generateUniqueId(bankName, cardType, merchantName, timestamp = Date.now()) {
  // Format: BANK_CARD_MERCHANT_HASH_TIMESTAMP
  // Example: PB_CC_REST_A1B2C3_1728014400000
  
  const bankCode = bankName
    .split(' ')
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .substring(0, 4);
  
  const cardCode = cardType
    .split(' ')
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .substring(0, 3);
  
  const merchantCode = merchantName
    .substring(0, 3)
    .toUpperCase()
    .replace(/\s+/g, '');
  
  // Create hash from merchant name
  const hash = crypto
    .createHash('md5')
    .update(merchantName + timestamp)
    .digest('hex')
    .substring(0, 6)
    .toUpperCase();
  
  const uniqueId = `${bankCode}_${cardCode}_${merchantCode}_${hash}_${timestamp}`;
  return uniqueId;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchHTML(url, retryCount = 0) {
  const cachedHTML = loadFromCache(url);
  if (cachedHTML) {
    return { html: cachedHTML, fromCache: true };
  }
  
  try {
    console.log(`🌐 Downloading: ${url}`);
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: CONFIG.timeout,
      maxRedirects: 10,
      followRedirects: true
    });
    
    saveToCache(url, response.data);
    return { html: response.data, fromCache: false };
    
  } catch (error) {
    console.error(`❌ Error fetching ${url}: ${error.message}`);
    if (retryCount < CONFIG.maxRetries) {
      const delay = CONFIG.retryDelay * (retryCount + 1);
      console.log(`🔄 Retrying in ${delay}ms...`);
      await sleep(delay);
      return fetchHTML(url, retryCount + 1);
    }
    throw error;
  }
}

async function extractHTMLContent(html) {
  // Extract raw text content from HTML
  const $ = cheerio.load(html);
  
  // Remove script and style tags
  $('script, style, meta, link').remove();
  
  const rawText = $('body').text()
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 2000); // Limit to 2000 chars for processing
  
  return rawText;
}

async function callOllama(prompt) {
  try {
    console.log(`🤖 Calling Ollama for AI processing...`);
    
    const response = await axios.post(CONFIG.ollamaUrl, {
      model: CONFIG.ollamaModel,
      prompt: prompt,
      stream: false
    }, {
      timeout: CONFIG.ollamaTimeout
    });
    
    // Handle both response formats
    if (response.data.response) {
      return response.data.response;
    } else if (typeof response.data === 'string') {
      return response.data;
    } else {
      console.error('Unexpected response format:', response.data);
      return '';
    }
    
  } catch (error) {
    console.error(`❌ Ollama error: ${error.message}`);
    console.log('⚠️  Make sure Ollama is running: ollama serve');
    console.log(`📍 Endpoint: ${CONFIG.ollamaUrl}`);
    console.log(`📍 Model: ${CONFIG.ollamaModel}`);
    throw error;
  }
}

async function parseOfferWithAI(htmlContent) {
  const prompt = `You are a data extraction expert. Extract ALL offers from this text content.

TEXT:
${htmlContent}

For EACH offer found, extract:
- Merchant name
- Discount percentage or description
- Validity period
- Minimum spend amount (just number)
- Minimum pax/people
- Maximum pax/people
- Description
- Phone number

Return ONLY a valid JSON object with this exact structure, no other text:
{"offers":[{"merchantName":"","discount":"","validity":"","minimumSpend":null,"minimumPax":null,"maximumPax":null,"description":"","telephone":"","terms":[]}]}`;

  const response = await callOllama(prompt);
  
  try {
    // Extract JSON from response - handle various formats
    let jsonStr = response;
    
    // Try to find JSON in the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }
    
    // Clean up common issues
    jsonStr = jsonStr.replace(/[\r\n]+/g, ' ').trim();
    
    const parsed = JSON.parse(jsonStr);
    
    if (parsed.offers && Array.isArray(parsed.offers)) {
      console.log(`✅ AI parsed ${parsed.offers.length} offers`);
      return parsed;
    } else {
      console.log('⚠️  No offers array in response');
      return { offers: [] };
    }
  } catch (e) {
    console.error('❌ Failed to parse response:', e.message);
    console.log('Raw response:', response.substring(0, 200));
    return { offers: [] };
  }
}

async function enrichOfferWithAI(offer) {
  const prompt = `You are a data validation expert. Clean and enhance this offer data.

DATA:
${JSON.stringify(offer, null, 2)}

Do these tasks:
1. Clean merchant name
2. Standardize discount format
3. Extract category from merchant name
4. Create a brief summary
5. Ensure numeric fields are numbers

Return ONLY valid JSON:
{"merchantName":"","discount":"","validity":"","minimumSpend":null,"minimumPax":null,"maximumPax":null,"description":"","category":"","telephone":"","terms":[],"summary":""}`;

  const response = await callOllama(prompt);
  
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return offer;
    }
    
    const enhanced = JSON.parse(jsonMatch[0]);
    
    // Ensure numeric fields are actually numbers
    if (enhanced.minimumSpend) enhanced.minimumSpend = parseInt(enhanced.minimumSpend) || null;
    if (enhanced.minimumPax) enhanced.minimumPax = parseInt(enhanced.minimumPax) || null;
    if (enhanced.maximumPax) enhanced.maximumPax = parseInt(enhanced.maximumPax) || null;
    
    return enhanced;
  } catch (e) {
    console.error('Error enriching offer:', e.message);
    return offer;
  }
}

async function scrapeAndProcessOffers(url, bankName, cardType) {
  CONFIG.bankName = bankName;
  CONFIG.cardType = cardType;
  
  try {
    // Step 1: Fetch HTML
    const { html, fromCache } = await fetchHTML(url);
    console.log(`✅ HTML fetched ${fromCache ? '(cached)' : '(fresh)'}`);
    
    // Step 2: Extract raw content
    const rawContent = await extractHTMLContent(html);
    console.log(`📄 Extracted ${rawContent.length} characters of content`);
    
    // Step 3: Use AI to parse offers
    console.log(`🧠 Using AI to parse offers...`);
    const parsedData = await parseOfferWithAI(rawContent);
    console.log(`📊 Found ${parsedData.offers.length} offers`);
    
    // Step 4: Enrich each offer with AI
    const enrichedOffers = [];
    for (let i = 0; i < parsedData.offers.length; i++) {
      console.log(`🔄 Enriching offer ${i + 1}/${parsedData.offers.length}...`);
      const enriched = await enrichOfferWithAI(parsedData.offers[i]);
      enrichedOffers.push(enriched);
      await sleep(500); // Prevent rate limiting
    }
    
    // Step 5: Generate unique IDs
    console.log(`🔐 Generating unique IDs...`);
    const finalOffers = enrichedOffers.map((offer, index) => ({
      id: generateUniqueId(bankName, cardType, offer.merchantName),
      sequenceId: `${bankName.replace(/\s+/g, '')}_${cardType.replace(/\s+/g, '')}_${String(index + 1).padStart(4, '0')}`,
      bank: bankName,
      cardType: cardType,
      createdAt: new Date().toISOString(),
      ...offer
    }));
    
    return {
      success: true,
      timestamp: new Date().toISOString(),
      sourceUrl: url,
      bank: bankName,
      cardType: cardType,
      totalOffers: finalOffers.length,
      fromCache: fromCache,
      offers: finalOffers
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║  Bank Scraper + Ollama AI + Unique ID  ║');
  console.log('╚════════════════════════════════════════╝\n');
  
  // Example usage
  const scrapeConfigs = [
    {
      url: 'https://www.peoplesbank.lk/leisure-credit-card/',
      bankName: 'Peoples Bank',
      cardType: 'Leisure Credit Card'
    },
    {
      url: 'https://www.pabcbank.com/card-offers/',
      bankName: 'Pan Asia Bank',
      cardType: 'Bizclass Credit Card'
    }
  ];
  
  const allResults = [];
  
  for (const config of scrapeConfigs) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Scraping: ${config.bankName} - ${config.cardType}`);
    console.log('='.repeat(60) + '\n');
    
    const result = await scrapeAndProcessOffers(
      config.url,
      config.bankName,
      config.cardType
    );
    
    if (result.success) {
      console.log(`\n✅ Success! Processed ${result.totalOffers} offers\n`);
      
      result.offers.forEach((offer, i) => {
        console.log(`${i + 1}. ${offer.merchantName}`);
        console.log(`   ID: ${offer.id}`);
        console.log(`   Seq: ${offer.sequenceId}`);
        console.log(`   Discount: ${offer.discount}`);
        console.log(`   Category: ${offer.category}`);
        console.log(`   Valid: ${offer.validity}`);
        console.log('');
      });
      
      allResults.push(result);
    } else {
      console.log(`\n❌ Failed: ${result.error}`);
    }
    
    await sleep(2000);
  }
  
  // Save results
  const filename = `bank_offers_with_ids_${Date.now()}.json`;
  fs.writeFileSync(filename, JSON.stringify(allResults, null, 2));
  console.log(`\n💾 Results saved to: ${filename}`);
  
  // Create CSV
  const csvRows = [];
  csvRows.push('ID,Bank,Card Type,Merchant,Discount,Category,Validity,Min Spend,Summary');
  
  allResults.forEach(result => {
    if (result.success) {
      result.offers.forEach(offer => {
        csvRows.push([
          offer.id,
          result.bank,
          result.cardType,
          offer.merchantName,
          offer.discount,
          offer.category || 'N/A',
          offer.validity,
          offer.minimumSpend || 'N/A',
          (offer.summary || '').replace(/,/g, ';').substring(0, 100)
        ].join(','));
      });
    }
  });
  
  const csvFilename = `bank_offers_${Date.now()}.csv`;
  fs.writeFileSync(csvFilename, csvRows.join('\n'));
  console.log(`💾 CSV saved to: ${csvFilename}`);
  
  console.log('\n✨ Processing completed!');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  scrapeAndProcessOffers,
  generateUniqueId,
  parseOfferWithAI,
  enrichOfferWithAI
};