# ScrapeNDB Dashboard - Quick Start Guide

## Installation

```bash
cd dashboard
npm install
```

## Start Development Server

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000)

## Dashboard Pages

### 🏠 Dashboard (/)
**Statistics Overview**
- Total offers: 1,093
- Total locations: ~2,400+
- Banks covered: 6
- API usage tracker

**Quick Actions:**
- Run All Scrapers
- View Latest Offers
- Open Map
- Check Geocoding

### 📊 Offers (/offers)
**Interactive Table**
- Search by merchant, discount, category
- Filter by bank, date range, location type
- Sort any column
- Pagination (50 per page)
- Export to CSV
- Expand rows for full details

**Columns:**
- Bank badge
- Merchant name
- Discount
- Category
- Valid dates
- Location type
- Actions

### 🗺️ Map (/map)
**OpenStreetMap Visualization**
- All geocoded locations as markers
- Marker clusters for dense areas
- Color-coded by location type:
  - 🔵 Blue: SINGLE location
  - 🟢 Green: LISTED branches
  - 🟠 Orange: CHAIN (discovered)
  - ⚫ Gray: ONLINE (no location)

**Features:**
- Click marker for offer details
- Filter by bank (checkboxes)
- Filter by location type
- Legend with counts
- Full-screen mode

### ⚙️ Scrapers (/scrapers)
**Run Scrapers**
- Individual bank scrapers
- "Run All Banks" button
- Real-time console output
- Status indicators

**Run Geocoding**
- Select bank or "All"
- Uses cached API key from .env
- Shows progress
- Displays results

**Scraper List:**
- ✅ HNB (hnb-5.js) - 785 offers
- ✅ BOC (boc-5.js) - 19 offers
- ✅ People's Bank (people-4.js) - 108 offers
- ✅ NDB (ndb-4.js) - 55 offers
- ✅ Seylan Bank (seylan-3.js) - 86 offers
- ✅ Sampath Bank (sampath-5.js) - 40 offers

## API Endpoints

### GET /api/offers
```bash
# Get all offers
curl http://localhost:3000/api/offers

# Filter by bank
curl http://localhost:3000/api/offers?bank=hnb

# Search
curl http://localhost:3000/api/offers?search=hotel

# Combine filters
curl http://localhost:3000/api/offers?bank=sampath&category=dining
```

**Response:**
```json
{
  "offers": [...],
  "count": 1093,
  "banks": ["hnb", "boc", ...],
  "categories": [...]
}
```

### POST /api/scrapers
```bash
# Run HNB scraper
curl -X POST http://localhost:3000/api/scrapers \
  -H "Content-Type: application/json" \
  -d '{"bank": "hnb", "action": "scrape"}'

# Run all scrapers
curl -X POST http://localhost:3000/api/scrapers \
  -H "Content-Type: application/json" \
  -d '{"bank": "all", "action": "scrape"}'

# Run geocoding
curl -X POST http://localhost:3000/api/scrapers \
  -H "Content-Type: application/json" \
  -d '{"bank": "sampath", "action": "geocode"}'
```

**Response:** Server-Sent Events (SSE) stream
```
data: {"type":"log","message":"Starting HNB scraper..."}
data: {"type":"log","message":"Fetched 785 offers"}
data: {"type":"complete","success":true}
```

### POST /api/geocode
```bash
curl -X POST http://localhost:3000/api/geocode \
  -H "Content-Type: application/json" \
  -d '{"bank": "sampath"}'
```

**Response:**
```json
{
  "success": true,
  "bank": "sampath",
  "geocoded": 33,
  "total_locations": 82,
  "duration": "3.1s"
}
```

## Features

### 📋 Offers Table Features
- ✅ Real-time search (debounced)
- ✅ Multi-column sorting
- ✅ Advanced filters
- ✅ Expandable rows
- ✅ CSV export
- ✅ Pagination
- ✅ Responsive design

### 🗺️ Map Features
- ✅ OpenStreetMap (no API key needed)
- ✅ Marker clustering
- ✅ Interactive popups
- ✅ Layer controls
- ✅ Bank filtering
- ✅ Location type filtering
- ✅ Custom markers
- ✅ Smooth zoom/pan

### ⚙️ Scraper Features
- ✅ One-click scraping
- ✅ Real-time logs (SSE)
- ✅ Progress indicators
- ✅ Error handling
- ✅ Bulk operations
- ✅ Geocoding integration
- ✅ Auto-scroll logs

### 📊 Dashboard Stats
- ✅ Live data from files
- ✅ API usage tracking
- ✅ Recent activity
- ✅ Quick actions
- ✅ System status

## Keyboard Shortcuts

- `Ctrl+K` - Focus search (on offers page)
- `Esc` - Clear filters
- `/` - Quick navigation

## Troubleshooting

### "Cannot find module" errors
```bash
cd dashboard
rm -rf node_modules package-lock.json
npm install
```

### Map not loading
The map uses dynamic import to avoid SSR issues. Make sure:
1. Leaflet CSS is imported
2. Component uses `'use client'` directive
3. No SSR on MapView component

### Scrapers not running
Check:
1. Node.js scripts exist in parent directory
2. Paths are correct in `.env.local`
3. Scripts are executable
4. Check console logs in browser

### No data showing
Ensure:
1. JSON files exist in `../output/` directory
2. Files are valid JSON
3. Check browser console for errors

## Production Build

```bash
npm run build
npm run start
```

## Environment Variables

Edit `.env.local`:

```bash
# Path to ScrapeNDB root
SCRAPENDB_ROOT=../

# Google Maps API Key
GOOGLE_MAPS_API_KEY=your_key_here

# App settings
NEXT_PUBLIC_APP_NAME=ScrapeNDB Dashboard
NEXT_PUBLIC_APP_VERSION=1.0.0
```

## Data Flow

```
User Action → Dashboard UI → API Route → Node.js Script → JSON Output → UI Update
     ↓              ↓              ↓              ↓              ↓
  Click "Run"   Fetch API    child_process   hnb-5.js    offers_all_v5.json
     ↓              ↓              ↓              ↓              ↓
  See Logs     SSE Stream   stdout/stderr   Console     Table Refresh
```

## File Structure

```
dashboard/
├── app/
│   ├── layout.js           ← Root layout with nav
│   ├── page.js             ← Dashboard home
│   ├── offers/page.js      ← Offers table
│   ├── map/page.js         ← Map view
│   ├── scrapers/page.js    ← Scraper controls
│   └── api/
│       ├── offers/route.js     ← GET /api/offers
│       ├── scrapers/route.js   ← POST /api/scrapers (SSE)
│       └── geocode/route.js    ← POST /api/geocode
│
├── components/
│   ├── Stats.jsx           ← Stat cards
│   ├── OffersTable.jsx     ← Interactive table
│   ├── MapView.jsx         ← Leaflet map
│   └── ScraperControls.jsx ← Scraper UI
│
├── lib/
│   └── data.js             ← Data loading utils
│
└── public/                 ← Static assets
```

## Tips

1. **Performance:** The dashboard loads all offers in memory. For >10K offers, consider pagination at the API level.

2. **Caching:** Offers are loaded fresh on each page load. Add caching for production.

3. **Real-time Updates:** Use polling or WebSockets to refresh data automatically.

4. **Mobile:** Fully responsive design works on tablets and phones.

5. **Dark Mode:** Can be added by extending Tailwind config.

## Next Steps

1. ✅ Install dependencies
2. ✅ Start dev server
3. ✅ Explore dashboard pages
4. ✅ Run a test scraper
5. ✅ View offers in table
6. ✅ Check map visualization
7. ⏭️ Customize as needed

## Support

For issues:
- Check browser console
- Check terminal logs
- Review `lib/data.js` for file paths
- Verify JSON files exist
- Check API endpoint responses

---

**Ready to go!** Start the dashboard with `npm run dev` and visit http://localhost:3000
