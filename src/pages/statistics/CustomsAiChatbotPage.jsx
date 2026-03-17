import { useState, useRef, useEffect, useMemo } from 'react';
import { ArrowUp, Plus, Sparkles, ChevronDown, MessageSquare, Trash2, EyeOff, Menu, X, Copy, Check, Paperclip, FileText, Loader2, Square, Pencil, RotateCcw, ThumbsUp, ThumbsDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '../../context/AuthContext';

const loadingStatuses = [
    "Consulting EUR-Lex...", "Searching GN 2026 Database...", "Validating Tariff Code...", "Analyzing product photo...", "Parsing attached document...", "Drafting response..."
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
    const [attachments, setAttachments] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [previewImage, setPreviewImage] = useState(null);

    // New UX control state
    const [editingIndex, setEditingIndex] = useState(null);
    const [editingText, setEditingText] = useState('');
    const [messageFeedback, setMessageFeedback] = useState({});
    const [showScrollBtn, setShowScrollBtn] = useState(false);

    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);
    const fileInputRef = useRef(null);
    const scrollContainerRef = useRef(null);
    const abortControllerRef = useRef(null);
    // Ref so scroll effect reads latest value without stale closure
    const showScrollBtnRef = useRef(false);

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

    const handleScroll = () => {
        const el = scrollContainerRef.current;
        if (!el) return;
        const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        const isUp = distFromBottom > 200;
        showScrollBtnRef.current = isUp;
        setShowScrollBtn(isUp);
    };

    // Auto-scroll: always scroll for new user messages; skip if user scrolled up during AI streaming
    useEffect(() => {
        const lastMsg = messages[messages.length - 1];
        if (!showScrollBtnRef.current || lastMsg?.role === 'user') {
            scrollToBottom();
        }
    }, [messages, isLoading]);

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
        setEditingIndex(null);
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
            setEditingIndex(null);
            setMessageFeedback({});
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

    const processFile = (file) => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (re) => {
                const base64 = re.target.result.split(',')[1];
                const type = file.type;
                const name = file.name || `snapshot-${Date.now()}.png`;
                const url = re.target.result;
                resolve({ name, type, base64, url });
            };
            reader.readAsDataURL(file);
        });
    };

    const handleFileChange = async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        setIsUploading(true);
        const newAttachments = [...attachments];
        for (const file of files) {
            newAttachments.push(await processFile(file));
        }
        setAttachments(newAttachments);
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handlePaste = async (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        const filesToProcess = [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const file = items[i].getAsFile();
                if (file) filesToProcess.push(file);
            }
        }

        if (filesToProcess.length > 0) {
            setIsUploading(true);
            const newAttachments = [...attachments];
            for (const file of filesToProcess) {
                newAttachments.push(await processFile(file));
            }
            setAttachments(newAttachments);
            setIsUploading(false);
        }
    };

    const removeAttachment = (index) => {
        setAttachments(prev => prev.filter((_, i) => i !== index));
    };

    // Stop streaming
    const handleStop = () => {
        abortControllerRef.current?.abort();
    };

    // Thumbs feedback toggle
    const handleFeedback = (index, type) => {
        setMessageFeedback(prev => ({
            ...prev,
            [index]: prev[index] === type ? null : type
        }));
    };

    // Edit user message
    const handleEditStart = (index, text) => {
        setEditingIndex(index);
        setEditingText(text);
    };

    const handleEditSave = () => {
        if (!editingText.trim()) return;
        const truncated = messages.slice(0, editingIndex);
        setEditingIndex(null);
        handleSend({ overrideMsg: editingText.trim(), baseMessages: truncated });
    };

    // Regenerate last AI response
    const handleRegenerate = () => {
        let lastUserIdx = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'user') { lastUserIdx = i; break; }
        }
        if (lastUserIdx === -1) return;
        const lastUserMsg = messages[lastUserIdx];
        const truncated = messages.slice(0, lastUserIdx);
        handleSend({
            overrideMsg: lastUserMsg.text,
            baseMessages: truncated,
            overrideAttachments: lastUserMsg.attachments || []
        });
    };

    // opts: { overrideMsg, baseMessages, overrideAttachments }
    const handleSend = async (opts = {}) => {
        const { overrideMsg, baseMessages, overrideAttachments } = opts;

        const userMsg = overrideMsg || input.trim();
        if (!userMsg || isLoading) return;

        if (!overrideMsg) {
            setInput('');
            if (inputRef.current) inputRef.current.style.height = 'auto';
        }

        let currentChatId = chatId;
        if (!currentChatId) {
            currentChatId = crypto.randomUUID();
            setChatId(currentChatId);
        }

        const currentAttachments = overrideAttachments ?? [...attachments];
        if (!overrideMsg) setAttachments([]);

        const baseMsg = baseMessages ?? messages;
        const newMessages = [...baseMsg, { role: 'user', text: userMsg, attachments: currentAttachments }];
        // Add empty assistant bubble immediately so loading dots appear without delay
        setMessages([...newMessages, { role: 'assistant', text: '' }]);
        setIsLoading(true);
        setFollowUpPills([]);
        // When sending, force scroll to bottom
        showScrollBtnRef.current = false;
        setShowScrollBtn(false);

        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            const chat_history = newMessages.slice(0, -1).map(m =>
                m.role === 'user' ? ['human', m.text] : ['ai', m.text]
            );

            const res = await fetch('/api/statistics/customs/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    message: userMsg,
                    user_name: userEmail,
                    chatId: currentChatId,
                    isIncognito,
                    chat_history,
                    images: currentAttachments.filter(a => a.type.startsWith('image/')),
                    files: currentAttachments.filter(a => a.type === 'application/pdf')
                })
            });

            if (!res.ok) throw new Error('Connection failed');

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
            if (err.name === 'AbortError') {
                // User stopped — remove empty assistant bubble if nothing was streamed
                setMessages(prev => {
                    const m = [...prev];
                    if (m.length > 0 && m[m.length - 1].role === 'assistant' && !m[m.length - 1].text) {
                        m.pop();
                    }
                    return m;
                });
            } else {
                setMessages(prev => {
                    const filtered = prev.filter((m, i) => !(i === prev.length - 1 && m.role === 'assistant'));
                    return [...filtered, { role: 'error', text: err.message || 'Connection interrupted. Please try again.' }];
                });
            }
        } finally {
            setIsLoading(false);
            abortControllerRef.current = null;
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
        // ── Paragraphs ──────────────────────────────────────────────────────
        p: ({ node, ...props }) => (
            <p className={`mb-4 last:mb-0 leading-[1.78] ${isIncognito ? 'text-[#c8c8c8]' : 'text-[#1a1a1a]'}`} {...props} />
        ),

        // ── Headings ─────────────────────────────────────────────────────────
        h1: ({ node, ...props }) => (
            <h1 className={`text-[17px] font-semibold mt-7 mb-3 leading-snug tracking-[-0.01em] ${isIncognito ? 'text-[#e8e8e8]' : 'text-[#0d0d0d]'}`} {...props} />
        ),
        h2: ({ node, ...props }) => (
            <h2 className={`text-[15px] font-semibold mt-6 mb-2.5 leading-snug ${isIncognito ? 'text-[#e0e0e0]' : 'text-[#0d0d0d]'}`} {...props} />
        ),
        h3: ({ node, ...props }) => (
            <h3 className={`text-[14px] font-semibold mt-5 mb-2 leading-snug ${isIncognito ? 'text-[#d8d8d8]' : 'text-[#0d0d0d]'}`} {...props} />
        ),

        // ── Inline formatting ─────────────────────────────────────────────────
        strong: ({ node, ...props }) => (
            <strong className={`font-semibold ${isIncognito ? 'text-[#e0e0e0]' : 'text-[#0d0d0d]'}`} {...props} />
        ),
        em: ({ node, ...props }) => (
            <em className={`italic ${isIncognito ? 'text-[#aaa]' : 'text-[#3d3d3d]'}`} {...props} />
        ),

        // ── Lists ─────────────────────────────────────────────────────────────
        ul: ({ node, ...props }) => (
            <ul className={`list-disc pl-[1.4rem] my-3.5 space-y-1.5 ${isIncognito ? 'text-[#c8c8c8]' : 'text-[#1a1a1a]'}`} {...props} />
        ),
        ol: ({ node, ...props }) => (
            <ol className={`list-decimal pl-[1.4rem] my-3.5 space-y-1.5 ${isIncognito ? 'text-[#c8c8c8]' : 'text-[#1a1a1a]'}`} {...props} />
        ),
        li: ({ node, ...props }) => (
            <li className="leading-[1.75] [&>p]:mb-1 [&>p:last-child]:mb-0" {...props} />
        ),

        // ── Divider ───────────────────────────────────────────────────────────
        hr: ({ node, ...props }) => (
            <hr className={`my-5 border-none border-t ${isIncognito ? 'border-[#2a2a2a]' : 'border-[#ebebeb]'}`} {...props} />
        ),

        // ── Links ─────────────────────────────────────────────────────────────
        a: ({ node, ...props }) => (
            <a className={`underline underline-offset-[3px] transition-all ${isIncognito ? 'text-purple-400 decoration-purple-400/40 hover:decoration-purple-300' : 'text-primary decoration-primary/40 hover:decoration-primary'}`} target="_blank" rel="noopener noreferrer" {...props} />
        ),

        // ── Table ─────────────────────────────────────────────────────────────
        table: ({ node, ...props }) => (
            <div className={`overflow-x-auto my-5 rounded-xl border shadow-[0_1px_4px_rgba(0,0,0,0.06)] ${isIncognito ? 'border-[#2d2d2d]' : 'border-[#e8e8e8]'}`}>
                <table className="min-w-full border-collapse text-[14px]" {...props} />
            </div>
        ),
        thead: ({ node, ...props }) => (
            <thead className={`border-b ${isIncognito ? 'bg-[#1e1e1e] border-[#2d2d2d]' : 'bg-[#f7f7f7] border-[#e8e8e8]'}`} {...props} />
        ),
        th: ({ node, ...props }) => (
            <th className={`px-4 py-2.5 text-left text-[11.5px] font-semibold uppercase tracking-[0.05em] whitespace-nowrap ${isIncognito ? 'text-[#666]' : 'text-[#5a5a5a]'}`} {...props} />
        ),
        tbody: ({ node, ...props }) => (
            <tbody className={`divide-y ${isIncognito ? 'divide-[#222]' : 'divide-[#f0f0f0]'}`} {...props} />
        ),
        tr: ({ node, ...props }) => (
            <tr className={`transition-colors ${isIncognito ? 'hover:bg-[#1e1e1e]' : 'hover:bg-[#fafafa]'}`} {...props} />
        ),
        td: ({ node, ...props }) => (
            <td className={`px-4 py-2.5 text-[13.5px] align-top ${isIncognito ? 'text-[#bbb]' : 'text-[#2a2a2a]'}`} {...props} />
        ),

        // ── Code ─────────────────────────────────────────────────────────────
        pre: ({ node, children, ...props }) => (
            <div className="my-4 rounded-xl overflow-hidden bg-[#161616] shadow-[0_2px_8px_rgba(0,0,0,0.15)]">
                <pre className="px-4 py-3.5 overflow-x-auto text-[13px] font-mono leading-relaxed m-0" {...props}>
                    {children}
                </pre>
            </div>
        ),
        code({ node, inline, className, children, ...props }) {
            return inline ? (
                <code className={`px-[5px] py-[2px] rounded-[4px] text-[12.5px] font-mono font-medium ${isIncognito ? 'bg-[#252525] text-[#ff8080]' : 'bg-[#f0f0f0] text-[#cc3d43]'}`} {...props}>
                    {children}
                </code>
            ) : (
                <code className="text-[#d8d8d8] text-[13px] font-mono leading-relaxed" {...props}>
                    {children}
                </code>
            );
        },

        // ── Blockquote — TARIC badge detection ───────────────────────────────
        blockquote: ({ node, children, ...props }) => {
            const text = children?.toString?.() || '';
            const isTaricBadge = text.includes('TARIC Checked') || text.includes('🔍');
            if (isTaricBadge) {
                return (
                    <div className="inline-flex items-center gap-1.5 mt-4 px-3 py-1.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 text-[12px] font-medium leading-none">
                        {children}
                    </div>
                );
            }
            return (
                <blockquote className={`border-l-[3px] pl-4 my-4 italic leading-[1.7] ${isIncognito ? 'border-[#333] text-[#777]' : 'border-[#d5d5d5] text-[#555]'}`} {...props}>
                    {children}
                </blockquote>
            );
        },
    }), [isIncognito]);

    const displayPrompts = [
        { label: 'Classify a steel bolt', prompt: 'What is the classification for an M12 heavy-duty steel bolt?' },
        { label: 'Check HS 8529 90 90 90', prompt: 'Hi, Please confirm this complete hs code: 8529909090 => 8529 90 96 00 double check' },
        { label: 'Aluminum LED frame', prompt: 'It is a 3D corner frame for LED displays made of aluminum' },
        { label: 'Confirm smartphone code', prompt: 'Can you confirm the HS code for a generic 5G smartphone?' }
    ];

    const renderInputBox = (placeholder = 'Describe a product or enter an HS/CN code...') => (
        <div className="w-full max-w-[48rem] mx-auto">
            <div className={`border rounded-2xl overflow-hidden transition-colors ${isIncognito ? 'border-[#2d2d2d] bg-[#1c1c1c] focus-within:border-purple-600/50 focus-within:ring-2 focus-within:ring-purple-600/10' : 'border-[#d9d9d9] bg-white focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10'}`}>
                {attachments.length > 0 && (
                    <div className={`flex flex-wrap gap-2 p-3 border-b ${isIncognito ? 'border-[#2a2a2a] bg-[#161616]' : 'border-gray-100 bg-gray-50/30'}`}>
                        {attachments.map((file, idx) => (
                            <div key={idx} className="relative group bg-white border border-gray-200 rounded-lg p-2 flex items-center gap-2 shadow-sm pr-8">
                                {file.type.startsWith('image/') ? (
                                    <div className="w-8 h-8 rounded bg-gray-100 overflow-hidden">
                                        <img src={file.url} alt="" className="w-full h-full object-cover" />
                                    </div>
                                ) : (
                                    <div className="p-1.5 bg-blue-50 text-blue-600 rounded">
                                        <FileText size={16} />
                                    </div>
                                )}
                                <span className="text-[12px] font-medium text-gray-700 truncate max-w-[120px]">{file.name}</span>
                                <button
                                    onClick={() => removeAttachment(idx)}
                                    className="absolute right-1 top-1 text-gray-400 hover:text-red-500 transition-colors"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
                <textarea
                    ref={inputRef}
                    value={input}
                    onChange={handleInput}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                    }}
                    onPaste={handlePaste}
                    placeholder={placeholder}
                    className={`w-full bg-transparent min-h-[44px] max-h-[200px] text-[15px] resize-none px-4 pt-3 pb-1 focus:outline-none ${isIncognito ? 'placeholder:text-[#3d3d3d] text-[#e8e8e8]' : 'placeholder:text-[#999] text-[#2d2d2d]'}`}
                    disabled={isLoading}
                    rows={1}
                />
                <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    onChange={handleFileChange}
                    multiple
                    accept="image/*,application/pdf,text/csv,text/plain"
                />
                <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isLoading || isUploading}
                            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${isIncognito ? 'text-[#555] hover:bg-[#2a2a2a] hover:text-[#aaa]' : 'text-[#7a7a7a] hover:bg-[#f2f2f2]'}`}
                            title="Attach product photo or invoice/packing list"
                        >
                            {isUploading ? <Loader2 size={18} className="animate-spin text-primary" /> : <Paperclip size={18} />}
                        </button>
                    </div>
                    <div className="flex items-center gap-2">
                        {isIncognito && (
                            <span className="flex items-center gap-1 text-[12px] text-purple-400 font-medium px-2 bg-purple-900/30 rounded-full h-6">
                                <EyeOff size={12} /> Private
                            </span>
                        )}
                        <button className={`flex items-center gap-1 text-[13px] transition-colors px-1 ${isIncognito ? 'text-purple-400/70 hover:text-purple-300' : 'text-primary/70 hover:text-primary'}`}>
                            <Sparkles size={13} />
                            Customs Agent
                        </button>
                        {isLoading ? (
                            <button
                                onClick={handleStop}
                                className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#1a1a1a] text-white hover:bg-[#333] transition-all"
                                title="Stop generating"
                            >
                                <Square size={14} fill="currentColor" />
                            </button>
                        ) : (
                            <button
                                onClick={() => handleSend()}
                                disabled={!input.trim() && attachments.length === 0}
                                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${(!input.trim() && attachments.length === 0)
                                    ? isIncognito ? 'text-[#3a3a3a] cursor-not-allowed' : 'text-[#c5c5c5] cursor-not-allowed'
                                    : isIncognito ? 'bg-purple-600 text-white hover:bg-purple-700' : 'bg-primary text-white hover:bg-primary-dark'
                                    }`}
                            >
                                <ArrowUp size={18} strokeWidth={2} />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="flex w-full h-[calc(100vh-0px)] bg-white overflow-hidden relative">

            {/* Image preview lightbox */}
            <AnimatePresence>
                {previewImage && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4"
                        onClick={() => setPreviewImage(null)}
                    >
                        <motion.img
                            initial={{ scale: 0.92 }}
                            animate={{ scale: 1 }}
                            exit={{ scale: 0.92 }}
                            src={previewImage}
                            alt="Preview"
                            className="max-w-full max-h-full rounded-xl shadow-2xl object-contain"
                            onClick={e => e.stopPropagation()}
                        />
                        <button
                            onClick={() => setPreviewImage(null)}
                            className="absolute top-4 right-4 text-white/70 hover:text-white bg-black/30 hover:bg-black/50 rounded-full p-2 transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

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
            <div className={`flex-1 flex flex-col h-full relative transition-colors duration-200 ${isIncognito ? 'bg-[#131313]' : 'bg-white'}`}>

                {/* Topbar */}
                <div className={`shrink-0 flex items-center justify-between px-6 h-12 border-b transition-colors duration-200 ${isIncognito ? 'bg-[#1a1a1a] border-[#2a2a2a]' : 'bg-white border-[#f0f0f0]'}`}>
                    <div className="flex items-center gap-2">
                        {isSidebarOpen && window.innerWidth >= 768 && (
                            <button onClick={() => setIsSidebarOpen(false)} className={`mr-2 p-1.5 rounded-md transition-colors ${isIncognito ? 'text-[#666] hover:bg-[#2a2a2a] hover:text-[#aaa]' : 'text-[#999] hover:bg-[#f2f2f2]'}`} title="Close sidebar">
                                <Menu size={16} />
                            </button>
                        )}
                        {!isSidebarOpen && window.innerWidth >= 768 && (
                            <button onClick={() => setIsSidebarOpen(true)} className={`mr-2 p-1.5 rounded-md transition-colors ${isIncognito ? 'text-[#666] hover:bg-[#2a2a2a] hover:text-[#aaa]' : 'text-[#999] hover:bg-[#f2f2f2]'}`} title="Open sidebar">
                                <Menu size={16} />
                            </button>
                        )}
                        <button className={`flex items-center gap-1.5 text-[14px] font-medium transition-colors ${isIncognito ? 'text-[#d0d0d0] hover:text-purple-300' : 'text-[#2d2d2d] hover:text-primary'}`}>
                            <Sparkles size={14} className={isIncognito ? 'text-purple-400' : 'text-primary'} />
                            EU Customs Desk
                            <ChevronDown size={14} className={isIncognito ? 'text-[#555]' : 'text-[#999]'} />
                        </button>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={handleNewChat}
                            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${isIncognito ? 'hover:bg-[#2a2a2a] text-[#666] hover:text-[#aaa]' : 'hover:bg-[#f2f2f2] text-[#999] hover:text-[#333]'}`}
                            title="New classification"
                        >
                            <Plus size={16} />
                        </button>
                        <button
                            onClick={() => setIsIncognito(!isIncognito)}
                            disabled={hasMessages}
                            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${hasMessages ? 'opacity-40 cursor-not-allowed' : isIncognito ? 'bg-purple-900/40 text-purple-400' : 'hover:bg-[#f2f2f2] text-[#999] hover:text-[#333]'}`}
                            title={hasMessages ? 'Cannot change after conversation starts' : 'Toggle Private mode'}
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
                            {isIncognito && (
                                <div className="flex items-center gap-2 text-[13px] text-purple-400 bg-purple-900/20 border border-purple-800/30 rounded-full px-4 py-1.5 mb-5">
                                    <EyeOff size={13} /> Private mode — this conversation won't be saved
                                </div>
                            )}
                            <h1 className={`text-[28px] font-semibold mb-2 leading-tight ${isIncognito ? 'text-[#e0e0e0]' : 'text-[#1a1a1a]'}`}>
                                Hello, {userName}.
                            </h1>
                            <p className={`text-[15px] ${isIncognito ? 'text-[#555]' : 'text-[#999]'}`}>I am Alex, your licensed EU Customs declarant. Powered by GN 2026.</p>
                        </div>

                        {renderInputBox()}

                        <div className="w-full max-w-[48rem] mt-6">
                            <p className={`text-[11px] font-semibold uppercase tracking-wider mb-2 ml-1 ${isIncognito ? 'text-[#444]' : 'text-[#999]'}`}>Suggested for you</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                {displayPrompts.map((item, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => handlePromptClick(item.prompt)}
                                        className={`text-left py-3 px-4 rounded-xl border text-[13px] font-medium transition-all truncate ${isIncognito ? 'border-[#2a2a2a] hover:border-purple-700/50 hover:bg-purple-900/10 text-[#555] hover:text-[#aaa]' : 'border-[#e5e5e5] hover:border-primary/30 hover:bg-primary/5 text-[#555] hover:text-[#222]'}`}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Scrollable messages */}
                        <div
                            ref={scrollContainerRef}
                            onScroll={handleScroll}
                            className="flex-1 overflow-y-auto min-h-0"
                        >
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
                                                <div className="flex flex-col items-end gap-1 group">
                                                    <div className={`max-w-[80%] px-4 py-3 rounded-3xl text-[15px] leading-[1.6] ${isIncognito ? 'bg-[#2a2a2a] text-[#e8e8e8]' : 'bg-[#f4f4f4] text-[#2d2d2d]'}`}>
                                                        {m.attachments?.length > 0 && (
                                                            <div className="flex flex-wrap gap-2 mb-2">
                                                                {m.attachments.map((file, idx) => (
                                                                    <div key={idx} className={`backdrop-blur-sm border rounded-xl p-2 flex items-center gap-2 max-w-full overflow-hidden ${isIncognito ? 'bg-[#333]/80 border-[#444]' : 'bg-white/80 border-gray-200'}`}>
                                                                        {file.type?.startsWith('image/') ? (
                                                                            <div
                                                                                className="w-10 h-10 rounded-lg bg-gray-100 overflow-hidden shrink-0 cursor-zoom-in"
                                                                                onClick={() => setPreviewImage(file.url)}
                                                                            >
                                                                                <img src={file.url} alt="" className="w-full h-full object-cover" />
                                                                            </div>
                                                                        ) : (
                                                                            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg shrink-0">
                                                                                <FileText size={20} />
                                                                            </div>
                                                                        )}
                                                                        <div className="min-w-0 pr-2">
                                                                            <p className="text-[12px] font-bold text-gray-900 truncate">{file.name}</p>
                                                                            <p className="text-[10px] text-gray-500 uppercase tracking-tighter">
                                                                                {file.type?.startsWith('image/') ? 'Product Photo' : 'Document'}
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                        {editingIndex === i ? (
                                                            <div>
                                                                <textarea
                                                                    value={editingText}
                                                                    onChange={e => setEditingText(e.target.value)}
                                                                    onKeyDown={e => {
                                                                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEditSave(); }
                                                                        if (e.key === 'Escape') setEditingIndex(null);
                                                                    }}
                                                                    className="w-full bg-transparent resize-none text-[15px] leading-[1.6] focus:outline-none min-h-[40px]"
                                                                    autoFocus
                                                                    rows={Math.max(2, editingText.split('\n').length)}
                                                                />
                                                                <div className="flex gap-2 mt-2 justify-end">
                                                                    <button
                                                                        onClick={() => setEditingIndex(null)}
                                                                        className="px-3 py-1 text-[12px] text-[#666] rounded-lg hover:bg-black/5 transition-colors"
                                                                    >
                                                                        Cancel
                                                                    </button>
                                                                    <button
                                                                        onClick={handleEditSave}
                                                                        disabled={!editingText.trim()}
                                                                        className="px-3 py-1 text-[12px] bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50"
                                                                    >
                                                                        Send
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <span className="whitespace-pre-wrap">{m.text}</span>
                                                        )}
                                                    </div>
                                                    {editingIndex !== i && !isLoading && (
                                                        <button
                                                            onClick={() => handleEditStart(i, m.text)}
                                                            className={`opacity-0 group-hover:opacity-100 p-1.5 rounded-md transition-all ${isIncognito ? 'hover:bg-[#2a2a2a] text-[#555] hover:text-[#aaa]' : 'hover:bg-[#f2f2f2] text-[#aaa] hover:text-[#555]'}`}
                                                            title="Edit message"
                                                        >
                                                            <Pencil size={13} />
                                                        </button>
                                                    )}
                                                </div>
                                            ) : (
                                                <div className="w-full relative group">
                                                    {m.role === 'error' ? (
                                                        <div className={`text-[15px] leading-[1.7] p-3 rounded-xl ${isIncognito ? 'text-red-400 bg-red-900/20' : 'text-red-600 bg-red-50'}`}>{m.text}</div>
                                                    ) : (
                                                        <div>
                                                            <div className={`text-[15px] leading-[1.78] [&>*:first-child]:!mt-0 [&>*:last-child]:!mb-0 ${isIncognito ? 'text-[#c8c8c8]' : 'text-[#1a1a1a]'}`}>
                                                                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                                                    {m.text}
                                                                </ReactMarkdown>
                                                            </div>
                                                            <div className="mt-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                                                <button
                                                                    onClick={() => handleCopy(m.text, i)}
                                                                    className={`p-1.5 rounded-md transition-colors ${isIncognito ? 'hover:bg-[#2a2a2a] text-[#555]' : 'hover:bg-[#f2f2f2] text-[#888]'}`}
                                                                    title="Copy"
                                                                >
                                                                    {copiedIndex === i ? <Check size={15} className="text-green-500" /> : <Copy size={15} />}
                                                                </button>
                                                                <button
                                                                    onClick={() => handleFeedback(i, 'up')}
                                                                    className={`p-1.5 rounded-md transition-colors ${messageFeedback[i] === 'up' ? 'text-green-500' : isIncognito ? 'hover:bg-[#2a2a2a] text-[#555]' : 'hover:bg-[#f2f2f2] text-[#888]'}`}
                                                                    title="Good response"
                                                                >
                                                                    <ThumbsUp size={15} />
                                                                </button>
                                                                <button
                                                                    onClick={() => handleFeedback(i, 'down')}
                                                                    className={`p-1.5 rounded-md transition-colors ${messageFeedback[i] === 'down' ? 'text-red-500' : isIncognito ? 'hover:bg-[#2a2a2a] text-[#555]' : 'hover:bg-[#f2f2f2] text-[#888]'}`}
                                                                    title="Bad response"
                                                                >
                                                                    <ThumbsDown size={15} />
                                                                </button>
                                                                {i === messages.length - 1 && !isLoading && (
                                                                    <button
                                                                        onClick={handleRegenerate}
                                                                        className={`p-1.5 rounded-md transition-colors ${isIncognito ? 'hover:bg-[#2a2a2a] text-[#555]' : 'hover:bg-[#f2f2f2] text-[#888]'}`}
                                                                        title="Regenerate response"
                                                                    >
                                                                        <RotateCcw size={15} />
                                                                    </button>
                                                                )}
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
                                                <div className={`w-1.5 h-1.5 rounded-full animate-bounce ${isIncognito ? 'bg-[#4a4a4a]' : 'bg-[#aaa]'}`} style={{ animationDelay: '0ms' }} />
                                                <div className={`w-1.5 h-1.5 rounded-full animate-bounce ${isIncognito ? 'bg-[#4a4a4a]' : 'bg-[#aaa]'}`} style={{ animationDelay: '150ms' }} />
                                                <div className={`w-1.5 h-1.5 rounded-full animate-bounce ${isIncognito ? 'bg-[#4a4a4a]' : 'bg-[#aaa]'}`} style={{ animationDelay: '300ms' }} />
                                            </div>
                                            <span className={`text-[13px] ${isIncognito ? 'text-[#4a4a4a]' : 'text-[#999]'}`}>{loadingText}</span>
                                        </div>
                                    </motion.div>
                                )}

                                {followUpPills.length > 0 && !isLoading && (
                                    <div className="flex flex-wrap gap-2 mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                        {followUpPills.map((pill, idx) => (
                                            <button
                                                key={idx}
                                                onClick={() => handlePromptClick(pill)}
                                                className={`px-4 py-2 text-[13px] font-medium rounded-full hover:shadow-sm transition-all ${isIncognito ? 'bg-[#1e1e1e] border border-[#2d2d2d] text-[#666] hover:border-[#444] hover:text-[#bbb]' : 'bg-gradient-to-br from-[#f8f9fc] to-white border border-[#e2e8f0] text-[#475569] hover:border-[#cbd5e1] hover:text-[#0f172a]'}`}
                                            >
                                                {pill}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                <div ref={messagesEndRef} />
                            </div>
                        </div>

                        {/* Scroll-to-bottom floating button */}
                        <AnimatePresence>
                            {showScrollBtn && (
                                <motion.button
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: 8 }}
                                    onClick={scrollToBottom}
                                    className={`absolute bottom-24 right-6 z-10 w-9 h-9 rounded-full shadow-md flex items-center justify-center transition-colors ${isIncognito ? 'bg-[#2a2a2a] border border-[#3a3a3a] text-[#777] hover:bg-[#333]' : 'bg-white border border-[#e0e0e0] text-[#666] hover:bg-[#f5f5f5]'}`}
                                    title="Scroll to bottom"
                                >
                                    <ChevronDown size={18} />
                                </motion.button>
                            )}
                        </AnimatePresence>

                        {/* Bottom pinned input */}
                        <div className={`shrink-0 px-5 pt-2 pb-3 transition-colors duration-200 ${isIncognito ? 'bg-[#131313]' : 'bg-white'}`}>
                            {renderInputBox()}
                            <p className={`text-center mt-2 text-[12px] ${isIncognito ? 'text-[#333]' : 'text-[#b0b0b0]'}`}>
                                Always verify duty rates with official EU TARIC databases.
                            </p>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
