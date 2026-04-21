
import { NextResponse } from 'next/server';
import { suggestOfferImprovements } from '@/lib/ai.mjs';
import prisma from '@/lib/prisma.mjs';
import { requireAdminKey } from '@/lib/dashboard-auth.mjs';

export async function POST(request) {
    const authError = requireAdminKey(request);
    if (authError) return authError;
    try {
        const body = await request.json();
        const { offerId, rawText } = body;

        let offerData = {};

        if (offerId) {
            // Fetch offer from DB
            const offer = await prisma.offer.findUnique({
                where: { id: offerId },
                include: { rawData: true }
            });

            if (!offer) {
                return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
            }
            offerData = offer;
        } else if (rawText) {
            // Use raw text input (for testing or manual entry)
            offerData = { title: rawText, rawData: { text: rawText } };
        } else {
            return NextResponse.json({ error: 'Missing offerId or rawText' }, { status: 400 });
        }

        // Call AI service
        const suggestions = await suggestOfferImprovements(offerData);

        return NextResponse.json(suggestions);
    } catch (error) {
        console.error('AI API Error:', error);
        return NextResponse.json(
            { error: 'Failed to generate suggestions' },
            { status: 500 }
        );
    }
}
