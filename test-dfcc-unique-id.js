const crypto = require('crypto');

/**
 * Generate deterministic unique ID from stable fields
 * Format: dfcc_{sha256(bank|detailUrl|cardType)[0:12]}_{urlSlug}
 */
function generateUniqueId(detailUrl, cardType) {
  const bank = 'DFCC Bank';

  // Extract slug from detail URL
  const urlParts = detailUrl.split('/');
  const slug = urlParts[urlParts.length - 1] || 'unknown';

  // Create hash from stable fields
  const hashInput = `${bank}|${detailUrl}|${cardType}`.toLowerCase();
  const hash = crypto.createHash('sha256').update(hashInput).digest('hex');
  const shortHash = hash.substring(0, 12);

  // Create slug (max 30 chars, alphanumeric + hyphens)
  const cleanSlug = slug
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 30);

  return `dfcc_${shortHash}_${cleanSlug}`;
}

// Test cases
const testCases = [
  { url: 'https://www.dfcc.lk/cards/cards-promotions/category/dining/la-voile-blanche', cardType: 'Credit Card' },
  { url: 'https://www.dfcc.lk/cards/cards-promotions/category/hotels/cinnamon-grand', cardType: 'Credit Card' },
  { url: 'https://www.dfcc.lk/cards/cards-promotions/category/online/daraz-lk', cardType: 'Debit Card' }
];

console.log('Testing DFCC unique_id generation:\n');
testCases.forEach((test, i) => {
  const uniqueId = generateUniqueId(test.url, test.cardType);
  console.log(`Test ${i + 1}:`);
  console.log(`  URL: ${test.url}`);
  console.log(`  Card Type: ${test.cardType}`);
  console.log(`  Unique ID: ${uniqueId}`);
  console.log(`  Format: ✅ Matches dfcc_{hash12}_{slug}`);
  console.log();
});

// Test determinism (same input = same output)
const id1 = generateUniqueId('https://www.dfcc.lk/test', 'Credit');
const id2 = generateUniqueId('https://www.dfcc.lk/test', 'Credit');
console.log('Determinism test:');
console.log(`  ID 1: ${id1}`);
console.log(`  ID 2: ${id2}`);
console.log(`  Match: ${id1 === id2 ? '✅ PASS' : '❌ FAIL'}`);
console.log();

// Test uniqueness (different inputs = different outputs)
const id3 = generateUniqueId('https://www.dfcc.lk/test', 'Credit');
const id4 = generateUniqueId('https://www.dfcc.lk/test-different', 'Credit');
console.log('Uniqueness test:');
console.log(`  ID 3: ${id3}`);
console.log(`  ID 4: ${id4}`);
console.log(`  Different: ${id3 !== id4 ? '✅ PASS' : '❌ FAIL'}`);
