'use client';

import { useState } from 'react';
import { Sparkles, Loader, CheckCircle, AlertCircle } from 'lucide-react';

export default function AIOfferImprover() {
  const [rawText, setRawText] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState(null);
  const [error, setError] = useState(null);

  const getSuggestions = async () => {
    if (!rawText.trim()) {
      setError('Please enter offer text');
      return;
    }

    setLoading(true);
    setError(null);
    setSuggestion(null);

    try {
      const response = await fetch('/api/ai/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText: rawText.trim() })
      });

      if (!response.ok) {
        throw new Error('Failed to get suggestions');
      }

      const data = await response.json();
      setSuggestion(data);
    } catch (err) {
      setError(err.message || 'Failed to generate suggestions');
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setRawText('');
    setSuggestion(null);
    setError(null);
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200">
      <div className="px-6 py-4 border-b border-slate-200">
        <h2 className="text-base font-semibold text-slate-900">AI Offer Improver</h2>
        <p className="text-xs text-slate-500 mt-1">Get AI-powered suggestions to improve offer data</p>
      </div>

      <div className="p-6 space-y-4">
        {/* Input Area */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Paste raw offer text
          </label>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="Example: Enjoy 20% discount at Hilton Colombo. Valid from 1st Jan to 31st Mar 2024. Applicable for HNB credit cards only."
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 min-h-24"
            disabled={loading}
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={getSuggestions}
            disabled={loading || !rawText.trim()}
            className="flex-1 px-4 py-2 bg-brand-500 text-white text-sm rounded-lg hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader size={16} className="animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles size={16} />
                Get AI Suggestions
              </>
            )}
          </button>

          {(suggestion || rawText) && (
            <button
              onClick={handleClear}
              disabled={loading}
              className="px-4 py-2 border border-slate-200 text-slate-700 text-sm rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="p-4 rounded-lg border bg-red-50 border-red-200">
            <div className="flex items-start gap-3">
              <AlertCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-900">Error</p>
                <p className="text-xs text-red-700 mt-1">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Suggestions */}
        {suggestion && (
          <div className="border-t border-slate-200 pt-4 space-y-4">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle size={20} />
              <span className="text-sm font-medium">AI Suggestions Generated</span>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <Field label="Title" value={suggestion.title} />
              <Field label="Merchant" value={suggestion.merchantName} />
              <Field label="Category" value={suggestion.category} />
              <Field label="Discount" value={suggestion.discountDescription} />

              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Valid From"
                  value={suggestion.validFrom || 'Not specified'}
                />
                <Field
                  label="Valid To"
                  value={suggestion.validTo || 'Not specified'}
                />
              </div>

              {suggestion.reasoning && (
                <div className="p-3 bg-slate-50 rounded-lg">
                  <p className="text-xs font-medium text-slate-700 mb-1">Reasoning</p>
                  <p className="text-xs text-slate-600">{suggestion.reasoning}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {!loading && !suggestion && !error && (
          <div className="text-center py-8 text-sm text-slate-500">
            Paste offer text and click "Get AI Suggestions" to analyze
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div className="p-3 bg-slate-50 rounded-lg">
      <p className="text-xs font-medium text-slate-700 mb-1">{label}</p>
      <p className="text-sm text-slate-900">{value}</p>
    </div>
  );
}
