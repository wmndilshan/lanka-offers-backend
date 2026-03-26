import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { buildValidationArtifacts, validateOfferWithPipeline } from '../lib/validation-pipeline.mjs';

const prisma = new PrismaClient();

function parseArg(name, fallback = null) {
    const arg = process.argv.find((entry) => entry.startsWith(`--${name}=`));
    return arg ? arg.split('=').slice(1).join('=') : fallback;
}

async function main() {
    const limit = Math.max(1, Number.parseInt(parseArg('limit', '25'), 10));
    const source = parseArg('source');
    const force = process.argv.includes('--force');

    const offers = await prisma.offer.findMany({
        where: {
            ...(source ? { source } : {}),
        },
        orderBy: { updatedAt: 'desc' },
        take: Math.min(limit * 5, 500),
        include: {
            rawData: true,
            validation: true,
        },
    });

    const targets = [];
    for (const offer of offers) {
        const artifacts = buildValidationArtifacts({
            offer,
            rawData: offer.rawData,
        });
        const isStale = force || !offer.validation || offer.validation.cacheKey !== artifacts.cacheKey;
        if (isStale) {
            targets.push({ offer, artifacts });
        }
        if (targets.length >= limit) break;
    }

    const result = {
        scanned: offers.length,
        selected: targets.length,
        updated: 0,
        failed: 0,
        items: [],
    };

    for (const { offer, artifacts } of targets) {
        try {
            const validation = await validateOfferWithPipeline({
                prisma,
                offer,
                rawData: offer.rawData,
                forceLlm: force,
            });

            result.updated += 1;
            result.items.push({
                offerId: offer.id,
                uniqueId: offer.unique_id,
                previousCacheKey: offer.validation?.cacheKey || null,
                nextCacheKey: validation.cacheKey,
                usedCache: validation.usedCache,
                issues: validation.issues,
            });
        } catch (error) {
            result.failed += 1;
            result.items.push({
                offerId: offer.id,
                uniqueId: offer.unique_id,
                error: error.message,
            });
        }
    }

    console.log(JSON.stringify(result, null, 2));
}

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });