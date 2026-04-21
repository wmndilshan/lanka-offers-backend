const path = require('path');
const fs = require('fs');

const rootDir = path.join(process.cwd(), '..');

/**
 * Load all offers from JSON files in the output directory
 */
function loadAllOffers() {
  try {
    const outputDir = path.join(rootDir, 'output');

    if (!fs.existsSync(outputDir)) {
      console.warn('Output directory not found:', outputDir);
      return [];
    }

    const files = fs.readdirSync(outputDir);
    const jsonFiles = files.filter(file =>
      // Only include files that are likely to be main offer lists
      (file.endsWith('.json') && (file.includes('_all_') || file.includes('_offers'))) &&
      !file.includes('_geo') &&
      !file.includes('_raw') &&
      !file.includes('_validity')
    );

    const allOffers = [];

    jsonFiles.forEach(file => {
      try {
        const filePath = path.join(outputDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content);

        // Extract bank name from filename (e.g., hnb_all_v9.json -> hnb)
        // More robust extraction: get the first part before the first underscore
        let bank = file.split('_')[0].toLowerCase();
        
        // Manual overrides for known banks if needed
        const bankMap = {
          'peoples': "PEOPLE'S",
          'sampath': 'SAMPATH',
          'seylan': 'SEYLAN',
          'boc': 'BOC',
          'hnb': 'HNB',
          'ndb': 'NDB',
          'dfcc': 'DFCC',
          'pabc': 'PAN ASIA',
        };
        const normalizedBank = bankMap[bank] || bank.toUpperCase();

        // Handle different JSON structures
        let offers = [];
        if (Array.isArray(data)) {
          offers = data;
        } else if (data.offers && Array.isArray(data.offers)) {
          // Structured format with metadata
          offers = data.offers;
        } else if (data.results && Array.isArray(data.results)) {
          offers = data.results;
        } else {
          // Skip metadata files
          return;
        }

        // Normalize field names and add bank field
        const offersWithBank = offers.map(offer => ({
          ...offer,
          bank: normalizedBank,

          // Merchant name - normalize to 'merchant' for table
          merchant: offer.structured_data?.merchant_name ||
            offer.merchant_name ||
            offer.merchant?.name ||
            offer._raw_detail?.merchant ||
            offer.title ||
            'Unknown',

          // Category
          category: offer.category || 'N/A',

          // Discount
          discount: offer.discount ||
            (offer.structured_data?.discount_percentage ? `${offer.structured_data.discount_percentage}% off` : null) ||
            (offer.offer?.discount_percentage ? `${offer.offer.discount_percentage}% off` : null) ||
            (offer.merchant?.discount_percentage ? `${offer.merchant.discount_percentage}% off` : null) ||
            offer.short_discount ||
            'N/A',

          // Valid dates - check multiple sources including _raw fields
          validFrom: offer.valid_from ||
            offer._raw_validFrom ||
            offer.validity_periods?.[0]?.valid_from ||
            offer.validity?.[0]?.valid_from ||
            offer._raw_detail?.from ||
            null,

          validTo: offer.valid_to ||
            offer._raw_validUntil ||
            offer.validity_periods?.[0]?.valid_to ||
            offer.validity?.[0]?.valid_to ||
            offer._raw_detail?.to ||
            null,

          // Location type
          locationType: offer.location_type ||
            offer.locationType ||
            (offer.structured_data?.addresses?.length > 0 ? 'Multiple' : null) ||
            'N/A',
        }));

        allOffers.push(...offersWithBank);
      } catch (error) {
        console.error(`Error reading ${file}:`, error.message);
      }
    });

    return allOffers;
  } catch (error) {
    console.error('Error loading offers:', error);
    return [];
  }
}

/**
 * Load all geocoded data from *_geo.json files
 */
function loadGeoData() {
  try {
    const outputDir = path.join(rootDir, 'output');

    if (!fs.existsSync(outputDir)) {
      console.warn('Output directory not found:', outputDir);
      return [];
    }

    const files = fs.readdirSync(outputDir);
    const geoFiles = files.filter(file => file.endsWith('_geo.json'));

    // Load all offers to merge discount data
    const allOffers = loadAllOffers();
    const offersById = {};
    allOffers.forEach(offer => {
      if (offer.unique_id) {
        offersById[offer.unique_id] = offer;
      }
    });

    const allGeoData = [];

    geoFiles.forEach(file => {
      try {
        const filePath = path.join(outputDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content);

        // Extract bank name from filename (e.g., hnb_geo.json -> hnb)
        const bank = file.replace('_geo.json', '');

        // Handle geo JSON structure (has offers array with locations inside)
        let geoOffers = [];
        if (Array.isArray(data)) {
          geoOffers = data;
        } else if (data.offers && Array.isArray(data.offers)) {
          // Structured geo format with metadata
          geoOffers = data.offers;
        } else {
          return;
        }

        // Flatten locations from each offer
        geoOffers.forEach(offer => {
          if (offer.locations && Array.isArray(offer.locations)) {
            offer.locations.forEach(location => {
              // Find matching offer for discount info
              const matchingOffer = offersById[offer.offer_id];

              allGeoData.push({
                ...location,
                offer_id: offer.offer_id,
                // Normalize field names for MapView
                merchant: offer.merchant_name || 'Unknown Merchant',
                address: location.formatted_address || location.search_address || 'No address',
                locationType: offer.location_type || 'UNKNOWN',
                // Add discount from matching offer
                discount: matchingOffer?.discount || 'No discount info',
                category: matchingOffer?.category || 'N/A',
                // Keep original fields too
                merchant_name: offer.merchant_name,
                location_type: offer.location_type,
                bank: bank.toUpperCase()
              });
            });
          }
        });
      } catch (error) {
        console.error(`Error reading ${file}:`, error.message);
      }
    });

    return allGeoData;
  } catch (error) {
    console.error('Error loading geo data:', error);
    return [];
  }
}

/**
 * Calculate statistics from offers and geo data
 */
function getStats() {
  try {
    const offers = loadAllOffers();
    const geoData = loadGeoData();

    // Count unique locations
    const uniqueLocations = new Set();
    offers.forEach(offer => {
      if (offer.location) {
        uniqueLocations.add(JSON.stringify(offer.location));
      }
    });

    // Count banks with data
    const banksWithData = new Set();
    offers.forEach(offer => {
      if (offer.bank) {
        banksWithData.add(offer.bank);
      }
    });

    return {
      totalOffers: offers.length,
      totalLocations: geoData.length || uniqueLocations.size,
      banksCovered: banksWithData.size || 6,
      apiUsageThisMonth: geoData.length, // Approximation based on geocoded locations
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error calculating stats:', error);
    return {
      totalOffers: 0,
      totalLocations: 0,
      banksCovered: 6,
      apiUsageThisMonth: 0,
      lastUpdated: new Date().toISOString()
    };
  }
}

/**
 * Get list of supported banks
 */
function getBankList() {
  return ['hnb', 'boc', 'peoples', 'ndb', 'seylan', 'sampath'];
}

/**
 * Filter offers based on query parameters
 */
function filterOffers(offers, { bank, search, category } = {}) {
  let filtered = [...offers];

  if (bank && bank !== 'all') {
    filtered = filtered.filter(offer =>
      offer.bank && offer.bank.toLowerCase() === bank.toLowerCase()
    );
  }

  if (search) {
    const searchLower = search.toLowerCase();
    filtered = filtered.filter(offer =>
      (offer.merchant && offer.merchant.toLowerCase().includes(searchLower)) ||
      (offer.discount && offer.discount.toLowerCase().includes(searchLower)) ||
      (offer.category && offer.category.toLowerCase().includes(searchLower)) ||
      (offer.title && offer.title.toLowerCase().includes(searchLower))
    );
  }

  if (category && category !== 'all') {
    filtered = filtered.filter(offer =>
      offer.category && offer.category.toLowerCase() === category.toLowerCase()
    );
  }

  return filtered;
}

module.exports = {
  loadAllOffers,
  loadGeoData,
  getStats,
  getBankList,
  filterOffers
};
