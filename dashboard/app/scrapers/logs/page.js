'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import {
    Search, Filter, RefreshCw, Download, Trash2, ChevronDown,
    ChevronRight, Clock, AlertCircle, CheckCircle, Info,
    XCircle, Zap, Terminal, WifiOff, Maximize2, Minimize2
} from 'lucide-react';

// ─── Level Config ──────────────────────────────────────────────────────────
const LEVELS = {
    DEBUG: { bg: 'bg-slate-800', text: 'text-slate-400', dot: 'bg-slate-500', badge: 'bg-slate-700 text-slate-300', icon: <Terminal size={11} />, label: 'DEBUG' },
    INFO: { bg: 'bg-slate-900', text: 'text-sky-300', dot: 'bg-sky-400', badge: 'bg-sky-900/50 text-sky-300', icon: <Info size={11} />, label: 'INFO' },
    SUCCESS: { bg: 'bg-slate-900', text: 'text-emerald-400', dot: 'bg-emerald-500', badge: 'bg-emerald-900/50 text-emerald-300', icon: <CheckCircle size={11} />, label: 'OK' },
    WARN: { bg: 'bg-slate-900', text: 'text-amber-300', dot: 'bg-amber-400', badge: 'bg-amber-900/50 text-amber-300', icon: <AlertCircle size={11} />, label: 'WARN' },
    ERROR: { bg: 'bg-red-950/40', text: 'text-red-400', dot: 'bg-red-500', badge: 'bg-red-900/50 text-red-300', icon: <XCircle size={11} />, label: 'ERROR' },
    FATAL: { bg: 'bg-red-900/60', text: 'text-red-300', dot: 'bg-red-600', badge: 'bg-red-800 text-red-200 font-bold', icon: <Zap size={11} />, label: 'FATAL' },
};

const BANK_COLORS = {
    hnb: 'text-blue-400',
    boc: 'text-green-400',
    ndb: 'text-purple-400',
    sampath: 'text-orange-400',
    peoples: 'text-cyan-400',
    seylan: 'text-yellow-400',
    dfcc: 'text-pink-400',
    panasia: 'text-indigo-400',
    geo: 'text-teal-400',
};

function getBankColor(bank) {
    return BANK_COLORS[bank?.toLowerCase()] || 'text-slate-400';
}

// ─── Format helpers ────────────────────────────────────────────────────────
function formatTime(iso) {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function formatDate(iso) {
    return new Date(iso).toLocaleDateString('en-LK', { month: 'short', day: 'numeric' });
}

// ─── Main Page ─────────────────────────────────────────────────────────────
export default function LogsPage() {
    const [entries, setEntries] = useState([]);
    const [meta, setMeta] = useState({ banks: [], meta: [] });
    const [loading, setLoading] = useState(true);
    const [autoScroll, setAutoScroll] = useState(true);
    const [fullscreen, setFullscreen] = useState(false);

    // Filters
    const [bank, setBank] = useState('all');
    const [date, setDate] = useState('');
    const [level, setLevel] = useState('ALL');
    const [search, setSearch] = useState('');
    const [searchInput, setSearchInput] = useState('');

    // UI
    const [expanded, setExpanded] = useState(null);
    const bottomRef = useRef(null);
    const containerRef = useRef(null);
    const autoRefreshRef = useRef(null);

    const fetchMeta = async () => {
        const d = await fetch('/api/logs?mode=meta').then(r => r.json()).catch(() => ({ banks: [], meta: [] }));
        setMeta(d);
    };

    const fetchLogs = useCallback(async (isRefresh = false) => {
        if (!isRefresh) setLoading(true);
        const params = new URLSearchParams({ limit: '1000', mode: 'bank' });
        if (bank !== 'all') params.set('bank', bank);
        if (date) params.set('date', date);
        if (level !== 'ALL') params.set('level', level);
        if (search) params.set('search', search);
        if (bank === 'all') params.set('mode', 'recent');

        const data = await fetch(`/api/logs?${params}`).then(r => r.json()).catch(() => ({ entries: [] }));
        setEntries(data.entries || []);
        setLoading(false);
    }, [bank, date, level, search]);

    useEffect(() => {
        fetchMeta();
    }, []);

    useEffect(() => {
        fetchLogs();
    }, [fetchLogs]);

    // Auto-refresh every 3s
    useEffect(() => {
        clearInterval(autoRefreshRef.current);
        autoRefreshRef.current = setInterval(() => fetchLogs(true), 3000);
        return () => clearInterval(autoRefreshRef.current);
    }, [fetchLogs]);

    // Auto-scroll to bottom
    useEffect(() => {
        if (autoScroll && bottomRef.current) {
            bottomRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [entries, autoScroll]);

    // Stats from current entries
    const stats = {
        total: entries.length,
        errors: entries.filter(e => e.level === 'ERROR' || e.level === 'FATAL').length,
        warns: entries.filter(e => e.level === 'WARN').length,
        banks: [...new Set(entries.map(e => e.bank))].filter(Boolean),
    };

    const exportLogs = () => {
        const text = entries.map(e =>
            `[${formatTime(e.ts)}] [${e.level}] [${e.bank}/${e.tag}] ${e.message}${e.data ? ' ' + JSON.stringify(e.data) : ''}`
        ).join('\n');
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        Object.assign(document.createElement('a'), { href: url, download: `scraper-logs-${bank}-${date || 'today'}.txt` }).click();
    };

    // Available dates for selected bank
    const availableDates = bank !== 'all'
        ? (meta.meta?.find(m => m.bank === bank)?.dates || [])
        : [];

    return (
        <div className={`flex flex-col ${fullscreen ? 'fixed inset-0 z-50 bg-[#0d1117]' : 'h-[calc(100vh-8rem)]'}`}>

            {/* ── Top Bar ── */}
            <div className={`flex items-center gap-3 px-4 py-3 border-b shrink-0 ${fullscreen ? 'bg-[#161b22] border-slate-700' : 'bg-slate-900 border-slate-700 rounded-t-xl'}`}>
                {/* Title */}
                <div className="flex items-center gap-2 mr-2">
                    <Terminal size={16} className="text-emerald-400" />
                    <span className="text-sm font-semibold text-slate-100">Scraper Logs</span>
                    {loading && <div className="w-3 h-3 border border-emerald-500 border-t-transparent rounded-full animate-spin" />}
                </div>

                <div className="w-px h-5 bg-slate-700" />

                {/* Bank selector */}
                <select value={bank} onChange={e => { setBank(e.target.value); setDate(''); }}
                    className="bg-slate-800 border border-slate-700 text-slate-200 text-xs px-2 py-1.5 rounded-lg focus:border-indigo-500 outline-none">
                    <option value="all">All Banks</option>
                    {meta.banks.map(b => (
                        <option key={b} value={b}>{b.toUpperCase()}</option>
                    ))}
                </select>

                {/* Date selector (only when specific bank selected) */}
                {bank !== 'all' && availableDates.length > 0 && (
                    <select value={date} onChange={e => setDate(e.target.value)}
                        className="bg-slate-800 border border-slate-700 text-slate-200 text-xs px-2 py-1.5 rounded-lg focus:border-indigo-500 outline-none">
                        <option value="">Today</option>
                        {availableDates.map(d => (
                            <option key={d} value={d}>{d}</option>
                        ))}
                    </select>
                )}

                {/* Level filter */}
                <select value={level} onChange={e => setLevel(e.target.value)}
                    className="bg-slate-800 border border-slate-700 text-slate-200 text-xs px-2 py-1.5 rounded-lg focus:border-indigo-500 outline-none">
                    {['ALL', 'DEBUG', 'INFO', 'SUCCESS', 'WARN', 'ERROR', 'FATAL'].map(l => (
                        <option key={l} value={l}>{l}</option>
                    ))}
                </select>

                {/* Search */}
                <div className="relative flex-1 max-w-xs">
                    <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                        type="text"
                        placeholder="Search logs…"
                        value={searchInput}
                        onChange={e => setSearchInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && setSearch(searchInput)}
                        className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs pl-6 pr-2 py-1.5 rounded-lg focus:border-indigo-500 outline-none placeholder:text-slate-600"
                    />
                </div>
                {searchInput !== search && (
                    <button onClick={() => setSearch(searchInput)} className="text-xs text-indigo-400 hover:text-indigo-300">↵</button>
                )}
                {search && (
                    <button onClick={() => { setSearch(''); setSearchInput(''); }} className="text-xs text-slate-500 hover:text-slate-300">✕</button>
                )}

                <div className="ml-auto flex items-center gap-2">
                    {/* Stats pills */}
                    {stats.errors > 0 && (
                        <span className="text-[10px] bg-red-900/50 text-red-300 px-2 py-0.5 rounded-full font-medium">
                            {stats.errors} errors
                        </span>
                    )}
                    {stats.warns > 0 && (
                        <span className="text-[10px] bg-amber-900/50 text-amber-300 px-2 py-0.5 rounded-full font-medium">
                            {stats.warns} warns
                        </span>
                    )}
                    <span className="text-[10px] text-slate-500">{stats.total} lines</span>

                    <div className="w-px h-5 bg-slate-700" />

                    {/* Auto-scroll toggle */}
                    <button
                        onClick={() => setAutoScroll(p => !p)}
                        className={`text-[10px] px-2 py-1 rounded-md font-medium transition-colors ${autoScroll ? 'bg-emerald-900/50 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
                        {autoScroll ? '↓ Live' : '↓ Paused'}
                    </button>

                    <button onClick={() => fetchLogs(true)} className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-md transition-colors">
                        <RefreshCw size={13} />
                    </button>
                    <button onClick={exportLogs} className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-md transition-colors">
                        <Download size={13} />
                    </button>
                    <button onClick={() => setFullscreen(f => !f)} className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-md transition-colors">
                        {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                    </button>
                </div>
            </div>

            {/* ── Log Viewport ── */}
            <div
                ref={containerRef}
                className="flex-1 overflow-y-auto bg-[#0d1117] font-mono text-xs"
                onScroll={e => {
                    const el = e.currentTarget;
                    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
                    setAutoScroll(atBottom);
                }}
            >
                {loading && entries.length === 0 ? (
                    <div className="flex items-center justify-center h-32 gap-3 text-slate-500 text-sm">
                        <div className="w-4 h-4 border border-emerald-500 border-t-transparent rounded-full animate-spin" />
                        Loading logs…
                    </div>
                ) : entries.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 gap-3 text-slate-600">
                        <WifiOff size={28} />
                        <p className="text-sm">No log entries found</p>
                        <p className="text-xs">Run a scraper to collect logs</p>
                    </div>
                ) : (
                    <div>
                        {entries.map((entry, i) => {
                            const cfg = LEVELS[entry.level] || LEVELS.INFO;
                            const key = `${entry.ts}-${i}`;
                            const isExpanded = expanded === key;
                            const hasData = entry.data && Object.keys(entry.data).length > 0;

                            return (
                                <div
                                    key={key}
                                    className={`group flex items-start gap-0 border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors ${cfg.bg}`}
                                    onClick={() => hasData && setExpanded(isExpanded ? null : key)}
                                >
                                    {/* Level indicator bar */}
                                    <div className={`w-0.5 self-stretch shrink-0 ${cfg.dot}`} />

                                    {/* Timestamp */}
                                    <span className="shrink-0 text-slate-600 py-1 pl-2 pr-3 select-none tabular-nums text-[10px] leading-5 mt-0.5">
                                        {formatTime(entry.ts)}
                                    </span>

                                    {/* Level badge */}
                                    <span className={`shrink-0 self-start mt-1 mr-2 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${cfg.badge} flex items-center gap-0.5`}>
                                        {cfg.icon} {cfg.label}
                                    </span>

                                    {/* Bank tag */}
                                    <span className={`shrink-0 self-start mt-1 mr-2 text-[10px] font-semibold uppercase tabular-nums ${getBankColor(entry.bank)}`}>
                                        {(entry.bank || '?').substring(0, 8)}
                                    </span>

                                    {/* Tag */}
                                    <span className="shrink-0 self-start mt-1 mr-2 text-[10px] text-slate-600 min-w-[80px]">
                                        [{entry.tag?.substring(0, 14) || 'General'}]
                                    </span>

                                    {/* Message */}
                                    <div className="flex-1 py-1 pr-2">
                                        <span className={`${cfg.text} leading-5 break-words`}>{entry.message}</span>

                                        {/* Inline data preview */}
                                        {hasData && !isExpanded && (
                                            <span className="ml-2 text-slate-600 text-[10px]">
                                                {JSON.stringify(entry.data).substring(0, 80)}{JSON.stringify(entry.data).length > 80 ? '…' : ''}
                                            </span>
                                        )}

                                        {/* Expanded data */}
                                        {isExpanded && hasData && (
                                            <div className="mt-2 bg-slate-800/60 rounded-lg p-3 text-slate-300 text-[11px] border border-slate-700">
                                                <pre className="whitespace-pre-wrap overflow-x-auto">{JSON.stringify(entry.data, null, 2)}</pre>
                                            </div>
                                        )}
                                    </div>

                                    {/* Expand chevron */}
                                    {hasData && (
                                        <div className="shrink-0 self-start mt-1.5 mr-2 text-slate-600 group-hover:text-slate-400 transition-colors">
                                            {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        <div ref={bottomRef} />
                    </div>
                )}
            </div>

            {/* ── Bottom Status Bar ── */}
            <div className={`flex items-center justify-between px-4 py-1.5 border-t shrink-0 ${fullscreen ? 'bg-[#161b22] border-slate-700' : 'bg-slate-900 border-slate-700 rounded-b-xl'}`}>
                <div className="flex items-center gap-4 text-[10px] text-slate-500">
                    <span className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Auto-refresh 3s
                    </span>
                    {stats.banks.length > 0 && (
                        <span>Banks: {stats.banks.join(', ')}</span>
                    )}
                </div>
                <div className="flex items-center gap-3 text-[10px]">
                    {['DEBUG', 'INFO', 'SUCCESS', 'WARN', 'ERROR'].map(l => {
                        const c = LEVELS[l];
                        const cnt = entries.filter(e => e.level === l).length;
                        return cnt > 0 ? (
                            <span key={l} className={`${c.badge} px-1.5 py-0.5 rounded text-[9px] font-bold`}>
                                {l.substring(0, 1)} {cnt}
                            </span>
                        ) : null;
                    })}
                </div>
            </div>
        </div>
    );
}
