const express = require('express');
const { pool } = require('../db');
const { parseOffersQuery, buildWhere, mapOfferRow } = require('../utils/offers-query');

const router = express.Router();

router.get('/', async (req, res) => {
  let parsed;
  try {
    parsed = parseOffersQuery(req.query);
  } catch (error) {
    return res.status(400).json({ error: 'Bad Request', message: error.message });
  }

  const params = [];
  const whereSql = buildWhere(parsed, params, 'o');

  try {
    let countSql = `
      SELECT COUNT(*)::int AS total
      FROM offers o
      WHERE ${whereSql}
    `;

    if (parsed.lat !== null) {
      const lngIndex = params.push(parsed.lng);
      const latIndex = params.push(parsed.lat);
      const radiusIndex = params.push(parsed.radiusMeters);

      countSql = `
        SELECT COUNT(*)::int AS total
        FROM offers o
        WHERE ${whereSql}
          AND EXISTS (
            SELECT 1
            FROM locations l
            WHERE l.offer_id = o.id
              AND l.latitude IS NOT NULL
              AND l.longitude IS NOT NULL
              AND ST_DWithin(
                l.geography,
                ST_SetSRID(ST_MakePoint($${lngIndex}, $${latIndex}), 4326)::geography,
                $${radiusIndex}
              )
          )
      `;
    }

    const countResult = await pool.query(countSql, params);
    const total = countResult.rows[0]?.total || 0;

    const dataParams = [...params];
    let orderSql = 'o.scraped_at DESC';

    if (parsed.sort === 'expiring') orderSql = 'o.valid_to ASC NULLS LAST';

    let geoJoin = '';
    let geoWhere = '';

    if (parsed.lat !== null) {
      const lngIndex = dataParams.push(parsed.lng);
      const latIndex = dataParams.push(parsed.lat);
      const radiusIndex = dataParams.push(parsed.radiusMeters);

      geoJoin = `
        LEFT JOIN LATERAL (
          SELECT
            l.id,
            l.formatted_address,
            l.latitude,
            l.longitude,
            l.place_id,
            l.location_type,
            l.branch_name,
            ST_Distance(
              l.geography,
              ST_SetSRID(ST_MakePoint($${lngIndex}, $${latIndex}), 4326)::geography
            ) AS distance_meters,
            jsonb_build_object(
              'id', l.id,
              'formatted_address', l.formatted_address,
              'latitude', l.latitude,
              'longitude', l.longitude,
              'place_id', l.place_id,
              'location_type', l.location_type,
              'branch_name', l.branch_name
            ) AS location_json
          FROM locations l
          WHERE l.offer_id = o.id
            AND l.latitude IS NOT NULL
            AND l.longitude IS NOT NULL
            AND ST_DWithin(
              l.geography,
              ST_SetSRID(ST_MakePoint($${lngIndex}, $${latIndex}), 4326)::geography,
              $${radiusIndex}
            )
          ORDER BY distance_meters ASC
          LIMIT 1
        ) nearest ON true
      `;
      geoWhere = 'AND nearest.id IS NOT NULL';
      if (parsed.sort === 'distance') orderSql = 'nearest.distance_meters ASC NULLS LAST';
    } else {
      geoJoin = `
        LEFT JOIN LATERAL (
          SELECT
            l.id,
            l.formatted_address,
            l.latitude,
            l.longitude,
            l.place_id,
            l.location_type,
            l.branch_name,
            NULL::double precision AS distance_meters,
            jsonb_build_object(
              'id', l.id,
              'formatted_address', l.formatted_address,
              'latitude', l.latitude,
              'longitude', l.longitude,
              'place_id', l.place_id,
              'location_type', l.location_type,
              'branch_name', l.branch_name
            ) AS location_json
          FROM locations l
          WHERE l.offer_id = o.id
          ORDER BY l.created_at ASC
          LIMIT 1
        ) nearest ON true
      `;
    }

    const limitIndex = dataParams.push(parsed.limit);
    const offsetIndex = dataParams.push(parsed.offset);

    const sql = `
      SELECT
        o.id,
        o.unique_id,
        o.source,
        o.category,
        o.title,
        o.merchant_name,
        o.card_type,
        o.discount_description,
        o.discount_percentage,
        o.valid_from,
        o.valid_to,
        o.applicable_cards,
        o.booking_required,
        o.scraped_at,
        o.updated_at,
        nearest.distance_meters,
        nearest.location_json
      FROM offers o
      ${geoJoin}
      WHERE ${whereSql}
      ${geoWhere}
      ORDER BY ${orderSql}
      LIMIT $${limitIndex}
      OFFSET $${offsetIndex}
    `;

    const dataResult = await pool.query(sql, dataParams);

    return res.json({
      filters: {
        bank: parsed.bank,
        category: parsed.category,
        card_type: parsed.cardType,
        q: parsed.q,
        date_preset: parsed.datePreset,
        from: parsed.window.start,
        to: parsed.window.end,
        lat: parsed.lat,
        lng: parsed.lng,
        radius_meters: parsed.radiusMeters,
      },
      pagination: {
        page: parsed.page,
        limit: parsed.limit,
        total,
        total_pages: Math.ceil(total / parsed.limit),
      },
      offers: dataResult.rows.map(mapOfferRow),
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch offers', message: error.message });
  }
});

router.get('/filters', async (_req, res) => {
  try {
    const [banks, categories, cardTypes] = await Promise.all([
      pool.query("SELECT DISTINCT source FROM offers WHERE review_status='approved' AND is_in_production=true AND status='active' ORDER BY source"),
      pool.query("SELECT DISTINCT category FROM offers WHERE review_status='approved' AND is_in_production=true AND status='active' AND category IS NOT NULL AND category <> '' ORDER BY category"),
      pool.query("SELECT DISTINCT card_type FROM offers WHERE review_status='approved' AND is_in_production=true AND status='active' AND card_type IS NOT NULL AND card_type <> '' ORDER BY card_type"),
    ]);

    return res.json({
      banks: banks.rows.map((r) => r.source),
      categories: categories.rows.map((r) => r.category),
      card_types: cardTypes.rows.map((r) => r.card_type),
      date_presets: ['active', 'today', 'tomorrow', 'this_week', 'this_month', 'custom'],
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch filters', message: error.message });
  }
});

router.get('/stats', async (_req, res) => {
  try {
    const baseWhere = "review_status='approved' AND is_in_production=true AND status='active'";

    const [totals, banks, categories, cardTypes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM offers WHERE ${baseWhere}`),
      pool.query(`
        SELECT source AS value, COUNT(*)::int AS count
        FROM offers
        WHERE ${baseWhere}
        GROUP BY source
        ORDER BY count DESC, source ASC
      `),
      pool.query(`
        SELECT category AS value, COUNT(*)::int AS count
        FROM offers
        WHERE ${baseWhere}
          AND category IS NOT NULL
          AND category <> ''
        GROUP BY category
        ORDER BY count DESC, category ASC
        LIMIT 50
      `),
      pool.query(`
        SELECT card_type AS value, COUNT(*)::int AS count
        FROM offers
        WHERE ${baseWhere}
          AND card_type IS NOT NULL
          AND card_type <> ''
        GROUP BY card_type
        ORDER BY count DESC, card_type ASC
      `),
    ]);

    return res.json({
      total_offers: totals.rows[0]?.total || 0,
      by_bank: banks.rows,
      by_category: categories.rows,
      by_card_type: cardTypes.rows,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch stats', message: error.message });
  }
});

// ---------------------------------------------------------------------------
// ADMIN ROUTES (Level 6: Production Push Lifecycle)
// ---------------------------------------------------------------------------

/**
 * PATCH /offers/:uniqueId
 * Allows admin to manually correct/modify an offer before publishing.
 */
router.patch('/:uniqueId', async (req, res) => {
  const { uniqueId } = req.params;
  const updates = req.body;

  // Allowed fields for manual edit
  const shadowFields = [
    'title', 'merchant_name', 'category', 'card_type',
    'discount_percentage', 'discount_description',
    'valid_from', 'valid_to', 'booking_required'
  ];

  const setClauses = [];
  const queryParams = [];

  shadowFields.forEach((field) => {
    if (updates[field] !== undefined) {
      setClauses.push(`${field} = $${queryParams.push(updates[field])}`);
    }
  });

  if (setClauses.length === 0) {
    return res.status(400).json({ error: 'No valid fields for update' });
  }

  // Also update metadata
  setClauses.push(`updated_at = NOW()`);
  setClauses.push(`edited_at = NOW()`);

  const idIdx = queryParams.push(uniqueId);
  const sql = `
    UPDATE offers
    SET ${setClauses.join(', ')}
    WHERE unique_id = $${idIdx}
    RETURNING *
  `;

  try {
    const result = await pool.query(sql, queryParams);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }
    return res.json(mapOfferRow(result.rows[0]));
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update offer', message: error.message });
  }
});

/**
 * POST /offers/:uniqueId/publish
 * The "Final decision" made by admin. Pushes a draft/flagged offer to production.
 */
router.post('/:uniqueId/publish', async (req, res) => {
  const { uniqueId } = req.params;

  try {
    const sql = `
      UPDATE offers
      SET
        review_status = 'approved',
        is_in_production = true,
        pushed_to_db_at = NOW(),
        updated_at = NOW()
      WHERE unique_id = $1
      RETURNING *
    `;

    const result = await pool.query(sql, [uniqueId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }
    return res.json({ message: 'Offer published successfully', offer: mapOfferRow(result.rows[0]) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to publish offer', message: error.message });
  }
});

/**
 * POST /offers/:uniqueId/reject
 * Admin rejects an offer (wont be pushed to production).
 */
router.post('/:uniqueId/reject', async (req, res) => {
  const { uniqueId } = req.params;

  try {
    const sql = `
      UPDATE offers
      SET
        review_status = 'rejected',
        is_in_production = false,
        updated_at = NOW()
      WHERE unique_id = $1
      RETURNING *
    `;

    const result = await pool.query(sql, [uniqueId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }
    return res.json({ message: 'Offer rejected', offer: mapOfferRow(result.rows[0]) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to reject offer', message: error.message });
  }
});

router.get('/:uniqueId', async (req, res) => {
  const { uniqueId } = req.params;

  try {
    const offerResult = await pool.query(
      `
        SELECT
          id,
          unique_id,
          source,
          source_id,
          title,
          category,
          card_type,
          merchant_name,
          discount_percentage,
          discount_description,
          applicable_cards,
          valid_from,
          valid_to,
          booking_required,
          key_restrictions,
          special_conditions,
          contact_phone,
          contact_email,
          days_applicable,
          scraped_at,
          updated_at
        FROM offers
        WHERE unique_id = $1
          AND review_status = 'approved'
          AND is_in_production = true
          AND status = 'active'
        LIMIT 1
      `,
      [uniqueId],
    );

    if (!offerResult.rows.length) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    const offer = offerResult.rows[0];

    const locations = await pool.query(
      `
        SELECT
          id,
          location_type,
          branch_name,
          formatted_address,
          latitude,
          longitude,
          place_id,
          source,
          success,
          types,
          address_components,
          timestamp
        FROM locations
        WHERE offer_id = $1
        ORDER BY created_at ASC
      `,
      [offer.id],
    );

    return res.json({
      ...offer,
      locations: locations.rows,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch offer', message: error.message });
  }
});

module.exports = router;
