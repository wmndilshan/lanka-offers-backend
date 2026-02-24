
'use client';
import { useState, useRef, useEffect } from 'react';
import { Play, Activity, Terminal as TerminalIcon, AlertCircle } from 'lucide-react';

export default function ScraperControl() {
    const [logs, setLogs] = useState([]);
    const [running, setRunning] = useState(false);
    const [selectedBank, setSelectedBank] = useState('all');
    const [action, setAction] = useState('scrape'); // 'scrape' or 'geocode'
    const logContainerRef = useRef(null);

    // Auto-scroll logs
    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs]);

    const runScraper = async () => {
        if (running) return;

        setRunning(true);
        setLogs([]); // Clear previous logs

        try {
            const response = await fetch('/api/scrapers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bank: selectedBank, action }),
            });

            if (!response.ok) {
                throw new Error(`Failed to start scraper: ${response.statusText}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.log) {
                                setLogs(prev => [...prev, data.log]);
                            }
                            if (data.done) {
                                setRunning(false);
                            }
                        } catch (e) {
                            console.error('Error parsing SSE data', e);
                        }
                    }
                }
            }
        } catch (error) {
            setLogs(prev => [...prev, `Error: ${error.message}`]);
            setRunning(false);
        }
    };

    return (
        <div className="bg-white rounded-lg shadow-lg border border-gray-200">
            <div className="p-4 border-b bg-gray-50 flex justify-between items-center rounded-t-lg">
                <div className="flex items-center gap-2">
                    <Activity className="text-blue-600" />
                    <h2 className="font-bold text-gray-800">Scraper Control Center</h2>
                </div>
                <div className="flex items-center gap-2">
                    {running && <span className="animate-pulse text-xs font-bold text-green-600 uppercase">Running...</span>}
                </div>
            </div>

            <div className="p-6">
                <div className="flex flex-wrap gap-4 mb-6 items-end">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Target Bank</label>
                        <select
                            value={selectedBank}
                            onChange={(e) => setSelectedBank(e.target.value)}
                            disabled={running}
                            className="p-2 border rounded-lg w-40 focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="all">All Banks</option>
                            <option value="hnb">HNB</option>
                            <option value="boc">BOC</option>
                            <option value="ndb">NDB</option>
                            <option value="seylan">Seylan</option>
                            <option value="peoples">Peoples</option>
                            <option value="sampath">Sampath</option>
                            <option value="dfcc">DFCC</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Action</label>
                        <select
                            value={action}
                            onChange={(e) => setAction(e.target.value)}
                            disabled={running}
                            className="p-2 border rounded-lg w-40 focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="scrape">Scrape Data</option>
                            <option value="geocode">Update Geocoding</option>
                        </select>
                    </div>

                    <button
                        onClick={runScraper}
                        disabled={running}
                        className={`px-6 py-2 rounded-lg font-bold text-white flex items-center gap-2 transition-all
                    ${running ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700 shadow-md transform hover:scale-105'}`}
                    >
                        <Play size={18} fill="currentColor" />
                        {running ? 'Running...' : 'Start Job'}
                    </button>
                </div>

                {/* Terminal Output */}
                <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm h-96 flex flex-col shadow-inner">
                    <div className="flex justify-between text-gray-400 text-xs mb-2 border-b border-gray-700 pb-2">
                        <span className="flex items-center gap-1"><TerminalIcon size={12} /> Console Output</span>
                        <span>{logs.length} lines</span>
                    </div>

                    <div ref={logContainerRef} className="flex-1 overflow-y-auto space-y-1">
                        {logs.length === 0 && !running && (
                            <div className="text-gray-500 italic text-center mt-20">Ready to start scraping job...</div>
                        )}

                        {logs.map((log, i) => (
                            <div key={i} className={`break-words ${log.includes('Error') || log.includes('Failed') ? 'text-red-400' : 'text-green-400'}`}>
                                <span className="text-gray-600 select-none mr-2">$</span>
                                {log.replace('[STDOUT] ', '').replace('[STDERR] ', '')}
                            </div>
                        ))}

                        {running && (
                            <div className="animate-pulse text-gray-500">_</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
