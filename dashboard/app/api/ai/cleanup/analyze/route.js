
import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import prisma from '@/lib/prisma.mjs';
import { requireAdminKey } from '@/lib/dashboard-auth.mjs';

const openai = new OpenAI({
    baseURL: process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY,
});

const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

export async function GET(request) {
    const authError = requireAdminKey(request);
    if (authError) return authError;
    try {
        const { searchParams } = new URL(request.url);
        const type = searchParams.get('type') || 'merchantName'; // merchantName or category

        if (!['merchantName', 'category'].includes(type)) {
            return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
        }

        // 1. Fetch all distinct values
        const distinctValues = await prisma.offer.findMany({
            select: { [type]: true },
            distinct: [type],
            where: { [type]: { not: null } }
        });

        const values = distinctValues.map(v => v[type]).filter(v => v && v.length > 2);

        if (values.length < 2) {
            return NextResponse.json({ groups: [] });
        }

        // 2. Ask AI to find duplicates/canonicaI forms
        const prompt = `
    You are a data cleaning expert.
    Analyze the following list of ${type}s and identify groups of values that refer to the same entity (e.g., typos, variations, case differences).
    For each group, choose the best "canonical" name.
    
    LIST:
    ${JSON.stringify(values.slice(0, 500))} 

    OUTPUT JSON FORMAT ONLY:
    {
      "groups": [
        {
          "canonical": "McDonald's",
          "variations": ["McD", "Mac Donalds", "McDonalds"] 
        }
      ]
    }
    Only include groups where there are actual variations. Ignore distinct unique items.
    `;

        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: "You are a helpful data cleaning assistant that outputs only valid JSON." },
                { role: "user", content: prompt }
            ],
            model: DEFAULT_MODEL,
            response_format: { type: "json_object" },
            temperature: 0.1,
        });

        const result = JSON.parse(completion.choices[0].message.content);
        return NextResponse.json(result);

    } catch (error) {
        console.error('Cleanup Analysis Error:', error);
        return NextResponse.json(
            { error: 'Failed to analyze data' },
            { status: 500 }
        );
    }
}
