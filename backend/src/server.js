const express = require('express');
const cors = require('cors');
const { pool } = require('./db');
const { config, validateConfig } = require('./utils/config');
const log = require('./utils/logger');

const healthRoutes = require('./routes/health');
const offersRoutes = require('./routes/offers');

validateConfig();

const app = express();

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
app.use('/api/v1/offers', offersRoutes);

app.use((_req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'Route not found',
  });
});

app.use((error, _req, res, _next) => {
  log.error('HTTP', 'Unhandled server error', { message: error.message });
  res.status(500).json({ error: 'Internal Server Error', message: error.message });
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
