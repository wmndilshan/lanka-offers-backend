import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const ISSUE_TYPES = {
    expired: { label: 'Offer Expired', severity: 'critical' },
    missing_geo: { label: 'Missing Geocoordinates', severity: 'warning' },
    invalid_discount: { label: 'Invalid Discount %', severity: 'critical' },
    stale: { label: 'Not Updated in 30+ Days', severity: 'info' },
};

export async function GET() {
    try {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const issues = [];

        // 1. Expired offers (validTo < today)
        const expired = await prisma.offer.findMany({
            where: { validTo: { lt: now }, reviewStatus: { not: 'rejected' } },
            select: { id: true, title: true, merchantName: true, source: true, validTo: true },
            take: 100,
        });
        expired.forEach(o => issues.push({
            offerId: o.id,
            type: 'expired',
            typeLabel: ISSUE_TYPES.expired.label,
            severity: ISSUE_TYPES.expired.severity,
            title: o.title || o.merchantName,
            source: o.source,
            detail: `Valid until: ${o.validTo ? new Date(o.validTo).toLocaleDateString() : 'unknown'}`,
        }));

        // 2. Missing geocoordinates
        const noGeo = await prisma.offer.findMany({
            where: { locations: { none: {} } },
            select: { id: true, title: true, merchantName: true, source: true },
            take: 100,
        });
        noGeo.forEach(o => issues.push({
            offerId: o.id,
            type: 'missing_geo',
            typeLabel: ISSUE_TYPES.missing_geo.label,
            severity: ISSUE_TYPES.missing_geo.severity,
            title: o.title || o.merchantName,
            source: o.source,
            detail: 'This offer has no geocoded locations attached.',
        }));

        // 3. Invalid discount percentage
        const invalidDiscount = await prisma.offer.findMany({
            where: {
                OR: [
                    { discountPercentage: { gt: 100 } },
                    { discountPercentage: { lte: 0 } },
                ],
                discountPercentage: { not: null },
            },
            select: { id: true, title: true, merchantName: true, source: true, discountPercentage: true },
            take: 50,
        });
        invalidDiscount.forEach(o => issues.push({
            offerId: o.id,
            type: 'invalid_discount',
            typeLabel: ISSUE_TYPES.invalid_discount.label,
            severity: ISSUE_TYPES.invalid_discount.severity,
            title: o.title || o.merchantName,
            source: o.source,
            detail: `Discount percentage is ${o.discountPercentage}% — must be 1-100.`,
        }));

        // 4. Stale offers (not updated in 30+ days)
        const stale = await prisma.offer.findMany({
            where: { updatedAt: { lt: thirtyDaysAgo }, reviewStatus: 'approved' },
            select: { id: true, title: true, merchantName: true, source: true, updatedAt: true },
            take: 50,
        });
        stale.forEach(o => issues.push({
            offerId: o.id,
            type: 'stale',
            typeLabel: ISSUE_TYPES.stale.label,
            severity: ISSUE_TYPES.stale.severity,
            title: o.title || o.merchantName,
            source: o.source,
            detail: `Last updated: ${new Date(o.updatedAt).toLocaleDateString()}`,
        }));

        const summary = {
            expired: expired.length,
            missingGeo: noGeo.length,
            invalidDiscount: invalidDiscount.length,
            stale: stale.length,
        };

        return NextResponse.json({ issues, summary });
    } catch (error) {
        console.error('Quality check error:', error);
        return NextResponse.json({ error: 'Failed to check quality' }, { status: 500 });
    }
}
