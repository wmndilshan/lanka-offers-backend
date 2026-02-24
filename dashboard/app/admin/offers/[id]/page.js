'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
    ArrowLeft, Save, Trash2, ExternalLink, AlertCircle,
    RefreshCw, CheckCircle, ToggleLeft, ToggleRight
} from 'lucide-react';

const BANKS = ['HNB', 'BOC', 'NDB', 'Sampath', 'Pan Asia', 'Seylan', 'DFCC', "People's Bank"];
const CATEGORIES = ['Dining', 'Hotel', 'Lifestyle', 'Shopping', 'Travel', 'Health', 'Groceries', 'Fashion', 'Electronics', 'Entertainment', 'Fuel', 'Other'];
const DISCOUNT_TYPES = ['percentage', 'flat', 'bogo'];
const CARD_TYPES = ['Visa', 'Mastercard', 'Amex', 'Credit', 'Debit', 'HNB Cards', 'BOC Cards', 'NDB Cards', 'Sampath Cards', 'Seylan Cards'];

export default function OfferEditPage({ params }) {
    const router = useRouter();
    const { id } = params;
    const isNew = id === 'new';

    const [offer, setOffer] = useState(null);
    const [form, setForm] = useState(null);
    const [loading, setLoading] = useState(!isNew);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [saved, setSaved] = useState(false);
    const [errors, setErrors] = useState({});

    useEffect(() => {
        if (isNew) {
            const blank = {
                title: '', description: '', merchantName: '', category: '', cardType: 'credit',
                discountPercentage: '', discountDescription: '', source: 'HNB',
                validFrom: '', validTo: '', applicableCards: [], reviewStatus: 'pending',
                bookingRequired: false,
            };
            setForm(blank);
            return;
        }
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
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        fetchOffer();
    }, [id]);

    const set = (key, value) => {
        setForm(prev => ({ ...prev, [key]: value }));
        setErrors(prev => ({ ...prev, [key]: undefined }));
        setSaved(false);
    };

    const toggleCard = (card) => {
        const cards = form.applicableCards || [];
        set('applicableCards', cards.includes(card) ? cards.filter(c => c !== card) : [...cards, card]);
    };

    const validate = () => {
        const errs = {};
        if (!form.title?.trim()) errs.title = 'Title is required';
        if (!form.merchantName?.trim()) errs.merchantName = 'Merchant name is required';
        if (form.discountPercentage !== '' && (Number(form.discountPercentage) < 0 || Number(form.discountPercentage) > 100))
            errs.discountPercentage = 'Discount must be 0–100%';
        if (form.validFrom && form.validTo && form.validTo < form.validFrom)
            errs.validTo = 'Valid Until must be after Valid From';
        setErrors(errs);
        return Object.keys(errs).length === 0;
    };

    const handleSave = async () => {
        if (!validate()) return;
        setSaving(true);
        try {
            const method = isNew ? 'POST' : 'PUT';
            const url = isNew ? '/api/offers' : `/api/offers/${id}`;
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...form,
                    discountPercentage: form.discountPercentage !== '' ? Number(form.discountPercentage) : null,
                    validFrom: form.validFrom || null,
                    validTo: form.validTo || null,
                }),
            });
            if (!res.ok) throw new Error(await res.text());
            setSaved(true);
            if (isNew) {
                const created = await res.json();
                router.push(`/admin/offers/${created.id}`);
            }
        } catch (e) {
            alert('Save failed: ' + e.message);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!confirm('Delete this offer permanently? This cannot be undone.')) return;
        setDeleting(true);
        try {
            const res = await fetch(`/api/offers/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Delete failed');
            router.push('/admin/offers');
        } catch (e) {
            alert('Delete failed: ' + e.message);
            setDeleting(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full" />
            </div>
        );
    }

    if (!form) {
        return <div className="text-center py-20 text-slate-500">Offer not found</div>;
    }

    return (
        <div className="space-y-6 max-w-4xl">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Link href="/admin/offers" className="p-2 rounded-md hover:bg-slate-100 text-slate-500 transition-colors">
                        <ArrowLeft size={18} />
                    </Link>
                    <div>
                        <h1 className="text-xl font-semibold text-slate-900">
                            {isNew ? 'New Offer' : 'Edit Offer'}
                        </h1>
                        {!isNew && <p className="text-xs text-slate-400 font-mono mt-0.5">{id}</p>}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {!isNew && (
                        <button
                            onClick={handleDelete}
                            disabled={deleting}
                            className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 border border-red-200 rounded-md hover:bg-red-50 transition-colors disabled:opacity-50"
                        >
                            {deleting ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                            Delete
                        </button>
                    )}
                    <button
                        onClick={() => router.push('/admin/offers')}
                        className="px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
                    >
                        Discard
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-md hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                    >
                        {saving ? <RefreshCw size={14} className="animate-spin" /> : saved ? <CheckCircle size={14} /> : <Save size={14} />}
                        {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
                    </button>
                </div>
            </div>

            {/* Form */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left column - core details */}
                <div className="lg:col-span-2 space-y-5">
                    <FormSection title="Offer Details">
                        <Field label="Title *" error={errors.title}>
                            <input type="text" value={form.title || ''} onChange={e => set('title', e.target.value)}
                                maxLength={200} placeholder="e.g. 20% off at KFC with HNB credit card"
                                className={`input ${errors.title ? 'border-red-400' : ''}`} />
                        </Field>
                        <Field label="Description">
                            <textarea value={form.description || ''} onChange={e => set('description', e.target.value)}
                                maxLength={1000} rows={4} placeholder="Full offer details..."
                                className="input resize-none" />
                        </Field>
                        <Field label="Merchant Name *" error={errors.merchantName}>
                            <input type="text" value={form.merchantName || ''} onChange={e => set('merchantName', e.target.value)}
                                placeholder="e.g. KFC" className={`input ${errors.merchantName ? 'border-red-400' : ''}`} />
                        </Field>
                        <div className="grid grid-cols-2 gap-4">
                            <Field label="Category">
                                <select value={form.category || ''} onChange={e => set('category', e.target.value)} className="input">
                                    <option value="">Select category</option>
                                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </Field>
                            <Field label="Discount Type">
                                <select value={form.discountType || 'percentage'} onChange={e => set('discountType', e.target.value)} className="input">
                                    {DISCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                            </Field>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <Field label="Discount %" error={errors.discountPercentage}>
                                <input type="number" value={form.discountPercentage ?? ''} onChange={e => set('discountPercentage', e.target.value)}
                                    min={0} max={100} placeholder="e.g. 20"
                                    className={`input ${errors.discountPercentage ? 'border-red-400' : ''}`} />
                            </Field>
                            <Field label="Discount Description">
                                <input type="text" value={form.discountDescription || ''} onChange={e => set('discountDescription', e.target.value)}
                                    placeholder="e.g. 20% off food total" className="input" />
                            </Field>
                        </div>
                    </FormSection>

                    <FormSection title="Validity">
                        <div className="grid grid-cols-2 gap-4">
                            <Field label="Valid From">
                                <input type="date" value={form.validFrom || ''} onChange={e => set('validFrom', e.target.value)} className="input" />
                            </Field>
                            <Field label="Valid Until" error={errors.validTo}>
                                <input type="date" value={form.validTo || ''} onChange={e => set('validTo', e.target.value)}
                                    className={`input ${errors.validTo ? 'border-red-400' : ''}`} />
                            </Field>
                        </div>
                        <Field label="Days Applicable">
                            <input type="text" value={form.daysApplicable || ''} onChange={e => set('daysApplicable', e.target.value)}
                                placeholder="e.g. Monday-Friday, Weekends" className="input" />
                        </Field>
                    </FormSection>

                    <FormSection title="Applicable Cards">
                        <div className="flex flex-wrap gap-2">
                            {CARD_TYPES.map(card => {
                                const active = (form.applicableCards || []).includes(card);
                                return (
                                    <button
                                        key={card}
                                        type="button"
                                        onClick={() => toggleCard(card)}
                                        className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${active ? 'bg-emerald-600 text-white border-emerald-600' : 'border-slate-300 text-slate-600 hover:border-emerald-400'
                                            }`}
                                    >
                                        {card}
                                    </button>
                                );
                            })}
                        </div>
                    </FormSection>
                </div>

                {/* Right column - metadata */}
                <div className="space-y-5">
                    <FormSection title="Source">
                        <Field label="Source Bank">
                            <select value={form.source || 'HNB'} onChange={e => set('source', e.target.value)} className="input">
                                {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                            </select>
                        </Field>
                        <Field label="Card Type">
                            <select value={form.cardType || 'credit'} onChange={e => set('cardType', e.target.value)} className="input">
                                <option value="credit">Credit</option>
                                <option value="debit">Debit</option>
                                <option value="prepaid">Prepaid</option>
                                <option value="any">Any</option>
                            </select>
                        </Field>
                    </FormSection>

                    <FormSection title="Status">
                        <Field label="Review Status">
                            <select value={form.reviewStatus || 'pending'} onChange={e => set('reviewStatus', e.target.value)} className="input">
                                <option value="pending">Pending Review</option>
                                <option value="approved">Approved (Active)</option>
                                <option value="rejected">Rejected (Inactive)</option>
                            </select>
                        </Field>
                        <Field label="Booking Required">
                            <Toggle value={form.bookingRequired} onChange={v => set('bookingRequired', v)} />
                        </Field>
                    </FormSection>

                    <FormSection title="Admin Notes">
                        <textarea value={form.editNotes || ''} onChange={e => set('editNotes', e.target.value)}
                            rows={3} placeholder="Internal notes..."
                            className="input resize-none w-full" />
                    </FormSection>

                    {/* Source link */}
                    {offer?.rawData && (
                        <FormSection title="Source Data">
                            <p className="text-xs text-slate-500">Scraped at: {offer.scrapedAt ? new Date(offer.scrapedAt).toLocaleString() : 'N/A'}</p>
                            <p className="text-xs text-slate-500">ID: <span className="font-mono">{offer.unique_id}</span></p>
                        </FormSection>
                    )}
                </div>
            </div>

            <style jsx>{`
        .input {
          width: 100%;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          padding: 8px 12px;
          font-size: 14px;
          outline: none;
          transition: box-shadow 0.15s;
          background: white;
        }
        .input:focus {
          box-shadow: 0 0 0 2px #10b981;
          border-color: transparent;
        }
      `}</style>
        </div>
    );
}

function FormSection({ title, children }) {
    return (
        <div className="bg-white rounded-lg border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-4 pb-3 border-b border-slate-100">{title}</h3>
            <div className="space-y-4">{children}</div>
        </div>
    );
}

function Field({ label, hint, error, children }) {
    return (
        <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">{label}</label>
            {children}
            {error && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={11} />{error}</p>}
            {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
        </div>
    );
}

function Toggle({ value, onChange }) {
    return (
        <button type="button" onClick={() => onChange(!value)}
            className={`relative w-10 h-6 rounded-full transition-colors ${value ? 'bg-emerald-500' : 'bg-slate-300'}`}>
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${value ? 'left-5' : 'left-1'}`} />
        </button>
    );
}
