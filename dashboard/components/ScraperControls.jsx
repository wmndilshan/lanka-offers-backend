'use client';

import { useState } from 'react';
import { Play, Loader2, CheckCircle, XCircle, MapPin } from 'lucide-react';

export default function ScraperControls({ banks }) {
  const [runningScrapers, setRunningScrapers] = useState(new Set());
  const [scraperStatus, setScraperStatus] = useState({});
  const [logs, setLogs] = useState('');
  const [selectedGeoBank, setSelectedGeoBank] = useState(banks[0]);

  const runScraper = async (bank) => {
    setRunningScrapers(prev => new Set([...prev, bank]));
    setScraperStatus(prev => ({ ...prev, [bank]: 'running' }));
    setLogs(prev => prev + `\n[${new Date().toLocaleTimeString()}] Starting scraper for ${bank}...\n`);

    try {
      const response = await fetch('/api/scrapers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bank: bank,
          action: 'scrape'
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.log) {
                setLogs(prev => prev + data.log + '\n');
              }
              if (data.done) {
                setScraperStatus(prev => ({
                  ...prev,
                  [bank]: data.success ? 'success' : 'error'
                }));
                setRunningScrapers(prev => {
                  const next = new Set(prev);
                  next.delete(bank);
                  return next;
                });
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e);
            }
          }
        }
      }
    } catch (error) {
      setLogs(prev => prev + `\n[ERROR] ${error.message}\n`);
      setScraperStatus(prev => ({ ...prev, [bank]: 'error' }));
      setRunningScrapers(prev => {
        const next = new Set(prev);
        next.delete(bank);
        return next;
      });
    }
  };

  const runGeocoding = async () => {
    const bank = selectedGeoBank;
    setRunningScrapers(prev => new Set([...prev, `geo-${bank}`]));
    setLogs(prev => prev + `\n[${new Date().toLocaleTimeString()}] Starting geocoding for ${bank}...\n`);

    try {
      const response = await fetch('/api/geocode', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bank }),
      });

      const data = await response.json();

      if (data.success) {
        setLogs(prev => prev + `\n[SUCCESS] Geocoding completed for ${bank}\n${data.output}\n`);
      } else {
        setLogs(prev => prev + `\n[ERROR] Geocoding failed for ${bank}\n${data.error}\n${data.errorOutput || ''}\n`);
      }
    } catch (error) {
      setLogs(prev => prev + `\n[ERROR] ${error.message}\n`);
    } finally {
      setRunningScrapers(prev => {
        const next = new Set(prev);
        next.delete(`geo-${bank}`);
        return next;
      });
    }
  };

  const clearLogs = () => {
    setLogs('');
  };

  return (
    <div className="space-y-6">
      {/* Bank Scrapers Grid */}
      <div className="bg-white rounded-lg border border-slate-200">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">Bank Data Sources</h2>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {banks.map(bank => (
              <ScraperCard
                key={bank}
                bank={bank}
                isRunning={runningScrapers.has(bank)}
                status={scraperStatus[bank]}
                onRun={() => runScraper(bank)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Geocoding */}
      <div className="bg-white rounded-lg border border-slate-200">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">Geocoding Operations</h2>
        </div>
        <div className="p-6">
          <div className="flex gap-4">
            <select
              value={selectedGeoBank}
              onChange={(e) => setSelectedGeoBank(e.target.value)}
              className="flex-1 px-4 py-2 text-sm border border-slate-200 rounded-md focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            >
              {banks.map(bank => (
                <option key={bank} value={bank}>{bank.toUpperCase()}</option>
              ))}
            </select>
            <button
              onClick={runGeocoding}
              disabled={runningScrapers.has(`geo-${selectedGeoBank}`)}
              className="px-6 py-2 bg-slate-900 text-white text-sm font-medium rounded-md hover:bg-slate-800 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {runningScrapers.has(`geo-${selectedGeoBank}`) ? (
                <>
                  <Loader2 className="animate-spin" size={16} />
                  Running
                </>
              ) : (
                <>
                  <MapPin size={16} />
                  Run Geocoding
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Console Output */}
      <div className="bg-white rounded-lg border border-slate-200">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Console Output</h2>
          <button
            onClick={clearLogs}
            className="px-3 py-1.5 bg-slate-100 text-slate-700 text-xs font-medium rounded-md hover:bg-slate-200 transition-colors"
          >
            Clear
          </button>
        </div>
        <div className="p-4">
          <div className="bg-slate-900 text-slate-300 p-4 rounded-md font-mono text-xs leading-relaxed h-80 overflow-y-auto scrollbar-thin">
            {logs || '[System] Waiting for automation output...'}
          </div>
        </div>
      </div>
    </div>
  );
}

function ScraperCard({ bank, isRunning, status, onRun }) {
  // Mock last updated time
  const lastUpdated = '2 hours ago';

  return (
    <div className="border border-slate-200 rounded-lg p-4 hover:border-slate-300 transition-colors">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="w-10 h-10 bg-slate-100 rounded flex items-center justify-center mb-2">
            <span className="text-xs font-semibold text-slate-600">{bank.substring(0, 2).toUpperCase()}</span>
          </div>
          <h3 className="text-sm font-semibold text-slate-900">{bank.toUpperCase()}</h3>
          <p className="text-xs text-slate-500 mt-1">Updated {lastUpdated}</p>
        </div>
        <StatusIcon status={status} isRunning={isRunning} />
      </div>
      <button
        onClick={onRun}
        disabled={isRunning}
        className="w-full px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-md hover:bg-slate-800 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
      >
        {isRunning ? (
          <>
            <Loader2 className="animate-spin" size={14} />
            Running
          </>
        ) : (
          <>
            <Play size={14} />
            Run Scraper
          </>
        )}
      </button>
    </div>
  );
}

function StatusIcon({ status, isRunning }) {
  if (isRunning) {
    return <Loader2 className="animate-spin text-brand-600" size={16} />;
  }

  switch (status) {
    case 'success':
      return <CheckCircle className="text-green-600" size={16} />;
    case 'error':
      return <XCircle className="text-red-600" size={16} />;
    default:
      return <div className="w-2 h-2 rounded-full bg-slate-300"></div>;
  }
}
