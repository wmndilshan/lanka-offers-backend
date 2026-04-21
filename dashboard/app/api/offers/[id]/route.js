import prisma from '@/lib/prisma.mjs';
import { NextResponse } from 'next/server';
import { ensureValidationJobTable, scheduleOfferValidation } from '@/lib/validation-queue.mjs';
import { requireAdminKey } from '@/lib/dashboard-auth.mjs';

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

// PUT /api/offers/[id] - update offer
export async function PUT(request, { params }) {
    const authError = requireAdminKey(request);
    if (authError) return authError;
    try {
        const body = await request.json();
        const {
            title, description, merchantName, category, cardType,
            discountPercentage, discountDescription, applicableCards,
            validFrom, validTo, reviewStatus, bookingRequired,
            daysApplicable, editNotes, source, isInProduction,
        } = body;

        const statusData = {};
        if (reviewStatus !== undefined) {
            statusData.reviewStatus = reviewStatus;
            if (isInProduction !== undefined) {
                statusData.isInProduction = Boolean(isInProduction);
            } else if (reviewStatus === 'approved') {
                statusData.isInProduction = true;
                statusData.pushedToDbAt = new Date();
            } else if (reviewStatus === 'rejected') {
                statusData.isInProduction = false;
                statusData.pushedToDbAt = null;
            }
        } else if (isInProduction !== undefined) {
            statusData.isInProduction = Boolean(isInProduction);
        }

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
                ...(bookingRequired !== undefined && { bookingRequired }),
                ...(daysApplicable !== undefined && { daysApplicable }),
                ...(editNotes !== undefined && { editNotes }),
                ...(source !== undefined && { source }),
                ...statusData,
                editedAt: new Date(),
            },
            include: {
                rawData: true,
            },
        });

        try {
            await ensureValidationJobTable();
            await scheduleOfferValidation({
                prisma,
                offer: updated,
                rawData: updated.rawData,
                reason: 'manual_update',
                priority: 50,
            });
        } catch (validationError) {
            console.warn('PUT offer validation queue warning:', validationError.message);
        }

        return NextResponse.json(updated);
    } catch (error) {
        console.error('PUT offer error:', error);
        return NextResponse.json({ error: 'Failed to update offer' }, { status: 500 });
    }
}

// DELETE /api/offers/[id]
export async function DELETE(request, { params }) {
    const authError = requireAdminKey(request);
    if (authError) return authError;
    try {
        await prisma.offer.delete({ where: { id: params.id } });
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('DELETE offer error:', error);
        return NextResponse.json({ error: 'Failed to delete offer' }, { status: 500 });
    }
}
