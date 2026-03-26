const { PrismaClient } = require('@prisma/client');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const prisma = new PrismaClient();

async function main() {
    console.log('🚀 Starting Deep Database Reset...');

    try {
        // Order matters for some tables due to FKs (though Cascade should handle it)
        const tables = [
            'llm_validation_cache',
            'validation_jobs',
            'offer_validations',
            'raw_data',
            'locations', // If table name is "locations" in DB but "Location" in Prisma
            'offers',
            'scrape_logs'
        ];

        for (const table of tables) {
            console.log(`🧹 Truncating table: ${table}...`);
            // We use raw SQL because some tables might not be in Prisma schema or have weird constraints
            // We use TRUNCATE ... CASCADE to ensure all related data is wiped
            try {
                await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE;`);
            } catch (e) {
                console.warn(`⚠️  Failed to truncate ${table}: ${e.message}`);
                // If the table doesn't exist, it might be due to naming diffs
                const fallback = table.toLowerCase();
                if (fallback !== table) {
                    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${fallback}" RESTART IDENTITY CASCADE;`).catch(() => { });
                }
            }
        }

        console.log('✅ Database is now clean.');
    } catch (error) {
        console.error('❌ Reset failed:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
