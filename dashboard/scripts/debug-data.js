
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function debugData() {
    console.log('🔍 DEBUGGING DATA');
    console.log('='.repeat(50));

    // 1. Check Offers
    const offers = await prisma.offer.findMany({
        take: 3,
        include: {
            locations: true
        }
    });

    console.log(`\n1. Sample Offers (${offers.length}):`);
    offers.forEach(o => {
        console.log(`\n[${o.id}] ${o.title}`);
        console.log(`  Merchant: ${o.merchantName}`);
        console.log(`  Category: ${o.category}`);
        console.log(`  Card Type: ${o.cardType}`);
        console.log(`  Valid To: ${o.validTo}`);
        console.log(`  Locations: ${o.locations.length}`);
        o.locations.forEach(l => {
            console.log(`    - ${l.formattedAddress} (${l.latitude}, ${l.longitude})`);
        });
    });

    // 2. Check "Dining" offers
    const diningOffers = await prisma.offer.findMany({
        where: { category: 'Dining' },
        take: 3
    });
    console.log(`\n2. Sample Dining Offers:`);
    diningOffers.forEach(o => console.log(`  - ${o.title} (${o.cardType})`));

    // 3. Check Date Validity
    const validFuture = await prisma.offer.count({
        where: { validTo: { gte: new Date() } }
    });
    console.log(`\n3. Offers expiring in future: ${validFuture}`);

    // 4. Total Locations
    const totalLocations = await prisma.location.count();
    console.log(`\n4. Total Locations in DB: ${totalLocations}`);

    await prisma.$disconnect();
}

debugData().catch(e => console.error(e));
