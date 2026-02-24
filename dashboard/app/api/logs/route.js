import { NextResponse } from 'next/server';
import { readLogs, readRecentLogs, listLogBanks, listLogDates } from '@/lib/dashboard-logger';

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const bank = searchParams.get('bank');
        const date = searchParams.get('date');
        const limit = parseInt(searchParams.get('limit') || '500');
        const level = searchParams.get('level');    // filter by level
        const search = searchParams.get('search');  // text search
        const mode = searchParams.get('mode') || 'bank'; // 'bank' | 'recent' | 'meta'

        if (mode === 'meta') {
            // Return available banks + dates
            const banks = listLogBanks();
            const meta = banks.map(b => ({
                bank: b,
                dates: listLogDates(b).slice(0, 14), // last 14 days
            }));
            return NextResponse.json({ banks, meta });
        }

        // Read entries
        let entries;
        if (bank) {
            entries = readLogs(bank, date || undefined);
        } else {
            entries = readRecentLogs(limit);
        }

        // Filter by level
        if (level && level !== 'ALL') {
            const LEVEL_ORDER = { DEBUG: 0, INFO: 1, SUCCESS: 2, WARN: 3, ERROR: 4, FATAL: 5 };
            const minVal = LEVEL_ORDER[level] ?? 0;
            entries = entries.filter(e => (LEVEL_ORDER[e.level] ?? 0) >= minVal);
        }

        // Text search
        if (search) {
            const q = search.toLowerCase();
            entries = entries.filter(e =>
                e.message?.toLowerCase().includes(q) ||
                e.tag?.toLowerCase().includes(q) ||
                (e.data && JSON.stringify(e.data).toLowerCase().includes(q))
            );
        }

        // Pagination from end (newest last)
        const total = entries.length;
        entries = entries.slice(-limit);

        return NextResponse.json({ entries, total, bank, date });
    } catch (err) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
