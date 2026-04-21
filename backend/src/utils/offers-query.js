const VALID_PRESETS = new Set(['active', 'today', 'tomorrow', 'this_week', 'this_month', 'custom']);

function parseCsv(value, normalize) {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => (normalize ? normalize(v) : v));
}

function parseDate(value, fieldName) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${fieldName}`);
  return date;
}

function parseInteger(value, fieldName, { min = null, max = null, fallback = null } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!/^-?\d+$/.test(String(value).trim())) throw new Error(`Invalid ${fieldName}`);

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${fieldName}`);
  if (min !== null && parsed < min) throw new Error(`Invalid ${fieldName}`);
  if (max !== null && parsed > max) throw new Error(`Invalid ${fieldName}`);
  return parsed;
}

function parseFloatValue(value, fieldName, { min = null, max = null, fallback = null } = {}) {
  if (value === undefined || value === null || value === '') return fallback;

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${fieldName}`);
  if (min !== null && parsed < min) throw new Error(`Invalid ${fieldName}`);
  if (max !== null && parsed > max) throw new Error(`Invalid ${fieldName}`);
  return parsed;
}

function startOfDay(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(d) {
  const date = new Date(d);
  date.setHours(23, 59, 59, 999);
  return date;
}

function computeWindow(preset, fromDate, toDate) {
  const now = new Date();
  const today = startOfDay(now);

  if (preset === 'custom') {
    const from = parseDate(fromDate, 'from_date');
    const to = parseDate(toDate, 'to_date');
    if (!from || !to) throw new Error('custom preset requires from_date and to_date');
    if (from > to) throw new Error('from_date cannot be greater than to_date');
    return { start: startOfDay(from), end: endOfDay(to) };
  }

  if (preset === 'today') return { start: today, end: endOfDay(today) };

  if (preset === 'tomorrow') {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return { start: d, end: endOfDay(d) };
  }

  if (preset === 'this_week') {
    const day = today.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() + mondayOffset);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    return { start: weekStart, end: endOfDay(weekEnd) };
  }

  if (preset === 'this_month') {
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { start: monthStart, end: endOfDay(monthEnd) };
  }

  return { start: today, end: null };
}

function parseOffersQuery(qs, options = {}) {
  const publicCatalog = options.publicCatalog === true;

  const page = parseInteger(qs.page, 'page', { min: 1, fallback: 1 });
  const limit = parseInteger(qs.limit, 'limit', { min: 1, max: 100, fallback: 20 });
  const lat = parseFloatValue(qs.lat, 'lat', { min: -90, max: 90, fallback: null });
  const lng = parseFloatValue(qs.lng, 'lng', { min: -180, max: 180, fallback: null });
  const radiusKm = parseFloatValue(qs.radius_km, 'radius_km', { min: 0.001, max: 200, fallback: 10 });

  if ((lat === null) !== (lng === null)) throw new Error('lat and lng must be set together');

  const datePreset = (qs.date_preset || 'active').toLowerCase();
  if (!VALID_PRESETS.has(datePreset)) throw new Error('Invalid date_preset');

  const sort = (qs.sort || (lat !== null ? 'distance' : 'newest')).toLowerCase();
  if (!['distance', 'newest', 'expiring'].includes(sort)) throw new Error('Invalid sort');
  if (sort === 'distance' && lat === null) throw new Error('sort=distance requires lat and lng');

  return {
    page,
    limit,
    offset: (page - 1) * limit,
    lat,
    lng,
    radiusMeters: Math.round(radiusKm * 1000),
    includeOnline: (qs.include_online || 'true').toLowerCase() !== 'false',
    bank: parseCsv(qs.bank, (v) => v.toUpperCase()),
    category: parseCsv(qs.category),
    cardType: parseCsv(qs.card_type, (v) => v.toLowerCase()),
    merchant: (qs.merchant || '').trim(),
    q: (qs.q || '').trim(),
    reviewStatus: publicCatalog ? [] : parseCsv(qs.review_status),
    isInProduction: publicCatalog ? null : (qs.is_in_production === undefined ? null : qs.is_in_production === 'true'),
    status: publicCatalog ? 'active' : (qs.status || 'active'),
    sort,
    datePreset,
    window: computeWindow(datePreset, qs.from_date, qs.to_date),
  };
}

/**
 * Public catalog: only human-approved or AI-approved rows that are in production and active.
 * Query params cannot widen this (review_status / is_in_production / status are ignored when publicCatalog).
 */
function buildWhere(parsed, params, alias = 'o', options = {}) {
  const publicCatalog = options.publicCatalog === true;

  const clauses = [
    `(${alias}.valid_from IS NULL OR ${alias}.valid_from <= $${params.push(parsed.window.end || parsed.window.start)})`,
    `(${alias}.valid_to IS NULL OR ${alias}.valid_to >= $${params.push(parsed.window.start)})`,
  ];

  if (publicCatalog) {
    clauses.push(
      `(${alias}.review_status = 'approved' OR ${alias}.review_status = 'approved_by_ai')`,
    );
    clauses.push(`${alias}.is_in_production = true`);
    clauses.push(`${alias}.status = 'active'`);
  } else if (parsed.reviewStatus.length) {
    clauses.push(`${alias}.review_status = ANY($${params.push(parsed.reviewStatus)})`);
  } else if (parsed.isInProduction === null) {
    clauses.push(`${alias}.review_status = 'approved'`);
  }

  if (!publicCatalog) {
    if (parsed.isInProduction !== null) {
      clauses.push(`${alias}.is_in_production = $${params.push(parsed.isInProduction)}`);
    } else {
      clauses.push(`${alias}.is_in_production = true`);
    }

    if (parsed.status) {
      clauses.push(`${alias}.status = $${params.push(parsed.status)}`);
    }
  }

  if (parsed.bank.length) clauses.push(`${alias}.source = ANY($${params.push(parsed.bank)})`);
  if (parsed.category.length) clauses.push(`${alias}.category = ANY($${params.push(parsed.category)})`);
  if (parsed.cardType.length) clauses.push(`LOWER(${alias}.card_type) = ANY($${params.push(parsed.cardType)})`);

  if (parsed.merchant) {
    // Exact case-insensitive match on merchant_name — use for "show all offers by this merchant"
    clauses.push(`LOWER(COALESCE(${alias}.merchant_name, '')) = $${params.push(parsed.merchant.toLowerCase())}`);
  }

  if (parsed.q) {
    // Escape \, %, _ in that order so backslashes are doubled before % and _ are escaped.
    const like = `%${parsed.q.replace(/\\/g, '\\\\').replace(/[%_]/g, '\\$&')}%`;
    const idx = params.push(like.toLowerCase());
    clauses.push(`(
      LOWER(${alias}.title) LIKE $${idx} ESCAPE '\\'
      OR LOWER(COALESCE(${alias}.merchant_name, '')) LIKE $${idx} ESCAPE '\\'
      OR LOWER(COALESCE(${alias}.discount_description, '')) LIKE $${idx} ESCAPE '\\'
      OR LOWER(${alias}.unique_id) LIKE $${idx} ESCAPE '\\'
    )`);
  }

  if (!parsed.includeOnline && parsed.lat === null) {
    clauses.push(`EXISTS (
      SELECT 1
      FROM locations l2
      WHERE l2.offer_id = ${alias}.id
        AND COALESCE(l2.location_type, '') <> 'ONLINE'
    )`);
  }

  return clauses.join('\n    AND ');
}

function mapOfferRow(row) {
  const location = row.location_json || null;
  return {
    id: row.id,
    unique_id: row.unique_id,
    source: row.source,
    category: row.category,
    title: row.title,
    merchant_name: row.merchant_name,
    card_type: row.card_type,
    discount_description: row.discount_description,
    discount_percentage: row.discount_percentage,
    valid_from: row.valid_from,
    valid_to: row.valid_to,
    applicable_cards: row.applicable_cards || [],
    booking_required: row.booking_required,
    scraped_at: row.scraped_at,
    updated_at: row.updated_at,
    // Total geocoded branches for this offer — lets mobile show "N locations" badge
    // without a detail fetch. Null means location data hasn't been loaded yet.
    location_count: row.location_count !== undefined && row.location_count !== null
      ? Number(row.location_count)
      : null,
    distance_meters: row.distance_meters === null || row.distance_meters === undefined ? null : Number(row.distance_meters),
    nearest_location: location,
  };
}

module.exports = {
  parseOffersQuery,
  buildWhere,
  mapOfferRow,
};
