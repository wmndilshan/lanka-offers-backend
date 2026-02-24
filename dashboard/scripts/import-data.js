/**
 * Data Import Script
 * Imports scraped JSON data into Neon PostgreSQL database
 * 
 * Usage: node scripts/import-data.js
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const prisma = new PrismaClient();

// Add connection check
async function checkConnection() {
    try {
        await prisma.$connect();
        console.log('✅ Connected to database successfully');
    } catch (error) {
        console.error('❌ Failed to connect to database:', error);
        process.exit(1);
    }
}
checkConnection();

/**
 * Parse percentage string to float
 * Handles: "15%", "Up to 40%", "15", 15, null
 */
function parsePercentage(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    // Already a number
    if (typeof value === 'number') {
        return value;
    }

    // Convert to string and clean
    const str = String(value).trim();

    // Extract number from patterns like "Up to 40%", "15%", "40"
    const match = str.match(/(\d+(?:\.\d+)?)/);

    if (match) {
        const num = parseFloat(match[1]);
        return isNaN(num) ? null : num;
    }

    return null;
}

// Track statistics
const stats = {
    offersProcessed: 0,
    offersInserted: 0,
    offersSkipped: 0,
    locationsInserted: 0,
    rawDataInserted: 0,
    errors: []
};

/**
 * Parse and transform offer data from JSON to Prisma format
 */
function transformOffer(offer, bank) {
    return {
        unique_id: offer.unique_id,
        source_id: offer.source_id,
        source: offer.source || bank.toUpperCase(),
        category: offer.category,
        categoryId: offer.category_id,
        title: offer.title,
        cardType: offer.card_type,
        scrapedAt: offer.scraped_at ? new Date(offer.scraped_at) : new Date(),

        // Curation fields - default to pending
        reviewStatus: 'pending',
        isInProduction: false,

        // Structured data fields
        merchantName: offer.merchant?.name || offer.structured_data?.merchant_name || offer.merchant_name || null,
        discountPercentage: parsePercentage(offer.structured_data?.discount_percentage),
        discountDescription: offer.structured_data?.discount_description || '',
        applicableCards: offer.structured_data?.applicable_cards || [],
        validFrom: offer.validity_periods?.[0]?.valid_from ? new Date(offer.validity_periods[0].valid_from) :
            (offer._raw_validFrom ? new Date(offer._raw_validFrom) :
                (offer.structured_data?.valid_from ? new Date(offer.structured_data.valid_from) : null)),
        validTo: offer.validity_periods?.[0]?.valid_to ? new Date(offer.validity_periods[0].valid_to) :
            (offer._raw_validUntil ? new Date(offer._raw_validUntil) :
                (offer.structured_data?.valid_until ? new Date(offer.structured_data.valid_until) : null)),
        contactPhone: offer.structured_data?.contact_phone || [],
        contactEmail: offer.structured_data?.contact_email || [],
        bookingRequired: offer.structured_data?.booking_required || false,
        keyRestrictions: offer.structured_data?.key_restrictions || [],
        daysApplicable: offer.structured_data?.days_applicable || null,
        specialConditions: offer.structured_data?.special_conditions || [],
    };
}

/**
 * Import structured offers from a single JSON file
 */
async function importStructuredOffers(filePath, bank) {
    console.log(`\n📂 Processing ${path.basename(filePath)}...`);

    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content);

        const offers = data.offers || [];
        console.log(`   Found ${offers.length} offers`);

        for (const offer of offers) {
            stats.offersProcessed++;

            try {
                // ─── Atomic upsert: prevents duplicate inserts ──────────────
                // Using upsert on unique_id (DB UNIQUE constraint) is the only
                // race-condition-safe way to prevent duplicates. The old pattern
                // (findUnique → skip OR create) had a TOCTOU race: two concurrent
                // scraper runs could both pass the findUnique check and both insert.
                const offerData = transformOffer(offer, bank);

                const isNew = !(await prisma.offer.findUnique({ where: { unique_id: offer.unique_id }, select: { id: true } }));

                await prisma.offer.upsert({
                    where: { unique_id: offer.unique_id },
                    // On first insert: create with rawData and all fields
                    create: {
                        ...offerData,
                        rawData: {
                            create: {
                                rawValidFrom: offer._raw_validFrom || null,
                                rawValidUntil: offer._raw_validUntil || null,
                                rawHtmlContent: offer._raw_htmlContent || offer._raw_detail?.content || null,
                                rawListItem: offer._raw_list_item || null,
                                rawDetail: offer._raw_detail || null,
                            }
                        }
                    },
                    // On conflict: update mutable fields only — keep reviewStatus, don't overwrite human edits
                    update: {
                        scrapedAt: offerData.scrapedAt,
                        title: offerData.title,
                        merchantName: offerData.merchantName,
                        discountPercentage: offerData.discountPercentage,
                        discountDescription: offerData.discountDescription,
                        validFrom: offerData.validFrom,
                        validTo: offerData.validTo,
                        applicableCards: offerData.applicableCards,
                        contactPhone: offerData.contactPhone,
                        keyRestrictions: offerData.keyRestrictions,
                        daysApplicable: offerData.daysApplicable,
                        // NOTE: reviewStatus is intentionally NOT updated — preserve curator decisions
                    }
                });

                if (isNew) {
                    stats.offersInserted++;
                    stats.rawDataInserted++;
                } else {
                    stats.offersSkipped++;
                    console.log(`   ↻ Updated: ${offer.unique_id}`);
                }

            } catch (error) {
                stats.errors.push({
                    file: path.basename(filePath),
                    offer_id: offer.unique_id,
                    error: error.message
                });
                console.error(`   ❌ Error inserting offer ${offer.unique_id}:`, error.message);
            }
        }

    } catch (error) {
        console.error(`   ❌ Error reading file:`, error.message);
        stats.errors.push({
            file: path.basename(filePath),
            error: error.message
        });
    }
}

/**
 * Import geocoded locations from geo JSON files
 */
async function importGeoLocations(filePath, bank) {
    console.log(`\n🗺️  Processing ${path.basename(filePath)}...`);

    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content);

        const geoOffers = Array.isArray(data) ? data : (data.offers || []);
        console.log(`   Found ${geoOffers.length} offers with locations`);

        for (const geoOffer of geoOffers) {
            if (!geoOffer.locations || geoOffer.locations.length === 0) {
                continue;
            }

            try {
                // Find the corresponding offer in database
                const offer = await prisma.offer.findUnique({
                    where: { unique_id: geoOffer.offer_id }
                });

                if (!offer) {
                    console.log(`   ⚠️  Offer ${geoOffer.offer_id} not found in database, skipping locations`);
                    continue;
                }

                // Insert locations
                for (const location of geoOffer.locations) {
                    if (!location.latitude || !location.longitude) {
                        continue;
                    }

                    // Create PostGIS geography point
                    const geographyPoint = `SRID=4326;POINT(${location.longitude} ${location.latitude})`;

                    await prisma.$executeRawUnsafe(`
            INSERT INTO locations (
              id, offer_id, geography, latitude, longitude,
              source, success, search_address, formatted_address, place_id,
              types, location_type, branch_name, address_components, timestamp, created_at
            ) VALUES (
              gen_random_uuid(), $1, ST_GeogFromText($2), $3, $4,
              $5, $6, $7, $8, $9,
              $10, $11, $12, $13::jsonb, $14, NOW()
            )
          `,
                        offer.id,
                        geographyPoint,
                        location.latitude,
                        location.longitude,
                        location.source || 'geocoding_api',
                        location.success !== false,
                        location.search_address || location.formattedAddress || null,
                        location.formatted_address || location.formattedAddress || null,
                        location.placeId || location.place_id || null,
                        location.types || [],
                        geoOffer.location_type || 'UNKNOWN',
                        location.branch_name || null,
                        JSON.stringify(location.address_components || location.addressComponents || null),
                        location.timestamp ? new Date(location.timestamp) : null
                    );

                    stats.locationsInserted++;
                }

            } catch (error) {
                console.error(`   ❌ Error inserting locations for ${geoOffer.offer_id}:`, error.message);
                stats.errors.push({
                    file: path.basename(filePath),
                    offer_id: geoOffer.offer_id,
                    error: error.message
                });
            }
        }

    } catch (error) {
        console.error(`   ❌ Error reading file:`, error.message);
        stats.errors.push({
            file: path.basename(filePath),
            error: error.message
        });
    }
}

/**
 * Main import function
 */
async function importAllData() {
    console.log('🚀 Starting data import to Neon PostgreSQL...\n');
    console.log('Database:', process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] || 'Unknown');
    console.log('='.repeat(60));

    const outputDir = path.join(__dirname, '..', '..', 'output');

    if (!fs.existsSync(outputDir)) {
        console.error('❌ Output directory not found:', outputDir);
        process.exit(1);
    }

    const files = fs.readdirSync(outputDir);
    const structuredFiles = files.filter(f => f.endsWith('_structured.json'));
    const geoFiles = files.filter(f => f.endsWith('_geo.json'));

    console.log(`\n📊 Found ${structuredFiles.length} structured files and ${geoFiles.length} geo files\n`);

    // Step 1: Import structured offers first
    console.log('STEP 1: Importing structured offers...');
    console.log('='.repeat(60));

    for (const file of structuredFiles) {
        const bank = file.replace('_structured.json', '');
        const filePath = path.join(outputDir, file);
        await importStructuredOffers(filePath, bank);
    }

    // Step 2: Import geo locations
    console.log('\n\nSTEP 2: Importing geolocation data...');
    console.log('='.repeat(60));

    for (const file of geoFiles) {
        const bank = file.replace('_geo.json', '');
        const filePath = path.join(outputDir, file);
        await importGeoLocations(filePath, bank);
    }

    // Print statistics
    console.log('\n\n');
    console.log('='.repeat(60));
    console.log('📊 IMPORT COMPLETE - Statistics');
    console.log('='.repeat(60));
    console.log(`✅ Offers processed: ${stats.offersProcessed}`);
    console.log(`✅ Offers inserted: ${stats.offersInserted}`);
    console.log(`⏭️  Offers skipped: ${stats.offersSkipped}(duplicates)`);
    console.log(`📍 Locations inserted: ${stats.locationsInserted}`);
    console.log(`📝 Raw data records: ${stats.rawDataInserted}`);
    console.log(`❌ Errors: ${stats.errors.length}`);

    if (stats.errors.length > 0) {
        console.log('\nErrors:');
        stats.errors.slice(0, 10).forEach((err, i) => {
            console.log(`  ${i + 1}. ${err.file} - ${err.offer_id || 'N/A'}: ${err.error} `);
        });
        if (stats.errors.length > 10) {
            console.log(`  ... and ${stats.errors.length - 10} more errors`);
        }
    }

    console.log('\n✅ Data import completed successfully!');
}

// Run import
importAllData()
    .catch(error => {
        console.error('\n❌ Fatal error during import:', error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
