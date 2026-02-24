import { getStats, loadAllOffers } from '@/lib/data';
import AdminTools from '@/components/AdminTools';
import SystemHealth from '@/components/SystemHealth';
import AIDuplicateFinder from '@/components/AIDuplicateFinder';
import DataQualityChecker from '@/components/DataQualityChecker';
import { Shield } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function AdminPage() {
  const stats = getStats();
  const offers = loadAllOffers();

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
            <Shield size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Administration</h1>
            <p className="text-sm text-slate-600 mt-1">AI-powered data cleanup and system health monitoring</p>
          </div>
        </div>
      </div>

      {/* AI-Powered Tools - Full Width */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AIDuplicateFinder />
        <DataQualityChecker />
      </div>

      {/* System Maintenance & Health */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AdminTools />
        <SystemHealth stats={stats} offers={offers} />
      </div>
    </div>
  );
}
