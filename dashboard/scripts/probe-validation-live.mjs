import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { buildValidationArtifacts } from '../lib/validation-pipeline.mjs';

const prisma = new PrismaClient();

async function main() {
    const limit = Math.max(1, Number.parseInt(process.argv[2] || '25', 10));

    const offers = await prisma.offer.findMany({
        orderBy: { updatedAt: 'desc' },
        take: limit,
        include: {
            rawData: true,
            validation: true,
        },
    });

    const summary = {
        scanned: offers.length,
        withRawData: 0,
        withValidation: 0,
        matchingCacheKey: 0,
        staleValidation: 0,
        missingValidation: 0,
        sample: [],
    };

    for (const offer of offers) {
        const artifacts = buildValidationArtifacts({
            offer,
            rawData: offer.rawData,
        });

        if (offer.rawData) summary.withRawData += 1;
        if (offer.validation) summary.withValidation += 1;

        const matches = offer.validation?.cacheKey === artifacts.cacheKey;
        if (matches) {
            summary.matchingCacheKey += 1;
        } else if (offer.validation) {
            summary.staleValidation += 1;
        } else {
            summary.missingValidation += 1;
        }

        if (!matches && summary.sample.length < 5) {
            summary.sample.push({
                offerId: offer.id,
                uniqueId: offer.unique_id,
                title: offer.title,
                oldCacheKey: offer.validation?.cacheKey || null,
                newCacheKey: artifacts.cacheKey,
                hasRawData: !!offer.rawData,
                hasValidation: !!offer.validation,
            });
        }
    }

    console.log(JSON.stringify(summary, null, 2));
}

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
