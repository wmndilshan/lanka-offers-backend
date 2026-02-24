'use client';

import { useState } from 'react';
import { Activity, AlertTriangle, CheckCircle, Loader, RefreshCw } from 'lucide-react';

export default function DataQualityChecker() {
  const [loading, setLoading] = useState(false);
  const [checks, setChecks] = useState(null);
  const [processing, setProcessing] = useState(null);

  const runHealthCheck = async () => {
    setLoading(true);
    setChecks(null);

    try {
      const response = await fetch('/api/health');
      const data = await response.json();
      setChecks(data);
    } catch (error) {
      console.error('Health check failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const executeAction = async (checkType, action) => {
    setProcessing(checkType);

    try {
      const response = await fetch('/api/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkType, action })
      });

      const data = await response.json();

      // Refresh health checks after action
      await runHealthCheck();
    } catch (error) {
      console.error('Action failed:', error);
    } finally {
      setProcessing(null);
    }
  };

  const getSeverityColor = (count) => {
    if (count === 0) return 'text-green-600 bg-green-50 border-green-200';
    if (count < 5) return 'text-amber-600 bg-amber-50 border-amber-200';
    return 'text-red-600 bg-red-50 border-red-200';
  };

  const getSeverityIcon = (count) => {
    if (count === 0) return <CheckCircle size={20} className="text-green-600" />;
    if (count < 5) return <AlertTriangle size={20} className="text-amber-600" />;
    return <AlertTriangle size={20} className="text-red-600" />;
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200">
      <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Data Quality Checker</h2>
          <p className="text-xs text-slate-500 mt-1">Automated health checks for offer database</p>
        </div>
        <button
          onClick={runHealthCheck}
          disabled={loading}
          className="px-4 py-2 bg-brand-500 text-white text-sm rounded-lg hover:bg-brand-600 disabled:opacity-50 transition-colors flex items-center gap-2"
        >
          {loading ? (
            <>
              <Loader size={16} className="animate-spin" />
              Checking...
            </>
          ) : (
            <>
              <Activity size={16} />
              Run Health Check
            </>
          )}
        </button>
      </div>

      <div className="p-6">
        {checks ? (
          <div className="space-y-3">
            {Object.entries(checks).map(([key, check]) => (
              <div
                key={key}
                className={`p-4 rounded-lg border ${getSeverityColor(check.count)}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-start gap-3">
                    {getSeverityIcon(check.count)}
                    <div>
                      <h3 className="text-sm font-medium">{check.title}</h3>
                      <p className="text-xs mt-1 opacity-80">{check.description}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold">{check.count}</div>
                    <div className="text-xs opacity-70">issues</div>
                  </div>
                </div>

                {check.count > 0 && (
                  <>
                    {/* Sample Issues */}
                    {check.sample && check.sample.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-current opacity-30">
                        <p className="text-xs font-medium mb-2">Sample Issues:</p>
                        <div className="space-y-1">
                          {check.sample.slice(0, 3).map((item, idx) => (
                            <p key={idx} className="text-xs">
                              • {item.merchantName || item.title || 'Untitled'}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Action Button */}
                    {check.action && (
                      <button
                        onClick={() => executeAction(key, check.action)}
                        disabled={processing !== null}
                        className="mt-3 px-3 py-1.5 bg-white text-current text-xs rounded border border-current hover:opacity-80 disabled:opacity-50 transition-opacity flex items-center gap-2"
                      >
                        {processing === key ? (
                          <>
                            <Loader size={14} className="animate-spin" />
                            Processing...
                          </>
                        ) : (
                          <>
                            <RefreshCw size={14} />
                            {check.action === 'archive' && 'Archive Expired'}
                            {check.action === 'flag' && 'Flag for Review'}
                            {check.action === 'review' && 'Mark for Review'}
                          </>
                        )}
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-sm text-slate-500">
            Click "Run Health Check" to analyze your data
          </div>
        )}
      </div>
    </div>
  );
}
