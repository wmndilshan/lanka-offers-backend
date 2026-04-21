
import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import prisma from '@/lib/prisma.mjs';
import { requireAdminKey } from '@/lib/dashboard-auth.mjs';

const openai = new OpenAI({
    baseURL: process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY,
});

const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

const SYSTEM_PROMPT = `
You are a Database Assistant for an Offers Management System.
You have access to a PostgreSQL database via Prisma.
The 'Offer' table schema is:
- id: String (UUID)
- title: String
- merchantName: String
- category: String (Dining, Hotel, Lifestyle, Shopping, Travel, Health, Online)
- source: String (Bank Name)
- discountDescription: String
- validFrom: DateTime?
- validTo: DateTime?
- reviewStatus: String (pending, approved, rejected)
- locations: Json (Array of objects)

User will ask questions. You must reply with a JSON object.
If the user asks for data, generate a Prisma-like JSON query object.
If the user asks to Perform an action, generate a Prisma-like action object.

RESPONSE FORMAT:
{
  "reply": "Natural language summary of what is being done or found.",
  "action": {
    "type": "findMany" | "updateMany" | "count" | "deleteMany",
    "params": {
       // Prisma query parameters (where, orderBy, take, select)
    }
  }
}

EXAMPLE: "Show me pending dining offers"
{
  "reply": "Here are the pending dining offers.",
  "action": {
    "type": "findMany",
    "params": {
      "where": { "reviewStatus": "pending", "category": "Dining" },
      "take": 5
    }
  }
}
`;

export async function POST(request) {
    const authError = requireAdminKey(request);
    if (authError) return authError;

    try {
        const { message } = await request.json();

        // 1. Get Intent and Query from AI
        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: message }
            ],
            model: DEFAULT_MODEL,
            response_format: { type: "json_object" },
            temperature: 0.1,
        });

        const aiResponse = JSON.parse(completion.choices[0].message.content);
        const { reply, action } = aiResponse;

        // 2. Execute Query (Safe-guarded)
        // In a real app, strictly validate 'action' before execution!

        let result = null;
        let finalReply = reply;

        if (action) {
            if (action.type === 'findMany') {
                result = await prisma.offer.findMany(action.params);
                finalReply += ` Found ${result.length} records.`;
            } else if (action.type === 'count') {
                result = await prisma.offer.count(action.params);
                finalReply = `Count: ${result}`;
            }
            // For safety, we are NOT automatically executing update/delete in this demo
            // unless explicitly requested by specific authenticated admins.
            // We will just return the "Proposed Action" for now.
            else if (['updateMany', 'deleteMany'].includes(action.type)) {
                finalReply += " (Action generated but execution blocked for safety in this demo phase. Check console for query)";
                console.log("Proposed AI Action:", action);
            }
        }

        return NextResponse.json({
            reply: finalReply,
            action: action,
            data: result
        });

    } catch (error) {
        console.error('AI Chat Error:', error);
        return NextResponse.json(
            { error: 'Failed to process chat request' },
            { status: 500 }
        );
    }
}
