import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { fetchAllMonitoringData, fetchRunDetails } from '../api/monitoring.js';
import { format, formatDistanceToNowStrict } from 'date-fns';
import {
    Activity, RefreshCw, Search, X, CheckCircle, AlertTriangle,
    XCircle, ChevronDown, ChevronRight, Mail, FileText, Clock,
    Filter, Copy, Check, Zap, ShieldAlert, TrendingUp, ArrowUpDown,
    Keyboard, Pin
} from 'lucide-react';

/* ─────────────────────────────────────────────
   Cache helpers (localStorage, 5 min TTL)
   ───────────────────────────────────────────── */
const CACHE_KEY = 'monitoring-dashboard-v1';
const CACHE_TTL = 5 * 60 * 1000;

const readCache = () => {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const { ts, payload } = JSON.parse(raw);
        return (Date.now() - ts < CACHE_TTL) ? payload : null;
    } catch { return null; }
};

const writeCache = (payload) => {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), payload }));
    } catch { /* quota */ }
};

/* ─────────────────────────────────────────────
   Tiny components
   ───────────────────────────────────────────── */
const StatusBadge = ({ status }) => {
    const map = {
        success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        warning: 'bg-amber-50 text-amber-700 border-amber-200',
        failed: 'bg-red-50 text-red-700 border-red-200',
    };
    const icons = {
        success: <CheckCircle className="w-3 h-3" />,
        warning: <AlertTriangle className="w-3 h-3" />,
        failed: <XCircle className="w-3 h-3" />,
    };
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border ${map[status] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
            {icons[status]} {status}
        </span>
    );
};

/* ─── Feature 5: Mini sparkline bar ─── */
const MiniHealthBar = ({ pipelines }) => {
    if (!pipelines || pipelines.length === 0) return null;

    // Show top 5 pipelines sorted by total runs
    const sorted = [...pipelines].sort((a, b) => b.total - a.total).slice(0, 5);
    const maxRuns = Math.max(...sorted.map(p => p.total), 1);

    return (
        <div className="mt-3 space-y-1.5">
            {sorted.map(p => {
                const total = p.total || 1;
                const successPct = (p.success / total) * 100;
                const warningPct = (p.warning / total) * 100;
                const failedPct = (p.failed / total) * 100;
                const barWidth = (p.total / maxRuns) * 100;

                return (
                    <div key={p.logic_app_name} className="flex items-center gap-2">
                        <span className="text-[9px] font-bold text-gray-500 w-20 truncate text-right" title={p.logic_app_name}>
                            {p.logic_app_name}
                        </span>
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden" style={{ maxWidth: `${barWidth}%`, minWidth: '40%' }}>
                            <div className="h-full flex">
                                {successPct > 0 && <div className="bg-emerald-400 transition-all" style={{ width: `${successPct}%` }} />}
                                {warningPct > 0 && <div className="bg-amber-400 transition-all" style={{ width: `${warningPct}%` }} />}
                                {failedPct > 0 && <div className="bg-red-400 transition-all" style={{ width: `${failedPct}%` }} />}
                            </div>
                        </div>
                        <span className="text-[9px] font-mono text-gray-400 w-8 text-right">{p.total}</span>
                    </div>
                );
            })}
        </div>
    );
};

const MetricCard = ({ label, value, sub, icon: Icon, theme, children }) => {
    const themes = {
        gray: 'bg-gray-50 border-gray-100 text-gray-900',
        green: 'bg-emerald-50 border-emerald-100 text-emerald-700',
        amber: 'bg-amber-50 border-amber-100 text-amber-700',
        red: 'bg-red-50 border-red-100 text-red-700',
        blue: 'bg-blue-50 border-blue-100 text-blue-700',
    };
    return (
        <div className={`flex flex-col p-4 rounded-sm border ${themes[theme] || themes.gray} transition-all`}>
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-[10px] uppercase tracking-wider opacity-70 font-bold mb-1">{label}</p>
                    <h3 className="text-2xl font-bold">{value}</h3>
                    {sub && <p className="text-[10px] font-medium opacity-60 mt-1">{sub}</p>}
                </div>
                <div className="p-2 rounded-sm bg-white/50">
                    <Icon className="w-5 h-5 opacity-80" />
                </div>
            </div>
            {children}
        </div>
    );
};

const CopyButton = ({ text }) => {
    const [copied, setCopied] = useState(false);
    const handleCopy = (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };
    return (
        <button onClick={handleCopy} className="p-0.5 rounded hover:bg-gray-200 transition-colors" title="Copy run ID">
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3 text-gray-400" />}
        </button>
    );
};

/* ─── Feature 4: Keyboard shortcut hint ─── */
const KeyboardHint = ({ show }) => {
    if (!show) return null;
    const shortcuts = [
        { key: '/', desc: 'Focus search' },
        { key: 'F', desc: 'Filter failed' },
        { key: 'W', desc: 'Filter warnings' },
        { key: 'S', desc: 'Filter success' },
        { key: 'A', desc: 'Show all' },
        { key: 'P', desc: 'Pin failures top' },
        { key: 'R', desc: 'Refresh' },
        { key: 'Esc', desc: 'Close / Clear' },
    ];
    return (
        <div className="px-6 py-2 border-b border-blue-100 bg-blue-50/50 flex items-center gap-4 flex-wrap">
            <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider flex items-center gap-1">
                <Keyboard className="w-3 h-3" /> Shortcuts
            </span>
            {shortcuts.map(s => (
                <span key={s.key} className="text-[10px] text-blue-700">
                    <kbd className="px-1.5 py-0.5 bg-white border border-blue-200 rounded text-[9px] font-mono font-bold mr-1 shadow-sm">{s.key}</kbd>
                    {s.desc}
                </span>
            ))}
        </div>
    );
};

/* ─────────────────────────────────────────────
   Expanded row detail (inline, no drawer)
   ───────────────────────────────────────────── */
const ExpandedRunDetail = ({ run, detail, loadingDetail }) => {
    if (loadingDetail) {
        return (
            <tr>
                <td colSpan={99} className="px-8 py-6 bg-slate-50/80 border-b border-slate-100">
                    <div className="flex items-center gap-2 text-sm text-gray-500 animate-pulse">
                        <RefreshCw className="w-4 h-4 animate-spin" /> Loading full report…
                    </div>
                </td>
            </tr>
        );
    }

    const data = detail || run;

    return (
        <tr>
            <td colSpan={99} className="p-0">
                <div className="bg-slate-50/80 border-b-2 border-slate-200 px-8 py-6 space-y-5">
                    {/* Grid 3-col */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                        {/* Email */}
                        {data.email && (
                            <div className="bg-white rounded-sm border border-gray-100 p-4">
                                <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                                    <Mail className="w-3.5 h-3.5 text-blue-500" /> Email Source
                                </h4>
                                <div className="space-y-1.5 text-xs">
                                    <p><span className="font-semibold text-gray-600">From:</span> <span className="text-gray-800">{data.email.from}</span></p>
                                    <p><span className="font-semibold text-gray-600">Subject:</span> <span className="text-gray-800">{data.email.subject}</span></p>
                                    <p className="text-gray-400 flex items-center gap-1 mt-2"><Clock className="w-3 h-3" /> {data.email.received_time}</p>
                                </div>
                            </div>
                        )}

                        {/* Files */}
                        {data.files && data.files.length > 0 && (
                            <div className="bg-white rounded-sm border border-gray-100 p-4">
                                <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                                    <FileText className="w-3.5 h-3.5 text-indigo-500" /> Files ({data.files.length})
                                </h4>
                                <ul className="space-y-1.5 text-xs max-h-36 overflow-y-auto">
                                    {data.files.map((f, i) => (
                                        <li key={i} className="flex justify-between items-center py-1 border-b border-gray-50 last:border-0">
                                            <span className="text-gray-700 truncate font-medium" title={f.name}>{f.name}</span>
                                            <span className="text-gray-400 text-[10px] whitespace-nowrap ml-2">{f.type} · {(f.size / 1024).toFixed(1)}KB</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* Warnings */}
                        {data.warning_count > 0 && (
                            <div className="bg-white rounded-sm border border-amber-100 p-4">
                                <h4 className="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Warnings ({data.warning_count})
                                </h4>
                                {data.warning_aggregations && Object.keys(data.warning_aggregations).length > 0 ? (
                                    <ul className="space-y-1.5 text-xs max-h-36 overflow-y-auto">
                                        {Object.entries(data.warning_aggregations).map(([msg, count]) => (
                                            <li key={msg} className="flex justify-between items-start p-1.5 bg-amber-50/50 rounded-sm">
                                                <span className="text-amber-900 font-medium leading-tight">{msg}</span>
                                                <span className="bg-amber-200 text-amber-800 text-[9px] font-bold px-1.5 py-0.5 rounded-full ml-2 whitespace-nowrap">×{count}</span>
                                            </li>
                                        ))}
                                    </ul>
                                ) : data.warnings && data.warnings.length > 0 ? (
                                    <ul className="space-y-1 text-xs max-h-36 overflow-y-auto">
                                        {data.warnings.map((w, i) => (
                                            <li key={i} className="text-amber-800 bg-amber-50/50 p-1.5 rounded-sm">{w}</li>
                                        ))}
                                    </ul>
                                ) : null}
                            </div>
                        )}
                    </div>

                    {/* Steps timeline */}
                    {data.steps && data.steps.length > 0 && (
                        <div className="bg-white rounded-sm border border-gray-100 p-4">
                            <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                                <Zap className="w-3.5 h-3.5 text-gray-400" /> Execution Steps
                            </h4>
                            <div className="flex flex-wrap gap-2">
                                {data.steps.map((s, i) => {
                                    const stepTheme = s.status === 'success' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                        : s.status === 'warning' ? 'bg-amber-50 text-amber-700 border-amber-200'
                                            : 'bg-red-50 text-red-700 border-red-200';
                                    return (
                                        <div key={i} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm border text-[11px] font-medium ${stepTheme}`}>
                                            {s.status === 'success' ? <CheckCircle className="w-3 h-3" /> : s.status === 'warning' ? <AlertTriangle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                                            {s.step}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </td>
        </tr>
    );
};

/* ═════════════════════════════════════════════
   MAIN PAGE
   ═════════════════════════════════════════════ */
const PipelineMonitoringPage = () => {
    // Data
    const [data, setData] = useState({ runs: [], pipelines: [], stats: { total: 0, success: 0, warning: 0, failed: 0 } });
    const [loading, setLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState(null);

    // Filters
    const [days, setDays] = useState(7);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [pipelineFilter, setPipelineFilter] = useState('all');

    // Feature 2: Pin failures to top
    const [pinFailures, setPinFailures] = useState(false);

    // Feature 4: Show keyboard hints
    const [showShortcuts, setShowShortcuts] = useState(false);

    // Expanded row
    const [expandedRunId, setExpandedRunId] = useState(null);
    const [expandedDetail, setExpandedDetail] = useState(null);
    const [loadingDetail, setLoadingDetail] = useState(false);

    // Auto-refresh
    const [countdown, setCountdown] = useState(300);
    const countdownRef = useRef(null);
    const [lastFetched, setLastFetched] = useState(null);

    // Refs
    const searchRef = useRef(null);

    /* ── Fetch ── */
    const fetchData = useCallback(async (force = false) => {
        if (force) setIsRefreshing(true);
        else setLoading(true);
        setError(null);

        if (!force) {
            const cached = readCache();
            if (cached) {
                setData(cached);
                setLoading(false);
                setLastFetched(new Date());
                return;
            }
        }

        try {
            const result = await fetchAllMonitoringData(days);
            setData(result);
            writeCache(result);
            setLastFetched(new Date());
        } catch (err) {
            console.error(err);
            setError(err.message || 'Failed to load monitoring data');
        } finally {
            setLoading(false);
            setIsRefreshing(false);
            setCountdown(300);
        }
    }, [days]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // Auto-refresh countdown
    useEffect(() => {
        if (countdownRef.current) clearInterval(countdownRef.current);
        countdownRef.current = setInterval(() => {
            setCountdown(prev => {
                if (prev <= 1) {
                    fetchData(true);
                    return 300;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(countdownRef.current);
    }, [fetchData]);

    /* ── Feature 4: Keyboard shortcuts ── */
    useEffect(() => {
        const handler = (e) => {
            // Don't trigger if user is typing in an input
            const tag = e.target.tagName.toLowerCase();
            if (tag === 'input' || tag === 'select' || tag === 'textarea') {
                if (e.key === 'Escape') {
                    e.target.blur();
                    setSearchTerm('');
                    setExpandedRunId(null);
                    setExpandedDetail(null);
                }
                return;
            }

            switch (e.key) {
                case '/':
                    e.preventDefault();
                    searchRef.current?.focus();
                    break;
                case 'f':
                case 'F':
                    setStatusFilter(prev => prev === 'failed' ? 'all' : 'failed');
                    break;
                case 'w':
                case 'W':
                    setStatusFilter(prev => prev === 'warning' ? 'all' : 'warning');
                    break;
                case 's':
                case 'S':
                    setStatusFilter(prev => prev === 'success' ? 'all' : 'success');
                    break;
                case 'a':
                case 'A':
                    setStatusFilter('all');
                    break;
                case 'p':
                case 'P':
                    setPinFailures(prev => !prev);
                    break;
                case 'r':
                case 'R':
                    localStorage.removeItem(CACHE_KEY);
                    fetchData(true);
                    break;
                case '?':
                    setShowShortcuts(prev => !prev);
                    break;
                case 'Escape':
                    setExpandedRunId(null);
                    setExpandedDetail(null);
                    setSearchTerm('');
                    setShowShortcuts(false);
                    break;
                default:
                    break;
            }
        };

        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [fetchData]);

    /* ── Expand row ── */
    const toggleRow = async (run) => {
        if (expandedRunId === run.run_id) {
            setExpandedRunId(null);
            setExpandedDetail(null);
            return;
        }
        setExpandedRunId(run.run_id);
        setExpandedDetail(null);

        if (run.steps && run.email) {
            setExpandedDetail(run);
            return;
        }

        setLoadingDetail(true);
        try {
            const date = format(new Date(run.start_time), 'yyyy-MM-dd');
            const detail = await fetchRunDetails(run.logic_app_name, run.run_id, date);
            setExpandedDetail({
                ...detail,
                warning_count: detail.warnings_summary?.warning_count || 0,
                warnings: detail.warnings_summary?.warnings || [],
                warning_aggregations: detail.warnings_summary?.aggregations || {},
            });
        } catch (e) {
            console.error('Failed to load detail:', e);
        } finally {
            setLoadingDetail(false);
        }
    };

    /* ── Derived data ── */
    const pipelineNames = useMemo(() =>
        [...new Set(data.runs.map(r => r.logic_app_name))].sort()
        , [data.runs]);

    const filteredRuns = useMemo(() => {
        let result = data.runs.filter(r => {
            if (statusFilter !== 'all' && r.status !== statusFilter) return false;
            if (pipelineFilter !== 'all' && r.logic_app_name !== pipelineFilter) return false;
            if (searchTerm) {
                const q = searchTerm.toLowerCase();
                const searchable = [
                    r.run_id, r.logic_app_name, r.client, r.failed_step,
                    r.commercial_ref, r.email?.subject, r.email?.from
                ].filter(Boolean).join(' ').toLowerCase();
                if (!searchable.includes(q)) return false;
            }
            return true;
        });

        // Feature 2: Pin failures to top
        if (pinFailures) {
            const failed = result.filter(r => r.status === 'failed');
            const warnings = result.filter(r => r.status === 'warning');
            const rest = result.filter(r => r.status !== 'failed' && r.status !== 'warning');
            result = [...failed, ...warnings, ...rest];
        }

        return result;
    }, [data.runs, statusFilter, pipelineFilter, searchTerm, pinFailures]);

    const filteredStats = useMemo(() => ({
        total: filteredRuns.length,
        success: filteredRuns.filter(r => r.status === 'success').length,
        warning: filteredRuns.filter(r => r.status === 'warning').length,
        failed: filteredRuns.filter(r => r.status === 'failed').length,
    }), [filteredRuns]);

    /* ── Format helpers ── */
    const formatTime = (isoStr) => {
        if (!isoStr) return '-';
        try { return format(new Date(isoStr), 'MMM dd HH:mm:ss'); } catch { return isoStr; }
    };
    const formatTimeAgo = (isoStr) => {
        if (!isoStr) return '';
        try { return formatDistanceToNowStrict(new Date(isoStr), { addSuffix: true }); } catch { return ''; }
    };
    const formatCountdown = (secs) => {
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    /* ── Loading / Error ── */
    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
        );
    }
    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <ShieldAlert className="w-12 h-12 text-red-400 mx-auto mb-3" />
                    <p className="text-red-600 font-medium">{error}</p>
                    <button onClick={() => fetchData(true)} className="mt-3 px-4 py-2 bg-red-50 text-red-700 text-sm font-bold rounded-sm border border-red-200 hover:bg-red-100 transition-colors">
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    /* ── Render ── */
    return (
        <div className="min-h-screen bg-gray-50 p-4 font-sans text-slate-800">
            <div className="w-full bg-white border border-gray-200 rounded-sm shadow-sm overflow-hidden">

                {/* ── Header ── */}
                <div className="px-6 py-5 border-b border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-lg font-bold text-gray-900 uppercase tracking-tight flex items-center gap-2">
                            <Activity className="w-5 h-5 text-primary" /> Pipeline Monitoring
                        </h1>
                        <p className="text-xs text-gray-500 mt-1">
                            Real-time Azure Logic App ingestion health · auto-refreshes every 5 min
                            <span className="ml-2 text-gray-400">• Press <kbd className="px-1 py-0.5 bg-gray-100 border border-gray-200 rounded text-[9px] font-mono font-bold mx-0.5">?</kbd> for shortcuts</span>
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        {/* Countdown + last fetch */}
                        <div className="text-right hidden sm:block">
                            <p className="text-[10px] text-gray-400 font-medium">
                                {lastFetched ? `Last: ${format(lastFetched, 'HH:mm:ss')}` : ''}
                            </p>
                            <p className="text-[10px] text-gray-500 font-bold font-mono">
                                Next in {formatCountdown(countdown)}
                            </p>
                        </div>
                        {/* Days selector */}
                        <select
                            value={days}
                            onChange={(e) => { setDays(Number(e.target.value)); localStorage.removeItem(CACHE_KEY); }}
                            className="px-2.5 py-1.5 text-xs font-bold border border-gray-200 rounded-sm bg-white text-gray-700 focus:ring-1 focus:ring-blue-500 cursor-pointer"
                        >
                            <option value={1}>Last 24h</option>
                            <option value={3}>Last 3 days</option>
                            <option value={7}>Last 7 days</option>
                            <option value={14}>Last 14 days</option>
                        </select>
                        {/* Refresh */}
                        <button
                            onClick={() => { localStorage.removeItem(CACHE_KEY); fetchData(true); }}
                            className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-sm text-xs font-bold uppercase hover:bg-emerald-100 transition-colors"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                            <span>Live</span>
                        </button>
                    </div>
                </div>

                {/* Feature 4: Keyboard shortcuts hint bar */}
                <KeyboardHint show={showShortcuts} />

                {/* ── Metrics Strip with Feature 5: Sparklines ── */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-6 bg-white border-b border-gray-100">
                    <MetricCard label="Total Runs" value={data.stats.total.toLocaleString()} sub={`Across ${pipelineNames.length} pipelines`} icon={Activity} theme="gray">
                        <MiniHealthBar pipelines={data.pipelines} />
                    </MetricCard>
                    <MetricCard label="Successful" value={data.stats.success.toLocaleString()} sub={data.stats.total ? `${((data.stats.success / data.stats.total) * 100).toFixed(1)}% rate` : ''} icon={CheckCircle} theme="green" />
                    <MetricCard label="Warnings" value={data.stats.warning.toLocaleString()} icon={AlertTriangle} theme="amber" />
                    <MetricCard label="Failed" value={data.stats.failed.toLocaleString()} sub={data.stats.failed > 0 ? 'Needs attention' : 'All clear'} icon={XCircle} theme="red" />
                </div>

                {/* ── Filters bar ── */}
                <div className="px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white border-b border-gray-100">
                    {/* Search */}
                    <div className="relative w-full md:w-72">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                        <input
                            ref={searchRef}
                            type="text"
                            placeholder="Search run_id, client, ref, subject…  ( / )"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-9 pr-8 py-1.5 bg-white border border-gray-200 rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all placeholder:text-gray-400"
                        />
                        {searchTerm && (
                            <button onClick={() => setSearchTerm('')} className="absolute right-2.5 top-1/2 -translate-y-1/2">
                                <X className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600" />
                            </button>
                        )}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                        {/* Feature 2: Pin failures toggle */}
                        <button
                            onClick={() => setPinFailures(!pinFailures)}
                            title="Pin failures & warnings to top (P)"
                            className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm border transition-all flex items-center gap-1 ${pinFailures
                                    ? 'bg-red-600 text-white border-red-600'
                                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                                }`}
                        >
                            <ArrowUpDown className="w-3 h-3" />
                            Pin Errors
                        </button>

                        <div className="w-px h-5 bg-gray-200 mx-0.5 hidden md:block" />

                        {/* Status quick filters */}
                        {['all', 'failed', 'warning', 'success'].map(s => {
                            const count = s === 'all' ? data.stats.total
                                : s === 'failed' ? data.stats.failed
                                    : s === 'warning' ? data.stats.warning
                                        : data.stats.success;
                            return (
                                <button
                                    key={s}
                                    onClick={() => setStatusFilter(s)}
                                    className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm border transition-all ${statusFilter === s
                                            ? s === 'failed' ? 'bg-red-600 text-white border-red-600'
                                                : s === 'warning' ? 'bg-amber-500 text-white border-amber-500'
                                                    : s === 'success' ? 'bg-emerald-600 text-white border-emerald-600'
                                                        : 'bg-gray-800 text-white border-gray-800'
                                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                                        }`}
                                >
                                    {s} {count > 0 && <span className="ml-1 opacity-75">({count})</span>}
                                </button>
                            );
                        })}

                        <div className="w-px h-5 bg-gray-200 mx-0.5 hidden md:block" />

                        {/* Pipeline filter */}
                        <select
                            value={pipelineFilter}
                            onChange={(e) => setPipelineFilter(e.target.value)}
                            className="px-2.5 py-1 text-[10px] font-bold uppercase border border-gray-200 rounded-sm bg-white text-gray-700 focus:ring-1 focus:ring-blue-500 cursor-pointer"
                        >
                            <option value="all">All Pipelines</option>
                            {pipelineNames.map(name => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* ── Results count ── */}
                <div className="px-6 py-2 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                        Showing {filteredRuns.length} of {data.runs.length} runs
                        {filteredStats.failed > 0 && (
                            <span className="ml-2 text-red-500">· {filteredStats.failed} failed</span>
                        )}
                        {pinFailures && (
                            <span className="ml-2 text-red-400">· Errors pinned ↑</span>
                        )}
                    </span>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5">
                            <div className="w-3 h-3 rounded-sm bg-red-50 border border-red-200"></div>
                            <span className="text-[10px] text-gray-500 font-medium">Failed</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-3 h-3 rounded-sm bg-amber-50 border border-amber-200"></div>
                            <span className="text-[10px] text-gray-500 font-medium">Warning</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-3 h-3 rounded-sm bg-white border border-gray-200"></div>
                            <span className="text-[10px] text-gray-500 font-medium">Success</span>
                        </div>
                    </div>
                </div>

                {/* ── THE TABLE ── */}
                {/* Feature 8: Sticky header — overflow wrapper with max-height + sticky thead */}
                <div className="overflow-auto max-h-[calc(100vh-420px)]">
                    <table className="w-full text-left">
                        {/* Feature 8: sticky top-0 z-10 on thead */}
                        <thead className="bg-gray-50 border-y border-gray-100 sticky top-0 z-10">
                            <tr>
                                <th className="w-8 px-2"></th>
                                <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider bg-gray-50">Time</th>
                                <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider bg-gray-50">Pipeline</th>
                                <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider bg-gray-50">Client</th>
                                <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider text-center bg-gray-50">Status</th>
                                <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider bg-gray-50">Failed Step</th>
                                <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider text-center bg-gray-50">Warnings</th>
                                <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider bg-gray-50">Commercial Ref</th>
                                <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider bg-gray-50">Run ID</th>
                                <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider text-right bg-gray-50">Duration</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 bg-white">
                            {filteredRuns.length === 0 ? (
                                <tr>
                                    <td colSpan={99} className="p-12 text-center text-gray-400 text-xs uppercase tracking-wide">
                                        No runs match current filters
                                    </td>
                                </tr>
                            ) : (
                                filteredRuns.map((run) => {
                                    const isExpanded = expandedRunId === run.run_id;
                                    const rowBg =
                                        run.status === 'failed' ? 'bg-red-50/40 hover:bg-red-50/70'
                                            : run.status === 'warning' ? 'bg-amber-50/30 hover:bg-amber-50/60'
                                                : 'hover:bg-gray-50/80';

                                    // Calculate duration
                                    let duration = '-';
                                    if (run.start_time && run.end_time) {
                                        const diffMs = new Date(run.end_time) - new Date(run.start_time);
                                        const secs = Math.floor(diffMs / 1000);
                                        duration = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
                                    }

                                    return (
                                        <React.Fragment key={run.run_id}>
                                            <tr
                                                className={`${rowBg} transition-colors group cursor-pointer ${isExpanded ? 'border-b-0' : ''}`}
                                                onClick={() => toggleRow(run)}
                                            >
                                                {/* Expand chevron */}
                                                <td className="w-8 px-2 py-3 text-center">
                                                    {isExpanded
                                                        ? <ChevronDown className="w-3.5 h-3.5 text-gray-500 mx-auto" />
                                                        : <ChevronRight className="w-3.5 h-3.5 text-gray-400 mx-auto group-hover:text-gray-600" />
                                                    }
                                                </td>

                                                {/* Time */}
                                                <td className="px-4 py-3">
                                                    <div className="text-xs font-semibold text-gray-700">{formatTime(run.start_time)}</div>
                                                    <div className="text-[10px] text-gray-400">{formatTimeAgo(run.start_time)}</div>
                                                </td>

                                                {/* Pipeline */}
                                                <td className="px-4 py-3">
                                                    <span className="text-xs font-medium text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded-sm border border-indigo-100">{run.logic_app_name}</span>
                                                </td>

                                                {/* Client */}
                                                <td className="px-4 py-3 text-xs font-medium text-gray-700">{run.client || '-'}</td>

                                                {/* Status */}
                                                <td className="px-4 py-3 text-center"><StatusBadge status={run.status} /></td>

                                                {/* Failed Step */}
                                                <td className="px-4 py-3">
                                                    {run.failed_step ? (
                                                        <span className="text-xs font-semibold text-red-700 bg-red-50 px-1.5 py-0.5 rounded-sm border border-red-100" title={run.failed_step}>
                                                            {run.failed_step}
                                                        </span>
                                                    ) : (
                                                        <span className="text-gray-300 text-xs">—</span>
                                                    )}
                                                </td>

                                                {/* Warnings count */}
                                                <td className="px-4 py-3 text-center">
                                                    {run.warning_count > 0 ? (
                                                        <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700">
                                                            <AlertTriangle className="w-3 h-3" /> {run.warning_count}
                                                        </span>
                                                    ) : (
                                                        <span className="text-gray-300 text-xs">—</span>
                                                    )}
                                                </td>

                                                {/* Commercial Ref */}
                                                <td className="px-4 py-3">
                                                    {run.commercial_ref ? (
                                                        <span className="text-[11px] font-mono bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100 text-gray-600">{run.commercial_ref}</span>
                                                    ) : (
                                                        <span className="text-gray-300 text-xs">—</span>
                                                    )}
                                                </td>

                                                {/* Run ID */}
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-[10px] font-mono text-gray-400 truncate max-w-[120px]" title={run.run_id}>{run.run_id?.slice(0, 12)}…</span>
                                                        <CopyButton text={run.run_id} />
                                                    </div>
                                                </td>

                                                {/* Duration */}
                                                <td className="px-4 py-3 text-right">
                                                    <span className="text-xs font-medium text-gray-500">{duration}</span>
                                                </td>
                                            </tr>

                                            {/* Expanded detail */}
                                            {isExpanded && (
                                                <ExpandedRunDetail run={run} detail={expandedDetail} loadingDetail={loadingDetail} />
                                            )}
                                        </React.Fragment>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* ── Footer ── */}
                <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between bg-gray-50/50">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                        {filteredRuns.length} results · {pipelineNames.length} pipeline{pipelineNames.length !== 1 ? 's' : ''}
                    </span>
                    <div className="flex items-center gap-2 text-[10px] text-gray-400">
                        <TrendingUp className="w-3 h-3" />
                        <span>Auto-refresh {formatCountdown(countdown)}</span>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default PipelineMonitoringPage;
