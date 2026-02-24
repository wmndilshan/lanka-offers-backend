/**
 * dashboard-logger.js — reads scraper JSONL log files for the Next.js dashboard
 * This is a thin wrapper around the scraper-side lib/logger.js reader functions,
 * adapted to use the correct path relative to the dashboard directory.
 */

const fs = require('fs');
const path = require('path');

// Logs root is ../logs relative to this file (d:/ScrapeNDB/logs)
const LOG_ROOT = path.join(process.cwd(), '..', 'logs');

function readLogs(bank, date) {
    const dateStr = date || new Date().toISOString().split('T')[0];
    const logFile = path.join(LOG_ROOT, bank.toLowerCase(), `${dateStr}.jsonl`);
    if (!fs.existsSync(logFile)) return [];
    try {
        return fs.readFileSync(logFile, 'utf-8')
            .split('\n').filter(Boolean)
            .map(line => { try { return JSON.parse(line); } catch (_) { return null; } })
            .filter(Boolean);
    } catch (_) { return []; }
}

function listLogBanks() {
    if (!fs.existsSync(LOG_ROOT)) return [];
    try {
        return fs.readdirSync(LOG_ROOT)
            .filter(f => fs.statSync(path.join(LOG_ROOT, f)).isDirectory());
    } catch (_) { return []; }
}

function listLogDates(bank) {
    const bankDir = path.join(LOG_ROOT, bank.toLowerCase());
    if (!fs.existsSync(bankDir)) return [];
    return fs.readdirSync(bankDir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => f.replace('.jsonl', ''))
        .sort().reverse();
}

function readRecentLogs(limit = 200) {
    const banks = listLogBanks();
    const today = new Date().toISOString().split('T')[0];
    const allEntries = [];
    for (const bank of banks) {
        allEntries.push(...readLogs(bank, today));
    }
    return allEntries.sort((a, b) => new Date(a.ts) - new Date(b.ts)).slice(-limit);
}

module.exports = { readLogs, listLogBanks, listLogDates, readRecentLogs };
