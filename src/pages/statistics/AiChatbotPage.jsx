import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ArrowUp, Plus, Sparkles, ChevronDown, Settings, MessageSquare, Trash2, EyeOff, Menu, X, Copy, Check, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useAuth } from '../../context/AuthContext';
import CustomInstructionsModal from '../../components/statistics/CustomInstructionsModal';

async function fetchCustomInstructions(userEmail) {
    try {
        const res = await fetch(`/api/ai/instructions?user=${encodeURIComponent(userEmail)}`);
        if (!res.ok) return null;
        const data = await res.json();
        return data.instructions || null;
    } catch {
        return null;
    }
}

function buildCustomInstructionsText(instructions) {
    if (!instructions) return '';
    const parts = [];
    if (instructions.aboutUser?.trim()) parts.push(`About the user: ${instructions.aboutUser.trim()}`);
    if (instructions.responseStyle?.trim()) parts.push(`Response preferences: ${instructions.responseStyle.trim()}`);
    return parts.join('\n');
}

const loadingStatuses = [
    "Thinking...", "Reviewing data...", "Connecting dots...", "Drafting response..."
];

export default function AiChatbotPage() {
    const { user } = useAuth();
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [loadingText, setLoadingText] = useState(loadingStatuses[0]);

    // Core state for new features
    const [chatId, setChatId] = useState(null);
    const [sidebarChats, setSidebarChats] = useState([]);
    const [shortcuts, setShortcuts] = useState([]);
    const [isIncognito, setIsIncognito] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [isRestoring, setIsRestoring] = useState(true);
    const [copiedIndex, setCopiedIndex] = useState(null);
    const [followUpPills, setFollowUpPills] = useState([]);

    const handleCopy = (text, index) => {
        navigator.clipboard.writeText(text);
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 2000);
    };

    const [showInstructions, setShowInstructions] = useState(false);
    const [cachedInstructions, setCachedInstructions] = useState(null);

    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);
    const userEmail = user?.email || user?.username || '';
    const userName = user?.name || user?.user || "User";

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isLoading]);

    useEffect(() => {
        inputRef.current?.focus();

        // Persist the active chat so it survives page reloads
        if (chatId) {
            localStorage.setItem('dkm_hr_active_chat', JSON.stringify({
                chatId: chatId,
                timestamp: Date.now()
            }));
        }
    }, [chatId]);

    // Initial Load - Custom Instructions, Chats, Shortcuts
    useEffect(() => {
        if (!userEmail) return;

        fetchCustomInstructions(userEmail).then(data => {
            if (data) setCachedInstructions(data);
        });

        // Fetch chats and attempt to restore previous active session
        fetch(`/api/statistics/ai/chats?user=${encodeURIComponent(userEmail)}`)
            .then(res => res.json())
            .then(async data => {
                setSidebarChats(data);

                // Attempt to restore persistent chat (within 5 hours)
                const storedPersist = localStorage.getItem('dkm_hr_active_chat');
                if (storedPersist) {
                    try {
                        const parsed = JSON.parse(storedPersist);
                        const fiveHoursMs = 5 * 60 * 60 * 1000;
                        if (Date.now() - parsed.timestamp < fiveHoursMs) {
                            // Try loading the persistent chat directly
                            const res = await fetch(`/api/statistics/ai/chats/${parsed.chatId}?user=${encodeURIComponent(userEmail)}`);
                            if (res.ok) {
                                const chatData = await res.json();
                                setMessages(chatData.messages || []);
                                setChatId(chatData.id);
                                setIsIncognito(chatData.isIncognito);
                            } else {
                                localStorage.removeItem('dkm_hr_active_chat');
                            }
                        } else {
                            localStorage.removeItem('dkm_hr_active_chat');
                        }
                    } catch (e) {
                        localStorage.removeItem('dkm_hr_active_chat');
                    }
                }
                setIsRestoring(false);
            })
            .catch(err => {
                console.error(err);
                setIsRestoring(false);
            });

        fetch(`/api/statistics/ai/shortcuts?user=${encodeURIComponent(userEmail)}`)
            .then(res => res.json())
            .then(data => setShortcuts(data))
            .catch(console.error);

    }, [userEmail]);

    const loadSidebarChats = () => {
        if (!userEmail) return;
        fetch(`/api/statistics/ai/chats?user=${encodeURIComponent(userEmail)}`)
            .then(res => res.json())
            .then(data => setSidebarChats(data))
            .catch(console.error);
    };

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

    const handleNewChat = () => {
        setChatId(null);
        setMessages([]);
        setInput('');
        setIsIncognito(false);
        setFollowUpPills([]);
        localStorage.removeItem('dkm_hr_active_chat');
        setTimeout(() => inputRef.current?.focus(), 100);
    };

    const handleSelectChat = async (id) => {
        try {
            const res = await fetch(`/api/statistics/ai/chats/${id}?user=${encodeURIComponent(userEmail)}`);
            if (!res.ok) throw new Error("Chat not found");
            const data = await res.json();
            setMessages(data.messages || []);
            setChatId(data.id);
            setFollowUpPills([]);
            setIsIncognito(data.isIncognito);
            if (window.innerWidth < 768) setIsSidebarOpen(false);
        } catch (err) {
            console.error("Failed to load chat", err);
        }
    };

    const handleDeleteChat = async (id, e) => {
        e.stopPropagation();
        if (!window.confirm("Are you sure you want to delete this chat? This action cannot be undone.")) return;
        try {
            await fetch(`/api/statistics/ai/chats/${id}?user=${encodeURIComponent(userEmail)}`, { method: 'DELETE' });
            if (chatId === id) {
                handleNewChat();
            }
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
            const chat_history = newMessages.slice(0, -1).map(m => {
                return m.role === 'user' ? ["human", m.text] : ["ai", m.text];
            });

            const customInstructions = buildCustomInstructionsText(cachedInstructions);

            const res = await fetch('/api/statistics/ai/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: userMsg,
                    user_name: userEmail, // Unique ID for logs and history mapping
                    chatId: currentChatId,
                    isIncognito: isIncognito,
                    chat_history: chat_history,
                    ...(customInstructions && { custom_instructions: customInstructions })
                })
            });

            if (!res.ok) throw new Error("Connection failed");

            // Prepare UI for streaming response
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
                    buffer = lines.pop() || ''; // keep the last potentially incomplete line in buffer

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const dataStr = line.replace('data: ', '').trim();
                            if (!dataStr || dataStr === '[DONE]') continue;
                            try {
                                const parsed = JSON.parse(dataStr);
                                if (parsed.clear) {
                                    currentResponse = "";
                                    setMessages(prev => {
                                        const newMsgs = [...prev];
                                        newMsgs[newMsgs.length - 1].text = currentResponse;
                                        return newMsgs;
                                    });
                                }
                                if (parsed.error) {
                                    throw new Error(parsed.error);
                                }
                                if (parsed.token) {
                                    currentResponse += parsed.token;
                                    setMessages(prev => {
                                        const newMsgs = [...prev];
                                        newMsgs[newMsgs.length - 1].text = currentResponse;
                                        return newMsgs;
                                    });
                                }
                                if (parsed.status) {
                                    setLoadingText(parsed.status);
                                }
                                if (parsed.done) {
                                    // Make sure final text is caught
                                    if (parsed.finalOutput && currentResponse !== parsed.finalOutput) {
                                        setMessages(prev => {
                                            const newMsgs = [...prev];
                                            newMsgs[newMsgs.length - 1].text = parsed.finalOutput;
                                            return newMsgs;
                                        });
                                    }
                                    if (!isIncognito) {
                                        loadSidebarChats();
                                    }
                                }
                                if (parsed.newTitle) {
                                    setSidebarChats(prev => prev.map(c => c.id === parsed.chatId ? { ...c, title: parsed.newTitle } : c));
                                }
                                if (parsed.pills) {
                                    setFollowUpPills(parsed.pills);
                                }
                            } catch (e) {
                                // Ignore non-json lines
                            }
                        }
                    }
                }
            }

        } catch (err) {
            setMessages(prev => {
                // Remove the partially generated text or empty text, replace with error
                const filtered = prev.filter((m, i) => !(i === prev.length - 1 && m.role === 'assistant'));
                return [...filtered, {
                    role: 'error',
                    text: err.message || "My connection to the server was interrupted. Please try again."
                }];
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

    const renderInputBox = (placeholder = "Message HR Intelligence...") => (
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
                    <button onClick={handleNewChat} className="w-8 h-8 rounded-lg flex items-center justify-center text-[#7a7a7a] hover:bg-[#f2f2f2] transition-colors" title="Start new context">
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
                            HR Agent
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

    const markdownComponents = useMemo(() => ({
        table: ({ node, ...props }) => (
            <div className="overflow-x-auto my-4 rounded-lg border border-[#e5e5e5]"><table className="min-w-full divide-y divide-[#e5e5e5]" {...props} /></div>
        ),
        thead: ({ node, ...props }) => <thead className="bg-[#fafafa]" {...props} />,
        th: ({ node, ...props }) => <th className="px-4 py-2.5 text-left text-xs font-semibold text-[#666] uppercase tracking-wider" {...props} />,
        td: ({ node, ...props }) => <td className="px-4 py-2.5 text-sm text-[#333] border-t border-[#f0f0f0]" {...props} />,
        a: ({ node, ...props }) => {
            if (props.href && props.href.startsWith('cite:')) {
                const source = decodeURIComponent(props.href.replace('cite:', ''));
                return (
                    <span className="group relative inline-flex items-center justify-center cursor-help">
                        <span className="px-1.5 py-0.5 mx-0.5 bg-[#eff6ff] text-[#2563eb] font-semibold rounded-[4px] border border-[#bfdbfe] hover:bg-[#dbeafe] transition-colors text-[13px] align-baseline leading-none shadow-sm">{props.children}</span>
                        <span className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-[#1e1e1e] border border-[#333] text-white text-[11px] font-medium px-2.5 py-1.5 rounded-[6px] shadow-xl whitespace-nowrap pointer-events-none z-50">
                            Source: {source}
                            <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#1e1e1e]"></span>
                        </span>
                    </span>
                );
            }
            return <a className="text-primary hover:text-primary-dark underline underline-offset-2" {...props} />;
        },
        strong: ({ node, ...props }) => <strong className="font-semibold text-[#111]" {...props} />,
        ul: ({ node, ...props }) => <ul className="list-disc pl-6 my-3 space-y-1" {...props} />,
        ol: ({ node, ...props }) => <ol className="list-decimal pl-6 my-3 space-y-1" {...props} />,
        h1: ({ node, ...props }) => <h1 className="text-xl font-semibold mt-6 mb-3 text-[#111]" {...props} />,
        h2: ({ node, ...props }) => <h2 className="text-lg font-semibold mt-5 mb-2 text-[#111]" {...props} />,
        h3: ({ node, ...props }) => <h3 className="text-base font-semibold mt-4 mb-2 text-[#111]" {...props} />,
        code({ node, inline, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';

            // 1. GENERATIVE UI - CHART
            if (!inline && language === 'chart') {
                try {
                    const chartData = JSON.parse(String(children).replace(/\n$/, ''));
                    return (
                        <div className="my-6 border border-[#e5e5e5] rounded-xl overflow-hidden bg-white shadow-sm">
                            <div className="px-5 py-3.5 border-b border-[#e5e5e5] bg-gray-50/50">
                                <h4 className="font-semibold text-gray-800 text-[15px]">{chartData.title || "Interactive Chart"}</h4>
                            </div>
                            <div className="p-5" style={{ height: 320, width: '100%' }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={chartData.data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                                        <XAxis dataKey={chartData.xAxisKey || "name"} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#888' }} />
                                        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#888' }} />
                                        <Tooltip cursor={{ fill: '#f5f5f5' }} contentStyle={{ borderRadius: '8px', border: '1px solid #eee', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                                        {chartData.bars?.map((bar, i) => (
                                            <Bar key={i} dataKey={bar.key} fill={bar.color || '#3b82f6'} radius={[4, 4, 0, 0]} name={bar.name || bar.key} />
                                        ))}
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    );
                } catch (e) {
                    console.error("Failed to parse chart data", e);
                }
            }

            // 2. GENERATIVE UI - DASHBOARD CARDS
            if (!inline && language === 'dashboard') {
                try {
                    const dashData = JSON.parse(String(children).replace(/\n$/, ''));
                    return (
                        <div className="my-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {dashData.metrics?.map((m, i) => (
                                <div key={i} className="bg-white border border-[#e5e5e5] rounded-xl p-5 shadow-sm flex flex-col justify-between">
                                    <span className="text-[11px] text-[#777] font-bold uppercase tracking-wider mb-3 leading-[1.4] pr-2 break-words">{m.title}</span>
                                    <div className="flex items-baseline gap-2 mt-auto">
                                        <span className="text-[28px] leading-[1] font-bold text-[#111]">{m.value}</span>
                                        {m.trend !== undefined && (
                                            <span className={`text-[13px] font-medium ${m.trend > 0 ? 'text-green-500' : 'text-red-500'}`}>
                                                {m.trend > 0 ? '+' : ''}{m.trend}%
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    );
                } catch (e) {
                    console.error("Failed to parse dashboard data", e);
                }
            }

            // 3. GENERATIVE UI - EXCEL/CSV BUTTON
            if (!inline && language === 'export') {
                try {
                    const exportData = JSON.parse(String(children).replace(/\n$/, ''));
                    const handleDownload = () => {
                        if (!exportData.data || !exportData.data.length) return;
                        const headers = Object.keys(exportData.data[0]);
                        const csvLines = [];
                        csvLines.push(headers.join(","));
                        exportData.data.forEach(row => {
                            const values = headers.map(header => {
                                const val = row[header];
                                const str = val === null || val === undefined ? '' : String(val);
                                return `"${str.replace(/"/g, '""')}"`;
                            });
                            csvLines.push(values.join(","));
                        });
                        const csvData = "\uFEFF" + csvLines.join("\n"); // Excel UTF-8 BOM
                        const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = exportData.filename || 'export.csv';
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                    };

                    return (
                        <div className="my-6 border border-[#e5e5e5] rounded-xl overflow-hidden shadow-sm flex items-center justify-between p-4 bg-gradient-to-r from-[#fbfbfb] to-white">
                            <div>
                                <h4 className="font-semibold text-[#222] text-[15px]">{exportData.title || "Data Export Ready"}</h4>
                                <p className="text-[13px] text-[#777] mt-0.5">{exportData.description || "Click to download as CSV"}</p>
                            </div>
                            <button
                                onClick={handleDownload}
                                className="flex items-center gap-1.5 bg-[#eff6ff] hover:bg-[#dbeafe] text-[#2563eb] font-medium text-[13px] px-3.5 py-2 rounded-lg transition-colors border border-[#bfdbfe]"
                            >
                                <Download size={15} /> Download CSV
                            </button>
                        </div>
                    );
                } catch (e) {
                    console.error("Failed to parse export data", e);
                }
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

    // Default static prompts if API shortcuts are few
    const defaultPrompts = [
        { label: "Who is on the import team?", prompt: "Who is on the import team this week?" },
        { label: "Analyze Fadwa's performance", prompt: "Analyze Fadwa's performance footprint and top preferred clients." },
        { label: "Export team summary", prompt: "Summarize the entire export team's performance metrics." },
        { label: "Auto-assign high volume users", prompt: "Auto-assign high volume users into their optimal departments" }
    ];

    // Merge standard prompts with user's specific frequent shortcuts if available
    const displayPrompts = shortcuts.length >= 2
        ? shortcuts.slice(0, 4).map(s => ({ label: s.length > 35 ? s.slice(0, 32) + '...' : s, prompt: s }))
        : defaultPrompts;

    return (
        <div className="flex w-full h-[calc(100vh-0px)] bg-white overflow-hidden relative">

            {/* Sidebar Overlay (Mobile) */}
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
                                <Plus size={16} /> New chat
                            </button>
                            {window.innerWidth < 768 && (
                                <button onClick={() => setIsSidebarOpen(false)} className="ml-2 p-2 text-gray-400">
                                    <X size={18} />
                                </button>
                            )}
                        </div>

                        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-6">
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
                                <div className="px-2 text-[12px] text-gray-400 pt-4">No recent chats</div>
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
                            <button onClick={() => setIsSidebarOpen(false)} className="mr-2 p-1.5 object-cover text-[#999] hover:bg-[#f2f2f2] rounded-md transition-colors" title="Close sidebar">
                                <Menu size={16} />
                            </button>
                        )}
                        {!isSidebarOpen && window.innerWidth >= 768 && (
                            <button onClick={() => setIsSidebarOpen(true)} className="mr-2 p-1.5 object-cover text-[#999] hover:bg-[#f2f2f2] rounded-md transition-colors" title="Open sidebar">
                                <Menu size={16} />
                            </button>
                        )}
                        <button className="flex items-center gap-1.5 text-[14px] font-medium text-[#2d2d2d] hover:text-primary transition-colors">
                            <Sparkles size={14} className="text-primary" /> HR Intelligence <ChevronDown size={14} className="text-[#999]" />
                        </button>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setIsIncognito(!isIncognito)}
                            disabled={hasMessages}
                            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${hasMessages ? 'opacity-50 cursor-not-allowed text-[#ccc]' : isIncognito ? 'bg-red-50 text-red-500' : 'hover:bg-[#f2f2f2] text-[#999] hover:text-[#333]'}`}
                            title={hasMessages ? "Cannot change incognito after a conversation has started" : "Toggle Incognito (Don't save chat to history)"}
                        >
                            <EyeOff size={16} />
                        </button>
                        <button
                            onClick={() => setShowInstructions(true)}
                            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#f2f2f2] text-[#999] hover:text-[#333] transition-colors"
                            title="Custom instructions"
                        >
                            <Settings size={16} />
                        </button>
                    </div>
                </div>

                {/* Body State Manager */}
                {isRestoring ? (
                    <div className="flex-1 flex flex-col items-center justify-center">
                        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                    </div>
                ) : !hasMessages ? (
                    <div className="flex-1 flex flex-col items-center justify-center px-4 md:px-8">
                        <div className="w-full max-w-[48rem] flex flex-col items-center mb-6 text-center">
                            <h1 className="text-[28px] font-semibold text-[#1a1a1a] mb-2 leading-tight">
                                Hello, {userName}.
                            </h1>
                            <p className="text-[#999] text-[15px]">How can I help you map out your enterprise today?</p>
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
                    // Chat Mode
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
                                                                    {copiedIndex === i ? (
                                                                        <Check size={15} className="text-green-500" />
                                                                    ) : (
                                                                        <Copy size={15} />
                                                                    )}
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
                                HR Intelligence can make mistakes. Please double-check responses.
                            </p>
                        </div>
                    </>
                )}
            </div>

            <CustomInstructionsModal
                open={showInstructions}
                onClose={() => setShowInstructions(false)}
            />
        </div >
    );
}
