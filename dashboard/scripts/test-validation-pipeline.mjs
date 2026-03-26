import assert from 'node:assert/strict';
import { buildValidationArtifacts, validateOfferWithPipeline } from '../lib/validation-pipeline.mjs';

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createPrismaMock() {
    const llmCacheByKey = new Map();
    const offerValidationByOfferId = new Map();
    let validationCounter = 1;
    let cacheCounter = 1;

    return {
        __state: {
            llmCacheByKey,
            offerValidationByOfferId,
        },
        llmValidationCache: {
            async findFirst({ where }) {
                for (const record of llmCacheByKey.values()) {
                    if (
                        record.inputHash === where.inputHash
                        && record.model === where.model
                        && record.promptVersion === where.promptVersion
                    ) {
                        return clone(record);
                    }
                }
                return null;
            },
            async upsert({ where, create, update }) {
                const existing = llmCacheByKey.get(where.cacheKey);
                const next = existing
                    ? { ...existing, ...clone(update) }
                    : { id: `cache_${cacheCounter++}`, ...clone(create) };
                llmCacheByKey.set(where.cacheKey, next);
                return clone(next);
            },
        },
        offerValidation: {
            async findUnique({ where }) {
                return clone(offerValidationByOfferId.get(where.offerId) || null);
            },
            async create({ data }) {
                const record = { id: `validation_${validationCounter++}`, ...clone(data) };
                offerValidationByOfferId.set(data.offerId, record);
                return clone(record);
            },
            async update({ where, data }) {
                const existing = offerValidationByOfferId.get(where.offerId);
                const next = { ...existing, ...clone(data) };
                offerValidationByOfferId.set(where.offerId, next);
                return clone(next);
            },
        },
    };
}

function makeOffer(id, overrides = {}) {
    return {
        id,
        unique_id: `offer_${id}`,
        title: '20% off at Demo Hotel',
        merchantName: 'Demo Hotel',
        category: 'Hotel',
        cardType: 'credit',
        discountPercentage: 20,
        discountDescription: '20% off room rates',
        validFrom: '2026-03-01',
        validTo: '2026-03-31',
        daysApplicable: 'Weekdays',
        ...overrides,
    };
}

function makeRawData(overrides = {}) {
    return {
        rawValidFrom: '2026-03-01',
        rawValidUntil: '2026-03-31',
        rawListItem: {
            title: '20% off at Demo Hotel',
            merchant: 'Demo Hotel',
        },
        rawDetail: {
            content: 'Valid from 2026-03-01 to 2026-03-31 for weekday stays.',
        },
        rawHtmlContent: '<div>Valid from 2026-03-01 to 2026-03-31 for weekday stays.</div>',
        ...overrides,
    };
}

async function testStableFingerprint() {
    const offer = makeOffer('a');
    const rawA = makeRawData({
        rawDetail: { b: 'two', a: 'one' },
    });
    const rawB = makeRawData({
        rawDetail: { a: 'one', b: 'two' },
    });

    const first = buildValidationArtifacts({ offer, rawData: rawA });
    const second = buildValidationArtifacts({ offer, rawData: rawB });

    assert.equal(first.inputHash, second.inputHash, 'input hash should be stable across object key order');
    assert.equal(first.cacheKey, second.cacheKey, 'cache key should be stable across object key order');
}

async function testCacheReuseAcrossOffers() {
    const prisma = createPrismaMock();
    const originalKey = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = 'test-key';

    let llmCalls = 0;
    const llmValidator = async (_offer, _rawData, ruleCandidate) => {
        llmCalls += 1;
        return {
            candidate: ruleCandidate,
            issues: [],
            model: 'deepseek-coder',
            promptVersion: 'v2',
        };
    };

    const first = await validateOfferWithPipeline({
        prisma,
        offer: makeOffer('1', { unique_id: 'offer_one' }),
        rawData: makeRawData(),
        llmValidator,
    });
    const second = await validateOfferWithPipeline({
        prisma,
        offer: makeOffer('2', { unique_id: 'offer_two' }),
        rawData: makeRawData(),
        llmValidator,
    });

    assert.equal(llmCalls, 1, 'same normalized input should trigger one LLM call');
    assert.equal(first.usedCache, false, 'first validation should populate cache');
    assert.equal(second.usedCache, true, 'second validation should reuse cache');
    assert.equal(first.cacheKey, second.cacheKey, 'shared input should share cache key');

    process.env.DEEPSEEK_API_KEY = originalKey;
}

async function testChangedInputResetsReviewState() {
    const prisma = createPrismaMock();
    const originalKey = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = 'test-key';

    let llmCalls = 0;
    const llmValidator = async (_offer, _rawData, ruleCandidate) => {
        llmCalls += 1;
        return {
            candidate: ruleCandidate,
            issues: [],
            model: 'deepseek-coder',
            promptVersion: 'v2',
        };
    };

    await validateOfferWithPipeline({
        prisma,
        offer: makeOffer('same'),
        rawData: makeRawData(),
        llmValidator,
    });

    prisma.__state.offerValidationByOfferId.set('same', {
        ...prisma.__state.offerValidationByOfferId.get('same'),
        status: 'accepted',
    });

    const changed = await validateOfferWithPipeline({
        prisma,
        offer: makeOffer('same', { discountDescription: '25% off room rates' }),
        rawData: makeRawData({ rawHtmlContent: '<div>Valid from 2026-03-01 to 2026-03-31, 25% off room rates.</div>' }),
        llmValidator,
    });

    const validationRecord = prisma.__state.offerValidationByOfferId.get('same');

    assert.equal(llmCalls, 2, 'changed fingerprint should trigger a new LLM call');
    assert.equal(validationRecord.status, 'pending', 'changed content should reset manual review status');
    assert.equal(validationRecord.cacheKey, changed.cacheKey, 'validation record should track the new cache key');

    process.env.DEEPSEEK_API_KEY = originalKey;
}

async function testNoApiKeyFallback() {
    const prisma = createPrismaMock();
    const originalKey = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;

    let llmCalls = 0;
    const result = await validateOfferWithPipeline({
        prisma,
        offer: makeOffer('fallback'),
        rawData: makeRawData(),
        llmValidator: async () => {
            llmCalls += 1;
            throw new Error('should not be called');
        },
    });

    assert.equal(llmCalls, 0, 'LLM should not be called without an API key');
    assert.ok(result.issues.includes('LLM_SKIPPED_NO_API_KEY'), 'fallback result should record skipped LLM');

    process.env.DEEPSEEK_API_KEY = originalKey;
}

async function main() {
    await testStableFingerprint();
    await testCacheReuseAcrossOffers();
    await testChangedInputResetsReviewState();
    await testNoApiKeyFallback();
    console.log('validation-pipeline tests passed');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
