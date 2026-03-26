const { Pool } = require('pg');
const { config } = require('./utils/config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  ssl: config.databaseUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (err) => {
  console.error('[backend-db] Unexpected error on idle client', err);
});

module.exports = { pool };
