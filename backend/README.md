# ScrapeNDB Backend API

Standalone **user-facing** backend for web/mobile clients.

- **Public routes** — read-only catalog for anonymous apps (no user login).
- **Optional admin writes** — disabled unless `ADMIN_API_KEY` is set (intended for trusted operators or automation, not end users).
- Dashboard remains separate (local admin app); shared state is the database.

## Features

- `GET /api/v1/offers` with filters (public catalog only; see below)
- `GET /api/v1/offers/filters` for dropdown metadata
- `GET /api/v1/offers/stats` for public aggregate counts
- `GET /api/v1/offers/:uniqueId` for offer details
- `GET /api/v1/health` (includes DB time and PostGIS availability)
- Nearby search using PostGIS (`lat`, `lng`, `radius_km`)
- Rate limiting on `/api/v1/offers` (see `RATE_LIMIT_MAX`)

## Public catalog rules

List, filters, stats, and detail only include offers where:

- `review_status` is `approved` or `approved_by_ai`
- `is_in_production = true`
- `status = 'active'`

Query parameters such as `review_status`, `is_in_production`, and `status` are **ignored** for public list endpoints so clients cannot widen results.

## Optional admin API

When `ADMIN_API_KEY` is set, these routes are mounted under `/api/v1/admin/offers`:

- `PATCH /api/v1/admin/offers/:uniqueId` — field updates
- `POST /api/v1/admin/offers/:uniqueId/publish` — approve + production
- `POST /api/v1/admin/offers/:uniqueId/reject` — reject

Authenticate with `Authorization: Bearer <ADMIN_API_KEY>` or header `X-Admin-Api-Key: <ADMIN_API_KEY>`.

If `ADMIN_API_KEY` is unset, these routes are not registered (use the Prisma dashboard + DB for curation).

## Setup

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

## Env

- `PORT`
- `NODE_ENV` — in `production`, 500 responses omit internal error details
- `DATABASE_URL`
- `ALLOWED_ORIGINS` — comma-separated list; avoid `*` in production
- `ADMIN_API_KEY` — optional; enables admin routes above
- `RATE_LIMIT_MAX` — max requests per IP per minute for `/api/v1/offers` (default `300`)

## API

### GET `/api/v1/offers`

Params:

- `page`, `limit`
- `q`
- `bank=HNB,BOC`
- `category=Dining,Hotels`
- `card_type=credit,debit`
- `date_preset=active|today|tomorrow|this_week|this_month|custom`
- `from_date`, `to_date` (when `custom`)
- `lat`, `lng`, `radius_km`
- `sort=distance|newest|expiring`
- `include_online=true|false`

### GET `/api/v1/offers/filters`

Returns banks/categories/card types/date presets.

### GET `/api/v1/offers/stats`

Returns total public offers plus grouped counts by bank/category/card type.

### GET `/api/v1/offers/:uniqueId`

Returns one active in-production offer (approved or `approved_by_ai`) and all locations.

## Deploy

Deploy `backend/` to cloud (Render/Railway/Fly/etc.) with Postgres + PostGIS (Neon/RDS, etc.).
