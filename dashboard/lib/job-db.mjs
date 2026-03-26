import { Pool } from 'pg';

let pool;

function getRuntimeDatabaseUrl() {
    return process.env.PRISMA_DATABASE_URL || process.env.DIRECT_URL || process.env.DATABASE_URL;
}

export function getJobDbPool() {
    if (!pool) {
        const connectionString = getRuntimeDatabaseUrl();
        if (!connectionString) {
            throw new Error('DATABASE_URL, DIRECT_URL, or PRISMA_DATABASE_URL must be set');
        }

        pool = new Pool({
            connectionString,
            max: 5,
        });
    }

    return pool;
}

export async function withJobDbClient(fn) {
    const client = await getJobDbPool().connect();
    try {
        return await fn(client);
    } finally {
        client.release();
    }
}

export async function closeJobDbPool() {
    if (pool) {
        const currentPool = pool;
        pool = null;
        await currentPool.end();
    }
}
