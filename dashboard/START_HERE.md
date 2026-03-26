# 🚀 ScrapeNDB Dashboard - START HERE

## ✅ Installation Complete!

All dependencies are installed and ready to go.

## 🎯 Start the Dashboard Now

```bash
cd d:\ScrapeNDB\dashboard
npm run dev
```

Then open: **http://localhost:3000**

## 📱 What You'll See

### 1. **Dashboard Home** (http://localhost:3000)
- 📊 **Statistics Cards**: Total offers (1,093), Locations (~2,400+), Banks (6), API Usage
- 🎯 **Quick Actions**: Run scrapers, view offers, open map, check geocoding
- 📋 **Recent Activity**: Latest scrapes and updates
- 💚 **System Status**: All services operational

### 2. **Offers Table** (http://localhost:3000/offers)
- 🔍 **Search**: Find offers by merchant name, discount, or category
- 🏷️ **Filters**: Bank selector, date range, location type
- 📑 **Sortable Columns**: Click any column header to sort
- 📄 **Pagination**: 50 offers per page with navigation
- 📥 **CSV Export**: Download filtered results
- 🔽 **Expandable Rows**: Click to see full offer details

**Example Filters:**
- Search "hotel" → Shows all hotel offers
- Bank: HNB → Shows only HNB offers (785)
- Location Type: CHAIN → Shows chain merchants

### 3. **Map View** (http://localhost:3000/map)
- 🗺️ **OpenStreetMap**: All geocoded locations on interactive map
- 📍 **Color-Coded Markers**:
  - 🔵 Blue = SINGLE location
  - 🟢 Green = LISTED branches
  - 🟠 Orange = CHAIN (discovered via Places API)
  - ⚫ Gray = ONLINE (no physical location)
- 🎯 **Marker Clusters**: Automatically groups nearby markers
- 🏦 **Bank Filters**: Toggle banks on/off
- 📊 **Legend**: Shows counts per location type
- 💬 **Popups**: Click marker to see offer details

**Map Features:**
- Zoom: Scroll wheel or +/- buttons
- Pan: Click and drag
- Full-screen: Button in top-right
- Center: Auto-centers on Sri Lanka

### 4. **Scrapers Control** (http://localhost:3000/scrapers)
- ▶️ **Run Individual Scraper**: Click button for any bank
- ▶️▶️ **Run All Scrapers**: Scrape all 6 banks sequentially
- 📊 **Real-Time Logs**: Live console output with auto-scroll
- 🎨 **Status Indicators**:
  - ⚪ Gray = Idle (not run yet)
  - 🔵 Blue = Running (in progress)
  - ✅ Green = Success (completed)
  - ❌ Red = Error (failed)
- 🌍 **Run Geocoding**: Select bank and geocode all offers
- 📈 **Progress**: Shows current step and estimated time

**Available Scrapers:**
- HNB (hnb-5.js) → 785 offers → ~2-3 min
- BOC (boc-5.js) → 19 offers → ~5 sec
- People's (people-4.js) → 108 offers → ~20 sec
- NDB (ndb-4.js) → 55 offers → ~15 sec
- Seylan (seylan-3.js) → 86 offers → ~30 sec
- Sampath (sampath-5.js) → 40 offers → ~5 sec

## 🎬 Quick Demo Workflow

### Step 1: View Current Offers
1. Go to **Offers** page
2. See all 1,093 offers in table
3. Try searching "burger king"
4. Filter by bank: "sampath"
5. Export to CSV

### Step 2: Visualize on Map
1. Go to **Map** page
2. See ~2,400 location markers
3. Click on any marker for details
4. Zoom to Colombo area
5. Filter by bank (uncheck HNB to reduce clutter)
6. Click cluster to zoom in

### Step 3: Run a Scraper
1. Go to **Scrapers** page
2. Click "Run Scraper" for BOC (fastest)
3. Watch real-time logs
4. Wait for green success indicator
5. Go back to Offers page to see updated data

### Step 4: Geocode Results
1. Still on **Scrapers** page
2. Select "BOC" from geocoding dropdown
3. Click "Run Geocoding"
4. Watch as addresses are geocoded
5. Go to Map page to see new locations

## 📊 Key Statistics

```
Total Offers:     1,093
Total Locations:  ~2,400+
Banks:            6 (HNB, BOC, People's, NDB, Seylan, Sampath)
Categories:       40+ (dining, hotels, retail, travel, etc.)
Geocoded:         100% (with cache)
API Cost:         $4.98 (initial), $0 (re-runs)
```

## 🔧 Common Tasks

### Update All Bank Offers
```
Scrapers page → Click "Run All Banks" → Wait 4-5 minutes → Done
```

### Find Specific Offers
```
Offers page → Search box → Type "spa" → See all spa offers
```

### Export Current Month's Offers
```
Offers page → Date filter: "Last 30 days" → Export CSV
```

### Check Burger King Locations
```
Offers page → Search "burger king" → Click row → See 20 branches
Map page → Search "burger king" in bank filter → See all markers
```

### Refresh Geocoding
```
Scrapers page → Geocoding section → Select "all" → Run
```

## 📁 File Output Locations

After running scrapers:
```
../output/hnb_all_v5.json        ← HNB offers
../output/boc_all_v5.json        ← BOC offers
../output/peoples_all_v4.json    ← People's offers
../output/ndb_all_v4.json        ← NDB offers
../output/seylan_all_v3.json     ← Seylan offers
../output/sampath_offers_detailed.json  ← Sampath raw data
```

After geocoding:
```
../output/hnb_geo.json     ← HNB locations
../output/boc_geo.json     ← BOC locations
../output/peoples_geo.json ← People's locations
../output/ndb_geo.json     ← NDB locations
../output/seylan_geo.json  ← Seylan locations
../output/sampath_geo.json ← Sampath locations
```

## ⚙️ Configuration

Edit `.env.local` if needed:
```bash
SCRAPENDB_ROOT=../
GOOGLE_MAPS_API_KEY=AIzaSyCpLiXfPxrkARAmbWay3jyYweZuB1tIH-8
```

## 🐛 Troubleshooting

**Dashboard won't start?**
```bash
cd dashboard
rm -rf node_modules .next
npm install
npm run dev
```

**No offers showing?**
- Check that JSON files exist in `../output/` directory
- Run scrapers first from Scrapers page
- Check browser console for errors

**Map not loading?**
- Refresh the page
- Check browser console
- Ensure internet connection (for map tiles)

**Scraper fails?**
- Check that bank website is accessible
- Check console logs for specific error
- Verify Node.js scripts exist in parent directory

## 📚 Documentation

- [QUICKSTART.md](QUICKSTART.md) - Detailed guide with API docs
- [README.md](README.md) - Technical documentation
- [SETUP.md](SETUP.md) - Setup and configuration
- [../README.md](../README.md) - ScrapeNDB project docs
- [../geo/README.md](../geo/README.md) - Geocoding docs

## 🎨 Customization

### Change Theme Colors
Edit `tailwind.config.js`:
```javascript
colors: {
  primary: { 500: '#your-color' }
}
```

### Add More Banks
1. Create scraper script (e.g., `dfcc-1.js`)
2. Add to `lib/data.js` → `getBankList()`
3. Add to scrapers page
4. Create geo adapter

### Add Dark Mode
Install `next-themes` and add theme toggle

## 🚀 Next Features (Optional)

- [ ] User authentication
- [ ] Database integration (PostgreSQL)
- [ ] API rate limiting
- [ ] Scheduled scraping (cron jobs)
- [ ] Email alerts for new offers
- [ ] Mobile app (React Native)
- [ ] Advanced analytics
- [ ] Offer comparison tool
- [ ] User favorites/bookmarks

---

## 🎉 You're All Set!

### Start Now:
```bash
npm run dev
```

### Then visit:
**http://localhost:3000**

Enjoy exploring 1,093 bank offers with full geocoding across Sri Lanka! 🇱🇰
