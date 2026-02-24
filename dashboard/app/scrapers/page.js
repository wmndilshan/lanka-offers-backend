'use client';

/**
 * Unified Scrapers Control + Logs
 *
 * Architecture for persistent state:
 * - Scraper runs server-side (child_process keeps running even if client disconnects)
 * - Scraper writes structured logs to logs/{bank}/YYYY-MM-DD.jsonl
 * - Client polls /api/logs every 2s — state survives tab switches
 * - Run status stored in localStorage so it persists across navigation
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import {
  Play, Square, RefreshCw, Download, Terminal, ChevronDown,
  ChevronRight, CheckCircle, XCircle, AlertCircle, Info,
  Zap, Clock, Database, Globe, Loader2, Settings2, Map,
  FileText, Cpu
} from 'lucide-react';

// ─── Bank Config ────────────────────────────────────────────────────────────
const BANKS = [
  { id: 'hnb', label: 'HNB', color: '#3b82f6', bg: '#eff6ff', script: 'hnb-6.js', icon: '🏦' },
  { id: 'boc', label: 'BOC', color: '#10b981', bg: '#ecfdf5', script: 'boc-6.js', icon: '🏛️' },
  { id: 'sampath', label: 'Sampath', color: '#f97316', bg: '#fff7ed', script: 'sampath-6.js', icon: '💳' },
  { id: 'ndb', label: 'NDB', color: '#8b5cf6', bg: '#f5f3ff', script: 'ndb-2.js', icon: '🔷' },
  { id: 'peoples', label: "People's", color: '#06b6d4', bg: '#ecfeff', script: 'people-3..js', icon: '👥' },
  { id: 'seylan', label: 'Seylan', color: '#eab308', bg: '#fefce8', script: 'seylan.js', icon: '🌟' },
  { id: 'dfcc', label: 'DFCC', color: '#ec4899', bg: '#fdf2f8', script: 'dfcc.js', icon: '💎' },
];

// ─── Log Level Config ────────────────────────────────────────────────────────
const LEVELS = {
  DEBUG: { dot: 'bg-slate-500', text: 'text-slate-400', badge: 'bg-slate-800 text-slate-400', icon: <Terminal size={10} /> },
  INFO: { dot: 'bg-sky-500', text: 'text-sky-300', badge: 'bg-sky-900/40 text-sky-300', icon: <Info size={10} /> },
  SUCCESS: { dot: 'bg-emerald-500', text: 'text-emerald-400', badge: 'bg-emerald-900/40 text-emerald-300', icon: <CheckCircle size={10} /> },
  WARN: { dot: 'bg-amber-400', text: 'text-amber-300', badge: 'bg-amber-900/40 text-amber-300', icon: <AlertCircle size={10} /> },
  ERROR: { dot: 'bg-red-500', text: 'text-red-400', badge: 'bg-red-900/50 text-red-300', icon: <XCircle size={10} /> },
  FATAL: { dot: 'bg-red-600', text: 'text-red-300', badge: 'bg-red-800 text-red-200', icon: <Zap size={10} /> },
};

const STORAGE_KEY = 'scraper_run_state';

function formatTime(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function ScrapersPage() {
  const [selectedBank, setSelectedBank] = useState(BANKS[0].id);
  const [action, setAction] = useState('scrape');   // 'scrape' | 'geocode'
  const [noCache, setNoCache] = useState(false);
  const [skipDetails, setSkipDetails] = useState(false);

  // Run state — persisted so it survives navigation
  const [runState, setRunState] = useState(() => {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      return s ? JSON.parse(s) : { bank: null, startedAt: null, running: false, exitCode: null };
    } catch { return { bank: null, startedAt: null, running: false, exitCode: null }; }
  });

  // Log viewer state
  const [logs, setLogs] = useState([]);
  const [levelFilter, setLevelFilter] = useState('ALL');
  const [searchText, setSearchText] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [lastLogCount, setLastLogCount] = useState(0);

  const bottomRef = useRef(null);
  const pollRef = useRef(null);
  const startingRef = useRef(false);

  // Persist runState to localStorage
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(runState)); } catch { }
  }, [runState]);

  // ── Poll JSONL logs ────────────────────────────────────────────────────────
  const pollLogs = useCallback(async (bank) => {
    if (!bank) return;
    try {
      const params = new URLSearchParams({ bank, limit: '2000' });
      if (levelFilter !== 'ALL') params.set('level', levelFilter);
      if (searchText) params.set('search', searchText);
      const data = await fetch(`/api/logs?${params}`).then(r => r.json());
      const entries = data.entries || [];
      setLogs(entries);
      setLastLogCount(entries.length);
    } catch { }
  }, [levelFilter, searchText]);

  // Start/stop polling
  useEffect(() => {
    const bank = runState.bank || selectedBank;
    pollLogs(bank);

    if (runState.running) {
      clearInterval(pollRef.current);
      pollRef.current = setInterval(() => pollLogs(bank), 2000);
    } else {
      clearInterval(pollRef.current);
    }
    return () => clearInterval(pollRef.current);
  }, [runState.running, runState.bank, pollLogs, selectedBank]);

  // Also poll when filters change
  useEffect(() => {
    pollLogs(runState.bank || selectedBank);
  }, [levelFilter, searchText]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs.length, autoScroll]);

  // Check if a running scraper has finished (by seeing if new log entries stop + checking error presence)
  useEffect(() => {
    if (!runState.running) return;
    const started = runState.startedAt ? new Date(runState.startedAt).getTime() : Date.now();
    const elapsed = Date.now() - started;
    // After 2 min with no new logs, assume finished
    if (elapsed > 120_000 && lastLogCount === logs.length && logs.length > 0) {
      const lastEntry = logs[logs.length - 1];
      if (lastEntry && new Date(lastEntry.ts).getTime() < Date.now() - 30_000) {
        setRunState(s => ({ ...s, running: false }));
      }
    }
  }, [logs, runState]);

  // ── Start scraper ──────────────────────────────────────────────────────────
  const handleRun = async () => {
    if (startingRef.current || runState.running) return;
    startingRef.current = true;

    const bankId = selectedBank;
    setRunState({ bank: bankId, startedAt: new Date().toISOString(), running: true, exitCode: null });
    setLogs([]);
    setAutoScroll(true);

    try {
      const args = [];
      if (noCache) args.push('--no-cache');
      if (skipDetails && action === 'scrape') args.push('--skip-details');

      const res = await fetch('/api/scrapers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bank: bankId, action }),
      });

      // We fire-and-forget the SSE stream — don't read it.
      // Logs come from the JSONL poller so state survives tab switches.
      // We just need to detect when the process finishes.
      if (res.body) {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        // Read in background
        (async () => {
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              const text = dec.decode(value);
              const lines = text.split('\n\n');
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const d = JSON.parse(line.slice(6));
                    if (d.done) {
                      setRunState(s => ({ ...s, running: false, exitCode: d.success ? 0 : 1 }));
                      return;
                    }
                  } catch { }
                }
              }
            }
          } catch { }
          // Stream ended without done signal — mark finished
          setRunState(s => ({ ...s, running: false }));
        })();
      }
    } catch (err) {
      setRunState(s => ({ ...s, running: false, exitCode: 1 }));
    } finally {
      startingRef.current = false;
    }
  };

  const handleStop = () => {
    setRunState(s => ({ ...s, running: false }));
  };

  const exportLogs = () => {
    const text = logs.map(e =>
      `[${formatTime(e.ts)}] [${e.level}] [${e.bank}/${e.tag}] ${e.message}${e.data ? ' ' + JSON.stringify(e.data) : ''}`
    ).join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    Object.assign(document.createElement('a'), {
      href: url, download: `${runState.bank || selectedBank}-logs.txt`
    }).click();
  };

  // ── Filtered logs ──────────────────────────────────────────────────────────
  const filtered = logs; // Filtering done server-side via API params

  const errorCount = logs.filter(e => e.level === 'ERROR' || e.level === 'FATAL').length;
  const warnCount = logs.filter(e => e.level === 'WARN').length;
  const successCount = logs.filter(e => e.level === 'SUCCESS').length;

  const activeBank = BANKS.find(b => b.id === (runState.bank || selectedBank));

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-0 rounded-xl overflow-hidden border" style={{ borderColor: '#e2e8f0' }}>

      {/* ── Left Panel: Bank Selector + Controls ── */}
      <div className="w-72 flex flex-col shrink-0 border-r bg-white" style={{ borderColor: '#e2e8f0' }}>

        {/* Header */}
        <div className="px-5 py-4 border-b" style={{ borderColor: '#f1f5f9' }}>
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Cpu size={15} className="text-indigo-500" />
            Scraper Control
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">Select a bank and run</p>
        </div>

        {/* Bank list */}
        <div className="flex-1 overflow-y-auto py-3 px-3 space-y-1">
          {BANKS.map(bank => {
            const isActive = selectedBank === bank.id;
            const isCurrent = runState.bank === bank.id;
            const isRunning = isCurrent && runState.running;
            return (
              <button
                key={bank.id}
                onClick={() => { setSelectedBank(bank.id); pollLogs(bank.id); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all"
                style={{
                  background: isActive ? bank.bg : 'transparent',
                  borderWidth: 1,
                  borderStyle: 'solid',
                  borderColor: isActive ? bank.color + '40' : 'transparent',
                }}
              >
                <span className="text-xl leading-none">{bank.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${isActive ? '' : 'text-slate-700'}`}
                    style={isActive ? { color: bank.color } : {}}>
                    {bank.label}
                  </p>
                  <p className="text-[10px] text-slate-400 truncate">{bank.script}</p>
                </div>
                {isRunning && (
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                )}
                {isCurrent && !isRunning && runState.exitCode === 0 && (
                  <CheckCircle size={13} className="text-emerald-500 shrink-0" />
                )}
                {isCurrent && !isRunning && runState.exitCode === 1 && (
                  <XCircle size={13} className="text-red-500 shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        {/* Options */}
        <div className="px-4 py-4 border-t space-y-4" style={{ borderColor: '#f1f5f9' }}>

          {/* Action */}
          <div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">
              Action
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { id: 'scrape', icon: <Globe size={12} />, label: 'Scrape' },
                { id: 'geocode', icon: <Map size={12} />, label: 'Geocode' },
              ].map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setAction(opt.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-all ${action === opt.id
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                >
                  {opt.icon} {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Flags */}
          <div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">
              Options
            </p>
            <div className="space-y-2">
              {[
                { key: 'noCache', val: noCache, set: setNoCache, label: 'No Cache', desc: 'Force fresh fetch' },
                { key: 'skipDetails', val: skipDetails, set: setSkipDetails, label: 'Skip Details', desc: 'Faster, list only' },
              ].map(opt => (
                <label key={opt.key} className="flex items-center gap-3 cursor-pointer select-none group">
                  <div
                    onClick={() => opt.set(v => !v)}
                    className={`w-8 h-4.5 rounded-full relative transition-colors flex-shrink-0 ${opt.val ? 'bg-indigo-500' : 'bg-slate-200'}`}
                    style={{ width: 30, height: 17 }}
                  >
                    <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-all ${opt.val ? 'left-[13px]' : 'left-0.5'}`} />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-700">{opt.label}</p>
                    <p className="text-[10px] text-slate-400">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Run button */}
          <button
            onClick={runState.running ? handleStop : handleRun}
            disabled={startingRef.current}
            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${runState.running
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'text-white shadow-sm hover:shadow-md'
              }`}
            style={!runState.running ? { background: 'linear-gradient(135deg,#6366f1,#4f46e5)' } : {}}
          >
            {runState.running ? (
              <><Loader2 size={14} className="animate-spin" /> Running…</>
            ) : (
              <><Play size={14} /> Run {BANKS.find(b => b.id === selectedBank)?.label}</>
            )}
          </button>

          {/* Status */}
          {runState.startedAt && (
            <div className={`rounded-lg px-3 py-2 text-xs ${runState.running
                ? 'bg-emerald-50 text-emerald-700'
                : runState.exitCode === 0
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-red-50 text-red-700'
              }`}>
              <p className="font-semibold">
                {runState.running ? '⚡ Running' : runState.exitCode === 0 ? '✅ Completed' : '❌ Failed'}
              </p>
              <p className="opacity-70 text-[10px] mt-0.5">
                {runState.bank?.toUpperCase()} · {runState.startedAt ? new Date(runState.startedAt).toLocaleTimeString() : ''}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Right Panel: Log Viewer ── */}
      <div className="flex-1 flex flex-col bg-[#0d1117] min-w-0">

        {/* Log toolbar */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b shrink-0 bg-[#161b22]"
          style={{ borderColor: '#30363d' }}>
          <Terminal size={13} className="text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold text-slate-200">
            {activeBank ? `${activeBank.icon} ${activeBank.label} Logs` : 'Logs'}
          </span>
          {(runState.running && runState.bank === selectedBank) && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            {/* Level filter */}
            <select
              value={levelFilter}
              onChange={e => setLevelFilter(e.target.value)}
              className="bg-[#21262d] border text-slate-300 text-[11px] px-2 py-1 rounded-md outline-none"
              style={{ borderColor: '#30363d' }}
            >
              {['ALL', 'DEBUG', 'INFO', 'SUCCESS', 'WARN', 'ERROR'].map(l => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>

            {/* Search */}
            <input
              type="text"
              placeholder="Search…"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              className="bg-[#21262d] border text-slate-300 text-[11px] px-2 py-1 rounded-md outline-none w-28 placeholder:text-slate-600"
              style={{ borderColor: '#30363d' }}
            />

            {/* Stats */}
            {errorCount > 0 && <span className="text-[10px] bg-red-900/50 text-red-300 px-1.5 py-0.5 rounded">{errorCount} err</span>}
            {warnCount > 0 && <span className="text-[10px] bg-amber-900/50 text-amber-300 px-1.5 py-0.5 rounded">{warnCount} warn</span>}
            <span className="text-[10px] text-slate-600">{filtered.length} lines</span>

            <div className="w-px h-4 bg-slate-700" />

            {/* Auto-scroll */}
            <button
              onClick={() => setAutoScroll(p => !p)}
              className={`text-[10px] px-2 py-1 rounded font-medium ${autoScroll ? 'bg-emerald-900/40 text-emerald-400' : 'bg-[#21262d] text-slate-500'}`}
            >
              ↓ {autoScroll ? 'Live' : 'Locked'}
            </button>

            <button onClick={() => pollLogs(runState.bank || selectedBank)}
              className="text-slate-500 hover:text-slate-300 transition-colors">
              <RefreshCw size={12} />
            </button>
            <button onClick={exportLogs} className="text-slate-500 hover:text-slate-300 transition-colors">
              <Download size={12} />
            </button>
          </div>
        </div>

        {/* Log entries */}
        <div
          className="flex-1 overflow-y-auto font-mono text-xs"
          onScroll={e => {
            const el = e.currentTarget;
            setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
          }}
        >
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-600">
              <Terminal size={32} />
              <p className="text-sm">No logs yet</p>
              <p className="text-xs">
                {runState.running
                  ? 'Scraper is starting up…'
                  : 'Run a scraper to see logs here'}
              </p>
            </div>
          ) : (
            <div>
              {filtered.map((entry, i) => {
                const cfg = LEVELS[entry.level] || LEVELS.INFO;
                const key = `${entry.ts}-${i}`;
                const isExp = expanded === key;
                const hasData = entry.data && Object.keys(entry.data).length > 0;

                return (
                  <div
                    key={key}
                    onClick={() => hasData && setExpanded(isExp ? null : key)}
                    className={`flex items-start border-b hover:bg-white/[0.03] transition-colors ${hasData ? 'cursor-pointer' : ''}`}
                    style={{ borderColor: '#161b22' }}
                  >
                    {/* Level bar */}
                    <div className={`w-0.5 self-stretch shrink-0 ${cfg.dot}`} />

                    {/* Time */}
                    <span className="shrink-0 text-slate-600 py-1 pl-2 pr-2 tabular-nums text-[10px] leading-5 mt-0.5 select-none">
                      {formatTime(entry.ts)}
                    </span>

                    {/* Level badge */}
                    <span className={`shrink-0 self-start mt-[5px] mr-2 px-1.5 py-0.5 rounded text-[9px] font-bold ${cfg.badge} flex items-center gap-0.5`}>
                      {cfg.icon} {entry.level?.substring(0, 4)}
                    </span>

                    {/* Tag */}
                    <span className="shrink-0 self-start mt-1 mr-2 text-[10px] text-slate-600 min-w-[72px]">
                      [{entry.tag?.substring(0, 12) || 'General'}]
                    </span>

                    {/* Message + data */}
                    <div className="flex-1 py-1 pr-3 min-w-0">
                      <span className={`${cfg.text} leading-5 break-words`}>{entry.message}</span>
                      {hasData && !isExp && (
                        <span className="ml-2 text-slate-700 text-[10px]">
                          {JSON.stringify(entry.data).substring(0, 72)}
                          {JSON.stringify(entry.data).length > 72 ? '…' : ''}
                        </span>
                      )}
                      {isExp && hasData && (
                        <div className="mt-2 bg-slate-800/60 rounded-lg p-3 text-slate-300 text-[11px] border"
                          style={{ borderColor: '#30363d' }}>
                          <pre className="whitespace-pre-wrap overflow-x-auto">
                            {JSON.stringify(entry.data, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>

                    {hasData && (
                      <div className="shrink-0 self-start mt-1.5 mr-2 text-slate-700">
                        {isExp ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Status bar */}
        <div className="flex items-center justify-between px-4 py-1.5 shrink-0 bg-[#161b22] border-t text-[10px]"
          style={{ borderColor: '#30363d' }}>
          <div className="flex items-center gap-4 text-slate-500">
            {runState.running ? (
              <span className="flex items-center gap-1 text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Polling every 2s
              </span>
            ) : (
              <span>Idle · {logs.length} entries loaded</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-slate-600">
            {errorCount > 0 && <span className="text-red-400">{errorCount} errors</span>}
            {successCount > 0 && <span className="text-emerald-400">{successCount} success</span>}
            <span>logs/{runState.bank || selectedBank}/today</span>
          </div>
        </div>
      </div>
    </div>
  );
}
