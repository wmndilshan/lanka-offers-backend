import prisma from '@/lib/prisma.mjs';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        // Aggregate from offers table (no merchants table yet)
        const merchantStats = await prisma.offer.groupBy({
            by: ['merchantName', 'category'],
            where: { merchantName: { not: null } },
            _count: { id: true },
            _avg: { discountPercentage: true },
            orderBy: { _count: { id: 'desc' } },
        });

        // Get bank count per merchant (top 100 to keep it fast)
        const topMerchantNames = merchantStats.slice(0, 100).map(m => m.merchantName);

        const bankCountResults = await Promise.all(
            topMerchantNames.map(name =>
                prisma.offer.groupBy({
                    by: ['source'],
                    where: { merchantName: name },
                }).then(rows => ({ name, banks: rows.length }))
            )
        );
        const bankCountMap = Object.fromEntries(bankCountResults.map(m => [m.name, m.banks]));

        const merchants = merchantStats.map(m => ({
            name: m.merchantName,
            category: m.category,
            offerCount: m._count.id,
            avgDiscount: m._avg.discountPercentage,
            banks: bankCountMap[m.merchantName] ?? 1,
            paymentStatus: 'free', // Default — will be expanded in Phase 1b
        }));

        return NextResponse.json({ merchants });
    } catch (error) {
        console.error('Merchants API error:', error);
        return NextResponse.json({ error: 'Failed to fetch merchants' }, { status: 500 });
    }
}
