const express = require('express');
const { pool } = require('../db');
const { config } = require('../utils/config');
const { parseOffersQuery, buildWhere, mapOfferRow } = require('../utils/offers-query');

const router = express.Router();

function safeServerMessage(err) {
  return config.nodeEnv === 'production' ? 'An unexpected error occurred' : err.message;
}

router.get('/', async (req, res) => {
  let parsed;
  try {
    parsed = parseOffersQuery(req.query, { publicCatalog: true });
  } catch (error) {
    return res.status(400).json({ error: 'Bad Request', message: error.message });
  }

  const params = [];
  const whereSql = buildWhere(parsed, params, 'o', { publicCatalog: true });

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
        (SELECT COUNT(*)::int FROM locations lc
           WHERE lc.offer_id = o.id
             AND lc.latitude IS NOT NULL
             AND lc.longitude IS NOT NULL) AS location_count,
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
        merchant: parsed.merchant || null,
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
    return res.status(500).json({ error: 'Failed to fetch offers', message: safeServerMessage(error) });
  }
});

const publicCatalogWhere =
  "(review_status IN ('approved','approved_by_ai')) AND is_in_production=true AND status='active'";

router.get('/filters', async (_req, res) => {
  try {
    const [banks, categories, cardTypes] = await Promise.all([
      pool.query(`SELECT DISTINCT source FROM offers WHERE ${publicCatalogWhere} ORDER BY source`),
      pool.query(`SELECT DISTINCT category FROM offers WHERE ${publicCatalogWhere} AND category IS NOT NULL AND category <> '' ORDER BY category`),
      pool.query(`SELECT DISTINCT card_type FROM offers WHERE ${publicCatalogWhere} AND card_type IS NOT NULL AND card_type <> '' ORDER BY card_type`),
    ]);

    return res.json({
      banks: banks.rows.map((r) => r.source),
      categories: categories.rows.map((r) => r.category),
      card_types: cardTypes.rows.map((r) => r.card_type),
      date_presets: ['active', 'today', 'tomorrow', 'this_week', 'this_month', 'custom'],
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch filters', message: safeServerMessage(error) });
  }
});

router.get('/stats', async (_req, res) => {
  try {
    const baseWhere = publicCatalogWhere;

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
    return res.status(500).json({ error: 'Failed to fetch stats', message: safeServerMessage(error) });
  }
});

router.get('/nearby', async (req, res) => {
  // Requires lat + lng. Thin wrapper over GET /offers that enforces sort=distance
  // and returns a proximity-first list. Registered before /:uniqueId to avoid param clash.
  if (!req.query.lat || !req.query.lng) {
    return res.status(400).json({ error: 'Bad Request', message: 'lat and lng are required' });
  }

  let parsed;
  try {
    parsed = parseOffersQuery({ sort: 'distance', ...req.query }, { publicCatalog: true });
  } catch (error) {
    return res.status(400).json({ error: 'Bad Request', message: error.message });
  }

  const params = [];
  const whereSql = buildWhere(parsed, params, 'o', { publicCatalog: true });

  const lngIndex = params.push(parsed.lng);
  const latIndex = params.push(parsed.lat);
  const radiusIndex = params.push(parsed.radiusMeters);

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM offers o
       WHERE ${whereSql}
         AND EXISTS (
           SELECT 1 FROM locations l
           WHERE l.offer_id = o.id
             AND l.latitude IS NOT NULL AND l.longitude IS NOT NULL
             AND ST_DWithin(
               l.geography,
               ST_SetSRID(ST_MakePoint($${lngIndex}, $${latIndex}), 4326)::geography,
               $${radiusIndex}
             )
         )`,
      params,
    );
    const total = countResult.rows[0]?.total || 0;

    const dataParams = [...params];
    const lngIdx2 = dataParams.push(parsed.lng);
    const latIdx2 = dataParams.push(parsed.lat);
    const radIdx2 = dataParams.push(parsed.radiusMeters);
    const limitIndex = dataParams.push(parsed.limit);
    const offsetIndex = dataParams.push(parsed.offset);

    const sql = `
      SELECT
        o.id, o.unique_id, o.source, o.category, o.title,
        o.merchant_name, o.card_type, o.discount_description,
        o.discount_percentage, o.valid_from, o.valid_to,
        o.applicable_cards, o.booking_required, o.scraped_at, o.updated_at,
        (SELECT COUNT(*)::int FROM locations lc
           WHERE lc.offer_id = o.id
             AND lc.latitude IS NOT NULL
             AND lc.longitude IS NOT NULL) AS location_count,
        nearest.distance_meters,
        nearest.location_json
      FROM offers o
      LEFT JOIN LATERAL (
        SELECT
          l.id,
          l.formatted_address, l.latitude, l.longitude,
          l.place_id, l.location_type, l.branch_name,
          ST_Distance(
            l.geography,
            ST_SetSRID(ST_MakePoint($${lngIdx2}, $${latIdx2}), 4326)::geography
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
          AND l.latitude IS NOT NULL AND l.longitude IS NOT NULL
          AND ST_DWithin(
            l.geography,
            ST_SetSRID(ST_MakePoint($${lngIdx2}, $${latIdx2}), 4326)::geography,
            $${radIdx2}
          )
        ORDER BY distance_meters ASC
        LIMIT 1
      ) nearest ON true
      WHERE ${whereSql}
        AND nearest.id IS NOT NULL
      ORDER BY nearest.distance_meters ASC NULLS LAST
      LIMIT $${limitIndex}
      OFFSET $${offsetIndex}
    `;

    const dataResult = await pool.query(sql, dataParams);

    return res.json({
      filters: {
        lat: parsed.lat,
        lng: parsed.lng,
        radius_meters: parsed.radiusMeters,
        bank: parsed.bank,
        category: parsed.category,
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
    return res.status(500).json({ error: 'Failed to fetch nearby offers', message: safeServerMessage(error) });
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
          AND review_status IN ('approved', 'approved_by_ai')
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
    return res.status(500).json({ error: 'Failed to fetch offer', message: safeServerMessage(error) });
  }
});

module.exports = router;
