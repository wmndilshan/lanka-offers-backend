import 'dotenv/config';
import prisma from '../lib/prisma.mjs';
import { buildValidationArtifacts } from '../lib/validation-pipeline.mjs';
import { ensureValidationJobTable, scheduleOfferValidation } from '../lib/validation-queue.mjs';
import { closeJobDbPool } from '../lib/job-db.mjs';

function getArg(name, fallback) {
    const arg = process.argv.slice(2).find((item) => item.startsWith(`--${name}=`));
    return arg ? arg.split('=').slice(1).join('=') : fallback;
}

const limit = Number(getArg('limit', '25')) || 25;
const source = getArg('source', null);

async function main() {
    await ensureValidationJobTable();

    const offers = await prisma.offer.findMany({
        where: {
            ...(source ? { source } : {}),
        },
        include: {
            rawData: true,
            validation: true,
        },
        orderBy: {
            updatedAt: 'desc',
        },
        take: limit,
    });

    let scanned = 0;
    let selected = 0;
    let enqueued = 0;

    const items = [];

    for (const offer of offers) {
        scanned += 1;
        const artifacts = buildValidationArtifacts({
            offer,
            rawData: offer.rawData,
        });

        const currentCacheKey = offer.validation?.cacheKey || null;
        if (currentCacheKey === artifacts.cacheKey) {
            continue;
        }

        selected += 1;

        const queueResult = await scheduleOfferValidation({
            prisma,
            offer,
            rawData: offer.rawData,
            reason: 'queue_backfill',
            priority: 20,
        });

        if (queueResult.enqueued) {
            enqueued += 1;
        }

        items.push({
            offerId: offer.id,
            uniqueId: offer.unique_id,
            previousCacheKey: currentCacheKey,
            nextCacheKey: artifacts.cacheKey,
            enqueued: queueResult.enqueued,
            skipped: queueResult.skipped,
        });
    }

    console.log(JSON.stringify({
        scanned,
        selected,
        enqueued,
        items,
    }, null, 2));
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
        await closeJobDbPool();
    });
