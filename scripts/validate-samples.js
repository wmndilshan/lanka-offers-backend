const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { createLogger } = require('../lib/logger');

const log = createLogger('validation-sample');

const OUTPUT_DIR = path.join(__dirname, '..', 'output');
const DEFAULT_BANKS = ['hnb', 'boc', 'peoples', 'ndb', 'seylan', 'sampath'];

const args = process.argv.slice(2);
const argValue = (name, fallback = null) => {
    const arg = args.find(a => a.startsWith(`--${name}=`));
    if (!arg) return fallback;
    return arg.split('=').slice(1).join('=');
};

const banksArg = argValue('banks');
const samples = Number(argValue('samples', '10')) || 10;
const banks = banksArg ? banksArg.split(',').map(b => b.trim().toLowerCase()).filter(Boolean) : DEFAULT_BANKS;

const BANK_FILES = {
    hnb: 'hnb_all_v6.json',
    boc: 'boc_all_v6.json',
    peoples: 'peoples_all_v4.json',
    ndb: 'ndb_all_v4.json',
    seylan: 'seylan_all_v3.json',
    sampath: 'sampath_all_v6.json',
};

function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',')}}`;
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

function buildDiff(ruleCandidate, llmCandidate) {
    if (!llmCandidate) return [];
    const fields = [
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
    const diffs = [];
    for (const field of fields) {
        const ruleValue = ruleCandidate?.[field] ?? null;
        const llmValue = llmCandidate?.[field] ?? null;
        if (stableStringify(ruleValue) !== stableStringify(llmValue)) {
            diffs.push({ field, rule: ruleValue, llm: llmValue });
        }
    }
    return diffs;
}

function extractCandidate(offer) {
    const structured = offer.structured_data || {};
    const validity = (offer.validity_periods && offer.validity_periods[0]) || {};

    const validFrom = parseDateMaybe(validity.valid_from || offer._raw_validFrom || structured.valid_from);
    const validTo = parseDateMaybe(validity.valid_to || offer._raw_validUntil || structured.valid_until);

    return {
        title: offer.title || null,
        merchantName: offer.merchant?.name || structured.merchant_name || offer.merchant_name || null,
        category: offer.category || structured.category || null,
        cardType: offer.card_type || offer.cardType || structured.card_type || null,
        discountPercentage: structured.discount_percentage ?? null,
        discountDescription: structured.discount_description || null,
        validFrom,
        validTo,
        daysApplicable: structured.days_applicable || null,
    };
}

function extractRawData(offer) {
    return {
        rawValidFrom: offer._raw_validFrom || null,
        rawValidUntil: offer._raw_validUntil || null,
        rawListItem: offer._raw_list_item || null,
        rawDetail: offer._raw_detail || null,
        rawHtmlContent: offer._raw_htmlContent || offer._raw_detail?.content || null,
    };
}

function sampleOffers(offers, count) {
    if (offers.length <= count) return offers;
    const result = [];
    const used = new Set();
    while (result.length < count) {
        const idx = Math.floor(Math.random() * offers.length);
        if (used.has(idx)) continue;
        used.add(idx);
        result.push(offers[idx]);
    }
    return result;
}

async function runBank(bank, validateOfferWithLlm) {
    const file = BANK_FILES[bank];
    if (!file) {
        log.warn('Validate', 'Unknown bank key', { bank });
        return { bank, total: 0, checked: 0, issues: 0, diffs: 0 };
    }

    const filePath = path.join(OUTPUT_DIR, file);
    if (!fs.existsSync(filePath)) {
        log.warn('Validate', 'Missing output file', { bank, file });
        return { bank, total: 0, checked: 0, issues: 0, diffs: 0 };
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const offers = Array.isArray(data) ? data : (data.offers || []);
    const picks = sampleOffers(offers, samples);
    log.info('Validate', 'Sampling offers', { bank, total: offers.length, sample: picks.length });

    let issueCount = 0;
    let diffCount = 0;

    for (const offer of picks) {
        const ruleCandidate = extractCandidate(offer);
        const rawData = extractRawData(offer);
        const ruleIssues = detectRuleIssues(ruleCandidate);
        if (ruleIssues.length > 0) issueCount += 1;

        let llmCandidate = null;
        let llmIssues = [];
        try {
            const llmResponse = await validateOfferWithLlm({
                offer: {
                    title: ruleCandidate.title,
                    merchantName: ruleCandidate.merchantName,
                    category: ruleCandidate.category,
                    cardType: ruleCandidate.cardType,
                    discountPercentage: ruleCandidate.discountPercentage,
                    discountDescription: ruleCandidate.discountDescription,
                    validFrom: ruleCandidate.validFrom,
                    validTo: ruleCandidate.validTo,
                    daysApplicable: ruleCandidate.daysApplicable,
                },
                rawData,
                ruleCandidate,
                model: 'deepseek-coder',
                promptVersion: 'v1',
            });
            llmCandidate = llmResponse?.candidate || null;
            llmIssues = Array.isArray(llmResponse?.issues) ? llmResponse.issues : [];
        } catch (error) {
            log.error('Validate', 'LLM validation failed', { bank, offer_id: offer.unique_id, error: error.message });
            llmIssues = ['LLM_ERROR'];
        }

        const diffs = buildDiff(ruleCandidate, llmCandidate);
        if (diffs.length > 0) diffCount += 1;

        log.info('Result', 'Sample checked', {
            bank,
            offer_id: offer.unique_id,
            ruleIssues,
            llmIssues,
            diffFields: diffs.map(d => d.field),
        });
    }

    return {
        bank,
        total: offers.length,
        checked: picks.length,
        issues: issueCount,
        diffs: diffCount,
    };
}

async function main() {
    const { validateOfferWithLlm } = await import(pathToFileURL(path.join(__dirname, '..', 'dashboard', 'lib', 'ai.js')).href);

    const results = [];
    for (const bank of banks) {
        results.push(await runBank(bank, validateOfferWithLlm));
    }

    log.success('Summary', 'Sample validation complete', { samples, results });

    console.log('\nSample Validation Summary');
    for (const r of results) {
        console.log(`- ${r.bank}: checked ${r.checked}/${r.total}, issues ${r.issues}, diffs ${r.diffs}`);
    }
}

main().catch(err => {
    log.fatal('Validate', 'Sample validation failed', { error: err.message });
    process.exit(1);
});
