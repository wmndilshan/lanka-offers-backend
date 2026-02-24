/**
 * Sampath Bank Card Promotions API Scraper
 * Directly consumes JSON API endpoint
 * Requires: npm install axios
 */

const axios = require('axios');
const fs = require('fs');

const CONFIG = {
  baseApiUrl: 'https://www.sampath.lk/api/card-promotions',
  timeout: 15000,
  retries: 3,
  retryDelay: 1000
};

// Categories available in Sampath API
const CATEGORIES = [
  'hotels',
  'dining',
  'super_market',
  'online',
//   'entertainment',
//   'wellness',
//   'automotive'
];

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchFromAPI(category, retryCount = 0) {
  const url = `${CONFIG.baseApiUrl}?category=${category}`;
  
  try {
    console.log(`  Fetching: ${category}`);
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      },
      timeout: CONFIG.timeout
    });

    if (response.data && response.data.data) {
      console.log(`  ✓ Found ${response.data.data.length} offers`);
      return response.data.data;
    }
    return [];

  } catch (error) {
    if (retryCount < CONFIG.retries) {
      const delay = CONFIG.retryDelay * (retryCount + 1);
      console.log(`  🔄 Retry in ${delay}ms (${retryCount + 1}/${CONFIG.retries})`);
      await sleep(delay);
      return fetchFromAPI(category, retryCount + 1);
    }
    console.error(`  ❌ Error: ${error.message}`);
    return [];
  }
}

function extractOfferDetails(rawOffer) {
  // Strip HTML tags from text
  const stripHtml = (html) => {
    if (!html) return '';
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  };

  // Parse terms and conditions into array
  const parseTerms = (termsHtml) => {
    if (!termsHtml) return [];
    const terms = [];
    const lines = termsHtml.split(/<br\s*\/?>/gi);
    lines.forEach(line => {
      const cleaned = stripHtml(line);
      if (cleaned && cleaned.length > 5) {
        terms.push(cleaned);
      }
    });
    return terms;
  };

  // Extract eligible cards from description
  const extractEligibleCards = (cardsNewArray) => {
    const cards = [];
    if (Array.isArray(cardsNewArray)) {
      cardsNewArray.forEach(card => {
        if (card.description) {
          cards.push(stripHtml(card.description));
        }
      });
    }
    return cards;
  };

  // Extract contact from cards_new array
  const extractContact = (cardsNewArray) => {
    let contact = '';
    if (Array.isArray(cardsNewArray)) {
      for (let card of cardsNewArray) {
        if (card.title === 'Reservation Numbers') {
          contact = stripHtml(card.description);
          break;
        }
      }
    }
    return contact || rawOffer.contact_no || '';
  };

  return {
    id: rawOffer.id,
    company_name: stripHtml(rawOffer.company_name),
    category: rawOffer.category,
    city: rawOffer.city,
    short_discount: rawOffer.short_discount || stripHtml(rawOffer.discounts),
    description: stripHtml(rawOffer.description),
    short_description: stripHtml(rawOffer.short_description),
    image_url: rawOffer.image_url,
    contact_number: extractContact(rawOffer.cards_new),
    promotion_period: stripHtml(rawOffer.promotion_details),
    eligible_cards: extractEligibleCards(rawOffer.cards_new),
    terms_conditions: parseTerms(rawOffer.terms_and_conditions),
    expiry_timestamp: rawOffer.expire_on,
    created_at: rawOffer.created_at,
    updated_at: rawOffer.updated_at
  };
}

async function scrapeAllCategories() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║   Sampath Bank API Offers Scraper     ║');
  console.log('║      Direct JSON API Consumption      ║');
  console.log('╚════════════════════════════════════════╝\n');

  const args = process.argv.slice(2);
  let categoriesToScrape = CATEGORIES;

  // Allow filtering by specific category
  if (args.length > 0 && !args[0].startsWith('--')) {
    categoriesToScrape = [args[0]];
  }

  console.log(`Scraping categories: ${categoriesToScrape.join(', ')}\n`);

  const allOffers = {};
  let totalOffers = 0;

  // Fetch all categories
  for (const category of categoriesToScrape) {
    console.log(`\n📂 Category: ${category}`);
    const rawOffers = await fetchFromAPI(category);
    
    const cleanedOffers = rawOffers.map(offer => extractOfferDetails(offer));
    allOffers[category] = cleanedOffers;
    totalOffers += cleanedOffers.length;

    // Polite delay between API calls
    if (categoriesToScrape.indexOf(category) < categoriesToScrape.length - 1) {
      await sleep(500);
    }
  }

  // Save results
  console.log('\n📊 SUMMARY');
  console.log('═'.repeat(50));
  
  Object.entries(allOffers).forEach(([category, offers]) => {
    console.log(`${category.padEnd(15)}: ${offers.length} offers`);
  });

  console.log(`${'─'.repeat(50)}`);
  console.log(`Total offers: ${totalOffers}`);

  // Save detailed JSON
  const result = {
    source: 'Sampath Bank API',
    endpoint: CONFIG.baseApiUrl,
    scraped_at: new Date().toISOString(),
    total_offers: totalOffers,
    categories: allOffers
  };

  fs.writeFileSync('sampath_offers_detailed.json', JSON.stringify(result, null, 2));
  console.log('\n💾 Data saved to: sampath_offers_detailed.json');

  // Create CSV export
  const csvRows = [];
  csvRows.push('Category,Company,Discount,City,Contact,Expiry Date');

  Object.entries(allOffers).forEach(([category, offers]) => {
    offers.forEach(offer => {
      const expiryDate = offer.expiry_timestamp 
        ? new Date(parseInt(offer.expiry_timestamp)).toISOString().split('T')[0]
        : 'N/A';
      
      const row = [
        category,
        offer.company_name,
        offer.short_discount,
        offer.city,
        offer.contact_number,
        expiryDate
      ].map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',');
      
      csvRows.push(row);
    });
  });

  fs.writeFileSync('sampath_offers.csv', csvRows.join('\n'));
  console.log('💾 CSV export saved to: sampath_offers.csv');

  // Create flattened simple JSON
  const simpleOffers = [];
  Object.entries(allOffers).forEach(([category, offers]) => {
    offers.forEach(offer => {
      simpleOffers.push({
        category: category,
        company: offer.company_name,
        discount: offer.short_discount,
        city: offer.city,
        description: offer.description,
        contact: offer.contact_number,
        period: offer.promotion_period,
        image: offer.image_url
      });
    });
  });

  fs.writeFileSync('sampath_offers_simple.json', JSON.stringify(simpleOffers, null, 2));
  console.log('💾 Simple JSON saved to: sampath_offers_simple.json');

  console.log('\n✨ Scraping completed!\n');
}

// Run
if (require.main === module) {
  scrapeAllCategories().catch(console.error);
}

module.exports = { fetchFromAPI, extractOfferDetails };