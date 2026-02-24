/**
 * Cleanup Job — Lanka Offers
 *
 * Hard-deletes offers that have been expired (status='expired') for more than
 * RETENTION_DAYS (default: 30 days). Keeps the database lean while preserving
 * recent history for analytics.
 *
 * Usage:
 *   node scripts/cleanup.js                          # Default 30-day retention
 *   node scripts/cleanup.js --retention-days=60      # Keep for 60 days instead
 *   node scripts/cleanup.js --dry-run                # Show what would be deleted
 *   node scripts/cleanup.js --stats                  # Show expired offer stats
 *
 * Called by scheduler.js on the 1st of each month.
 */

const { PrismaClient } = require('@prisma/client');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient();

const DEFAULT_RETENTION_DAYS = 30;

/**
 * Hard-delete offers expired more than retentionDays ago.
 * Cascades to Locations and RawData via onDelete: Cascade in schema.
 *
 * @param {Object} options
 * @param {number}  [options.retentionDays=30]
 * @param {boolean} [options.dryRun=false]
 * @returns {Object} { deleted, breakdown }
 */
async function cleanupOldOffers(options = {}) {
  const { retentionDays = DEFAULT_RETENTION_DAYS, dryRun = false } = options;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  CLEANUP JOB — ${new Date().toISOString()}`);
  console.log(`  Retention: ${retentionDays} days  |  Cutoff: ${cutoffDate.toISOString().split('T')[0]}`);
  if (dryRun) console.log('  ⚠️  DRY RUN — no records will be deleted');
  console.log(`${'═'.repeat(60)}`);

  // ── Step 1: Find what would be deleted ───────────────────────────
  const toDelete = await prisma.offer.findMany({
    where: {
      status:       'expired',
      invalidatedAt: { lte: cutoffDate },
    },
    select: {
      id:            true,
      unique_id:     true,
      source:        true,
      title:         true,
      invalidatedAt: true,
    },
    orderBy: { invalidatedAt: 'asc' },
  });

  if (toDelete.length === 0) {
    console.log(`\n  ✅ Nothing to clean up — no expired offers older than ${retentionDays} days.\n`);
    await prisma.$disconnect();
    return { deleted: 0, breakdown: {} };
  }

  // ── Group by bank for reporting ───────────────────────────────────
  const breakdown = {};
  toDelete.forEach(offer => {
    breakdown[offer.source] = (breakdown[offer.source] || 0) + 1;
  });

  console.log(`\n  📋 Offers to delete: ${toDelete.length}`);
  Object.entries(breakdown).sort().forEach(([bank, count]) => {
    console.log(`     ${bank.padEnd(10)} ${count} offers`);
  });

  // Show oldest 5 examples
  console.log(`\n  Oldest to be deleted:`);
  toDelete.slice(0, 5).forEach(o => {
    const daysAgo = Math.round((Date.now() - new Date(o.invalidatedAt)) / (1000 * 60 * 60 * 24));
    console.log(`     [${o.source}] ${o.title?.substring(0, 45) || o.unique_id}  (expired ${daysAgo}d ago)`);
  });

  if (dryRun) {
    console.log(`\n  ℹ️  DRY RUN — would delete ${toDelete.length} offers. Pass without --dry-run to execute.\n`);
    await prisma.$disconnect();
    return { deleted: 0, dryRun: true, wouldDelete: toDelete.length, breakdown };
  }

  // ── Step 2: Hard delete (cascade deletes locations + rawData) ────
  console.log(`\n  🗑️  Deleting ${toDelete.length} expired offers...`);

  const idsToDelete = toDelete.map(o => o.id);

  // Delete in batches of 500 to avoid DB timeouts
  const BATCH_SIZE = 500;
  let deletedTotal = 0;

  for (let i = 0; i < idsToDelete.length; i += BATCH_SIZE) {
    const batch = idsToDelete.slice(i, i + BATCH_SIZE);
    const result = await prisma.offer.deleteMany({
      where: { id: { in: batch } },
    });
    deletedTotal += result.count;
    console.log(`     Batch ${Math.ceil(i / BATCH_SIZE) + 1}: deleted ${result.count}`);
  }

  // ── Summary ───────────────────────────────────────────────────────
  console.log(`\n  ${'─'.repeat(50)}`);
  console.log(`  ✅ Cleanup complete — deleted ${deletedTotal} expired offers`);
  console.log(`     (Cascaded to all linked locations and raw data)`);
  console.log(`${'─'.repeat(50)}\n`);

  await prisma.$disconnect();
  return { deleted: deletedTotal, breakdown };
}

/**
 * Show current stats on expired offers (without deleting anything).
 */
async function showStats() {
  const now = new Date();

  // Count by bank × status
  const byBank = await prisma.offer.groupBy({
    by: ['source', 'status'],
    _count: { id: true },
    orderBy: [{ source: 'asc' }, { status: 'asc' }],
  });

  // Expired offers breakdown by age
  const expiredOffers = await prisma.offer.findMany({
    where: { status: 'expired' },
    select: { source: true, invalidatedAt: true },
  });

  const ageBuckets = { '0-7d': 0, '8-30d': 0, '31-90d': 0, '90d+': 0 };
  expiredOffers.forEach(o => {
    if (!o.invalidatedAt) return;
    const ageDays = (now - new Date(o.invalidatedAt)) / (1000 * 60 * 60 * 24);
    if      (ageDays <= 7)  ageBuckets['0-7d']++;
    else if (ageDays <= 30) ageBuckets['8-30d']++;
    else if (ageDays <= 90) ageBuckets['31-90d']++;
    else                    ageBuckets['90d+']++;
  });

  // Recent scrape logs
  const recentLogs = await prisma.scrapeLog.findMany({
    orderBy: { syncAt: 'desc' },
    take: 14,
  });

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  DATABASE STATUS — ${now.toISOString().split('T')[0]}`);
  console.log(`${'═'.repeat(60)}`);

  console.log(`\n  Offers by bank × status:`);
  const banks = [...new Set(byBank.map(r => r.source))].sort();
  banks.forEach(bank => {
    const rows = byBank.filter(r => r.source === bank);
    const active  = rows.find(r => r.status === 'active')?._count.id || 0;
    const expired = rows.find(r => r.status === 'expired')?._count.id || 0;
    console.log(`     ${bank.padEnd(12)} ${String(active).padStart(4)} active   ${String(expired).padStart(4)} expired`);
  });

  console.log(`\n  Expired offers by age:`);
  Object.entries(ageBuckets).forEach(([bucket, count]) => {
    const bar = '█'.repeat(Math.min(20, Math.round(count / 2)));
    console.log(`     ${bucket.padEnd(8)}  ${String(count).padStart(4)}  ${bar}`);
  });

  if (ageBuckets['31-90d'] + ageBuckets['90d+'] > 0) {
    const cleanupCandidates = ageBuckets['31-90d'] + ageBuckets['90d+'];
    console.log(`\n  ⚠️  ${cleanupCandidates} offers ready for cleanup (>30 days expired)`);
    console.log(`     Run: node scripts/cleanup.js`);
  }

  if (recentLogs.length > 0) {
    console.log(`\n  Recent sync logs (last 14 runs):`);
    recentLogs.forEach(l => {
      const ts   = new Date(l.syncAt).toLocaleString('en-GB', { timeZone: 'Asia/Colombo' });
      const icon = l.status === 'success' ? '✅' : l.status === 'skipped' ? '⏭️ ' : '❌';
      const detail = `+${l.offersNew} ~${l.offersUpdated} -${l.offersInvalidated}`;
      console.log(`     ${icon} ${ts}  ${l.bank.padEnd(10)} ${detail}`);
    });
  }

  await prisma.$disconnect();
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--stats')) {
    await showStats();
    return;
  }

  const retentionArg = args.find(a => a.startsWith('--retention-days='));
  const retentionDays = retentionArg
    ? parseInt(retentionArg.replace('--retention-days=', ''))
    : DEFAULT_RETENTION_DAYS;

  const dryRun = args.includes('--dry-run');

  await cleanupOldOffers({ retentionDays, dryRun });
}

if (require.main === module) {
  main().catch(async err => {
    console.error('\n❌ Cleanup fatal error:', err.message);
    await prisma.$disconnect();
    process.exit(1);
  });
}

module.exports = { cleanupOldOffers, showStats };
