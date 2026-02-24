# ScrapeNDB

Automated web scraper system for Sri Lankan bank card offer websites. Extracts, normalizes, and geocodes credit/debit card promotions from 6 major banks with structured validity parsing and database-ready output.

## Overview

ScrapeNDB transforms unstructured bank promotion data into clean, geocoded, database-ready JSON with:

- ✅ **Structured date/time parsing** — Converts human-readable periods into DB fields
- ✅ **Unique offer IDs** — SHA-256 based, stable across runs
- ✅ **Geographic coordinates** — Automated geocoding with persistent cache
- ✅ **Validity tracking** — Blackout dates, exclusion days, time windows
- ✅ **Parallel processing** — Fast scraping with configurable concurrency
- ✅ **Audit system** — Automatic issue detection (stale offers, parser failures)
- ✅ **Zero duplicates** — Deduplication across merchant variations

## Supported Banks

| Bank | Scraper | Offers | Data Source | Status |
|------|---------|--------|-------------|--------|
| **HNB** (Hatton National Bank) | [hnb-5.js](hnb-5.js) | 785 | GraphQL API | ✅ Complete |
| **BOC** (Bank of Ceylon) | [boc-5.js](boc-5.js) | 19 | Direct JSON | ✅ Complete |
| **People's Bank** | [people-4.js](people-4.js) | 108 | REST API | ✅ Complete |
| **NDB** (National Development Bank) | [ndb-4.js](ndb-4.js) | 55 | REST API | ✅ Complete |
| **Seylan Bank** | [seylan-3.js](seylan-3.js) | 86 | REST API | ✅ Complete |
| **Sampath Bank** | [sampath-5.js](sampath-5.js) | 40 | JSON API | ✅ Complete |
| **DFCC Bank** | dfcc-x.js | - | - | 🚧 In progress |
| **Commercial Bank** | - | - | - | 📋 Planned |

**Total:** 1,093 unique offers across 6 banks

## Quick Start

### Prerequisites

```bash
npm install axios cheerio tough-cookie
```

### Run a Scraper

```bash
# Scrape all offers from a bank
node hnb-5.js
node boc-5.js
node people-4.js
node ndb-4.js
node seylan-3.js
node sampath-5.js

# Geocode the results
node geo/index.js --bank=hnb --google-api-key=YOUR_KEY
node geo/index.js --bank=all --google-api-key=YOUR_KEY
```

### Check Stats

```bash
# Geocoding cache & API usage
node geo/index.js --stats
```

## Project Structure

```
ScrapeNDB/
├── README.md                      # This file
│
├── Bank Scrapers (v1-v5)
│   ├── hnb-5.js                   # HNB scraper (GraphQL) - 785 offers
│   ├── boc-5.js                   # BOC scraper (JSON) - 19 offers
│   ├── people-4.js                # People's Bank (REST) - 108 offers
│   ├── ndb-4.js                   # NDB scraper (REST) - 55 offers
│   ├── seylan-3.js                # Seylan scraper (REST) - 86 offers
│   ├── sampath-5.js               # Sampath scraper (JSON API) - 40 offers
│   └── dfcc-x.js                  # DFCC (in progress)
│
├── Geocoding Module
│   ├── geo/
│   │   ├── index.js               # CLI orchestrator
│   │   ├── geocoder.js            # GeoCache + ApiTracker + Geocoder
│   │   ├── adapters.js            # Bank-specific location extractors
│   │   ├── branch-parser.js       # Location classification
│   │   ├── known-chains.js        # Sri Lankan chain database
│   │   └── README.md              # Geocoding documentation
│   │
│   └── cache_geo/
│       ├── geocode/               # 958 cached addresses
│       ├── places/                # 18 cached chain searches
│       └── api_usage.json         # Monthly API tracker
│
├── Output Files
│   └── output/
│       ├── hnb_all_v5.json        # HNB structured offers
│       ├── boc_all_v5.json        # BOC structured offers
│       ├── peoples_all_v4.json    # People's structured offers
│       ├── ndb_all_v4.json        # NDB structured offers
│       ├── seylan_all_v3.json     # Seylan structured offers
│       ├── sampath_offers_detailed.json  # Sampath raw API data
│       ├── hnb_geo.json           # HNB geocoded (782 locations)
│       ├── boc_geo.json           # BOC geocoded (19 locations)
│       ├── peoples_geo.json       # People's geocoded (101 locations)
│       ├── ndb_geo.json           # NDB geocoded (~400+ locations)
│       ├── seylan_geo.json        # Seylan geocoded (~400+ locations)
│       └── sampath_geo.json       # Sampath geocoded (82 locations)
│
└── Legacy/Reference Files
    ├── hnb-4.js, hnb-3.js, ...    # Previous versions
    ├── boc-4.js, boc-3.js, ...
    ├── people-3.js, people-2.js, ...
    ├── ndb-3.js, ndb-2.js, ...
    └── sampath-4.js (geocoding post-processor)
```

## Features

### 1. Structured Validity Parsing

Each offer includes detailed validity information:

```javascript
{
  "offer_id": "hnb_8f3a9c...",
  "merchant_name": "Amaara Sky Hotel",
  "discount": "15% off",
  "validity": [
    {
      "valid_from": "2026-01-01",
      "valid_to": "2026-03-31",
      "period_type": "offer",        // offer | booking | stay
      "recurrence_type": null,       // null | weekly | monthly
      "recurrence_days": [],         // ["Monday", "Friday"]
      "time_from": null,             // "18:00" for time-specific
      "time_to": null,               // "23:59"
      "exclusion_days": [],          // ["Sunday", "Public Holiday"]
      "blackout_periods": [],        // [{ from: "2026-12-24", to: "2026-12-26" }]
      "exclusion_notes": "",
      "raw_period_text": "Valid from 01st January 2026 to 31st March 2026"
    }
  ]
}
```

### 2. Date Parsing Intelligence

**PeriodParser** handles complex date formats:

- ✅ UK format (31st January 2026)
- ✅ US format (January 31st, 2026)
- ✅ Month ranges with year propagation ("Jan - Mar 2026")
- ✅ Cross-year periods ("Dec 2025 - Jan 2026")
- ✅ Blackout dates extraction
- ✅ Exclusion days detection
- ✅ Time windows parsing
- ✅ Multiple validity periods per offer

### 3. Geocoding System

Automated address → lat/lng conversion with:

- **Persistent cache** — Never expires, $0 on re-runs
- **API tracking** — Monthly usage limits (10K free), automatic warnings
- **Chain discovery** — Auto-finds all branches via Google Places API
- **Bank adapters** — Handles 6 different address formats
- **Location types:** SINGLE, LISTED, CHAIN, ONLINE

See [geo/README.md](geo/README.md) for full documentation.

### 4. Audit System

Automatic issue detection:

```javascript
{
  "audit": {
    "issues": {
      "stale_offers": 2,        // Expiry > 1 year old
      "parser_bugs": 0,         // PARSE_FAIL markers
      "missing_periods": 0      // Empty validity
    },
    "stale": [
      { "merchant": "Example Hotel", "expiry": "2024-12-31" }
    ]
  }
}
```

### 5. Unique Offer IDs

SHA-256 based, stable across runs:

```javascript
// Format: {bank}_{hash12}_{slug}
"hnb_8f3a9c2b4d1e_amaara-sky-hotel"
"sampath_baecef7ed938_the-radisson-collect"
```

## Data Flow

```
┌─────────────────┐
│  Bank Website   │
│  (API/GraphQL)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Bank Scraper   │  ← hnb-5.js, boc-5.js, etc.
│  - Fetch data   │
│  - Parse HTML   │
│  - Extract      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Offer Class    │  ← HNBOffer, BOCOffer, etc.
│  - Normalize    │
│  - Generate ID  │
│  - Structure    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ PeriodParser    │
│  - Parse dates  │
│  - Extract time │
│  - Blackouts    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  JSON Output    │  ← output/{bank}_all_vX.json
│  (Structured)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Geocoding      │  ← geo/index.js
│  - Classify     │
│  - API calls    │
│  - Cache        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Geo JSON       │  ← output/{bank}_geo.json
│  (lat/lng)      │
└─────────────────┘
         │
         ▼
┌─────────────────┐
│   Database      │  ← PostgreSQL/MySQL
│  (Final import) │
└─────────────────┘
```

## Scraper Details

### HNB (hnb-5.js)

- **Source:** GraphQL API (`https://www.hnb.lk/graphql`)
- **Method:** POST with category-based queries
- **Categories:** 13 (dining, retail, travel, etc.)
- **Offers:** 785 total
- **Unique features:**
  - Merchant deduplication (3 methods: exact, normalized, fuzzy)
  - Address extraction from promo text ("...at Venue Name")
  - Multi-card tier support (Platinum, Gold, Classic)

### BOC (boc-5.js)

- **Source:** Direct JSON file (`https://www.boc.lk/.../api.json`)
- **Method:** Single fetch, category filtering
- **Categories:** All included in one file
- **Offers:** 19 total
- **Unique features:**
  - Simple venue name geocoding
  - Minimal parsing required
  - High-value hotel/resort focus

### People's Bank (people-4.js)

- **Source:** REST API (`https://www.peoplesbank.lk/api/v1/promotions`)
- **Method:** Paginated GET requests
- **Categories:** 6 (hotels, restaurants, shopping, etc.)
- **Offers:** 108 total
- **Unique features:**
  - "Venue - City" format parsing
  - High Tea offers with special time windows
  - Restaurant chains (Cinnamon, Oak Ray)

### NDB (ndb-4.js)

- **Source:** REST API (`https://www.ndb.lk/api/promotions`)
- **Method:** Category-based GET
- **Categories:** 8 (dining, supermarkets, fashion, etc.)
- **Offers:** 55 total
- **Unique features:**
  - "All Outlets" → CHAIN classification
  - Supermarket chains (SPAR, Cargills, Keells, LAUGFS)
  - International Payment Plan (IPP) offers

### Seylan Bank (seylan-3.js)

- **Source:** REST API (`https://www.seylan.lk/api/offers`)
- **Method:** Category pagination
- **Categories:** 12+ (supermarkets, dining, travel, etc.)
- **Offers:** 86 total
- **Unique features:**
  - Street addresses (28/86 have full address)
  - Solar power installment plans
  - Hotel/restaurant chains (Araliya, Amaara)

### Sampath Bank (sampath-5.js)

- **Source:** JSON API (`https://www.sampath.lk/api/card-promotions?category=X`)
- **Categories:** 5 (hotels, dining, fashion, online, super_market)
- **Offers:** 40 total
- **Unique features:**
  - Detailed `promotion_details` with section headers
  - Listed branches (Everton Holidays: 7 properties)
  - Fast food chains (Burger King, Subway, Popeyes, Baskin Robbins)

## Database Schema (Recommended)

### `offers` Table

```sql
CREATE TABLE offers (
  id VARCHAR(100) PRIMARY KEY,           -- offer_id (e.g., "hnb_8f3a9c...")
  bank VARCHAR(50) NOT NULL,             -- "hnb", "boc", "peoples", etc.
  merchant_name VARCHAR(255) NOT NULL,
  merchant_category VARCHAR(100),
  discount VARCHAR(500),
  description TEXT,
  terms_conditions TEXT,
  url VARCHAR(500),
  card_types JSONB,                      -- ["Visa", "MasterCard"]
  card_tiers JSONB,                      -- ["Platinum", "Gold"]

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  INDEX idx_bank (bank),
  INDEX idx_merchant (merchant_name),
  INDEX idx_category (merchant_category)
);
```

### `offer_validity` Table

```sql
CREATE TABLE offer_validity (
  id SERIAL PRIMARY KEY,
  offer_id VARCHAR(100) NOT NULL REFERENCES offers(id) ON DELETE CASCADE,

  valid_from DATE,
  valid_to DATE,
  period_type VARCHAR(20),               -- "offer", "booking", "stay"

  recurrence_type VARCHAR(20),           -- NULL, "weekly", "monthly"
  recurrence_days JSONB,                 -- ["Monday", "Friday"]

  time_from TIME,
  time_to TIME,

  exclusion_days JSONB,                  -- ["Sunday", "Public Holiday"]
  blackout_periods JSONB,                -- [{"from": "2026-12-24", "to": "2026-12-26"}]
  exclusion_notes TEXT,

  raw_period_text TEXT,

  INDEX idx_offer (offer_id),
  INDEX idx_dates (valid_from, valid_to)
);
```

### `offer_locations` Table

```sql
CREATE TABLE offer_locations (
  id SERIAL PRIMARY KEY,
  offer_id VARCHAR(100) NOT NULL REFERENCES offers(id) ON DELETE CASCADE,

  location_type VARCHAR(20) NOT NULL,    -- "SINGLE", "LISTED", "CHAIN", "ONLINE"

  branch_name VARCHAR(255),
  formatted_address VARCHAR(500),
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),

  place_id VARCHAR(255),                 -- Google Place ID
  google_types JSONB,                    -- ["restaurant", "point_of_interest"]

  source VARCHAR(50),                    -- "geocoding_api", "places_text_search"
  geocoded_at TIMESTAMP,

  INDEX idx_offer (offer_id),
  INDEX idx_location (latitude, longitude),
  INDEX idx_type (location_type)
);
```

### Import Example (Node.js)

```javascript
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({ /* config */ });

async function importOffers(bankName) {
  // Load structured data
  const offers = JSON.parse(fs.readFileSync(`output/${bankName}_all_v5.json`));
  const geo = JSON.parse(fs.readFileSync(`output/${bankName}_geo.json`));

  for (const offer of offers.offers) {
    // Insert offer
    await pool.query(
      `INSERT INTO offers (id, bank, merchant_name, discount, ...)
       VALUES ($1, $2, $3, $4, ...) ON CONFLICT (id) DO UPDATE SET ...`,
      [offer.offer_id, bankName, offer.merchant_name, offer.discount, ...]
    );

    // Insert validity periods
    for (const validity of offer.validity) {
      await pool.query(
        `INSERT INTO offer_validity (offer_id, valid_from, valid_to, ...)
         VALUES ($1, $2, $3, ...)`,
        [offer.offer_id, validity.valid_from, validity.valid_to, ...]
      );
    }
  }

  // Insert locations
  const geoOffer = geo.offers.find(g => g.offer_id === offer.offer_id);
  if (geoOffer) {
    for (const loc of geoOffer.locations) {
      await pool.query(
        `INSERT INTO offer_locations (offer_id, latitude, longitude, ...)
         VALUES ($1, $2, $3, ...)`,
        [offer.offer_id, loc.latitude, loc.longitude, ...]
      );
    }
  }
}

// Import all banks
['hnb', 'boc', 'peoples', 'ndb', 'seylan', 'sampath'].forEach(importOffers);
```

## Statistics

### Overall Coverage

```
Total Offers:     1,093
Total Locations:  ~2,400+
Banks Covered:    6/8 major banks (75%)
Categories:       40+ (dining, hotels, retail, travel, etc.)
```

### Validity Parsing

```
Successfully Parsed:  1,093/1,093 (100%)
Multiple Periods:     127 offers
Blackout Dates:       89 offers
Time Windows:         34 offers
Recurring Offers:     21 offers (weekly/monthly)
```

### Geocoding Results

```
Cache Hits:       958 addresses (100% on re-run)
API Calls (Feb):  912 geocoding + 29 places
Chain Branches:   ~800+ locations discovered
  - Burger King:     20 branches
  - Cargills:        60 branches
  - Keells:          60 branches
  - LAUGFS:          60 branches
  - Singer:          60 branches
  - SPAR:            19 branches
  - Araliya Hotels:  60 branches

Cost (initial):   $4.98
Cost (re-run):    $0.00
```

### Audit Issues

```
Stale Offers:     2 (expiry > 1 year old)
Parser Failures:  0 (PARSE_FAIL)
Missing Periods:  0 (empty validity)
```

## Performance

### Scraping

| Bank | Duration | Offers | Speed |
|------|----------|--------|-------|
| HNB | 120-180s | 785 | ~5/sec |
| BOC | 2-3s | 19 | Instant |
| People's | 15-20s | 108 | ~6/sec |
| NDB | 10-15s | 55 | ~4/sec |
| Seylan | 20-30s | 86 | ~3/sec |
| Sampath | 3-5s | 40 | ~10/sec |

### Geocoding

| Bank | Duration (Initial) | Duration (Cached) | API Calls |
|------|-------------------|-------------------|-----------|
| HNB | ~240s | <1s | 782 geocode |
| BOC | ~5s | <1s | 19 geocode |
| People's | ~30s | <1s | 101 geocode |
| NDB | ~45s | <1s | 36 geocode + 18 places |
| Seylan | ~35s | <1s | 77 geocode + 9 places |
| Sampath | ~20s | <1s | 46 geocode + 5 places |
| **All 6** | **~375s** | **<10s** | **1,061 total** |

## Troubleshooting

### Scraper Issues

**"No offers found"**
- Check if bank website is online
- Verify API endpoint hasn't changed
- Check if categories still exist

**"PARSE_FAIL in validity"**
- New date format introduced
- Check PeriodParser regex patterns
- Look at `raw_period_text` in output

**Duplicate merchants**
- Update deduplication logic in Offer class
- Add new merchant name variations
- Check normalization rules

### Geocoding Issues

**"Places API (New) not enabled"**
- Enable in Google Cloud Console
- See [geo/README.md](geo/README.md#troubleshooting)

**"Over API limit"**
- Check usage: `node geo/index.js --stats`
- Use `--skip-chains` to reduce Places API calls
- Re-runs are free (100% cache hits)

**Invalid coordinates**
- Verify input address quality
- Check `formatted_address` in output
- Some venues have no valid address

## Future Enhancements

### Planned Features

- [ ] DFCC Bank scraper completion
- [ ] Commercial Bank scraper
- [ ] Regional bank coverage (NSB, Sampath, etc.)
- [ ] Automated daily scraping (cron job)
- [ ] Change detection & alerts
- [ ] Database direct import scripts
- [ ] Web dashboard for browsing offers
- [ ] Email notifications for new offers
- [ ] Mobile app API endpoints

### Technical Improvements

- [ ] Retry logic for failed geocoding
- [ ] Proxy rotation for rate limiting
- [ ] Docker containerization
- [ ] CI/CD pipeline
- [ ] Automated testing
- [ ] Monitoring & logging
- [ ] API rate limit auto-throttling

## API Keys & Credentials

### Google Maps Platform

Required for geocoding:
- **Geocoding API** (enabled)
- **Places API (New)** (enabled)

Get your API key:
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create project → Enable APIs → Create credentials
3. Restrict by IP/domain for production

### Environment Variables

```bash
# .env file (optional)
GOOGLE_MAPS_API_KEY=AIzaSy...
```

## Contributing

### Code Style

- Use ES6+ features
- Async/await over promises
- Clear variable names
- Comment complex logic
- Follow existing patterns

### Adding a New Bank

1. **Create scraper** — `{bank}-1.js`
2. **Define Offer class** — Extend base pattern
3. **Add PeriodParser** — Copy from existing
4. **Test thoroughly** — Dry-run, live run
5. **Create geo adapter** — Add to `geo/adapters.js`
6. **Update documentation** — This README + geo/README.md

### Testing Checklist

- [ ] All categories scraped
- [ ] Unique IDs generated correctly
- [ ] Validity parsing works (100% success)
- [ ] Audit shows 0 parser bugs
- [ ] Geocoding classifies correctly
- [ ] Output JSON validates
- [ ] Re-run produces identical results

## License

Internal project. All rights reserved.

## Contact & Support

For issues or questions:
- Check documentation: [geo/README.md](geo/README.md)
- Review existing scrapers for patterns
- Test with `--dry-run` before live runs

---

**Last Updated:** February 2026
**Version:** 5.0 (HNB, BOC, Sampath), 4.0 (People's, NDB), 3.0 (Seylan)
**Total Offers:** 1,093 across 6 banks
**Geocoded Locations:** ~2,400+
