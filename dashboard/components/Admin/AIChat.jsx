
'use client';
import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles } from 'lucide-react';

export default function AIChat() {
    const [messages, setMessages] = useState([
        { role: 'assistant', content: 'Hello! I can help you manage the offers database. Ask me to find, filter, or clean data.' }
    ]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!input.trim() || loading) return;

        const userMsg = { role: 'user', content: input };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setLoading(true);

        try {
            const res = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: input }),
            });

            if (!res.ok) throw new Error('Chat failed');

            const data = await res.json();
            setMessages(prev => [...prev, { role: 'assistant', content: data.reply, action: data.action }]);

        } catch (error) {
            console.error('Chat error:', error);
            setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I encountered an error answering that.' }]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-[600px] bg-white rounded-lg shadow-lg border border-gray-200">
            {/* Header */}
            <div className="p-4 border-b bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-t-lg flex items-center gap-2">
                <Sparkles size={20} />
                <h2 className="font-bold">Data Assistant Agent</h2>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
                {messages.map((msg, idx) => (
                    <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 
                ${msg.role === 'user' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'}`}>
                            {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                        </div>

                        <div className={`max-w-[80%] p-3 rounded-lg text-sm shadow-sm
                ${msg.role === 'user'
                                ? 'bg-blue-600 text-white rounded-br-none'
                                : 'bg-white text-gray-800 border border-gray-100 rounded-bl-none'}`}>
                            {msg.content}
                            {msg.action && (
                                <div className="mt-2 pt-2 border-t border-purple-100">
                                    <span className="text-xs font-mono bg-gray-100 px-1 py-0.5 rounded text-gray-600">
                                        Action: {msg.action.type}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
                {loading && (
                    <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center">
                            <Bot size={16} />
                        </div>
                        <div className="bg-white p-3 rounded-lg border border-gray-100 flex gap-1 items-center">
                            <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                            <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                            <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form onSubmit={handleSubmit} className="p-4 border-t bg-white rounded-b-lg">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Ask specific questions (e.g., 'Find all approved dining offers')..."
                        className="flex-1 p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                    <button
                        type="submit"
                        disabled={loading || !input.trim()}
                        className="bg-purple-600 text-white p-2 rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
                    >
                        <Send size={20} />
                    </button>
                </div>
            </form>
        </div>
    );
}
