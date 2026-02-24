
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
