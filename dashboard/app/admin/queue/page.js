'use client';

import React, { useState, useEffect } from 'react';
import { Search, Filter, RefreshCw, Zap, AlertCircle, CheckCircle2, MoreVertical, Edit3, Globe, ShieldCheck, Sparkles } from 'lucide-react';
import OfferReviewPanel from '@/components/Admin/OfferReviewPanel';

export default function IngestionQueue() {
    const [offers, setOffers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedOffer, setSelectedOffer] = useState(null);
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [filter, setFilter] = useState('all'); // all, flagged, ai_approved, pending
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const PAGE_SIZE = 50;

    const fetchQueue = async (pageNum = 1, statusFilter = 'all') => {
        setLoading(true);
        try {
            // Only fetch review-queue statuses — exclude already-rejected and approved+in-production
            const statusParam = statusFilter === 'all'
                ? 'pending,flagged,approved_by_ai'
                : statusFilter === 'ai_approved'
                    ? 'approved_by_ai'
                    : statusFilter;

            const params = new URLSearchParams({
                is_in_production: 'false',
                status: statusParam,
                page: String(pageNum),
                limit: String(PAGE_SIZE),
            });
            const res = await fetch(`/api/offers?${params}`);
            const data = await res.json();
            setOffers(data.offers || []);
            setTotalPages(data.pagination?.totalPages || 1);
        } catch (err) {
            console.error('Failed to fetch queue:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchQueue(1, filter);
    }, []);

    const openReview = (offer) => {
        setSelectedOffer(offer);
        setIsPanelOpen(true);
    };

    const onOfferUpdate = (updated) => {
        setOffers(prev => prev.map(o => o.id === updated.id ? updated : o));
        if (updated.isInProduction || updated.reviewStatus === 'rejected') {
            setOffers(prev => prev.filter(o => o.id !== updated.id));
        }
    };

    const handleFilterChange = (newFilter) => {
        setFilter(newFilter);
        setPage(1);
        fetchQueue(1, newFilter);
    };

    const handlePageChange = (newPage) => {
        setPage(newPage);
        fetchQueue(newPage, filter);
    };

    // Server already filtered by status, no client-side re-filter needed
    const filteredOffers = offers;

    return (
        <div className="space-y-8 animate-fade-in min-h-screen bg-[#020617] p-8">

            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                    <h1 className="text-3xl font-black text-white tracking-tight flex items-center gap-3">
                        <ShieldCheck className="text-sky-400" size={32} />
                        Ingestion Queue
                    </h1>
                    <p className="text-slate-400 mt-2 font-medium">Level 6 Publishing Portal — Review and push AI-validated offers to production.</p>
                    <div className="mt-4 max-w-3xl rounded-xl border border-white/10 bg-slate-900/40 p-4 text-xs text-slate-400 leading-relaxed">
                        <p className="font-bold text-slate-300 mb-2">Review statuses</p>
                        <ul className="list-disc list-inside space-y-1">
                            <li><span className="text-slate-200">pending</span> — Awaiting validation or not yet processed.</li>
                            <li><span className="text-amber-400">flagged</span> — Issues detected; hidden from the public app until corrected and published.</li>
                            <li><span className="text-emerald-400">approved_by_ai</span> — Passed automated validation; still require your publish action for production.</li>
                            <li><span className="text-sky-400">approved</span> — Human-approved; with <strong className="text-slate-200">in production</strong> enabled, visible on the public API.</li>
                            <li><span className="text-rose-400">rejected</span> — Excluded from production.</li>
                        </ul>
                        <p className="mt-2 text-slate-500">The public app only lists offers that are <strong className="text-slate-400">active</strong>, <strong className="text-slate-400">in production</strong>, and <strong className="text-slate-400">approved</strong> or <strong className="text-slate-400">approved_by_ai</strong>.</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex bg-slate-900/50 p-1 rounded-xl border border-white/5">
                        <button
                            onClick={() => handleFilterChange('all')}
                            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${filter === 'all' ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/20' : 'text-slate-400 hover:text-slate-200'}`}
                        >
                            All
                        </button>
                        <button
                            onClick={() => handleFilterChange('flagged')}
                            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${filter === 'flagged' ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20' : 'text-slate-400 hover:text-slate-200'}`}
                        >
                            Flagged
                        </button>
                        <button
                            onClick={() => handleFilterChange('ai_approved')}
                            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${filter === 'ai_approved' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'text-slate-400 hover:text-slate-200'}`}
                        >
                            AI Approved
                        </button>
                        <button
                            onClick={() => handleFilterChange('pending')}
                            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${filter === 'pending' ? 'bg-slate-500 text-white shadow-lg shadow-slate-500/20' : 'text-slate-400 hover:text-slate-200'}`}
                        >
                            Pending
                        </button>
                    </div>

                    <button
                        onClick={fetchQueue}
                        className="p-3 bg-slate-800 hover:bg-slate-700 rounded-xl border border-white/10 text-slate-300 transition-all hover:rotate-180 duration-500"
                    >
                        <RefreshCw size={18} />
                    </button>
                </div>
            </div>

            {/* Grid of Offers */}
            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[1, 2, 3, 4, 5, 6].map(i => (
                        <div key={i} className="glass-card h-64 animate-pulse bg-white/5" />
                    ))}
                </div>
            ) : filteredOffers.length === 0 ? (
                <div className="glass-card p-20 text-center space-y-4">
                    <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto">
                        <CheckCircle2 className="text-emerald-500" size={40} />
                    </div>
                    <h3 className="text-xl font-bold text-white">Queue Clear!</h3>
                    <p className="text-slate-400 max-w-xs mx-auto">No pending offers require your attention. New scrapes will appear here automatically.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredOffers.map(offer => (
                        <div
                            key={offer.id}
                            onClick={() => openReview(offer)}
                            className="interactive-glass p-6 group space-y-4"
                        >
                            <div className="flex justify-between items-start">
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-black px-2 py-0.5 rounded bg-sky-500/20 text-sky-400 border border-sky-500/10 uppercase tracking-tighter">
                                        {offer.source}
                                    </span>
                                    {offer.reviewStatus === 'approved_by_ai' && (
                                        <Sparkles size={14} className="text-emerald-400" />
                                    )}
                                </div>
                                <div className={`p-1.5 rounded-lg border ${offer.reviewStatus === 'flagged' ? 'bg-amber-500/10 border-amber-500/20 text-amber-500' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500'
                                    }`}>
                                    {offer.reviewStatus === 'flagged' ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
                                </div>
                            </div>

                            <div>
                                <h3 className="text-white font-bold text-lg leading-tight group-hover:text-sky-400 transition-colors line-clamp-2">
                                    {offer.title}
                                </h3>
                                <p className="text-slate-400 text-xs mt-2 font-medium flex items-center gap-1">
                                    <Globe size={12} className="text-slate-500" />
                                    {offer.merchantName || 'Multiple Merchants'}
                                </p>
                            </div>

                            <div className="pt-4 border-t border-white/5 flex items-center justify-between">
                                <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                                    Valid until {offer.validTo ? new Date(offer.validTo).toLocaleDateString() : 'N/A'}
                                </div>
                                <div className="flex -space-x-2">
                                    {/* Mock avatars or indicators */}
                                    <div className="w-6 h-6 rounded-full bg-slate-700 border-2 border-[#020617] flex items-center justify-center text-[8px] font-bold text-white">AI</div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 pt-4">
                    <button
                        onClick={() => handlePageChange(page - 1)}
                        disabled={page <= 1 || loading}
                        className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs font-bold disabled:opacity-40 hover:bg-slate-700 transition-all border border-white/5"
                    >
                        Previous
                    </button>
                    <span className="text-slate-400 text-xs font-medium">
                        Page {page} of {totalPages}
                    </span>
                    <button
                        onClick={() => handlePageChange(page + 1)}
                        disabled={page >= totalPages || loading}
                        className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs font-bold disabled:opacity-40 hover:bg-slate-700 transition-all border border-white/5"
                    >
                        Next
                    </button>
                </div>
            )}

            {/* Detail Overlay Panel */}
            <OfferReviewPanel
                offer={selectedOffer}
                isOpen={isPanelOpen}
                onClose={() => setIsPanelOpen(false)}
                onUpdate={onOfferUpdate}
            />
        </div>
    );
}
