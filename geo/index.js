/**
 * Geocoding CLI for ScrapeNDB
 * Shared geocoding module for all bank scrapers
 *
 * Usage:
 *   node geo/index.js --bank=sampath --google-api-key=YOUR_KEY
 *   node geo/index.js --bank=hnb --google-api-key=YOUR_KEY
 *   node geo/index.js --bank=all --google-api-key=YOUR_KEY
 *   node geo/index.js --bank=sampath --dry-run
 *   node geo/index.js --stats
 *
 * Options:
 *   --bank=<name>          Bank adapter (sampath|hnb|boc|peoples|seylan|ndb|all)
 *   --input=<file>         Override input file
 *   --output=<file>        Override output file
 *   --google-api-key=KEY   Google API key (or GOOGLE_MAPS_API_KEY env var)
 *   --skip-chains          Skip Places API calls for chain merchants
 *   --dry-run              Show classification without API calls
 *   --concurrency=N        Parallel API requests (default: 5)
 *   --stats                Show cache statistics
 */

const fs = require('fs');
const path = require('path');
const { GeoCache, Geocoder, ApiTracker } = require('./geocoder');
const { getAdapter, listBanks } = require('./adapters');
const { classify, LOC_TYPES } = require('./branch-parser');
const { createLogger } = require('../lib/logger');
const { listBanksByCapability, resolveOutputPath } = require('../lib/bank-registry');
const log = createLogger('geo');

const CACHE_DIR = path.join(__dirname, '..', 'cache_geo');

// ─── Parse CLI args ─────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    bank: null,
    input: null,
    output: null,
    apiKey: process.env.GOOGLE_MAPS_API_KEY || '',
    skipChains: false,
    dryRun: false,
    concurrency: 5,
    stats: false
  };

  args.forEach(arg => {
    if (arg.startsWith('--bank=')) opts.bank = arg.split('=')[1];
    else if (arg.startsWith('--input=')) opts.input = arg.split('=')[1];
    else if (arg.startsWith('--output=')) opts.output = arg.split('=')[1];
    else if (arg.startsWith('--google-api-key=')) opts.apiKey = arg.split('=')[1];
    else if (arg === '--skip-chains') opts.skipChains = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg.startsWith('--concurrency=')) opts.concurrency = parseInt(arg.split('=')[1], 10);
    else if (arg === '--stats') opts.stats = true;
  });

  return opts;
}

// ─── Process a single bank ──────────────────────────────────────────────────
async function processBank(bankName, opts, cache, geocoder) {
  const adapter = getAdapter(bankName);
  const inputFile = opts.input || resolveOutputPath(bankName, 'structured', path.join(__dirname, '..'));
  const outputFile = opts.output || resolveOutputPath(bankName, 'geo', path.join(__dirname, '..'));

  log.info('Geocoder', `Processing bank: ${bankName}`, { bank: bankName, input: inputFile });

  if (!fs.existsSync(inputFile)) {
    log.warn('Geocoder', `Input file not found: ${inputFile} — run ${bankName} scraper first`, { bank: bankName });
    return null;
  }

  log.debug('Geocoder', `Loading: ${inputFile}`);
  const offers = adapter.loadOffers(inputFile);
  log.info('Geocoder', `Loaded ${offers.length} offers for ${bankName}`, { count: offers.length });


  // ── Classify and process each offer ─────────────────────────────────
  const results = [];
  const typeCounts = { SINGLE: 0, LISTED: 0, CHAIN: 0, ONLINE: 0, NONE: 0 };
  let processed = 0;

  for (const offer of offers) {
    processed++;
    const locData = adapter.extractLocationData(offer);
    const classification = classify(locData);
    typeCounts[classification.type]++;

    const progress = `[${processed}/${offers.length}]`;
    const safeName = (locData.merchant_name || '').substring(0, 30);

    if (opts.dryRun) {
      const addr = classification.addresses.length > 0 ? classification.addresses[0].substring(0, 60) : classification.chainQuery || '(none)';
      console.log(`  ${progress} ${classification.type.padEnd(7)} ${safeName.padEnd(32)} ${addr}`);
      results.push({
        offer_id: locData.offer_id,
        merchant_name: locData.merchant_name,
        location_type: classification.type,
        would_search: classification.addresses.length > 0 ? classification.addresses : (classification.chainQuery ? [classification.chainQuery] : []),
        locations: []
      });
      continue;
    }

    // ── Geocode based on type ─────────────────────────────────────────
    const locations = [];

    switch (classification.type) {
      case LOC_TYPES.SINGLE: {
        const addr = classification.addresses[0];
        console.log(`  ${progress} SINGLE  ${safeName.padEnd(32)} → ${addr.substring(0, 50)}`);
        const result = await geocoder.geocodeAddress(addr);
        locations.push({ source: 'geocoding_api', ...result });
        break;
      }

      case LOC_TYPES.LISTED: {
        const addrs = classification.addresses;
        console.log(`  ${progress} LISTED  ${safeName.padEnd(32)} → ${addrs.length} branches`);
        const batch = await geocoder.geocodeBatch(addrs);
        for (const addr of addrs) {
          const result = batch.get(addr);
          locations.push({ source: 'geocoding_api', branch_name: addr, ...result });
        }
        break;
      }

      case LOC_TYPES.CHAIN: {
        if (opts.skipChains) {
          console.log(`  ${progress} CHAIN   ${safeName.padEnd(32)} → SKIPPED`);
        } else {
          const query = classification.chainQuery;
          console.log(`  ${progress} CHAIN   ${safeName.padEnd(32)} → searching: ${query}`);
          const branches = await geocoder.findChainBranches(query);
          branches.forEach(b => {
            locations.push({ source: 'places_text_search', ...b });
          });
          console.log(`           Found ${branches.length} branches`);
        }
        break;
      }

      case LOC_TYPES.ONLINE:
        console.log(`  ${progress} ONLINE  ${safeName}`);
        break;

      case LOC_TYPES.NONE:
        console.log(`  ${progress} NONE    ${safeName}`);
        break;
    }

    results.push({
      offer_id: locData.offer_id,
      merchant_name: locData.merchant_name,
      location_type: classification.type,
      locations: locations
    });
  }

  // ── Save output ───────────────────────────────────────────────────────
  const dedupedMap = new Map();
  let duplicateOfferRows = 0;
  for (const row of results) {
    const key = row.offer_id || '';
    if (!key) continue;
    const existing = dedupedMap.get(key);
    if (!existing) {
      dedupedMap.set(key, row);
      continue;
    }
    duplicateOfferRows++;
    if (!existing.locations) existing.locations = [];
    if (row.locations && row.locations.length) {
      existing.locations.push(...row.locations);
      const seen = new Set();
      existing.locations = existing.locations.filter(loc => {
        const locKey = [
          loc.place_id || '',
          loc.latitude ?? '',
          loc.longitude ?? '',
          loc.formatted_address || ''
        ].join('|');
        if (seen.has(locKey)) return false;
        seen.add(locKey);
        return true;
      });
    }
  }
  const dedupedResults = [...dedupedMap.values()];
  const stats = geocoder ? geocoder.getStats() : {};
  const output = {
    metadata: {
      source: bankName,
      geocoded_at: new Date().toISOString(),
      total_offers: offers.length,
      location_types: typeCounts,
      geocoded_count: dedupedResults.filter(r => r.locations.length > 0).length,
      total_locations: dedupedResults.reduce((sum, r) => sum + r.locations.length, 0),
      duplicate_offer_rows_removed: duplicateOfferRows,
      api_stats: stats,
      dry_run: opts.dryRun
    },
    offers: dedupedResults
  };

  if (!fs.existsSync('./output')) fs.mkdirSync('./output', { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  console.log(`\n  Saved: ${outputFile}`);

  return { bankName, typeCounts, stats, outputFile, totalOffers: offers.length };
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║   ScrapeNDB Geocoding Module                   ║');
  console.log('║   ✓ Persistent cache (never expires)          ║');
  console.log('║   ✓ Single / Listed / Chain branch support    ║');
  console.log('║   ✓ Bank-specific address adapters            ║');
  console.log('╚════════════════════════════════════════════════╝');

  const opts = parseArgs();

  // ── Stats mode ──────────────────────────────────────────────────────
  if (opts.stats) {
    const cache = new GeoCache(CACHE_DIR);
    const tracker = new ApiTracker(CACHE_DIR);
    const s = cache.getStats();
    console.log(`\n  Cache directory: ${CACHE_DIR}`);
    console.log(`  Geocoding results: ${s.geocode_cached}`);
    console.log(`  Places searches:   ${s.places_cached}`);
    console.log('');
    console.log(tracker.getReport());
    console.log(`\n  Available banks: ${listBanksByCapability('geocode').join(', ')}`);
    return;
  }

  // ── Validate ────────────────────────────────────────────────────────
  if (!opts.bank) {
    console.error('\n  ❌ --bank=<name> required');
    console.error(`     Available: ${listBanksByCapability('geocode').join(', ')}, all`);
    console.error('\n  Usage:');
    console.error('     node geo/index.js --bank=sampath --google-api-key=YOUR_KEY');
    console.error('     node geo/index.js --bank=all --google-api-key=YOUR_KEY');
    console.error('     node geo/index.js --bank=sampath --dry-run');
    console.error('     node geo/index.js --stats');
    process.exit(1);
  }

  if (!opts.dryRun && !opts.apiKey) {
    console.error('\n  ❌ Google API key required (use --google-api-key=KEY or GOOGLE_MAPS_API_KEY env var)');
    process.exit(1);
  }

  // ── Initialize ──────────────────────────────────────────────────────
  const cache = new GeoCache(CACHE_DIR);
  const tracker = new ApiTracker(CACHE_DIR);
  let geocoder = null;
  if (!opts.dryRun) {
    // Show pre-run API usage warnings
    ['geocoding', 'places'].forEach(type => {
      const warning = tracker.checkLimit(type);
      if (warning) console.log(warning);
    });

    geocoder = new Geocoder({
      apiKey: opts.apiKey,
      cache: cache,
      tracker: tracker,
      concurrency: opts.concurrency,
      requestDelay: 150
    });
  }

  const startTime = Date.now();
  const banks = opts.bank === 'all' ? listBanksByCapability('geocode') : [opts.bank];

  console.log(`\n  Banks: ${banks.join(', ')}`);
  console.log(`  Mode: ${opts.dryRun ? 'DRY RUN (no API calls)' : 'LIVE'}`);
  if (opts.skipChains) console.log('  Chains: SKIPPED');

  const summaries = [];
  for (const bank of banks) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ${bank.toUpperCase()}`);
    console.log('═'.repeat(60));

    try {
      const summary = await processBank(bank, { ...opts, output: opts.bank === 'all' ? null : opts.output }, cache, geocoder);
      if (summary) summaries.push(summary);
    } catch (err) {
      console.error(`  ❌ Error processing ${bank}: ${err.message}`);
    }
  }

  // ── Final summary ─────────────────────────────────────────────────────
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  FINAL SUMMARY');
  console.log('═'.repeat(60));

  let totalOffers = 0, totalLocations = 0;
  summaries.forEach(s => {
    totalOffers += s.totalOffers;
    console.log(`\n  ${s.bankName.toUpperCase()}: ${s.totalOffers} offers`);
    Object.entries(s.typeCounts).forEach(([t, c]) => {
      if (c > 0) console.log(`    ${t.padEnd(10)}: ${c}`);
    });
    console.log(`    Output: ${s.outputFile}`);
  });

  if (geocoder) {
    const stats = geocoder.getStats();
    console.log('\n  Session API Usage:');
    console.log(`    Geocoding - cached: ${stats.geocode_cached}, new: ${stats.geocode_new}, failed: ${stats.geocode_failed}`);
    console.log(`    Places    - cached: ${stats.places_cached}, new: ${stats.places_new}`);
    const cost = tracker.getSessionCost(stats.geocode_new, stats.places_new);
    console.log(`    Session cost: $${cost.total.toFixed(3)}`);

    // Monthly totals & warnings
    console.log('');
    console.log(tracker.getReport());

    // Post-run warnings
    ['geocoding', 'places'].forEach(type => {
      const warning = tracker.checkLimit(type);
      if (warning) console.log(warning);
    });
  }

  const cacheStats = cache.getStats();
  console.log(`\n  Cache: ${cacheStats.geocode_cached} geocode, ${cacheStats.places_cached} places entries`);
  console.log(`  Duration: ${duration}s`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('\n  ❌ Fatal:', err.message);
    process.exit(1);
  });
}

module.exports = { processBank, parseArgs };

