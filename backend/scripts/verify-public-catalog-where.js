#!/usr/bin/env node
/**
 * Smoke test: public list cannot be widened via review_status / is_in_production / status query params.
 */
const { parseOffersQuery, buildWhere } = require('../src/utils/offers-query');

const parsed = parseOffersQuery(
  {
    review_status: 'pending',
    is_in_production: 'false',
    status: 'expired',
  },
  { publicCatalog: true },
);

const params = [];
const where = buildWhere(parsed, params, 'o', { publicCatalog: true });

if (where.includes('pending') || where.includes('expired')) {
  console.error('FAIL: public catalog WHERE leaked overrides\n', where);
  process.exit(1);
}
if (!where.includes('approved_by_ai')) {
  console.error('FAIL: expected approved + approved_by_ai clause\n', where);
  process.exit(1);
}

console.log('verify-public-catalog-where: OK');
