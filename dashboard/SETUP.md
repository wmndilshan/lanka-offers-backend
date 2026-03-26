# ScrapeNDB Dashboard Setup Guide

## Quick Start

### 1. Install Dependencies

```bash
cd d:\ScrapeNDB\dashboard
npm install
```

This will install:
- Next.js 14
- React 18
- Tailwind CSS
- Leaflet (mapping library)
- React Leaflet & React Leaflet Cluster
- Lucide React (icons)

### 2. Run Development Server

```bash
npm run dev
```

The dashboard will be available at [http://localhost:3000](http://localhost:3000)

### 3. Build for Production

```bash
npm run build
npm start
```

## Dashboard Pages

### 1. Dashboard Home (`/`)
- Statistics cards showing total offers, locations, banks, and API usage
- Recent offers list (last 10)
- Quick action buttons
- System status indicators

### 2. Offers Page (`/offers`)
- Complete table of all bank offers
- Search functionality (merchant, discount)
- Filters by bank and category
- Sortable columns
- Expandable rows for full details
- Export to CSV functionality
- Pagination (50 items per page)

### 3. Map Page (`/map`)
- Interactive Leaflet map
- Marker clusters for dense areas
- Color-coded markers by location type:
  - Blue: Single Location
  - Green: Listed Branches
  - Purple: Chain/Island-wide
  - Orange: Online Only
- Filter by bank
- Popup details on marker click

### 4. Scrapers Page (`/scrapers`)
- Run individual bank scrapers
- Run all scrapers at once
- Geocoding controls
- Real-time console output
- Status indicators (idle, running, success, error)

## API Routes

### GET `/api/offers`
Query parameters:
- `bank`: Filter by bank name
- `search`: Search term
- `category`: Filter by category

### POST `/api/scrapers`
Body:
```json
{
  "bank": "hnb" | "boc" | "peoples" | "ndb" | "seylan" | "sampath" | "all",
  "action": "scrape"
}
```

Returns Server-Sent Events (SSE) stream with real-time logs.

### POST `/api/geocode`
Body:
```json
{
  "bank": "hnb",
  "apiKey": "optional-google-maps-api-key"
}
```

## File Structure

```
dashboard/
├── app/                      # Next.js App Router
│   ├── layout.js            # Root layout with sidebar navigation
│   ├── page.js              # Dashboard home page
│   ├── globals.css          # Global styles & Tailwind imports
│   ├── offers/
│   │   └── page.js          # Offers listing page
│   ├── map/
│   │   └── page.js          # Map visualization page
│   ├── scrapers/
│   │   └── page.js          # Scraper controls page
│   └── api/
│       ├── offers/
│       │   └── route.js     # Offers API endpoint
│       ├── scrapers/
│       │   └── route.js     # Scrapers execution API
│       └── geocode/
│           └── route.js     # Geocoding API
├── components/              # Reusable React components
│   ├── Stats.jsx           # Statistics card component
│   ├── OffersTable.jsx     # Offers table with filters
│   ├── MapView.jsx         # Leaflet map component
│   └── ScraperControls.jsx # Scraper control panel
├── lib/
│   └── data.js             # Data loading utilities
├── public/                  # Static assets
├── package.json            # Dependencies
├── tailwind.config.js      # Tailwind configuration
├── postcss.config.js       # PostCSS configuration
└── next.config.js          # Next.js configuration

```

## Data Flow

1. **Data Source**: The dashboard reads JSON files from `d:\ScrapeNDB\output\`
   - `*.json` files contain offer data
   - `*_geo.json` files contain geocoded location data

2. **Data Loading**: `lib/data.js` provides functions:
   - `loadAllOffers()` - Loads all offers
   - `loadGeoData()` - Loads geocoded locations
   - `getStats()` - Calculates statistics
   - `getBankList()` - Returns supported banks
   - `filterOffers()` - Filters offers by criteria

3. **API Layer**: Next.js API routes handle:
   - Fetching and filtering data
   - Running scraper processes
   - Executing geocoding scripts

4. **UI Components**: React components display data and provide interactivity

## Key Features

### Responsive Design
- Mobile-friendly sidebar (hidden on small screens)
- Responsive grid layouts
- Touch-friendly controls

### Interactive Components
All interactive components use the `'use client'` directive:
- Stats cards with hover effects
- Sortable, filterable tables
- Interactive map with markers
- Real-time scraper logs

### Error Handling
- All API routes include try-catch blocks
- Graceful fallbacks for missing data
- User-friendly error messages

### Performance
- Dynamic imports for heavy components (Leaflet)
- Pagination for large datasets
- Memoized computations
- Optimized re-renders

## Troubleshooting

### Map not loading
- Ensure Leaflet CSS is imported in MapView.jsx
- Check that react-leaflet-cluster is installed
- Verify dynamic import is used (SSR disabled)

### Scrapers not running
- Check that scraper scripts exist in parent directory
- Verify Node.js is in PATH
- Check console for error messages

### No data showing
- Run scrapers first to generate JSON files
- Verify output directory exists: `d:\ScrapeNDB\output\`
- Check file permissions

### Port already in use
```bash
# Kill process on port 3000
npx kill-port 3000
# Or use a different port
npm run dev -- -p 3001
```

## Next Steps

1. Install dependencies: `npm install`
2. Run development server: `npm run dev`
3. Navigate to [http://localhost:3000](http://localhost:3000)
4. Run scrapers from the Scrapers page
5. View offers and map visualizations

## Support

For issues or questions, refer to the main README.md or check the Next.js documentation at [nextjs.org](https://nextjs.org/)
