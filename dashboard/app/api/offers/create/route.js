import prisma from '@/lib/prisma.mjs';
import { NextResponse } from 'next/server';
import { ensureValidationJobTable, scheduleOfferValidation } from '@/lib/validation-queue.mjs';
import { requireAdminKey } from '@/lib/dashboard-auth.mjs';

export const dynamic = 'force-dynamic';

// POST /api/offers — create a new offer manually
export async function POST(request) {
    const authError = requireAdminKey(request);
    if (authError) return authError;
    try {
        const body = await request.json();
        const {
            title, description, merchantName, category, cardType,
            discountPercentage, discountDescription, applicableCards,
            validFrom, validTo, reviewStatus, bookingRequired,
            daysApplicable, editNotes, source,
        } = body;

        if (!title || !merchantName) {
            return NextResponse.json({ error: 'title and merchantName are required' }, { status: 400 });
        }

        const created = await prisma.offer.create({
            data: {
                unique_id: `manual_${Date.now()}`,
                source_id: 0,
                source: source || 'Manual',
                category: category || 'Other',
                title,
                cardType: cardType || 'credit',
                merchantName,
                description,
                discountPercentage: discountPercentage != null ? Number(discountPercentage) : null,
                discountDescription,
                applicableCards: applicableCards || [],
                validFrom: validFrom ? new Date(validFrom) : null,
                validTo: validTo ? new Date(validTo) : null,
                reviewStatus: reviewStatus || 'pending',
                bookingRequired: bookingRequired || false,
                daysApplicable,
                editNotes,
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
                offer: created,
                rawData: created.rawData,
                reason: 'manual_create',
                priority: 50,
            });
        } catch (validationError) {
            console.warn('POST offer validation queue warning:', validationError.message);
        }

        return NextResponse.json(created, { status: 201 });
    } catch (error) {
        console.error('POST offer error:', error);
        return NextResponse.json({ error: 'Failed to create offer' }, { status: 500 });
    }
}
