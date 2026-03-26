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
  allowedOrigins: parseOrigins(process.env.ALLOWED_ORIGINS || '*'),
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
