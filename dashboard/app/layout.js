'use client';

import './globals.css';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, FileText, MapPin, Activity,
  BarChart3, AlertTriangle, Store, Bot, ShieldCheck, Cog,
  TrendingUp, Bell
} from 'lucide-react';

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <title>Lanka Offers — Admin</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <div className="flex h-screen" style={{ background: '#f8fafc' }}>
          <Sidebar />
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <TopBar />
            <main className="flex-1 overflow-y-auto px-8 py-6">
              <div className="max-w-7xl mx-auto animate-fade-in">
                {children}
              </div>
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}

const NAV = [
  {
    group: 'Overview',
    links: [
      { href: '/', icon: LayoutDashboard, label: 'Dashboard' },
      { href: '/analytics', icon: BarChart3, label: 'Analytics' },
    ]
  },
  {
    group: 'Content',
    links: [
      { href: '/offers', icon: FileText, label: 'Offers' },
      { href: '/map', icon: MapPin, label: 'Map View' },
      { href: '/merchants', icon: Store, label: 'Merchants' },
    ]
  },
  {
    group: 'Operations',
    links: [
      { href: '/scrapers', icon: Activity, label: 'Scrapers' },
      { href: '/quality', icon: AlertTriangle, label: 'Data Quality' },
    ]
  },
  {
    group: 'System',
    links: [
      { href: '/ai', icon: Bot, label: 'AI Assistant' },
      { href: '/admin', icon: ShieldCheck, label: 'Admin' },
      { href: '/settings', icon: Cog, label: 'Settings' },
    ]
  }
];

function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="w-60 flex flex-col shrink-0 border-r"
      style={{
        background: '#ffffff',
        borderColor: '#e2e8f0',
        boxShadow: '1px 0 0 #f1f5f9',
      }}
    >
      {/* Logo */}
      <div className="h-16 flex items-center px-5 border-b" style={{ borderColor: '#f1f5f9' }}>
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm"
            style={{ background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' }}
          >
            LO
          </div>
          <div>
            <p className="font-bold text-sm text-slate-900 leading-none">Lanka Offers</p>
            <p className="text-xs text-slate-400 mt-0.5">Admin Console</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 overflow-y-auto px-3">
        {NAV.map((section) => (
          <div key={section.group} className="mb-5">
            <p className="px-3 mb-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
              {section.group}
            </p>
            <div className="space-y-0.5">
              {section.links.map(({ href, icon: Icon, label }) => {
                const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150"
                    style={isActive ? {
                      background: '#eef2ff',
                      color: '#4f46e5',
                      fontWeight: 600,
                    } : {
                      color: '#64748b',
                    }}
                    onMouseEnter={e => {
                      if (!isActive) {
                        e.currentTarget.style.background = '#f8fafc';
                        e.currentTarget.style.color = '#1e293b';
                      }
                    }}
                    onMouseLeave={e => {
                      if (!isActive) {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = '#64748b';
                      }
                    }}
                  >
                    <Icon
                      size={17}
                      style={{ opacity: isActive ? 1 : 0.7 }}
                    />
                    <span>{label}</span>
                    {isActive && (
                      <span className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-500" />
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t" style={{ borderColor: '#f1f5f9' }}>
        <div className="px-3 py-2.5 rounded-lg bg-slate-50 flex items-center gap-2.5">
          <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
          <div>
            <p className="text-[11px] font-semibold text-slate-700">System Online</p>
            <p className="text-[10px] text-slate-400">8 banks · v1.0</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

function TopBar() {
  const pathname = usePathname();
  const pageTitle = getPageTitle(pathname);

  return (
    <header
      className="h-16 flex items-center px-8 border-b shrink-0"
      style={{ background: '#ffffff', borderColor: '#f1f5f9' }}
    >
      <div>
        <h2 className="text-base font-semibold text-slate-900">{pageTitle}</h2>
        <p className="text-xs text-slate-400">Lanka Offers Admin Console</p>
      </div>
      <div className="ml-auto flex items-center gap-3">
        <button className="relative p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
          <Bell size={18} />
        </button>
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs font-semibold">
          A
        </div>
      </div>
    </header>
  );
}

function getPageTitle(pathname) {
  const map = {
    '/': 'Dashboard Overview',
    '/analytics': 'Analytics',
    '/offers': 'Offers',
    '/map': 'Map View',
    '/merchants': 'Merchants',
    '/scrapers': 'Scraper Control',
    '/quality': 'Data Quality',
    '/ai': 'AI Assistant',
    '/admin': 'Administration',
    '/settings': 'Settings',
  };
  for (const [key, title] of Object.entries(map)) {
    if (key !== '/' && pathname.startsWith(key)) return title;
  }
  return map[pathname] || 'Dashboard';
}
