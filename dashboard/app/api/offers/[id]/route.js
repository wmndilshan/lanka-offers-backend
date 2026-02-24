import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// GET /api/offers/[id]
export async function GET(request, { params }) {
    try {
        const offer = await prisma.offer.findUnique({
            where: { id: params.id },
            include: {
                locations: true,
                rawData: true,
            },
        });
        if (!offer) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        return NextResponse.json(offer);
    } catch (error) {
        console.error('GET offer error:', error);
        return NextResponse.json({ error: 'Failed to fetch offer' }, { status: 500 });
    }
}

// PUT /api/offers/[id] — update offer
export async function PUT(request, { params }) {
    try {
        const body = await request.json();
        const {
            title, description, merchantName, category, cardType,
            discountPercentage, discountDescription, applicableCards,
            validFrom, validTo, reviewStatus, bookingRequired,
            daysApplicable, editNotes, source,
        } = body;

        const updated = await prisma.offer.update({
            where: { id: params.id },
            data: {
                ...(title !== undefined && { title }),
                ...(description !== undefined && { description }),
                ...(merchantName !== undefined && { merchantName }),
                ...(category !== undefined && { category }),
                ...(cardType !== undefined && { cardType }),
                ...(discountPercentage !== undefined && { discountPercentage: discountPercentage !== null ? Number(discountPercentage) : null }),
                ...(discountDescription !== undefined && { discountDescription }),
                ...(applicableCards !== undefined && { applicableCards }),
                ...(validFrom !== undefined && { validFrom: validFrom ? new Date(validFrom) : null }),
                ...(validTo !== undefined && { validTo: validTo ? new Date(validTo) : null }),
                ...(reviewStatus !== undefined && { reviewStatus }),
                ...(bookingRequired !== undefined && { bookingRequired }),
                ...(daysApplicable !== undefined && { daysApplicable }),
                ...(editNotes !== undefined && { editNotes }),
                ...(source !== undefined && { source }),
                editedAt: new Date(),
            },
        });
        return NextResponse.json(updated);
    } catch (error) {
        console.error('PUT offer error:', error);
        return NextResponse.json({ error: 'Failed to update offer' }, { status: 500 });
    }
}

// DELETE /api/offers/[id]
export async function DELETE(request, { params }) {
    try {
        await prisma.offer.delete({ where: { id: params.id } });
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('DELETE offer error:', error);
        return NextResponse.json({ error: 'Failed to delete offer' }, { status: 500 });
    }
}
