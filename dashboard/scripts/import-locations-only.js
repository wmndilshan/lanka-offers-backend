const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const { listBanks, resolveOutputFile } = require('../../lib/bank-registry');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });

// Use DIRECT_URL for long-running scripts to avoid pooler timeouts
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

const RETRYABLE_DB_ERRORS = /Server has closed the connection|ECONNRESET|ETIMEDOUT|EPIPE/i;

async function withRetry(label, fn, attempts = 3) {
    let lastError;
    for (let i = 1; i <= attempts; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            const message = error?.message || '';
            if (!RETRYABLE_DB_ERRORS.test(message) || i === attempts) {
                throw error;
            }
            console.warn(`Retrying after connection error [${label}], attempt: ${i}, error: ${message}`);
            try { await prisma.$disconnect(); } catch (_) { }
            try { await prisma.$connect(); } catch (_) { }
        }
    }
    throw lastError;
}

async function importGeoLocations(filePath, bank) {
    console.log(`Processing file: ${bank} - ${path.basename(filePath)}`);
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content);
        const geoOffers = Array.isArray(data) ? data : (data.offers || []);
        console.log(`Offers with locations: ${geoOffers.length}`);

        for (const geoOffer of geoOffers) {
            if (!geoOffer.locations || geoOffer.locations.length === 0) continue;
            try {
                const offer = await withRetry('findUnique', () => 
                    prisma.offer.findUnique({
                        where: { unique_id: geoOffer.offer_id }
                    })
                );
                if (!offer) {
                    console.log(`Offer not found: ${geoOffer.offer_id}`);
                    continue;
                }
                
                // Keep track of inserted place_ids to avoid duplicate constraints if any
                for (const location of geoOffer.locations) {
                    if (!location.latitude || !location.longitude) continue;
                    const geographyPoint = `SRID=4326;POINT(${location.longitude} ${location.latitude})`;
                    await withRetry('insertLocation', () => 
                        prisma.$executeRawUnsafe(`
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
                        )
                    );
                }
            } catch (error) {
                console.error(`Error inserting locations for ${geoOffer.offer_id}:`, error.message);
            }
        }
    } catch (error) {
        console.error(`Error reading file ${filePath}:`, error.message);
    }
}

async function main() {
    const outputDir = path.join(__dirname, '..', '..', 'output');
    const projectRoot = path.join(__dirname, '..', '..');
    const banksToImport = listBanks();
    const geoFiles = banksToImport
        .map((bank) => ({
            bank,
            file: resolveOutputFile(bank, 'geo', projectRoot),
        }))
        .filter(({ file }) => fs.existsSync(path.join(outputDir, file)));

    for (const entry of geoFiles) {
        const filePath = path.join(outputDir, entry.file);
        await importGeoLocations(filePath, entry.bank);
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
