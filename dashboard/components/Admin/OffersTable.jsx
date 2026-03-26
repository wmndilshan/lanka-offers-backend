
'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Search, Filter, ChevronLeft, ChevronRight, Edit3, CheckCircle2, XCircle, MapPin, ExternalLink, Calendar, Zap, Sparkles } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function OffersTable() {
    const router = useRouter();
    const searchParams = useSearchParams();

    const [offers, setOffers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });

    // Filters state
    const [search, setSearch] = useState(searchParams.get('search') || '');
    const [category, setCategory] = useState(searchParams.get('category') || 'All');
    const [source, setSource] = useState(searchParams.get('source') || 'All');
    const [status, setStatus] = useState(searchParams.get('status') || 'All');

    // Bulk Selection State
    const [selectedOffers, setSelectedOffers] = useState(new Set());

    const fetchOffers = async () => {
        setLoading(true);
        try {
            const currentPage = searchParams.get('page') || 1;
            const query = new URLSearchParams({
                page: currentPage,
                limit: 25,
                search: search,
                category: category !== 'All' ? category : '',
                source: source !== 'All' ? source : '',
                status: status !== 'All' ? status : '',
            });

            const res = await fetch(`/api/offers?${query}`);
            const data = await res.json();

            setOffers(data.offers);
            setPagination(data.pagination);
            setSelectedOffers(new Set());
        } catch (error) {
            console.error('Failed to fetch offers:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchOffers();
    }, [searchParams]);

    const handleSearch = () => {
        updateParams({ search, page: 1 });
    };

    const handleFilterChange = (key, value) => {
        if (key === 'category') setCategory(value);
        if (key === 'source') setSource(value);
        if (key === 'status') setStatus(value);
        updateParams({ [key]: value === 'All' ? '' : value, page: 1 });
    };

    const updateParams = (updates) => {
        const params = new URLSearchParams(searchParams);
        Object.entries(updates).forEach(([key, value]) => {
            if (value) {
                params.set(key, value);
            } else {
                params.delete(key);
            }
        });
        router.push(`/admin/offers?${params.toString()}`);
    };

    const StatusBadge = ({ status }) => {
        const styles = {
            pending: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
            approved: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
            rejected: 'text-red-400 bg-red-400/10 border-red-400/20',
            approved_by_ai: 'text-sky-400 bg-sky-400/10 border-sky-400/20',
            flagged: 'text-rose-400 bg-rose-400/10 border-rose-400/20',
        };
        const label = status?.replace(/_/g, ' ').toUpperCase() || 'UNKNOWN';
        return (
            <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black border tracking-tighter ${styles[status] || 'text-slate-400 bg-slate-400/10'}`}>
                {label}
            </span>
        );
    };

    const handleStatusUpdate = async (id, newStatus) => {
        setOffers(prev => prev.map(offer =>
            offer.id === id ? { ...offer, reviewStatus: newStatus } : offer
        ));

        try {
            const res = await fetch(`/api/offers/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reviewStatus: newStatus }),
            });
            if (!res.ok) throw new Error('Failed to update status');
        } catch (error) {
            console.error('Error updating status:', error);
            fetchOffers();
        }
    };

    const toggleSelection = (id) => {
        const newSelection = new Set(selectedOffers);
        if (newSelection.has(id)) newSelection.delete(id);
        else newSelection.add(id);
        setSelectedOffers(newSelection);
    };

    const toggleAll = () => {
        if (selectedOffers.size === offers.length) setSelectedOffers(new Set());
        else setSelectedOffers(new Set(offers.map(o => o.id)));
    };

    return (
        <div className="space-y-6 animate-fade-in relative">
            {/* Bulk Action Bar */}
            {selectedOffers.size > 0 && (
                <div className="fixed bottom-10 left-1/2 -translate-x-1/2 glass-card border-sky-500/30 bg-sky-500/10 p-4 z-[100] flex items-center gap-6 shadow-[0_0_50px_rgba(56,189,248,0.3)] animate-in slide-in-from-bottom-10">
                    <span className="text-sm font-black text-white ml-2">{selectedOffers.size} SELECTED</span>
                    <div className="flex gap-2">
                        <button className="px-4 py-2 bg-emerald-500 text-white rounded-xl text-xs font-bold hover:bg-emerald-400 transition-all flex items-center gap-2">
                            <Zap size={14} fill="currentColor" /> Approve All
                        </button>
                        <button className="px-4 py-2 bg-red-500 text-white rounded-xl text-xs font-bold hover:bg-red-400 transition-all flex items-center gap-2">
                            <XCircle size={14} /> Reject All
                        </button>
                        <button onClick={() => setSelectedOffers(new Set())} className="px-4 py-2 bg-white/5 text-slate-400 rounded-xl text-xs font-bold hover:bg-white/10 border border-white/5 transition-all">
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            <div className="glass-card overflow-hidden">
                {/* Header Controls */}
                <div className="p-6 border-b border-white/5 flex flex-col xl:flex-row gap-6 justify-between items-center bg-white/2">
                    <div className="flex gap-3 w-full xl:w-auto">
                        <div className="relative flex-1 xl:w-80">
                            <input
                                type="text"
                                placeholder="Search repository..."
                                className="glass-input w-full pl-12 pr-4 py-3"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                            />
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-500" />
                        </div>
                        <button onClick={handleSearch} className="btn-premium-blue px-6">
                            Search
                        </button>
                    </div>

                    <div className="flex gap-3 w-full xl:w-auto overflow-x-auto pb-2 xl:pb-0 scrollbar-hide">
                        {[
                            { val: category, set: handleFilterChange.bind(null, 'category'), options: ['All Categories', 'Dining', 'Hotel', 'Lifestyle', 'Shopping', 'Travel', 'Health'] },
                            { val: source, set: handleFilterChange.bind(null, 'source'), options: ['All Banks', 'HNB', 'BOC', 'NDB', 'Seylan', 'Peoples', 'Sampath'] },
                            { val: status, set: handleFilterChange.bind(null, 'status'), options: ['All Status', 'pending', 'approved', 'rejected', 'approved_by_ai', 'flagged'] }
                        ].map((filter, i) => (
                            <select
                                key={i}
                                className="glass-input cursor-pointer min-w-[140px] appearance-none text-xs font-bold uppercase tracking-wider"
                                value={filter.val}
                                onChange={(e) => filter.set(e.target.value)}
                            >
                                {filter.options.map(opt => <option key={opt} value={opt === filter.options[0] ? 'All' : opt} className="bg-slate-900">{opt}</option>)}
                            </select>
                        ))}
                    </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-white/2 text-slate-500 text-[10px] uppercase font-black tracking-widest border-b border-white/5">
                            <tr>
                                <th className="p-6 w-4">
                                    <input
                                        type="checkbox"
                                        checked={offers.length > 0 && selectedOffers.size === offers.length}
                                        onChange={toggleAll}
                                        className="rounded-md border-white/10 bg-white/5 text-sky-500 focus:ring-sky-500/40"
                                    />
                                </th>
                                <th className="p-6">Entity & Details</th>
                                <th className="p-6 text-center">Context</th>
                                <th className="p-6">Lifecycle</th>
                                <th className="p-6">Validity</th>
                                <th className="p-6 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5 text-sm">
                            {loading ? (
                                Array(5).fill(0).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td colSpan="6" className="p-6"><div className="h-8 bg-white/5 rounded-xl w-full" /></td>
                                    </tr>
                                ))
                            ) : offers.length === 0 ? (
                                <tr><td colSpan="6" className="p-20 text-center text-slate-500 font-bold italic">The void is empty. No offers found.</td></tr>
                            ) : (
                                offers.map((offer) => (
                                    <tr key={offer.id} className={`hover:bg-white/5 transition-all group ${selectedOffers.has(offer.id) ? 'bg-sky-500/5' : ''}`}>
                                        <td className="p-6 align-top">
                                            <input
                                                type="checkbox"
                                                checked={selectedOffers.has(offer.id)}
                                                onChange={() => toggleSelection(offer.id)}
                                                className="rounded-md border-white/10 bg-white/5 text-sky-500 focus:ring-sky-500/40"
                                            />
                                        </td>
                                        <td className="p-6 max-w-md">
                                            <div className="font-bold text-slate-100 group-hover:text-sky-400 transition-colors truncate mb-1" title={offer.title}>
                                                {offer.title}
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-slate-400 font-medium">
                                                <span className="text-sky-500/70">{offer.merchantName || 'Generic Merchant'}</span>
                                                <span className="text-slate-600">|</span>
                                                <span className="font-mono text-[10px] uppercase tracking-tighter opacity-50">{offer.unique_id}</span>
                                            </div>
                                        </td>
                                        <td className="p-6 text-center">
                                            <div className="flex flex-col items-center gap-1.5">
                                                <span className="px-2 py-0.5 bg-white/5 border border-white/10 rounded text-[9px] font-black text-slate-300 uppercase tracking-tighter">
                                                    {offer.category}
                                                </span>
                                                <span className="text-[10px] font-black text-sky-500/80 tracking-widest">{offer.source}</span>
                                            </div>
                                        </td>
                                        <td className="p-6">
                                            <div className="flex flex-col gap-2">
                                                <StatusBadge status={offer.reviewStatus} />
                                                {offer.isInProduction && (
                                                    <span className="flex items-center gap-1.5 text-[9px] font-black text-emerald-400 uppercase tracking-widest ml-1">
                                                        <Globe size={10} /> Live
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="p-6">
                                            <div className="flex flex-col gap-1.5 font-bold">
                                                <div className="flex items-center gap-2 text-xs text-slate-200">
                                                    <Calendar size={12} className="text-slate-500" />
                                                    {offer.validTo ? new Date(offer.validTo).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '∞'}
                                                </div>
                                                {offer.validTo && (
                                                    <div className={`text-[10px] uppercase tracking-widest ${new Date(offer.validTo) < new Date() ? 'text-rose-500' : 'text-emerald-500'}`}>
                                                        {Math.ceil((new Date(offer.validTo) - new Date()) / (1000 * 60 * 60 * 24))}d left
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        <td className="p-6 text-right">
                                            <div className="flex justify-end gap-3 opacity-0 group-hover:opacity-100 transition-all translate-x-4 group-hover:translate-x-0">
                                                <button onClick={() => handleStatusUpdate(offer.id, 'approved')} className="p-2 text-emerald-400 hover:bg-emerald-400/10 rounded-xl transition-all" title="Approve">
                                                    <CheckCircle2 size={18} />
                                                </button>
                                                <button onClick={() => handleStatusUpdate(offer.id, 'rejected')} className="p-2 text-rose-500 hover:bg-rose-500/10 rounded-xl transition-all" title="Reject">
                                                    <XCircle size={18} />
                                                </button>
                                                <Link href={`/admin/offers/${offer.id}`} className="p-2 text-sky-400 hover:bg-sky-400/10 rounded-xl transition-all" title="Review Context">
                                                    <ExternalLink size={18} />
                                                </Link>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Footer / Pagination */}
                <div className="p-8 border-t border-white/5 flex flex-col sm:flex-row justify-between items-center gap-6 text-xs font-bold bg-white/1">
                    <div className="text-slate-500 uppercase tracking-widest">
                        Showing <span className="text-white">{((pagination.page - 1) * 25) + 1}</span> to <span className="text-white">{Math.min(pagination.page * 25, pagination.total)}</span> of <span className="text-sky-500">{pagination.total}</span> entries
                    </div>
                    <div className="flex gap-2 p-1 bg-white/5 rounded-2xl border border-white/5">
                        <button
                            disabled={pagination.page <= 1}
                            onClick={() => updateParams({ page: pagination.page - 1 })}
                            className="p-3 text-slate-400 hover:text-white hover:bg-white/5 rounded-xl transition-all disabled:opacity-20"
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <div className="px-6 flex items-center text-slate-200 tracking-widest uppercase">
                            Page {pagination.page} / {pagination.totalPages}
                        </div>
                        <button
                            disabled={pagination.page >= pagination.totalPages}
                            onClick={() => updateParams({ page: pagination.page + 1 })}
                            className="p-3 text-slate-400 hover:text-white hover:bg-white/5 rounded-xl transition-all disabled:opacity-20"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
