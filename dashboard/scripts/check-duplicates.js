/**
 * Duplicate Offer Scanner
 * Scans the database for existing duplicate offers and reports them
 * 
 * Usage: node scripts/check-duplicates.js
 *        node scripts/check-duplicates.js --fix   (deletes the older duplicates)
 */

const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });

const prisma = new PrismaClient();
const FIX_MODE = process.argv.includes('--fix');

async function main() {
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║     Lanka Offers — Duplicate Offer Scanner   ║');
    console.log(`║     Mode: ${FIX_MODE ? 'FIX (will delete dupes)    ' : 'AUDIT ONLY (read-only)       '}   ║`);
    console.log('╚══════════════════════════════════════════════╝\n');

    await prisma.$connect();

    // ─── 1. Find DB-level duplicates by exact unique_id ──────────────────────
    console.log('■ Checking for exact unique_id duplicates...');
    const uidGroups = await prisma.$queryRaw`
        SELECT unique_id, COUNT(*) as cnt, array_agg(id ORDER BY created_at ASC) as ids
        FROM offers
        GROUP BY unique_id
        HAVING COUNT(*) > 1
    `;

    if (uidGroups.length === 0) {
        console.log('  ✅  No exact unique_id duplicates found\n');
    } else {
        console.log(`  ⚠️   Found ${uidGroups.length} duplicate unique_ids:\n`);
        for (const row of uidGroups) {
            console.log(`  • ${row.unique_id}  (${row.cnt} records)`);
            console.log(`    IDs: ${row.ids.join(', ')}`);
            if (FIX_MODE) {
                // Keep the FIRST (oldest) record, delete the rest
                const toDelete = row.ids.slice(1);
                await prisma.offer.deleteMany({ where: { id: { in: toDelete } } });
                console.log(`    🗑️  Deleted ${toDelete.length} duplicates`);
            }
        }
    }

    // ─── 2. Find near-duplicates by merchant+bank+validTo ────────────────────
    console.log('\n■ Checking for near-duplicates (same merchant + bank + validTo)...');
    const nearDupes = await prisma.$queryRaw`
        SELECT 
            merchant_name,
            source,
            valid_to,
            COUNT(*) as cnt,
            array_agg(id ORDER BY created_at ASC) as ids,
            array_agg(unique_id ORDER BY created_at ASC) as unique_ids
        FROM offers
        WHERE merchant_name IS NOT NULL AND valid_to IS NOT NULL
        GROUP BY merchant_name, source, valid_to
        HAVING COUNT(*) > 1
        ORDER BY cnt DESC
        LIMIT 50
    `;

    if (nearDupes.length === 0) {
        console.log('  ✅  No near-duplicates found\n');
    } else {
        console.log(`  ⚠️   Found ${nearDupes.length} potential near-duplicate groups (top 50):\n`);
        for (const row of nearDupes) {
            const validTo = row.valid_to ? new Date(row.valid_to).toLocaleDateString() : 'null';
            console.log(`  • Merchant: "${row.merchant_name}"  Bank: ${row.source}  Valid to: ${validTo}`);
            console.log(`    Count: ${row.cnt}  IDs: ${row.unique_ids.slice(0, 3).join(', ')}${row.cnt > 3 ? '...' : ''}`);
        }
    }

    // ─── 3. Check for offers with missing unique_id ───────────────────────────
    console.log('\n■ Checking for offers without a unique_id...');
    const missingId = await prisma.offer.count({
        where: { unique_id: { equals: '' } }
    });
    if (missingId === 0) {
        console.log('  ✅  All offers have a unique_id\n');
    } else {
        console.log(`  ❌  ${missingId} offers have an empty unique_id — these WILL create duplicates!\n`);
    }

    // ─── 4. Summary by bank ───────────────────────────────────────────────────
    console.log('\n■ Total offers per bank:');
    const perBank = await prisma.offer.groupBy({
        by: ['source'],
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
    });
    for (const row of perBank) {
        console.log(`  ${row.source.padEnd(14)} ${String(row._count.id).padStart(5)} offers`);
    }

    console.log('\n─────────────────────────────────────────────────');
    console.log(FIX_MODE
        ? '✅ Fix mode complete — duplicates deleted'
        : '💡 To auto-delete duplicates: node scripts/check-duplicates.js --fix');
    console.log('─────────────────────────────────────────────────\n');
}

main()
    .catch(e => { console.error('❌ Error:', e); process.exit(1); })
    .finally(async () => { await prisma.$disconnect(); });
