# Geocoding pipeline order

Recommended order for nearest-offer quality:

1. **Scrape** bank sources and sync offers into Postgres (`dashboard/scripts/sync.js` / import).
2. **Validate** structured fields + optional LLM (`dashboard/lib/validation-pipeline.mjs`). LLM must not delete rows that already have Google `place_id` or geocoded coordinates.
3. **Geocode** addresses with `geo/index.js` (or import geocoded JSON via `dashboard/scripts/import-data.js`) so `locations.latitude`, `locations.longitude`, and PostGIS `geography` are set.
4. **Approve / publish** (`is_in_production`, review status) via local dashboard or admin API with `ADMIN_API_KEY`.

The public backend uses `locations.geography` for `ST_DWithin` nearest queries (`backend/src/routes/offers.js`).
