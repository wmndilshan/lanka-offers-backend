import { getStats, loadAllOffers } from '@/lib/data';
import { FileText, MapPin, Building2, TrendingUp, ArrowUpRight, Clock } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function Dashboard() {
  const stats = getStats();
  const offers = loadAllOffers();
  const recentActivity = offers.slice(0, 8);

  const bankStatus = [
    { name: 'HNB', lastSync: '1 hour ago', offers: 142, status: 'ok' },
    { name: 'BOC', lastSync: '2 hours ago', offers: 98, status: 'ok' },
    { name: 'Sampath', lastSync: '3 hours ago', offers: 76, status: 'ok' },
    { name: 'NDB', lastSync: '4 hours ago', offers: 54, status: 'ok' },
    { name: 'Seylan', lastSync: '5 hours ago', offers: 43, status: 'warn' },
    { name: 'DFCC', lastSync: '6 hours ago', offers: 31, status: 'ok' },
    { name: 'Pan Asia', lastSync: '12 hours ago', offers: 18, status: 'warn' },
    { name: "People's", lastSync: '8 hours ago', offers: 87, status: 'ok' },
  ];

  return (
    <div>
      {/* Page Header */}
      <div className="page-header flex items-center justify-between">
        <div>
          <h1 className="page-title">Good morning 👋</h1>
          <p className="page-desc">Here's what's happening with Lanka Offers today.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Clock size={13} />
          {new Date().toLocaleDateString('en-LK', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        <MetricCard
          icon={<FileText size={20} />}
          label="Total Offers"
          value={stats.totalOffers?.toLocaleString() ?? '0'}
          change="+12%"
          up
          color="indigo"
          href="/offers"
        />
        <MetricCard
          icon={<MapPin size={20} />}
          label="Geocoded Locations"
          value={stats.totalLocations?.toLocaleString() ?? '0'}
          change="+8%"
          up
          color="emerald"
          href="/map"
        />
        <MetricCard
          icon={<Building2 size={20} />}
          label="Banks Connected"
          value={stats.banksCovered ?? '8'}
          color="violet"
          href="/scrapers"
        />
        <MetricCard
          icon={<TrendingUp size={20} />}
          label="API Calls (Month)"
          value={stats.apiUsageThisMonth?.toLocaleString() ?? '0'}
          change="+5%"
          up
          color="sky"
        />
      </div>

      {/* Two column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Scraped Offers */}
        <div className="lg:col-span-2 card overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="section-title">Recent Offers</h3>
              <p className="text-xs text-slate-400 mt-0.5">Latest scraped promotions</p>
            </div>
            <a href="/offers" className="text-xs font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-1">
              View all <ArrowUpRight size={12} />
            </a>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Merchant</th>
                  <th>Bank</th>
                  <th>Category</th>
                  <th>Discount</th>
                </tr>
              </thead>
              <tbody>
                {recentActivity.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="py-12 text-center text-slate-400">
                      No offers yet. Run a scraper to fetch data.
                    </td>
                  </tr>
                ) : recentActivity.map((offer, i) => (
                  <tr key={i}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 text-xs font-bold shrink-0">
                          {(offer.merchant || '?')[0].toUpperCase()}
                        </div>
                        <span className="font-medium text-slate-900 truncate max-w-[160px]">
                          {offer.merchant || 'Unknown'}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-indigo">{offer.bank}</span>
                    </td>
                    <td className="text-slate-500">{offer.category || '—'}</td>
                    <td className="font-semibold text-emerald-600">{offer.discount || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Bank Status */}
        <div className="card">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="section-title">Bank Scrapers</h3>
            <p className="text-xs text-slate-400 mt-0.5">Last sync status</p>
          </div>
          <div className="p-4 space-y-1">
            {bankStatus.map((bank) => (
              <div
                key={bank.name}
                className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${bank.status === 'ok' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  <div>
                    <p className="text-sm font-medium text-slate-800">{bank.name}</p>
                    <p className="text-[11px] text-slate-400">{bank.lastSync}</p>
                  </div>
                </div>
                <span className="text-xs font-semibold text-slate-500">{bank.offers} offers</span>
              </div>
            ))}
          </div>
          <div className="px-5 pb-4">
            <a href="/scrapers" className="btn btn-secondary w-full justify-center text-xs">
              View Scraper Details
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ icon, label, value, change, up, color, href }) {
  const colors = {
    indigo: { bg: 'bg-indigo-50', text: 'text-indigo-600', ring: 'ring-indigo-100' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', ring: 'ring-emerald-100' },
    violet: { bg: 'bg-violet-50', text: 'text-violet-600', ring: 'ring-violet-100' },
    sky: { bg: 'bg-sky-50', text: 'text-sky-600', ring: 'ring-sky-100' },
  };
  const c = colors[color] || colors.indigo;
  const card = (
    <div className="stat-card group">
      <div className="flex items-start justify-between">
        <div className={`p-2.5 rounded-xl ${c.bg} ${c.text}`}>{icon}</div>
        {change && (
          <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${up ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
            {change}
          </span>
        )}
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-900 tracking-tight">{value}</p>
        <p className="text-xs text-slate-500 mt-0.5">{label}</p>
      </div>
    </div>
  );
  return href ? <a href={href} className="block">{card}</a> : card;
}
