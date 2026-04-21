const express = require('express');
const { pool } = require('../db');
const { config } = require('../utils/config');

const router = express.Router();

router.get('/health', async (_req, res) => {
  try {
    const db = await pool.query('SELECT NOW() AS now');
    let postgisOk = false;
    let postgisVersion = null;
    try {
      const pg = await pool.query('SELECT PostGIS_Full_Version() AS v');
      postgisOk = true;
      // Only expose version string outside production to avoid version-targeted CVE scanning.
      if (config.nodeEnv !== 'production') {
        postgisVersion = pg.rows[0]?.v || null;
      }
    } catch {
      postgisOk = false;
    }
    return res.json({
      status: 'ok',
      service: 'scrapendb-backend',
      db_time: db.rows[0].now,
      postgis: postgisVersion ?? postgisOk,
    });
  } catch (error) {
    const msg = config.nodeEnv === 'production' ? 'Database unavailable' : error.message;
    return res.status(500).json({ status: 'error', message: msg });
  }
});

module.exports = router;
