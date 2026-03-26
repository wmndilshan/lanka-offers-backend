'use client';

import React, { useState, useEffect } from 'react';
import { X, Check, AlertCircle, Info, ExternalLink, ArrowRight, Save, Trash2, Zap, Shield, Sparkles } from 'lucide-react';

export default function OfferReviewPanel({ offer, isOpen, onClose, onUpdate }) {
    const [editedOffer, setEditedOffer] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [activeTab, setActiveTab] = useState('review'); // review, raw, history

    useEffect(() => {
        if (offer) {
            setEditedOffer({ ...offer });
        }
    }, [offer]);

    if (!isOpen || !editedOffer) return null;

    const handleInputChange = (field, value) => {
        setEditedOffer(prev => ({ ...prev, [field]: value }));
    };

    const saveOffer = async (publish = false) => {
        setIsSaving(true);
        try {
            const payload = {
                ...editedOffer,
                reviewStatus: publish ? 'approved' : editedOffer.reviewStatus,
                isInProduction: publish ? true : editedOffer.isInProduction,
            };

            const res = await fetch(`/api/offers/${offer.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!res.ok) throw new Error('Failed to save');

            const updated = await res.json();
            onUpdate(updated);
            if (publish) onClose();
        } catch (err) {
            alert('Error saving offer: ' + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'approved': return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
            case 'approved_by_ai': return 'text-blue-400 bg-blue-400/10 border-blue-400/20';
            case 'flagged': return 'text-amber-400 bg-amber-400/10 border-amber-400/20';
            case 'rejected': return 'text-red-400 bg-red-400/10 border-red-400/20';
            default: return 'text-slate-400 bg-slate-400/10 border-slate-400/20';
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex justify-end">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm transition-opacity"
                onClick={onClose}
            />

            {/* Panel */}
            <div className="relative w-full max-w-2xl h-full midnight-surface border-l border-white/10 shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">

                {/* Header */}
                <div className="p-6 border-b border-white/10 flex items-center justify-between glass-card rounded-none">
                    <div className="flex items-center gap-4">
                        <div className={`px-3 py-1 rounded-full text-xs font-bold border ${getStatusColor(editedOffer.reviewStatus)} flex items-center gap-1.5`}>
                            <div className={`w-1.5 h-1.5 rounded-full bg-current`} />
                            {editedOffer.reviewStatus?.replace(/_/g, ' ').toUpperCase()}
                        </div>
                        <h2 className="text-xl font-bold tracking-tight truncate max-w-[300px]" title={editedOffer.title}>
                            {editedOffer.title}
                        </h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-white/10 rounded-full transition-colors"
                    >
                        <X size={20} className="text-slate-400" />
                    </button>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">

                    {/* AI Insights Banner */}
                    {editedOffer.reviewStatus === 'flagged' && (
                        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex gap-4 animate-pulse">
                            <AlertCircle className="text-amber-500 shrink-0" size={24} />
                            <div>
                                <h4 className="font-bold text-amber-500 text-sm">Action Required: AI Flag</h4>
                                <p className="text-xs text-amber-200/80 mt-1">Discrepancies found between raw text and structured data. Merchant name or card eligibility may need manual correction.</p>
                            </div>
                        </div>
                    )}

                    {/* Quick Stats Grid */}
                    <div className="grid grid-cols-3 gap-4">
                        <div className="glass-card p-4 text-center">
                            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">Source</div>
                            <div className="text-sm font-bold text-sky-400">{editedOffer.source}</div>
                        </div>
                        <div className="glass-card p-4 text-center">
                            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">Deduplication</div>
                            <div className="text-sm font-bold text-emerald-400">Match Found</div>
                        </div>
                        <div className="glass-card p-4 text-center">
                            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">Scraped</div>
                            <div className="text-sm font-bold text-slate-300">
                                {new Date(editedOffer.scrapedAt).toLocaleDateString()}
                            </div>
                        </div>
                    </div>

                    {/* Form Groups */}
                    <div className="space-y-6">
                        <div className="space-y-2">
                            <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold ml-1">Merchant Name</label>
                            <input
                                value={editedOffer.merchantName || ''}
                                onChange={(e) => handleInputChange('merchantName', e.target.value)}
                                className="glass-input w-full text-base font-medium"
                                placeholder="Ex: HNB Bank, Amaya Lake..."
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold ml-1">Offer Title</label>
                            <textarea
                                value={editedOffer.title || ''}
                                onChange={(e) => handleInputChange('title', e.target.value)}
                                className="glass-input w-full min-h-[80px] text-base leading-relaxed"
                                placeholder="Ex: 20% off for HNB Cards..."
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold ml-1">Category</label>
                                <select
                                    value={editedOffer.category || ''}
                                    onChange={(e) => handleInputChange('category', e.target.value)}
                                    className="glass-input w-full appearance-none cursor-pointer"
                                >
                                    <option value="Dining">Dining</option>
                                    <option value="Travel">Travel</option>
                                    <option value="Lifestyle">Lifestyle</option>
                                    <option value="Hotel">Hotel</option>
                                    <option value="Shopping">Shopping</option>
                                    <option value="Health">Health</option>
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold ml-1">Discount %</label>
                                <input
                                    type="number"
                                    value={editedOffer.discountPercentage || ''}
                                    onChange={(e) => handleInputChange('discountPercentage', e.target.value)}
                                    className="glass-input w-full text-sky-400 font-bold text-lg"
                                    placeholder="20"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold ml-1">Valid From</label>
                                <input
                                    type="date"
                                    value={editedOffer.validFrom ? editedOffer.validFrom.split('T')[0] : ''}
                                    onChange={(e) => handleInputChange('validFrom', e.target.value)}
                                    className="glass-input w-full text-sm"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold ml-1">Valid To</label>
                                <input
                                    type="date"
                                    value={editedOffer.validTo ? editedOffer.validTo.split('T')[0] : ''}
                                    onChange={(e) => handleInputChange('validTo', e.target.value)}
                                    className="glass-input w-full text-sm"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold ml-1">Card Eligibility</label>
                            <input
                                value={editedOffer.cardType || ''}
                                onChange={(e) => handleInputChange('cardType', e.target.value)}
                                className="glass-input w-full text-sm"
                                placeholder="Visa Infinite, Mastercard..."
                            />
                        </div>
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="p-8 glass-card rounded-none border-t border-white/10 grid grid-cols-2 gap-4">
                    <button
                        disabled={isSaving}
                        onClick={() => saveOffer(false)}
                        className="flex items-center justify-center gap-2 py-4 rounded-xl bg-slate-800 text-slate-200 font-bold hover:bg-slate-700 transition-all border border-white/5"
                    >
                        <Save size={18} />
                        Keep in Queue
                    </button>
                    <button
                        disabled={isSaving}
                        onClick={() => saveOffer(true)}
                        className="btn-premium-emerald py-4"
                    >
                        {isSaving ? (
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                            <>
                                <Zap size={18} fill="currentColor" />
                                Approve & Publish
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
