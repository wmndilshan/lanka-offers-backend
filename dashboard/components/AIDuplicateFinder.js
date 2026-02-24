'use client';

import { useState } from 'react';
import { Search, CheckCircle, AlertCircle, Loader } from 'lucide-react';

export default function AIDuplicateFinder() {
  const [type, setType] = useState('merchantName');
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState([]);
  const [selected, setSelected] = useState([]);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState(null);

  const analyzeDuplicates = async () => {
    setLoading(true);
    setResult(null);
    setGroups([]);
    setSelected([]);

    try {
      const response = await fetch(`/api/ai/cleanup/analyze?type=${type}`);
      const data = await response.json();

      if (data.groups) {
        setGroups(data.groups);
        // Auto-select all groups
        setSelected(data.groups.map((_, idx) => idx));
      }
    } catch (error) {
      setResult({
        success: false,
        message: 'Failed to analyze duplicates: ' + error.message
      });
    } finally {
      setLoading(false);
    }
  };

  const applyMerges = async () => {
    if (selected.length === 0) {
      setResult({
        success: false,
        message: 'Please select at least one group to merge'
      });
      return;
    }

    setApplying(true);
    setResult(null);

    try {
      const merges = selected.map(idx => groups[idx]);
      const response = await fetch('/api/ai/cleanup/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merges, type })
      });

      const data = await response.json();
      setResult({
        success: true,
        message: data.message,
        details: data.details
      });

      // Clear groups after successful merge
      setGroups([]);
      setSelected([]);
    } catch (error) {
      setResult({
        success: false,
        message: 'Failed to apply merges: ' + error.message
      });
    } finally {
      setApplying(false);
    }
  };

  const toggleSelection = (idx) => {
    setSelected(prev =>
      prev.includes(idx)
        ? prev.filter(i => i !== idx)
        : [...prev, idx]
    );
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200">
      <div className="px-6 py-4 border-b border-slate-200">
        <h2 className="text-base font-semibold text-slate-900">AI Duplicate Finder</h2>
        <p className="text-xs text-slate-500 mt-1">Find and merge duplicate merchant names or categories using AI</p>
      </div>

      <div className="p-6 space-y-4">
        {/* Type Selection */}
        <div className="flex gap-3">
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
            disabled={loading || applying}
          >
            <option value="merchantName">Merchant Names</option>
            <option value="category">Categories</option>
          </select>

          <button
            onClick={analyzeDuplicates}
            disabled={loading || applying}
            className="px-4 py-2 bg-brand-500 text-white text-sm rounded-lg hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {loading ? (
              <>
                <Loader size={16} className="animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Search size={16} />
                Find Duplicates
              </>
            )}
          </button>
        </div>

        {/* Results */}
        {groups.length > 0 && (
          <>
            <div className="border-t border-slate-200 pt-4">
              <p className="text-sm font-medium text-slate-900 mb-3">
                Found {groups.length} duplicate group{groups.length !== 1 ? 's' : ''}
              </p>

              <div className="space-y-2 max-h-64 overflow-y-auto">
                {groups.map((group, idx) => (
                  <label
                    key={idx}
                    className="flex items-start gap-3 p-3 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(idx)}
                      onChange={() => toggleSelection(idx)}
                      className="mt-0.5"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-slate-900">
                        Merge to: <span className="text-brand-600">{group.canonical}</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        Variations: {group.variations.join(', ')}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <button
              onClick={applyMerges}
              disabled={selected.length === 0 || applying}
              className="w-full px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {applying ? (
                <>
                  <Loader size={16} className="animate-spin" />
                  Applying Merges...
                </>
              ) : (
                <>
                  Apply {selected.length} Merge{selected.length !== 1 ? 's' : ''}
                </>
              )}
            </button>
          </>
        )}

        {/* Result Message */}
        {result && (
          <div className={`p-4 rounded-lg border ${
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
                  <div className="mt-2 space-y-1">
                    {result.details.map((detail, idx) => (
                      <p key={idx} className="text-xs text-slate-600">
                        {detail.canonical}: {detail.updatedCount} records updated
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {!loading && groups.length === 0 && !result && (
          <div className="text-center py-8 text-sm text-slate-500">
            Click "Find Duplicates" to analyze your data
          </div>
        )}
      </div>
    </div>
  );
}
