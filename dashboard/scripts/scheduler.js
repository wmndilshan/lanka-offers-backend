/**
 * Daily Scraper Scheduler — Lanka Offers
 *
 * Runs all bank scrapers at 2 AM daily (Sri Lanka time = UTC+5:30).
 * After each scraper finishes, calls sync.js to update the database.
 *
 * Usage:
 *   node scripts/scheduler.js             # Start daemon
 *   node scripts/scheduler.js --run-now   # Run all banks immediately (no wait)
 *   node scripts/scheduler.js --bank=HNB  # Run one bank immediately
 *
 * Requirements:
 *   npm install node-cron  (in root /ScrapeNDB or dashboard/)
 *
 * Each bank run:
 *   1. Execute scraper script        → output/<bank>_all.json
 *   2. Call syncBank()               → INSERT/UPDATE/EXPIRE in DB
 *   3. Log result to ScrapeLog table
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

// ── Try to load node-cron (optional for --run-now mode) ──────────────────────
let cron;
try {
  cron = require('node-cron');
} catch {
  cron = null;
}

const { syncBank, loadOffersFromFile } = require('./sync');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// ─── Bank configuration ───────────────────────────────────────────────────────

const SCRAPERS_ROOT = path.join(__dirname, '..', '..');
const OUTPUT_DIR    = path.join(SCRAPERS_ROOT, 'output');

const BANKS = [
  {
    name:       'HNB',
    script:     'hnb-6.js',
    outputFile: 'hnb_all.json',
    args:       ['--all-categories'],
    // How long to wait before timing out (ms)
    timeoutMs:  10 * 60 * 1000, // 10 minutes
  },
  {
    name:       'BOC',
    script:     'boc-6.js',
    outputFile: 'boc_all.json',
    args:       ['--all-categories'],
    timeoutMs:  10 * 60 * 1000,
  },
  {
    name:       'SAMPATH',
    script:     'sampath-6.js',
    outputFile: 'sampath_all.json',
    args:       [],
    timeoutMs:  15 * 60 * 1000,
  },
  {
    name:       'PEOPLES',
    script:     'peoples-3.js',
    outputFile: 'peoples_all.json',
    args:       [],
    timeoutMs:  10 * 60 * 1000,
  },
  {
    name:       'SEYLAN',
    script:     'seylan.js',
    outputFile: 'seylan_all.json',
    args:       [],
    timeoutMs:  10 * 60 * 1000,
  },
  {
    name:       'NDB',
    script:     'ndb-2.js',
    outputFile: 'ndb_all.json',
    args:       [],
    timeoutMs:  10 * 60 * 1000,
  },
];

// ─── Run one scraper ──────────────────────────────────────────────────────────

/**
 * Spawn a scraper script and wait for it to finish.
 * @returns {Promise<{ success, stdout, stderr, durationMs }>}
 */
function runScraper(bank) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const scriptPath = path.join(SCRAPERS_ROOT, bank.script);

    if (!fs.existsSync(scriptPath)) {
      return resolve({
        success: false,
        stdout: '',
        stderr: `Script not found: ${scriptPath}`,
        durationMs: 0,
      });
    }

    console.log(`  🚀 Starting ${bank.name} scraper: node ${bank.script} ${bank.args.join(' ')}`);

    const child = execFile(
      'node',
      [scriptPath, ...bank.args],
      {
        cwd: SCRAPERS_ROOT,
        timeout: bank.timeoutMs,
        maxBuffer: 50 * 1024 * 1024, // 50 MB stdout buffer
        env: { ...process.env },
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - startedAt;

        if (error) {
          console.error(`  ❌ ${bank.name} scraper failed in ${(durationMs / 1000).toFixed(1)}s: ${error.message}`);
          resolve({ success: false, stdout, stderr: error.message, durationMs });
        } else {
          console.log(`  ✅ ${bank.name} scraper done in ${(durationMs / 1000).toFixed(1)}s`);
          resolve({ success: true, stdout, stderr, durationMs });
        }
      }
    );

    // Stream scraper output to console with bank prefix
    child.stdout?.on('data', data => {
      process.stdout.write(data.toString().split('\n').map(l => `    [${bank.name}] ${l}`).join('\n'));
    });
    child.stderr?.on('data', data => {
      process.stderr.write(data.toString().split('\n').map(l => `    [${bank.name}] ${l}`).join('\n'));
    });
  });
}

// ─── Run one bank (scrape + sync) ─────────────────────────────────────────────

async function runBankSync(bank) {
  const header = `${'─'.repeat(60)}\n  BANK: ${bank.name}  ${new Date().toISOString()}\n${'─'.repeat(60)}`;
  console.log(`\n${header}`);

  // Step 1: Run scraper
  const scrapeResult = await runScraper(bank);

  if (!scrapeResult.success) {
    console.error(`  ❌ ${bank.name} scraper failed — skipping DB sync to preserve existing offers`);
    return { bank: bank.name, status: 'scrape_failed', ...scrapeResult };
  }

  // Step 2: Load output file
  const outputPath = path.join(OUTPUT_DIR, bank.outputFile);

  if (!fs.existsSync(outputPath)) {
    console.error(`  ❌ Output file not found: ${outputPath} — scraper may not have saved output`);
    return { bank: bank.name, status: 'no_output_file' };
  }

  let offers;
  try {
    offers = loadOffersFromFile(outputPath);
    console.log(`  📂 Loaded ${offers.length} offers from ${bank.outputFile}`);
  } catch (err) {
    console.error(`  ❌ Failed to read output file: ${err.message}`);
    return { bank: bank.name, status: 'parse_failed', error: err.message };
  }

  // Step 3: Sync to database
  const syncResult = await syncBank(bank.name, offers);

  return {
    bank: bank.name,
    status: syncResult.status,
    syncResult,
    scrapeDurationMs: scrapeResult.durationMs,
  };
}

// ─── Run all banks sequentially ───────────────────────────────────────────────

async function runAllBanks() {
  const runStarted = Date.now();
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  DAILY SYNC JOB — ${new Date().toISOString()}`);
  console.log(`  Banks: ${BANKS.map(b => b.name).join(', ')}`);
  console.log(`${'═'.repeat(60)}`);

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const results = [];
  let succeeded = 0, failed = 0, skipped = 0;

  // Run banks sequentially to avoid overwhelming bank websites
  for (const bank of BANKS) {
    try {
      const result = await runBankSync(bank);
      results.push(result);

      if (result.status === 'success')  succeeded++;
      else if (result.status === 'skipped') skipped++;
      else failed++;
    } catch (err) {
      console.error(`  ❌ Unhandled error for ${bank.name}: ${err.message}`);
      results.push({ bank: bank.name, status: 'error', error: err.message });
      failed++;
    }

    // Small delay between banks (be polite to bank servers)
    if (bank !== BANKS[BANKS.length - 1]) {
      console.log(`\n  ⏳ Waiting 30s before next bank...`);
      await sleep(30000);
    }
  }

  const totalMs = Date.now() - runStarted;

  // ── Final summary ─────────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  DAILY SYNC COMPLETE — ${(totalMs / 1000 / 60).toFixed(1)} minutes`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  ✅ Succeeded: ${succeeded} banks`);
  console.log(`  ❌ Failed:    ${failed} banks`);
  console.log(`  ⏭️  Skipped:  ${skipped} banks`);
  console.log(`\n  Results:`);

  results.forEach(r => {
    const icon = r.status === 'success' ? '✅' : r.status === 'skipped' ? '⏭️ ' : '❌';
    const sr = r.syncResult;
    const detail = sr
      ? `+${sr.offersNew} ~${sr.offersUpdated} -${sr.offersInvalidated} → ${sr.offersTotal} active`
      : r.error || r.status;
    console.log(`  ${icon} ${r.bank.padEnd(10)}  ${detail}`);
  });

  return results;
}

// ─── Cleanup reminder ─────────────────────────────────────────────────────────

async function maybeRunCleanup() {
  // Run cleanup on the 1st of each month
  const today = new Date();
  if (today.getDate() === 1) {
    console.log(`\n  🗑️  Running monthly cleanup job...`);
    try {
      const { cleanupOldOffers } = require('./cleanup');
      await cleanupOldOffers();
    } catch (err) {
      console.error(`  ❌ Cleanup failed: ${err.message}`);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── CLI / Daemon entry point ─────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const runNow  = args.includes('--run-now');
  const bankArg = args.find(a => a.startsWith('--bank='))?.replace('--bank=', '');

  // ── Run immediately (single bank) ──────────────────────────────
  if (bankArg) {
    const bankConfig = BANKS.find(b => b.name === bankArg.toUpperCase());
    if (!bankConfig) {
      console.error(`Unknown bank: ${bankArg}. Available: ${BANKS.map(b => b.name).join(', ')}`);
      process.exit(1);
    }
    const result = await runBankSync(bankConfig);
    console.log(`\n${JSON.stringify(result, null, 2)}`);
    process.exit(0);
  }

  // ── Run all banks immediately ───────────────────────────────────
  if (runNow) {
    await runAllBanks();
    await maybeRunCleanup();
    process.exit(0);
  }

  // ── Daemon mode (requires node-cron) ───────────────────────────
  if (!cron) {
    console.error('❌ node-cron not installed. Run: npm install node-cron');
    console.error('   Or use --run-now to run immediately without cron.');
    process.exit(1);
  }

  // 2 AM Sri Lanka time (UTC+5:30) = 20:30 UTC
  const cronExpression = '30 20 * * *';

  console.log('═'.repeat(60));
  console.log('  Lanka Offers — Daily Scraper Daemon');
  console.log('═'.repeat(60));
  console.log(`  Schedule: ${cronExpression} UTC (= 2:00 AM Sri Lanka time)`);
  console.log(`  Banks:    ${BANKS.map(b => b.name).join(', ')}`);
  console.log(`  PID:      ${process.pid}`);
  console.log(`  Started:  ${new Date().toISOString()}`);
  console.log('─'.repeat(60));
  console.log('  Waiting for scheduled time... (Ctrl+C to stop)');

  // Schedule daily run
  cron.schedule(cronExpression, async () => {
    try {
      await runAllBanks();
      await maybeRunCleanup();
    } catch (err) {
      console.error(`❌ Fatal error in scheduled run: ${err.message}`);
    }
  }, {
    timezone: 'UTC',
  });

  // Optional: monthly cleanup independently on the 1st at 3 AM UTC
  cron.schedule('0 21 1 * *', async () => {
    console.log('\n🗑️  Monthly cleanup triggered...');
    try {
      const { cleanupOldOffers } = require('./cleanup');
      await cleanupOldOffers({ retentionDays: 30 });
    } catch (err) {
      console.error(`❌ Monthly cleanup failed: ${err.message}`);
    }
  }, { timezone: 'UTC' });

  // Keep process alive
  process.on('SIGINT',  () => { console.log('\n👋 Scheduler stopped.'); process.exit(0); });
  process.on('SIGTERM', () => { console.log('\n👋 Scheduler stopped.'); process.exit(0); });
}

main().catch(err => {
  console.error('\n❌ Scheduler fatal error:', err.message);
  process.exit(1);
});

module.exports = { runAllBanks, runBankSync, BANKS };
