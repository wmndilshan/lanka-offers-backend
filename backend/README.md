# ScrapeNDB Backend API

Standalone **user-facing** backend for web/mobile clients.

This service is public-offers only.
- No admin routes
- No user auth
- Dashboard remains separate (local admin app)
- Shared component is only the database

## Features

- `GET /api/v1/offers` with filters
- `GET /api/v1/offers/filters` for dropdown metadata
- `GET /api/v1/offers/stats` for public aggregate counts
- `GET /api/v1/offers/:uniqueId` for offer details
- `GET /api/v1/health`
- Nearby search using PostGIS (`lat`,`lng`,`radius_km`)

## Setup

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

## Env

- `PORT`
- `NODE_ENV`
- `DATABASE_URL`
- `ALLOWED_ORIGINS`

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
Returns one active approved production offer + all locations.

## Deploy

Deploy `backend/` to cloud (Render/Railway/Fly/etc) with separate Postgres/Neon DB.
