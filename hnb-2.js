/**
 * HNB Bank Offers Scraper with Ollama LLM Processing
 * Extracts and formats data using DeepSeek-R1 reasoning model
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
  
  // Ollama settings
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'deepseek-r1:1.5b',
  enableLLMProcessing: true,
  llmConcurrent: 2 // Process 2 offers at a time with LLM
};

// Categories
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
    process.stdout.write(`\r  📊 Progress: ${completed}/${urls.length} ${label}`);
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

// LLM Processing
async function checkOllamaConnection() {
  try {
    const response = await axios.get(`${CONFIG.ollamaUrl}/api/tags`, { timeout: 5000 });
    const models = response.data.models || [];
    const hasModel = models.some(m => m.name === CONFIG.ollamaModel);
    
    if (!hasModel) {
      console.log(`⚠️  Model '${CONFIG.ollamaModel}' not found. Available models:`);
      models.forEach(m => console.log(`   - ${m.name}`));
      return false;
    }
    
    console.log(`✓ Connected to Ollama - Model: ${CONFIG.ollamaModel}`);
    return true;
  } catch (error) {
    console.log(`❌ Cannot connect to Ollama at ${CONFIG.ollamaUrl}`);
    console.log(`   Make sure Ollama is running: ollama serve`);
    return false;
  }
}

async function processWithLLM(rawOffer) {
  const rawText = stripHtml(rawOffer.htmlContent);
  
  const prompt = `Extract structured information from this bank offer. Return ONLY a JSON object with these exact fields:

{
  "merchant": "merchant name",
  "offer_summary": "brief 1-2 sentence summary of the discount/offer",
  "discount_details": ["list of specific discounts"],
  "card_types": ["applicable card types"],
  "valid_from": "YYYY-MM-DD",
  "valid_until": "YYYY-MM-DD",
  "contact": "phone number or contact info",
  "location": "location or branch",
  "key_terms": ["important conditions or restrictions"],
  "booking_requirements": "any booking/reservation requirements"
}

Offer Text:
${rawText}

Return only the JSON object, no explanation:`;

  try {
    const response = await axios.post(
      `${CONFIG.ollamaUrl}/api/generate`,
      {
        model: CONFIG.ollamaModel,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.1,
          top_p: 0.9
        }
      },
      { timeout: 60000 }
    );
    
    let responseText = response.data.response.trim();
    
    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return { success: true, data: parsed };
    }
    
    return { success: false, error: 'No valid JSON found' };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function processOffersWithLLM(offers, categoryName) {
  if (!CONFIG.enableLLMProcessing) {
    return offers.map(o => ({ ...o, llm_processed: null }));
  }
  
  console.log(`  🤖 Processing ${offers.length} offers with LLM...`);
  
  const processedOffers = [];
  let processed = 0;
  
  for (let i = 0; i < offers.length; i += CONFIG.llmConcurrent) {
    const batch = offers.slice(i, i + CONFIG.llmConcurrent);
    
    const batchResults = await Promise.all(
      batch.map(async (offer) => {
        const llmResult = await processWithLLM(offer);
        processed++;
        process.stdout.write(`\r  🤖 LLM Processing: ${processed}/${offers.length}`);
        
        return {
          ...offer,
          llm_processed: llmResult.success ? llmResult.data : null,
          llm_error: llmResult.success ? null : llmResult.error
        };
      })
    );
    
    processedOffers.push(...batchResults);
    await sleep(100); // Small delay between batches
  }
  
  console.log('');
  return processedOffers;
}

async function scrapeCategoryOffers(category) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📂 Category: ${category.name} (ID: ${category.id})`);
  console.log('='.repeat(60));
  
  try {
    // Step 1: Get all offer IDs
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
      
      const results = await fetchAllParallel(pageUrls, 'pages');
      results.forEach(r => {
        if (r.success && r.data.data) allOffers.push(...r.data.data);
      });
    }
    
    console.log(`  📦 Total offers: ${allOffers.length}`);
    
    // Step 2: Fetch details
    console.log(`  🔍 Fetching details...`);
    const detailUrls = allOffers.map(o => 
      `https://venus.hnb.lk/api/get_web_card_promo?id=${o.id}`
    );
    
    const detailResults = await fetchAllParallel(detailUrls, 'details');
    
    // Step 3: Combine data
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
        htmlContent: fullDetails?.content || '',
        rawText: stripHtml(fullDetails?.content || '')
      };
    });
    
    // Step 4: Process with LLM
    const processedOffers = await processOffersWithLLM(rawOffers, category.name);
    
    // Step 5: Create clean output
    const cleanOffers = processedOffers.map(offer => {
      if (offer.llm_processed) {
        return {
          id: offer.id,
          category: offer.category,
          merchant: offer.llm_processed.merchant || offer.merchant,
          offer_summary: offer.llm_processed.offer_summary,
          discount_details: offer.llm_processed.discount_details,
          card_types: offer.llm_processed.card_types,
          valid_from: offer.llm_processed.valid_from,
          valid_until: offer.llm_processed.valid_until,
          contact: offer.llm_processed.contact,
          location: offer.llm_processed.location,
          key_terms: offer.llm_processed.key_terms,
          booking_requirements: offer.llm_processed.booking_requirements
        };
      } else {
        // Fallback if LLM fails
        return {
          id: offer.id,
          category: offer.category,
          merchant: offer.merchant,
          offer_summary: offer.title,
          card_types: [offer.cardType],
          valid_from: offer.validFrom,
          valid_until: offer.validUntil,
          raw_text: offer.rawText
        };
      }
    });
    
    console.log(`  ✅ ${category.name} completed!`);
    
    return {
      success: true,
      category: category.name,
      categoryId: category.id,
      totalOffers: cleanOffers.length,
      offers: cleanOffers
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
  console.log(`\n🚀 Starting scraping of ${categoriesToScrape.length} categories...\n`);
  
  const startTime = Date.now();
  const allResults = {};
  
  // Process categories sequentially to manage LLM load
  for (const category of categoriesToScrape) {
    const result = await scrapeCategoryOffers(category);
    allResults[result.category] = result;
  }
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  
  const stats = {
    totalOffers: 0,
    successfulCategories: 0,
    failedCategories: 0,
    duration
  };
  
  Object.values(allResults).forEach(r => {
    if (r.success) {
      stats.successfulCategories++;
      stats.totalOffers += r.totalOffers;
    } else {
      stats.failedCategories++;
    }
  });
  
  return { results: allResults, stats };
}

async function main() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║   HNB Offers Scraper + LLM Processing         ║');
  console.log('║   🤖 DeepSeek-R1 Reasoning                     ║');
  console.log('╚════════════════════════════════════════════════╝\n');
  
  const args = process.argv.slice(2);
  
  if (args.includes('--no-llm')) {
    CONFIG.enableLLMProcessing = false;
    console.log('⚠️  LLM processing disabled\n');
  }
  
  if (args.includes('--no-cache')) {
    CONFIG.useCache = false;
    console.log('⚠️  Cache disabled\n');
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
  
  // Check Ollama connection
  if (CONFIG.enableLLMProcessing) {
    const connected = await checkOllamaConnection();
    if (!connected) {
      console.log('\n💡 Continue without LLM processing? (Will save raw text only)');
      console.log('   Run with --no-llm flag to skip this check\n');
      CONFIG.enableLLMProcessing = false;
    }
  }
  
  const { results: allResults, stats } = await scrapeAllCategories(categoriesToScrape);
  
  // Save results
  const outputDir = './output';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  console.log('\n📁 Saving processed data...');
  
  // Save by category
  Object.entries(allResults).forEach(([categoryName, result]) => {
    if (result.success && result.offers.length > 0) {
      const filename = `${categoryName.toLowerCase().replace(/\s+/g, '_')}_processed.json`;
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
  
  // Save combined
  fs.writeFileSync(
    path.join(outputDir, 'all_offers_processed.json'),
    JSON.stringify({ 
      processedAt: new Date().toISOString(), 
      stats, 
      categories: allResults 
    }, null, 2)
  );
  console.log(`  ✓ all_offers_processed.json`);
  
  // Print summary
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║              SUMMARY REPORT                    ║');
  console.log('╚════════════════════════════════════════════════╝\n');
  
  Object.entries(allResults).forEach(([category, result]) => {
    if (result.success) {
      console.log(`✅ ${category.padEnd(20)}: ${result.totalOffers.toString().padStart(4)} offers`);
    } else {
      console.log(`❌ ${category.padEnd(20)}: Failed`);
    }
  });
  
  console.log('\n' + '─'.repeat(60));
  console.log(`Total offers            : ${stats.totalOffers}`);
  console.log(`Successful categories   : ${stats.successfulCategories}`);
  console.log(`Time taken              : ${stats.duration}s`);
  console.log(`LLM Processing          : ${CONFIG.enableLLMProcessing ? 'Enabled ✓' : 'Disabled'}`);
  console.log('─'.repeat(60));
  
  console.log('\n✨ Processing completed!');
  console.log(`\n💡 Usage:`);
  console.log(`   --no-llm               Skip LLM processing`);
  console.log(`   --category=<name>      Process specific category`);
  console.log(`   --no-cache             Force fresh downloads\n`);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { scrapeCategoryOffers, scrapeAllCategories };