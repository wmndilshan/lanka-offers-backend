import 'dotenv/config';
import { ensureValidationJobTable } from '../lib/validation-queue.mjs';
import { closeJobDbPool } from '../lib/job-db.mjs';

async function main() {
    await ensureValidationJobTable();
    console.log('validation_jobs table is ready');
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await closeJobDbPool();
    });
