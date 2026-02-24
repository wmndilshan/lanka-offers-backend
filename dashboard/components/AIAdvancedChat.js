'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Trash2, Database } from 'lucide-react';

export default function AIAdvancedChat() {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: 'Hello! I can help you query and analyze your offers database using natural language. Try asking: "Show me all dining offers" or "How many pending offers do we have?"'
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage })
      });

      const data = await response.json();

      let assistantMessage = data.reply;

      // Format data results if present
      if (data.data && Array.isArray(data.data) && data.data.length > 0) {
        assistantMessage += '\n\n' + data.data.slice(0, 5).map(item =>
          `• ${item.merchantName || item.title}: ${item.discountDescription || ''} (${item.source})`
        ).join('\n');

        if (data.data.length > 5) {
          assistantMessage += `\n...and ${data.data.length - 5} more results`;
        }
      }

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: assistantMessage,
        data: data.data,
        action: data.action
      }]);
    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error processing your request. Make sure the database is configured.'
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClear = () => {
    setMessages([{
      role: 'assistant',
      content: 'Chat cleared. What would you like to know about your offers?'
    }]);
  };

  const suggestedQueries = [
    'Show me all dining offers',
    'How many offers are pending?',
    'List recent hotel offers',
    'Show offers from HNB'
  ];

  return (
    <div className="bg-white rounded-lg border border-slate-200 flex flex-col h-[600px]">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
            <Database size={16} className="text-white" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">AI Database Assistant</h2>
            <p className="text-xs text-slate-500">Natural language database queries</p>
          </div>
        </div>
        <button
          onClick={handleClear}
          className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
          title="Clear chat"
        >
          <Trash2 size={16} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'assistant' && (
              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                <Bot size={16} className="text-slate-600" />
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                msg.role === 'user'
                  ? 'bg-brand-500 text-white'
                  : 'bg-slate-50 text-slate-900'
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              {msg.action && (
                <div className="mt-2 pt-2 border-t border-slate-200">
                  <p className="text-xs text-slate-500">
                    Query: {msg.action.type}
                  </p>
                </div>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center flex-shrink-0">
                <User size={16} className="text-white" />
              </div>
            )}
          </div>
        ))}
        {isLoading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
              <Bot size={16} className="text-slate-600" />
            </div>
            <div className="bg-slate-50 rounded-lg px-4 py-2">
              <div className="flex gap-1">
                <div className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
            </div>
          </div>
        )}

        {/* Suggested Queries */}
        {messages.length === 1 && !isLoading && (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">Try these queries:</p>
            {suggestedQueries.map((query, idx) => (
              <button
                key={idx}
                onClick={() => setInput(query)}
                className="block w-full text-left px-3 py-2 text-sm text-slate-600 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
              >
                {query}
              </button>
            ))}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-slate-200 p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your offers database..."
            className="flex-1 px-4 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={16} />
          </button>
        </div>
      </form>
    </div>
  );
}
