/**
 * Query Examples and Database Verification
 * Demonstrates PostGIS geospatial queries and index usage
 * 
 * Usage: node scripts/query-examples.js
 */

const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient({
    log: ['query'], // Show SQL queries
});

/**
 * Get database statistics
 */
async function getStats() {
    console.log('\n📊 DATABASE STATISTICS');
    console.log('='.repeat(60));

    const offerCount = await prisma.offer.count();
    const locationCount = await prisma.location.count();
    const rawDataCount = await prisma.rawData.count();

    console.log(`Total Offers: ${offerCount}`);
    console.log(`Total Locations: ${locationCount}`);
    console.log(`Total Raw Data Records: ${rawDataCount}`);

    // Count by source
    const bySource = await prisma.offer.groupBy({
        by: ['source'],
        _count: true
    });

    console.log('\nOffers by Bank:');
    bySource.forEach(item => {
        console.log(`  ${item.source}: ${item._count} offers`);
    });

    // Count by category
    const byCategory = await prisma.offer.groupBy({
        by: ['category'],
        _count: true,
        orderBy: {
            _count: {
                category: 'desc'
            }
        },
        take: 10
    });

    console.log('\nTop 10 Categories:');
    byCategory.forEach(item => {
        console.log(`  ${item.category || 'Unknown'}: ${item._count} offers`);
    });
}

/**
 * Example 1: Find nearest offers to a location (Geospatial Query)
 */
async function findNearestOffers(lat, lng, radiusMeters = 5000, limit = 10) {
    console.log(`\n\n🗺️  GEOSPATIAL QUERY: Nearest Offers`);
    console.log('='.repeat(60));
    console.log(`Location: ${lat}, ${lng}`);
    console.log(`Radius: ${radiusMeters}m`);
    console.log(`Limit: ${limit} results\n`);

    const point = `SRID=4326;POINT(${lng} ${lat})`;

    // Use PostGIS ST_DWithin for fast spatial query with GiST index
    const results = await prisma.$queryRawUnsafe(`
    SELECT 
      o.id,
      o.unique_id,
      o.title,
      o.merchant_name,
      o.discount_description,
      o.category,
      o.source,
      l.formatted_address,
      l.latitude,
      l.longitude,
      ST_Distance(
        l.geography,
        ST_GeogFromText($1)
      ) AS distance_meters
    FROM offers o
    JOIN locations l ON o.id = l.offer_id
    WHERE ST_DWithin(
      l.geography,
      ST_GeogFromText($1),
      $2
    )
    AND o.valid_to >= NOW()
    ORDER BY distance_meters ASC
    LIMIT $3
  `, point, radiusMeters, limit);

    console.log(`Found ${results.length} offers within ${radiusMeters}m:\n`);
    results.forEach((result, i) => {
        console.log(`${i + 1}. ${result.merchant_name || 'Unknown'} - ${result.title}`);
        console.log(`   Distance: ${Math.round(result.distance_meters)}m`);
        console.log(`   Category: ${result.category}`);
        console.log(`   Address: ${result.formatted_address}`);
        console.log(`   Bank: ${result.source}`);
        console.log('');
    });

    return results;
}

/**
 * Example 2: Filter by category and card type
 */
async function findByCategory(category, cardType = null, limit = 10) {
    console.log(`\n\n🏷️  CATEGORY FILTER`);
    console.log('='.repeat(60));
    console.log(`Category: ${category}`);
    if (cardType) console.log(`Card Type: ${cardType}`);
    console.log(`Limit: ${limit} results\n`);

    const offers = await prisma.offer.findMany({
        where: {
            category: {
                contains: category,
                mode: 'insensitive'
            },
            ...(cardType && {
                cardType: {
                    contains: cardType,
                    mode: 'insensitive'
                }
            }),
            validTo: {
                gte: new Date()
            }
        },
        include: {
            locations: {
                take: 1
            }
        },
        take: limit,
        orderBy: {
            scrapedAt: 'desc'
        }
    });

    console.log(`Found ${offers.length} ${category} offers:\n`);
    offers.forEach((offer, i) => {
        console.log(`${i + 1}. ${offer.merchantName || 'Unknown'}`);
        console.log(`   ${offer.title}`);
        console.log(`   Discount: ${offer.discountDescription}`);
        console.log(`   Valid until: ${offer.validTo?.toLocaleDateString()}`);
        console.log(`   ${offer.locations.length > 0 ? `Location: ${offer.locations[0].formatted_address}` : 'No location data'}`);
        console.log('');
    });

    return offers;
}

/**
 * Example 3: Search offers by text (uses GIN indexes)
 */
async function searchOffers(searchText, limit = 10) {
    console.log(`\n\n🔍 TEXT SEARCH`);
    console.log('='.repeat(60));
    console.log(`Query: "${searchText}"`);
    console.log(`Limit: ${limit} results\n`);

    const offers = await prisma.offer.findMany({
        where: {
            OR: [
                {
                    title: {
                        contains: searchText,
                        mode: 'insensitive'
                    }
                },
                {
                    merchantName: {
                        contains: searchText,
                        mode: 'insensitive'
                    }
                },
                {
                    discountDescription: {
                        contains: searchText,
                        mode: 'insensitive'
                    }
                }
            ],
            validTo: {
                gte: new Date()
            }
        },
        include: {
            locations: {
                take: 1
            }
        },
        take: limit,
        orderBy: {
            scrapedAt: 'desc'
        }
    });

    console.log(`Found ${offers.length} matching offers:\n`);
    offers.forEach((offer, i) => {
        console.log(`${i + 1}. ${offer.merchantName || 'Unknown'} - ${offer.source}`);
        console.log(`   ${offer.title}`);
        console.log(`   Category: ${offer.category}`);
        console.log('');
    });

    return offers;
}

/**
 * Example 4: Find offers expiring soon
 */
async function findExpiringSoon(days = 7, limit = 10) {
    console.log(`\n\n⏰ EXPIRING SOON`);
    console.log('='.repeat(60));
    console.log(`Next ${days} days`);
    console.log(`Limit: ${limit} results\n`);

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days);

    const offers = await prisma.offer.findMany({
        where: {
            validTo: {
                gte: new Date(),
                lte: futureDate
            }
        },
        orderBy: {
            validTo: 'asc'
        },
        take: limit
    });

    console.log(`Found ${offers.length} offers expiring in next ${days} days:\n`);
    offers.forEach((offer, i) => {
        const daysLeft = Math.ceil((offer.validTo - new Date()) / (1000 * 60 * 60 * 24));
        console.log(`${i + 1}. ${offer.merchantName || 'Unknown'}`);
        console.log(`   ${offer.title}`);
        console.log(`   Expires: ${offer.validTo?.toLocaleDateString()} (${daysLeft} days left)`);
        console.log(`   Source: ${offer.source}`);
        console.log('');
    });

    return offers;
}

/**
 * Main demonstration function
 */
async function runExamples() {
    console.log('🚀 Database Query Examples - PostGIS & Prisma');
    console.log('='.repeat(60));

    try {
        // Get statistics
        await getStats();

        // Example 1: Find offers near Colombo Fort (6.9271, 79.8612)
        await findNearestOffers(6.9271, 79.8612, 5000, 5);

        // Example 2: Find dining offers for credit cards
        await findByCategory('Dining', 'credit', 5);

        // Example 3: Search for "restaurant" or "hotel"
        await searchOffers('restaurant', 5);

        // Example 4: Offers expiring in next 7 days
        await findExpiringSoon(7, 5);

        console.log('\n✅ All query examples completed successfully!');
        console.log('\nNote: Check the query logs above to see the actual SQL generated');
        console.log('      and verify that indexes are being used efficiently.');

    } catch (error) {
        console.error('\n❌ Error running examples:', error);
        throw error;
    }
}

// Run examples
runExamples()
    .catch(error => {
        console.error('\n❌ Fatal error:', error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
