
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
    LayoutDashboard,
    Tag,
    Trash2,
    Activity,
    MessageSquare,
    Search,
    Map as MapIcon,
    Settings,
    ShieldCheck,
    Workflow
} from 'lucide-react';

export default function AdminLayout({ children }) {
    const pathname = usePathname();

    const navItems = [
        { name: 'Dashboard', href: '/admin', icon: LayoutDashboard },
        { name: 'Ingestion Queue', href: '/admin/queue', icon: ShieldCheck, highlight: true },
        { name: 'All Offers', href: '/admin/offers', icon: Tag },
        { name: 'Cleanup', href: '/admin/cleanup', icon: Trash2 },
        { name: 'Health', href: '/admin/health', icon: Activity },
        { name: 'AI Chat', href: '/admin/chat', icon: MessageSquare },
        { name: 'Scrapers', href: '/admin/scrapers', icon: Workflow },
        { name: 'Map View', href: '/admin/map', icon: MapIcon },
        { name: 'Settings', href: '/admin/settings', icon: Settings },
    ];

    return (
        <div className="flex h-screen bg-[#020617] text-slate-300">
            {/* Sidebar */}
            <aside className="w-72 bg-[#0a0f1e] border-r border-white/5 flex flex-col z-50">
                <div className="p-8 border-b border-white/5 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-sky-500/20 flex items-center justify-center border border-sky-500/30">
                        <ShieldCheck className="text-sky-400" size={18} />
                    </div>
                    <h1 className="text-lg font-black text-white tracking-tight uppercase">
                        NDB <span className="text-sky-500">Admin</span>
                    </h1>
                </div>

                <nav className="flex-1 p-6 space-y-2 overflow-y-auto custom-scrollbar">
                    {navItems.map((item) => {
                        const isActive = pathname === item.href;
                        const Icon = item.icon;

                        return (
                            <Link
                                key={item.name}
                                href={item.href}
                                className={`flex items-center gap-4 px-4 py-3 text-sm font-bold rounded-xl transition-all group ${isActive
                                        ? 'bg-sky-500 text-white shadow-xl shadow-sky-500/20 border border-sky-400/20'
                                        : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                                    } ${item.highlight && !isActive ? 'text-emerald-400' : ''}`}
                            >
                                <Icon size={20} className={isActive ? 'text-white' : 'group-hover:text-slate-200'} />
                                {item.name}
                                {item.highlight && !isActive && (
                                    <div className="ml-auto w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                                )}
                            </Link>
                        );
                    })}
                </nav>

                <div className="p-8 border-t border-white/5">
                    <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/5 border border-white/5">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-sky-400 to-emerald-400 p-[1px]">
                            <div className="w-full h-full rounded-full bg-[#0a0f1e] flex items-center justify-center text-[10px] font-bold text-sky-400">ADM</div>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-xs font-bold text-white leading-none">Administrator</span>
                            <span className="text-[10px] text-slate-500 font-bold uppercase mt-1">Level 6 Root</span>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-auto bg-[#020617] relative">
                {/* Background Glow */}
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-sky-500/5 rounded-full blur-[120px] pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-emerald-500/5 rounded-full blur-[100px] pointer-events-none" />

                <div className="relative z-10 h-full">
                    {children}
                </div>
            </main>
        </div>
    );
}
