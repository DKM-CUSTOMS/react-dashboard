import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
    Search,
    RefreshCw,
    AlertCircle,
    FileText,
    ArrowUpDown,
    ArrowUp,
    ArrowDown,
    X,
    Copy,
    CheckCircle2,
    PenLine,

    FileSignature,
    Settings
} from 'lucide-react';
import { getBestmingDocs, sendDocuSignRequest } from '../../api/bestmingApi';
import FiscalSettings from './FiscalSettings';

// ─── Debounce Hook ────────────────────────────────────────────
const useDebounce = (value, delay) => {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const t = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(t);
    }, [value, delay]);
    return debounced;
};

// ─── Sort Icon ────────────────────────────────────────────────
const SortIcon = ({ col, sort, order }) => {
    if (sort !== col) return <ArrowUpDown className="w-3 h-3 opacity-25 ml-1 inline" />;
    return order === 'asc'
        ? <ArrowUp className="w-3 h-3 text-[#714B67] ml-1 inline" />
        : <ArrowDown className="w-3 h-3 text-[#714B67] ml-1 inline" />;
};

// ─── Status Badge ─────────────────────────────────────────────
const STATUS_STYLES = {
    DMSCLE: 'bg-green-50 text-green-700 border-green-100',
    CREATE: 'bg-blue-50 text-blue-700 border-blue-100',
    DELETED: 'bg-red-50 text-red-600 border-red-100',
    DEFAULT: 'bg-gray-50 text-gray-600 border-gray-100',
};

const StatusBadge = ({ status }) => {
    const cls = STATUS_STYLES[status] ?? STATUS_STYLES.DEFAULT;
    return (
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-[2px] text-[10px] font-bold border ${cls}`}>
            {status || '—'}
        </span>
    );
};

// ─── Column Definitions ───────────────────────────────────────
const COLUMNS = [
    { key: 'DECLARATION_ID', label: 'DECLARATION_ID', sortable: true, copyable: true, mono: true },
    { key: 'ACTIVECOMPANY', label: 'ACTIVECOMPANY', sortable: true, copyable: false, mono: false },
    { key: 'TRACESIDENTIFICATION', label: 'TRACESIDENTIFICATION', sortable: true, copyable: true, mono: false },
    { key: 'FISCALCONSIGNEECODE', label: 'FISCALCONSIGNEECODE', sortable: true, copyable: false, mono: false },
    { key: 'IMPORTERCODE', label: 'IMPORTERCODE', sortable: true, copyable: false, mono: false },
    { key: 'IMPORTERCOUNTRY', label: 'IMPORTERCOUNTRY', sortable: true, copyable: false, mono: false },
    { key: 'LINKIDERP4', label: 'LINKIDERP4', sortable: true, copyable: false, mono: false },
    { key: 'MESSAGESTATUS', label: 'MESSAGESTATUS', sortable: true, copyable: false, mono: false },
    { key: 'PRINCIPAL', label: 'PRINCIPAL', sortable: true, copyable: false, mono: false },
    { key: 'DATEOFACCEPTANCE', label: 'DATEOFACCEPTANCE', sortable: true, copyable: false, mono: false },
    { key: 'PROCESSFACTUURNUMMER', label: 'PROCESSFACTUURNUMMER', sortable: true, copyable: true, mono: true },
];

// ─── Helpers ──────────────────────────────────────────────────
const fmtDate = (v) => {
    if (!v) return '—';
    const d = new Date(v);
    return isNaN(d) ? v : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const strVal = (v) => (v == null ? '' : String(v)).toLowerCase();

// ─── Main Component ───────────────────────────────────────────
const BestmingSignatures = () => {
    // ── Search & Filters ──────────────────────────────────────
    const [searchInput, setSearchInput] = useState('');
    const debouncedSearch = useDebounce(searchInput, 250);
    const [filterFrom, setFilterFrom] = useState('');
    const [filterTo, setFilterTo] = useState('');

    const [showSettings, setShowSettings] = useState(false);

    // ── Sort ──────────────────────────────────────────────────
    const [sortBy, setSortBy] = useState('DATEOFACCEPTANCE');
    const [sortOrder, setSortOrder] = useState('desc');

    // ── UI State ──────────────────────────────────────────────
    const [focusedIndex, setFocusedIndex] = useState(-1);
    const [copiedKey, setCopiedKey] = useState(null);   // "<rowId>-<field>" for copy flash
    const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

    // ── DocuSign pending: ref for instant guard + state for re-render ──
    const pendingSignRef = useRef(new Set());          // immediate double-click guard
    const [pendingSignIds, setPendingSignIds] = useState(new Set());

    const searchRef = useRef(null);

    // ── Local Storage Cache Hydration ─────────────────────────
    const cachedData = useMemo(() => {
        try {
            const raw = localStorage.getItem('BESTMING_CACHE_DATA');
            return raw ? JSON.parse(raw) : undefined;
        } catch (e) {
            return undefined;
        }
    }, []);

    // ── Data Fetching ─────────────────────────────────────────
    const { data: rawRows = [], isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
        queryKey: ['bestming-docs'],
        queryFn: getBestmingDocs,
        staleTime: 5 * 60 * 1000,   // 5 min cache
        gcTime: 30 * 60 * 1000,     // 30 min gc
        refetchOnWindowFocus: false,
        retry: 2,
        initialData: cachedData,
        // Mark cache as immediately infinitely old (stale) so React Query runs a background fetch
        // invisibly on component mount without blocking the UI rendering!
        initialDataUpdatedAt: cachedData ? 0 : undefined,
    });

    // ── Client-Side Filter + Sort ─────────────────────────────
    const rows = useMemo(() => {
        let filtered = rawRows;

        // Text search across all fields
        if (debouncedSearch) {
            const q = debouncedSearch.toLowerCase();
            filtered = filtered.filter(r =>
                COLUMNS.some(col => strVal(r[col.key]).includes(q))
            );
        }

        if (filterFrom) {
            const from = new Date(filterFrom);
            filtered = filtered.filter(r => r.DATEOFACCEPTANCE && new Date(r.DATEOFACCEPTANCE) >= from);
        }
        if (filterTo) {
            const to = new Date(filterTo);
            to.setHours(23, 59, 59, 999);
            filtered = filtered.filter(r => r.DATEOFACCEPTANCE && new Date(r.DATEOFACCEPTANCE) <= to);
        }

        // Sort
        filtered = [...filtered].sort((a, b) => {
            const av = a[sortBy];
            const bv = b[sortBy];
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            const cmp = typeof av === 'number'
                ? av - bv
                : String(av).localeCompare(String(bv), undefined, { numeric: true });
            return sortOrder === 'asc' ? cmp : -cmp;
        });

        return filtered;
    }, [rawRows, debouncedSearch, filterFrom, filterTo, sortBy, sortOrder]);

    const hasFilters = searchInput || filterFrom || filterTo;

    // ── Toast ─────────────────────────────────────────────────
    const showToast = useCallback((message, type = 'success') => {
        setToast({ show: true, message, type });
        setTimeout(() => setToast({ show: false, message: '', type: 'success' }), 3500);
    }, []);

    // ── Copy Helper ───────────────────────────────────────────
    const handleCopy = useCallback((text, label, flashKey) => {
        if (text == null || text === '') return;
        navigator.clipboard.writeText(String(text)).then(() => {
            setCopiedKey(flashKey);
            setTimeout(() => setCopiedKey(null), 1200);
            showToast(`${label} copied`, 'success');
        });
    }, [showToast]);

    // ── Sort Handler ──────────────────────────────────────────
    const handleSort = useCallback((key) => {
        if (sortBy === key) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(key);
            setSortOrder('desc');
        }
    }, [sortBy, sortOrder]);

    // ── DocuSign Action ───────────────────────────────────────────
    const handleDocuSign = useCallback(async (row, e) => {
        e?.stopPropagation();
        const id = row.DECLARATION_ID;

        // Double-click / concurrent guard
        if (pendingSignRef.current.has(id)) return;

        pendingSignRef.current.add(id);
        setPendingSignIds(prev => new Set([...prev, id]));

        try {
            await sendDocuSignRequest({ id, principal: row.PRINCIPAL, processFactuurnummer: row.PROCESSFACTUURNUMMER });
            showToast(`Signature request sent for Declaration #${id}`, 'success');
        } catch (err) {
            showToast(`Failed to send request: ${err.message}`, 'error');
        } finally {
            pendingSignRef.current.delete(id);
            setPendingSignIds(prev => { const n = new Set(prev); n.delete(id); return n; });
        }
    }, [showToast]);

    // ── Keyboard Navigation ───────────────────────────────────
    useEffect(() => {
        const onKey = (e) => {
            if (document.activeElement === searchRef.current) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setFocusedIndex(p => Math.min(p + 1, rows.length - 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setFocusedIndex(p => Math.max(p - 1, 0));
            } else if (e.key === '/' || (e.ctrlKey && e.key === 'k')) {
                e.preventDefault();
                searchRef.current?.focus();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [rows]);

    const clearFilters = () => {
        setSearchInput('');
        setFilterFrom('');
        setFilterTo('');
    };

    const lastUpdated = dataUpdatedAt
        ? new Date(dataUpdatedAt).toLocaleTimeString()
        : null;

    // ── Loading ───────────────────────────────────────────────
    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-96">
                <div className="flex flex-col items-center gap-3">
                    <RefreshCw className="animate-spin text-[#714B67] w-8 h-8" />
                    <p className="text-sm text-gray-400 font-medium">Loading BestMing data…</p>
                </div>
            </div>
        );
    }

    if (isError) {
        return (
            <div className="p-8 text-center text-red-600 bg-red-50 rounded-lg border border-red-200 m-6">
                <AlertCircle className="w-8 h-8 mx-auto mb-2" />
                <p className="font-semibold">Failed to load data</p>
                <p className="text-xs text-red-500 mt-1">{error?.message}</p>
                <button
                    onClick={() => refetch()}
                    className="mt-4 px-4 py-2 bg-white border border-red-300 rounded-md shadow-sm hover:bg-red-50 text-sm font-medium"
                >
                    Retry
                </button>
            </div>
        );
    }

    // ── Render ────────────────────────────────────────────────
    return (
        <div className="min-h-screen bg-gray-50/50 p-4">

            {showSettings && (
                <div className="fixed inset-0 z-50 bg-white overflow-y-auto w-full h-full">
                    <FiscalSettings onClose={() => { setShowSettings(false); refetch(); }} />
                </div>
            )}

            <div className="w-full space-y-4">

                {/* ── Header ── */}
                <div className="flex justify-between items-end">
                    <div>
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 bg-[#714B67]/10 rounded-md flex items-center justify-center">
                                <FileSignature className="w-4 h-4 text-[#714B67]" />
                            </div>
                            <div>
                                <h1 className="text-xl font-bold text-gray-900 leading-tight">BestMing Signatures</h1>
                                <p className="text-[11px] text-gray-400 mt-0.5">
                                    Documents pending client signature via DocuSign
                                    {lastUpdated && (
                                        <span className="ml-2 text-gray-300">· last fetched {lastUpdated}</span>
                                    )}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Stats pill + Refresh + Settings */}
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setShowSettings(true)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#714B67] bg-white border border-[#714B67]/20 hover:bg-[#714B67]/5 shadow-sm rounded-md transition-colors font-medium"
                            title="Filter Settings"
                        >
                            <Settings className="w-3.5 h-3.5" />
                            Filters
                        </button>
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-md shadow-sm text-xs text-gray-500">
                            <FileText className="w-3.5 h-3.5 text-gray-400" />
                            <span className="font-semibold text-gray-700">{rows.length}</span>
                            <span>/ {rawRows.length} records</span>
                        </div>
                        <button
                            onClick={() => refetch()}
                            disabled={isFetching}
                            className="p-2.5 text-gray-400 hover:text-[#714B67] hover:bg-gray-100 rounded-md transition-all border border-gray-200 bg-white shadow-sm disabled:opacity-50"
                            title="Refresh data"
                        >
                            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin text-[#714B67]' : ''}`} />
                        </button>
                    </div>
                </div>

                {/* ── Search + Filters ── */}
                <div className="bg-white rounded-md border border-gray-200 shadow-sm">
                    {/* Search bar */}
                    <div className="p-3 border-b border-gray-100">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                                ref={searchRef}
                                type="text"
                                value={searchInput}
                                onChange={e => setSearchInput(e.target.value)}
                                placeholder="Search all fields — Dec. ID, Traces, Consignee, Importer, Principal…  |  Press / to focus"
                                className="w-full pl-10 pr-10 py-2.5 border border-gray-200 rounded-md text-sm focus:ring-2 focus:ring-[#714B67]/20 focus:border-[#714B67] outline-none transition-all bg-gray-50/50 placeholder:text-gray-400"
                            />
                            {searchInput && (
                                <button
                                    onClick={() => setSearchInput('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Filter row */}
                    <div className="px-3 py-2 flex flex-wrap gap-2 items-center">
                        {/* Date From */}
                        <input
                            type="date"
                            value={filterFrom}
                            onChange={e => setFilterFrom(e.target.value)}
                            title="Acceptance date from"
                            className="px-2 py-1.5 border border-gray-200 rounded text-xs focus:ring-1 focus:ring-[#714B67] focus:border-[#714B67] outline-none cursor-pointer"
                        />
                        <span className="text-gray-300 text-xs">→</span>
                        <input
                            type="date"
                            value={filterTo}
                            onChange={e => setFilterTo(e.target.value)}
                            title="Acceptance date to"
                            className="px-2 py-1.5 border border-gray-200 rounded text-xs focus:ring-1 focus:ring-[#714B67] focus:border-[#714B67] outline-none cursor-pointer"
                        />

                        <div className="flex-1" />

                        {hasFilters && (
                            <button
                                onClick={clearFilters}
                                className="text-xs text-gray-400 hover:text-[#714B67] transition-colors hover:underline flex items-center gap-1"
                            >
                                <X className="w-3 h-3" /> Clear filters
                            </button>
                        )}
                    </div>
                </div>

                {/* ── Table ── */}
                <div className="bg-white rounded-md border border-gray-200 shadow-sm overflow-hidden relative">

                    {/* Fetching progress bar */}
                    <div className={`absolute top-0 left-0 right-0 h-0.5 z-10 overflow-hidden transition-opacity duration-300 ${isFetching && !isLoading ? 'opacity-100' : 'opacity-0'}`}>
                        <div className="h-full w-full bg-[#714B67]/10">
                            <div className="h-full w-1/3 bg-[#714B67] rounded-full" style={{ animation: 'shimmer 1.2s ease-in-out infinite' }} />
                        </div>
                    </div>

                    <div className="overflow-auto max-h-[calc(100vh-240px)]">
                        <table className="w-full text-sm text-left border-collapse relative">
                            <thead className="sticky top-0 z-20 bg-gray-50 text-gray-400 uppercase font-bold text-[9px] select-none shadow-[0_1px_0_0_#e5e7eb] outline outline-1 outline-gray-200">
                                <tr>
                                    {COLUMNS.map(col => (
                                        <th
                                            key={col.key}
                                            className={`px-3 py-2 whitespace-nowrap ${col.sortable ? 'cursor-pointer hover:text-[#714B67] hover:bg-gray-100/60 transition-colors' : ''}`}
                                            onClick={() => col.sortable && handleSort(col.key)}
                                        >
                                            <span className="flex items-center">
                                                {col.label}
                                                {col.sortable && <SortIcon col={col.key} sort={sortBy} order={sortOrder} />}
                                            </span>
                                        </th>
                                    ))}
                                    <th className="px-3 py-2 text-right whitespace-nowrap">Sign</th>
                                </tr>
                            </thead>

                            <tbody className="divide-y divide-gray-50">
                                {rows.length === 0 ? (
                                    <tr>
                                        <td colSpan={COLUMNS.length + 1} className="px-6 py-14 text-center text-gray-500">
                                            <motion.div
                                                initial={{ opacity: 0, y: 8 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                className="flex flex-col items-center"
                                            >
                                                <FileText className="w-10 h-10 text-gray-200 mb-2" />
                                                <p className="font-medium text-sm">No records found</p>
                                                <p className="text-xs text-gray-400 mt-1">
                                                    {rawRows.length > 0 ? 'Try adjusting your search or filters' : 'No data returned from the source'}
                                                </p>
                                            </motion.div>
                                        </td>
                                    </tr>
                                ) : (
                                    rows.map((row, index) => {
                                        const id = row.DECLARATION_ID;
                                        const isPending = pendingSignIds.has(id);
                                        const isDeleted = row.MESSAGESTATUS === 'DELETED';
                                        const imp = row.IMPORTERCODE?.trim() || '';
                                        const cons = row.FISCALCONSIGNEECODE?.trim() || '';
                                        const isMismatched = imp !== cons;

                                        return (
                                            <motion.tr
                                                key={id ?? index}
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 1 }}
                                                transition={{ duration: 0.12, delay: Math.min(index * 0.008, 0.15) }}
                                                className={`group transition-colors cursor-default ${focusedIndex === index
                                                    ? 'bg-violet-50/80 ring-1 ring-inset ring-violet-200'
                                                    : isDeleted
                                                        ? 'bg-red-50/30 hover:bg-red-50/50'
                                                        : isMismatched
                                                            ? 'bg-amber-100 hover:bg-amber-200/70 border-l-2 border-l-amber-400'
                                                            : 'hover:bg-gray-50/60'
                                                    }`}
                                                onClick={() => setFocusedIndex(index)}
                                            >
                                                {/* Dec. ID — copyable */}
                                                <td className="px-3 py-1.5">
                                                    <CopyCell
                                                        value={id}
                                                        flashKey={`${id}-DECLARATION_ID`}
                                                        activeKey={copiedKey}
                                                        onCopy={() => handleCopy(id, 'Declaration ID', `${id}-DECLARATION_ID`)}
                                                        mono
                                                        accent
                                                    />
                                                </td>

                                                {/* Company */}
                                                <td className="px-3 py-1.5 text-xs text-gray-700 whitespace-nowrap">
                                                    {row.ACTIVECOMPANY || '—'}
                                                </td>

                                                {/* Traces ID — copyable */}
                                                <td className="px-3 py-1.5">
                                                    <CopyCell
                                                        value={row.TRACESIDENTIFICATION}
                                                        flashKey={`${id}-TRACES`}
                                                        activeKey={copiedKey}
                                                        onCopy={() => handleCopy(row.TRACESIDENTIFICATION, 'Traces ID', `${id}-TRACES`)}
                                                        maxW="max-w-[160px]"
                                                    />
                                                </td>

                                                {/* Consignee */}
                                                <td className="px-3 py-1.5 text-xs text-gray-600 truncate max-w-[120px]" title={row.FISCALCONSIGNEECODE || ''}>
                                                    {row.FISCALCONSIGNEECODE || '—'}
                                                </td>

                                                {/* Importer */}
                                                <td className="px-3 py-1.5 text-xs text-gray-600 truncate max-w-[120px]" title={row.IMPORTERCODE || ''}>
                                                    {row.IMPORTERCODE || '—'}
                                                </td>

                                                {/* Country */}
                                                <td className="px-3 py-1.5">
                                                    <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-700">
                                                        {row.IMPORTERCOUNTRY || '—'}
                                                    </span>
                                                </td>

                                                {/* LINKIDERP4 */}
                                                <td className="px-3 py-1.5 text-xs text-gray-600 truncate max-w-[120px]" title={row.LINKIDERP4 || ''}>
                                                    {row.LINKIDERP4 || '—'}
                                                </td>

                                                {/* Status + ICL tag */}
                                                <td className="px-3 py-1.5">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        <StatusBadge status={row.MESSAGESTATUS} />
                                                        {isMismatched && (
                                                            <span
                                                                className="inline-flex items-center px-1.5 py-0.5 rounded-[2px] text-[10px] font-bold border bg-amber-50 text-amber-700 border-amber-200"
                                                                title={`Importer (${row.IMPORTERCODE?.trim()}) ≠ Consignee (${row.FISCALCONSIGNEECODE?.trim()})`}
                                                            >
                                                                ICL
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>

                                                {/* Principal */}
                                                <td className="px-3 py-1.5 text-xs font-medium text-gray-800 truncate max-w-[130px]" title={row.PRINCIPAL || ''}>
                                                    {row.PRINCIPAL?.trim() || '—'}
                                                </td>

                                                {/* Date */}
                                                <td className="px-3 py-1.5 text-xs text-gray-500 whitespace-nowrap">
                                                    {fmtDate(row.DATEOFACCEPTANCE)}
                                                </td>

                                                {/* Invoice No — copyable */}
                                                <td className="px-3 py-1.5">
                                                    <CopyCell
                                                        value={row.PROCESSFACTUURNUMMER}
                                                        flashKey={`${id}-INVOICE`}
                                                        activeKey={copiedKey}
                                                        onCopy={() => handleCopy(row.PROCESSFACTUURNUMMER, 'Invoice No.', `${id}-INVOICE`)}
                                                        mono
                                                    />
                                                </td>

                                                {/* DocuSign Action */}
                                                <td className="px-3 py-1.5 text-right" onClick={e => e.stopPropagation()}>
                                                    <DocuSignButton
                                                        row={row}
                                                        isPending={isPending}
                                                        isDeleted={isDeleted}
                                                        onSign={handleDocuSign}
                                                    />
                                                </td>
                                            </motion.tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Table footer */}
                    <div className="px-4 py-2 border-t border-gray-100 flex items-center justify-between bg-gray-50/40">
                        <p className="text-[11px] text-gray-400">
                            {rows.length === rawRows.length
                                ? <><span className="font-semibold text-gray-600">{rows.length}</span> records</>
                                : <><span className="font-semibold text-gray-600">{rows.length}</span> of <span className="font-semibold text-gray-600">{rawRows.length}</span> records</>
                            }
                            {debouncedSearch && (
                                <span className="ml-2 text-[#714B67]">· "{debouncedSearch}"</span>
                            )}
                        </p>
                        <p className="text-[10px] text-gray-300">
                            Press <kbd className="px-1 py-0.5 bg-gray-100 border border-gray-200 rounded text-[9px] text-gray-500">/</kbd> to search
                        </p>
                    </div>
                </div>
            </div>

            {/* ── Toast ── */}
            {toast.show && (
                <div className="fixed bottom-6 right-6 z-[100]" style={{ animation: 'slideInRight 0.3s ease-out' }}>
                    <div className={`flex items-center gap-3 px-5 py-3 rounded-lg shadow-2xl border ${toast.type === 'success'
                        ? 'bg-white border-green-500 text-green-800'
                        : 'bg-white border-red-500 text-red-800'
                        }`}>
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${toast.type === 'success' ? 'bg-green-100' : 'bg-red-100'
                            }`}>
                            {toast.type === 'success'
                                ? <CheckCircle2 className="w-4 h-4 text-green-600" />
                                : <AlertCircle className="w-4 h-4 text-red-600" />
                            }
                        </div>
                        <p className="text-sm font-medium">{toast.message}</p>
                    </div>
                </div>
            )}

            <style>{`
                @keyframes slideInRight {
                    from { transform: translateX(110%); opacity: 0; }
                    to   { transform: translateX(0);    opacity: 1; }
                }
                @keyframes shimmer {
                    0%   { transform: translateX(-100%); }
                    100% { transform: translateX(400%);  }
                }
            `}</style>
        </div>
    );
};

// ─── CopyCell sub-component ───────────────────────────────────
const CopyCell = ({ value, flashKey, activeKey, onCopy, mono = false, accent = false, maxW = '' }) => {
    const isCopied = activeKey === flashKey;
    const display = value ?? '—';
    if (value == null) return <span className="text-xs text-gray-300">—</span>;

    return (
        <button
            type="button"
            onClick={onCopy}
            title="Click to copy"
            className={`group/cell flex items-center gap-1 cursor-copy transition-colors rounded px-0.5 -mx-0.5 hover:bg-gray-100/80 ${mono ? 'font-mono' : ''
                } ${accent ? 'text-[#714B67] font-bold text-[11px]' : 'text-[11px] text-gray-500 hover:text-gray-700'
                } ${maxW}`}
        >
            <span className={`truncate ${maxW}`}>{display}</span>
            {isCopied
                ? <CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0" />
                : <Copy className="w-3 h-3 opacity-0 group-hover/cell:opacity-40 flex-shrink-0 transition-opacity" />
            }
        </button>
    );
};

// ─── DocuSign Button sub-component ───────────────────────────
const DocuSignButton = ({ row, isPending, isDeleted, onSign }) => {
    if (isDeleted) {
        return (
            <span className="text-[10px] text-gray-300 font-medium px-2">Deleted</span>
        );
    }

    return (
        <button
            type="button"
            onClick={e => onSign(row, e)}
            disabled={isPending}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-[3px] text-[10px] font-bold transition-all shadow-sm border
                ${isPending
                    ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
                    : 'bg-[#714B67] text-white border-[#714B67] hover:bg-[#5a3c52] active:scale-[0.97]'
                }`}
            title={isPending ? 'Sending…' : 'Send for signature via DocuSign'}
        >
            {isPending
                ? <RefreshCw className="w-3 h-3 animate-spin" />
                : <PenLine className="w-3 h-3" />
            }
            {isPending ? 'Sending…' : 'Sign'}
        </button>
    );
};

export default BestmingSignatures;
