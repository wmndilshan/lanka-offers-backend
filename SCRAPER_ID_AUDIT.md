# Scraper Unique ID Audit — Updated Feb 2026

## ✅ All Scrapers Now Deterministic

| Scraper | Status | ID Strategy |
|---|---|---|
| **ndb-2.js** | ✅ Fixed | `ndb_{sha256(bank\|merchant\|location\|offerText\|validity)[0:12]}_{slug}` |
| **sampath-5.js** | ✅ Already correct | `sampath_{sha256(bank\|company\|city\|category\|discount)[0:12]}_{slug}` |
| **sampath-6.js** | ✅ **Created this session** | `sampath_{sha256(bank\|company\|city\|category\|discount)[0:12]}_{slug}` + detail pages |
| **hnb-5.js** | ✅ Already correct | `hnb_{sourceId}` — uses site's own stable ID |
| **hnb-6.js** | ✅ **Created this session** | `hnb_{sourceId}` + enhanced extraction (images, installments, tx ranges) |
| **boc-5.js** | ✅ Already correct | `boc_{sha256(bank\|url\|title\|expiry\|location)[0:12]}_{slug}` |
| **people-3..js** | ✅ **Fixed this session** | `peoples_{sha256(bank\|merchant\|category\|detailUrl)[0:12]}_{slug}` |
| **seylan.js** | ✅ **Fixed this session** | `seylan_{sha256(bank\|offerUrl)[0:12]}_{slug}` |
| **dfcc.js** | ✅ **Fixed this session** | `dfcc_{sha256(bank\|detailUrl\|cardType)[0:12]}_{slug}` |

## What was broken and why

### `people-3..js` (was broken: `id: index + 1`)
Sequential index IDs break if:
- Offers are reordered on the website
- New offers are inserted before existing ones
- Offers are removed from the middle

**Fix:** SHA256 hash of `bank|merchantName|category|detailPageUrl` — all fields that identify the *merchant's offer* without changing on re-scrape.

### `seylan.js` (was broken: no `unique_id` at all)
No unique identifier was being generated — every scrape would insert fresh duplicates.

**Fix:** SHA256 hash of `bank|offerUrl` — Seylan's individual offer URLs are stable (they follow `/promotions/cards/offer-slug` pattern).

### `import-data.js` (was broken: `findUnique → create` race condition)
Two concurrent scraper processes could both read "not found" before either inserts, then both try to `create`, causing a duplicate write error or duplicate row.

**Fix:** Replaced with `prisma.offer.upsert({ where: { unique_id }, create: {...}, update: {...} })`. The DB UNIQUE constraint on `unique_id` makes this atomic. Importantly, `reviewStatus` is NOT overwritten on update — curator decisions are preserved.

### `dfcc.js` (was broken: `id: index + 1`)
Sequential index IDs break if:
- Offers are reordered on the DFCC website
- New offers are inserted before existing ones
- Offers are removed from the middle

**Fix:** SHA256 hash of `bank|detailUrl|cardType` — DFCC has stable URLs for each offer (`/cards/cards-promotions/category/.../offer-slug`). The `detailUrl` is the primary stable identifier, with `cardType` as additional entropy. Legacy `id` field retained for backward compatibility.

---

## Database-Level Safety

The `offers` table has a `UNIQUE` constraint on `unique_id` (enforced by Prisma schema). This is the last line of defence — even if a scraper generates a duplicate ID, the DB will reject the second insert.

---

## Testing Duplicates

Run the new scan script at any time:
```bash
# Audit only (read-only)
node dashboard/scripts/check-duplicates.js

# Auto-fix: delete the newer duplicate, keep oldest
node dashboard/scripts/check-duplicates.js --fix
```

---

## Remaining Work

- [x] Audit `dfcc.js` ID generation ✅ **COMPLETE**
- [ ] Consider adding an API endpoint `/api/quality/duplicates` to show near-duplicates in the dashboard

## Summary

**All scrapers now use deterministic unique IDs!** 🎉

Every scraper generates stable, hash-based unique identifiers that won't change across scrapes even if the source website reorders, adds, or removes offers. The database UNIQUE constraint on `unique_id` provides the final safety layer.
