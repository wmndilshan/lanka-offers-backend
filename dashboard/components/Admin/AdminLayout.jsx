
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function AdminLayout({ children }) {
    const pathname = usePathname();

    const navItems = [
        { name: 'Dashboard', href: '/admin', icon: '📊' },
        { name: 'Offers', href: '/admin/offers', icon: '🏷️' },
        { name: 'Cleanup', href: '/admin/cleanup', icon: '🧹' },
        { name: 'Health', href: '/admin/health', icon: '🏥' },
        { name: 'AI Chat', href: '/admin/chat', icon: '🤖' },
        { name: 'Scrapers', href: '/admin/scrapers', icon: '🕷️' },
        { name: 'Map View', href: '/admin/map', icon: '🗺️' },
        { name: 'Settings', href: '/admin/settings', icon: '⚙️' },
    ];

    return (
        <div className="flex h-screen bg-gray-100">
            {/* Sidebar */}
            <aside className="w-64 bg-white shadow-md flex flex-col">
                <div className="p-4 border-b">
                    <h1 className="text-xl font-bold text-gray-800">LankaOffers Admin</h1>
                </div>
                <nav className="flex-1 p-4 space-y-1">
                    {navItems.map((item) => {
                        const isActive = pathname === item.href;
                        return (
                            <Link
                                key={item.name}
                                href={item.href}
                                className={`flex items-center px-4 py-2 text-sm font-medium rounded-md group ${isActive
                                    ? 'bg-blue-50 text-blue-700'
                                    : 'text-gray-700 hover:bg-gray-50'
                                    }`}
                            >
                                <span className="mr-3 text-lg">{item.icon}</span>
                                {item.name}
                            </Link>
                        );
                    })}
                </nav>
                <div className="p-4 border-t">
                    <div className="text-xs text-gray-500">v1.0.0</div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-auto p-8">
                {children}
            </main>
        </div>
    );
}
