'use client';

import { useEffect, useState } from 'react';
import { Search, Download, Crown, TrendingUp, Store, Filter } from 'lucide-react';

const PAYMENT_BADGE = {
    free: 'badge-neutral',
    trial: 'badge-warning',
    paying: 'badge-success',
};

export default function MerchantsPage() {
    const [merchants, setMerchants] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [minOffers, setMinOffers] = useState(0);

    useEffect(() => {
        fetch('/api/merchants').then(r => r.json())
            .then(d => setMerchants(d.merchants || []))
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    const filtered = merchants.filter(m =>
        (!search || m.name?.toLowerCase().includes(search.toLowerCase())) &&
        m.offerCount >= minOffers
    );

    const exportCSV = () => {
        const csv = [
            ['Merchant', 'Category', 'Active Offers', 'Banks', 'Avg Discount', 'Status'].join(','),
            ...filtered.map(m => [`"${m.name}"`, `"${m.category || ''}"`, m.offerCount, m.banks, m.avgDiscount ? `${m.avgDiscount.toFixed(0)}%` : '', m.paymentStatus || 'free'].join(','))
        ].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        Object.assign(document.createElement('a'), { href: url, download: `merchants-${new Date().toISOString().split('T')[0]}.csv` }).click();
    };

    return (
        <div>
            <div className="page-header flex items-start justify-between">
                <div>
                    <h1 className="page-title">Merchants</h1>
                    <p className="page-desc">Merchant directory — Phase 1b outreach targets</p>
                </div>
                <button onClick={exportCSV} className="btn btn-primary">
                    <Download size={14} /> Export CSV
                </button>
            </div>

            {/* Phase 1b stubs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                {[
                    { label: 'Merchant Portal', desc: 'Self-service portal' },
                    { label: 'Payment Tracking', desc: 'Monthly subscriptions' },
                    { label: 'Featured Placements', desc: 'Boost visibility' },
                    { label: 'Merchant Analytics', desc: 'Per-merchant stats' },
                ].map(s => (
                    <div key={s.label} className="card p-4 text-center opacity-60 border-dashed">
                        <Crown size={18} className="text-amber-400 mx-auto mb-2" />
                        <p className="text-xs font-semibold text-slate-700">{s.label}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">{s.desc}</p>
                        <span className="mt-2 inline-block badge badge-warning">Phase 1b</span>
                    </div>
                ))}
            </div>

            {/* Controls */}
            <div className="card p-4 mb-5 flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[200px]">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type="text" placeholder="Search merchants…" value={search}
                        onChange={e => setSearch(e.target.value)} className="input pl-8" />
                </div>
                <div className="flex items-center gap-2">
                    <Filter size={14} className="text-slate-400" />
                    <select value={minOffers} onChange={e => setMinOffers(Number(e.target.value))} className="input w-44">
                        <option value={0}>All Merchants</option>
                        <option value={2}>2+ Offers</option>
                        <option value={3}>3+ Offers (Targets)</option>
                        <option value={5}>5+ Offers</option>
                    </select>
                </div>
                <p className="text-xs text-slate-400">{filtered.length} merchants</p>
            </div>

            {/* Table */}
            <div className="card overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center h-40">
                        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : (
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Merchant</th>
                                <th>Category</th>
                                <th className="text-right">Offers</th>
                                <th className="text-right">Banks</th>
                                <th className="text-right">Avg Discount</th>
                                <th>Status</th>
                                <th>Contact</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 ? (
                                <tr><td colSpan="7" className="py-12 text-center text-slate-400">No merchants found</td></tr>
                            ) : filtered.map((m, i) => (
                                <tr key={i}>
                                    <td>
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 text-xs font-bold shrink-0">
                                                {(m.name || '?')[0].toUpperCase()}
                                            </div>
                                            <div>
                                                <p className="font-medium text-slate-900">{m.name}</p>
                                                {m.offerCount >= 3 && (
                                                    <p className="text-[10px] text-amber-600 flex items-center gap-0.5 mt-0.5">
                                                        <TrendingUp size={9} /> Sales target
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                    <td><span className="badge badge-neutral">{m.category || '—'}</span></td>
                                    <td className="text-right font-bold text-indigo-600">{m.offerCount}</td>
                                    <td className="text-right text-slate-600">{m.banks}</td>
                                    <td className="text-right text-slate-600">{m.avgDiscount ? `${m.avgDiscount.toFixed(0)}%` : '—'}</td>
                                    <td><span className={`badge ${PAYMENT_BADGE[m.paymentStatus || 'free']}`}>{m.paymentStatus || 'free'}</span></td>
                                    <td className="text-slate-400 text-xs italic">Not collected</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
