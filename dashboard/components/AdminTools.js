'use client';

import { useState } from 'react';
import { Trash2, RefreshCw, Database, CheckCircle, AlertCircle } from 'lucide-react';

export default function AdminTools() {
  const [activeOperation, setActiveOperation] = useState(null);
  const [result, setResult] = useState(null);

  const runOperation = async (operation) => {
    setActiveOperation(operation);
    setResult(null);

    try {
      const response = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation })
      });

      const data = await response.json();
      setResult({
        success: true,
        message: data.message,
        details: data.details
      });
    } catch (error) {
      setResult({
        success: false,
        message: 'Operation failed: ' + error.message
      });
    } finally {
      setActiveOperation(null);
    }
  };

  const tools = [
    {
      id: 'clear-cache',
      label: 'Clear Cache',
      description: 'Remove all cached geocoding results',
      icon: Trash2,
      action: () => runOperation('clear-cache'),
      color: 'text-red-600'
    },
    {
      id: 'refresh-data',
      label: 'Refresh Data',
      description: 'Reload all offer data from files',
      icon: RefreshCw,
      action: () => runOperation('refresh-data'),
      color: 'text-blue-600'
    },
    {
      id: 'cleanup-old',
      label: 'Cleanup Old Data',
      description: 'Remove expired offers and outdated records',
      icon: Database,
      action: () => runOperation('cleanup-old'),
      color: 'text-amber-600'
    }
  ];

  return (
    <div className="bg-white rounded-lg border border-slate-200">
      <div className="px-6 py-4 border-b border-slate-200">
        <h2 className="text-base font-semibold text-slate-900">Administrative Tools</h2>
        <p className="text-xs text-slate-500 mt-1">Maintenance and cleanup operations</p>
      </div>

      <div className="p-6">
        <div className="space-y-3">
          {tools.map((tool) => {
            const Icon = tool.icon;
            const isActive = activeOperation === tool.id;

            return (
              <button
                key={tool.id}
                onClick={tool.action}
                disabled={!!activeOperation}
                className="w-full flex items-center gap-4 p-4 border border-slate-200 rounded-lg hover:border-slate-300 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-left"
              >
                <div className={`p-2 rounded-lg bg-slate-50 ${tool.color}`}>
                  <Icon size={20} className={isActive ? 'animate-spin' : ''} />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-slate-900">{tool.label}</div>
                  <div className="text-xs text-slate-500">{tool.description}</div>
                </div>
                {isActive && (
                  <div className="text-xs text-slate-500">Processing...</div>
                )}
              </button>
            );
          })}
        </div>

        {/* Result Display */}
        {result && (
          <div className={`mt-4 p-4 rounded-lg border ${
            result.success
              ? 'bg-green-50 border-green-200'
              : 'bg-red-50 border-red-200'
          }`}>
            <div className="flex items-start gap-3">
              {result.success ? (
                <CheckCircle size={20} className="text-green-600 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <p className={`text-sm font-medium ${
                  result.success ? 'text-green-900' : 'text-red-900'
                }`}>
                  {result.message}
                </p>
                {result.details && (
                  <p className="text-xs text-slate-600 mt-1">{result.details}</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
