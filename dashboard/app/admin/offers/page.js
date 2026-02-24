import Link from 'next/link';
import { Suspense } from 'react';
import { Plus } from 'lucide-react';
import OffersTable from '@/components/Admin/OffersTable';

export const dynamic = 'force-dynamic';

export default function AdminOffersPage() {
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold text-slate-900">Offers</h1>
                    <p className="text-sm text-slate-500 mt-1">Manage all scraped and manually added offers</p>
                </div>
                <Link
                    href="/admin/offers/new"
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-md hover:bg-emerald-700 transition-colors"
                >
                    <Plus size={16} />
                    Add Offer
                </Link>
            </div>

            <Suspense fallback={<div className="text-center py-12 text-slate-500">Loading offers...</div>}>
                <OffersTable />
            </Suspense>
        </div>
    );
}
