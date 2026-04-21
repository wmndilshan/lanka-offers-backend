/**
 * Branch Parser & Location Classifier
 * Detects SINGLE / LISTED / CHAIN / ONLINE / NONE and parses branch lists
 */

const { matchChain } = require('./known-chains');

// Location types
const LOC_TYPES = {
  SINGLE: 'SINGLE',   // One address → 1 geocode call
  LISTED: 'LISTED',   // Multiple branches listed → parse + geocode each
  CHAIN: 'CHAIN',     // "All Outlets" or known chain → Places Text Search
  ONLINE: 'ONLINE',   // No physical location (URL, online-only)
  NONE: 'NONE'        // No usable address data
};

/**
 * Classify an offer's location type
 * @param {object} locData - normalized location data from adapter
 * @returns {{ type: string, addresses: string[], chainQuery: string|null, merchantForSearch: string }}
 */
function classify(locData) {
  const { merchant_name, city, location, address, addresses, promotion_details, branches } = locData;
  const name = (merchant_name || '').trim();

  // If adapter already parsed branches, use them
  if (branches && branches.length >= 1) {
    if (branches.length === 1) {
      return {
        type: LOC_TYPES.SINGLE,
        addresses: branches,
        chainQuery: null,
        merchantForSearch: name
      };
    }
    return {
      type: LOC_TYPES.LISTED,
      addresses: branches,
      chainQuery: null,
      merchantForSearch: name
    };
  }

  // CHAIN: known chain with no specific address (generic "Merchant Name, Sri Lanka")
  // Or "All Outlets" explicitly mentioned
  const chain = matchChain(name);
  if (chain) {
    // If it's a chain but we have specific listed branches, keep it as LISTED
    // (handled by the branches check above)
    
    // Only use CHAIN (Places search) when we have NO specific address.
    // If addresses.length === 1, that is a known specific location — use SINGLE, not CHAIN.
    if (!address && !city && (!addresses || addresses.length === 0)) {
      return { type: LOC_TYPES.CHAIN, addresses: [], chainQuery: chain.query, merchantForSearch: name };
    }
    
    if (/all\s+(outlets?|branches)/i.test(location || '')) {
       return { type: LOC_TYPES.CHAIN, addresses: [], chainQuery: chain.query, merchantForSearch: name };
    }
  }

  // ONLINE: URL as location or known online-only merchants

  if ((location || '').startsWith('http') || (name || '').startsWith('www.') ||
      /uber|daraz|pickme|food\s*panda|shopee/i.test(name)) {
    return { type: LOC_TYPES.ONLINE, addresses: [], chainQuery: null, merchantForSearch: name };
  }

  // CHAIN: "All Outlets" / "All Branches" in location field
  if (/all\s+(outlets?|branches)/i.test(location || '')) {
    const chain = matchChain(name);
    if (chain) {
      return { type: LOC_TYPES.CHAIN, addresses: [], chainQuery: chain.query, merchantForSearch: name };
    }
    // Unknown chain - try generic search
    return { type: LOC_TYPES.CHAIN, addresses: [], chainQuery: `${name} Sri Lanka`, merchantForSearch: name };
  }

  // CHAIN: known chain with no specific address/city
  if (!city && !address && !(addresses && addresses.length)) {
    const chain = matchChain(name);
    if (chain && !location) {
      return { type: LOC_TYPES.CHAIN, addresses: [], chainQuery: chain.query, merchantForSearch: name };
    }
  }

  // NONE: no merchant name and no address info at all
  if (!name && !city && !address && !(addresses && addresses.length)) {
    return { type: LOC_TYPES.NONE, addresses: [], chainQuery: null, merchantForSearch: '' };
  }

  // SINGLE: has pre-built addresses from adapter
  if (addresses && addresses.length === 1) {
    return { type: LOC_TYPES.SINGLE, addresses: addresses, chainQuery: null, merchantForSearch: name };
  }
  if (addresses && addresses.length > 1) {
    return { type: LOC_TYPES.LISTED, addresses: addresses, chainQuery: null, merchantForSearch: name };
  }

  // SINGLE: build address from available fields
  const builtAddr = buildAddress({ merchantName: name, city, location, address });
  if (builtAddr) {
    return { type: LOC_TYPES.SINGLE, addresses: [builtAddr], chainQuery: null, merchantForSearch: name };
  }

  return { type: LOC_TYPES.NONE, addresses: [], chainQuery: null, merchantForSearch: name };
}

/**
 * Build a geocodable address from parts
 */
function buildAddress({ merchantName, city, location, address }) {
  const parts = [];

  if (address && address.trim()) {
    parts.push(address.trim());
  } else if (merchantName) {
    parts.push(merchantName.trim());
  }

  if (location && location.trim() && location !== '.' &&
      !location.startsWith('http') && location.toLowerCase() !== 'all outlets') {
    // Don't duplicate if location is same as merchant name
    if (location.toLowerCase() !== (merchantName || '').toLowerCase()) {
      parts.push(location.trim());
    }
  }

  if (city && city.trim()) {
    // Don't duplicate if city is already in the address/location
    const existing = parts.join(' ').toLowerCase();
    if (!existing.includes(city.toLowerCase())) {
      parts.push(city.trim());
    }
  }

  if (parts.length === 0) return null;
  return parts.join(', ');
}

/**
 * Parse comma/ampersand-separated outlet list
 * "Rajagiriya, Mount Lavinia & HavelockCity Mall" → ["Rajagiriya", "Mount Lavinia", "HavelockCity Mall"]
 */
function parseOutletList(text, merchantName) {
  if (!text) return [];

  // Extract after "Participating Outlets/Restaurants/Properties -"
  let content = text;
  const prefixMatch = text.match(/participating\s+(?:outlets?|restaurants?|properties)\s*[-–:]\s*(.+)/i);
  if (prefixMatch) content = prefixMatch[1];

  // Split on comma and &
  const raw = content.split(/\s*[,&]\s*/).map(s => s.trim()).filter(Boolean);

  // Build addresses: "MerchantName, Branch, Sri Lanka"
  return raw.map(branch => {
    if (merchantName && !branch.toLowerCase().includes(merchantName.toLowerCase())) {
      return `${merchantName}, ${branch}`;
    }
    return branch;
  });
}

/**
 * Parse asterisk-delimited branch list
 * "* Solar Crab, Pamunugama* The Walden, Nuwara Eliya*..."
 */
function parseAsteriskList(text) {
  if (!text) return [];
  const parts = text.split(/\*/).map(s => s.trim()).filter(s => s && s.length > 3);
  return parts;
}

/**
 * Parse concatenated "Name, CityName, City" text (no delimiters)
 * Uses uppercase detection to split: "Solar Crab, PamunugamaThe Walden, Nuwara Eliya"
 */
function parseConcatenatedBranches(text) {
  if (!text) return [];
  // Split where a lowercase letter is immediately followed by an uppercase letter (no space)
  const split = text.replace(/([a-z])([A-Z])/g, '$1\n$2').split('\n');
  return split.map(s => s.trim()).filter(s => s && s.length > 3);
}

/**
 * Extract city from merchant name
 * "Amaara Sky Hotel - Kandy" → { name: "Amaara Sky Hotel", city: "Kandy" }
 */
function extractCityFromName(text) {
  if (!text) return null;
  // Try dash separator
  const dashMatch = text.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (dashMatch) {
    return { name: dashMatch[1].trim(), city: dashMatch[2].trim() };
  }
  return null;
}

module.exports = {
  LOC_TYPES,
  classify,
  buildAddress,
  parseOutletList,
  parseAsteriskList,
  parseConcatenatedBranches,
  extractCityFromName
};
