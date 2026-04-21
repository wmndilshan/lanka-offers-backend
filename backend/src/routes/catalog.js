const express = require('express');
const { pool } = require('../db');
const { config } = require('../utils/config');

const router = express.Router();

function safeServerMessage(err) {
  return config.nodeEnv === 'production' ? 'An unexpected error occurred' : err.message;
}

const PUBLIC_WHERE =
  "(review_status IN ('approved','approved_by_ai')) AND is_in_production=true AND status='active'";

/**
 * GET /api/v1/merchants
 * Returns all distinct merchants that have at least one active production offer,
 * with offer count, bank count, avg discount, and branch count per merchant.
 * Supports ?search=, ?category=, ?page=, ?limit=
 */
router.get('/merchants', async (req, res) => {
  const search = (req.query.search || '').trim();
  const category = (req.query.category || '').trim();
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
  const offset = (page - 1) * limit;

  try {
    const conditions = [
      `o.merchant_name IS NOT NULL`,
      `o.merchant_name <> ''`,
      `(o.review_status IN ('approved','approved_by_ai'))`,
      `o.is_in_production = true`,
      `o.status = 'active'`,
    ];
    const params = [];

    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      conditions.push(`LOWER(o.merchant_name) LIKE $${params.length}`);
    }
    if (category && category !== 'All') {
      params.push(category.toLowerCase());
      conditions.push(`LOWER(o.category) = $${params.length}`);
    }

    const whereClause = conditions.join(' AND ');

    const dataParams = [...params, limit, offset];
    const dataQuery = `
      SELECT
        o.merchant_name,
        COUNT(DISTINCT o.id)::int                              AS offer_count,
        COUNT(DISTINCT o.source)::int                          AS bank_count,
        array_agg(DISTINCT o.category ORDER BY o.category)     AS categories,
        array_agg(DISTINCT o.source   ORDER BY o.source)       AS banks,
        ROUND(AVG(o.discount_percentage)::numeric, 1)          AS avg_discount,
        COALESCE(SUM(loc_counts.branch_count), 0)::int         AS total_branches,
        (
          SELECT o2.category
          FROM offers o2
          WHERE LOWER(COALESCE(o2.merchant_name, '')) = LOWER(COALESCE(o.merchant_name, ''))
          GROUP BY o2.category
          ORDER BY COUNT(*) DESC
          LIMIT 1
        ) AS primary_category
      FROM offers o
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS branch_count
        FROM locations l
        WHERE l.offer_id = o.id
          AND l.latitude IS NOT NULL
          AND l.longitude IS NOT NULL
      ) loc_counts ON true
      WHERE ${whereClause}
      GROUP BY o.merchant_name
      ORDER BY offer_count DESC, o.merchant_name ASC
      LIMIT $${dataParams.length - 1}
      OFFSET $${dataParams.length}
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT o.merchant_name)::int AS total
      FROM offers o
      WHERE ${whereClause}
    `;

    const [data, countResult] = await Promise.all([
      pool.query(dataQuery, dataParams),
      pool.query(countQuery, params),
    ]);

    const total = countResult.rows[0]?.total || 0;
    const merchants = data.rows.map((r) => ({
      name: r.merchant_name,
      primary_category: r.primary_category,
      categories: (r.categories || []).filter(Boolean),
      banks: (r.banks || []).filter(Boolean),
      offer_count: r.offer_count,
      bank_count: r.bank_count,
      avg_discount: r.avg_discount !== null ? Number(r.avg_discount) : null,
      total_branches: r.total_branches || 0,
    }));

    return res.json({
      merchants,
      pagination: { total, page, limit, total_pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch merchants', message: safeServerMessage(error) });
  }
});

/**
 * GET /api/v1/banks
 * Returns all banks (sources) that have active production offers, with offer counts.
 */
router.get('/banks', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        source AS bank,
        COUNT(*)::int AS offer_count
      FROM offers
      WHERE ${PUBLIC_WHERE}
      GROUP BY source
      ORDER BY offer_count DESC, source ASC
    `);
    return res.json({ banks: result.rows });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch banks', message: safeServerMessage(error) });
  }
});

/**
 * GET /api/v1/categories
 * Returns all categories with active production offer counts.
 */
router.get('/categories', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        category,
        COUNT(*)::int AS offer_count
      FROM offers
      WHERE ${PUBLIC_WHERE}
        AND category IS NOT NULL
        AND category <> ''
      GROUP BY category
      ORDER BY offer_count DESC, category ASC
    `);
    return res.json({ categories: result.rows });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch categories', message: safeServerMessage(error) });
  }
});

module.exports = router;
