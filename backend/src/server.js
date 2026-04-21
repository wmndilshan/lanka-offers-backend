const express = require('express');
const cors = require('cors');
const { createRateLimiter } = require('./middleware/simple-rate-limit');
const { pool } = require('./db');
const { config, validateConfig } = require('./utils/config');
const log = require('./utils/logger');
const { requireAdminApiKey } = require('./middleware/admin-auth');

const healthRoutes = require('./routes/health');
const offersRoutes = require('./routes/offers');
const catalogRoutes = require('./routes/catalog');
const adminOffersRoutes = require('./routes/admin-offers');

validateConfig();

const app = express();

// Trust reverse proxy for accurate client IP (rate limiter correctness).
// Set TRUST_PROXY=1 in env when behind one nginx/load-balancer hop.
if (config.trustProxy) {
  app.set('trust proxy', config.trustProxy);
}

const publicApiLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: Number.parseInt(process.env.RATE_LIMIT_MAX || '300', 10),
});

const corsOptions = {
  origin(origin, callback) {
    if (config.allowedOrigins === '*') return callback(null, true);
    if (!origin) return callback(null, true);
    if (config.allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

app.use((req, _res, next) => {
  log.info('HTTP', `${req.method} ${req.originalUrl}`);
  next();
});

app.get('/', (_req, res) => {
  res.json({
    service: 'scrapendb-backend',
    version: '1.0.0',
    mode: 'public-user-api',
    now: new Date().toISOString(),
  });
});

app.use('/api/v1', healthRoutes);
app.use('/api/v1/offers', publicApiLimiter, offersRoutes);
app.use('/api/v1', publicApiLimiter, catalogRoutes);

if (config.adminApiKey) {
  app.use('/api/v1/admin/offers', publicApiLimiter, requireAdminApiKey, adminOffersRoutes);
  log.info('Server', 'Admin offer routes enabled at /api/v1/admin/offers');
} else {
  log.warn('Server', 'ADMIN_API_KEY not set — PATCH/publish/reject are disabled (use dashboard + DB or set ADMIN_API_KEY)');
}

app.use((_req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'Route not found',
  });
});

app.use((error, _req, res, _next) => {
  log.error('HTTP', 'Unhandled server error', { message: error.message, stack: error.stack });
  const publicMsg = config.nodeEnv === 'production' ? 'An unexpected error occurred' : error.message;
  res.status(500).json({ error: 'Internal Server Error', message: publicMsg });
});

let server = null;

async function gracefulShutdown(signal) {
  log.warn('Server', `Received ${signal}. Shutting down`);
  if (!server) {
    await pool.end();
    process.exit(0);
    return;
  }

  server.close(async (error) => {
    if (error) {
      log.error('Server', 'Error while closing server', { message: error.message });
    }

    try {
      await pool.end();
    } finally {
      process.exit(error ? 1 : 0);
    }
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

function startServer() {
  if (server) return server;

  server = app.listen(config.port, () => {
    log.success('Server', `Backend listening on port ${config.port}`);
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = app;
module.exports.startServer = startServer;
