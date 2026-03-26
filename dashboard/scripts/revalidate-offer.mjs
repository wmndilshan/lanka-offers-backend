import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { validateOfferWithPipeline } from '../lib/validation-pipeline.mjs';

const prisma = new PrismaClient();

async function main() {
    const offerId = process.argv[2];
    const force = process.argv.includes('--force');

    if (!offerId) {
        console.error('Usage: node scripts/revalidate-offer.mjs <offerId> [--force]');
        process.exit(1);
    }

    const before = await prisma.offer.findUnique({
        where: { id: offerId },
        include: {
            rawData: true,
            validation: true,
        },
    });

    if (!before) {
        console.error(`Offer not found: ${offerId}`);
        process.exit(1);
    }

    const result = await validateOfferWithPipeline({
        prisma,
        offer: before,
        rawData: before.rawData,
        forceLlm: force,
    });

    const after = await prisma.offerValidation.findUnique({
        where: { offerId: offerId },
    });

    console.log(JSON.stringify({
        offerId,
        uniqueId: before.unique_id,
        title: before.title,
        previousCacheKey: before.validation?.cacheKey || null,
        nextCacheKey: after?.cacheKey || result.cacheKey,
        previousStatus: before.validation?.status || null,
        nextStatus: after?.status || null,
        usedCache: result.usedCache,
        issues: result.issues,
        diffCount: result.diff.length,
    }, null, 2));
}

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
