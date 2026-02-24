/**
 * Known Sri Lankan chain merchants
 * Maps merchant name patterns to Google Places search queries
 */

const KNOWN_CHAINS = {
  // Supermarkets
  'spar': { query: 'SPAR supermarket Sri Lanka', type: 'supermarket' },
  'keells': { query: 'Keells Super Sri Lanka', type: 'supermarket' },
  'cargills': { query: 'Cargills Food City Sri Lanka', type: 'supermarket' },
  'arpico': { query: 'Arpico Supercenter Sri Lanka', type: 'supermarket' },
  'lanka sathosa': { query: 'Lanka Sathosa Sri Lanka', type: 'supermarket' },
  'laugfs': { query: 'LAUGFS Supermarket Sri Lanka', type: 'supermarket' },
  'glomark': { query: 'Glomark supermarket Sri Lanka', type: 'supermarket' },

  // Fast food / Restaurants
  'subway': { query: 'Subway restaurant Sri Lanka', type: 'restaurant' },
  'burger king': { query: 'Burger King Sri Lanka', type: 'restaurant' },
  'kfc': { query: 'KFC Sri Lanka', type: 'restaurant' },
  'pizza hut': { query: 'Pizza Hut Sri Lanka', type: 'restaurant' },
  'popeyes': { query: 'Popeyes Sri Lanka', type: 'restaurant' },
  'baskin robbins': { query: 'Baskin Robbins Sri Lanka', type: 'restaurant' },
  'delifrance': { query: 'Delifrance Sri Lanka', type: 'restaurant' },
  'crystal jade': { query: 'Crystal Jade restaurant Sri Lanka', type: 'restaurant' },
  'the coffee bean': { query: 'The Coffee Bean & Tea Leaf Sri Lanka', type: 'cafe' },
  'barista': { query: 'Barista coffee Sri Lanka', type: 'cafe' },

  // Retail / Fashion
  'stripes & checks': { query: 'Stripes and Checks Sri Lanka', type: 'clothing_store' },
  'raja jewellers': { query: 'Raja Jewellers Sri Lanka', type: 'jewelry_store' },
  'vogue jewellers': { query: 'Vogue Jewellers Sri Lanka', type: 'jewelry_store' },
  'cotton collection': { query: 'Cotton Collection Sri Lanka', type: 'clothing_store' },

  // Electronics / Online
  'singer': { query: 'Singer showroom Sri Lanka', type: 'electronics_store' },
  'softlogic': { query: 'Softlogic showroom Sri Lanka', type: 'electronics_store' },
  'abans': { query: 'Abans showroom Sri Lanka', type: 'electronics_store' },

  // Hotels / Resorts (chain groups)
  'cinnamon': { query: 'Cinnamon Hotels Sri Lanka', type: 'lodging' },
  'araliya': { query: 'Araliya Hotels Sri Lanka', type: 'lodging' },
  'centauria': { query: 'Centauria Hotels Sri Lanka', type: 'lodging' },
  'amagi': { query: 'Amagi Hotels Sri Lanka', type: 'lodging' },
  'amaara': { query: 'Amaara Hotels Sri Lanka', type: 'lodging' },

  // Fuel
  'ceypetco': { query: 'Ceylon Petroleum filling station Sri Lanka', type: 'gas_station' },
  'ioc': { query: 'Lanka IOC filling station Sri Lanka', type: 'gas_station' },

  // Pharmacy / Health
  'healthguard': { query: 'Healthguard pharmacy Sri Lanka', type: 'pharmacy' },
  'osusala': { query: 'Osusala pharmacy Sri Lanka', type: 'pharmacy' }
};

/**
 * Match merchant name against known chains
 * @param {string} merchantName
 * @returns {{ key: string, query: string, type: string } | null}
 */
function matchChain(merchantName) {
  if (!merchantName) return null;
  const normalized = merchantName.toLowerCase().trim().replace(/[^a-z0-9\s&]/g, ' ').replace(/\s+/g, ' ');

  for (const [key, config] of Object.entries(KNOWN_CHAINS)) {
    if (normalized.includes(key) || normalized === key) {
      return { key, ...config };
    }
  }
  return null;
}

module.exports = { KNOWN_CHAINS, matchChain };
