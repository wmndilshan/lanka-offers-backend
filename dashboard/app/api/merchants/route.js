import prisma from '@/lib/prisma.mjs';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const search = (searchParams.get('search') || '').trim();
    const category = (searchParams.get('category') || '').trim();
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const offset = (page - 1) * limit;

    try {
        // Build WHERE conditions once, reuse for data + count queries
        const conditions = [`o.merchant_name IS NOT NULL`, `o.merchant_name <> ''`];
        const params = [];

        if (search) {
            params.push(`%${search.toLowerCase()}%`);
            conditions.push(`LOWER(o.merchant_name) LIKE $${params.length}`);
        }
        if (category && category !== 'All') {
            params.push(category.toLowerCase());
            conditions.push(`LOWER(o.category) = $${params.length}`);
        }

        const whereClause = conditions.join(' AND ');

        // Single aggregation — groups by merchant_name only.
        // Each merchant appears once with all their offer/bank/branch counts.
        const dataParams = [...params, limit, offset];
        const dataQuery = `
            SELECT
                o.merchant_name,
                COUNT(DISTINCT o.id)::int                              AS offer_count,
                COUNT(DISTINCT o.source)::int                          AS bank_count,
                COUNT(DISTINCT o.category)::int                        AS category_count,
                array_agg(DISTINCT o.category ORDER BY o.category)     AS categories,
                array_agg(DISTINCT o.source   ORDER BY o.source)       AS banks,
                ROUND(AVG(o.discount_percentage)::numeric, 1)          AS avg_discount,
                COALESCE(SUM(loc_counts.branch_count), 0)::int         AS total_branches,
                (
                    SELECT o2.category
                    FROM offers o2
                    WHERE LOWER(COALESCE(o2.merchant_name, '')) = LOWER(COALESCE(o.merchant_name, ''))
                    GROUP BY o2.category
                    ORDER BY COUNT(*) DESC
                    LIMIT 1
                )                                                       AS primary_category
            FROM offers o
            LEFT JOIN LATERAL (
                SELECT COUNT(*)::int AS branch_count
                FROM locations l
                WHERE l.offer_id = o.id
                  AND l.latitude IS NOT NULL
                  AND l.longitude IS NOT NULL
            ) loc_counts ON true
            WHERE ${whereClause}
            GROUP BY o.merchant_name
            ORDER BY offer_count DESC, o.merchant_name ASC
            LIMIT $${dataParams.length - 1}
            OFFSET $${dataParams.length}
        `;

        const countParams = [...params];
        const countQuery = `
            SELECT COUNT(DISTINCT o.merchant_name)::int AS total
            FROM offers o
            WHERE ${whereClause}
        `;

        const [rows, countResult] = await Promise.all([
            prisma.$queryRawUnsafe(dataQuery, ...dataParams),
            prisma.$queryRawUnsafe(countQuery, ...countParams),
        ]);

        const total = countResult[0]?.total || 0;

        const merchants = rows.map(r => ({
            name: r.merchant_name,
            primaryCategory: r.primary_category,
            categories: r.categories?.filter(Boolean) || [],
            banks: r.banks?.filter(Boolean) || [],
            offerCount: r.offer_count,
            bankCount: r.bank_count,
            categoryCount: r.category_count,
            avgDiscount: r.avg_discount !== null ? Number(r.avg_discount) : null,
            totalBranches: r.total_branches || 0,
        }));

        return NextResponse.json({
            merchants,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        console.error('Merchants API error:', error);
        return NextResponse.json({ error: 'Failed to fetch merchants' }, { status: 500 });
    }
}
