'use client';

import { useEffect, useState } from 'react';
import {
    AlertTriangle, MapPinOff, Calendar, Percent, RefreshCw,
    CheckCircle, ChevronDown, ChevronRight, Link2Off, Clock, Sparkles
} from 'lucide-react';

const SEVERITY = {
    critical: { badge: 'badge-danger', dot: 'bg-red-400' },
    warning: { badge: 'badge-warning', dot: 'bg-amber-400' },
    info: { badge: 'badge-info', dot: 'bg-blue-400' },
};

const ISSUE_ICONS = {
    expired: <Calendar size={15} className="text-red-400" />,
    missing_geo: <MapPinOff size={15} className="text-amber-400" />,
    invalid_discount: <Percent size={15} className="text-red-400" />,
    stale: <Clock size={15} className="text-blue-400" />,
    broken_url: <Link2Off size={15} className="text-amber-400" />,
};

export default function QualityPage() {
    const [issues, setIssues] = useState([]);
    const [summary, setSummary] = useState({});
    const [loading, setLoading] = useState(true);
    const [bulkLoading, setBulkLoading] = useState('');
    const [expanded, setExpanded] = useState(null);
    const [filter, setFilter] = useState('all');

    const fetchIssues = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/quality');
            const data = await res.json();
            setIssues(data.issues || []);
            setSummary(data.summary || {});
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchIssues(); }, []);

    const bulkFix = async (action) => {
        if (!confirm(`Run "${action}" on all matching offers?`)) return;
        setBulkLoading(action);
        try {
            await fetch('/api/quality/fix', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action }),
            });
            await fetchIssues();
        } catch (e) {
            alert('Fix failed: ' + e.message);
        } finally {
            setBulkLoading('');
        }
    };

    const filtered = filter === 'all' ? issues : issues.filter(i => i.severity === filter);

    return (
        <div>
            <div className="page-header flex items-start justify-between">
                <div>
                    <h1 className="page-title">Data Quality</h1>
                    <p className="page-desc">Automatically detected issues requiring attention</p>
                </div>
                <button onClick={fetchIssues} className="btn btn-secondary" disabled={loading}>
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    Refresh
                </button>
            </div>

            {/* Summary strip */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                {[
                    { label: 'Total Issues', value: issues.length, color: 'text-slate-700', bg: 'bg-slate-50' },
                    { label: 'Critical', value: issues.filter(i => i.severity === 'critical').length, color: 'text-red-600', bg: 'bg-red-50' },
                    { label: 'Warnings', value: issues.filter(i => i.severity === 'warning').length, color: 'text-amber-600', bg: 'bg-amber-50' },
                    { label: 'Expired Offers', value: summary.expired ?? 0, color: 'text-red-600', bg: 'bg-red-50' },
                ].map(s => (
                    <div key={s.label} className={`card p-4 ${s.bg}`}>
                        <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
                    </div>
                ))}
            </div>

            {/* Bulk actions */}
            <div className="card p-4 mb-6">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="section-title flex items-center gap-2"><Sparkles size={16} className="text-indigo-500" />Auto-Fix Actions</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button onClick={() => bulkFix('deactivate_expired')} disabled={!!bulkLoading}
                        className="btn btn-danger">
                        {bulkLoading === 'deactivate_expired' ? <RefreshCw size={13} className="animate-spin" /> : <Calendar size={13} />}
                        Deactivate Expired
                    </button>
                    <button onClick={() => bulkFix('regeocode_missing')} disabled={!!bulkLoading}
                        className="btn btn-secondary">
                        {bulkLoading === 'regeocode_missing' ? <RefreshCw size={13} className="animate-spin" /> : <MapPinOff size={13} />}
                        Re-geocode Missing
                    </button>
                    <button onClick={() => bulkFix('refresh_stale')} disabled={!!bulkLoading}
                        className="btn btn-secondary">
                        {bulkLoading === 'refresh_stale' ? <RefreshCw size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                        Refresh Stale Offers
                    </button>
                </div>
            </div>

            {/* Issues table */}
            <div className="card overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
                    <h3 className="section-title">Issues <span className="ml-1.5 badge badge-neutral">{filtered.length}</span></h3>
                    <div className="flex gap-1.5">
                        {['all', 'critical', 'warning', 'info'].map(f => (
                            <button key={f} onClick={() => setFilter(f)}
                                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${filter === f ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
                                {f.charAt(0).toUpperCase() + f.slice(1)}
                            </button>
                        ))}
                    </div>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center py-16 gap-3">
                        <CheckCircle size={36} className="text-emerald-400" />
                        <p className="text-sm font-medium text-slate-600">No issues found</p>
                        <p className="text-xs text-slate-400">Your data is clean!</p>
                    </div>
                ) : (
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Issue</th>
                                <th>Offer</th>
                                <th>Severity</th>
                                <th>Bank</th>
                                <th className="text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((issue, i) => {
                                const sev = SEVERITY[issue.severity] || SEVERITY.info;
                                const rowKey = `${issue.offerId}-${issue.type}`;
                                const isOpen = expanded === rowKey;
                                return (
                                    <>
                                        <tr key={rowKey} className="cursor-pointer" onClick={() => setExpanded(isOpen ? null : rowKey)}>
                                            <td>
                                                <div className="flex items-center gap-2">
                                                    {ISSUE_ICONS[issue.type] || <AlertTriangle size={15} className="text-slate-400" />}
                                                    <span className="font-medium text-slate-800">{issue.typeLabel}</span>
                                                </div>
                                            </td>
                                            <td>
                                                <p className="font-medium text-slate-900 truncate max-w-xs" title={issue.title}>{issue.title || '—'}</p>
                                                <p className="text-[10px] text-slate-400 font-mono mt-0.5">{issue.offerId?.slice(0, 16)}…</p>
                                            </td>
                                            <td><span className={`badge ${sev.badge}`}>{issue.severity}</span></td>
                                            <td><span className="badge badge-neutral">{issue.source}</span></td>
                                            <td className="text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <a href={`/admin/offers/${issue.offerId}`} className="btn btn-ghost text-xs py-1 px-2"
                                                        onClick={e => e.stopPropagation()}>Edit</a>
                                                    {isOpen ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                                                </div>
                                            </td>
                                        </tr>
                                        {isOpen && (
                                            <tr key={`${rowKey}-detail`}>
                                                <td colSpan="5" className="bg-slate-50 px-5 py-3 text-xs text-slate-600">
                                                    <strong className="text-slate-700">Details:</strong> {issue.detail}
                                                </td>
                                            </tr>
                                        )}
                                    </>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
