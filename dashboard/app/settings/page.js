'use client';

import { useState } from 'react';
import { Cog, Globe, Bell, Database, Shield, Save, RefreshCw, ExternalLink } from 'lucide-react';

const TABS = [
    { id: 'scraper', label: 'Scraper', icon: <Cog size={15} /> },
    { id: 'geocoding', label: 'Geocoding', icon: <Globe size={15} /> },
    { id: 'notifs', label: 'Notifications', icon: <Bell size={15} /> },
    { id: 'defaults', label: 'Offer Defaults', icon: <Database size={15} /> },
    { id: 'users', label: 'Users', icon: <Shield size={15} /> },
];

const DEFAULT = {
    scraper: { schedule: '0 2 * * *', timeout: 30, maxRetries: 3, globalEnabled: true },
    geocoding: { endpoint: 'https://nominatim.openstreetmap.org', googleKey: '', country: 'Sri Lanka' },
    notifs: { email: '', slack: '', emailEnabled: true },
    defaults: { deactivateDays: 7, defaultImage: '' },
};

export default function SettingsPage() {
    const [tab, setTab] = useState('scraper');
    const [settings, setSettings] = useState(DEFAULT);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    const set = (section, key, val) => {
        setSettings(p => ({ ...p, [section]: { ...p[section], [key]: val } }));
        setSaved(false);
    };

    const handleSave = async () => {
        setSaving(true);
        localStorage.setItem('lo_settings', JSON.stringify(settings));
        await new Promise(r => setTimeout(r, 400));
        setSaving(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
    };

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">Settings</h1>
                <p className="page-desc">System configuration and preferences</p>
            </div>

            <div className="flex gap-6">
                {/* Tab nav */}
                <div className="w-48 shrink-0">
                    <div className="card overflow-hidden">
                        {TABS.map(t => (
                            <button key={t.id} onClick={() => setTab(t.id)}
                                className={`w-full flex items-center gap-2.5 px-4 py-3 text-sm transition-colors text-left ${tab === t.id
                                        ? 'bg-indigo-50 text-indigo-700 font-semibold border-r-2 border-indigo-500'
                                        : 'text-slate-600 hover:bg-slate-50'
                                    }`}>
                                {t.icon} {t.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Panel */}
                <div className="flex-1 card p-6">
                    {tab === 'scraper' && (
                        <Panel title="Scraper Configuration" icon={<Cog size={18} className="text-indigo-500" />}>
                            <Field label="Default Schedule (Cron)" hint="e.g. 0 2 * * * = daily at 2AM">
                                <input type="text" value={settings.scraper.schedule} onChange={e => set('scraper', 'schedule', e.target.value)} className="input font-mono" />
                            </Field>
                            <div className="grid grid-cols-2 gap-4">
                                <Field label="Timeout (seconds)">
                                    <input type="number" value={settings.scraper.timeout} onChange={e => set('scraper', 'timeout', +e.target.value)} className="input" />
                                </Field>
                                <Field label="Max Retries">
                                    <input type="number" value={settings.scraper.maxRetries} onChange={e => set('scraper', 'maxRetries', +e.target.value)} className="input" />
                                </Field>
                            </div>
                            <Field label="Global Scrapers Enabled">
                                <Toggle value={settings.scraper.globalEnabled} onChange={v => set('scraper', 'globalEnabled', v)} />
                            </Field>
                        </Panel>
                    )}

                    {tab === 'geocoding' && (
                        <Panel title="Geocoding Configuration" icon={<Globe size={18} className="text-indigo-500" />}>
                            <Field label="Nominatim Endpoint">
                                <input type="url" value={settings.geocoding.endpoint} onChange={e => set('geocoding', 'endpoint', e.target.value)} className="input" />
                            </Field>
                            <Field label="Google Maps API Key" hint="Optional — fallback for Nominatim failures">
                                <input type="text" placeholder="AIza…" value={settings.geocoding.googleKey} onChange={e => set('geocoding', 'googleKey', e.target.value)} className="input font-mono" />
                            </Field>
                            <Field label="Default Country">
                                <input type="text" value={settings.geocoding.country} onChange={e => set('geocoding', 'country', e.target.value)} className="input w-48" />
                            </Field>
                        </Panel>
                    )}

                    {tab === 'notifs' && (
                        <Panel title="Notification Settings" icon={<Bell size={18} className="text-indigo-500" />}>
                            <Field label="Admin Email">
                                <input type="email" placeholder="admin@example.com" value={settings.notifs.email} onChange={e => set('notifs', 'email', e.target.value)} className="input" />
                            </Field>
                            <Field label="Slack Webhook URL" hint="Optional">
                                <input type="url" placeholder="https://hooks.slack.com/…" value={settings.notifs.slack} onChange={e => set('notifs', 'slack', e.target.value)} className="input" />
                            </Field>
                            <Field label="Email Alerts Enabled">
                                <Toggle value={settings.notifs.emailEnabled} onChange={v => set('notifs', 'emailEnabled', v)} />
                            </Field>
                        </Panel>
                    )}

                    {tab === 'defaults' && (
                        <Panel title="Offer Defaults" icon={<Database size={18} className="text-indigo-500" />}>
                            <Field label="Auto-deactivate offers after expiry (days)">
                                <input type="number" value={settings.defaults.deactivateDays} onChange={e => set('defaults', 'deactivateDays', +e.target.value)} className="input w-32" />
                            </Field>
                            <Field label="Default Image URL" hint="Shown when merchant has no image">
                                <input type="url" placeholder="https://…" value={settings.defaults.defaultImage} onChange={e => set('defaults', 'defaultImage', e.target.value)} className="input" />
                            </Field>
                        </Panel>
                    )}

                    {tab === 'users' && (
                        <Panel title="Admin Users" icon={<Shield size={18} className="text-indigo-500" />}>
                            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                                <Shield size={32} className="mx-auto mb-3 text-slate-300" />
                                <p className="font-medium text-slate-600 text-sm">User management coming in Phase 1b</p>
                                <p className="text-xs text-slate-400 mt-1">Manage DB credentials via your Neon console for now</p>
                                <a href="https://console.neon.tech" target="_blank" rel="noopener noreferrer"
                                    className="mt-4 inline-flex items-center gap-1.5 btn btn-secondary text-xs">
                                    <ExternalLink size={12} /> Open Neon Console
                                </a>
                            </div>
                        </Panel>
                    )}

                    {/* Save */}
                    <div className="flex items-center gap-3 mt-6 pt-5 border-t border-slate-100">
                        <button onClick={handleSave} disabled={saving} className="btn btn-primary">
                            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                            {saving ? 'Saving…' : 'Save Settings'}
                        </button>
                        {saved && <span className="text-sm text-emerald-600 font-medium">✓ Saved</span>}
                    </div>
                </div>
            </div>
        </div>
    );
}

function Panel({ title, icon, children }) {
    return (
        <div>
            <div className="flex items-center gap-2 mb-5 pb-4 border-b border-slate-100">
                {icon}
                <h3 className="text-base font-semibold text-slate-900">{title}</h3>
            </div>
            <div className="space-y-5">{children}</div>
        </div>
    );
}

function Field({ label, hint, children }) {
    return (
        <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">{label}</label>
            {children}
            {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
        </div>
    );
}

function Toggle({ value, onChange }) {
    return (
        <button type="button" onClick={() => onChange(!value)}
            className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${value ? 'bg-indigo-500' : 'bg-slate-200'}`}>
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all duration-200 ${value ? 'left-6' : 'left-1'}`} />
        </button>
    );
}
