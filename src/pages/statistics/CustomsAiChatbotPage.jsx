import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ArrowUp, Plus, Sparkles, ChevronDown, MessageSquare, Trash2, EyeOff, Menu, X, Copy, Check, Download, ShieldCheck, Award, Layers, Info, Calendar, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '../../context/AuthContext';

const loadingStatuses = [
    "Consulting EUR-Lex...", "Searching GN 2026 Database...", "Validating Tariff Code...", "Drafting response..."
];

export default function CustomsAiChatbotPage() {
    const { user } = useAuth();
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [loadingText, setLoadingText] = useState(loadingStatuses[0]);

    const [chatId, setChatId] = useState(null);
    const [sidebarChats, setSidebarChats] = useState([]);
    const [isIncognito, setIsIncognito] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [isRestoring, setIsRestoring] = useState(true);
    const [copiedIndex, setCopiedIndex] = useState(null);
    const [followUpPills, setFollowUpPills] = useState([]);

    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);
    const userEmail = user?.email || user?.username || '';
    const userName = user?.name || user?.user || 'Declarant';

    const handleCopy = (text, index) => {
        navigator.clipboard.writeText(text);
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 2000);
    };

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => { scrollToBottom(); }, [messages, isLoading]);

    useEffect(() => {
        inputRef.current?.focus();
        if (chatId) {
            localStorage.setItem('dkm_customs_active_chat', JSON.stringify({
                chatId,
                timestamp: Date.now()
            }));
        }
    }, [chatId]);

    // Initial load: fetch chat history & attempt session restore
    useEffect(() => {
        if (!userEmail) return;

        fetch(`/api/statistics/customs/chats?user=${encodeURIComponent(userEmail)}`)
            .then(res => res.json())
            .then(async data => {
                setSidebarChats(data);

                // Restore previous active session (within 5 hours)
                const stored = localStorage.getItem('dkm_customs_active_chat');
                if (stored) {
                    try {
                        const parsed = JSON.parse(stored);
                        const fiveHours = 5 * 60 * 60 * 1000;
                        if (Date.now() - parsed.timestamp < fiveHours) {
                            const res = await fetch(`/api/statistics/customs/chats/${parsed.chatId}?user=${encodeURIComponent(userEmail)}`);
                            if (res.ok) {
                                const chatData = await res.json();
                                setMessages(chatData.messages || []);
                                setChatId(chatData.id);
                                setIsIncognito(chatData.isIncognito);
                            } else {
                                localStorage.removeItem('dkm_customs_active_chat');
                            }
                        } else {
                            localStorage.removeItem('dkm_customs_active_chat');
                        }
                    } catch {
                        localStorage.removeItem('dkm_customs_active_chat');
                    }
                }
                setIsRestoring(false);
            })
            .catch(() => setIsRestoring(false));
    }, [userEmail]);

    // Animate loading status text
    useEffect(() => {
        let interval;
        if (isLoading) {
            let i = 0;
            interval = setInterval(() => {
                i = (i + 1) % loadingStatuses.length;
                setLoadingText(loadingStatuses[i]);
            }, 2000);
        } else {
            setLoadingText(loadingStatuses[0]);
        }
        return () => clearInterval(interval);
    }, [isLoading]);

    const loadSidebarChats = () => {
        if (!userEmail) return;
        fetch(`/api/statistics/customs/chats?user=${encodeURIComponent(userEmail)}`)
            .then(res => res.json())
            .then(data => setSidebarChats(data))
            .catch(console.error);
    };

    const handleNewChat = () => {
        setChatId(null);
        setMessages([]);
        setInput('');
        setIsIncognito(false);
        setFollowUpPills([]);
        localStorage.removeItem('dkm_customs_active_chat');
        setTimeout(() => inputRef.current?.focus(), 100);
    };

    const handleSelectChat = async (id) => {
        try {
            const res = await fetch(`/api/statistics/customs/chats/${id}?user=${encodeURIComponent(userEmail)}`);
            if (!res.ok) throw new Error('Chat not found');
            const data = await res.json();
            setMessages(data.messages || []);
            setChatId(data.id);
            setFollowUpPills([]);
            setIsIncognito(data.isIncognito);
            if (window.innerWidth < 768) setIsSidebarOpen(false);
        } catch (err) {
            console.error('Failed to load chat', err);
        }
    };

    const handleDeleteChat = async (id, e) => {
        e.stopPropagation();
        if (!window.confirm('Delete this classification session?')) return;
        try {
            await fetch(`/api/statistics/customs/chats/${id}?user=${encodeURIComponent(userEmail)}`, { method: 'DELETE' });
            if (chatId === id) handleNewChat();
            loadSidebarChats();
        } catch (err) {
            console.error(err);
        }
    };

    const handleSend = async (e) => {
        e?.preventDefault();
        if (!input.trim() || isLoading) return;

        const userMsg = input.trim();
        setInput('');
        if (inputRef.current) inputRef.current.style.height = 'auto';

        let currentChatId = chatId;
        if (!currentChatId) {
            currentChatId = crypto.randomUUID();
            setChatId(currentChatId);
        }

        const newMessages = [...messages, { role: 'user', text: userMsg }];
        setMessages(newMessages);
        setIsLoading(true);
        setFollowUpPills([]);

        try {
            const chat_history = newMessages.slice(0, -1).map(m =>
                m.role === 'user' ? ['human', m.text] : ['ai', m.text]
            );

            const res = await fetch('/api/statistics/customs/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: userMsg,
                    user_name: userEmail,
                    chatId: currentChatId,
                    isIncognito,
                    chat_history
                })
            });

            if (!res.ok) throw new Error('Connection failed');

            setMessages(prev => [...prev, { role: 'assistant', text: '' }]);

            const reader = res.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let done = false;
            let currentResponse = '';
            let buffer = '';

            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value) {
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const dataStr = line.replace('data: ', '').trim();
                            if (!dataStr || dataStr === '[DONE]') continue;
                            try {
                                const parsed = JSON.parse(dataStr);
                                if (parsed.clear) {
                                    currentResponse = '';
                                    setMessages(prev => {
                                        const m = [...prev];
                                        m[m.length - 1].text = currentResponse;
                                        return m;
                                    });
                                }
                                if (parsed.error) throw new Error(parsed.error);
                                if (parsed.token) {
                                    currentResponse += parsed.token;
                                    setMessages(prev => {
                                        const m = [...prev];
                                        m[m.length - 1].text = currentResponse;
                                        return m;
                                    });
                                }
                                if (parsed.status) {
                                    setLoadingText(parsed.status);
                                }
                                if (parsed.done) {
                                    if (parsed.finalOutput && currentResponse !== parsed.finalOutput) {
                                        setMessages(prev => {
                                            const m = [...prev];
                                            m[m.length - 1].text = parsed.finalOutput;
                                            return m;
                                        });
                                    }
                                    if (!isIncognito) loadSidebarChats();
                                }
                                if (parsed.newTitle) {
                                    setSidebarChats(prev => prev.map(c =>
                                        c.id === parsed.chatId ? { ...c, title: parsed.newTitle } : c
                                    ));
                                }
                                if (parsed.pills) {
                                    setFollowUpPills(parsed.pills);
                                }
                            } catch { /* ignore non-json */ }
                        }
                    }
                }
            }
        } catch (err) {
            setMessages(prev => {
                const filtered = prev.filter((m, i) => !(i === prev.length - 1 && m.role === 'assistant'));
                return [...filtered, { role: 'error', text: err.message || 'Connection interrupted. Please try again.' }];
            });
        } finally {
            setIsLoading(false);
            setLoadingText(loadingStatuses[0]);
            setTimeout(() => inputRef.current?.focus(), 10);
        }
    };

    const handlePromptClick = (text) => {
        setInput(text);
        inputRef.current?.focus();
    };

    const handleInput = (e) => {
        setInput(e.target.value);
        e.target.style.height = 'auto';
        e.target.style.height = (e.target.scrollHeight < 200 ? e.target.scrollHeight : 200) + 'px';
    };

    const hasMessages = messages.length > 0;

    const markdownComponents = useMemo(() => ({
        table: ({ node, ...props }) => (
            <div className="overflow-x-auto my-4 rounded-lg border border-[#e5e5e5]">
                <table className="min-w-full divide-y divide-[#e5e5e5]" {...props} />
            </div>
        ),
        thead: ({ node, ...props }) => <thead className="bg-[#fafafa]" {...props} />,
        th: ({ node, ...props }) => <th className="px-4 py-2.5 text-left text-xs font-semibold text-[#666] uppercase tracking-wider" {...props} />,
        td: ({ node, ...props }) => <td className="px-4 py-2.5 text-sm text-[#333] border-t border-[#f0f0f0]" {...props} />,
        a: ({ node, ...props }) => <a className="text-primary hover:text-primary-dark underline underline-offset-2" {...props} />,
        strong: ({ node, ...props }) => <strong className="font-semibold text-[#111]" {...props} />,
        ul: ({ node, ...props }) => <ul className="list-disc pl-6 my-3 space-y-1" {...props} />,
        ol: ({ node, ...props }) => <ol className="list-decimal pl-6 my-3 space-y-1" {...props} />,
        h1: ({ node, ...props }) => <h1 className="text-xl font-semibold mt-6 mb-3 text-[#111]" {...props} />,
        h2: ({ node, ...props }) => <h2 className="text-lg font-semibold mt-5 mb-2 text-[#111]" {...props} />,
        h3: ({ node, ...props }) => <h3 className="text-base font-semibold mt-4 mb-2 text-[#111]" {...props} />,
        code({ node, inline, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';

            // 1. GENERATIVE UI - CUSTOMS LICENSE CARD
            if (!inline && language === 'customs-card') {
                try {
                    const cardData = JSON.parse(String(children).replace(/\n$/, ''));
                    return (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="my-6 relative border-2 border-primary/20 rounded-2xl overflow-hidden bg-white shadow-xl shadow-primary/5"
                        >
                            {/* Certificate Side Accent */}
                            <div className="absolute left-0 top-0 bottom-0 w-2 bg-gradient-to-b from-primary via-primary/60 to-primary/20" />

                            <div className="p-6">
                                <div className="flex items-start justify-between mb-6">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2.5 bg-primary/10 rounded-xl text-primary">
                                            <ShieldCheck size={28} />
                                        </div>
                                        <div>
                                            <h4 className="text-lg font-bold text-gray-900 leading-none">Customs Classification Certificate</h4>
                                            <p className="text-[12px] text-gray-500 mt-1 uppercase tracking-wider font-semibold">Authorized by DKM Intelligence</p>
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-end">
                                        <Award className="text-yellow-500/30" size={40} strokeWidth={1} />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6 mb-8">
                                    <div className="space-y-1">
                                        <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">HS / CN CODE</span>
                                        <div className="flex items-center gap-2">
                                            <span className="text-2xl font-mono font-bold text-primary tracking-tight">{cardData.code}</span>
                                            <div className="px-1.5 py-0.5 bg-green-50 text-green-600 text-[10px] font-bold rounded border border-green-100 italic">VERIFIED</div>
                                        </div>
                                    </div>

                                    <div className="space-y-1">
                                        <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">DUTY RATE</span>
                                        <div className="flex items-center gap-2">
                                            <span className="text-2xl font-bold text-gray-900">{cardData.duty}</span>
                                            <p className="text-[10px] text-gray-400 leading-tight">Subject to TARIC quotas and anti-dumping</p>
                                        </div>
                                    </div>

                                    <div className="col-span-1 md:col-span-2 space-y-2">
                                        <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">OFFICIAL DESCRIPTION</span>
                                        <p className="text-[14px] leading-relaxed text-gray-700 bg-gray-50/80 p-3 rounded-lg border border-gray-100 italic">
                                            "{cardData.description}"
                                        </p>
                                    </div>
                                </div>

                                <div className="pt-6 border-t border-gray-100 flex flex-wrap items-center justify-between gap-4">
                                    <div className="flex items-center gap-6">
                                        <div className="flex items-center gap-1.5 text-gray-500 text-[12px]">
                                            <Calendar size={14} />
                                            <span>Issued: {cardData.certifiedAt || new Date().toLocaleDateString()}</span>
                                        </div>
                                        <div className="flex items-center gap-1.5 text-gray-500 text-[12px]">
                                            <Info size={14} />
                                            <span>Origin: EU Nomenclature 2026</span>
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => {
                                            const content = `DKM CUSTOMS CLASSIFICATION\n--------------------------\nCODE: ${cardData.code}\nDUTY: ${cardData.duty}\nDESC: ${cardData.description}\nISSUED: ${cardData.certifiedAt}`;
                                            const blob = new Blob([content], { type: 'text/plain' });
                                            const url = URL.createObjectURL(blob);
                                            const a = document.createElement('a');
                                            a.href = url;
                                            a.download = `Classification_${cardData.code}.txt`;
                                            a.click();
                                        }}
                                        className="flex items-center gap-2 bg-primary text-white text-[13px] font-semibold px-4 py-2 rounded-lg hover:bg-primary-dark transition-all transform active:scale-95 shadow-lg shadow-primary/20"
                                    >
                                        <Download size={15} /> Export PDF/Print
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    );
                } catch (e) { console.error("Card error", e); }
            }

            // 2. GENERATIVE UI - KNOWLEDGE TREE (HIERARCHY VISUALIZATION)
            if (!inline && language === 'customs-tree') {
                try {
                    const treeData = JSON.parse(String(children).replace(/\n$/, ''));
                    return (
                        <div className="my-6 border border-gray-200 rounded-2xl overflow-hidden bg-gradient-to-br from-white to-gray-50/30">
                            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
                                <div className="flex items-center gap-2 text-gray-700">
                                    <Layers size={16} />
                                    <span className="text-[13px] font-bold uppercase tracking-wider">Classification Hierarchy</span>
                                </div>
                                <div className="text-[11px] text-gray-400 font-medium">Click to expand legal notes</div>
                            </div>
                            <div className="p-5 overflow-x-auto">
                                <div className="flex flex-col gap-2 min-w-[300px]">
                                    {treeData.levels?.map((level, i) => (
                                        <React.Fragment key={i}>
                                            <motion.div
                                                initial={{ x: -10, opacity: 0 }}
                                                animate={{ x: 0, opacity: 1 }}
                                                transition={{ delay: i * 0.1 }}
                                                className={`flex items-start gap-4 p-3 rounded-xl border transition-all ${i === treeData.levels.length - 1
                                                    ? 'bg-primary/5 border-primary/20 shadow-sm'
                                                    : 'bg-white border-gray-100 hover:border-gray-300'
                                                    }`}
                                            >
                                                <div className={`mt-0.5 w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${i === treeData.levels.length - 1 ? 'bg-primary text-white' : 'bg-gray-100 text-gray-500'}`}>
                                                    <span className="text-[12px] font-bold">{level.id || (i + 1)}</span>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between mb-1">
                                                        <span className="text-[10px] font-bold text-gray-400 tracking-widest uppercase">{level.type}</span>
                                                        {level.link && <ExternalLink size={12} className="text-primary hover:text-primary-dark cursor-pointer" />}
                                                    </div>
                                                    <p className={`text-[13px] leading-snug truncate-2-lines ${i === treeData.levels.length - 1 ? 'font-bold text-gray-900' : 'text-gray-600'}`}>
                                                        {level.label}
                                                    </p>
                                                </div>
                                            </motion.div>
                                            {i < treeData.levels.length - 1 && (
                                                <div className="ml-7 w-px h-3 bg-gray-200" />
                                            )}
                                        </React.Fragment>
                                    ))}
                                </div>
                            </div>
                        </div>
                    );
                } catch (e) { console.error("Tree error", e); }
            }

            return inline ? (
                <code className="bg-[#f0f0f0] text-[#c7254e] px-1.5 py-0.5 rounded text-[13px] font-mono" {...props}>
                    {children}
                </code>
            ) : (
                <code className="block bg-[#1e1e1e] text-[#d4d4d4] p-4 rounded-xl text-[13px] font-mono overflow-x-auto my-3 leading-relaxed" {...props}>
                    {children}
                </code>
            );
        }
    }), []);

    const displayPrompts = [
        { label: 'Classify a steel bolt', prompt: 'What is the classification for an M12 heavy-duty steel bolt?' },
        { label: 'Check HS 8529 90 90 90', prompt: 'Hi, Please confirm this complete hs code: 8529909090 => 8529 90 96 00 double check' },
        { label: 'Aluminum LED frame', prompt: 'It is a 3D corner frame for LED displays made of aluminum' },
        { label: 'Confirm smartphone code', prompt: 'Can you confirm the HS code for a generic 5G smartphone?' }
    ];

    const renderInputBox = (placeholder = 'Describe a product or enter an HS/CN code...') => (
        <div className="w-full max-w-[48rem] mx-auto">
            <div className="border border-[#d9d9d9] rounded-2xl bg-white focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10 transition-colors overflow-hidden">
                <textarea
                    ref={inputRef}
                    value={input}
                    onChange={handleInput}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                    }}
                    placeholder={placeholder}
                    className="w-full bg-transparent min-h-[44px] max-h-[200px] text-[15px] resize-none px-4 pt-3 pb-1 focus:outline-none placeholder:text-[#999] text-[#2d2d2d]"
                    disabled={isLoading}
                    rows={1}
                />
                <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
                    <button onClick={handleNewChat} className="w-8 h-8 rounded-lg flex items-center justify-center text-[#7a7a7a] hover:bg-[#f2f2f2] transition-colors" title="New classification">
                        <Plus size={18} strokeWidth={2} />
                    </button>
                    <div className="flex items-center gap-2">
                        {isIncognito && (
                            <span className="flex items-center gap-1 text-[12px] text-gray-500 font-medium px-2 bg-gray-100 rounded-full h-6">
                                <EyeOff size={12} /> Incognito
                            </span>
                        )}
                        <button className="flex items-center gap-1 text-[13px] text-primary/70 hover:text-primary transition-colors px-1">
                            <Sparkles size={13} />
                            Customs Agent
                        </button>
                        <button
                            onClick={handleSend}
                            disabled={!input.trim() || isLoading}
                            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${!input.trim() || isLoading
                                ? 'text-[#c5c5c5] cursor-not-allowed'
                                : 'bg-primary text-white hover:bg-primary-dark'
                                }`}
                        >
                            <ArrowUp size={18} strokeWidth={2} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="flex w-full h-[calc(100vh-0px)] bg-white overflow-hidden relative">

            {/* Mobile toggle when sidebar is closed */}
            {!isSidebarOpen && window.innerWidth < 768 && (
                <button onClick={() => setIsSidebarOpen(true)} className="absolute top-4 left-4 z-50 p-2 bg-white rounded-md shadow-sm border border-gray-200">
                    <Menu size={18} />
                </button>
            )}

            {/* Sidebar */}
            <AnimatePresence initial={false}>
                {isSidebarOpen && (
                    <motion.div
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 260, opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        className="h-full bg-[#f9f9f9] border-r border-[#e5e5e5] shrink-0 flex flex-col absolute md:relative z-40 overflow-hidden shadow-xl md:shadow-none"
                    >
                        <div className="p-3 flex items-center justify-between">
                            <button
                                onClick={handleNewChat}
                                className="flex-1 flex items-center gap-2 px-3 py-2 bg-white border border-[#d9d9d9] rounded-lg hover:bg-gray-50 text-[14px] text-[#333] transition-colors"
                            >
                                <Plus size={16} /> New classification
                            </button>
                            {window.innerWidth < 768 && (
                                <button onClick={() => setIsSidebarOpen(false)} className="ml-2 p-2 text-gray-400">
                                    <X size={18} />
                                </button>
                            )}
                        </div>

                        <div className="flex-1 overflow-y-auto px-3 py-2">
                            {sidebarChats.length > 0 ? (
                                <div>
                                    <h3 className="text-[11px] font-semibold text-[#999] uppercase tracking-wider mb-2 px-2">History</h3>
                                    <div className="space-y-1">
                                        {sidebarChats.map(chat => (
                                            <div
                                                key={chat.id}
                                                onClick={() => handleSelectChat(chat.id)}
                                                className={`group flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${chatId === chat.id ? 'bg-[#ebebeb] text-[#111]' : 'hover:bg-[#f0f0f0] text-[#333]'}`}
                                            >
                                                <div className="flex items-center gap-3 overflow-hidden text-[13px]">
                                                    <MessageSquare size={14} className="shrink-0 text-[#888]" />
                                                    <span className="truncate">{chat.title}</span>
                                                </div>
                                                <button
                                                    onClick={(e) => handleDeleteChat(chat.id, e)}
                                                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 transition-opacity"
                                                >
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="px-2 text-[12px] text-gray-400 pt-4">No recent sessions</div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col h-full bg-white relative">

                {/* Topbar */}
                <div className="shrink-0 flex items-center justify-between px-6 h-12 border-b border-[#f0f0f0]">
                    <div className="flex items-center gap-2">
                        {isSidebarOpen && window.innerWidth >= 768 && (
                            <button onClick={() => setIsSidebarOpen(false)} className="mr-2 p-1.5 text-[#999] hover:bg-[#f2f2f2] rounded-md transition-colors" title="Close sidebar">
                                <Menu size={16} />
                            </button>
                        )}
                        {!isSidebarOpen && window.innerWidth >= 768 && (
                            <button onClick={() => setIsSidebarOpen(true)} className="mr-2 p-1.5 text-[#999] hover:bg-[#f2f2f2] rounded-md transition-colors" title="Open sidebar">
                                <Menu size={16} />
                            </button>
                        )}
                        <button className="flex items-center gap-1.5 text-[14px] font-medium text-[#2d2d2d] hover:text-primary transition-colors">
                            <Sparkles size={14} className="text-primary" />
                            EU Customs Desk
                            <ChevronDown size={14} className="text-[#999]" />
                        </button>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setIsIncognito(!isIncognito)}
                            disabled={hasMessages}
                            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${hasMessages ? 'opacity-50 cursor-not-allowed text-[#ccc]' : isIncognito ? 'bg-red-50 text-red-500' : 'hover:bg-[#f2f2f2] text-[#999] hover:text-[#333]'}`}
                            title={hasMessages ? 'Cannot change after conversation starts' : 'Toggle Incognito'}
                        >
                            <EyeOff size={16} />
                        </button>
                    </div>
                </div>

                {/* Body */}
                {isRestoring ? (
                    <div className="flex-1 flex flex-col items-center justify-center">
                        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : !hasMessages ? (
                    <div className="flex-1 flex flex-col items-center justify-center px-4 md:px-8">
                        <div className="w-full max-w-[48rem] flex flex-col items-center mb-6 text-center">
                            <h1 className="text-[28px] font-semibold text-[#1a1a1a] mb-2 leading-tight">
                                Hello, {userName}.
                            </h1>
                            <p className="text-[#999] text-[15px]">I am Alex, your licensed EU Customs declarant. Powered by GN 2026.</p>
                        </div>

                        {renderInputBox()}

                        <div className="w-full max-w-[48rem] mt-6">
                            <p className="text-[11px] font-semibold text-[#999] uppercase tracking-wider mb-2 ml-1">Suggested for you</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                {displayPrompts.map((item, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => handlePromptClick(item.prompt)}
                                        className="text-left py-3 px-4 rounded-xl border border-[#e5e5e5] hover:border-primary/30 hover:bg-primary/5 text-[13px] font-medium text-[#555] hover:text-[#222] transition-all truncate"
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="flex-1 overflow-y-auto min-h-0">
                            <div className="max-w-[48rem] mx-auto px-5 pt-6 pb-4">
                                <AnimatePresence>
                                    {messages.map((m, i) => (
                                        <motion.div
                                            key={i}
                                            initial={{ opacity: 0, y: 6 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ duration: 0.2 }}
                                            className="mb-6 last:mb-2"
                                        >
                                            {m.role === 'user' ? (
                                                <div className="flex justify-end">
                                                    <div className="max-w-[80%] px-4 py-3 bg-[#f4f4f4] text-[#2d2d2d] rounded-3xl text-[15px] leading-[1.6] whitespace-pre-wrap">
                                                        {m.text}
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="w-full relative group">
                                                    {m.role === 'error' ? (
                                                        <div className="text-red-600 text-[15px] leading-[1.7] bg-red-50 p-3 rounded-xl">{m.text}</div>
                                                    ) : (
                                                        <div>
                                                            <div className="prose prose-neutral max-w-none text-[15px] text-[#2d2d2d]">
                                                                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                                                    {m.text}
                                                                </ReactMarkdown>
                                                            </div>
                                                            <div className="mt-1 flex opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                                                <button
                                                                    onClick={() => handleCopy(m.text, i)}
                                                                    className="flex items-center justify-center p-1.5 rounded-md hover:bg-[#f2f2f2] text-[#888] transition-colors"
                                                                    title="Copy message"
                                                                >
                                                                    {copiedIndex === i ? <Check size={15} className="text-green-500" /> : <Copy size={15} />}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </motion.div>
                                    ))}
                                </AnimatePresence>

                                {isLoading && (!messages.length || messages[messages.length - 1].text === '') && (
                                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-4">
                                        <div className="flex items-center gap-2 py-1">
                                            <div className="flex gap-1">
                                                <div className="w-1.5 h-1.5 bg-[#aaa] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                                <div className="w-1.5 h-1.5 bg-[#aaa] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                                <div className="w-1.5 h-1.5 bg-[#aaa] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                            </div>
                                            <span className="text-[13px] text-[#999]">{loadingText}</span>
                                        </div>
                                    </motion.div>
                                )}

                                {followUpPills.length > 0 && !isLoading && (
                                    <div className="flex flex-wrap gap-2 mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                        {followUpPills.map((pill, idx) => (
                                            <button
                                                key={idx}
                                                onClick={() => handlePromptClick(pill)}
                                                className="px-4 py-2 bg-gradient-to-br from-[#f8f9fc] to-white border border-[#e2e8f0] text-[#475569] text-[13px] font-medium rounded-full hover:border-[#cbd5e1] hover:text-[#0f172a] hover:shadow-sm transition-all"
                                            >
                                                {pill}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                <div ref={messagesEndRef} />
                            </div>
                        </div>

                        {/* Bottom pinned input */}
                        <div className="shrink-0 px-5 pt-2 pb-3 bg-white">
                            {renderInputBox()}
                            <p className="text-center mt-2 text-[12px] text-[#b0b0b0]">
                                Always verify duty rates with official EU TARIC databases.
                            </p>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
