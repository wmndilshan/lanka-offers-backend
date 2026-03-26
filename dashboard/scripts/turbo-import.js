const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const prisma = new PrismaClient();

// Limit concurrency to avoid hitting pool limits
const CONCURRENCY = 5;

async function withRetry(fn, maxRetries = 3) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            if (err.message.includes('Can\'t reach database server') || err.message.includes('P1001')) {
                console.warn(`  🔄 Retrying due to connection error (attempt ${i + 1}/${maxRetries})...`);
                await new Promise(r => setTimeout(r, 1000 * (i + 1))); // Exponential backoff
                continue;
            }
            throw err;
        }
    }
    throw lastError;
}

function parsePercentage(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return value;
    const match = String(value).trim().match(/(\d+(?:\.\d+)?)/);
    return match ? (parseFloat(match[1]) || null) : null;
}

function transformOffer(offer, bank = 'HNB') {
    return {
        unique_id: offer.unique_id,
        source_id: offer.source_id || 0,
        source: offer.source || bank.toUpperCase(),
        category: offer.category || 'General',
        title: offer.title || '',
        cardType: offer.card_type || 'credit',
        scrapedAt: new Date(),
        reviewStatus: 'pending',
        isInProduction: false,
        merchantName: offer.merchant?.name || offer.merchant_name || null,
        discountPercentage: parsePercentage(offer.structured_data?.discount_percentage),
        discountDescription: offer.structured_data?.discount_description || '',
        applicableCards: offer.structured_data?.applicable_cards || [],
        validFrom: offer.validity_periods?.[0]?.valid_from ? new Date(offer.validity_periods[0].valid_from) : null,
        validTo: offer.validity_periods?.[0]?.valid_to ? new Date(offer.validity_periods[0].valid_to) : null,
        status: 'active',
        lastScrapedAt: new Date(),
    };
}

async function main() {
    const filePath = path.resolve(__dirname, '..', '..', 'output', 'hnb_all_v9.json');
    if (!fs.existsSync(filePath)) {
        console.error('❌ File not found:', filePath);
        return;
    }

    const rawData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const allOffers = Array.isArray(rawData) ? rawData : (rawData.offers || []);

    // ─── Deduplicate by unique_id ──────────────────────────────────
    const seen = new Set();
    const offers = allOffers.filter(o => {
        if (!o.unique_id || seen.has(o.unique_id)) return false;
        seen.add(o.unique_id);
        return true;
    });

    console.log(`🚀 Turbo Importing ${offers.length} unique offers (skipped ${allOffers.length - offers.length} dups)...`);

    let count = 0;
    for (let i = 0; i < offers.length; i += CONCURRENCY) {
        const chunk = offers.slice(i, i + CONCURRENCY);
        await Promise.all(chunk.map(async (offer) => {
            try {
                const transformed = transformOffer(offer);
                await withRetry(async () => {
                    await prisma.offer.upsert({
                        where: { unique_id: offer.unique_id },
                        update: {
                            ...transformed,
                            rawData: {
                                upsert: {
                                    create: {
                                        rawValidFrom: offer._raw_validFrom || null,
                                        rawValidUntil: offer._raw_validUntil || null,
                                        rawHtmlContent: offer._raw_htmlContent || null,
                                    },
                                    update: {
                                        rawValidFrom: offer._raw_validFrom || null,
                                        rawValidUntil: offer._raw_validUntil || null,
                                        rawHtmlContent: offer._raw_htmlContent || null,
                                    }
                                }
                            }
                        },
                        create: {
                            ...transformed,
                            rawData: {
                                create: {
                                    rawValidFrom: offer._raw_validFrom || null,
                                    rawValidUntil: offer._raw_validUntil || null,
                                    rawHtmlContent: offer._raw_htmlContent || null,
                                }
                            }
                        }
                    });
                });
                count++;
            } catch (err) {
                console.error(`  ❌ Final Error on ${offer.unique_id}:`, err.message);
            }
        }));
        if (count % 100 === 0 || count === offers.length) {
            console.log(`✅ Progress: ${count}/${offers.length}`);
        }
    }

    console.log('✨ Turbo Import Complete!');
    await prisma.$disconnect();
}

main();
