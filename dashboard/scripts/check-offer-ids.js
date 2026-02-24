const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

const prisma = new PrismaClient();

async function checkOfferIds() {
    console.log('Checking offer ID mismatch...\n');

    // Get all offer IDs from database
    const dbOffers = await prisma.offer.findMany({
        select: { unique_id: true }
    });

    console.log(`Total offers in DB: ${dbOffers.length}`);
    console.log(`Sample DB IDs: ${dbOffers.slice(0, 3).map(o => o.unique_id).join(', ')}\n`);

    // Load geo file
    const geoData = JSON.parse(fs.readFileSync('../output/hnb_geo.json', 'utf-8'));
    console.log(`Total offers in geo file: ${geoData.offers.length}`);
    console.log(`Sample geo IDs: ${geoData.offers.slice(0, 3).map(o => o.offer_id).join(', ')}\n`);

    // Check how many match
    const dbIds = new Set(dbOffers.map(o => o.unique_id));
    const matchingGeoOffers = geoData.offers.filter(o => dbIds.has(o.offer_id));

    console.log(`Matching offers: ${matchingGeoOffers.length}`);
    console.log(`Non-matching: ${geoData.offers.length - matchingGeoOffers.length}\n`);

    if (matchingGeoOffers.length > 0) {
        console.log(`✅ Sample matching offer: ${matchingGeoOffers[0].offer_id}`);
        console.log(`   Merchant: ${matchingGeoOffers[0].merchant_name}`);
        console.log(`   Has ${matchingGeoOffers[0].locations.length} location(s)`);
    }

    await prisma.$disconnect();
}

checkOfferIds().catch(console.error);
