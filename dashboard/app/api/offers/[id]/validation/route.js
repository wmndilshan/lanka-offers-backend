import prisma from '@/lib/prisma.mjs';
import { NextResponse } from 'next/server';
import { validateOfferWithPipeline } from '@/lib/validation-pipeline.mjs';
import { getAppLogger } from '@/lib/app-logger.mjs';

export const dynamic = 'force-dynamic';
const log = getAppLogger('validation-api');

export async function GET(request, { params }) {
    try {
        const url = new URL(request.url);
        const refresh = url.searchParams.get('refresh') === '1';

        const offer = await prisma.offer.findUnique({
            where: { id: params.id },
            include: { rawData: true },
        });
        if (!offer) return NextResponse.json({ error: 'Not found' }, { status: 404 });

        if (!refresh) {
            const existing = await prisma.offerValidation.findUnique({
                where: { offerId: offer.id },
            });
            if (existing) {
                log.info('GET', 'Validation cache hit', { offerId: offer.id });
                return NextResponse.json({ status: 'cached', validation: existing });
            }
        }

        const result = await validateOfferWithPipeline({
            prisma,
            offer,
            rawData: offer.rawData,
            forceLlm: refresh,
        });

        const validation = await prisma.offerValidation.findUnique({
            where: { offerId: offer.id },
        });

        log.success('GET', 'Validation generated', { offerId: offer.id });
        return NextResponse.json({ status: 'generated', result, validation });
    } catch (error) {
        console.error('Offer validation error:', error);
        log.error('GET', 'Validation failed', { offerId: params.id, error: error.message });
        return NextResponse.json({ error: 'Failed to validate offer' }, { status: 500 });
    }
}

export async function POST(request, { params }) {
    try {
        const offer = await prisma.offer.findUnique({
            where: { id: params.id },
            include: { rawData: true },
        });
        if (!offer) return NextResponse.json({ error: 'Not found' }, { status: 404 });

        const result = await validateOfferWithPipeline({
            prisma,
            offer,
            rawData: offer.rawData,
            forceLlm: true,
        });

        const validation = await prisma.offerValidation.findUnique({
            where: { offerId: offer.id },
        });

        log.success('POST', 'Validation forced', { offerId: offer.id });
        return NextResponse.json({ status: 'generated', result, validation });
    } catch (error) {
        console.error('Offer validation error:', error);
        log.error('POST', 'Validation failed', { offerId: params.id, error: error.message });
        return NextResponse.json({ error: 'Failed to validate offer' }, { status: 500 });
    }
}
