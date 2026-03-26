const express = require('express');
const { pool } = require('../db');

const router = express.Router();

router.get('/health', async (_req, res) => {
  try {
    const db = await pool.query('SELECT NOW() AS now');
    return res.json({
      status: 'ok',
      service: 'scrapendb-backend',
      db_time: db.rows[0].now,
    });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

module.exports = router;
