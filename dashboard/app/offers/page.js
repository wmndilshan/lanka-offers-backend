import { loadAllOffers } from '@/lib/data';
import OffersTable from '@/components/OffersTable';

export const dynamic = 'force-dynamic';

export default function OffersPage() {
  const offers = loadAllOffers();

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Offers</h1>
        <p className="text-sm text-slate-600 mt-1">Browse and filter all bank card promotions</p>
      </div>

      {/* Offers Table */}
      <div className="bg-white rounded-lg border border-slate-200">
        <OffersTable offers={offers} />
      </div>
    </div>
  );
}
