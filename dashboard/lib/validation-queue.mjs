import { getAppLogger } from './app-logger.mjs';
import { withJobDbClient } from './job-db.mjs';
import { buildValidationArtifacts, validateOfferWithPipeline } from './validation-pipeline.mjs';

const log = getAppLogger('ValidationQueue');

function createJobId() {
    return `vjob_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function getDedupeKey(offerId, cacheKey) {
    return `${offerId}:${cacheKey}`;
}

function getRetryDelaySeconds(attempts) {
    if (attempts <= 1) return 30;
    if (attempts === 2) return 120;
    return 300;
}

export async function ensureValidationJobTable() {
    await withJobDbClient(async (client) => {
        await client.query('BEGIN');
        try {
            await client.query(`SELECT pg_advisory_xact_lock(hashtext('validation_jobs_schema_v1'))`);

            const existsResult = await client.query(`
                SELECT to_regclass('public.validation_jobs') AS table_name
            `);

            if (!existsResult.rows[0]?.table_name) {
                await client.query(`
                    CREATE TABLE validation_jobs (
                        id TEXT PRIMARY KEY,
                        offer_id TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
                        dedupe_key TEXT NOT NULL UNIQUE,
                        expected_cache_key TEXT NOT NULL,
                        reason TEXT NOT NULL DEFAULT 'unspecified',
                        status TEXT NOT NULL DEFAULT 'queued',
                        priority INTEGER NOT NULL DEFAULT 0,
                        attempts INTEGER NOT NULL DEFAULT 0,
                        max_attempts INTEGER NOT NULL DEFAULT 3,
                        available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        started_at TIMESTAMPTZ,
                        completed_at TIMESTAMPTZ,
                        last_error TEXT,
                        payload JSONB,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                `);
            }

            await client.query(`
                CREATE INDEX IF NOT EXISTS validation_jobs_status_available_idx
                ON validation_jobs (status, available_at, priority DESC, created_at ASC)
            `);

            await client.query(`
                CREATE INDEX IF NOT EXISTS validation_jobs_offer_id_idx
                ON validation_jobs (offer_id)
            `);

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
    });
}

export async function enqueueValidationJob({
    offerId,
    cacheKey,
    inputHash,
    reason = 'offer_changed',
    priority = 0,
    payload = {},
}) {
    const dedupeKey = getDedupeKey(offerId, cacheKey);

    const result = await withJobDbClient(async (client) => {
        const response = await client.query(
            `
                INSERT INTO validation_jobs (
                    id,
                    offer_id,
                    dedupe_key,
                    expected_cache_key,
                    reason,
                    status,
                    priority,
                    payload,
                    created_at,
                    updated_at
                ) VALUES (
                    $1, $2, $3, $4, $5, 'queued', $6, $7::jsonb, NOW(), NOW()
                )
                ON CONFLICT (dedupe_key) DO UPDATE
                SET
                    reason = EXCLUDED.reason,
                    expected_cache_key = EXCLUDED.expected_cache_key,
                    priority = GREATEST(validation_jobs.priority, EXCLUDED.priority),
                    payload = EXCLUDED.payload,
                    available_at = NOW(),
                    last_error = NULL,
                    updated_at = NOW(),
                    status = CASE
                        WHEN validation_jobs.status IN ('completed', 'failed', 'superseded') THEN 'queued'
                        ELSE validation_jobs.status
                    END
                RETURNING
                    id,
                    offer_id AS "offerId",
                    dedupe_key AS "dedupeKey",
                    expected_cache_key AS "expectedCacheKey",
                    status,
                    attempts
            `,
            [
                createJobId(),
                offerId,
                dedupeKey,
                cacheKey,
                reason,
                priority,
                JSON.stringify({
                    ...payload,
                    inputHash,
                }),
            ]
        );

        return response.rows[0];
    });

    log.info('Queue', 'Validation job queued', {
        offerId,
        cacheKey,
        reason,
        jobId: result.id,
        status: result.status,
    });

    return result;
}

export async function scheduleOfferValidation({
    prisma,
    offer,
    rawData,
    reason = 'offer_changed',
    priority = 0,
}) {
    const artifacts = buildValidationArtifacts({ offer, rawData });

    const existingValidation = await prisma.offerValidation.findUnique({
        where: { offerId: offer.id },
        select: { cacheKey: true },
    });

    if (existingValidation?.cacheKey === artifacts.cacheKey) {
        return {
            enqueued: false,
            skipped: true,
            cacheKey: artifacts.cacheKey,
            inputHash: artifacts.inputHash,
        };
    }

    const job = await enqueueValidationJob({
        offerId: offer.id,
        cacheKey: artifacts.cacheKey,
        inputHash: artifacts.inputHash,
        reason,
        priority,
        payload: {
            uniqueId: offer.unique_id,
            source: offer.source,
        },
    });

    return {
        enqueued: true,
        skipped: false,
        cacheKey: artifacts.cacheKey,
        inputHash: artifacts.inputHash,
        job,
    };
}

export async function claimNextValidationJob() {
    return withJobDbClient(async (client) => {
        await client.query('BEGIN');
        try {
            const result = await client.query(`
                WITH next_job AS (
                    SELECT id
                    FROM validation_jobs
                    WHERE status IN ('queued', 'retry')
                      AND available_at <= NOW()
                      AND attempts < max_attempts
                    ORDER BY priority DESC, created_at ASC
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                )
                UPDATE validation_jobs
                SET
                    status = 'running',
                    attempts = attempts + 1,
                    started_at = NOW(),
                    updated_at = NOW(),
                    last_error = NULL
                WHERE id IN (SELECT id FROM next_job)
                RETURNING
                    id,
                    offer_id AS "offerId",
                    dedupe_key AS "dedupeKey",
                    expected_cache_key AS "expectedCacheKey",
                    reason,
                    status,
                    priority,
                    attempts,
                    max_attempts AS "maxAttempts",
                    payload,
                    created_at AS "createdAt",
                    updated_at AS "updatedAt"
            `);
            await client.query('COMMIT');
            return result.rows[0] || null;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
    });
}

export async function completeValidationJob(jobId, status, lastError = null) {
    await withJobDbClient(async (client) => {
        await client.query(
            `
                UPDATE validation_jobs
                SET
                    status = $2,
                    completed_at = NOW(),
                    last_error = $3,
                    updated_at = NOW()
                WHERE id = $1
            `,
            [jobId, status, lastError]
        );
    });
}

export async function retryValidationJob(jobId, attempts, maxAttempts, errorMessage) {
    const retryable = attempts < maxAttempts;
    const status = retryable ? 'retry' : 'failed';
    const delaySeconds = retryable ? getRetryDelaySeconds(attempts) : 0;

    await withJobDbClient(async (client) => {
        await client.query(
            `
                UPDATE validation_jobs
                SET
                    status = $2,
                    last_error = $3,
                    available_at = CASE
                        WHEN $4 > 0 THEN NOW() + ($4::text || ' seconds')::interval
                        ELSE NOW()
                    END,
                    updated_at = NOW()
                WHERE id = $1
            `,
            [jobId, status, errorMessage, delaySeconds]
        );
    });
}

export async function processValidationJob(prisma, job) {
    const offer = await prisma.offer.findUnique({
        where: { id: job.offerId },
        include: {
            rawData: true,
        },
    });

    if (!offer) {
        await completeValidationJob(job.id, 'superseded', 'Offer no longer exists');
        return { status: 'superseded', reason: 'offer_missing' };
    }

    const currentArtifacts = buildValidationArtifacts({
        offer,
        rawData: offer.rawData,
    });

    if (currentArtifacts.cacheKey !== job.expectedCacheKey) {
        await completeValidationJob(job.id, 'superseded', 'Offer content changed before processing');
        return {
            status: 'superseded',
            reason: 'cache_key_mismatch',
            expectedCacheKey: job.expectedCacheKey,
            currentCacheKey: currentArtifacts.cacheKey,
        };
    }

    await validateOfferWithPipeline({
        prisma,
        offer,
        rawData: offer.rawData,
    });

    await completeValidationJob(job.id, 'completed');
    return {
        status: 'completed',
        cacheKey: currentArtifacts.cacheKey,
    };
}

export async function processValidationJobs({
    prisma,
    limit = 10,
}) {
    let processed = 0;
    let completed = 0;
    let retried = 0;
    let failed = 0;
    let superseded = 0;

    while (processed < limit) {
        const job = await claimNextValidationJob();
        if (!job) break;

        processed += 1;

        try {
            const result = await processValidationJob(prisma, job);
            if (result.status === 'completed') completed += 1;
            if (result.status === 'superseded') superseded += 1;
        } catch (error) {
            const message = error?.message || 'Validation job failed';
            await retryValidationJob(job.id, job.attempts, job.maxAttempts, message);
            if (job.attempts < job.maxAttempts) {
                retried += 1;
            } else {
                failed += 1;
            }
            log.warn('Queue', 'Validation job failed', {
                jobId: job.id,
                offerId: job.offerId,
                attempts: job.attempts,
                maxAttempts: job.maxAttempts,
                error: message,
            });
        }
    }

    return {
        processed,
        completed,
        retried,
        failed,
        superseded,
    };
}
