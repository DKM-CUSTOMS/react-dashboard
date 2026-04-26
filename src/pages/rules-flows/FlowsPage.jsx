import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  GitBranch, Sparkles, Database, Shuffle, Zap, Layers,
  Plus, Play, Settings2, Trash2, ToggleLeft, ToggleRight,
  CheckCircle2, AlertTriangle, RefreshCw, ChevronRight, Shield
} from 'lucide-react';
import { getFlows, createFlow, updateFlow, deleteFlow, seedDemo } from '../../api/rulesFlowsApi';

const STRATEGY_META = {
  condition:         { label: 'Condition',       color: 'purple', bg: 'bg-purple-100',  text: 'text-purple-700',  border: 'border-purple-300',  icon: GitBranch },
  ai_prompt:         { label: 'AI Prompt',        color: 'cyan',   bg: 'bg-cyan-100',    text: 'text-cyan-700',    border: 'border-cyan-300',    icon: Sparkles },
  db_lookup:         { label: 'DB Lookup',        color: 'amber',  bg: 'bg-amber-100',   text: 'text-amber-700',   border: 'border-amber-300',   icon: Database },
  cross_declaration: { label: 'Cross Decl.',      color: 'blue',   bg: 'bg-blue-100',    text: 'text-blue-700',    border: 'border-blue-300',    icon: Shuffle },
  external_api:      { label: 'External API',     color: 'emerald',bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-300', icon: Zap },
  composite:         { label: 'Composite',        color: 'pink',   bg: 'bg-pink-100',    text: 'text-pink-700',    border: 'border-pink-300',    icon: Layers },
};

function StrategyPill({ type }) {
  const meta = STRATEGY_META[type] ?? STRATEGY_META.condition;
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${meta.bg} ${meta.text}`}>
      <Icon size={10} />
      {meta.label}
    </span>
  );
}

function FlowCard({ flow, onRun, onBuild, onToggle, onDelete }) {
  const navigate = useNavigate();
  const strategies = Object.entries(flow.strategy_counts ?? {});

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-shadow overflow-hidden group"
    >
      {/* top accent bar */}
      <div className={`h-1 w-full ${flow.is_active ? 'bg-gradient-to-r from-blue-500 to-indigo-500' : 'bg-gray-200'}`} />

      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 text-lg leading-tight truncate">{flow.name}</h3>
            {flow.description && (
              <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">{flow.description}</p>
            )}
          </div>
          <span className={`ml-3 flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${flow.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            {flow.is_active ? <CheckCircle2 size={10} /> : <AlertTriangle size={10} />}
            {flow.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>

        {/* Check stats */}
        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm text-gray-600">
            <span className="font-semibold text-gray-900">{flow.active_check_count ?? 0}</span>
            <span className="text-gray-400">/{flow.check_count ?? 0}</span> checks active
          </span>
          {strategies.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {strategies.map(([type]) => (
                <StrategyPill key={type} type={type} />
              ))}
            </div>
          )}
        </div>

        {/* Pipeline mini-preview */}
        {(flow.check_count ?? 0) > 0 && (
          <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center">
              <Shield size={12} className="text-gray-400" />
            </div>
            {Object.entries(flow.strategy_counts ?? {}).flatMap(([type, count]) =>
              Array.from({ length: Math.min(count, 3) }, (_, i) => {
                const meta = STRATEGY_META[type] ?? STRATEGY_META.condition;
                const Icon = meta.icon;
                return (
                  <React.Fragment key={`${type}-${i}`}>
                    <ChevronRight size={10} className="text-gray-300 flex-shrink-0" />
                    <div className={`flex-shrink-0 w-6 h-6 rounded-full ${meta.bg} flex items-center justify-center`}>
                      <Icon size={11} className={meta.text} />
                    </div>
                  </React.Fragment>
                );
              })
            )}
            {(flow.check_count ?? 0) > 6 && (
              <>
                <ChevronRight size={10} className="text-gray-300 flex-shrink-0" />
                <span className="flex-shrink-0 text-xs text-gray-400">+{flow.check_count - 6}</span>
              </>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
          <button
            onClick={() => onRun(flow)}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
          >
            <Play size={13} fill="currentColor" />
            Run
          </button>
          <button
            onClick={() => navigate(`/rules/flows/${flow.id}/builder`)}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium transition-colors"
          >
            <Settings2 size={13} />
            Build
          </button>
          <button
            onClick={() => onToggle(flow)}
            className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500 transition-colors"
            title={flow.is_active ? 'Deactivate' : 'Activate'}
          >
            {flow.is_active ? <ToggleRight size={16} className="text-green-500" /> : <ToggleLeft size={16} />}
          </button>
          <button
            onClick={() => onDelete(flow)}
            className="p-1.5 rounded-lg border border-red-100 hover:bg-red-50 text-red-400 transition-colors"
            title="Delete flow"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function NewFlowModal({ onClose, onCreate }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

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
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md"
      >
        <div className="p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-1">New Flow</h2>
          <p className="text-sm text-gray-500 mb-5">Create a named pipeline of declaration checks</p>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Flow name *</label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. 4200 Import, NCTS Transit"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this flow validate?"
                rows={3}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button type="submit" disabled={!name.trim() || saving} className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50">
                {saving ? 'Creating…' : 'Create Flow'}
              </button>
            </div>
          </form>
        </div>
      </motion.div>
    </div>
  );
}

export default function FlowsPage() {
  const navigate = useNavigate();
  const [flows, setFlows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [runTarget, setRunTarget] = useState(null);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getFlows();
      setFlows(data);
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
    setFlows((prev) => [...prev, { ...flow, check_count: 0, active_check_count: 0, strategy_counts: {} }]);
  };

  const handleToggle = async (flow) => {
    try {
      const updated = await updateFlow(flow.id, { is_active: !flow.is_active });
      setFlows((prev) => prev.map((f) => (f.id === flow.id ? { ...f, ...updated } : f)));
    } catch (e) {
      alert(e.message);
    }
  };

  const handleDelete = async (flow) => {
    if (!confirm(`Delete flow "${flow.name}"? This will remove all its checks.`)) return;
    try {
      await deleteFlow(flow.id);
      setFlows((prev) => prev.filter((f) => f.id !== flow.id));
    } catch (e) {
      alert(e.message);
    }
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      await seedDemo();
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setSeeding(false);
    }
  };

  const totalChecks = flows.reduce((s, f) => s + (f.check_count ?? 0), 0);
  const activeFlows = flows.filter((f) => f.is_active).length;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* Header */}
      <div className="max-w-7xl mx-auto">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Rules & Flows</h1>
            <p className="text-gray-500 mt-1">Intelligent declaration self-check platform — run before submitting to customs</p>
          </div>
          <div className="flex items-center gap-3">
            {flows.length === 0 && !loading && (
              <button
                onClick={handleSeed}
                disabled={seeding}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-dashed border-blue-300 text-blue-600 hover:bg-blue-50 text-sm font-medium transition-colors"
              >
                <RefreshCw size={14} className={seeding ? 'animate-spin' : ''} />
                {seeding ? 'Loading demo…' : 'Load demo flows'}
              </button>
            )}
            <button
              onClick={() => setShowNew(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors shadow-sm"
            >
              <Plus size={16} />
              New Flow
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: 'Total Flows', value: flows.length, sub: `${activeFlows} active` },
            { label: 'Total Checks', value: totalChecks, sub: 'across all flows' },
            { label: 'AI Checks', value: flows.reduce((s, f) => s + (f.strategy_counts?.ai_prompt ?? 0), 0), sub: 'powered by LLM' },
          ].map((stat) => (
            <div key={stat.label} className="bg-white border border-gray-200 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-gray-900">{stat.value}</div>
              <div className="text-sm font-medium text-gray-700 mt-0.5">{stat.label}</div>
              <div className="text-xs text-gray-400">{stat.sub}</div>
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            Failed to load flows: {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white border border-gray-100 rounded-xl p-5 animate-pulse">
                <div className="h-1 bg-gray-100 rounded mb-4" />
                <div className="h-5 bg-gray-100 rounded w-3/4 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-full mb-4" />
                <div className="h-8 bg-gray-100 rounded" />
              </div>
            ))}
          </div>
        )}

        {/* Flows grid */}
        {!loading && flows.length === 0 && (
          <div className="text-center py-24">
            <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-4">
              <GitBranch size={28} className="text-blue-500" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">No flows yet</h3>
            <p className="text-gray-500 text-sm mb-4">Load the demo data or create your first flow</p>
            <button onClick={handleSeed} disabled={seeding} className="px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
              {seeding ? 'Loading…' : 'Load demo flows'}
            </button>
          </div>
        )}

        {!loading && flows.length > 0 && (
          <AnimatePresence mode="popLayout">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {flows.map((flow) => (
                <FlowCard
                  key={flow.id}
                  flow={flow}
                  onRun={(f) => navigate(`/rules/run?flowId=${f.id}`)}
                  onBuild={(f) => navigate(`/rules/flows/${f.id}/builder`)}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </AnimatePresence>
        )}
      </div>

      {/* New flow modal */}
      <AnimatePresence>
        {showNew && (
          <NewFlowModal onClose={() => setShowNew(false)} onCreate={handleCreate} />
        )}
      </AnimatePresence>
    </div>
  );
}
