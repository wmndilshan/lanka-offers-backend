import crypto from 'crypto';
import { getAppLogger } from './app-logger.mjs';

const PROMPT_VERSION = 'v3';
const MODEL_NAME = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const log = getAppLogger('validation');

const MAX_STRING_LENGTH = 1200;
const MAX_HTML_LENGTH = 8000;
const MAX_ARRAY_ITEMS = 25;
const MAX_OBJECT_KEYS = 50;
const MAX_DEPTH = 5;

// merchantLocations is LLM-only enrichment — not a scraped field, so never in the diff.
// Including it would always produce a spurious diff (rule=null vs llm=[]) and block auto-approval.
const RULE_FIELDS = [
    'title',
    'merchantName',
    'category',
    'cardType',
    'discountPercentage',
    'discountDescription',
    'validFrom',
    'validTo',
    'daysApplicable',
];

function stableStringify(value) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    const keys = Object.keys(value).sort();
    return `{${keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',')}}`;
}

function hashInput(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function mergeIssues(...groups) {
    const merged = new Set();
    groups.flat().forEach((issue) => {
        if (typeof issue === 'string' && issue.trim()) merged.add(issue.trim());
    });
    return [...merged];
}

/** Deterministic ~2% sample for quality monitoring (same offer always same decision). */
function shouldSampleLlm(uniqueId) {
    if (!uniqueId || typeof uniqueId !== 'string') return false;
    let h = 0;
    for (let i = 0; i < uniqueId.length; i += 1) {
        h = Math.imul(31, h) + uniqueId.charCodeAt(i) | 0;
    }
    return Math.abs(h) % 100 < 2;
}

function normalizeText(value) {
    if (value === null || value === undefined) return null;
    const normalized = String(value).replace(/\s+/g, ' ').trim();
    return normalized || null;
}

function normalizeNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const parsed = Number.parseFloat(String(value).trim());
    return Number.isFinite(parsed) ? parsed : null;
}

function limitString(value, maxLength = MAX_STRING_LENGTH) {
    const normalized = normalizeText(value);
    if (!normalized) return null;
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength)}...[truncated:${normalized.length - maxLength}]`;
}

function sanitizeForValidation(value, depth = 0) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return limitString(value);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (depth >= MAX_DEPTH) return '[MAX_DEPTH_REACHED]';

    if (Array.isArray(value)) {
        const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeForValidation(item, depth + 1));
        if (value.length > MAX_ARRAY_ITEMS) {
            items.push(`[TRUNCATED_ITEMS:${value.length - MAX_ARRAY_ITEMS}]`);
        }
        return items;
    }

    if (typeof value === 'object') {
        const entries = Object.entries(value)
            .filter(([, entryValue]) => entryValue !== undefined)
            .sort(([a], [b]) => a.localeCompare(b));

        const sanitized = {};
        for (const [key, entryValue] of entries.slice(0, MAX_OBJECT_KEYS)) {
            sanitized[key] = sanitizeForValidation(entryValue, depth + 1);
        }
        if (entries.length > MAX_OBJECT_KEYS) {
            sanitized.__truncatedKeys = entries.length - MAX_OBJECT_KEYS;
        }
        return sanitized;
    }

    return normalizeText(value);
}

function parseDateMaybe(value) {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
    const str = String(value).trim();
    if (!str) return null;
    const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (dmy) {
        const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
        return `${year}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`;
    }
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    return null;
}

function normalizeRuleCandidate(offer, rawData) {
    const rawFrom = rawData?.rawValidFrom || rawData?._raw_validFrom;
    const rawTo = rawData?.rawValidUntil || rawData?._raw_validUntil;

    const validFrom = offer.validFrom ? parseDateMaybe(offer.validFrom) : parseDateMaybe(rawFrom);
    const validTo = offer.validTo ? parseDateMaybe(offer.validTo) : parseDateMaybe(rawTo);

    return {
        title: normalizeText(offer.title),
        merchantName: normalizeText(offer.merchantName),
        category: normalizeText(offer.category),
        cardType: normalizeText(offer.cardType),
        discountPercentage: normalizeNumber(offer.discountPercentage),
        discountDescription: normalizeText(offer.discountDescription),
        validFrom,
        validTo,
        daysApplicable: normalizeText(offer.daysApplicable),
    };
}

function createRawSnapshot(rawData) {
    const rd = rawData || {};
    const evidence = rd._evidence && typeof rd._evidence === 'object'
        ? sanitizeForValidation(rd._evidence)
        : null;
    return {
        rawValidFrom: limitString(rd.rawValidFrom || rd._raw_validFrom, 128),
        rawValidUntil: limitString(rd.rawValidUntil || rd._raw_validUntil, 128),
        /** Full validity phrase from scrapers when available (helps LLM vs rules). */
        rawValidityText: limitString(rd.rawValidityText || rd.raw_validity_text, MAX_STRING_LENGTH),
        rawDiscountPhrase: limitString(rd.rawDiscountPhrase || rd.raw_discount_phrase, MAX_STRING_LENGTH),
        rawListItem: sanitizeForValidation(rd.rawListItem || rd._raw_list_item || null),
        rawDetail: sanitizeForValidation(rd.rawDetail || rd._raw_detail || null),
        rawHtmlContent: limitString(rd.rawHtmlContent || rd._raw_htmlContent || null, MAX_HTML_LENGTH),
        ...(evidence ? { evidence } : {}),
    };
}

function detectRuleIssues(candidate) {
    const issues = [];
    if (!candidate.title) issues.push('MISSING_TITLE');
    if (!candidate.merchantName) issues.push('MISSING_MERCHANT');
    if (!candidate.category) issues.push('MISSING_CATEGORY');
    if (!candidate.validFrom && !candidate.validTo) issues.push('MISSING_VALIDITY');
    if (candidate.validFrom && candidate.validTo && candidate.validTo < candidate.validFrom) {
        issues.push('INVALID_DATE_RANGE');
    }
    return issues;
}

/** Map LLM fieldVerdicts with verdict "unsupported" into issue tokens (blocks auto approved_by_ai). */
function issuesFromFieldVerdicts(fieldVerdicts) {
    if (!fieldVerdicts || typeof fieldVerdicts !== 'object') return [];
    const out = [];
    for (const [field, val] of Object.entries(fieldVerdicts)) {
        if (val && typeof val === 'object' && String(val.verdict).toLowerCase() === 'unsupported') {
            const safe = String(field).replace(/[^a-z0-9]+/gi, '_').toUpperCase() || 'FIELD';
            out.push(`FIELD_UNSUPPORTED_${safe}`);
        }
    }
    return out;
}

function buildDiff(ruleCandidate, llmCandidate) {
    if (!llmCandidate) return [];
    const diffs = [];
    for (const field of RULE_FIELDS) {
        const ruleValue = ruleCandidate?.[field] ?? null;
        const llmValue = llmCandidate?.[field] ?? null;
        if (JSON.stringify(ruleValue) !== JSON.stringify(llmValue)) {
            diffs.push({ field, rule: ruleValue, llm: llmValue });
        }
    }
    return diffs;
}

function sanitizeLlmCandidate(value) {
    if (!value || typeof value !== 'object') return null;
    return {
        title: normalizeText(value.title),
        merchantName: normalizeText(value.merchantName),
        category: normalizeText(value.category),
        cardType: normalizeText(value.cardType),
        discountPercentage: normalizeNumber(value.discountPercentage),
        discountDescription: normalizeText(value.discountDescription),
        validFrom: parseDateMaybe(value.validFrom),
        validTo: parseDateMaybe(value.validTo),
        daysApplicable: normalizeText(value.daysApplicable),
        merchantLocations: Array.isArray(value.merchantLocations)
            ? value.merchantLocations.map(normalizeText).filter(Boolean)
            : [],
    };
}

async function callLlmValidation(offer, rawSnapshot, ruleCandidate) {
    const { validateOfferWithLlm } = await import('./ai.mjs');
    return validateOfferWithLlm({
        offer,
        rawData: rawSnapshot,
        ruleCandidate,
        model: MODEL_NAME,
        promptVersion: PROMPT_VERSION,
    });
}

export function buildValidationArtifacts({ offer, rawData }) {
    const ruleCandidate = normalizeRuleCandidate(offer, rawData);
    const ruleIssues = detectRuleIssues(ruleCandidate);
    const rawSnapshot = createRawSnapshot(rawData);
    const inputHash = hashInput(stableStringify({
        offer: ruleCandidate,
        rawSnapshot,
    }));
    const cacheKey = `${MODEL_NAME}:${PROMPT_VERSION}:${inputHash}`;

    return {
        ruleCandidate,
        ruleIssues,
        rawSnapshot,
        inputHash,
        cacheKey,
        model: MODEL_NAME,
        promptVersion: PROMPT_VERSION,
    };
}

export async function validateOfferWithPipeline({
    prisma,
    offer,
    rawData,
    forceLlm = false,
    llmValidator = callLlmValidation,
}) {
    const {
        ruleCandidate,
        ruleIssues,
        rawSnapshot,
        inputHash,
        cacheKey,
        model,
        promptVersion,
    } = buildValidationArtifacts({ offer, rawData });

    const hasApiKey = !!process.env.DEEPSEEK_API_KEY;
    const shouldCallLlm = hasApiKey && (
        forceLlm
        || ruleIssues.length > 0
        || shouldSampleLlm(offer.unique_id)
    );

    const existingValidation = await prisma.offerValidation.findUnique({
        where: { offerId: offer.id },
        select: { id: true, cacheKey: true, status: true },
    });

    let cache = forceLlm ? null : await prisma.llmValidationCache.findFirst({
        where: { inputHash, model, promptVersion },
        orderBy: { createdAt: 'desc' },
    });
    const cacheHit = !forceLlm && !!cache;

    let fallbackIssues = [];

    if (!cache && shouldCallLlm) {
        log.info('Pipeline', 'LLM validation requested', { offerId: offer.id, uniqueId: offer.unique_id, cacheKey });
        try {
            const llmResponse = await llmValidator(offer, rawSnapshot, ruleCandidate);
            const llmCandidate = sanitizeLlmCandidate(llmResponse?.candidate);
            const llmIssues = Array.isArray(llmResponse?.issues) ? llmResponse.issues : [];
            const verdictIssues = issuesFromFieldVerdicts(llmResponse?.fieldVerdicts);
            const diff = buildDiff(ruleCandidate, llmCandidate);
            const finalCacheIssues = mergeIssues(
                ruleIssues,
                llmIssues,
                verdictIssues,
                !llmCandidate ? ['LLM_EMPTY_CANDIDATE'] : [],
            );

            cache = await prisma.llmValidationCache.upsert({
                where: { cacheKey },
                create: {
                    cacheKey,
                    inputHash,
                    model: llmResponse?.model || model,
                    promptVersion: llmResponse?.promptVersion || promptVersion,
                    rawSnapshot,
                    ruleCandidate,
                    llmCandidate,
                    diff,
                    issues: finalCacheIssues,
                },
                update: {
                    rawSnapshot,
                    ruleCandidate,
                    llmCandidate,
                    diff,
                    issues: finalCacheIssues,
                },
            });

            log.success('Pipeline', 'LLM validation cached', { offerId: offer.id, cacheKey, diffCount: diff.length });
        } catch (error) {
            fallbackIssues = mergeIssues(ruleIssues, ['LLM_VALIDATION_FAILED']);
            log.error('Pipeline', 'LLM validation failed, falling back to rule-based result', {
                offerId: offer.id,
                uniqueId: offer.unique_id,
                error: error.message,
            });
        }
    } else if (!cache && !hasApiKey) {
        fallbackIssues = mergeIssues(ruleIssues, ['LLM_SKIPPED_NO_API_KEY']);
    } else if (!cache && hasApiKey && !shouldCallLlm) {
        fallbackIssues = [...ruleIssues];
    }

    const finalDiff = cache?.diff || [];
    const finalIssues = cache?.issues || fallbackIssues || ruleIssues;
    const llmCandidate = cache?.llmCandidate || null;

    // Determine new review status based on validation result.
    // I-2: pipeline must never overwrite a human decision ('approved' or 'rejected').
    // Only pipeline-owned statuses ('pending', 'approved_by_ai', 'flagged') are mutable here.
    const PIPELINE_OWNED_STATUSES = new Set(['pending', 'approved_by_ai', 'flagged']);
    let newReviewStatus = offer.reviewStatus;
    if (PIPELINE_OWNED_STATUSES.has(offer.reviewStatus)) {
        if (
            finalDiff.length > 0
            || finalIssues.some((i) => i.includes('FAIL')
                || i.includes('MISSING')
                || i.includes('FIELD_UNSUPPORTED'))
        ) {
            newReviewStatus = 'flagged';
        } else if (finalIssues.length === 0 && finalDiff.length === 0) {
            // Auto-approve whether the result came from LLM or a warm cache hit.
            // A cached clean result is still a clean result.
            if (offer.reviewStatus === 'pending') {
                newReviewStatus = 'approved_by_ai';
            }
        }
    }

    const recordData = {
        cacheKey,
        summary: finalIssues.length ? finalIssues.join(', ') : 'OK',
        ruleCandidate,
        llmCandidate,
        diff: finalDiff,
        issues: finalIssues,
        ...(existingValidation && existingValidation.cacheKey !== cacheKey ? { status: 'pending' } : {}),
    };

    // Update the offer status if it changed
    if (newReviewStatus !== offer.reviewStatus) {
        await prisma.offer.update({
            where: { id: offer.id },
            data: { reviewStatus: newReviewStatus }
        });
        log.info('Pipeline', 'Offer review status updated', {
            offerId: offer.id,
            old: offer.reviewStatus,
            new: newReviewStatus
        });
    }

    const validationRecord = existingValidation
        ? await prisma.offerValidation.update({
            where: { offerId: offer.id },
            data: recordData,
        })
        : await prisma.offerValidation.create({
            data: {
                offerId: offer.id,
                status: 'pending',
                ...recordData,
            },
        });

    log.info('Pipeline', 'Validation record stored', {
        offerId: offer.id,
        uniqueId: offer.unique_id,
        issues: finalIssues.length,
        diff: finalDiff.length,
        cacheHit,
    });

    // Sync Locations from LLM Candidate (never wipe geocoded / Places-backed rows)
    if (llmCandidate?.merchantLocations?.length > 0) {
        const existing = await prisma.location.findMany({
            where: { offerId: offer.id },
            select: {
                placeId: true,
                latitude: true,
                longitude: true,
                source: true,
            },
        });
        const hasProtected = existing.some((l) => (
            l.placeId != null
            || (l.latitude != null
                && l.longitude != null
                && l.source
                && l.source !== 'llm_extraction')
        ));

        if (hasProtected) {
            log.warn('Pipeline', 'Skipping LLM location sync — protected geocoded rows exist', {
                offerId: offer.id,
                uniqueId: offer.unique_id,
            });
        } else {
            await prisma.location.deleteMany({ where: { offerId: offer.id } });
            await prisma.location.createMany({
                data: llmCandidate.merchantLocations.map((loc) => ({
                    offerId: offer.id,
                    branchName: loc,
                    formattedAddress: loc,
                    locationType: 'LISTED',
                    source: 'llm_extraction',
                    success: true,
                })),
            });

            log.info('Pipeline', 'Locations synced from LLM', {
                offerId: offer.id,
                count: llmCandidate.merchantLocations.length,
            });
        }
    }

    return {
        ruleCandidate,
        llmCandidate,
        diff: finalDiff,
        issues: finalIssues,
        cacheKey,
        inputHash,
        validationId: validationRecord.id,
        usedCache: cacheHit,
    };
}
