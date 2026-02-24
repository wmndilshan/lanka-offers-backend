const GEMINI_API_KEY = 'AIzaSyDZV7yRYkn2qLL6ZnjMb69WWA3a5NChND4';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent';

/**
 * Extract and normalize offer data for SQL database storage
 * Optimized for offer promotion platform with data validation
 */
async function extractOfferDataWithLLM(offerData) {
  const prompt = `You are a precise data extraction system for a promotional offers platform. Extract and normalize ALL information from this offer data for database storage.

INPUT DATA:
Title: ${offerData.title}
Merchant: ${offerData.merchant}
Valid From: ${offerData.from}
Valid To: ${offerData.to}
Card Type: ${offerData.cardType}
Thumbnail: ${offerData.thumb}

HTML Content:
${offerData.content}

CRITICAL INSTRUCTIONS:
1. Extract dates in YYYY-MM-DD format ONLY
2. Extract percentage discounts as numbers (e.g., "30" not "30%")
3. Clean phone numbers to digits only (e.g., "0117247325")
4. Remove ALL HTML tags and decode HTML entities (&#x2F; becomes /)
5. Normalize text: trim whitespace, fix spacing
6. Extract monetary values as numbers where applicable
7. Identify offer categories and tags

Return ONLY valid JSON with this EXACT structure:

{
  "merchant": {
    "name": "exact merchant name",
    "location": "location",
    "category": "hotel/restaurant/spa/retail/etc"
  },
  "offer": {
    "title": "clear offer title",
    "description": "brief 1-2 sentence summary",
    "offerType": "discount/cashback/voucher/package/points",
    "validFrom": "YYYY-MM-DD",
    "validTo": "YYYY-MM-DD",
    "thumbnail": "thumbnail path"
  },
  "discounts": [
    {
      "type": "percentage/fixed/package",
      "value": 30,
      "conditions": "weekday/weekend/all days",
      "days": ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
      "description": "Special discount for Full board, double sharing basis per night stay"
    }
  ],
  "eligibility": {
    "cardTypes": ["credit", "debit"],
    "cardBrands": ["mastercard", "visa"],
    "bankName": "Hatton National Bank PLC",
    "specificCards": "All HNB Credit / Debit Cards"
  },
  "booking": {
    "bookingStartDate": "YYYY-MM-DD or null",
    "bookingEndDate": "YYYY-MM-DD or null",
    "stayStartDate": "YYYY-MM-DD or null",
    "stayEndDate": "YYYY-MM-DD or null",
    "advanceBookingRequired": true/false,
    "fullPaymentRequired": true/false
  },
  "contact": {
    "phoneNumbers": ["0117247325"],
    "bookingMethod": "call center/online/walk-in",
    "bookingPartner": "partner name if any",
    "website": "url if mentioned",
    "email": "email if mentioned"
  },
  "terms": {
    "isRefundable": false,
    "isCancellable": false,
    "allowsDateChanges": true,
    "dateChangePenalty": true/false,
    "corporateBookings": false,
    "groupBookings": false,
    "combinableWithOtherOffers": false,
    "basisType": "rack rate/discounted rate/other"
  },
  "restrictions": [
    "list each restriction as a clear statement"
  ],
  "specialConditions": [
    "any special conditions that customers should know"
  ],
  "tags": [
    "hotel", "weekend-special", "family-friendly", etc
  ]
}

VALIDATION RULES:
- All dates must be in YYYY-MM-DD format or null
- Phone numbers should be clean (digits only)
- Percentages as numbers without % symbol
- Boolean values must be true/false, not strings
- Arrays cannot be empty - use null instead
- Ensure merchant category is one of: hotel, restaurant, spa, retail, entertainment, travel, health, education, other`;

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.1,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 4096,
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Gemini API error: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    
    if (!data.candidates || !data.candidates[0]) {
      throw new Error(`No response from Gemini API. Full response: ${JSON.stringify(data)}`);
    }
    
    if (!data.candidates[0].content || !data.candidates[0].content.parts) {
      throw new Error(`Invalid response structure. Response: ${JSON.stringify(data.candidates[0])}`);
    }
    
    const generatedText = data.candidates[0].content.parts[0].text;
    
    // Clean up the response
    const cleanedText = generatedText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    const extractedData = JSON.parse(cleanedText);
    
    // Post-process and validate
    const normalizedData = normalizeExtractedData(extractedData, offerData);
    
    return normalizedData;
    
  } catch (error) {
    console.error('❌ LLM extraction failed:', error);
    throw error;
  }
}

/**
 * Normalize and validate extracted data
 */
function normalizeExtractedData(data, originalData) {
  // Generate unique ID
  const offerId = generateOfferId(data.merchant.name, data.offer.validFrom);
  
  // Add metadata
  const normalized = {
    id: offerId,
    ...data,
    metadata: {
      extractedAt: new Date().toISOString(),
      source: 'gemini-llm',
      originalTitle: originalData.title,
      assets: originalData.assets || [],
      dataQuality: calculateDataQuality(data),
      requiresReview: requiresManualReview(data)
    }
  };
  
  return normalized;
}

/**
 * Generate unique offer ID
 */
function generateOfferId(merchantName, validFrom) {
  const cleanMerchant = merchantName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 30);
  
  const timestamp = validFrom ? validFrom.replace(/-/g, '') : Date.now();
  
  return `${cleanMerchant}-${timestamp}`;
}

/**
 * Calculate data quality score (0-100)
 */
function calculateDataQuality(data) {
  let score = 0;
  const checks = [
    { field: data.merchant?.name, weight: 15 },
    { field: data.merchant?.location, weight: 10 },
    { field: data.offer?.title, weight: 15 },
    { field: data.offer?.validFrom, weight: 10 },
    { field: data.offer?.validTo, weight: 10 },
    { field: data.discounts?.length > 0, weight: 15 },
    { field: data.contact?.phoneNumbers?.length > 0, weight: 10 },
    { field: data.eligibility?.cardTypes?.length > 0, weight: 5 },
    { field: data.tags?.length > 0, weight: 5 },
    { field: data.terms, weight: 5 }
  ];
  
  checks.forEach(check => {
    if (check.field) score += check.weight;
  });
  
  return score;
}

/**
 * Check if offer requires manual review
 */
function requiresManualReview(data) {
  const issues = [];
  
  // Check for missing critical fields
  if (!data.merchant?.name) issues.push('missing_merchant');
  if (!data.offer?.validTo) issues.push('missing_end_date');
  if (!data.discounts || data.discounts.length === 0) issues.push('missing_discounts');
  if (!data.contact?.phoneNumbers || data.contact.phoneNumbers.length === 0) {
    issues.push('missing_contact');
  }
  
  // Check date validity
  if (data.offer?.validFrom && data.offer?.validTo) {
    if (new Date(data.offer.validFrom) > new Date(data.offer.validTo)) {
      issues.push('invalid_date_range');
    }
  }
  
  return {
    required: issues.length > 0,
    issues: issues,
    confidence: issues.length === 0 ? 'high' : issues.length <= 2 ? 'medium' : 'low'
  };
}

/**
 * Generate SQL-ready format
 */
function generateSQLInserts(extractedData) {
  const sql = {
    // Main offers table
    offers: {
      id: extractedData.id,
      merchant_name: extractedData.merchant.name,
      merchant_location: extractedData.merchant.location,
      merchant_category: extractedData.merchant.category,
      title: extractedData.offer.title,
      description: extractedData.offer.description,
      offer_type: extractedData.offer.offerType,
      valid_from: extractedData.offer.validFrom,
      valid_to: extractedData.offer.validTo,
      thumbnail: extractedData.offer.thumbnail,
      is_active: true,
      data_quality_score: extractedData.metadata.dataQuality,
      requires_review: extractedData.metadata.requiresReview.required,
      created_at: extractedData.metadata.extractedAt
    },
    
    // Discounts table (one-to-many)
    discounts: extractedData.discounts?.map((discount, index) => ({
      id: `${extractedData.id}-discount-${index}`,
      offer_id: extractedData.id,
      type: discount.type,
      value: discount.value,
      conditions: discount.conditions,
      days: JSON.stringify(discount.days),
      description: discount.description
    })) || [],
    
    // Contact info table
    contacts: {
      offer_id: extractedData.id,
      phone_numbers: JSON.stringify(extractedData.contact?.phoneNumbers || []),
      booking_method: extractedData.contact?.bookingMethod,
      booking_partner: extractedData.contact?.bookingPartner,
      website: extractedData.contact?.website,
      email: extractedData.contact?.email
    },
    
    // Tags table (many-to-many)
    tags: extractedData.tags?.map(tag => ({
      offer_id: extractedData.id,
      tag: tag
    })) || []
  };
  
  return sql;
}

/**
 * Process single offer
 */
async function processOffer(offerData) {
  console.log('\n🔄 Processing offer with Gemini LLM...');
  console.log('📝 Merchant:', offerData.merchant);
  
  try {
    const extracted = await extractOfferDataWithLLM(offerData);
    
    console.log('✅ Extraction complete!');
    console.log('📊 Data Quality Score:', extracted.metadata.dataQuality + '%');
    console.log('🔍 Requires Review:', extracted.metadata.requiresReview.required ? 
      `YES (${extracted.metadata.requiresReview.confidence} confidence)` : 'NO');
    
    if (extracted.metadata.requiresReview.required) {
      console.log('⚠️  Issues:', extracted.metadata.requiresReview.issues.join(', '));
    }
    
    return extracted;
  } catch (error) {
    console.error('❌ Failed to process offer:', error.message);
    throw error;
  }
}

/**
 * Process and export for database
 */
async function processOfferForDatabase(offerData) {
  const extracted = await processOffer(offerData);
  const sqlData = generateSQLInserts(extracted);
  
  return {
    extracted: extracted,
    sql: sqlData,
    readyForInsert: !extracted.metadata.requiresReview.required
  };
}

// ============================================
// EXAMPLE USAGE
// ============================================

const sampleOffer = {
  "title": "Special discount for selected room categories at Anantaya Resorts & Spa - Chilaw",
  "thumb": "merchants/ Anantaya Resort & Spa, Chilaw/AnantayaResort&Spa,Chilaw.jpg",
  "from": "2025-11-30",
  "to": "2025-11-30",
  "valid": "Valid until",
  "cardType": "credit/debit",
  "content": "<p><strong>Merchant: </strong>Anantaya Resorts &amp; Spa - Chilaw<br/><br/><strong>Offer:</strong></p><ul><li>Special discount for Full board, double sharing basis per night stay (Sunday to Thursday)</li><li>30% off on FB, HB &amp; BB basis for Friday, Saturday &amp; Long Weekends</li></ul><p>          (Valid from rack rate basis)<br/><br/><strong>Period:</strong></p><ul><li>Booking period: Till 30th November 2025</li><li>Staying Period: Till 31st December 2025</li></ul><p><br/><strong>Eligibility:</strong> All HNB Credit &#x2F; Debit Cards<br/><br/><strong>Reservations:</strong> <a href=\"tel:0117247325\" target=\"_blank\">0117247325</a><br/><br/><strong>Location: </strong>Chilaw<br/><br/><strong>Special Terms and Conditions:</strong></p><ul><li>This offer cannot be combined with any other promotions or discounts.</li><li>The offer is not valid for corporate or group bookings.</li><li>All bookings are strictly non-refundable and non-cancellable.</li><li>Date changes are permitted subject to a penalty fee.</li><li>Bookings will be confirmed only upon receipt of full advance payment.</li><li>All reservations must be made exclusively through the Findmyfare Call Centre at <a href=\"tel:0117247325\" target=\"_blank\">011 724 7325</a>.</li></ul><p> <br/><strong>General Terms and Conditions:</strong></p><ul><li>The promotions are open to all holders of Mastercard and Visa Credit &#x2F; Debit Cards issued by Hatton National Bank PLC.</li><li>The card member(s) is&#x2F;are to settle the total bill via their HNB Mastercard and Visa Credit &#x2F; Debit Card to be eligible for the discount offered.</li><li>The offers cannot be exchanged for cash and&#x2F;or used in conjunction with any other promotional programs or offers provided by service establishment involved in this promotion.</li><li>Hatton National Bank PLC reserves the right to withdraw, modify or change all or any of the rules, terms &amp; conditions applicable to this promotion at any given time without prior notice.</li><li>If any dispute arises regarding any of the terms and conditions contained herewith, the decision of the respective service establishment and Hatton National Bank PLC shall be final.</li><li>The promotion is bound by the terms &amp; conditions of the respective service establishment and Hatton National Bank PLC.</li><li>Hatton National Bank PLC accepts no liability for the quality of goods and services provided by the service establishments involved in this promotion since the Bank is not the supplier of such goods and services.</li><li>The General Credit &#x2F; Debit card terms and conditions will continue to apply.</li></ul>",
  "merchant": " Anantaya Resort & Spa, Chilaw",
  "assets": []
};

// Process for database
processOfferForDatabase(sampleOffer)
  .then(result => {
    console.log('\n' + '='.repeat(60));
    console.log('📊 NORMALIZED DATA (DATABASE-READY):');
    console.log('='.repeat(60));
    console.log(JSON.stringify(result.extracted, null, 2));
    
    console.log('\n' + '='.repeat(60));
    console.log('💾 SQL INSERT DATA:');
    console.log('='.repeat(60));
    console.log(JSON.stringify(result.sql, null, 2));
    
    console.log('\n' + '='.repeat(60));
    console.log('✓ Ready for database insert:', result.readyForInsert ? 'YES ✅' : 'NO - Needs Review ⚠️');
    console.log('='.repeat(60));
  })
  .catch(error => {
    console.error('Failed:', error);
  });