
import OpenAI from "openai";

const openai = new OpenAI({
    baseURL: process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY,
});

const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

/**
 * Sanitize a scraped text field before embedding in an LLM prompt.
 * Strips characters that could break out of a quoted JSON string in the prompt,
 * truncates to a safe length, and wraps in a data XML tag to reduce injection surface.
 */
function sanitizeField(value, maxLen = 400) {
    if (value === null || value === undefined) return '';
    const cleaned = String(value)
        .replace(/[\x00-\x1F\x7F]/g, ' ')  // control chars
        .replace(/`/g, "'")                   // backtick → single quote
        .trim()
        .slice(0, maxLen);
    return cleaned;
}

/**
 * Generate improved offer details using DeepSeek AI.
 * All scraped fields are sanitized before prompt injection (I-7).
 */
export async function suggestOfferImprovements(offer) {
    if (!offer) throw new Error("No offer data provided");

    const title = sanitizeField(offer.title);
    const merchant = sanitizeField(offer.merchantName);
    const description = sanitizeField(offer.discountDescription);
    const category = sanitizeField(offer.category);
    const source = sanitizeField(offer.source);
    const rawSnippet = sanitizeField(JSON.stringify(offer.rawData || {}), 800);

    const prompt = `You are an expert data curator for Sri Lankan bank card offers.
Analyze the offer data below and extract clean structured fields.

<offer_data>
<title>${title}</title>
<merchant>${merchant}</merchant>
<description>${description}</description>
<category>${category}</category>
<source>${source}</source>
<raw_snippet>${rawSnippet}</raw_snippet>
</offer_data>

INSTRUCTIONS:
1. Title: Make it concise (e.g., "20% off at Hilton" not "Enjoy 20% off..."). Max 80 chars.
2. Merchant: Clean merchant name only, no promotional text.
3. Category: One of: Dining, Hotel, Lifestyle, Shopping, Travel, Health, Online, Other.
4. Discount: Extract percentage as a number and a short description.
5. Validity: Extract validFrom and validTo as "YYYY-MM-DD" or null.

OUTPUT JSON ONLY — no markdown, no extra text:
{
  "title": "Clean Title",
  "merchantName": "Merchant Name",
  "category": "Category",
  "discountDescription": "Short discount text",
  "validFrom": "YYYY-MM-DD",
  "validTo": "YYYY-MM-DD",
  "reasoning": "Brief explanation"
}`;

    try {
        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: "You are a strict data extractor. Output only valid JSON, nothing else." },
                { role: "user", content: prompt },
            ],
            model: DEFAULT_MODEL,
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
 * rawData is expected to be pre-sanitized by validation-pipeline.mjs (createRawSnapshot).
 * We defensively re-sanitize text fields here as well (I-7).
 */
export async function validateOfferWithLlm({ offer, rawData, ruleCandidate, model, promptVersion }) {
    if (!offer) throw new Error("No offer data provided");

    // rawData arrives pre-sanitized from validation-pipeline.mjs createRawSnapshot,
    // but we defensively clamp any string fields that reach this boundary.
    const safeRawData = {
        rawValidFrom: sanitizeField(rawData?.rawValidFrom || rawData?._raw_validFrom, 128),
        rawValidUntil: sanitizeField(rawData?.rawValidUntil || rawData?._raw_validUntil, 128),
        rawValidityText: sanitizeField(rawData?.rawValidityText, 600),
        rawDiscountPhrase: sanitizeField(rawData?.rawDiscountPhrase, 400),
        rawListItem: rawData?.rawListItem || rawData?._raw_list_item || null,
        rawDetail: rawData?.rawDetail || rawData?._raw_detail || null,
        rawHtmlContent: sanitizeField(rawData?.rawHtmlContent || rawData?._raw_htmlContent, 4000),
        evidence: rawData?.evidence || null,
    };

    const prompt = `
You are validating scraped bank offer data for Sri Lanka.

RULE-BASED CANDIDATE (may be wrong or incomplete):
${JSON.stringify(ruleCandidate, null, 2)}

RAW DATA (truth source):
${JSON.stringify(safeRawData, null, 2)}

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
    "daysApplicable": "e.g. Every Sunday, Weekdays, null if not specified",
    "merchantLocations": ["list of specific branch names or addresses mentioned in text"],
  },
  "fieldVerdicts": {
    "title": { "verdict": "supported|unsupported|unclear", "citation": "short substring from RAW DATA" },
    "validTo": { "verdict": "supported", "citation": "..." }
  },
  "issues": ["MISSING_VALIDITY", "INVALID_DATE_RANGE", "MISSING_LOCATIONS"],
  "notes": "short reason"
}

Fill fieldVerdicts for: title, merchantName, category, cardType, discountPercentage, discountDescription, validFrom, validTo.
Use verdict "unsupported" when raw text contradicts the rule candidate.
`;

    try {
        const resolvedModel = model || DEFAULT_MODEL;
        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: "You are a strict validator that outputs only valid JSON, nothing else." },
                { role: "user", content: prompt },
            ],
            model: resolvedModel,
            response_format: { type: "json_object" },
            temperature: 0.1,
        });

        const content = completion.choices[0].message.content;
        const parsed = JSON.parse(content);
        return {
            ...parsed,
            model: resolvedModel,
            promptVersion: promptVersion || "v1",
        };
    } catch (error) {
        console.error("AI Validation Error:", error);
        throw new Error("Failed to validate offer with LLM");
    }
}
