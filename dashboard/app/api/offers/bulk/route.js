import prisma from '@/lib/prisma.mjs';
import { NextResponse } from 'next/server';
import { requireAdminKey } from '@/lib/dashboard-auth.mjs';

export async function POST(request) {
    const authError = requireAdminKey(request);
    if (authError) return authError;
    try {
        const body = await request.json();
        const { ids, action } = body;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return NextResponse.json({ error: 'No IDs provided' }, { status: 400 });
        }

        if (!['approve', 'reject', 'delete'].includes(action)) {
            return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
        }

        if (action === 'delete') {
            await prisma.offer.deleteMany({
                where: { id: { in: ids } }
            });
            return NextResponse.json({ message: `Successfully deleted ${ids.length} offers` });
        }

        const data = action === 'approve'
            ? {
                reviewStatus: 'approved',
                isInProduction: true,
                pushedToDbAt: new Date(),
            }
            : {
                reviewStatus: 'rejected',
                isInProduction: false,
                pushedToDbAt: null,
            };

        await prisma.offer.updateMany({
            where: { id: { in: ids } },
            data,
        });

        return NextResponse.json({ message: `Successfully ${action}d ${ids.length} offers` });
    } catch (error) {
        console.error('Bulk API Error:', error);
        return NextResponse.json(
            { error: 'Failed to perform bulk action' },
            { status: 500 }
        );
    }
}
