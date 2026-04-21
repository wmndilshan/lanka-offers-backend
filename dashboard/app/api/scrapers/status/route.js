import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma.mjs';
import { formatDistanceToNow, addHours } from 'date-fns';

export const dynamic = 'force-dynamic';

const BANKS = ['HNB', 'BOC', 'NDB', 'Sampath', 'Pan Asia', 'Seylan', 'DFCC', "People's"];

// Determine status from last scrape time (heuristic until scraper_runs table exists)
function deriveStatus(latestScrapedAt, errorCount) {
    if (!latestScrapedAt) return 'not_scheduled';
    const ageHours = (Date.now() - new Date(latestScrapedAt).getTime()) / (1000 * 60 * 60);
    if (errorCount > 0) return 'warning';
    if (ageHours > 48) return 'failed';
    if (ageHours > 24) return 'warning';
    return 'success';
}

export async function GET() {
    try {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        // 3 queries total instead of 24 (8 banks × 3)
        const [latestPerBank, totalPerBank, newPerBank] = await Promise.all([
            prisma.offer.groupBy({
                by: ['source'],
                _max: { scrapedAt: true },
            }),
            prisma.offer.groupBy({
                by: ['source'],
                _count: { id: true },
            }),
            prisma.offer.groupBy({
                by: ['source'],
                where: { createdAt: { gte: oneDayAgo } },
                _count: { id: true },
            }),
        ]);

        const latestMap = Object.fromEntries(latestPerBank.map(r => [r.source, r._max.scrapedAt]));
        const totalMap = Object.fromEntries(totalPerBank.map(r => [r.source, r._count.id]));
        const newMap = Object.fromEntries(newPerBank.map(r => [r.source, r._count.id]));

        const scraperData = BANKS.map((bank) => {
            const bankPrefix = bank.split(' ')[0];
            // Match source case-insensitively by finding the key that starts with the prefix
            const sourceKey = Object.keys(totalMap).find(
                k => k.toLowerCase().startsWith(bankPrefix.toLowerCase())
            ) || bank;

            const lastScrapedAt = latestMap[sourceKey] || null;
            const offersFound = totalMap[sourceKey] || 0;
            const offersNew = newMap[sourceKey] || 0;

            return {
                bank,
                status: deriveStatus(lastScrapedAt, 0),
                offersFound,
                offersNew,
                offersUpdated: 0,
                errors: 0,
                lastRun: lastScrapedAt
                    ? formatDistanceToNow(new Date(lastScrapedAt), { addSuffix: true })
                    : 'Never',
                nextRun: 'Daily at 2:00 AM',
            };
        });

        return NextResponse.json({ scrapers: scraperData });
    } catch (error) {
        console.error('Scraper status error:', error);
        return NextResponse.json({ error: 'Failed to fetch scraper status' }, { status: 500 });
    }
}
