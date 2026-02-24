
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(request) {
    try {
        const checks = {
            expired: {
                title: 'Expired Offers',
                query: { validTo: { lt: new Date() }, reviewStatus: 'approved' },
                description: 'Approved offers that are now past their expiration date.',
                action: 'archive'
            },
            missingFields: {
                title: 'Missing Critical Data',
                query: {
                    OR: [
                        { merchantName: null },
                        { category: null },
                        { title: null }
                    ],
                    reviewStatus: 'approved'
                },
                description: 'Active offers missing Merchant Name, Category, or Title.',
                action: 'flag'
            },
            suspiciousDiscount: {
                title: 'Suspicious Discounts',
                // This is tricky with Prisma; we'll fetch a sample or filter in JS if needed.
                // For simplicity, let's flag short/empty descriptions for now.
                query: {
                    OR: [
                        { discountDescription: { equals: '' } },
                        { discountDescription: { equals: null } }
                    ],
                    reviewStatus: 'approved'
                },
                description: 'Active offers with empty discount descriptions.',
                action: 'review'
            },
            orphanedLocations: {
                // This requires raw query or different logic as 'locations' is JSON
                // We'll skip complex JSON logic for now and focus on invalid lat/lon
                title: 'Invalid Coordinates',
                // In a real app we'd use PostGIS. Here we'll just check if locations array is empty for approved offers
                query: {
                    AND: [
                        { reviewStatus: 'approved' },
                        { locations: { equals: [] } } // Prisma JSON filter
                    ]
                },
                description: 'Approved offers with no location data.',
                action: 'review'
            }
        };

        const results = {};

        for (const [key, check] of Object.entries(checks)) {
            const count = await prisma.offer.count({ where: check.query });
            results[key] = {
                ...check,
                count,
                sample: count > 0 ? await prisma.offer.findMany({ where: check.query, take: 5 }) : []
            };
        }

        return NextResponse.json(results);

    } catch (error) {
        console.error('Health Check Error:', error);
        return NextResponse.json(
            { error: 'Failed to run health checks' },
            { status: 500 }
        );
    }
}

export async function POST(request) {
    try {
        const { checkType, action } = await request.json();

        if (checkType === 'expired' && action === 'archive') {
            const result = await prisma.offer.updateMany({
                where: { validTo: { lt: new Date() }, reviewStatus: 'approved' },
                data: { reviewStatus: 'rejected' } // Or 'archived' if we had that status
            });
            return NextResponse.json({ message: `Archived ${result.count} expired offers.` });
        }

        return NextResponse.json({ error: 'Action not supported yet' }, { status: 400 });

    } catch (error) {
        console.error('Health Action Error:', error);
        return NextResponse.json({ error: 'Failed to execute action' }, { status: 500 });
    }
}
