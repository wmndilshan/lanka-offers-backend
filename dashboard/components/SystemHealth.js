'use client';

import { useEffect, useState } from 'react';
import { Activity, AlertCircle, CheckCircle, TrendingUp, Database } from 'lucide-react';

export default function SystemHealth({ stats, offers }) {
  const [health, setHealth] = useState({
    apiQuota: { used: 0, limit: 10000, status: 'healthy' },
    dataQuality: { score: 0, status: 'healthy' },
    coverage: { percentage: 0, status: 'healthy' }
  });

  useEffect(() => {
    calculateHealth();
  }, [stats, offers]);

  const calculateHealth = () => {
    // API Quota (based on geocoded locations as proxy)
    const apiUsed = stats.apiUsageThisMonth || 0;
    const apiLimit = 10000;
    const apiPercentage = (apiUsed / apiLimit) * 100;
    const apiStatus = apiPercentage > 90 ? 'critical' : apiPercentage > 70 ? 'warning' : 'healthy';

    // Data Quality (percentage of offers with complete info)
    const totalOffers = offers.length;
    const completeOffers = offers.filter(o =>
      o.merchant && o.merchant !== 'Unknown' &&
      o.discount && o.discount !== 'N/A' &&
      o.category && o.category !== 'N/A'
    ).length;
    const qualityScore = totalOffers > 0 ? Math.round((completeOffers / totalOffers) * 100) : 0;
    const qualityStatus = qualityScore < 50 ? 'critical' : qualityScore < 80 ? 'warning' : 'healthy';

    // Coverage (percentage of offers with geocoded locations)
    const geocodedCount = stats.totalLocations || 0;
    const coveragePercentage = totalOffers > 0 ? Math.round((geocodedCount / totalOffers) * 100) : 0;
    const coverageStatus = coveragePercentage < 30 ? 'critical' : coveragePercentage < 60 ? 'warning' : 'healthy';

    setHealth({
      apiQuota: { used: apiUsed, limit: apiLimit, percentage: Math.round(apiPercentage), status: apiStatus },
      dataQuality: { score: qualityScore, total: totalOffers, complete: completeOffers, status: qualityStatus },
      coverage: { percentage: coveragePercentage, geocoded: geocodedCount, total: totalOffers, status: coverageStatus }
    });
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'healthy': return 'text-green-600 bg-green-50 border-green-200';
      case 'warning': return 'text-amber-600 bg-amber-50 border-amber-200';
      case 'critical': return 'text-red-600 bg-red-50 border-red-200';
      default: return 'text-slate-600 bg-slate-50 border-slate-200';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'healthy': return <CheckCircle size={16} className="text-green-600" />;
      case 'warning': return <AlertCircle size={16} className="text-amber-600" />;
      case 'critical': return <AlertCircle size={16} className="text-red-600" />;
      default: return <Activity size={16} className="text-slate-600" />;
    }
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200">
      <div className="px-6 py-4 border-b border-slate-200">
        <h2 className="text-base font-semibold text-slate-900">System Health</h2>
        <p className="text-xs text-slate-500 mt-1">Monitor data quality and API usage</p>
      </div>

      <div className="p-6 space-y-4">
        {/* API Quota */}
        <div className={`p-4 rounded-lg border ${getStatusColor(health.apiQuota.status)}`}>
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              {getStatusIcon(health.apiQuota.status)}
              <span className="text-sm font-medium">API Quota</span>
            </div>
            <span className="text-xs font-medium">{health.apiQuota.percentage}%</span>
          </div>
          <div className="w-full bg-white rounded-full h-2 mb-2">
            <div
              className={`h-2 rounded-full transition-all ${
                health.apiQuota.status === 'critical' ? 'bg-red-500' :
                health.apiQuota.status === 'warning' ? 'bg-amber-500' : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(health.apiQuota.percentage, 100)}%` }}
            ></div>
          </div>
          <p className="text-xs">
            {health.apiQuota.used.toLocaleString()} / {health.apiQuota.limit.toLocaleString()} requests this month
          </p>
        </div>

        {/* Data Quality */}
        <div className={`p-4 rounded-lg border ${getStatusColor(health.dataQuality.status)}`}>
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              {getStatusIcon(health.dataQuality.status)}
              <span className="text-sm font-medium">Data Quality</span>
            </div>
            <span className="text-xs font-medium">{health.dataQuality.score}%</span>
          </div>
          <div className="w-full bg-white rounded-full h-2 mb-2">
            <div
              className={`h-2 rounded-full transition-all ${
                health.dataQuality.status === 'critical' ? 'bg-red-500' :
                health.dataQuality.status === 'warning' ? 'bg-amber-500' : 'bg-green-500'
              }`}
              style={{ width: `${health.dataQuality.score}%` }}
            ></div>
          </div>
          <p className="text-xs">
            {health.dataQuality.complete} / {health.dataQuality.total} offers with complete data
          </p>
        </div>

        {/* Location Coverage */}
        <div className={`p-4 rounded-lg border ${getStatusColor(health.coverage.status)}`}>
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              {getStatusIcon(health.coverage.status)}
              <span className="text-sm font-medium">Location Coverage</span>
            </div>
            <span className="text-xs font-medium">{health.coverage.percentage}%</span>
          </div>
          <div className="w-full bg-white rounded-full h-2 mb-2">
            <div
              className={`h-2 rounded-full transition-all ${
                health.coverage.status === 'critical' ? 'bg-red-500' :
                health.coverage.status === 'warning' ? 'bg-amber-500' : 'bg-green-500'
              }`}
              style={{ width: `${health.coverage.percentage}%` }}
            ></div>
          </div>
          <p className="text-xs">
            {health.coverage.geocoded} / {health.coverage.total} offers geocoded
          </p>
        </div>
      </div>
    </div>
  );
}
