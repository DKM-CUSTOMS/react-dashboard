import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
    Settings, Save, Plus, Trash2, ShieldAlert,
    CheckCircle2, RefreshCw, Filter, Layers, ArrowLeft
} from 'lucide-react';

// API helpers for the settings
const fetchFilters = async () => {
    const res = await fetch('/api/fiscal/filters');
    if (!res.ok) throw new Error('Failed to fetch filters');
    return res.json();
};

const saveFilters = async (filters) => {
    const res = await fetch('/api/fiscal/filters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters })
    });
    if (!res.ok) throw new Error('Failed to save filters');
    return res.json();
};

const FILTER_FIELDS = [
    { value: 'DECLARATION_ID', label: 'DECLARATION_ID' },
    { value: 'ACTIVECOMPANY', label: 'ACTIVECOMPANY' },
    { value: 'TRACESIDENTIFICATION', label: 'TRACESIDENTIFICATION' },
    { value: 'FISCALCONSIGNEECODE', label: 'FISCALCONSIGNEECODE' },
    { value: 'IMPORTERCODE', label: 'IMPORTERCODE' },
    { value: 'IMPORTERCOUNTRY', label: 'IMPORTERCOUNTRY' },
    { value: 'LINKIDERP4', label: 'LINKIDERP4' },
    { value: 'MESSAGESTATUS', label: 'MESSAGESTATUS' },
    { value: 'PRINCIPAL', label: 'PRINCIPAL' },
    { value: 'DATEOFACCEPTANCE', label: 'DATEOFACCEPTANCE' },
    { value: 'PROCESSFACTUURNUMMER', label: 'PROCESSFACTUURNUMMER' },
];

const OPERATORS = [
    { value: 'not_equals', label: 'Exclude (Not Equals)', description: 'Hide rows that match exactly' },
    { value: 'not_contains', label: 'Exclude Contains', description: 'Hide rows containing this text' },
    { value: 'equals', label: 'Only Show (Equals)', description: 'Show only rows matching exactly' },
    { value: 'contains', label: 'Only Show Contains', description: 'Show only rows containing text' }
];

const FiscalSettings = ({ onClose }) => {
    const [filters, setFilters] = useState([]);
    const [initialFiltersStr, setInitialFiltersStr] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState({ show: false, msg: '', type: 'success' });

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            setLoading(true);
            const data = await fetchFilters();
            const loaded = data.filters || [];
            setFilters(loaded);
            setInitialFiltersStr(JSON.stringify(loaded));
        } catch (err) {
            showToast('Failed to load filters', 'error');
        } finally {
            setLoading(false);
        }
    };

    const showToast = (msg, type = 'success') => {
        setToast({ show: true, msg, type });
        setTimeout(() => setToast({ show: false, msg: '', type }), 3000);
    };

    const handleAddFilter = () => {
        const newFilter = {
            id: Date.now().toString(),
            field: 'IMPORTERCODE',
            operator: 'not_equals',
            value: '',
            active: true
        };
        setFilters([...filters, newFilter]);
    };

    const handleUpdateFilter = (id, key, val) => {
        setFilters(filters.map(f => f.id === id ? { ...f, [key]: val } : f));
    };

    const handleRemoveFilter = (id) => {
        setFilters(filters.filter(f => f.id !== id));
    };

    const handleSave = async () => {
        try {
            setSaving(true);
            // Quick validation: remove empty filters
            const validFilters = filters.filter(f => f.value.trim() !== '');
            await saveFilters(validFilters);
            setFilters(validFilters);
            setInitialFiltersStr(JSON.stringify(validFilters));
            showToast('Filters saved securely', 'success');
        } catch (err) {
            showToast('Failed to save filters', 'error');
        } finally {
            setSaving(false);
        }
    };

    const hasUnsavedChanges = JSON.stringify(filters) !== initialFiltersStr && !loading;

    return (
        <div className="min-h-screen bg-white p-6 md:p-8">
            <div className="max-w-5xl mx-auto space-y-6">

                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                    <div className="flex items-center gap-3">
                        {onClose && (
                            <button
                                onClick={() => {
                                    if (hasUnsavedChanges) {
                                        if (window.confirm("You have unsaved filters. Are you sure you want to exit without saving?")) {
                                            onClose();
                                        }
                                    } else {
                                        onClose();
                                    }
                                }}
                                className="mr-2 p-2 hover:bg-gray-200 rounded-full text-gray-500 transition-colors"
                                title="Back to BestMing Signatures"
                            >
                                <ArrowLeft className="w-5 h-5" />
                            </button>
                        )}
                        <div className="w-10 h-10 bg-[#714B67]/10 rounded-xl flex items-center justify-center border border-[#714B67]/20">
                            <Settings className="w-5 h-5 text-[#714B67]" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Fiscal Settings</h1>
                            <p className="text-sm text-gray-500 mt-1">
                                Manage global data filters for BestMing Signatures and other Fiscal tools.
                            </p>
                        </div>
                    </div>
                    <div>
                        <button
                            onClick={handleSave}
                            disabled={saving || loading || (!hasUnsavedChanges && filters.length > 0)}
                            className={`flex items-center gap-2 px-6 py-2.5 text-sm font-semibold rounded-lg shadow-md transition-all active:scale-[0.98] disabled:opacity-50
                                ${hasUnsavedChanges
                                    ? 'bg-amber-500 hover:bg-amber-600 text-white ring-4 ring-amber-500/30'
                                    : 'bg-[#714B67] hover:bg-[#5a3c52] text-white'
                                }`}
                        >
                            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            {saving ? 'Saving...' : hasUnsavedChanges ? 'Save Changes *' : 'Saved'}
                        </button>
                    </div>
                </div>

                {/* Filter Builder Section */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
                >
                    <div className="p-5 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                        <div className="flex items-center gap-2.5">
                            <Filter className="w-4 h-4 text-[#714B67]" />
                            <h2 className="text-sm font-semibold text-gray-800">Global Exclusion Rules</h2>
                        </div>
                        <button
                            onClick={handleAddFilter}
                            className="flex items-center gap-1.5 text-[#714B67] text-sm font-medium hover:bg-[#714B67]/10 px-3 py-1.5 rounded-md transition-colors"
                        >
                            <Plus className="w-4 h-4" /> Add Rule
                        </button>
                    </div>

                    <div className="p-5">
                        {loading ? (
                            <div className="p-8 flex flex-col items-center justify-center text-gray-400">
                                <RefreshCw className="w-6 h-6 animate-spin mb-3 text-[#714B67]" />
                                <p className="text-sm">Loading your rules...</p>
                            </div>
                        ) : filters.length === 0 ? (
                            <div className="text-center py-12 px-4">
                                <div className="w-16 h-16 bg-gray-50 flex items-center justify-center rounded-full mx-auto mb-4 border border-gray-100">
                                    <Layers className="w-6 h-6 text-gray-300" />
                                </div>
                                <h3 className="text-sm font-semibold text-gray-800 mb-1">No filtering rules</h3>
                                <p className="text-xs text-gray-500 mb-5 max-w-sm mx-auto">
                                    You can create rules to automatically hide certain importers or consignees from the Bestming Signatures dashboard.
                                </p>
                                <button
                                    onClick={handleAddFilter}
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 shadow-sm hover:bg-gray-50 text-sm font-medium rounded-lg transition-colors"
                                >
                                    <Plus className="w-4 h-4" /> Create your first rule
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {filters.map((filter, index) => (
                                    <motion.div
                                        initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                                        key={filter.id}
                                        className="flex flex-col sm:flex-row gap-3 p-3 bg-white border border-gray-200 rounded-lg shadow-sm group hover:border-[#714B67]/30 transition-colors items-start sm:items-center"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-6 h-6 rounded-full bg-gray-100 text-xs font-bold text-gray-500 flex items-center justify-center flex-shrink-0">
                                                {index + 1}
                                            </div>
                                            <label className="relative inline-flex items-center cursor-pointer" title="Toggle this rule on/off">
                                                <input
                                                    type="checkbox"
                                                    className="sr-only peer"
                                                    checked={filter.active}
                                                    onChange={e => handleUpdateFilter(filter.id, 'active', e.target.checked)}
                                                />
                                                <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#714B67]"></div>
                                            </label>
                                        </div>

                                        <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3 w-full">
                                            <select
                                                value={filter.field}
                                                onChange={e => handleUpdateFilter(filter.id, 'field', e.target.value)}
                                                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm outline-none focus:border-[#714B67] focus:ring-1 focus:ring-[#714B67] text-gray-700 bg-gray-50/50"
                                            >
                                                {FILTER_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                                            </select>

                                            <select
                                                value={filter.operator}
                                                onChange={e => handleUpdateFilter(filter.id, 'operator', e.target.value)}
                                                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm outline-none focus:border-[#714B67] focus:ring-1 focus:ring-[#714B67] text-gray-700 bg-gray-50/50"
                                            >
                                                {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                            </select>

                                            <div className="relative">
                                                <input
                                                    type="text"
                                                    value={filter.value}
                                                    onChange={e => handleUpdateFilter(filter.id, 'value', e.target.value)}
                                                    placeholder="Enter value (e.g. VANCA)"
                                                    className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm outline-none focus:border-[#714B67] focus:ring-1 focus:ring-[#714B67] text-gray-700"
                                                />
                                                {filter.value === '' && (
                                                    <ShieldAlert className="w-4 h-4 text-amber-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                                                )}
                                            </div>
                                        </div>

                                        <button
                                            onClick={() => handleRemoveFilter(filter.id)}
                                            className="p-2 ml-auto text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                                            title="Delete rule"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </motion.div>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="px-5 py-3 bg-gray-50/50 border-t border-gray-100 flex items-center justify-between">
                        <span className="text-xs text-gray-400 flex items-center gap-1.5 pt-0.5">
                            <ShieldAlert className="w-3.5 h-3.5" /> Empty values are ignored during save.
                        </span>
                    </div>
                </motion.div>

                <div className="bg-blue-50/50 rounded-xl p-5 border border-blue-100/50 flex gap-3 text-blue-800">
                    <ShieldAlert className="w-5 h-5 flex-shrink-0 text-blue-600" />
                    <div>
                        <h4 className="font-semibold text-sm">How do filters work?</h4>
                        <p className="text-xs mt-1 leading-relaxed opacity-80">
                            These filtering rules apply immediately on the backend whenever Bestming documents are fetched.
                            If you set an "Exclude" rule for an importer, that importer will completely disappear from the BestMing Signatures page across all users.
                        </p>
                    </div>
                </div>

            </div>

            {/* Toast Notification */}
            {toast.show && (
                <div className="fixed bottom-6 right-6 z-[100]" style={{ animation: 'slideInRight 0.3s ease-out' }}>
                    <div className={`flex items-center gap-3 px-5 py-3 rounded-lg shadow-2xl border bg-white ${toast.type === 'error' ? 'border-red-500' : 'border-green-500'
                        }`}>
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${toast.type === 'error' ? 'bg-red-100' : 'bg-green-100'
                            }`}>
                            {toast.type === 'error' ? <ShieldAlert className="w-3 h-3 text-red-600" /> : <CheckCircle2 className="w-3 h-3 text-green-600" />}
                        </div>
                        <p className={`text-sm font-medium ${toast.type === 'error' ? 'text-red-800' : 'text-green-800'}`}>
                            {toast.msg}
                        </p>
                    </div>
                </div>
            )}
            <style>{`
                @keyframes slideInRight {
                    from { transform: translateX(110%); opacity: 0; }
                    to   { transform: translateX(0);    opacity: 1; }
                }
            `}</style>
        </div>
    );
};

export default FiscalSettings;
