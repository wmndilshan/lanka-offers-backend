/**
 * Address Extraction and Normalization Engine
 * 
 * Standardizes address extraction across different bank formats:
 * - HNB: Location: [Area]
 * - Seylan: Address: [Full Address]
 * - Sampath: [Location box] or Participating Outlets
 * - NDB: [Description embedded locations]
 */

const DISTRICTS = [
  'colombo', 'gampaha', 'kalutara', 'kandy', 'matale', 'nuwara eliya',
  'galle', 'matara', 'hambantota', 'jaffna', 'kilinochchi', 'mannar',
  'vavuniya', 'mullaitivu', 'batticaloa', 'ampara', 'trincomalee',
  'kurunegala', 'puttalam', 'anuradhapura', 'polonnaruwa', 'badulla',
  'moneragala', 'ratnapura', 'kejalle'
];

const COMMON_AREAS = [
  'colombo', 'kandy', 'galle', 'negombo', 'jaffna', 'matara', 'dambulla', 
  'nuwara eliya', 'habarana', 'sigiriya', 'ella', 'tissamaharama', 
  'welimada', 'marawila', 'kalutara', 'panadura', 'mount lavinia', 
  'ratnapura', 'batticaloa', 'trincomalee', 'kurunegala', 'anuradhapura', 
  'badulla', 'bentota', 'hikkaduwa', 'unawatuna', 'mirissa', 'weligama', 
  'tangalle', 'pasikuda', 'arugam bay', 'kollupitiya', 'bambalapitiya', 
  'wellawatte', 'dehiwala', 'mount lavinia', 'ratmalana', 'moratuwa', 
  'nawala', 'rajagiriya', 'kotte', 'battaramulla', 'pelawatte', 'thalawathugoda', 
  'malabe', 'kaduwela', 'nugegoda', 'maharagama', 'piliyandala', 'borella', 
  'cinnamon gardens', 'pettah', 'fort', 'slave island', 'kotahena', 
  'mattakkuliya', 'wattala', 'ja-ela', 'kadawatha', 'kiribathgoda', 
  'kelaniya', 'gampaha', 'veyangoda', 'minuwangoda', 'katunayake', 
  'seeduwa', 'ragama', 'kandana', 'horana', 'panadura', 'wadduwa', 
  'beruwala', 'aluthgama', 'induruwa', 'balapitiya', 'ambalangoda', 
  'gintota', 'karapitiya', 'habaraduwa', 'koggala', 'ahangama', 
  'dikwella', 'hambantota', 'beliatta', 'tangalle', 'kataragama', 
  'wellawaya', 'ella', 'bandarawela', 'diyatalawa', 'haputale', 
  'passara', 'mahiyanganaya', 'monaragala', 'ampara', 'akalmunai', 
  'sainthamaruthu', 'samanthurai', 'vavuniya', 'mullaitivu', 'kilinochchi', 
  'chavakachcheri', 'point pedro', 'kankesanthurai', 'manipay', 'nelliyady', 
  'mankulam', 'anuradhapura', 'kekirawa', 'thalawa', 'medawachchiya', 
  'nochiyaagama', 'galnewa', 'polonnaruwa', 'higurakgoda', 'minneriya', 
  'kaduruwela', 'bakamoona', 'dambulla', 'sigiriya', 'habarana', 'matale', 
  'naula', 'raththota', 'pallepola', 'peradeniya', 'gampola', 'nawalapitiya', 
  'hatton', 'dikoya', 'talawakele', 'maskeliya', 'ragala', 'walapane', 
  'padiyapelella', 'kadugannawa', 'pilimathalawa', 'gelioya', 'digana', 
  'kundasale', 'menikhinna', 'watthegama', 'madawala', 'akurana', 
  'katugastota', 'matale', 'galewela', 'kekirawa', 'dambulla', 'habarana', 
  'anuradhapura', 'mihintale', 'medawachchiya', 'vavuniya', 'mannar', 
  'mullaitivu', 'kilinochchi', 'jaffna', 'point pedro', 'chavakachcheri'
];

class AddressEngine {
  /**
   * Main entry point to extract addresses from a raw text string
   */
  static extract(text, merchantName = '') {
    if (!text) return [];

    const addresses = [];
    const cleanedText = text.replace(/\s+/g, ' ').trim();

    // 1. Look for explicit markers
    const explicitMarkers = [
      { regex: /Address\s*:\s*([^;.]+)/i, type: 'single' },
      { regex: /Location\s*:\s*([^;.]+)/i, type: 'list' },
      { regex: /Available\s+at\s*:\s*([^;.]+)/i, type: 'list' },
      { regex: /Participating\s+Outlets\s*:\s*([^;.]+)/i, type: 'list' },
      { regex: /Outlets\s*:\s*([^;.]+)/i, type: 'list' },
      { regex: /Branch(?:es)?\s*:\s*([^;.]+)/i, type: 'list' }
    ];

    let foundByMarker = false;
    for (const marker of explicitMarkers) {
      const match = cleanedText.match(marker.regex);
      if (match) {
        const content = match[1].trim();
        if (this.isLikelyAddress(content)) {
          const parts = marker.type === 'list' ? this.split(content) : [content];
          parts.forEach(p => {
            const normalized = this.normalize(p, merchantName);
            if (normalized) addresses.push(normalized);
          });
          foundByMarker = true;
          // Don't break if it's just one type, might find more markers
        }
      }
    }

    // 2. If no marker or marker content was invalid, search for city names in the text
    if (!foundByMarker) {
      const detectedCities = this.detectCities(cleanedText);
      if (detectedCities.length > 0) {
        detectedCities.forEach(city => {
          const normalized = this.normalize(city, merchantName);
          if (normalized) addresses.push(normalized);
        });
      }
    }

    // 3. Fallback: Just merchant name
    if (addresses.length === 0 && merchantName) {
      addresses.push(`${merchantName}, Sri Lanka`);
    }

    return [...new Set(addresses)];
  }

  /**
   * Split a string into individual addresses
   */
  static split(text) {
    if (!text) return [];
    
    // If it looks like a single detailed address with road and city, don't split by comma
    if (/\d+.*road|street|place|lane/i.test(text) && (text.match(/,/g) || []).length <= 2) {
      return [text.trim()];
    }

    // Split by common delimiters
    return text.split(/(?:(?:&|and|\||\n)\s*|,\s*(?=[A-Z0-9]))/i)
      .map(p => p.trim())
      .filter(p => p.length > 2);
  }

  /**
   * Clean and normalize a single address component
   */
  static normalize(address, merchantName = '') {
    if (!address) return null;

    let cleaned = address
      .replace(/^(?:Location|Address|Available at|Outlets|Branch|Branches)\s*[:\-]\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Remove contact info labels
    cleaned = cleaned.replace(/(?:Contact|Tel|Phone|Reservations?|Website|Web|Email|Emailing)\s*(?:No)?\s*[:\-]?\s*.*$/i, '').trim();

    // Remove phone numbers: 011-2345678, +94 11 2345678, etc.
    cleaned = cleaned.replace(/(?:\+94|0)\s?\d{2}\s?\d{7}/g, '')
      .replace(/\d{9,12}/g, '')
      .trim();

    // Remove URLs
    cleaned = cleaned.replace(/https?:\/\/\S+/gi, '').trim();

    // Remove trailing separators
    cleaned = cleaned.replace(/[,\.\s]+$/, '').trim();

    if (cleaned.length < 3) return null;

    // Don't geocode generic instructions
    if (/valid\s+on|click\s+here|visit\s+website|terms\s+and\s+conditions/i.test(cleaned)) {
      return null;
    }

    // Ensure Sri Lanka is present
    if (!cleaned.toLowerCase().includes('sri lanka')) {
      cleaned += ', Sri Lanka';
    }

    // If it's just a city, prepend merchant name
    if (COMMON_AREAS.includes(cleaned.split(',')[0].toLowerCase().trim())) {
      if (merchantName && !cleaned.toLowerCase().includes(merchantName.toLowerCase())) {
        cleaned = `${merchantName}, ${cleaned}`;
      }
    }

    return cleaned;
  }

  /**
   * Heuristic to check if a string is likely an address or just text
   */
  static isLikelyAddress(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    
    // If it contains "Valid on", "Discount", etc., it's probably not an address
    if (/valid\s+on|discount|%|off|minimum|spend|eligible|cards/i.test(lower)) {
      // Unless it also contains a common city name and is short
      const cities = this.detectCities(text);
      if (cities.length > 0 && text.length < 100) return true;
      return false;
    }

    return text.length > 3 && text.length < 200;
  }

  /**
   * Find city names in a block of text
   */
  static detectCities(text) {
    const lower = text.toLowerCase();
    const found = [];
    
    // Sort cities by length descending to match "Mount Lavinia" before "Lavinia"
    const sortedCities = [...COMMON_AREAS].sort((a, b) => b.length - a.length);

    for (const city of sortedCities) {
      const regex = new RegExp(`\\b${city}\\b`, 'i');
      if (regex.test(lower)) {
        found.push(city.charAt(0).toUpperCase() + city.slice(1));
        // Once a city is found, don't look for sub-matches if they are part of this city
        // (already handled by sorting by length)
      }
    }

    return [...new Set(found)];
  }
}

module.exports = AddressEngine;
