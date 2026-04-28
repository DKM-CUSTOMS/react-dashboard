import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  GitBranch, Sparkles, Database, Shuffle, Zap, Layers,
  Plus, Play, Settings2, Trash2, ToggleLeft, ToggleRight,
  CheckCircle2, AlertTriangle, X, FileText, Package, ChevronRight,
} from 'lucide-react';
import { getFlows, createFlow, updateFlow, deleteFlow } from '../../api/rulesFlowsApi';

// ─── Constants ────────────────────────────────────────────────────────────────

const STRATEGY_META = {
  condition:         { label: 'Condition',    bg: 'bg-violet-100',  text: 'text-violet-700',  icon: GitBranch },
  ai_prompt:         { label: 'AI Review',    bg: 'bg-cyan-100',    text: 'text-cyan-700',    icon: Sparkles },
  db_lookup:         { label: 'DB Lookup',    bg: 'bg-amber-100',   text: 'text-amber-700',   icon: Database },
  cross_declaration: { label: 'Cross-Check',  bg: 'bg-blue-100',    text: 'text-blue-700',    icon: Shuffle },
  external_api:      { label: 'Ext. API',     bg: 'bg-emerald-100', text: 'text-emerald-700', icon: Zap },
  composite:         { label: 'Composite',    bg: 'bg-pink-100',    text: 'text-pink-700',    icon: Layers },
};

const TEMPLATES = [
  { name: 'Standard Export',  description: 'Incoterm check, MRN required, invoice amount verified', icon: Package,     color: 'text-indigo-500', bg: 'bg-indigo-50', border: 'border-indigo-200' },
  { name: '4200 Import',      description: 'VAT procedure validation, fiscal representative, quota alerts', icon: FileText, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  { name: 'NCTS Transit',     description: 'Transit procedure codes, guarantee amount, departure/destination', icon: ChevronRight, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
];

// ─── Strategy Pill ────────────────────────────────────────────────────────────

function StrategyPill({ type }) {
  const meta = STRATEGY_META[type] ?? STRATEGY_META.condition;
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${meta.bg} ${meta.text}`}>
      <Icon size={9} />
      {meta.label}
    </span>
  );
}

// ─── Flow Card (Microsoft Fluent style) ───────────────────────────────────────

function FlowCard({ flow, onToggle, onDelete }) {
  const navigate = useNavigate();
  const strategies = Object.entries(flow.strategy_counts ?? {});

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className="bg-white border border-gray-200 rounded hover:border-gray-300 hover:shadow-sm transition-all overflow-hidden group"
    >
      <div className="flex">
        {/* Left accent stripe */}
        <div className={`w-0.5 flex-shrink-0 ${flow.is_active ? 'bg-indigo-500' : 'bg-gray-200'}`} />

        <div className="flex-1 p-3.5">
          {/* Header row */}
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <h3 className="font-semibold text-sm text-gray-900 leading-tight truncate">
              {flow.name}
            </h3>
            <span className={`flex-shrink-0 flex items-center gap-1 text-xs font-medium ${flow.is_active ? 'text-green-600' : 'text-gray-400'}`}>
              {flow.is_active
                ? <CheckCircle2 size={11} />
                : <AlertTriangle size={11} />}
              {flow.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>

          {/* Description */}
          {flow.description && (
            <p className="text-xs text-gray-500 mb-2.5 line-clamp-1 leading-relaxed">
              {flow.description}
            </p>
          )}

          {/* Strategy pills */}
          {strategies.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2.5">
              {strategies.map(([type]) => <StrategyPill key={type} type={type} />)}
            </div>
          )}

          {/* Check count */}
          <div className="flex items-center gap-1 text-xs text-gray-500 mb-3">
            <span className="font-semibold text-gray-700">{flow.active_check_count ?? 0}</span>
            <span className="text-gray-300">/</span>
            <span>{flow.check_count ?? 0}</span>
            <span>checks active</span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 pt-2.5 border-t border-gray-100">
            <button
              onClick={() => navigate(`/rules/flows/${flow.id}/builder`)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
            >
              <Settings2 size={11} /> Build
            </button>
            <button
              onClick={() => navigate(`/rules/run?flowId=${flow.id}`)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-xs font-semibold border border-gray-200 hover:bg-gray-50 text-gray-600 transition-colors"
            >
              <Play size={11} fill="currentColor" /> Run
            </button>
            <button
              onClick={() => onToggle(flow)}
              className="p-1.5 rounded border border-gray-200 hover:bg-gray-50 transition-colors"
              title={flow.is_active ? 'Deactivate' : 'Activate'}
            >
              {flow.is_active
                ? <ToggleRight size={14} className="text-green-500" />
                : <ToggleLeft size={14} className="text-gray-400" />}
            </button>
            <button
              onClick={() => onDelete(flow)}
              className="p-1.5 rounded border border-red-100 hover:bg-red-50 text-red-400 transition-colors"
              title="Delete"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── New Flow Modal ───────────────────────────────────────────────────────────

function NewFlowModal({ onClose, onCreate }) {
  const [name, setName]               = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving]           = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onCreate({ name: name.trim(), description: description.trim() });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320 }}
        className="bg-white rounded border border-gray-200 shadow-2xl w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">New Validation Flow</h2>
            <p className="text-xs text-gray-500 mt-0.5">Build a pipeline of checks for a declaration type</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100 transition-colors">
            <X size={16} className="text-gray-400" />
          </button>
        </div>

        {/* Template quick-starts */}
        <div className="px-5 pt-4">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Start from a template
          </div>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {TEMPLATES.map(t => {
              const Icon = t.icon;
              return (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => { setName(t.name); setDescription(t.description); }}
                  className={`text-left p-2.5 rounded border ${t.border} ${t.bg} hover:shadow-sm transition-all`}
                >
                  <Icon size={13} className={`${t.color} mb-1`} />
                  <div className="text-xs font-semibold text-gray-800 leading-tight">{t.name}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={submit} className="px-5 pb-5 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Flow name *</label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. 4200 Import, NCTS Transit"
              className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What declarations does this flow validate?"
              rows={2}
              className="w-full border border-gray-200 rounded px-3 py-2 text-sm resize-none focus:outline-none focus:border-indigo-400 transition-colors"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 rounded border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={!name.trim() || saving}
              className="flex-1 py-2 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold disabled:opacity-50 transition-colors">
              {saving ? 'Creating…' : 'Create Flow'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FlowsPage() {
  const navigate       = useNavigate();
  const [flows, setFlows]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [error, setError]     = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      setFlows(await getFlows());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (data) => {
    const flow = await createFlow(data);
    setFlows(prev => [...prev, { ...flow, check_count: 0, active_check_count: 0, strategy_counts: {} }]);
  };

  const handleToggle = async (flow) => {
    try {
      const updated = await updateFlow(flow.id, { is_active: !flow.is_active });
      setFlows(prev => prev.map(f => f.id === flow.id ? { ...f, ...updated } : f));
    } catch (e) { alert(e.message); }
  };

  const handleDelete = async (flow) => {
    if (!confirm(`Delete flow "${flow.name}"? This will remove all its checks.`)) return;
    try {
      await deleteFlow(flow.id);
      setFlows(prev => prev.filter(f => f.id !== flow.id));
    } catch (e) { alert(e.message); }
  };

  const activeFlows  = flows.filter(f => f.is_active).length;
  const totalChecks  = flows.reduce((s, f) => s + (f.check_count ?? 0), 0);
  const aiChecks     = flows.reduce((s, f) => s + (f.strategy_counts?.ai_prompt ?? 0), 0);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Page header ── */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-900">Validation Flows</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Custom declaration checks — run before submitting to customs.
              </p>
            </div>
            <button
              onClick={() => setShowNew(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors shadow-sm"
            >
              <Plus size={14} /> New Flow
            </button>
          </div>

          {/* Stats strip */}
          {flows.length > 0 && (
            <div className="flex items-center gap-6 mt-4 pt-4 border-t border-gray-100">
              {[
                { label: 'Flows',         value: flows.length,  sub: `${activeFlows} active` },
                { label: 'Total Checks',  value: totalChecks,   sub: 'across all flows' },
                { label: 'AI Checks',     value: aiChecks,      sub: 'powered by Claude' },
              ].map(stat => (
                <div key={stat.label} className="flex items-baseline gap-2">
                  <span className="text-xl font-bold text-gray-900">{stat.value}</span>
                  <div>
                    <div className="text-xs font-semibold text-gray-600">{stat.label}</div>
                    <div className="text-xs text-gray-400">{stat.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        {error && (
          <div className="mb-5 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            Failed to load flows: {error}
          </div>
        )}

        {/* Loading skeletons */}
        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="bg-white border border-gray-100 rounded p-4 animate-pulse">
                <div className="h-4 bg-gray-100 rounded w-3/4 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-full mb-3" />
                <div className="h-7 bg-gray-100 rounded" />
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && flows.length === 0 && (
          <div className="text-center py-20">
            <div className="w-12 h-12 rounded bg-indigo-50 flex items-center justify-center mx-auto mb-3">
              <GitBranch size={22} className="text-indigo-400" />
            </div>
            <h3 className="text-base font-semibold text-gray-900 mb-1">No validation flows</h3>
            <p className="text-sm text-gray-500 mb-5 max-w-xs mx-auto">
              Create a flow to define the checks that run against your declarations before customs submission.
            </p>
            <button
              onClick={() => setShowNew(true)}
              className="px-4 py-2 rounded bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-sm"
            >
              Create first flow
            </button>
          </div>
        )}

        {/* Flows grid */}
        {!loading && flows.length > 0 && (
          <AnimatePresence mode="popLayout">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {flows.map(flow => (
                <FlowCard
                  key={flow.id}
                  flow={flow}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </AnimatePresence>
        )}
      </div>

      <AnimatePresence>
        {showNew && <NewFlowModal onClose={() => setShowNew(false)} onCreate={handleCreate} />}
      </AnimatePresence>
    </div>
  );
}
