/**
 * Daily Sync Engine — Lanka Offers
 *
 * Performs hash-based set comparison to synchronise the database
 * with what's currently live on each bank's website.
 *
 * Algorithm:
 *   scraped_set = { unique_ids currently on bank website }
 *   db_set      = { unique_ids of active offers in DB for this bank }
 *
 *   NEW      = scraped_set - db_set       → INSERT
 *   EXISTING = scraped_set ∩ db_set       → touch last_scraped_at
 *   DELETED  = db_set - scraped_set       → soft-delete (status='expired')
 *
 * Usage:
 *   node scripts/sync.js --bank=HNB --file=../output/hnb_all.json
 *   node scripts/sync.js --bank=all  --dir=../output
 *
 * Called programmatically by scheduler.js:
 *   const { syncBank } = require('./sync');
 *   await syncBank('HNB', scrapedOffers);
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient();

// ─── Constants ───────────────────────────────────────────────────────────────

// Guard: if scraped count is 0, skip (scraper likely failed)
const MIN_SCRAPED_TO_PROCEED = 1;

// Guard: if > 50% of active DB offers would be deleted, skip (scraper malfunction)
// Only applies when DB has > MIN_DB_FOR_RATIO offers
const MAX_DELETION_RATIO = 0.5;
const MIN_DB_FOR_RATIO   = 10;

// Text normalization for near-duplicate detection
function normalizeText(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')                   // decompose accented chars
    .replace(/[\u0300-\u036f]/g, '')   // strip accent marks
    .replace(/[^\w\s]/g, ' ')          // non-word chars → space
    .replace(/\s+/g, ' ')              // collapse whitespace
    .trim();
}

// ─── Import transform (shared with import-data.js) ───────────────────────────

function parsePercentage(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  const match = String(value).trim().match(/(\d+(?:\.\d+)?)/);
  return match ? (parseFloat(match[1]) || null) : null;
}

function transformOffer(offer, bank) {
  return {
    unique_id:  offer.unique_id,
    source_id:  offer.source_id || 0,
    source:     offer.source || bank.toUpperCase(),
    category:   offer.category || 'General',
    categoryId: offer.category_id || null,
    title:      offer.title || '',
    cardType:   offer.card_type || offer.cardType || 'credit',
    scrapedAt:  offer.scraped_at ? new Date(offer.scraped_at) : new Date(),

    // Curation — always defaults, never overwritten on update
    reviewStatus: 'pending',
    isInProduction: false,

    // Structured fields
    merchantName:        offer.merchant?.name || offer.merchant_name || null,
    discountPercentage:  parsePercentage(offer.structured_data?.discount_percentage),
    discountDescription: offer.structured_data?.discount_description || '',
    applicableCards:     offer.structured_data?.applicable_cards || [],
    validFrom: offer.validity_periods?.[0]?.valid_from
      ? new Date(offer.validity_periods[0].valid_from)
      : (offer._raw_validFrom ? new Date(offer._raw_validFrom) : null),
    validTo: offer.validity_periods?.[0]?.valid_to
      ? new Date(offer.validity_periods[0].valid_to)
      : (offer._raw_validUntil ? new Date(offer._raw_validUntil) : null),
    contactPhone:     offer.structured_data?.contact_phone || [],
    contactEmail:     offer.structured_data?.contact_email || [],
    bookingRequired:  offer.structured_data?.booking_required || false,
    keyRestrictions:  offer.structured_data?.key_restrictions || [],
    daysApplicable:   offer.structured_data?.days_applicable || null,
    specialConditions: offer.structured_data?.special_conditions || [],

    // Sync fields
    status:        'active',
    lastScrapedAt: new Date(),
    invalidatedAt: null,
  };
}

// ─── Core Sync Function ───────────────────────────────────────────────────────

/**
 * Synchronise one bank's offers against the database.
 *
 * @param {string} bank           - Bank name (e.g. 'HNB', 'BOC')
 * @param {Array}  scrapedOffers  - Array of offer objects from scraper output
 *                                  Each must have { unique_id, ... }
 * @param {Object} [options]
 * @param {boolean} [options.dryRun=false]  - Log only, no DB writes
 * @returns {Object} syncResult with counts and status
 */
async function syncBank(bank, scrapedOffers, options = {}) {
  const { dryRun = false } = options;
  const startedAt = Date.now();
  const now = new Date();
  const bankUpper = bank.toUpperCase();

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  SYNC: ${bankUpper}  ${dryRun ? '[DRY RUN]' : ''}  ${now.toISOString()}`);
  console.log(`${'═'.repeat(60)}`);

  // ── Guard 1: Empty scrape ───────────────────────────────────────
  if (!scrapedOffers || scrapedOffers.length < MIN_SCRAPED_TO_PROCEED) {
    const msg = `Scraped 0 offers — scraper likely failed. Skipping sync to preserve DB.`;
    console.warn(`  ⚠️  SKIPPED: ${msg}`);

    if (!dryRun) {
      await writeScrapeLog({
        bank: bankUpper, status: 'skipped',
        scrapedCount: 0, dbActiveCount: 0,
        offersNew: 0, offersUpdated: 0, offersInvalidated: 0, offersTotal: 0,
        errorMessage: msg, durationMs: Date.now() - startedAt,
      });
    }
    return { status: 'skipped', reason: msg };
  }

  // ── Step 1: Build scraped set ───────────────────────────────────
  // Filter out any offers missing unique_id
  const validOffers = scrapedOffers.filter(o => o.unique_id && o.unique_id.trim() !== '');
  const invalidCount = scrapedOffers.length - validOffers.length;
  if (invalidCount > 0) {
    console.warn(`  ⚠️  Dropped ${invalidCount} offers missing unique_id`);
  }

  const scrapedMap = new Map(validOffers.map(o => [o.unique_id, o]));
  const scrapedIds = new Set(scrapedMap.keys());

  console.log(`  📥 Scraped: ${scrapedIds.size} offers`);

  // ── Step 2: Query DB for active offers ──────────────────────────
  let dbOffers;
  try {
    dbOffers = await prisma.offer.findMany({
      where:  { source: bankUpper, status: 'active' },
      select: { id: true, unique_id: true },
    });
  } catch (err) {
    const msg = `DB query failed: ${err.message}`;
    console.error(`  ❌ ${msg}`);
    await writeScrapeLog({
      bank: bankUpper, status: 'failed', errorMessage: msg,
      scrapedCount: scrapedIds.size, durationMs: Date.now() - startedAt,
    });
    return { status: 'failed', reason: msg };
  }

  const dbMap = new Map(dbOffers.map(o => [o.unique_id, o.id]));
  const dbIds = new Set(dbMap.keys());

  console.log(`  🗄️  DB active: ${dbIds.size} offers`);

  // ── Step 3: Set comparison ──────────────────────────────────────
  const newIds      = [...scrapedIds].filter(id => !dbIds.has(id));
  const existingIds = [...scrapedIds].filter(id =>  dbIds.has(id));
  const deletedIds  = [...dbIds].filter(id => !scrapedIds.has(id));

  console.log(`\n  📊 Set comparison:`);
  console.log(`     ➕ New (to INSERT):      ${newIds.length}`);
  console.log(`     🔄 Existing (touch ts): ${existingIds.length}`);
  console.log(`     ❌ Deleted (to expire): ${deletedIds.length}`);

  // ── Guard 2: Mass-deletion protection ──────────────────────────
  if (dbIds.size >= MIN_DB_FOR_RATIO) {
    const deletionRatio = deletedIds.length / dbIds.size;
    if (deletionRatio > MAX_DELETION_RATIO) {
      const msg = `Would invalidate ${deletedIds.length}/${dbIds.size} active offers (${Math.round(deletionRatio * 100)}% > ${MAX_DELETION_RATIO * 100}% threshold). Possible scraper malfunction — skipping.`;
      console.warn(`\n  ⚠️  SKIPPED: ${msg}`);

      if (!dryRun) {
        await writeScrapeLog({
          bank: bankUpper, status: 'skipped',
          scrapedCount: scrapedIds.size, dbActiveCount: dbIds.size,
          offersNew: newIds.length, offersUpdated: existingIds.length,
          offersInvalidated: 0, offersTotal: dbIds.size,
          errorMessage: msg, durationMs: Date.now() - startedAt,
        });
      }
      return { status: 'skipped', reason: msg };
    }
  }

  if (dryRun) {
    console.log(`\n  ℹ️  DRY RUN — no database changes made.`);
    return {
      status: 'dry_run',
      scrapedCount: scrapedIds.size,
      dbActiveCount: dbIds.size,
      offersNew: newIds.length,
      offersUpdated: existingIds.length,
      offersInvalidated: deletedIds.length,
    };
  }

  // ── Step 4: Apply changes ───────────────────────────────────────
  let insertedCount = 0, updatedCount = 0, invalidatedCount = 0;
  const errors = [];

  // 4a. INSERT new offers (upsert for safety)
  if (newIds.length > 0) {
    console.log(`\n  ➕ Inserting ${newIds.length} new offers...`);
    for (const uid of newIds) {
      const offer = scrapedMap.get(uid);
      try {
        const data = transformOffer(offer, bankUpper);
        await prisma.offer.upsert({
          where: { unique_id: uid },
          create: {
            ...data,
            rawData: {
              create: {
                rawValidFrom:   offer._raw_validFrom || null,
                rawValidUntil:  offer._raw_validUntil || null,
                rawHtmlContent: offer._raw_htmlContent || null,
                rawListItem:    offer._raw_list_item || null,
                rawDetail:      offer._raw_detail || null,
              }
            }
          },
          update: { lastScrapedAt: now, status: 'active' },
        });
        insertedCount++;
      } catch (err) {
        errors.push({ uid, op: 'insert', error: err.message });
        console.error(`     ❌ Insert failed for ${uid}: ${err.message}`);
      }
    }
    console.log(`     ✅ Inserted ${insertedCount}`);
  }

  // 4b. TOUCH existing offers (batch update last_scraped_at)
  if (existingIds.length > 0) {
    console.log(`\n  🔄 Touching ${existingIds.length} existing offers...`);
    try {
      const result = await prisma.offer.updateMany({
        where: { unique_id: { in: existingIds }, source: bankUpper },
        data:  { lastScrapedAt: now },
      });
      updatedCount = result.count;
      console.log(`     ✅ Touched ${updatedCount}`);
    } catch (err) {
      errors.push({ op: 'touch_existing', error: err.message });
      console.error(`     ❌ Touch failed: ${err.message}`);
    }
  }

  // 4c. SOFT DELETE removed offers
  if (deletedIds.length > 0) {
    console.log(`\n  ❌ Invalidating ${deletedIds.length} removed offers...`);
    try {
      const result = await prisma.offer.updateMany({
        where: { unique_id: { in: deletedIds }, source: bankUpper },
        data:  { status: 'expired', invalidatedAt: now },
      });
      invalidatedCount = result.count;
      console.log(`     ✅ Invalidated ${invalidatedCount}`);
    } catch (err) {
      errors.push({ op: 'invalidate', error: err.message });
      console.error(`     ❌ Invalidation failed: ${err.message}`);
    }
  }

  // ── Step 5: Log results ─────────────────────────────────────────
  const dbTotalAfter = dbIds.size + insertedCount - invalidatedCount;
  const durationMs   = Date.now() - startedAt;
  const syncStatus   = errors.length === 0 ? 'success' : 'partial';

  await writeScrapeLog({
    bank:             bankUpper,
    status:           syncStatus,
    scrapedCount:     scrapedIds.size,
    dbActiveCount:    dbIds.size,
    offersNew:        insertedCount,
    offersUpdated:    updatedCount,
    offersInvalidated: invalidatedCount,
    offersTotal:      dbTotalAfter,
    errorMessage:     errors.length > 0 ? errors.map(e => `${e.op}:${e.error}`).join('; ') : null,
    durationMs,
  });

  // ── Summary ─────────────────────────────────────────────────────
  console.log(`\n  ${'─'.repeat(50)}`);
  console.log(`  ✅ Sync complete for ${bankUpper} in ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`     Bank website:  ${scrapedIds.size} offers`);
  console.log(`     DB before:     ${dbIds.size} active`);
  console.log(`     ➕ Inserted:   ${insertedCount}`);
  console.log(`     🔄 Touched:    ${updatedCount}`);
  console.log(`     ❌ Expired:    ${invalidatedCount}`);
  console.log(`     DB after:      ${dbTotalAfter} active`);
  if (errors.length > 0) {
    console.log(`     ⚠️  Errors:   ${errors.length}`);
  }

  return {
    status: syncStatus,
    bank: bankUpper,
    scrapedCount: scrapedIds.size,
    dbActiveCount: dbIds.size,
    offersNew: insertedCount,
    offersUpdated: updatedCount,
    offersInvalidated: invalidatedCount,
    offersTotal: dbTotalAfter,
    durationMs,
    errors,
  };
}

// ─── ScrapeLog writer ─────────────────────────────────────────────────────────

async function writeScrapeLog(data) {
  try {
    await prisma.scrapeLog.create({ data });
  } catch (err) {
    // Don't crash the sync if logging fails
    console.error(`  ⚠️  Failed to write ScrapeLog: ${err.message}`);
  }
}

// ─── Load offers from JSON file ───────────────────────────────────────────────

/**
 * Load scraped offers from a JSON output file.
 * Handles both { offers: [...] } and bare array formats.
 */
function loadOffersFromFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(content);
  return Array.isArray(data) ? data : (data.offers || []);
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  const bankArg  = args.find(a => a.startsWith('--bank='))?.replace('--bank=', '') || '';
  const fileArg  = args.find(a => a.startsWith('--file='))?.replace('--file=', '') || '';
  const dirArg   = args.find(a => a.startsWith('--dir='))?.replace('--dir=', '') || '';
  const dryRun   = args.includes('--dry-run');

  // ── Stats mode ─────────────────────────────────────────────────
  if (args.includes('--stats')) {
    const logs = await prisma.scrapeLog.findMany({
      orderBy: { syncAt: 'desc' },
      take: 50,
    });
    console.log('\n📊 Recent Sync Logs:\n');
    logs.forEach(l => {
      const ts = new Date(l.syncAt).toLocaleString();
      console.log(`${ts}  ${l.bank.padEnd(10)} ${l.status.padEnd(8)} +${l.offersNew} ~${l.offersUpdated} -${l.offersInvalidated}  [${l.durationMs || '?'}ms]`);
    });
    await prisma.$disconnect();
    return;
  }

  if (!bankArg) {
    console.error('Usage: node scripts/sync.js --bank=HNB --file=../output/hnb_all.json [--dry-run]');
    console.error('       node scripts/sync.js --bank=all --dir=../output [--dry-run]');
    console.error('       node scripts/sync.js --stats');
    process.exit(1);
  }

  // ── Bank file mapping ───────────────────────────────────────────
  const BANK_FILES = {
    HNB:     'hnb_all.json',
    BOC:     'boc_all.json',
    SAMPATH: 'sampath_all.json',
    PEOPLES: 'peoples_all.json',
    SEYLAN:  'seylan_all.json',
    NDB:     'ndb_all.json',
    DFCC:    'dfcc_all.json',
    PABC:    'pabc_all.json',
  };

  const outputDir = dirArg
    ? path.resolve(dirArg)
    : path.join(__dirname, '..', '..', 'output');

  const banksToSync = bankArg.toLowerCase() === 'all'
    ? Object.keys(BANK_FILES)
    : [bankArg.toUpperCase()];

  let totalNew = 0, totalUpdated = 0, totalInvalidated = 0;

  for (const bank of banksToSync) {
    let filePath;

    if (fileArg && banksToSync.length === 1) {
      filePath = path.resolve(fileArg);
    } else {
      const fileName = BANK_FILES[bank];
      if (!fileName) {
        console.warn(`  ⚠️  No file mapping for bank ${bank}, skipping`);
        continue;
      }
      filePath = path.join(outputDir, fileName);
    }

    if (!fs.existsSync(filePath)) {
      console.warn(`  ⚠️  File not found: ${filePath}, skipping ${bank}`);
      continue;
    }

    let offers;
    try {
      offers = loadOffersFromFile(filePath);
      console.log(`\n📂 Loaded ${offers.length} offers from ${path.basename(filePath)}`);
    } catch (err) {
      console.error(`  ❌ Failed to load ${filePath}: ${err.message}`);
      continue;
    }

    const result = await syncBank(bank, offers, { dryRun });

    if (result.status === 'success' || result.status === 'partial') {
      totalNew         += result.offersNew || 0;
      totalUpdated     += result.offersUpdated || 0;
      totalInvalidated += result.offersInvalidated || 0;
    }
  }

  if (banksToSync.length > 1) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  TOTAL SYNC RESULTS`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`  ➕ New:        ${totalNew}`);
    console.log(`  🔄 Updated:    ${totalUpdated}`);
    console.log(`  ❌ Expired:    ${totalInvalidated}`);
  }

  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch(async err => {
    console.error('\n❌ Sync fatal error:', err.message);
    await prisma.$disconnect();
    process.exit(1);
  });
}

module.exports = { syncBank, loadOffersFromFile, normalizeText };
