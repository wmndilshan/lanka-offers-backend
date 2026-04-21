const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: process.env.BACKEND_ENV_FILE || path.join(process.cwd(), '.env') });

function parseOrigins(raw) {
  if (!raw || raw.trim() === '*') return '*';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

const config = {
  port: Number.parseInt(process.env.PORT || '8080', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || '',
  /**
   * Browser origins allowed for CORS (comma-separated). Use explicit app origins in production;
   * "*" is convenient for local dev only.
   */
  allowedOrigins: parseOrigins(process.env.ALLOWED_ORIGINS || '*'),
  /** When set, PATCH/publish/reject are mounted under /api/v1/admin/offers */
  adminApiKey: (process.env.ADMIN_API_KEY || '').trim(),
  /**
   * Number of reverse-proxy hops to trust for X-Forwarded-For (rate limiter uses req.ip).
   * Set TRUST_PROXY=1 when behind one nginx/load-balancer. Leave unset for direct exposure.
   */
  trustProxy: process.env.TRUST_PROXY ? Number.parseInt(process.env.TRUST_PROXY, 10) || true : false,
};

function validateConfig() {
  const missing = [];
  if (!config.databaseUrl) missing.push('DATABASE_URL');

  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}

module.exports = {
  config,
  validateConfig,
};
