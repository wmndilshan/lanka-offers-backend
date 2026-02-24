import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
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
        const scraperData = await Promise.all(
            BANKS.map(async (bank) => {
                const bankKey = bank === "People's" ? 'peoples' : bank.toLowerCase().replace(/\s+/g, '_');

                // Get the latest scraped offer
                const latest = await prisma.offer.findFirst({
                    where: { source: { contains: bank.split(' ')[0], mode: 'insensitive' } },
                    orderBy: { scrapedAt: 'desc' },
                    select: { scrapedAt: true },
                });

                // Count all offers from this bank
                const offersFound = await prisma.offer.count({
                    where: { source: { contains: bank.split(' ')[0], mode: 'insensitive' } },
                });

                // Count offers added in last 24h (approximated as "new")
                const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
                const offersNew = await prisma.offer.count({
                    where: {
                        source: { contains: bank.split(' ')[0], mode: 'insensitive' },
                        createdAt: { gte: oneDayAgo },
                    },
                });

                const status = deriveStatus(latest?.scrapedAt, 0);

                return {
                    bank,
                    status,
                    offersFound,
                    offersNew,
                    offersUpdated: 0,
                    errors: 0,
                    lastRun: latest?.scrapedAt
                        ? formatDistanceToNow(new Date(latest.scrapedAt), { addSuffix: true })
                        : 'Never',
                    nextRun: 'Daily at 2:00 AM',
                };
            })
        );

        return NextResponse.json({ scrapers: scraperData });
    } catch (error) {
        console.error('Scraper status error:', error);
        return NextResponse.json({ error: 'Failed to fetch scraper status' }, { status: 500 });
    }
}
