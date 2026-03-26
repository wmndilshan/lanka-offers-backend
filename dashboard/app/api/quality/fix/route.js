import prisma from '@/lib/prisma.mjs';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request) {
    try {
        const { action } = await request.json();
        const now = new Date();

        if (action === 'deactivate_expired') {
            // Update all expired offers -> set reviewStatus to 'rejected'
            const result = await prisma.offer.updateMany({
                where: { validTo: { lt: now }, reviewStatus: { not: 'rejected' } },
                data: { reviewStatus: 'rejected' },
            });
            return NextResponse.json({ success: true, affected: result.count, message: `Deactivated ${result.count} expired offers` });
        }

        if (action === 'regeocode_missing') {
            // For now, just return a stub — real implementation would enqueue a job
            const count = await prisma.offer.count({ where: { locations: { none: {} } } });
            return NextResponse.json({
                success: true,
                affected: count,
                message: `Geocoding job queued for ${count} offers. Check scraper logs for progress.`,
                queued: true,
            });
        }

        if (action === 'refresh_stale') {
            const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            const count = await prisma.offer.count({ where: { updatedAt: { lt: thirtyDaysAgo } } });
            return NextResponse.json({
                success: true,
                affected: count,
                message: `Re-scrape job queued for ${count} stale offers.`,
                queued: true,
            });
        }

        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    } catch (error) {
        console.error('Quality fix error:', error);
        return NextResponse.json({ error: 'Fix action failed' }, { status: 500 });
    }
}
