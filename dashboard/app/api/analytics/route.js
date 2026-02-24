import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { formatDistanceToNow, addWeeks, startOfWeek, endOfWeek, format } from 'date-fns';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const now = new Date();
        const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        // ─── Summary Metrics ───────────────────────────────────────────────
        const [
            totalActive,
            totalActiveLastWeek,
            expiringIn7Days,
            latestOffer,
        ] = await Promise.all([
            prisma.offer.count({ where: { reviewStatus: 'approved' } }),
            prisma.offer.count({
                where: { reviewStatus: 'approved', createdAt: { lte: oneWeekAgo } }
            }),
            prisma.offer.count({
                where: { reviewStatus: 'approved', validTo: { gte: now, lte: sevenDaysFromNow } }
            }),
            prisma.offer.findFirst({
                orderBy: { scrapedAt: 'desc' },
                select: { scrapedAt: true }
            }),
        ]);

        // Count unique merchants
        const merchantGroups = await prisma.offer.groupBy({
            by: ['merchantName'],
            where: { merchantName: { not: null } },
        });
        const uniqueMerchants = merchantGroups.length;

        // Count unique banks
        const bankGroups = await prisma.offer.groupBy({ by: ['source'] });
        const banksTracked = bankGroups.length;

        const activeChange = totalActiveLastWeek > 0
            ? Math.round(((totalActive - totalActiveLastWeek) / totalActiveLastWeek) * 100)
            : null;

        const summary = {
            totalActive,
            activeChange,
            uniqueMerchants,
            expiringIn7Days,
            banksTracked: Math.max(banksTracked, 8),
            lastScrapeRelative: latestOffer?.scrapedAt
                ? formatDistanceToNow(new Date(latestOffer.scrapedAt), { addSuffix: true })
                : 'Never',
        };

        // ─── Chart: Offers by Category ─────────────────────────────────────
        const byCategoryRaw = await prisma.offer.groupBy({
            by: ['category'],
            _count: { id: true },
            orderBy: { _count: { id: 'desc' } },
            take: 8,
        });
        const byCategory = byCategoryRaw
            .filter(r => r.category)
            .map(r => ({ category: r.category, count: r._count.id }));

        // ─── Chart: Offers by Bank ─────────────────────────────────────────
        const byBankRaw = await prisma.offer.groupBy({
            by: ['source'],
            _count: { id: true },
            orderBy: { _count: { id: 'desc' } },
        });
        const byBank = byBankRaw.map(r => ({ bank: r.source, count: r._count.id }));

        // ─── Chart: Offers by Discount Range ──────────────────────────────
        const allDiscounts = await prisma.offer.findMany({
            where: { discountPercentage: { not: null } },
            select: { discountPercentage: true },
        });
        const discountBuckets = { '0-10%': 0, '10-20%': 0, '20-30%': 0, '30-50%': 0, '50%+': 0 };
        allDiscounts.forEach(({ discountPercentage: d }) => {
            if (d <= 10) discountBuckets['0-10%']++;
            else if (d <= 20) discountBuckets['10-20%']++;
            else if (d <= 30) discountBuckets['20-30%']++;
            else if (d <= 50) discountBuckets['30-50%']++;
            else discountBuckets['50%+']++;
        });
        const byDiscount = Object.entries(discountBuckets).map(([range, count]) => ({ range, count }));

        // ─── Chart: Expiry Timeline (next 12 weeks) ────────────────────────
        const expiryTimeline = [];
        for (let i = 0; i < 12; i++) {
            const weekStart = startOfWeek(addWeeks(now, i));
            const weekEnd = endOfWeek(addWeeks(now, i));
            const count = await prisma.offer.count({
                where: { validTo: { gte: weekStart, lte: weekEnd } }
            });
            expiryTimeline.push({ week: format(weekStart, 'MMM d'), count });
        }

        // ─── Top Merchants ─────────────────────────────────────────────────
        const merchantStats = await prisma.offer.groupBy({
            by: ['merchantName', 'category'],
            where: { merchantName: { not: null } },
            _count: { id: true },
            _avg: { discountPercentage: true },
            orderBy: { _count: { id: 'desc' } },
            take: 20,
        });

        // Get bank count per merchant
        const topMerchantNames = merchantStats.slice(0, 15).map(m => m.merchantName);
        const merchantBankCounts = await Promise.all(
            topMerchantNames.map(name =>
                prisma.offer.groupBy({
                    by: ['source'],
                    where: { merchantName: name },
                }).then(rows => ({ name, banks: rows.length }))
            )
        );
        const bankCountMap = Object.fromEntries(merchantBankCounts.map(m => [m.name, m.banks]));

        const topMerchants = merchantStats.slice(0, 15).map(m => ({
            name: m.merchantName,
            category: m.category,
            offerCount: m._count.id,
            avgDiscount: m._avg.discountPercentage,
            banks: bankCountMap[m.merchantName] ?? 1,
        }));

        return NextResponse.json({ summary, charts: { byCategory, byBank, byDiscount, expiryTimeline, topMerchants } });
    } catch (error) {
        console.error('Analytics error:', error);
        return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 });
    }
}
