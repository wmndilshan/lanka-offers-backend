# HNB Scraper v6.0 - Enhanced Data Extraction

**Created:** February 2026
**Previous Version:** hnb-5.js (Structured Period Parsing)

---

## 🆕 What's New in v6

### 1. **Merchant Logo & Image Extraction**
```javascript
images: {
  logo: {
    url: "https://assets.hnb.lk/atdi/merchants/lalitha-jewellers-logo.jpg",
    alt: "Lalitha Jewellers",
    type: "logo",
    local_path: "./cache_hnb/images/hnb_1234_abc123.jpg" // if --download-images enabled
  },
  images: [ /* all images */ ],
  gallery: [ /* gallery images */ ]
}
```

**Features:**
- Extracts all image URLs from HTML content using Cheerio
- Identifies merchant logos (from `assets.hnb.lk/merchants/`)
- Distinguishes between logos and gallery images
- Optional local image download with `--download-images` flag
- Cached in `./cache_hnb/images/`

---

### 2. **Installment Plan Parsing**
```javascript
installment_plans: [
  { months: 3, interest_rate: 0, type: "installment" },
  { months: 6, interest_rate: 0, type: "installment" },
  { months: 12, interest_rate: 0, type: "installment" }
]
```

**Supported Formats:**
- `"0% + 3, 6 & 12 months installment plans"` → parses all three plans
- `"Up to 12 months 0% installments"` → generates common plans (3,6,12)
- `"6 months interest-free installments"` → single plan with 0% rate

---

### 3. **Transaction Amount Ranges**
```javascript
transaction_range: {
  min: 10000,      // Rs. 10,000
  max: 1000000,    // Rs. 1 million
  currency: "LKR"
}
```

**Supported Formats:**
- `"Rs.10,000 to Rs.1 million"` → min/max parsed
- `"Minimum spend Rs. 5,000"` → min only
- `"Up to Rs. 500,000"` → max only
- Handles comma separators and "million" abbreviations

---

### 4. **Card Eligibility & Restrictions**
```javascript
card_eligibility: {
  included_cards: ["All HNB Cards"],
  excluded_cards: ["Corporate", "Business", "Fuel cards"],
  card_types: ["Credit Card", "Debit Card"],
  networks: ["Visa", "Mastercard"],
  restrictions: [
    "Except: Corporate, Business & Fuel cards"
  ]
}
```

**Features:**
- Parses card types (Credit, Debit, Prepaid)
- Identifies networks (Visa, Mastercard, Amex, UnionPay)
- Extracts exclusions from `(except ...)` clauses
- Detects "only" restrictions (e.g., "Visa cards only")

---

### 5. **Source URL Tracking**
```javascript
source_url: "https://venus.hnb.lk/api/get_web_card_promo?id=1234"
```
- Each offer now includes a direct link to its source API endpoint
- Useful for re-fetching or verifying data

---

### 6. **Enhanced Terms Extraction**
```javascript
offer: {
  // ... existing fields
  general_terms: [
    "Offer valid for HNB Credit Card holders only",
    "Cannot be combined with other promotions",
    // ...
  ]
}
```
- Separates "Special Terms" from "General Terms and Conditions"
- Returns structured arrays instead of single text block

---

## 📦 Output Structure Changes

### New Fields in Offer JSON:
```json
{
  "source_url": "https://venus.hnb.lk/api/get_web_card_promo?id=1234",
  "images": {
    "logo": { "url": "...", "alt": "...", "type": "logo" },
    "images": [...],
    "gallery": [...]
  },
  "installment_plans": [
    { "months": 3, "interest_rate": 0, "type": "installment" }
  ],
  "transaction_range": {
    "min": 10000,
    "max": 1000000,
    "currency": "LKR"
  },
  "card_eligibility": {
    "included_cards": [...],
    "excluded_cards": [...],
    "card_types": [...],
    "networks": [...],
    "restrictions": [...]
  },
  "merchant": {
    "name": "...",
    "logo": { "url": "...", "alt": "...", "type": "logo" },
    // ... other fields
  },
  "offer": {
    "description": "...",
    "discount_percentage": 15,
    "general_terms": [...],
    // ... other fields
  }
}
```

### Updated Output Files:
- **`output/hnb_all_v6.json`** - All offers with new fields
- **`output/hnb_validity_rows_v6.json`** - Flattened DB rows (now includes `merchant_logo`)
- **`output/<category>_v6.json`** - Per-category files
- **`output/hnb_raw_v6.json`** - Raw data with HTML content

---

## 🔧 Installation & Usage

### Install Cheerio (new dependency):
```bash
npm install cheerio
```

### Basic Usage:
```bash
# Scrape all categories
node hnb-6.js

# Specific category
node hnb-6.js --category=Jewellery

# With geocoding
node hnb-6.js --google-api-key=AIzaSy...

# Download merchant logos locally
node hnb-6.js --download-images

# Fresh data (no cache)
node hnb-6.js --no-cache
```

### Combined Options:
```bash
node hnb-6.js --category=Dining --download-images --google-api-key=AIzaSy...
```

---

## 📊 Stats Comparison (v5 vs v6)

| Feature | v5 | v6 |
|---------|----|----|
| Merchant logos | ❌ | ✅ (extracted from HTML) |
| Installment plans | ❌ | ✅ (structured parsing) |
| Transaction ranges | ❌ | ✅ (min/max amounts) |
| Card eligibility | Basic | ✅ Enhanced (types, networks, exclusions) |
| Source URLs | ❌ | ✅ (direct API links) |
| General T&Cs | Basic | ✅ Structured arrays |
| Image download | ❌ | ✅ Optional (--download-images) |

---

## 🧪 Example Output

### Lalitha Jewellers Offer (from user's HTML extract):

```json
{
  "unique_id": "hnb_1234",
  "source_url": "https://venus.hnb.lk/api/get_web_card_promo?id=1234",
  "title": "Up to 12 months 0% installments at Lalitha Jewellers",
  "category": "Jewellery",
  "merchant": {
    "name": "Lalitha Jewellers",
    "logo": {
      "url": "https://assets.hnb.lk/atdi/merchants/lalitha-jewellers-logo.jpg",
      "alt": "Lalitha Jewellers",
      "type": "logo"
    }
  },
  "installment_plans": [
    { "months": 3, "interest_rate": 0, "type": "installment" },
    { "months": 6, "interest_rate": 0, "type": "installment" },
    { "months": 12, "interest_rate": 0, "type": "installment" }
  ],
  "transaction_range": {
    "min": 10000,
    "max": 1000000,
    "currency": "LKR"
  },
  "card_eligibility": {
    "included_cards": ["All HNB Cards"],
    "excluded_cards": ["Corporate", "Business", "Fuel cards"],
    "card_types": ["Credit Card"],
    "networks": ["Visa", "Mastercard"],
    "restrictions": [
      "Except: Corporate, Business & Fuel cards"
    ]
  },
  "validity_periods": [
    {
      "valid_from": "2026-01-01",
      "valid_to": "2026-02-28",
      "period_type": "offer",
      "recurrence_type": "daily"
    }
  ]
}
```

---

## 🎯 Use Cases for New Data

### 1. **Merchant Portal Integration**
- Use merchant logos for branding in the dashboard
- Display installment options prominently for consumers
- Show transaction range to set expectations

### 2. **Advanced Filtering**
- Filter by card network (Visa/Mastercard)
- Filter by installment availability
- Filter by minimum spend amount

### 3. **Consumer Experience**
- "0% installments available" badges
- Transaction range warnings: "Minimum spend Rs. 10,000"
- Card eligibility checks before showing offers

### 4. **Data Enrichment**
- Merchant logo URLs for immediate use (no upload needed)
- Structured installment data for finance calculators
- Detailed restrictions for compliance

---

## 🔄 Migration from v5

### Breaking Changes:
- None! v6 is fully backward compatible

### Additions:
- New fields in offer JSON (all optional)
- Requires `cheerio` package

### Recommended Actions:
1. Run `npm install cheerio`
2. Test with single category: `node hnb-6.js --category=Jewellery`
3. Compare output files: `output/jewellery_v6.json` vs `output/jewellery_v5.json`
4. Update database schema to accommodate new fields (optional)

---

## 📝 Database Schema Extensions (Optional)

If importing to PostgreSQL, consider adding:

```sql
-- Add to offers table
ALTER TABLE offers ADD COLUMN merchant_logo_url TEXT;
ALTER TABLE offers ADD COLUMN source_url TEXT;
ALTER TABLE offers ADD COLUMN transaction_min DECIMAL(12,2);
ALTER TABLE offers ADD COLUMN transaction_max DECIMAL(12,2);

-- Create installment_plans table
CREATE TABLE installment_plans (
  id SERIAL PRIMARY KEY,
  offer_id INTEGER REFERENCES offers(id),
  months INTEGER NOT NULL,
  interest_rate DECIMAL(5,2) NOT NULL,
  plan_type VARCHAR(50)
);

-- Create card_eligibility table
CREATE TABLE card_eligibility (
  id SERIAL PRIMARY KEY,
  offer_id INTEGER REFERENCES offers(id),
  card_type VARCHAR(100),
  network VARCHAR(50),
  restriction_type VARCHAR(20), -- 'include' or 'exclude'
  restriction_value TEXT
);
```

---

## ✅ Testing

### Verify Logo Extraction:
```bash
node hnb-6.js --category=Jewellery
cat output/jewellery_v6.json | jq '.offers[] | select(.images.logo != null) | {merchant: .merchant.name, logo: .images.logo.url}'
```

### Verify Installment Parsing:
```bash
cat output/hnb_all_v6.json | jq '.offers[] | select(.installment_plans | length > 0) | {title: .title, plans: .installment_plans}'
```

### Verify Transaction Ranges:
```bash
cat output/hnb_all_v6.json | jq '.offers[] | select(.transaction_range.min != null) | {title: .title, range: .transaction_range}'
```

---

## 🚀 Next Steps

1. **Run v6 scraper:**
   ```bash
   npm install cheerio
   node hnb-6.js
   ```

2. **Compare with v5 output:**
   - Check `stats.offersWithLogos` in console output
   - Review `hnb_all_v6.json` for new fields

3. **Update dashboard integration:**
   - Display merchant logos in offer cards
   - Show installment badges
   - Add transaction range filters

4. **Database migration:**
   - Run schema extensions
   - Import `hnb_validity_rows_v6.json` with new fields

---

**All v5 features retained:**
- ✅ Structured validity periods
- ✅ Multi-period support (booking/stay/travel/installment)
- ✅ Recurrence patterns (weekdays, monthly ranges, specific dates)
- ✅ Time restrictions & exclusions
- ✅ Unique IDs (stable across scrapes)
- ✅ Caching & retry logic
- ✅ Optional geocoding

**Plus v6 enhancements!** 🎉
