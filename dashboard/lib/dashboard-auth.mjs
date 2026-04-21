import { NextResponse } from 'next/server';

/**
 * Check for admin API key via Authorization: Bearer <key> or X-Admin-Api-Key header.
 * Returns a 401 NextResponse if the key is missing/wrong, or null if the request is authorized.
 *
 * Uses DASHBOARD_ADMIN_KEY env var (falls back to ADMIN_API_KEY for compatibility).
 */
export function requireAdminKey(request) {
    const expected = (process.env.DASHBOARD_ADMIN_KEY || process.env.ADMIN_API_KEY || '').trim();

    if (!expected) {
        return NextResponse.json(
            { error: 'Service Unavailable', message: 'Admin API key is not configured on this server' },
            { status: 503 },
        );
    }

    const authHeader = request.headers.get('authorization') || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const apiKey = request.headers.get('x-admin-api-key') || bearer;

    if (!apiKey || apiKey !== expected) {
        return NextResponse.json(
            { error: 'Unauthorized', message: 'Invalid or missing admin API key' },
            { status: 401 },
        );
    }

    return null;
}
