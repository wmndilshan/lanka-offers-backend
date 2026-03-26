# ScrapeNDB Geocoding Module

Shared geocoding system for all Sri Lankan bank card offer scrapers. Converts merchant addresses into geographic coordinates (lat/lng) with persistent caching, API usage tracking, and automatic chain branch discovery.

## Features

✅ **Persistent Cache** — Never expires, zero cost on re-runs
✅ **API Usage Tracking** — Monthly limits (10K free), warnings at 50%/80%/100%
✅ **Location Classification** — SINGLE, LISTED, CHAIN, ONLINE
✅ **Chain Branch Discovery** — Automatically finds all branches via Google Places API
✅ **Bank-Specific Adapters** — Handles 6 different address formats
✅ **Parallel Processing** — Configurable concurrency (default: 5)
✅ **Rate Limiting** — Exponential backoff, retry logic

## Quick Start

```bash
# Geocode one bank
node geo/index.js --bank=sampath --google-api-key=YOUR_KEY

# Geocode all banks
node geo/index.js --bank=all --google-api-key=YOUR_KEY

# Dry-run (no API calls)
node geo/index.js --bank=sampath --dry-run

# Check cache & API usage stats
node geo/index.js --stats
```

## Usage

### Command Line Options

```bash
node geo/index.js [options]

Options:
  --bank=<name>          Bank adapter (sampath|hnb|boc|peoples|seylan|ndb|all)
  --google-api-key=KEY   Google API key (or GOOGLE_MAPS_API_KEY env var)
  --input=<file>         Override input file path
  --output=<file>        Override output file path
  --skip-chains          Skip Places API calls for chain merchants
  --dry-run              Classification only, no API calls
  --concurrency=N        Parallel API requests (default: 5)
  --stats                Show cache statistics and API usage
```

### Examples

```bash
# Geocode Sampath bank offers
node geo/index.js --bank=sampath --google-api-key=AIzaSy...

# Use environment variable for API key
export GOOGLE_MAPS_API_KEY=AIzaSy...
node geo/index.js --bank=all

# Test classification without burning API credits
node geo/index.js --bank=ndb --dry-run

# Skip expensive chain lookups (Places API $32/1K)
node geo/index.js --bank=all --google-api-key=KEY --skip-chains
```

## Location Types

The module classifies each offer into one of 5 types:

| Type | Description | Example | API Used |
|------|-------------|---------|----------|
| **SINGLE** | One physical address | "724 Matara Rd, Talpe, Galle" | Geocoding |
| **LISTED** | Multiple specific branches | "Everton: Solar Crab, Walden, Tudor Barn..." | Geocoding (each) |
| **CHAIN** | "All Outlets" → auto-discover | "Burger King Sri Lanka" | Places Text Search |
| **ONLINE** | No physical location | "www.uber.lk", "singer.lk" | None (skipped) |
| **NONE** | No address data | Empty/missing | None (skipped) |

## Output Format

```json
{
  "metadata": {
    "source": "sampath",
    "geocoded_at": "2026-02-13T07:14:49.736Z",
    "total_offers": 40,
    "location_types": { "SINGLE": 28, "LISTED": 5, "CHAIN": 5, "ONLINE": 2 },
    "geocoded_count": 33,
    "total_locations": 82,
    "api_stats": {
      "geocode_cached": 46, "geocode_new": 0,
      "places_cached": 5, "places_new": 0
    },
    "dry_run": false
  },
  "offers": [
    {
      "offer_id": "sampath_baecef7ed938_the-radisson-collect",
      "merchant_name": "The Radisson Collection Resort",
      "location_type": "SINGLE",
      "locations": [
        {
          "source": "geocoding_api",
          "success": true,
          "search_address": "724 Matara Road, Talpe, Galle, Galle, Sri Lanka",
          "formatted_address": "724 Matara Rd, Talpe 80615, Sri Lanka",
          "latitude": 5.9996641,
          "longitude": 80.2671,
          "place_id": "ChIJ72T34KJy4ToR9H5CGhI5KsM",
          "types": ["premise", "street_address"],
          "timestamp": "2026-02-13T07:14:31.324Z"
        }
      ]
    }
  ]
}
```

## API Costs & Limits

### Google Maps Platform Pricing

| API | Free Tier | Price After | Used For |
|-----|-----------|-------------|----------|
| **Geocoding API** | 10,000/month | $5/1K | SINGLE, LISTED |
| **Places API (New)** | 10,000/month | $32/1K | CHAIN discovery |

### Current Usage (2026-02)

```
Geocoding API   [##░░░░░░░░░░░░░░░░░░]   912/10,000 (9.1%) — free
Places API (New) [░░░░░░░░░░░░░░░░░░░░]    29/10,000 (0.3%) — free
```

**Session Cost:** $4.976 (initial run for all 6 banks)
**Re-run Cost:** $0.00 (100% cache hits)

### API Usage Tracker

Persistent monthly tracking with automatic warnings:

- ✅ **50% used** — Informational notice
- ⚠️ **80% used** — Approaching limit warning
- 🚨 **100% used** — Over free tier, charges apply

Data stored in `cache_geo/api_usage.json` with:
- Monthly breakdown
- First/last call timestamps
- Last 500 queries per month (for debugging)
- 6-month history

## Architecture

```
geo/
├── index.js           # CLI orchestrator
├── geocoder.js        # GeoCache + ApiTracker + Geocoder engine
├── adapters.js        # Bank-specific location extractors
├── branch-parser.js   # Location classification + branch parsing
├── known-chains.js    # Sri Lankan chain merchant database
└── README.md          # This file

cache_geo/
├── geocode/           # 958 cached geocoding results (MD5 filenames)
├── places/            # 18 cached Places API searches
└── api_usage.json     # Monthly API usage tracker

output/
├── sampath_geo.json
├── hnb_geo.json
├── boc_geo.json
├── peoples_geo.json
├── seylan_geo.json
└── ndb_geo.json
```

## Bank-Specific Adapters

Each bank scraper has different address formats:

| Bank | Source | Format | Example |
|------|--------|--------|---------|
| **Sampath** | `eligible_cards[1]` (raw API) | Street address | "724 Matara Road, Talpe, Galle" |
| **HNB** | `merchant.addresses[0]` | Promo text + venue | "15% off...at Amagi Beach Marawila" |
| **BOC** | `location` | Venue name only | "Centauria Hill Resort" |
| **People's** | `location` | "Venue - City" | "Amaara Sky Hotel - Kandy" |
| **Seylan** | `merchant.address` | Street (28/86), rest empty | "833 New Parliament Rd, Battaramulla" |
| **NDB** | `merchant.location` | "All Outlets" or city | "Colombo 02" |

Adapters normalize these into:
```javascript
{
  offer_id: "...",
  merchant_name: "...",
  location: "extracted address or 'All Outlets'",
  city: "extracted city (optional)"
}
```

## Known Chains Database

Pre-configured search queries for ~35 Sri Lankan chains:

**Supermarkets:** SPAR, Keells, Cargills, Arpico, Glomark, LAUGFS
**Restaurants:** Subway, Burger King, KFC, Popeyes, Baskin Robbins, Delifrance, Crystal Jade
**Retail:** Stripes & Checks, Singer, Softlogic, Abans
**Hotels:** Cinnamon, Araliya, Centauria, Amagi, Amaara

Example: "SPAR Supermarkets" → Search query: "SPAR supermarket Sri Lanka" → 19 branches found

## Cache System

### GeoCache

- **Never expires** — Cache entries persist indefinitely
- **MD5-hashed keys** — Normalized addresses (lowercase, single spaces)
- **File-based storage** — `cache_geo/geocode/{md5}.json`, `cache_geo/places/{md5}.json`
- **Failure caching** — Even failed lookups are cached to prevent retry spam

```javascript
// Example cache file: cache_geo/geocode/a3b2c1d4e5f6.json
{
  "address": "724 Matara Road, Talpe, Galle, Sri Lanka",
  "result": {
    "success": true,
    "latitude": 5.9996641,
    "longitude": 80.2671,
    "formatted_address": "724 Matara Rd, Talpe 80615, Sri Lanka",
    "place_id": "ChIJ72T34KJy4ToR9H5CGhI5KsM",
    "timestamp": "2026-02-13T07:14:31.324Z"
  },
  "cached_at": "2026-02-13T07:14:31.324Z"
}
```

### Why Never-Expire Cache?

1. **Addresses are stable** — Physical locations don't change often
2. **Cost optimization** — Re-running costs $0 instead of $5-$40
3. **Performance** — Instant results vs API round-trips
4. **Reliability** — Works even if API is down

To force refresh: Delete specific cache files from `cache_geo/geocode/` or `cache_geo/places/`

## API Rate Limiting

- **Concurrency:** 5 parallel requests (configurable via `--concurrency=N`)
- **Request delay:** 150ms between requests
- **Retry logic:** Exponential backoff (2s, 4s, 8s) for 429 errors
- **Timeout:** 10s for Geocoding, 15s for Places
- **Pagination:** Places API automatically handles up to 60 results (3 pages × 20)

## Validation & Quality

All coordinates are validated against Sri Lankan boundaries:

- **Latitude:** 5.9°N to 10.0°N
- **Longitude:** 79.5°E to 82.0°E

Out-of-bounds results flagged as errors.

## Statistics (All 6 Banks)

```
Total Offers: 1,093

Location Breakdown:
  SINGLE:  1,043  (Geocoding API)
  LISTED:      5  (Geocoding API, multiple addresses)
  CHAIN:      32  (Places API Text Search)
  ONLINE:     13  (Skipped, no physical location)

Total Locations: ~2,400+ geocoded points

Cache:
  Geocoding: 958 entries
  Places:     18 entries (chain searches)

Chain Branches Found:
  Burger King:     20 branches
  Cargills:        60 branches
  Keells:          60 branches
  LAUGFS:          60 branches
  Singer:          60 branches
  SPAR:            19 branches
  Glomark:         19 branches
  Araliya Hotels:  60 branches
  Popeyes:          5 branches
  Delifrance:       4 branches
  Crystal Jade:     1 branch
  Baskin Robbins:   6 branches
```

## Troubleshooting

### "Places API (New) has not been used in project..."

**Fix:** Enable the Places API (New) in Google Cloud Console:
1. Go to: https://console.developers.google.com/apis/api/places.googleapis.com/overview?project=YOUR_PROJECT_ID
2. Click **Enable**
3. Wait 1-2 minutes for propagation
4. Re-run the geocoding command

### "REQUEST_DENIED - You're calling a legacy API"

The legacy Places API (`textsearch`) is deprecated. This module uses **Places API (New)** (`places:searchText`). Make sure it's enabled in your project.

### High API costs

**Solutions:**
1. Use `--skip-chains` to skip Places API calls (saves $32/1K)
2. Run once, then use cached results ($0 on re-runs)
3. For testing, use `--dry-run` to see classification without API calls

### Missing addresses

Some banks don't provide complete address data:
- **Seylan:** Only 28/86 offers have `merchant.address`
- **NDB:** 17/55 offers just say "All Outlets"
- **BOC:** Only venue names, no street addresses

The module handles this gracefully:
- Venue-only → Geocodes "Venue Name, Sri Lanka"
- "All Outlets" → CHAIN classification → Places API lookup
- Empty → NONE classification → Skipped

### Coordinates outside Sri Lanka

If you see lat/lng outside the valid range:
1. Check the `formatted_address` in the output
2. Verify the input address quality
3. Some merchants (like online stores) may have no valid address
4. ONLINE type should be skipped automatically

## Development

### Adding a New Bank Adapter

1. **Create adapter function** in `geo/adapters.js`:

```javascript
const NewBankAdapter = {
  getDefaultInputFile: () => './output/newbank_all.json',

  loadOffers(filePath) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return data.offers; // Or data.results, etc.
  },

  extractLocationData(offer) {
    return {
      offer_id: offer.id,
      merchant_name: offer.merchant?.name || 'Unknown',
      location: offer.merchant?.address || '',
      city: offer.merchant?.city || ''
    };
  }
};
```

2. **Register in `getAdapter()`**:

```javascript
function getAdapter(bankName) {
  const adapters = {
    sampath: SampathAdapter,
    hnb: HNBAdapter,
    // ... existing adapters
    newbank: NewBankAdapter  // Add this
  };
  // ...
}
```

3. **Add to `listBanks()`**:

```javascript
function listBanks() {
  return ['sampath', 'hnb', 'boc', 'peoples', 'seylan', 'ndb', 'newbank'];
}
```

4. **Test**:

```bash
node geo/index.js --bank=newbank --dry-run
node geo/index.js --bank=newbank --google-api-key=KEY
```

### Adding a New Chain

Edit `geo/known-chains.js`:

```javascript
const KNOWN_CHAINS = {
  // Existing chains...

  'new chain name': {
    patterns: [/new\s*chain/i, /alternative\s*name/i],
    searchQuery: 'New Chain Name Sri Lanka'
  }
};
```

## Environment Variables

```bash
# Google API Key (alternative to --google-api-key flag)
export GOOGLE_MAPS_API_KEY=AIzaSy...

# Then run without flag
node geo/index.js --bank=all
```

## Performance

**Initial run (all 6 banks):**
- Duration: 375s (~6 minutes)
- API calls: 912 geocoding + 29 places = 941 total
- Cost: $4.976

**Re-run (all 6 banks):**
- Duration: <10s
- API calls: 0 (100% cache hits)
- Cost: $0.00

**Single bank (e.g., Sampath):**
- Duration: 3-5s (with cache), 30-60s (without cache)
- API calls: 0-50 geocoding, 0-5 places
- Cost: $0.00-$0.40

## License

Part of the ScrapeNDB project. Internal use only.

## Credits

- **Google Maps Platform:** Geocoding API + Places API (New)
- **Known Chains Database:** Curated list of Sri Lankan chain merchants
- **Bank Adapters:** Custom extractors for 6 Sri Lankan banks (HNB, BOC, People's, Sampath, Seylan, NDB)
