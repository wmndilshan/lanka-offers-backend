'use client';

import { useEffect, useState } from 'react';
import {
    BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { FileText, Store, AlertTriangle, Building2, Clock, TrendingUp, TrendingDown, ArrowUpRight } from 'lucide-react';

const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-lg px-3 py-2 text-sm">
            {label && <p className="text-slate-500 text-xs mb-1">{label}</p>}
            {payload.map((p, i) => (
                <p key={i} className="font-semibold" style={{ color: p.color || '#6366f1' }}>
                    {p.value} {p.name && p.name !== 'count' ? p.name : 'offers'}
                </p>
            ))}
        </div>
    );
};

export default function AnalyticsPage() {
    const [summary, setSummary] = useState(null);
    const [charts, setCharts] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/analytics')
            .then(r => r.json())
            .then(d => { setSummary(d.summary); setCharts(d.charts); })
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <PageLoader />;

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">Analytics</h1>
                <p className="page-desc">Offer distribution, trends, and merchant insights</p>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
                <Kpi label="Active Offers" value={summary?.totalActive ?? 0} change={summary?.activeChange} color="indigo" icon={<FileText size={18} />} />
                <Kpi label="Merchants" value={summary?.uniqueMerchants ?? 0} color="emerald" icon={<Store size={18} />} />
                <Kpi label="Expiring (7d)" value={summary?.expiringIn7Days ?? 0} color="amber" icon={<AlertTriangle size={18} />} href="/quality" />
                <Kpi label="Banks Tracked" value={summary?.banksTracked ?? 8} color="violet" icon={<Building2 size={18} />} />
                <Kpi label="Last Scrape" value={summary?.lastScrapeRelative ?? 'N/A'} color="sky" icon={<Clock size={18} />} isText />
            </div>

            {/* Charts Row 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
                <ChartCard title="Offers by Category" subtitle="Distribution across categories">
                    {charts?.byCategory?.length ? (
                        <ResponsiveContainer width="100%" height={240}>
                            <PieChart>
                                <Pie data={charts.byCategory} cx="50%" cy="50%" outerRadius={85} innerRadius={40}
                                    dataKey="count" nameKey="category">
                                    {charts.byCategory.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                                </Pie>
                                <Tooltip content={<CustomTooltip />} />
                                <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ fontSize: 12, color: '#64748b' }}>{v}</span>} />
                            </PieChart>
                        </ResponsiveContainer>
                    ) : <EmptyChart />}
                </ChartCard>

                <ChartCard title="Offers by Bank" subtitle="Total offers per bank">
                    {charts?.byBank?.length ? (
                        <ResponsiveContainer width="100%" height={240}>
                            <BarChart data={charts.byBank} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                <XAxis dataKey="bank" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f8fafc' }} />
                                <Bar dataKey="count" fill="#6366f1" radius={[6, 6, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : <EmptyChart />}
                </ChartCard>
            </div>

            {/* Charts Row 2 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
                <ChartCard title="Discount Range Distribution" subtitle="How discounts are spread">
                    {charts?.byDiscount?.length ? (
                        <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={charts.byDiscount} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                <XAxis dataKey="range" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f8fafc' }} />
                                <Bar dataKey="count" fill="#10b981" radius={[6, 6, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : <EmptyChart />}
                </ChartCard>

                <ChartCard title="Expiry Timeline" subtitle="Offers expiring over next 12 weeks">
                    {charts?.expiryTimeline?.length ? (
                        <ResponsiveContainer width="100%" height={220}>
                            <LineChart data={charts.expiryTimeline} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                <Tooltip content={<CustomTooltip />} />
                                <Line type="monotone" dataKey="count" stroke="#f59e0b" strokeWidth={2.5}
                                    dot={false} activeDot={{ r: 4, fill: '#f59e0b' }} />
                            </LineChart>
                        </ResponsiveContainer>
                    ) : <EmptyChart />}
                </ChartCard>
            </div>

            {/* Merchant Table */}
            <div className="card overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                    <div>
                        <h3 className="section-title">Top Merchants</h3>
                        <p className="text-xs text-slate-400 mt-0.5">Phase 1b sales outreach targets (3+ active offers)</p>
                    </div>
                    <a href="/merchants" className="text-xs font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-1">
                        Full list <ArrowUpRight size={12} />
                    </a>
                </div>
                {charts?.topMerchants?.length ? (
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Merchant</th>
                                <th>Category</th>
                                <th className="text-right">Offers</th>
                                <th className="text-right">Avg Discount</th>
                                <th className="text-right">Banks</th>
                            </tr>
                        </thead>
                        <tbody>
                            {charts.topMerchants.map((m, i) => (
                                <tr key={i}>
                                    <td className="text-slate-400 font-mono text-xs w-8">{i + 1}</td>
                                    <td>
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold text-xs shrink-0">
                                                {(m.name || '?')[0].toUpperCase()}
                                            </div>
                                            <span className="font-medium text-slate-900">{m.name}</span>
                                            {m.offerCount >= 3 && <span className="badge badge-warning text-[10px]">Sales Target</span>}
                                        </div>
                                    </td>
                                    <td><span className="badge badge-neutral">{m.category || 'N/A'}</span></td>
                                    <td className="text-right font-bold text-indigo-600">{m.offerCount}</td>
                                    <td className="text-right text-slate-600">{m.avgDiscount ? `${m.avgDiscount.toFixed(0)}%` : '—'}</td>
                                    <td className="text-right text-slate-600">{m.banks}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : <EmptyChart message="No merchant data" />}
            </div>
        </div>
    );
}

function Kpi({ label, value, change, color, icon, href, isText }) {
    const colors = {
        indigo: 'bg-indigo-50 text-indigo-600',
        emerald: 'bg-emerald-50 text-emerald-600',
        amber: 'bg-amber-50 text-amber-600',
        violet: 'bg-violet-50 text-violet-600',
        sky: 'bg-sky-50 text-sky-600',
    };
    const card = (
        <div className="stat-card">
            <div className="flex items-center justify-between">
                <div className={`p-2 rounded-xl ${colors[color]}`}>{icon}</div>
                {change != null && (
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-0.5 ${change >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                        {change >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />} {Math.abs(change)}%
                    </span>
                )}
            </div>
            <div>
                <p className={`font-bold text-slate-900 ${isText ? 'text-sm' : 'text-2xl'} tracking-tight`}>{value}</p>
                <p className="text-xs text-slate-400 mt-0.5">{label}</p>
            </div>
        </div>
    );
    return href ? <a href={href} className="block">{card}</a> : card;
}

function ChartCard({ title, subtitle, children }) {
    return (
        <div className="card p-5">
            <div className="mb-4">
                <h3 className="section-title">{title}</h3>
                {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
            </div>
            {children}
        </div>
    );
}

function EmptyChart({ message = 'No data yet' }) {
    return (
        <div className="flex items-center justify-center h-40 text-sm text-slate-400">{message}</div>
    );
}

function PageLoader() {
    return (
        <div className="flex items-center justify-center h-60">
            <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-slate-400">Loading analytics…</p>
            </div>
        </div>
    );
}
