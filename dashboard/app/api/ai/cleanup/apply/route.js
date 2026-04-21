
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma.mjs';
import { requireAdminKey } from '@/lib/dashboard-auth.mjs';

export async function POST(request) {
    const authError = requireAdminKey(request);
    if (authError) return authError;
    try {
        const body = await request.json();
        const { merges, type } = body; // type = 'merchantName' or 'category'

        if (!merges || !Array.isArray(merges)) {
            return NextResponse.json({ error: 'Invalid merge data' }, { status: 400 });
        }

        if (!['merchantName', 'category'].includes(type)) {
            return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
        }

        const results = [];

        // Execute updates sequentially or in parallel
        for (const group of merges) {
            const { canonical, variations } = group;

            if (!canonical || !variations || variations.length === 0) continue;

            // Update all variations to the canonical name
            const update = await prisma.offer.updateMany({
                where: {
                    [type]: { in: variations }
                },
                data: {
                    [type]: canonical
                }
            });

            results.push({ canonical, updatedCount: update.count });
        }

        return NextResponse.json({
            message: `Successfully processed ${results.length} merge groups.`,
            details: results
        });

    } catch (error) {
        console.error('Cleanup Apply Error:', error);
        return NextResponse.json(
            { error: 'Failed to apply cleanup' },
            { status: 500 }
        );
    }
}
