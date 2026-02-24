
import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function POST(request) {
    try {
        const body = await request.json();
        const { ids, action } = body;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return NextResponse.json({ error: 'No IDs provided' }, { status: 400 });
        }

        if (!['approve', 'reject', 'delete'].includes(action)) {
            return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
        }

        // Handle delete
        if (action === 'delete') {
            await prisma.offer.deleteMany({
                where: { id: { in: ids } }
            });
            return NextResponse.json({ message: `Successfully deleted ${ids.length} offers` });
        }

        // Handle status update
        const newStatus = action === 'approve' ? 'approved' : 'rejected';

        await prisma.offer.updateMany({
            where: { id: { in: ids } },
            data: {
                reviewStatus: newStatus,
                pushedToDbAt: new Date() // Mark the time they were "pushed" to production status
            }
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
