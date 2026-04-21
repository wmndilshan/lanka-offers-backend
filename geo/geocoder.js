/**
 * Shared Geocoding Engine for ScrapeNDB
 * - GeoCache: persistent file cache (never expires)
 * - ApiTracker: monthly API usage tracking (10K free/month limits)
 * - Geocoder: Google Geocoding API + Places Text Search (New)
 *
 * Usage:
 *   const { GeoCache, Geocoder, ApiTracker } = require('./geocoder');
 *   const cache = new GeoCache('./cache_geo');
 *   const tracker = new ApiTracker('./cache_geo');
 *   const geo = new Geocoder({ apiKey: 'xxx', cache, tracker, concurrency: 5 });
 *   const result = await geo.geocodeAddress('724 Matara Road, Galle, Sri Lanka');
 *   const branches = await geo.findChainBranches('Subway restaurant Sri Lanka');
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── p-limit with CJS fallback ─────────────────────────────────────────────
let pLimit;
try {
  pLimit = require('p-limit');
  if (pLimit.default) pLimit = pLimit.default;
} catch (e) {
  pLimit = (concurrency) => {
    const queue = [];
    let active = 0;
    const next = () => { active--; if (queue.length > 0) { const { fn, resolve, reject } = queue.shift(); run(fn, resolve, reject); } };
    const run = async (fn, resolve, reject) => { active++; try { resolve(await fn()); } catch (err) { reject(err); } finally { next(); } };
    return (fn) => new Promise((resolve, reject) => { if (active < concurrency) run(fn, resolve, reject); else queue.push({ fn, resolve, reject }); });
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ═══════════════════════════════════════════════════════════════════════════
// GeoCache — persistent file cache, never expires
// ═══════════════════════════════════════════════════════════════════════════

// Places results expire after this many days (chain branches open/close over time).
// Geocoding results never expire — addresses don't move.
const PLACES_TTL_DAYS = 60;

class GeoCache {
  constructor(cacheDir = './cache_geo', { placesTtlDays = PLACES_TTL_DAYS } = {}) {
    this.geocodeDir = path.join(cacheDir, 'geocode');
    this.placesDir = path.join(cacheDir, 'places');
    this.placesTtlMs = placesTtlDays * 24 * 60 * 60 * 1000;
    [this.geocodeDir, this.placesDir].forEach(d => {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    });
  }

  _hash(key) {
    return crypto.createHash('md5').update(key.toLowerCase().trim().replace(/\s+/g, ' ')).digest('hex');
  }

  // ── Geocoding API cache ──────────────────────────────────────────────
  getGeocode(address) {
    const p = path.join(this.geocodeDir, `${this._hash(address)}.json`);
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')).result; }
    catch (e) { return null; }
  }

  setGeocode(address, result) {
    const p = path.join(this.geocodeDir, `${this._hash(address)}.json`);
    fs.writeFileSync(p, JSON.stringify({ address, result, cached_at: new Date().toISOString() }, null, 2));
  }

  // ── Places Text Search cache (60-day TTL) ────────────────────────────
  getPlaces(query) {
    const p = path.join(this.placesDir, `${this._hash(query)}.json`);
    if (!fs.existsSync(p)) return null;
    try {
      const stored = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (stored.cached_at) {
        const age = Date.now() - new Date(stored.cached_at).getTime();
        if (age > this.placesTtlMs) return null; // expired — force refresh
      }
      return stored.results;
    }
    catch (e) { return null; }
  }

  setPlaces(query, results) {
    const p = path.join(this.placesDir, `${this._hash(query)}.json`);
    fs.writeFileSync(p, JSON.stringify({ query, results, cached_at: new Date().toISOString() }, null, 2));
  }

  // ── Stats ────────────────────────────────────────────────────────────
  getStats() {
    const countFiles = dir => fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).length : 0;
    return {
      geocode_cached: countFiles(this.geocodeDir),
      places_cached: countFiles(this.placesDir)
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ApiTracker — monthly API usage tracking with 10K free tier warnings
// ═══════════════════════════════════════════════════════════════════════════

const API_LIMITS = {
  geocoding: { free: 10000, pricePerK: 5.00, name: 'Geocoding API' },
  places:    { free: 10000, pricePerK: 32.00, name: 'Places API (New)' }
};

class ApiTracker {
  constructor(cacheDir = './cache_geo') {
    this.filePath = path.join(cacheDir, 'api_usage.json');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    this.data = this._load();
  }

  _load() {
    if (fs.existsSync(this.filePath)) {
      try { return JSON.parse(fs.readFileSync(this.filePath, 'utf8')); }
      catch (e) { /* corrupted, start fresh */ }
    }
    return { geocoding: {}, places: {} };
  }

  _save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  _monthKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /** Record an API call. type = 'geocoding' | 'places' */
  record(type, query) {
    const month = this._monthKey();
    if (!this.data[type]) this.data[type] = {};
    if (!this.data[type][month]) {
      this.data[type][month] = { count: 0, first_call: new Date().toISOString(), queries: [] };
    }
    const entry = this.data[type][month];
    entry.count++;
    entry.last_call = new Date().toISOString();
    // Store last 500 queries per month for debugging (truncate query to 100 chars)
    if (entry.queries.length < 500) {
      entry.queries.push({ q: query.substring(0, 100), at: new Date().toISOString() });
    }
    this._save();
    return entry.count;
  }

  /** Get usage for current month */
  getMonthlyUsage(type) {
    const month = this._monthKey();
    return this.data[type]?.[month]?.count || 0;
  }

  /** Check if approaching limit, return warning string or null */
  checkLimit(type) {
    const usage = this.getMonthlyUsage(type);
    const limit = API_LIMITS[type];
    if (!limit) return null;

    if (usage >= limit.free) {
      return `  ⚠️  ${limit.name}: ${usage}/${limit.free} — OVER FREE LIMIT! Charges apply ($${limit.pricePerK}/1K)`;
    }
    if (usage >= limit.free * 0.8) {
      return `  ⚠️  ${limit.name}: ${usage}/${limit.free} — approaching free limit (80%)`;
    }
    if (usage >= limit.free * 0.5) {
      return `  ℹ️  ${limit.name}: ${usage}/${limit.free} — 50% of free tier used`;
    }
    return null;
  }

  /** Get full report for display */
  getReport() {
    const month = this._monthKey();
    const lines = [];
    lines.push(`  API Usage Tracker — ${month}`);
    lines.push('  ' + '─'.repeat(50));

    for (const [type, limit] of Object.entries(API_LIMITS)) {
      const usage = this.getMonthlyUsage(type);
      const pct = ((usage / limit.free) * 100).toFixed(1);
      const bar = this._bar(usage, limit.free, 20);
      const cost = usage > limit.free ? `$${((usage - limit.free) / 1000 * limit.pricePerK).toFixed(2)} billed` : 'free';
      lines.push(`  ${limit.name.padEnd(20)} ${bar} ${usage.toLocaleString().padStart(6)}/${limit.free.toLocaleString()} (${pct}%) — ${cost}`);
    }

    // History
    const allMonths = new Set();
    Object.values(this.data).forEach(typeData => Object.keys(typeData).forEach(m => allMonths.add(m)));
    const sortedMonths = [...allMonths].sort().reverse();

    if (sortedMonths.length > 1) {
      lines.push('\n  History:');
      for (const m of sortedMonths.slice(0, 6)) {
        const geo = this.data.geocoding?.[m]?.count || 0;
        const plc = this.data.places?.[m]?.count || 0;
        lines.push(`    ${m}: Geocoding ${geo}, Places ${plc}`);
      }
    }

    return lines.join('\n');
  }

  _bar(value, max, width) {
    const filled = Math.min(Math.round((value / max) * width), width);
    const empty = width - filled;
    const char = value >= max ? '█' : '▓';
    return '[' + char.repeat(filled) + '░'.repeat(empty) + ']';
  }

  /** Get estimated cost for new API calls this session */
  getSessionCost(geocodeNew, placesNew) {
    const geoCost = geocodeNew * (API_LIMITS.geocoding.pricePerK / 1000);
    const placesCost = placesNew * (API_LIMITS.places.pricePerK / 1000);
    return { geocoding: geoCost, places: placesCost, total: geoCost + placesCost };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Geocoder — Google API wrapper with cache + rate limiting
// ═══════════════════════════════════════════════════════════════════════════

class Geocoder {
  constructor({ apiKey, cache, tracker, concurrency = 5, requestDelay = 150 }) {
    if (!apiKey) throw new Error('Google API key required');
    this.apiKey = apiKey;
    this.cache = cache;
    this.tracker = tracker || null;
    this.concurrency = concurrency;
    this.requestDelay = requestDelay;
    this.stats = { geocode_cached: 0, geocode_new: 0, geocode_failed: 0, places_cached: 0, places_new: 0 };
  }

  _isInSriLanka(lat, lng) {
    return lat >= 5.9 && lat <= 10.0 && lng >= 79.5 && lng <= 82.0;
  }

  // ── Geocoding API ($5/1K) — single address → lat/lng ─────────────────
  async geocodeAddress(address, retryCount = 0) {
    // Ensure Sri Lanka suffix
    const searchAddr = address.toLowerCase().includes('sri lanka') ? address : `${address}, Sri Lanka`;

    // Cache first
    const cached = this.cache.getGeocode(searchAddr);
    if (cached) {
      this.stats.geocode_cached++;
      return cached;
    }

    try {
      const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
        params: { address: searchAddr, key: this.apiKey, region: 'lk', components: 'country:LK' },
        timeout: 10000
      });

      // Track API call
      if (this.tracker) this.tracker.record('geocoding', searchAddr);

      let result;
      if (response.data.status === 'OK' && response.data.results.length > 0) {
        const r = response.data.results[0];
        result = {
          success: true,
          search_address: searchAddr,
          formatted_address: r.formatted_address,
          latitude: r.geometry.location.lat,
          longitude: r.geometry.location.lng,
          place_id: r.place_id,
          types: r.types,
          address_components: r.address_components.map(c => ({
            long_name: c.long_name, short_name: c.short_name, types: c.types
          })),
          timestamp: new Date().toISOString()
        };
        if (!this._isInSriLanka(result.latitude, result.longitude)) {
          result.success = false;
          result.error = 'OUT_OF_BOUNDS';
          result.message = 'Coordinates outside Sri Lanka bounds';
        }
        this.stats.geocode_new++;
      } else {
        result = {
          success: false,
          search_address: searchAddr,
          error: response.data.status,
          message: response.data.error_message || 'Not found',
          timestamp: new Date().toISOString()
        };
        this.stats.geocode_failed++;
      }

      this.cache.setGeocode(searchAddr, result);
      await sleep(this.requestDelay);
      return result;

    } catch (error) {
      if (error.response?.status === 429 && retryCount < 3) {
        const backoff = 2000 * Math.pow(2, retryCount);
        console.log(`      Rate limited, retrying in ${backoff}ms...`);
        await sleep(backoff);
        return this.geocodeAddress(address, retryCount + 1);
      }

      const result = {
        success: false,
        search_address: searchAddr,
        error: 'API_ERROR',
        message: error.message,
        timestamp: new Date().toISOString()
      };
      this.stats.geocode_failed++;
      this.cache.setGeocode(searchAddr, result);
      return result;
    }
  }

  // ── Places Text Search (New API) — find all branches of a chain ─────
  async findChainBranches(searchQuery, retryCount = 0) {
    // Cache first
    const cached = this.cache.getPlaces(searchQuery);
    if (cached) {
      this.stats.places_cached++;
      return cached;
    }

    const allResults = [];
    let pageToken = null;

    const FIELD_MASK = [
      'places.id', 'places.displayName', 'places.formattedAddress',
      'places.location', 'places.types', 'places.rating',
      'places.userRatingCount', 'places.businessStatus',
      'nextPageToken'
    ].join(',');

    try {
      do {
        const body = {
          textQuery: searchQuery,
          regionCode: 'LK',
          pageSize: 20
        };
        if (pageToken) {
          body.pageToken = pageToken;
          await sleep(2000);
        }

        // Track API call (each page counts as one request)
        if (this.tracker) this.tracker.record('places', pageToken ? `${searchQuery} [page]` : searchQuery);
        this.stats.places_new++;

        const response = await axios.post(
          'https://places.googleapis.com/v1/places:searchText',
          body,
          {
            headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': this.apiKey,
              'X-Goog-FieldMask': FIELD_MASK
            },
            timeout: 15000
          }
        );

        if (response.data.places && response.data.places.length > 0) {
          response.data.places.forEach(r => {
            allResults.push({
              name: r.displayName?.text || '',
              formatted_address: r.formattedAddress || '',
              latitude: r.location?.latitude || 0,
              longitude: r.location?.longitude || 0,
              place_id: r.id || '',
              types: r.types || [],
              rating: r.rating || null,
              user_ratings_total: r.userRatingCount || 0,
              business_status: r.businessStatus || 'UNKNOWN'
            });
          });
          pageToken = response.data.nextPageToken || null;
        } else {
          pageToken = null;
        }
      } while (pageToken);

      this.cache.setPlaces(searchQuery, allResults);
      await sleep(this.requestDelay);
      return allResults;

    } catch (error) {
      if (error.response?.status === 429 && retryCount < 3) {
        const backoff = 3000 * Math.pow(2, retryCount);
        console.log(`      Places rate limited, retrying in ${backoff}ms...`);
        await sleep(backoff);
        return this.findChainBranches(searchQuery, retryCount + 1);
      }
      const msg = error.response?.data?.error?.message || error.message;
      console.log(`      Places API error: ${msg}`);
      this.cache.setPlaces(searchQuery, []);
      return [];
    }
  }

  // ── Batch geocoding with concurrency limit ────────────────────────────
  async geocodeBatch(addresses) {
    const limit = pLimit(this.concurrency);
    const results = new Map();
    await Promise.all(
      addresses.map(addr => limit(async () => {
        results.set(addr, await this.geocodeAddress(addr));
      }))
    );
    return results;
  }

  getStats() { return { ...this.stats }; }
}

module.exports = { GeoCache, Geocoder, ApiTracker };
