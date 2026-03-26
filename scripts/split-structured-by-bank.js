const fs = require('fs');
const path = require('path');
const { createLogger } = require('../lib/logger');

const log = createLogger('split-structured');

const OUTPUT_DIR = path.join(__dirname, '..', 'output');
const INPUT_FILE = path.join(OUTPUT_DIR, 'all_offers_structured.json');

const BANK_MAP = {
    hnb: 'hnb',
    boc: 'boc',
    ndb: 'ndb',
    seylan: 'seylan',
    sampath: 'sampath',
    peoples: 'peoples',
    "people's bank": 'peoples',
    "peoples bank": 'peoples',
    'people bank': 'peoples'
};

function getBankKey(offer) {
    const source = (offer.source || '').toString().trim().toLowerCase();
    if (BANK_MAP[source]) return BANK_MAP[source];
    const unique = (offer.unique_id || '').toLowerCase();
    if (unique.startsWith('hnb_')) return 'hnb';
    if (unique.startsWith('boc_')) return 'boc';
    if (unique.startsWith('ndb_')) return 'ndb';
    if (unique.startsWith('seylan_')) return 'seylan';
    if (unique.startsWith('sampath_')) return 'sampath';
    if (unique.startsWith('peoples_') || unique.startsWith('people_')) return 'peoples';
    return null;
}

function main() {
    if (!fs.existsSync(INPUT_FILE)) {
        log.error('Split', 'Missing input file', { file: INPUT_FILE });
        process.exit(1);
    }

    const raw = fs.readFileSync(INPUT_FILE, 'utf-8');
    const data = JSON.parse(raw);
    const offers = data.offers || [];
    const processedAt = data.processedAt || new Date().toISOString();

    const buckets = {
        hnb: [],
        boc: [],
        peoples: [],
        ndb: [],
        seylan: [],
        sampath: [],
    };

    let unknown = 0;
    for (const offer of offers) {
        const key = getBankKey(offer);
        if (!key || !buckets[key]) {
            unknown += 1;
            continue;
        }
        buckets[key].push(offer);
    }

    for (const [bank, list] of Object.entries(buckets)) {
        const outFile = path.join(OUTPUT_DIR, `${bank}_structured.json`);
        const payload = {
            processedAt,
            source: bank.toUpperCase(),
            offers: list
        };
        fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));
        log.info('Split', 'Wrote bank file', { bank, count: list.length, file: outFile });
    }

    log.success('Split', 'Completed', { total: offers.length, unknown });
}

main();
