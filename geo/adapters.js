/**
 * Bank-specific Location Adapters
 * Each adapter knows how to extract address data from its bank's offer format
 *
 * Every adapter implements:
 *   loadOffers(inputFile) → offer[]
 *   extractLocationData(offer) → { offer_id, merchant_name, city, location, address, addresses[], branches[], phone, promotion_details }
 *   getDefaultInputFile() → string
 */

const fs = require('fs');
const { parseConcatenatedBranches, parseOutletList, parseAsteriskList, extractCityFromName } = require('./branch-parser');

function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// Date pattern: text that is a date, not an address
const DATE_RE = /^\d{1,2}\w*\s+(january|february|march|april|may|june|july|august|september|october|november|december)/i;
const DATE_RE2 = /^valid\s/i;

function looksLikeAddress(text) {
  if (!text || text.length < 5) return false;
  if (DATE_RE.test(text) || DATE_RE2.test(text)) return false;
  if (text.startsWith('http') || text.startsWith('www.')) return false;
  if (/^sampath|^for all|^visa|^mastercard/i.test(text)) return false;
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// SAMPATH ADAPTER
// Reads raw API data (sampath_offers_detailed.json) for eligible_cards
// ═══════════════════════════════════════════════════════════════════════════

class SampathAdapter {
  constructor() { this.bank = 'sampath'; }

  getDefaultInputFile() { return './sampath_offers_detailed.json'; }

  loadOffers(inputFile) {
    const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
    const offers = [];
    // Structure: { categories: { hotels: [...], dining: [...] } }
    if (data.categories) {
      Object.entries(data.categories).forEach(([cat, catOffers]) => {
        if (Array.isArray(catOffers)) {
          catOffers.forEach(o => offers.push({ ...o, _category: cat }));
        }
      });
    } else if (Array.isArray(data)) {
      offers.push(...data);
    } else if (data.offers) {
      offers.push(...data.offers);
    }
    return offers;
  }

  extractLocationData(offer) {
    const name = stripHtml(offer.company_name || '');
    const city = offer.city || '';
    const ec = offer.eligible_cards || [];

    // eligible_cards[0] = partner name, [1] = usually address or second name
    const rawAddr = ec[1] ? stripHtml(ec[1]) : '';
    let address = looksLikeAddress(rawAddr) ? rawAddr : '';
    let branches = [];

    // Check for concatenated multi-branch (e.g., "Solar Crab, PamunugamaThe Walden, Nuwara Eliya...")
    if (address && address.length > 60 && /[a-z][A-Z]/.test(address)) {
      branches = parseConcatenatedBranches(address);
      address = '';
    }

    // Check promotion_details for "Participating Outlets" branch lists
    const details = stripHtml(offer.promotion_details || offer.promotion_period || '');
    if (!branches.length && details) {
      const outletMatch = details.match(/participating\s+(?:outlets?|restaurants?)\s*[-–:]\s*([^*]+)/i);
      if (outletMatch) {
        branches = parseOutletList(outletMatch[0], name);
      }
    }

    // Build addresses array
    const addresses = [];
    if (branches.length > 0) {
      // branches are already individual locations
    } else if (address) {
      // Full street address from eligible_cards
      const fullAddr = city ? `${address}, ${city}` : address;
      addresses.push(fullAddr);
    } else if (city) {
      addresses.push(`${name}, ${city}`);
    }

    // Generate unique_id matching sampath-5.js pattern
    const crypto = require('crypto');
    const hashInput = ['sampath', name, city, offer._category || '', offer.short_discount || ''].join('|').toLowerCase().trim();
    const hash = crypto.createHash('sha256').update(hashInput).digest('hex');
    const slug = (name || 'offer').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 20);

    return {
      offer_id: `sampath_${hash.substring(0, 12)}_${slug}`,
      merchant_name: name,
      city: city,
      location: '',
      address: address,
      addresses: addresses,
      branches: branches,
      phone: offer.contact_no || '',
      promotion_details: details
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HNB ADAPTER
// merchant.addresses[0] has promo text + venue: "15% off at Amagi Beach Marawila, Sri Lanka"
// ═══════════════════════════════════════════════════════════════════════════

class HNBAdapter {
  constructor() { this.bank = 'hnb'; }

  getDefaultInputFile() { return './output/hnb_all_v5.json'; }

  loadOffers(inputFile) {
    const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
    return data.offers || data;
  }

  extractLocationData(offer) {
    const m = offer.merchant || {};
    const name = m.name || offer.merchantName || '';
    const rawAddrs = m.addresses || [];
    const phone = (m.phone || []).join(', ');

    const addresses = [];
    rawAddrs.forEach(rawAddr => {
      // Strip promo prefix: "15% off on HB and FB basis at " → keep venue + location
      let cleaned = rawAddr;
      const atMatch = cleaned.match(/\bat\s+(.+)/i);
      if (atMatch) {
        cleaned = atMatch[1];
      }
      // Remove trailing ", Sri Lanka" (we add it back later in geocoder)
      cleaned = cleaned.replace(/,\s*Sri\s*Lanka\s*$/i, '').trim();
      if (cleaned) addresses.push(cleaned);
    });

    return {
      offer_id: offer.unique_id || offer.id || '',
      merchant_name: name,
      city: null,
      location: m.location || null,
      address: null,
      addresses: addresses,
      branches: [],
      phone: phone,
      promotion_details: offer.offer?.description || null
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BOC ADAPTER
// location = venue name only ("Centauria Hill Resort")
// ═══════════════════════════════════════════════════════════════════════════

class BOCAdapter {
  constructor() { this.bank = 'boc'; }

  getDefaultInputFile() { return './output/boc_all_v5.json'; }

  loadOffers(inputFile) {
    const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
    return data.offers || data;
  }

  extractLocationData(offer) {
    const name = offer.title || offer.merchantName || '';
    const location = offer.location || '';

    return {
      offer_id: offer.unique_id || offer.id || '',
      merchant_name: name,
      city: null,
      location: location,
      address: null,
      addresses: location ? [`${location}`] : (name ? [`${name}`] : []),
      branches: [],
      phone: offer.phone || '',
      promotion_details: offer.description || null
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PEOPLE'S BANK ADAPTER
// location = "Venue Name - City" or "Venue Name City"
// ═══════════════════════════════════════════════════════════════════════════

class PeoplesAdapter {
  constructor() { this.bank = 'peoples'; }

  getDefaultInputFile() { return './output/peoples_all_v4.json'; }

  loadOffers(inputFile) {
    const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
    return data.offers || data;
  }

  extractLocationData(offer) {
    const name = offer.merchant_name || offer.merchantName || '';
    const rawLocation = offer.location || '';
    let addresses = [];

    // Parse "Venue - City" or "Venue-City" pattern
    const parsed = extractCityFromName(rawLocation);
    if (parsed) {
      addresses.push(`${parsed.name}, ${parsed.city}`);
    } else if (rawLocation) {
      addresses.push(rawLocation);
    } else if (name) {
      addresses.push(name);
    }

    return {
      offer_id: offer.unique_id || offer.id || '',
      merchant_name: name,
      city: parsed?.city || null,
      location: rawLocation,
      address: null,
      addresses: addresses,
      branches: [],
      phone: null,
      promotion_details: null
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SEYLAN ADAPTER
// merchant.address = full street address (28/86 have it), rest empty
// Chains (SPAR, Cargills) have empty address
// ═══════════════════════════════════════════════════════════════════════════

class SeylanAdapter {
  constructor() { this.bank = 'seylan'; }

  getDefaultInputFile() { return './output/seylan_all_v3.json'; }

  loadOffers(inputFile) {
    const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
    return data.offers || data;
  }

  extractLocationData(offer) {
    const m = offer.merchant || {};
    const name = m.name || offer.merchantName || '';
    const address = m.address || '';
    const phone = m.phone || '';

    const addresses = [];
    if (address) {
      // Has full street address — use merchant name + address
      addresses.push(`${name}, ${address}`);
    }
    // If no address, classifier will check known-chains or use name only

    return {
      offer_id: offer.id || offer.unique_id || '',
      merchant_name: name,
      city: null,
      location: null,
      address: address,
      addresses: addresses,
      branches: [],
      phone: phone,
      promotion_details: offer.offer?.description || null
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// NDB ADAPTER
// merchant.location = "All Outlets" (17/55) or city ("Colombo 02") or URL/dot
// ═══════════════════════════════════════════════════════════════════════════

class NDBAdapter {
  constructor() { this.bank = 'ndb'; }

  getDefaultInputFile() { return './output/ndb_all_v4.json'; }

  loadOffers(inputFile) {
    const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
    return data.offers || data;
  }

  extractLocationData(offer) {
    const m = offer.merchant || {};
    const name = m.name || offer.merchantName || '';
    const location = (m.location || '').trim();
    const phone = m.phone || '';

    const addresses = [];
    // Skip URLs, dots, "All Outlets" for direct geocoding
    if (location && location !== '.' && !location.startsWith('http') && !/all\s+outlets/i.test(location)) {
      addresses.push(`${name}, ${location}`);
    }

    return {
      offer_id: offer.id || offer.unique_id || '',
      merchant_name: name,
      city: null,
      location: location,
      address: null,
      addresses: addresses,
      branches: [],
      phone: phone,
      promotion_details: offer.offer?.description || null
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Registry
// ═══════════════════════════════════════════════════════════════════════════

const ADAPTERS = {
  sampath: SampathAdapter,
  hnb: HNBAdapter,
  boc: BOCAdapter,
  peoples: PeoplesAdapter,
  seylan: SeylanAdapter,
  ndb: NDBAdapter
};

function getAdapter(bankName) {
  const AdapterClass = ADAPTERS[bankName.toLowerCase()];
  if (!AdapterClass) {
    throw new Error(`Unknown bank: ${bankName}. Available: ${Object.keys(ADAPTERS).join(', ')}`);
  }
  return new AdapterClass();
}

function listBanks() {
  return Object.keys(ADAPTERS);
}

module.exports = { getAdapter, listBanks, ADAPTERS };
