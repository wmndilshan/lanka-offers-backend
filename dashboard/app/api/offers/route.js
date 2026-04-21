
import prisma from '@/lib/prisma.mjs';
import { NextResponse } from 'next/server';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '25');
    const search = searchParams.get('search') || '';
    const category = searchParams.get('category') || '';
    const source = searchParams.get('source') || '';
    const status = searchParams.get('status') || '';
    const isInProduction = searchParams.get('is_in_production');

    const skip = (page - 1) * limit;

    // Build where clause
    const where = {};

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { merchantName: { contains: search, mode: 'insensitive' } },
        { unique_id: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (category && category !== 'All') {
      where.category = { equals: category, mode: 'insensitive' };
    }

    if (source && source !== 'All') {
      where.source = { equals: source, mode: 'insensitive' };
    }

    if (status && status !== 'All') {
      // Support comma-separated list (e.g. "pending,flagged,approved_by_ai")
      const statuses = status.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      if (statuses.length === 1) {
        where.reviewStatus = statuses[0];
      } else if (statuses.length > 1) {
        where.reviewStatus = { in: statuses };
      }
    }

    if (isInProduction !== null && isInProduction !== undefined) {
      where.isInProduction = isInProduction === 'true';
    }

    // Get total count for pagination
    const total = await prisma.offer.count({ where });

    // Get data
    const offers = await prisma.offer.findMany({
      where,
      skip,
      take: limit,
      orderBy: { scrapedAt: 'desc' },
      include: {
        locations: {
          select: { id: true, latitude: true, longitude: true } // valid for map previews
        }
      }
    });

    return NextResponse.json({
      offers,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching offers:', error);
    return NextResponse.json(
      { error: 'Failed to fetch offers' },
      { status: 500 }
    );
  }
}
