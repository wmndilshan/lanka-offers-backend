/**
 * Data Import Script
 * Imports scraped JSON data into Neon PostgreSQL database
 * 
 * Usage: node scripts/import-data.js
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { listBanks, resolveOutputFile } = require('../../lib/bank-registry');

const prisma = new PrismaClient();
let validationPipeline = null;
let validationQueue = null;
const { createLogger } = require('../../lib/logger');
const log = createLogger('import');
const RETRYABLE_DB_ERRORS = /Server has closed the connection|ECONNRESET|ETIMEDOUT|EPIPE/i;
const args = process.argv.slice(2);
const argValue = (name, fallback = null) => {
    const arg = args.find(a => a.startsWith(`--${name}=`));
    if (!arg) return fallback;
    return arg.split('=').slice(1).join('=');
};
const bankFilter = argValue('bank');
const limitPerFile = Number(argValue('limit', '0')) || 0;

async function withRetry(label, fn, attempts = 2) {
    let lastError;
    for (let i = 1; i <= attempts; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            const message = error?.message || '';
            if (!RETRYABLE_DB_ERRORS.test(message) || i === attempts) {
                throw error;
            }
            log.warn('DB', 'Retrying after connection error', { label, attempt: i, error: message });
            try {
                await prisma.$disconnect();
            } catch (_) { }
            try {
                await prisma.$connect();
            } catch (_) { }
        }
    }
    throw lastError;
}

async function getValidationPipeline() {
    if (!validationPipeline) {
        validationPipeline = await import('../lib/validation-pipeline.mjs');
    }
    return validationPipeline;
}

async function getValidationQueue() {
    if (!validationQueue) {
        validationQueue = await import('../lib/validation-queue.mjs');
    }
    return validationQueue;
}

// Add connection check
async function checkConnection() {
    try {
        await prisma.$connect();
        log.success('DB', 'Connected to database')
    } catch (error) {
        log.error('DB', 'Failed to connect', { error: error.message })
        process.exit(1);
    }
}
checkConnection();

/**
 * Parse percentage string to float
 * Handles: "15%", "Up to 40%", "15", 15, null
 */
function parsePercentage(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    // Already a number
    if (typeof value === 'number') {
        return value;
    }

    // Convert to string and clean
    const str = String(value).trim();

    // Extract number from patterns like "Up to 40%", "15%", "40"
    const match = str.match(/(\d+(?:\.\d+)?)/);

    if (match) {
        const num = parseFloat(match[1]);
        return isNaN(num) ? null : num;
    }

    return null;
}

// Track statistics
const stats = {
    offersProcessed: 0,
    offersInserted: 0,
    offersSkipped: 0,
    validationJobsEnqueued: 0,
    locationsInserted: 0,
    rawDataInserted: 0,
    errors: []
};

function getValidityPeriod(offer) {
    if (Array.isArray(offer.validity_periods) && offer.validity_periods[0]) return offer.validity_periods[0];
    if (Array.isArray(offer.validities) && offer.validities[0]) return offer.validities[0];
    if (offer.validity?.periods && offer.validity.periods[0]) return offer.validity.periods[0];
    return null;
}

function getTitle(offer) {
    return (
        offer.title ||
        offer.offer?.title ||
        offer.offer?.description ||
        offer.description ||
        offer.short_description ||
        offer.name ||
        null
    );
}

function getCardType(offer) {
    return offer.card_type || offer.offer?.cardType || offer.cardType || offer.structured_data?.card_type || null;
}

function getCategory(offer) {
    return offer.category || offer.category_name || offer.category_slug || null;
}

function getMerchantName(offer) {
    return offer.merchant?.name || offer.merchant_name || offer.merchant?.name || offer.merchantName || null;
}

function getDiscountValue(offer) {
    return (
        offer.structured_data?.discount_percentage ??
        offer.discount ??
        offer.offer_value ??
        offer.offer?.discount ??
        offer.offer?.discountValue ??
        null
    );
}

function normalizeDaysApplicable(value) {
    if (!value) return null;
    if (Array.isArray(value)) return value.join(', ');
    return value;
}

function normalizeSourceId(value) {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
    const str = String(value).trim();
    if (!str) return 0;
    if (/^\d+$/.test(str)) return parseInt(str, 10);
    return 0;
}

function normalizeDateRange(validFrom, validTo) {
    if (!validFrom && !validTo) return { validFrom: null, validTo: null };
    const fromDate = validFrom instanceof Date ? validFrom : (validFrom ? new Date(validFrom) : null);
    const toDate = validTo instanceof Date ? validTo : (validTo ? new Date(validTo) : null);
    const fromOk = fromDate && !isNaN(fromDate.getTime());
    const toOk = toDate && !isNaN(toDate.getTime());

    if (!fromOk && !toOk) return { validFrom: null, validTo: null };
    if (!fromOk) return { validFrom: null, validTo: toOk ? toDate : null };
    if (!toOk) return { validFrom: fromDate, validTo: null };
    if (toDate < fromDate) {
        return { validFrom: null, validTo: toDate };
    }
    return { validFrom: fromDate, validTo: toDate };
}

/**
 * Parse and transform offer data from JSON to Prisma format
 */
function transformOffer(offer, bank) {
    const validity = getValidityPeriod(offer);
    const rawFrom = offer._raw_validFrom || offer.valid_from || offer.validFrom || validity?.valid_from || offer.validity?.raw || null;
    const rawTo = offer._raw_validUntil || offer.valid_until || offer.validTo || validity?.valid_to || null;
    const dateRange = normalizeDateRange(
        validity?.valid_from || rawFrom || offer.structured_data?.valid_from || null,
        validity?.valid_to || rawTo || offer.structured_data?.valid_until || null
    );

    return {
        unique_id: offer.unique_id || offer.id,
        source_id: normalizeSourceId(offer.source_id ?? offer.sourceId ?? offer.id),
        source: offer.source || offer.bank || bank.toUpperCase(),
        category: getCategory(offer),
        categoryId: offer.category_id || null,
        title: getTitle(offer),
        cardType: getCardType(offer) || 'credit',
        scrapedAt: offer.scraped_at ? new Date(offer.scraped_at) : new Date(),

        // Curation fields - default to pending
        reviewStatus: 'pending',
        isInProduction: false,

        // Structured data fields
        merchantName: getMerchantName(offer),
        discountPercentage: parsePercentage(getDiscountValue(offer)),
        discountDescription: offer.structured_data?.discount_description || offer.offer_value || offer.offer?.description || offer.description || '',
        applicableCards: offer.structured_data?.applicable_cards || [],
        validFrom: dateRange.validFrom,
        validTo: dateRange.validTo,
        contactPhone: offer.structured_data?.contact_phone || offer.merchant?.contact_numbers || [],
        contactEmail: offer.structured_data?.contact_email || [],
        bookingRequired: offer.structured_data?.booking_required || false,
        keyRestrictions: offer.structured_data?.key_restrictions || [],
        daysApplicable: normalizeDaysApplicable(offer.structured_data?.days_applicable || validity?.recurrence_days || null),
        specialConditions: offer.structured_data?.special_conditions || [],
    };
}

/**
 * Import structured offers from a single JSON file
 */
async function importStructuredOffers(filePath, bank) {
    log.info('Import', 'Processing file', { bank, file: path.basename(filePath) });

    try {
        const { ensureValidationJobTable, scheduleOfferValidation } = await getValidationQueue();
        await ensureValidationJobTable();
        const readOffers = (targetPath) => {
            const content = fs.readFileSync(targetPath, 'utf-8');
            const data = JSON.parse(content);
            return Array.isArray(data) ? data : (data.offers || []);
        };

        let offers = readOffers(filePath);
        if (offers.length === 0 && bankFilter && filePath.endsWith('_structured.json')) {
            const bankKey = bankFilter.toLowerCase();
            const files = fs.readdirSync(path.join(__dirname, '..', '..', 'output'));
            const allVersions = files
                .filter(f => f.toLowerCase().startsWith(bankKey + '_all_v') && f.endsWith('.json'))
                .sort();
            if (allVersions.length > 0) {
                let fallbackFile = null;
                for (let i = allVersions.length - 1; i >= 0; i--) {
                    const candidate = path.join(path.join(__dirname, '..', '..', 'output'), allVersions[i]);
                    const candidateOffers = readOffers(candidate);
                    if (candidateOffers.length > 0) {
                        fallbackFile = candidate;
                        offers = candidateOffers;
                        break;
                    }
                }
                if (fallbackFile) {
                    log.warn('Import', 'Structured file empty, using fallback', { bank: bankKey, file: path.basename(fallbackFile) });
                } else {
                    log.warn('Import', 'Structured file empty, no non-empty fallback found', { bank: bankKey });
                }
            }
        }
        if (limitPerFile > 0) {
            offers = offers.slice(0, limitPerFile);
        }
        log.info('Import', 'Offers found', { bank, count: offers.length });

        for (const offer of offers) {
            stats.offersProcessed++;
            if (stats.offersProcessed % 50 === 0) {
                log.info('Import', 'Progress', { bank, processed: stats.offersProcessed });
            }

            try {
                // ─── Atomic upsert: prevents duplicate inserts ──────────────
                // Using upsert on unique_id (DB UNIQUE constraint) is the only
                // race-condition-safe way to prevent duplicates. The old pattern
                // (findUnique → skip OR create) had a TOCTOU race: two concurrent
                // scraper runs could both pass the findUnique check and both insert.
                const offerData = transformOffer(offer, bank);
                const uniqueId = offerData.unique_id;
                if (!uniqueId) {
                    throw new Error('Missing unique_id after transform');
                }

                const existingOffer = await withRetry('offer.findUnique', () =>
                    prisma.offer.findUnique({ where: { unique_id: uniqueId }, select: { id: true } })
                );
                const isNew = !existingOffer;
                const rawPayload = {
                    rawValidFrom: offer._raw_validFrom || null,
                    rawValidUntil: offer._raw_validUntil || null,
                    rawHtmlContent: offer._raw_htmlContent || offer._raw_detail?.content || null,
                    rawListItem: offer._raw_list_item || null,
                    rawDetail: offer._raw_detail || null,
                };

                const dbOffer = await withRetry('offer.upsert', () => prisma.offer.upsert({
                    where: { unique_id: uniqueId },
                    // On first insert: create with rawData and all fields
                    create: {
                        ...offerData,
                        rawData: {
                            create: {
                                ...rawPayload,
                            }
                        }
                    },
                    // On conflict: update mutable fields only — keep reviewStatus, don't overwrite human edits
                    update: {
                        scrapedAt: offerData.scrapedAt,
                        title: offerData.title,
                        merchantName: offerData.merchantName,
                        discountPercentage: offerData.discountPercentage,
                        discountDescription: offerData.discountDescription,
                        validFrom: offerData.validFrom,
                        validTo: offerData.validTo,
                        applicableCards: offerData.applicableCards,
                        contactPhone: offerData.contactPhone,
                        keyRestrictions: offerData.keyRestrictions,
                        daysApplicable: offerData.daysApplicable,
                        rawData: {
                            upsert: {
                                create: {
                                    ...rawPayload,
                                },
                                update: {
                                    ...rawPayload,
                                },
                            },
                        },
                        // NOTE: reviewStatus is intentionally NOT updated — preserve curator decisions
                    }
                }));

                const { buildValidationArtifacts } = await getValidationPipeline();
                const validationArtifacts = buildValidationArtifacts({
                    offer: dbOffer,
                    rawData: rawPayload,
                });
                const existingValidation = await withRetry('offerValidation.findUnique', () =>
                    prisma.offerValidation.findUnique({
                        where: { offerId: dbOffer.id },
                        select: { id: true, cacheKey: true }
                    })
                );
                const shouldValidate = !existingValidation || existingValidation.cacheKey !== validationArtifacts.cacheKey;

                if (isNew) {
                    stats.offersInserted++;
                    stats.rawDataInserted++;
                } else {
                    stats.offersSkipped++;
                }

                if (shouldValidate) {
                    try {
                        const queueResult = await scheduleOfferValidation({
                            prisma,
                            offer: dbOffer,
                            rawData: rawPayload,
                            reason: isNew ? 'import_new_offer' : 'import_offer_changed',
                            priority: isNew ? 25 : 10,
                        });
                        if (queueResult.enqueued) {
                            stats.validationJobsEnqueued++;
                            log.success('Validation', 'Queued validation job', {
                                bank,
                                offer_id: uniqueId,
                                cacheKey: queueResult.cacheKey,
                            });
                        } else {
                            log.info('Validation', 'Skipped queue; fingerprint already validated', {
                                bank,
                                offer_id: uniqueId,
                                cacheKey: queueResult.cacheKey,
                            });
                        }
                    } catch (validationError) {
                        stats.errors.push({
                            file: path.basename(filePath),
                            offer_id: uniqueId,
                            error: `Validation queue failed: ${validationError.message}`,
                        });
                        log.warn('Validation', 'Validation queue failed', { bank, offer_id: uniqueId, error: validationError.message });
                    }
                } else {
                    log.info('Validation', 'Skipped validation; fingerprint unchanged', {
                        bank,
                        offer_id: uniqueId,
                        cacheKey: validationArtifacts.cacheKey,
                    });
                }

            } catch (error) {
                stats.errors.push({
                    file: path.basename(filePath),
                    offer_id: offer.unique_id || offer.id || null,
                    error: error.message
                });
                log.error('Import', 'Error inserting offer', { bank, offer_id: offer.unique_id || offer.id || null, error: error.message });
            }
        }

    } catch (error) {
        log.error('Import', 'Error reading file', { bank, file: path.basename(filePath), error: error.message });
        stats.errors.push({
            file: path.basename(filePath),
            error: error.message
        });
    }
}

/**
 * Import geocoded locations from geo JSON files
 */
async function importGeoLocations(filePath, bank) {
    log.info('Geo', 'Processing file', { bank, file: path.basename(filePath) });

    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content);

        const geoOffers = Array.isArray(data) ? data : (data.offers || []);
        log.info('Geo', 'Offers with locations', { bank, count: geoOffers.length });

        for (const geoOffer of geoOffers) {
            if (!geoOffer.locations || geoOffer.locations.length === 0) {
                continue;
            }

            try {
                // Find the corresponding offer in database
                const offer = await withRetry('offer.findUnique(geo)', () =>
                    prisma.offer.findUnique({
                        where: { unique_id: geoOffer.offer_id }
                    })
                );

                if (!offer) {
                    log.warn('Geo', 'Offer not found for locations', { bank, offer_id: geoOffer.offer_id });
                    continue;
                }

                // Insert locations
                for (const location of geoOffer.locations) {
                    if (!location.latitude || !location.longitude) {
                        continue;
                    }

                    // Create PostGIS geography point
                    const geographyPoint = `SRID=4326;POINT(${location.longitude} ${location.latitude})`;

                    await withRetry('locations.insert', () => prisma.$executeRawUnsafe(`
            INSERT INTO locations (
              id, offer_id, geography, latitude, longitude,
              source, success, search_address, formatted_address, place_id,
              types, location_type, branch_name, address_components, timestamp, created_at
            ) VALUES (
              gen_random_uuid(), $1, ST_GeogFromText($2), $3, $4,
              $5, $6, $7, $8, $9,
              $10, $11, $12, $13::jsonb, $14, NOW()
            )
          `,
                        offer.id,
                        geographyPoint,
                        location.latitude,
                        location.longitude,
                        location.source || 'geocoding_api',
                        location.success !== false,
                        location.search_address || location.formattedAddress || null,
                        location.formatted_address || location.formattedAddress || null,
                        location.placeId || location.place_id || null,
                        location.types || [],
                        geoOffer.location_type || 'UNKNOWN',
                        location.branch_name || null,
                        JSON.stringify(location.address_components || location.addressComponents || null),
                        location.timestamp ? new Date(location.timestamp) : null
                    ));

                    stats.locationsInserted++;
                }

            } catch (error) {
                log.error('Geo', 'Error inserting locations', { bank, offer_id: geoOffer.offer_id, error: error.message });
                stats.errors.push({
                    file: path.basename(filePath),
                    offer_id: geoOffer.offer_id,
                    error: error.message
                });
            }
        }

    } catch (error) {
        log.error('Geo', 'Error reading file', { bank, file: path.basename(filePath), error: error.message });
        stats.errors.push({
            file: path.basename(filePath),
            error: error.message
        });
    }
}

/**
 * Main import function
 */
async function importAllData() {
    log.info('Import', 'Starting data import', {
        db: process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] || 'Unknown'
    });

    const outputDir = path.join(__dirname, '..', '..', 'output');

    if (!fs.existsSync(outputDir)) {
        log.error('Import', 'Output directory not found', { outputDir });
        process.exit(1);
    }

    const projectRoot = path.join(__dirname, '..', '..');
    const banksToImport = bankFilter ? [bankFilter.toLowerCase()] : listBanks();
    const structuredFiles = banksToImport
        .map((bank) => ({
            bank,
            file: resolveOutputFile(bank, 'structured', projectRoot),
        }))
        .filter(({ file }) => fs.existsSync(path.join(outputDir, file)));
    const geoFiles = banksToImport
        .map((bank) => ({
            bank,
            file: resolveOutputFile(bank, 'geo', projectRoot),
        }))
        .filter(({ file }) => fs.existsSync(path.join(outputDir, file)));

    log.info('Import', 'Files discovered', { structured: structuredFiles.length, geo: geoFiles.length });

    // Step 1: Import structured offers first
    log.info('Import', 'STEP 1: structured offers');

    for (const entry of structuredFiles) {
        const filePath = path.join(outputDir, entry.file);
        await importStructuredOffers(filePath, entry.bank);
    }

    // Step 2: Import geo locations
    log.info('Import', 'STEP 2: geo locations');

    for (const entry of geoFiles) {
        const filePath = path.join(outputDir, entry.file);
        await importGeoLocations(filePath, entry.bank);
    }

    log.info('Import', 'Import complete', {
        offersProcessed: stats.offersProcessed,
        offersInserted: stats.offersInserted,
        offersSkipped: stats.offersSkipped,
        validationJobsEnqueued: stats.validationJobsEnqueued,
        locationsInserted: stats.locationsInserted,
        rawDataInserted: stats.rawDataInserted,
        errors: stats.errors.length
    });

    if (stats.errors.length > 0) {
        log.warn('Import', 'Errors summary', { errors: stats.errors.slice(0, 10) });
    }

    log.success('Import', 'Data import completed');
}

// Run import
importAllData()
    .catch(error => {
        log.fatal('Import', 'Fatal error during import', { error: error.message })
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });



















