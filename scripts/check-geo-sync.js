const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('../dashboard/node_modules/@prisma/client');

const prisma = new PrismaClient();
const BANKS = ['hnb', 'boc', 'peoples', 'ndb', 'seylan', 'sampath'];

function parseArgs() {
  const args = process.argv.slice(2);
  const arg = args.find(a => a.startsWith('--bank='));
  const bank = arg ? arg.split('=')[1].toLowerCase() : 'all';
  const selected = bank === 'all' ? BANKS : [bank];
  return { selected };
}

async function run() {
  const { selected } = parseArgs();
  const rows = [];
  let totalMissing = 0;

  for (const bank of selected) {
    const geoPath = path.join(__dirname, '..', 'output', `${bank}_geo.json`);
    if (!fs.existsSync(geoPath)) {
      rows.push({ bank, geo: 0, matched: 0, missing: 0, note: 'geo_missing' });
      continue;
    }

    const geo = JSON.parse(fs.readFileSync(geoPath, 'utf8'));
    const offers = Array.isArray(geo) ? geo : (geo.offers || []);
    const ids = offers.map(o => o.offer_id).filter(Boolean);

    if (ids.length === 0) {
      rows.push({ bank, geo: 0, matched: 0, missing: 0, note: 'empty_geo' });
      continue;
    }

    const existing = await prisma.offer.findMany({
      where: { unique_id: { in: ids } },
      select: { unique_id: true }
    });
    const existingSet = new Set(existing.map(x => x.unique_id));
    const missingIds = ids.filter(id => !existingSet.has(id));

    totalMissing += missingIds.length;
    rows.push({
      bank,
      geo: ids.length,
      matched: existing.length,
      missing: missingIds.length,
      note: missingIds.length ? `sample=${missingIds.slice(0, 5).join(',')}` : 'ok'
    });
  }

  console.log('bank\tgeo\tmatched\tmissing\tnote');
  rows.forEach(r => {
    console.log(`${r.bank}\t${r.geo}\t${r.matched}\t${r.missing}\t${r.note}`);
  });

  if (totalMissing > 0) {
    process.exitCode = 2;
  }
}

run()
  .catch(err => {
    console.error('ERROR', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
