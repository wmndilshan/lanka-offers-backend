// Test BOC parsing with the Siddhalepa example

/**
 * Parse location from detail page text
 * Handles formats like: "Location : No 106A, Templers Road, Mt. Lavinia - Contact No : ..."
 */
function parseLocation(descriptionLines) {
  for (const line of descriptionLines) {
    // Pattern: "Location : ADDRESS" or "Location: ADDRESS" or just "ADDRESS - Contact No:"
    const locationMatch = line.match(/(?:Location\s*:\s*)([^-]+?)(?:\s*-\s*Contact|\s*$)/i);
    if (locationMatch) {
      return locationMatch[1].trim();
    }

    // Alternative: look for address-like patterns (with "No" or street names)
    if (/No\s+\d+[A-Z]?,/.test(line) || /Road|Street|Avenue|Lane/i.test(line)) {
      // Extract before "Contact" if present
      const beforeContact = line.split(/Contact\s*(?:No)?:/i)[0].trim();
      if (beforeContact.length > 5 && beforeContact.length < 200) {
        return beforeContact.replace(/^Location\s*:\s*/i, '').trim();
      }
    }
  }
  return null;
}

/**
 * Parse contact numbers from detail page text
 * Handles formats like: "Contact No : 077 371 0139 / 011 273 8622"
 */
function parseContactNumbers(descriptionLines) {
  const contacts = [];

  for (const line of descriptionLines) {
    // Pattern: "Contact No : NUMBERS" or "Contact: NUMBERS"
    const contactMatch = line.match(/Contact\s*(?:No)?:\s*([0-9\s/,]+)/i);
    if (contactMatch) {
      const numbersText = contactMatch[1].trim();
      // Split by / or , and clean each number
      const numbers = numbersText.split(/[\/,]/)
        .map(n => n.trim().replace(/\s+/g, ' '))
        .filter(n => n.match(/\d{7,}/)); // At least 7 digits
      contacts.push(...numbers);
    }

    // Also extract phone numbers from anywhere in the line
    const phoneMatches = line.match(/\b\d{3}\s*\d{3}\s*\d{4}\b|\b\d{2}\s*\d{3}\s*\d{4}\b/g);
    if (phoneMatches) {
      phoneMatches.forEach(p => {
        const cleaned = p.replace(/\s+/g, ' ').trim();
        if (!contacts.includes(cleaned)) contacts.push(cleaned);
      });
    }
  }

  return [...new Set(contacts)]; // Remove duplicates
}

// Test with the Siddhalepa Ayurveda Hospital example
const testData = {
  merchantName: "Siddhalepa Ayurveda Hospital",
  discount: "20% OFF*",
  description: "20% discount on room rates for in-patients when paying with a BOC credit card",
  detailText: [
    "20% discount on room rates for in-patients when paying with a BOC credit card",
    "Location : No 106A, Templers Road, Mt. Lavinia - Contact No : 077 371 0139 / 011 273 8622",
    "*Conditions apply."
  ]
};

console.log('═══════════════════════════════════════════════════════════');
console.log('BOC-6 Parser Test: Siddhalepa Ayurveda Hospital');
console.log('═══════════════════════════════════════════════════════════\n');

console.log('Input Data:');
console.log(`  Merchant: ${testData.merchantName}`);
console.log(`  Discount: ${testData.discount}`);
console.log(`  Detail Text:`);
testData.detailText.forEach((line, i) => {
  console.log(`    ${i + 1}. "${line}"`);
});

console.log('\n───────────────────────────────────────────────────────────\n');

// Parse location
const fullAddress = parseLocation(testData.detailText);
console.log('Parsed Location:');
console.log(`  ✅ Full Address: "${fullAddress}"`);

// Parse contacts
const contactNumbers = parseContactNumbers(testData.detailText);
console.log('\nParsed Contact Numbers:');
contactNumbers.forEach((number, i) => {
  console.log(`  ✅ Contact ${i + 1}: "${number}"`);
});

console.log('\n───────────────────────────────────────────────────────────\n');

console.log('Final Merchant Object:');
console.log({
  name: testData.merchantName,
  full_address: fullAddress,
  location_name: testData.merchantName,
  contact_numbers: contactNumbers,
  primary_contact: contactNumbers[0] || null
});

console.log('\n═══════════════════════════════════════════════════════════');
console.log('✅ Parsing Test Complete!');
console.log('═══════════════════════════════════════════════════════════');
