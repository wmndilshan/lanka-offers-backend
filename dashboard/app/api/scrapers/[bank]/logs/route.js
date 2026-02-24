import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// Stub logs endpoint — returns last 100 log-like entries from recent offers
// Real implementation would query a scraper_logs table
export async function GET(request, { params }) {
    try {
        const bank = params.bank;

        const recentOffers = await prisma.offer.findMany({
            where: { source: { contains: bank, mode: 'insensitive' } },
            orderBy: { scrapedAt: 'desc' },
            take: 100,
            select: { id: true, title: true, merchantName: true, scrapedAt: true, reviewStatus: true },
        });

        const logs = recentOffers.map(o => ({
            timestamp: o.scrapedAt,
            level: 'INFO',
            message: `Scraped: ${o.merchantName || o.title || 'Unknown'}`,
            offerId: o.id,
        }));

        return NextResponse.json({ bank, logs });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 });
    }
}
