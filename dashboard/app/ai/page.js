import AIChat from '@/components/AIChat';
import AIAdvancedChat from '@/components/AIAdvancedChat';
import AIOfferImprover from '@/components/AIOfferImprover';
import { Bot } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function AIPage() {
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
            <Bot size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">AI Assistant</h1>
            <p className="text-sm text-slate-600 mt-1">Powered by DeepSeek AI for intelligent offer analysis</p>
          </div>
        </div>
      </div>

      {/* AI Features Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Simple Chat */}
        <AIChat />

        {/* Offer Improver */}
        <AIOfferImprover />
      </div>

      {/* Advanced Database Chat */}
      <AIAdvancedChat />
    </div>
  );
}
