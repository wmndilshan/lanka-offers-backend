# ScrapeNDB Dashboard

A Next.js 14 admin dashboard for managing and visualizing bank offer scrapers.

## Features

- **Dashboard Home**: Overview with statistics and recent activity
- **Offers Page**: Browse, search, and filter all bank offers with export to CSV
- **Map Page**: Interactive map showing geocoded offer locations with filtering
- **Scrapers Page**: Control panel to run scrapers and geocoding processes

## Getting Started

### Installation

```bash
cd dashboard
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the dashboard.

### Production Build

```bash
npm run build
npm start
```

## Project Structure

```
dashboard/
├── app/
│   ├── layout.js          # Root layout with navigation
│   ├── page.js            # Dashboard home
│   ├── globals.css        # Global styles
│   ├── offers/
│   │   └── page.js        # Offers page
│   ├── map/
│   │   └── page.js        # Map page
│   ├── scrapers/
│   │   └── page.js        # Scrapers page
│   └── api/
│       ├── offers/
│       │   └── route.js   # Offers API endpoint
│       ├── scrapers/
│       │   └── route.js   # Scrapers API endpoint
│       └── geocode/
│           └── route.js   # Geocoding API endpoint
├── components/
│   ├── Stats.jsx          # Statistics card component
│   ├── OffersTable.jsx    # Offers table with filtering
│   ├── MapView.jsx        # Leaflet map component
│   └── ScraperControls.jsx # Scraper control panel
├── lib/
│   └── data.js            # Data loading utilities
├── package.json
├── tailwind.config.js
├── postcss.config.js
└── next.config.js
```

## API Endpoints

### GET /api/offers
Returns all offers with optional filtering.

Query parameters:
- `bank`: Filter by bank (e.g., 'hnb', 'boc')
- `search`: Search in merchant, discount, category
- `category`: Filter by category

### POST /api/scrapers
Runs a scraper or all scrapers.

Body:
```json
{
  "bank": "hnb" | "all",
  "action": "scrape"
}
```

Returns a streaming response with logs.

### POST /api/geocode
Runs geocoding for a specific bank.

Body:
```json
{
  "bank": "sampath",
  "apiKey": "optional-api-key"
}
```

## Technologies Used

- Next.js 14 (App Router)
- React 18
- Tailwind CSS
- Leaflet & React Leaflet (maps)
- Lucide React (icons)
- Node.js fs (file system operations)

## Notes

- The dashboard reads data from `../output/*.json` files
- Geocoded data is read from `../output/*_geo.json` files
- Scrapers are executed as child processes from the parent directory
- All API routes include proper error handling
- Components use 'use client' directive where needed for interactivity
