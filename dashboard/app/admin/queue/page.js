'use client';

import React, { useState, useEffect } from 'react';
import { Search, Filter, RefreshCw, Zap, AlertCircle, CheckCircle2, MoreVertical, Edit3, Globe, ShieldCheck } from 'lucide-react';
import OfferReviewPanel from '@/components/Admin/OfferReviewPanel';

export default function IngestionQueue() {
    const [offers, setOffers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedOffer, setSelectedOffer] = useState(null);
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [filter, setFilter] = useState('all'); // all, flagged, ai_approved

    const fetchQueue = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/offers?is_in_production=false&limit=100');
            const data = await res.json();
            setOffers(data.offers);
        } catch (err) {
            console.error('Failed to fetch queue:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchQueue();
    }, []);

    const openReview = (offer) => {
        setSelectedOffer(offer);
        setIsPanelOpen(true);
    };

    const onOfferUpdate = (updated) => {
        setOffers(prev => prev.map(o => o.id === updated.id ? updated : o));
        // If it was published, we might want to remove it from the queue view eventually
        if (updated.isInProduction) {
            setOffers(prev => prev.filter(o => o.id !== updated.id));
        }
    };

    const filteredOffers = offers.filter(o => {
        if (filter === 'flagged') return o.reviewStatus === 'flagged';
        if (filter === 'ai_approved') return o.reviewStatus === 'approved_by_ai';
        return true;
    });

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
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex bg-slate-900/50 p-1 rounded-xl border border-white/5">
                        <button
                            onClick={() => setFilter('all')}
                            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${filter === 'all' ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/20' : 'text-slate-400 hover:text-slate-200'}`}
                        >
                            All {offers.length}
                        </button>
                        <button
                            onClick={() => setFilter('flagged')}
                            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${filter === 'flagged' ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20' : 'text-slate-400 hover:text-slate-200'}`}
                        >
                            Flagged {offers.filter(o => o.reviewStatus === 'flagged').length}
                        </button>
                        <button
                            onClick={() => setFilter('ai_approved')}
                            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${filter === 'ai_approved' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'text-slate-400 hover:text-slate-200'}`}
                        >
                            AI Approved {offers.filter(o => o.reviewStatus === 'approved_by_ai').length}
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
