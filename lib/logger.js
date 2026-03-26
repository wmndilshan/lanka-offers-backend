/**
 * ScraperLogger — Structured, file-backed logging for Lanka Offers scrapers
 *
 * Usage:
 *   const { createLogger } = require('../lib/logger');
 *   const log = createLogger('sampath');
 *
 *   log.info('Scraper', 'Starting Sampath v6');
 *   log.success('Scraper', 'Found 42 offers', { count: 42, category: 'Restaurants' });
 *   log.warn('Cache', 'Cache miss — fetching fresh');
 *   log.error('HTTP', 'Request failed', { url, status: 429 });
 *   log.debug('Parser', 'HTML snapshot', { html: '...' });
 *
 * Log levels (ascending severity):
 *   DEBUG · INFO · SUCCESS · WARN · ERROR · FATAL
 *
 * Output:
 *   • JSONL files: logs/{bank}/YYYY-MM-DD.jsonl  (machine-readable)
 *   • Console:     coloured, aligned (human-readable)
 */

const fs = require('fs');
const path = require('path');

// ─── Config ────────────────────────────────────────────────────────────────
const LOG_ROOT = process.env.SCRAPENDB_LOG_ROOT
    ? path.resolve(process.env.SCRAPENDB_LOG_ROOT)
    : path.join(__dirname, '..', 'logs');
const MAX_LOG_AGE_DAYS = 30;

const LEVELS = {
    DEBUG: { value: 0, color: '\x1b[90m', label: 'DEBUG  ' },
    INFO: { value: 1, color: '\x1b[36m', label: 'INFO   ' },
    SUCCESS: { value: 2, color: '\x1b[32m', label: 'SUCCESS' },
    WARN: { value: 3, color: '\x1b[33m', label: 'WARN   ' },
    ERROR: { value: 4, color: '\x1b[31m', label: 'ERROR  ' },
    FATAL: { value: 5, color: '\x1b[35;1m', label: 'FATAL  ' },
};
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

// ─── Utilities ─────────────────────────────────────────────────────────────
function getLogDir(bank) {
    const dir = path.join(LOG_ROOT, bank.toLowerCase());
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function getLogFile(bank) {
    const today = new Date().toISOString().split('T')[0];
    return path.join(getLogDir(bank), `${today}.jsonl`);
}

function formatTimestamp(iso) {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
}

// ─── Core write ────────────────────────────────────────────────────────────
function writeEntry(bank, level, tag, message, data) {
    const entry = {
        ts: new Date().toISOString(),
        level,
        bank,
        tag: tag || 'General',
        message,
        ...(data !== undefined && data !== null ? { data } : {}),
        pid: process.pid,
    };

    // Write to JSONL file (one JSON object per line)
    try {
        const line = JSON.stringify(entry) + '\n';
        fs.appendFileSync(getLogFile(bank), line);
    } catch (err) {
        // Never let logger crash the scraper
        console.error('[Logger] Failed to write log:', err.message);
    }

    // Print to console with colours
    const cfg = LEVELS[level] || LEVELS.INFO;
    const ts = DIM + formatTimestamp(entry.ts) + RESET;
    const lbl = cfg.color + cfg.label + RESET;
    const tagStr = DIM + `[${entry.tag.substring(0, 14).padEnd(14)}]` + RESET;
    const bankStr = DIM + `[${bank.toUpperCase().substring(0, 8)}]` + RESET;

    let line = `${ts} ${lbl} ${bankStr} ${tagStr} ${message}`;
    if (data && typeof data === 'object') {
        const compact = JSON.stringify(data);
        if (compact.length < 120) {
            line += ` ${DIM}${compact}${RESET}`;
        }
    }
    console.log(line);
}

// ─── Logger factory ────────────────────────────────────────────────────────
function createLogger(bank, minLevel = 'DEBUG') {
    const minVal = (LEVELS[minLevel] || LEVELS.DEBUG).value;
    const should = (level) => (LEVELS[level]?.value ?? 0) >= minVal;

    return {
        debug: (tag, msg, data) => should('DEBUG') && writeEntry(bank, 'DEBUG', tag, msg, data),
        info: (tag, msg, data) => should('INFO') && writeEntry(bank, 'INFO', tag, msg, data),
        success: (tag, msg, data) => should('SUCCESS') && writeEntry(bank, 'SUCCESS', tag, msg, data),
        warn: (tag, msg, data) => should('WARN') && writeEntry(bank, 'WARN', tag, msg, data),
        error: (tag, msg, data) => should('ERROR') && writeEntry(bank, 'ERROR', tag, msg, data),
        fatal: (tag, msg, data) => should('FATAL') && writeEntry(bank, 'FATAL', tag, msg, data),

        // Structured timing helper
        timer: (tag, label) => {
            const start = Date.now();
            writeEntry(bank, 'DEBUG', tag, `⏱ ${label} started`);
            return {
                done: (extra) => {
                    const ms = Date.now() - start;
                    writeEntry(bank, 'DEBUG', tag, `⏱ ${label} completed in ${ms}ms`, extra);
                    return ms;
                },
                fail: (err) => {
                    const ms = Date.now() - start;
                    writeEntry(bank, 'ERROR', tag, `⏱ ${label} failed after ${ms}ms: ${err?.message || err}`);
                }
            };
        },

        // Log a scrape run summary
        summary: (stats) => writeEntry(bank, 'INFO', 'Summary', 'Run complete', stats),
    };
}

// ─── Log reader (for dashboard API) ───────────────────────────────────────

/**
 * Read log entries for a bank on a specific date (or today)
 * Returns array of parsed log entry objects
 */
function readLogs(bank, date) {
    const dateStr = date || new Date().toISOString().split('T')[0];
    const logDir = path.join(LOG_ROOT, bank.toLowerCase());
    const logFile = path.join(logDir, `${dateStr}.jsonl`);

    if (!fs.existsSync(logFile)) return [];

    try {
        const raw = fs.readFileSync(logFile, 'utf-8');
        return raw
            .split('\n')
            .filter(Boolean)
            .map(line => { try { return JSON.parse(line); } catch (_) { return null; } })
            .filter(Boolean);
    } catch (err) {
        return [];
    }
}

/**
 * List available banks (dirs that exist in LOG_ROOT)
 */
function listLogBanks() {
    if (!fs.existsSync(LOG_ROOT)) return [];
    return fs.readdirSync(LOG_ROOT)
        .filter(f => fs.statSync(path.join(LOG_ROOT, f)).isDirectory());
}

/**
 * List available log dates for a bank (newest first)
 */
function listLogDates(bank) {
    const bankDir = path.join(LOG_ROOT, bank.toLowerCase());
    if (!fs.existsSync(bankDir)) return [];
    return fs.readdirSync(bankDir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => f.replace('.jsonl', ''))
        .sort()
        .reverse();
}

/**
 * Read the latest N lines across ALL banks — useful for "live" dashboard view
 */
function readRecentLogs(limit = 200) {
    const banks = listLogBanks();
    const today = new Date().toISOString().split('T')[0];
    const allEntries = [];

    for (const bank of banks) {
        const entries = readLogs(bank, today);
        allEntries.push(...entries);
    }

    return allEntries
        .sort((a, b) => new Date(a.ts) - new Date(b.ts))
        .slice(-limit);
}

/**
 * Prune log files older than MAX_LOG_AGE_DAYS
 */
function pruneOldLogs() {
    if (!fs.existsSync(LOG_ROOT)) return;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - MAX_LOG_AGE_DAYS);

    const banks = listLogBanks();
    let pruned = 0;

    for (const bank of banks) {
        const bankDir = path.join(LOG_ROOT, bank.toLowerCase());
        const files = fs.readdirSync(bankDir).filter(f => f.endsWith('.jsonl'));
        for (const f of files) {
            const dateStr = f.replace('.jsonl', '');
            if (new Date(dateStr) < cutoff) {
                fs.unlinkSync(path.join(bankDir, f));
                pruned++;
            }
        }
    }

    return pruned;
}

module.exports = {
    createLogger,
    readLogs,
    readRecentLogs,
    listLogBanks,
    listLogDates,
    pruneOldLogs,
};
