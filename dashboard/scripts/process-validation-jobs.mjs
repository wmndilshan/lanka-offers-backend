import 'dotenv/config';
import prisma from '../lib/prisma.mjs';
import { processValidationJobs, ensureValidationJobTable } from '../lib/validation-queue.mjs';
import { closeJobDbPool } from '../lib/job-db.mjs';

function getArg(name, fallback) {
    const arg = process.argv.slice(2).find((item) => item.startsWith(`--${name}=`));
    return arg ? arg.split('=').slice(1).join('=') : fallback;
}

const limit = Number(getArg('limit', '10')) || 10;

async function main() {
    await ensureValidationJobTable();
    const result = await processValidationJobs({
        prisma,
        limit,
    });
    console.log(JSON.stringify(result, null, 2));
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
