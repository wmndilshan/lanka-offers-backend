'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
    ArrowLeft, Save, Trash2, ExternalLink, AlertCircle,
    RefreshCw, CheckCircle, ToggleLeft, ToggleRight, Sparkles, ShieldCheck, Zap, Globe, Calendar, Info
} from 'lucide-react';

const CATEGORIES = ['Dining', 'Hotel', 'Lifestyle', 'Shopping', 'Travel', 'Health', 'Groceries', 'Fashion', 'Electronics', 'Entertainment', 'Fuel', 'Other'];

export default function OfferEditPage({ params }) {
    const router = useRouter();
    const { id } = params;
    const isNew = id === 'new';

    const [offer, setOffer] = useState(null);
    const [form, setForm] = useState(null);
    const [loading, setLoading] = useState(!isNew);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [validation, setValidation] = useState(null);
    const [validationLoading, setValidationLoading] = useState(false);

    useEffect(() => {
        if (isNew) {
            setForm({
                title: '', description: '', merchantName: '', category: 'Dining', cardType: 'credit',
                discountPercentage: '', discountDescription: '', source: 'HNB',
                validFrom: '', validTo: '', applicableCards: [], reviewStatus: 'pending',
                bookingRequired: false, isInProduction: false
            });
            return;
        }
        fetchOffer();
    }, [id]);

    const fetchOffer = async () => {
        try {
            const res = await fetch(`/api/offers/${id}`);
            if (!res.ok) throw new Error('Offer not found');
            const data = await res.json();
            setOffer(data);
            setForm({
                ...data,
                validFrom: data.validFrom ? data.validFrom.split('T')[0] : '',
                validTo: data.validTo ? data.validTo.split('T')[0] : '',
                applicableCards: data.applicableCards || [],
                discountPercentage: data.discountPercentage ?? '',
            });
            fetchValidation();
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const fetchValidation = async (refresh = false) => {
        if (isNew) return;
        setValidationLoading(true);
        try {
            const res = await fetch(`/api/offers/${id}/validation${refresh ? '?refresh=1' : ''}`);
            const data = await res.json();
            setValidation(data.validation || data.result);
        } catch (e) {
            console.warn('Validation fetch error:', e);
        } finally {
            setValidationLoading(false);
        }
    };

    const set = (key, value) => {
        setForm(prev => ({ ...prev, [key]: value }));
    };

    const handleSave = async (publish = false) => {
        setSaving(true);
        try {
            const payload = {
                ...form,
                reviewStatus: publish ? 'approved' : form.reviewStatus,
                isInProduction: publish ? true : form.isInProduction,
                discountPercentage: form.discountPercentage !== '' ? Number(form.discountPercentage) : null,
                validFrom: form.validFrom || null,
                validTo: form.validTo || null,
                pushedToDbAt: publish ? new Date() : form.pushedToDbAt
            };

            const res = await fetch(isNew ? '/api/offers' : `/api/offers/${id}`, {
                method: isNew ? 'POST' : 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!res.ok) throw new Error('Save failed');

            if (publish) router.push('/admin/queue');
            else if (isNew) {
                const created = await res.json();
                router.push(`/admin/offers/${created.id}`);
            } else {
                fetchOffer();
            }
        } catch (e) {
            alert('Error: ' + e.message);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!confirm('Move to archive?')) return;
        setDeleting(true);
        try {
            await fetch(`/api/offers/${id}`, { method: 'DELETE' });
            router.push('/admin/offers');
        } catch (e) {
            alert('Delete failed');
            setDeleting(false);
        }
    };

    if (loading) return <div className="h-screen bg-[#020617] flex items-center justify-center"><RefreshCw className="animate-spin text-sky-500" /></div>;

    return (
        <div className="min-h-screen bg-[#020617] p-8 space-y-8 animate-fade-in text-slate-200">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex items-center gap-6">
                    <Link href="/admin/offers" className="p-3 glass-card rounded-xl hover:bg-white/10 transition-colors">
                        <ArrowLeft size={20} className="text-slate-400" />
                    </Link>
                    <div>
                        <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-3">
                            {isNew ? 'New Entry' : 'Refine Offer'}
                            {!isNew && <span className="text-[10px] font-mono text-slate-500 bg-white/5 px-2 py-1 rounded border border-white/5 uppercase tracking-tighter">{offer?.unique_id}</span>}
                        </h1>
                        <p className="text-slate-400 text-sm mt-1 font-medium italic">Level 6 Command Center — Manual Review & Production Push</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => handleSave(false)}
                        disabled={saving}
                        className="btn-premium bg-slate-800 text-white border border-white/5 hover:bg-slate-700"
                    >
                        {saving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
                        Save Draft
                    </button>
                    <button
                        onClick={() => handleSave(true)}
                        disabled={saving}
                        className="btn-premium-emerald group"
                    >
                        <Zap size={18} fill="currentColor" className="group-hover:animate-pulse" />
                        Push to Production
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
                {/* Main Form */}
                <div className="xl:col-span-8 space-y-8">
                    <div className="glass-card p-8 space-y-8">
                        <div className="flex items-center gap-4 border-b border-white/5 pb-4 mb-2">
                            <div className="p-2 bg-sky-500/10 rounded-lg border border-sky-500/20">
                                <ShieldCheck className="text-sky-400" size={20} />
                            </div>
                            <h2 className="text-lg font-bold text-white tracking-tight">Offer Manifest</h2>
                        </div>

                        <div className="space-y-8">
                            <div className="space-y-3">
                                <label className="text-[10px] uppercase tracking-widest text-slate-500 font-black ml-1">Merchant Identity</label>
                                <input
                                    value={form.merchantName || ''}
                                    onChange={e => set('merchantName', e.target.value)}
                                    className="glass-input w-full text-xl font-black text-emerald-400 placeholder:text-slate-800"
                                    placeholder="Ex: Amaya Lake..."
                                />
                            </div>

                            <div className="space-y-3">
                                <label className="text-[10px] uppercase tracking-widest text-slate-500 font-black ml-1">Marketing Headline</label>
                                <textarea
                                    value={form.title || ''}
                                    onChange={e => set('title', e.target.value)}
                                    className="glass-input w-full min-h-[120px] text-lg font-bold leading-relaxed placeholder:text-slate-800"
                                    placeholder="The primary hook for the user..."
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-8">
                                <div className="space-y-3">
                                    <label className="text-[10px] uppercase tracking-widest text-slate-500 font-black ml-1">Core Categorization</label>
                                    <select value={form.category} onChange={e => set('category', e.target.value)} className="glass-input w-full appearance-none cursor-pointer font-bold uppercase tracking-widest text-xs">
                                        {CATEGORIES.map(c => <option key={c} value={c} className="bg-slate-900">{c}</option>)}
                                    </select>
                                </div>
                                <div className="space-y-3">
                                    <label className="text-[10px] uppercase tracking-widest text-slate-500 font-black ml-1">Discount Payload (%)</label>
                                    <input
                                        type="number"
                                        value={form.discountPercentage ?? ''}
                                        onChange={e => set('discountPercentage', e.target.value)}
                                        className="glass-input w-full text-sky-400 font-black text-2xl text-center"
                                        placeholder="0"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="glass-card p-8 bg-white/[0.01]">
                        <div className="flex items-center gap-4 border-b border-white/5 pb-4 mb-6">
                            <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                                <Calendar className="text-emerald-400" size={20} />
                            </div>
                            <h2 className="text-lg font-bold text-white tracking-tight">Timeline Architecture</h2>
                        </div>
                        <div className="grid grid-cols-2 gap-8">
                            <div className="space-y-3">
                                <label className="text-[10px] uppercase tracking-widest text-slate-500 font-black ml-1">Activation Gate</label>
                                <input type="date" value={form.validFrom} onChange={e => set('validFrom', e.target.value)} className="glass-input w-full font-bold uppercase" />
                            </div>
                            <div className="space-y-3">
                                <label className="text-[10px] uppercase tracking-widest text-slate-500 font-black ml-1">Expiration Gate</label>
                                <input type="date" value={form.validTo} onChange={e => set('validTo', e.target.value)} className="glass-input w-full font-bold uppercase" />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Sidebar Intelligence */}
                <div className="xl:col-span-4 space-y-8">
                    <div className="glass-card p-6 bg-sky-500/5 relative overflow-hidden group">
                        <div className="absolute -right-4 -top-4 w-20 h-20 bg-sky-500/10 rounded-full blur-2xl group-hover:bg-sky-500/20 transition-all" />

                        <div className="flex items-center gap-3 mb-6">
                            <Sparkles className="text-sky-400 animate-pulse" size={20} />
                            <h3 className="text-[10px] font-black text-white uppercase tracking-[0.2em]">Artificial Intelligence</h3>
                        </div>

                        {validationLoading ? (
                            <div className="py-12 flex flex-col items-center justify-center gap-4 text-slate-500">
                                <RefreshCw className="animate-spin text-sky-500" size={32} />
                                <span className="text-[10px] font-black uppercase tracking-[0.3em] animate-pulse">Scanning Data...</span>
                            </div>
                        ) : validation?.issues?.length > 0 ? (
                            <div className="space-y-4">
                                <div className="text-[10px] text-amber-500 font-black uppercase tracking-widest mb-2 flex items-center gap-2">
                                    <AlertCircle size={10} /> Discrepancies Found
                                </div>
                                {validation.issues.map((issue, i) => (
                                    <div key={i} className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-2xl text-xs text-amber-200/90 leading-relaxed font-medium">
                                        {issue}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="p-6 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl flex flex-col items-center text-center gap-4">
                                <div className="w-12 h-12 bg-emerald-500/10 rounded-full flex items-center justify-center border border-emerald-500/20">
                                    <CheckCircle size={24} className="text-emerald-500" />
                                </div>
                                <div className="space-y-1">
                                    <h4 className="text-xs font-black text-emerald-400 uppercase tracking-widest">Integrity Verified</h4>
                                    <p className="text-[10px] text-slate-500 font-medium">No structural drift detected from raw source.</p>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="glass-card p-6">
                        <div className="flex items-center gap-3 mb-6 border-b border-white/5 pb-4">
                            <Globe className="text-sky-400" size={18} />
                            <h3 className="text-[10px] font-black text-white uppercase tracking-[0.2em]">Platform Context</h3>
                        </div>
                        <div className="space-y-5">
                            <div className="flex justify-between items-center bg-white/2 p-3 rounded-xl border border-white/5">
                                <span className="text-[9px] text-slate-500 font-black uppercase tracking-widest">Source Entity</span>
                                <span className="text-sky-400 font-black text-xs uppercase">{form.source}</span>
                            </div>
                            <div className="flex justify-between items-center bg-white/2 p-3 rounded-xl border border-white/5">
                                <span className="text-[9px] text-slate-500 font-black uppercase tracking-widest">Lifecycle</span>
                                <span className={`text-[10px] font-black uppercase p-1 px-2 rounded ${form.reviewStatus === 'approved' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                                    }`}>
                                    {form.reviewStatus?.replace(/_/g, ' ')}
                                </span>
                            </div>
                            <div className="flex justify-between items-center bg-white/2 p-3 rounded-xl border border-white/5">
                                <span className="text-[9px] text-slate-500 font-black uppercase tracking-widest">Production Ready</span>
                                <span className={`text-[10px] font-black uppercase ${form.isInProduction ? 'text-emerald-400' : 'text-slate-700'}`}>
                                    {form.isInProduction ? 'Active' : 'Offline'}
                                </span>
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={handleDelete}
                        disabled={deleting}
                        className="w-full py-4 glass-card border-rose-500/20 bg-rose-500/5 text-rose-500 font-black uppercase tracking-[0.2em] text-[10px] hover:bg-rose-500/10 transition-all flex items-center justify-center gap-3"
                    >
                        {deleting ? <RefreshCw className="animate-spin" size={14} /> : <Trash2 size={14} />}
                        Permanent Archive
                    </button>
                </div>
            </div>
        </div>
    );
}
