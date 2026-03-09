import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, Bot, User, Loader2, Sparkles, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function AiChatbot() {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState([
        { role: 'assistant', text: 'Hello! I am your HR & Customs Management AI. Ask me about employee performance, team stats, or to make assignment changes.' }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        if (isOpen) {
            scrollToBottom();
        }
    }, [messages, isOpen]);

    const handleSend = async (e) => {
        e?.preventDefault();
        if (!input.trim() || isLoading) return;

        const userMsg = input.trim();
        setInput('');

        // Add to history locally
        const newMessages = [...messages, { role: 'user', text: userMsg }];
        setMessages(newMessages);
        setIsLoading(true);

        try {
            // Format chat_history for LangChain
            const chat_history = newMessages.slice(0, -1).map(m => {
                return m.role === 'user' ? ["human", m.text] : ["ai", m.text];
            });

            const res = await fetch('/api/statistics/ai/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: userMsg,
                    chat_history: chat_history
                })
            });

            if (!res.ok) {
                let errorDetails = "";
                try {
                    const errBody = await res.json();
                    errorDetails = errBody.error || errBody.details;
                } catch {
                    errorDetails = res.statusText;
                }
                throw new Error(`Failed to get AI response: ${errorDetails}`);
            }

            const data = await res.json();
            setMessages(prev => [...prev, { role: 'assistant', text: data.reply }]);

        } catch (err) {
            console.error("Chat error:", err);
            setMessages(prev => [...prev, {
                role: 'error',
                text: "My connection to the server was interrupted or an error occurred. Please try again."
            }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed bottom-6 right-6 z-[100] flex flex-col items-end">
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 20, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 20, scale: 0.95 }}
                        className="mb-4 bg-white rounded-xl shadow-2xl border border-blue-100 flex flex-col w-[400px] h-[500px] overflow-hidden"
                    >
                        {/* Header */}
                        <div className="bg-gradient-to-r from-blue-700 to-blue-600 px-4 py-3 flex items-center justify-between shadow-sm">
                            <div className="flex items-center gap-2 text-white">
                                <div className="p-1.5 bg-white/20 rounded-md">
                                    <Sparkles className="w-4 h-4" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-sm leading-tight">HR Intelligence AI</h3>
                                    <p className="text-[10px] text-blue-100 opacity-90">Powered by LangChain & Pyodide</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="text-white/80 hover:text-white p-1 rounded-md hover:bg-white/10 transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Chat Area */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
                            {messages.map((m, i) => (
                                <div key={i} className={`flex gap-3 max-w-[85%] ${m.role === 'user' ? 'ml-auto flex-row-reverse' : ''}`}>
                                    <div className="shrink-0 mt-1">
                                        {m.role === 'user' ? (
                                            <div className="w-7 h-7 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-700">
                                                <User className="w-4 h-4" />
                                            </div>
                                        ) : m.role === 'error' ? (
                                            <div className="w-7 h-7 bg-red-100 rounded-full flex items-center justify-center text-red-600">
                                                <AlertCircle className="w-4 h-4" />
                                            </div>
                                        ) : (
                                            <div className="w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-sm">
                                                <Bot className="w-4 h-4" />
                                            </div>
                                        )}
                                    </div>
                                    <div className={`px-3.5 py-2.5 rounded-2xl text-[13px] leading-relaxed shadow-sm whitespace-pre-wrap ${m.role === 'user'
                                            ? 'bg-indigo-600 text-white rounded-tr-sm'
                                            : m.role === 'error'
                                                ? 'bg-red-50 text-red-700 border border-red-100 rounded-tl-sm'
                                                : 'bg-white text-gray-800 border border-gray-100 rounded-tl-sm'
                                        }`}>
                                        {m.text}
                                    </div>
                                </div>
                            ))}
                            {isLoading && (
                                <div className="flex gap-3 max-w-[85%]">
                                    <div className="shrink-0 mt-1">
                                        <div className="w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-sm">
                                            <Bot className="w-4 h-4" />
                                        </div>
                                    </div>
                                    <div className="px-4 py-3 bg-white text-gray-800 border border-gray-100 rounded-2xl rounded-tl-sm shadow-sm flex items-center gap-2">
                                        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                                        <span className="text-xs text-gray-400 font-medium">Crunching data...</span>
                                    </div>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input Area */}
                        <div className="p-3 bg-white border-t border-gray-100">
                            <form onSubmit={handleSend} className="relative flex items-center">
                                <input
                                    type="text"
                                    value={input}
                                    onChange={e => setInput(e.target.value)}
                                    placeholder="e.g. Add Anas to the Import team..."
                                    className="w-full bg-gray-50 border border-gray-200 text-sm rounded-full pl-4 pr-12 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-gray-400"
                                    disabled={isLoading}
                                />
                                <button
                                    type="submit"
                                    disabled={!input.trim() || isLoading}
                                    className="absolute right-1.5 p-1.5 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-all"
                                >
                                    <Send className="w-3.5 h-3.5" />
                                </button>
                            </form>
                            <div className="text-center mt-2 aspect-auto space-x-2">
                                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Supports fuzzy matching & Python analysis</span>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`p-4 rounded-full shadow-xl transition-all flex items-center justify-center overflow-hidden relative group ${isOpen ? 'bg-slate-800 text-white hover:bg-slate-700' : 'bg-blue-600 text-white hover:bg-blue-700 hover:scale-105'
                    }`}
            >
                {isOpen ? (
                    <X className="w-6 h-6" />
                ) : (
                    <>
                        <MessageSquare className="w-6 h-6" />
                        <span className="absolute top-0 right-0 w-3 h-3 bg-red-500 border-2 border-white rounded-full flex items-center justify-center animate-pulse"></span>
                    </>
                )}
            </button>
        </div>
    );
}
