
import OpenAI from "openai";

// Initialize OpenAI client with DeepSeek configuration
const openai = new OpenAI({
    baseURL: process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY,
});

/**
 * Generate improved offer details using DeepSeek AI
 * @param {Object} offer - The offer object containing current data
 * @returns {Promise<Object>} - Structured suggestions
 */
export async function suggestOfferImprovements(offer) {
    if (!offer) throw new Error("No offer data provided");

    const prompt = `
  You are an expert data curator for bank offers.
  Analyze the following raw bank offer data and extract structured information.
  
  CURRENT DATA:
  Title: "${offer.title}"
  Merchant: "${offer.merchantName}"
  Description: "${offer.discountDescription || ''}"
  Category: "${offer.category}"
  Source: "${offer.source}"
  Raw Data: ${JSON.stringify(offer.rawData || {}).slice(0, 1000)}

  INSTRUCTIONS:
  1. Title: Make it concise and catchy (e.g., "20% off at Hilton" instead of "Enjoy 20% off...").
  2. Merchant: Extract the clean merchant name.
  3. Category: Classify into one of: Dining, Hotel, Lifestyle, Shopping, Travel, Health, Online.
  4. Discount: Extract percentage (number) and a short description.
  5. Validity: Infer validFrom and validTo dates if mentioned in text (YYYY-MM-DD), otherwise null.

  OUTPUT JSON FORMAT ONLY:
  {
    "title": "Clean Title",
    "merchantName": "Merchant Name",
    "category": "Category",
    "discountDescription": "Short discount text",
    "validFrom": "YYYY-MM-DD" or null,
    "validTo": "YYYY-MM-DD" or null,
    "reasoning": "Brief explanation of changes"
  }
  `;

    try {
        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: "You are a helpful assistant that outputs only valid JSON." },
                { role: "user", content: prompt }
            ],
            model: "deepseek-coder", // or deepseek-chat, check availability
            response_format: { type: "json_object" },
            temperature: 0.1,
        });

        const content = completion.choices[0].message.content;
        return JSON.parse(content);
    } catch (error) {
        console.error("AI Suggestion Error:", error);
        throw new Error("Failed to generate suggestions");
    }
}

/**
 * Validate and normalize an offer using LLM, returning corrected fields + issues.
 */
export async function validateOfferWithLlm({ offer, rawData, ruleCandidate, model, promptVersion }) {
    if (!offer) throw new Error("No offer data provided");

    const prompt = `
You are validating scraped bank offer data for Sri Lanka.

RULE-BASED CANDIDATE (may be wrong or incomplete):
${JSON.stringify(ruleCandidate, null, 2)}

RAW DATA (truth source):
${JSON.stringify({
        rawValidFrom: rawData?.rawValidFrom || rawData?._raw_validFrom || null,
        rawValidUntil: rawData?.rawValidUntil || rawData?._raw_validUntil || null,
        rawListItem: rawData?.rawListItem || rawData?._raw_list_item || null,
        rawDetail: rawData?.rawDetail || rawData?._raw_detail || null,
        rawHtmlContent: rawData?.rawHtmlContent || rawData?._raw_htmlContent || null,
    }, null, 2)}

RULES:
- Return ONLY JSON.
- Dates must be "YYYY-MM-DD" or null.
- If validity is recurring, put the concrete range in validFrom/validTo if present,
  and describe the recurrence in daysApplicable (e.g., "Every Sunday", "Weekdays", "This month on Wed/Fri").
- If no validity date is present, return nulls and add issue "MISSING_VALIDITY".
- Do not invent merchant names or categories.

OUTPUT JSON FORMAT:
{
  "candidate": {
    "title": "...",
    "merchantName": "...",
    "category": "...",
    "cardType": "...",
    "discountPercentage": 20,
    "discountDescription": "...",
    "validFrom": "YYYY-MM-DD" or null,
    "validTo": "YYYY-MM-DD" or null,
    "merchantLocations": ["list of specific branch names or addresses mentioned in text"],
  },
  "issues": ["MISSING_VALIDITY", "INVALID_DATE_RANGE", "MISSING_LOCATIONS"],
  "notes": "short reason"
}
`;

    try {
        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: "You are a strict validator that outputs only valid JSON." },
                { role: "user", content: prompt }
            ],
            model: model || "deepseek-coder",
            response_format: { type: "json_object" },
            temperature: 0.1,
        });

        const content = completion.choices[0].message.content;
        const parsed = JSON.parse(content);
        return {
            ...parsed,
            model: model || "deepseek-coder",
            promptVersion: promptVersion || "v1",
        };
    } catch (error) {
        console.error("AI Validation Error:", error);
        throw new Error("Failed to validate offer with LLM");
    }
}
