import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import {
  ArrowLeft, Plus, GripVertical, Pencil, Trash2, ChevronDown,
  GitBranch, Sparkles, Database, Shuffle, Zap, Layers,
  Save, Shield, Play, CheckCircle2, AlertTriangle, Info,
  X, ChevronRight
} from 'lucide-react';
import { getFlowById, getChecks, createCheck, updateCheck, deleteCheck, updateFlow } from '../../api/rulesFlowsApi';

// ─── Strategy metadata ─────────────────────────────────────────────────────

const STRATEGY_META = {
  condition:         { label: 'Condition Logic',  desc: 'Evaluate field values against rules', color: 'purple', bg: 'bg-purple-50',  border: 'border-purple-200', badge: 'bg-purple-100 text-purple-700', icon: GitBranch },
  ai_prompt:         { label: 'AI Prompt',         desc: 'Ask Claude/GPT to review declaration', color: 'cyan',   bg: 'bg-cyan-50',    border: 'border-cyan-200',   badge: 'bg-cyan-100 text-cyan-700',   icon: Sparkles },
  db_lookup:         { label: 'Database Lookup',   desc: 'Cross-check against internal tables',  color: 'amber',  bg: 'bg-amber-50',   border: 'border-amber-200',  badge: 'bg-amber-100 text-amber-700', icon: Database },
  cross_declaration: { label: 'Cross Declaration', desc: 'Check for duplicates or conflicts',    color: 'blue',   bg: 'bg-blue-50',    border: 'border-blue-200',   badge: 'bg-blue-100 text-blue-700',   icon: Shuffle },
  external_api:      { label: 'External API',      desc: 'Validate against TARIC or other APIs', color: 'emerald',bg: 'bg-emerald-50', border: 'border-emerald-200',badge: 'bg-emerald-100 text-emerald-700', icon: Zap },
  composite:         { label: 'Composite',         desc: 'Combine multiple strategies',          color: 'pink',   bg: 'bg-pink-50',    border: 'border-pink-200',   badge: 'bg-pink-100 text-pink-700',   icon: Layers },
};

const OPERATORS = ['equals', 'notEquals', 'greaterThan', 'lessThan', 'contains', 'isEmpty', 'isNotEmpty', 'isOneOf', 'isNotOneOf'];
const SCOPES = ['header', 'item', 'document', 'fiscal'];

// ─── Empty configs per strategy ────────────────────────────────────────────

const emptyConfig = (type) => {
  switch (type) {
    case 'condition':
      return { logic: 'AND', conditions: [{ field: 'declaration.', operator: 'equals', value: '', scope: 'header' }] };
    case 'ai_prompt':
      return { prompt_template: '', question: '', fields_to_include: [] };
    case 'db_lookup':
      return { lookup_table: '', match_field: 'item.COMMODITYCODE', lookup_key: 'hs_code', condition: 'exists' };
    case 'cross_declaration':
      return { check_type: 'duplicate_invoice', fields: [] };
    case 'external_api':
      return { api: 'taric', endpoint: 'validate_hs_code', field: 'item.COMMODITYCODE' };
    case 'composite':
      return { logic: 'AND', steps: [] };
    default:
      return {};
  }
};

const emptyCheck = () => ({
  name: '',
  description: '',
  severity: 'warning',
  strategy_type: 'condition',
  config: emptyConfig('condition'),
  warning_message: '',
  is_active: true,
});

// ─── Config editors per strategy ───────────────────────────────────────────

function ConditionEditor({ config, onChange }) {
  const conditions = config.conditions ?? [];

  const updateCond = (i, field, val) => {
    const next = conditions.map((c, idx) => idx === i ? { ...c, [field]: val } : c);
    onChange({ ...config, conditions: next });
  };

  const addCond = () => onChange({ ...config, conditions: [...conditions, { field: 'declaration.', operator: 'equals', value: '', scope: 'header' }] });
  const removeCond = (i) => onChange({ ...config, conditions: conditions.filter((_, idx) => idx !== i) });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-600">Logic:</span>
        {['AND', 'OR'].map((l) => (
          <button
            key={l}
            onClick={() => onChange({ ...config, logic: l })}
            className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${config.logic === l ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
          >
            {l}
          </button>
        ))}
      </div>

      {conditions.map((cond, i) => (
        <div key={i} className="bg-gray-50 rounded-lg p-3 space-y-2 border border-gray-100">
          <div className="flex gap-2">
            <select value={cond.scope} onChange={(e) => updateCond(i, 'scope', e.target.value)} className="text-xs border border-gray-200 rounded px-2 py-1 bg-white">
              {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {cond.scope === 'item' && (
              <select value={cond.itemMatch ?? 'any'} onChange={(e) => updateCond(i, 'itemMatch', e.target.value)} className="text-xs border border-gray-200 rounded px-2 py-1 bg-white">
                <option value="any">any item</option>
                <option value="all">all items</option>
              </select>
            )}
            <button onClick={() => removeCond(i)} className="ml-auto p-1 text-red-400 hover:text-red-600">
              <X size={12} />
            </button>
          </div>
          <input
            value={cond.field}
            onChange={(e) => updateCond(i, 'field', e.target.value)}
            placeholder="e.g. declaration.DELIVERYTERMSCODE"
            className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 font-mono bg-white"
          />
          <div className="flex gap-2">
            <select value={cond.operator} onChange={(e) => updateCond(i, 'operator', e.target.value)} className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 bg-white">
              {OPERATORS.map((op) => <option key={op} value={op}>{op}</option>)}
            </select>
            {!['isEmpty', 'isNotEmpty'].includes(cond.operator) && (
              <input
                value={cond.value}
                onChange={(e) => updateCond(i, 'value', e.target.value)}
                placeholder="value"
                className="flex-1 text-xs border border-gray-200 rounded px-2 py-1.5 bg-white"
              />
            )}
          </div>
        </div>
      ))}

      <button onClick={addCond} className="w-full py-1.5 rounded-lg border border-dashed border-purple-200 text-purple-600 text-xs hover:bg-purple-50 transition-colors flex items-center justify-center gap-1">
        <Plus size={12} /> Add condition
      </button>
    </div>
  );
}

function AiPromptEditor({ config, onChange }) {
  const fields = config.fields_to_include ?? [];
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Question for AI *</label>
        <textarea
          value={config.question ?? ''}
          onChange={(e) => onChange({ ...config, question: e.target.value })}
          placeholder="e.g. Do the goods descriptions match the declared HS codes?"
          rows={3}
          className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-cyan-400"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Fields to include (one per line)</label>
        <textarea
          value={fields.join('\n')}
          onChange={(e) => onChange({ ...config, fields_to_include: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })}
          placeholder="items.item.COMMODITYCODE&#10;items.item.GOODSDESCRIPTION"
          rows={3}
          className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 font-mono resize-none focus:outline-none focus:ring-1 focus:ring-cyan-400"
        />
      </div>
    </div>
  );
}

function GenericConfigEditor({ config, onChange }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">Config (JSON)</label>
      <textarea
        value={JSON.stringify(config, null, 2)}
        onChange={(e) => { try { onChange(JSON.parse(e.target.value)); } catch {} }}
        rows={8}
        className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 font-mono resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
    </div>
  );
}

function ConfigEditor({ strategyType, config, onChange }) {
  switch (strategyType) {
    case 'condition':  return <ConditionEditor config={config} onChange={onChange} />;
    case 'ai_prompt':  return <AiPromptEditor config={config} onChange={onChange} />;
    default:           return <GenericConfigEditor config={config} onChange={onChange} />;
  }
}

// ─── Check side panel ──────────────────────────────────────────────────────

function CheckPanel({ check, onSave, onClose, isNew }) {
  const [form, setForm] = useState(check);
  const [saving, setSaving] = useState(false);

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const handleStrategyChange = (type) => {
    setForm((f) => ({ ...f, strategy_type: type, config: emptyConfig(type) }));
  };

  const submit = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  const meta = STRATEGY_META[form.strategy_type] ?? STRATEGY_META.condition;
  const Icon = meta.icon;

  return (
    <motion.div
      initial={{ x: 380 }}
      animate={{ x: 0 }}
      exit={{ x: 380 }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      className="fixed right-0 top-0 h-full w-[380px] bg-white border-l border-gray-200 shadow-2xl z-40 overflow-y-auto"
    >
      {/* Header */}
      <div className={`sticky top-0 z-10 ${meta.bg} border-b ${meta.border} p-4`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg ${meta.badge.split(' ')[0]} flex items-center justify-center`}>
              <Icon size={16} className={meta.badge.split(' ')[1]} />
            </div>
            <div>
              <div className="text-xs font-medium text-gray-500">{isNew ? 'New Check' : 'Edit Check'}</div>
              <div className="text-sm font-bold text-gray-900">{meta.label}</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/60">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Check name *</label>
          <input
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. EXW Transport Cost Alert"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
          <input
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Brief explanation of what this checks"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Strategy type */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-2">Strategy type</label>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(STRATEGY_META).map(([type, m]) => {
              const SIcon = m.icon;
              return (
                <button
                  key={type}
                  onClick={() => handleStrategyChange(type)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all ${form.strategy_type === type ? `${m.bg} ${m.border} border-2` : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'}`}
                >
                  <SIcon size={14} className={form.strategy_type === type ? m.badge.split(' ')[1] : 'text-gray-400'} />
                  <span className={`text-xs font-medium ${form.strategy_type === type ? m.badge.split(' ')[1] : 'text-gray-600'}`}>{m.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Config */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-2">Configuration</label>
          <ConfigEditor
            strategyType={form.strategy_type}
            config={form.config}
            onChange={(cfg) => set('config', cfg)}
          />
        </div>

        {/* Severity */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Severity</label>
          <div className="flex gap-2">
            {[['warning', 'Warning', 'bg-amber-100 text-amber-700'], ['info', 'Info', 'bg-blue-100 text-blue-700']].map(([val, label, cls]) => (
              <button
                key={val}
                onClick={() => set('severity', val)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${form.severity === val ? cls : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Warning message */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Warning message (shown when check fires)</label>
          <textarea
            value={form.warning_message}
            onChange={(e) => set('warning_message', e.target.value)}
            placeholder="e.g. EXW detected — verify transport costs are included"
            rows={2}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Active toggle */}
        <div className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
          <span className="text-sm text-gray-600">Active</span>
          <button
            onClick={() => set('is_active', !form.is_active)}
            className={`w-10 h-5 rounded-full transition-colors ${form.is_active ? 'bg-green-500' : 'bg-gray-300'}`}
          >
            <div className={`w-4 h-4 rounded-full bg-white shadow mx-0.5 transition-transform ${form.is_active ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>

        {/* Save */}
        <button
          onClick={submit}
          disabled={!form.name.trim() || saving}
          className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
        >
          <Save size={15} />
          {saving ? 'Saving…' : isNew ? 'Add Check' : 'Save Changes'}
        </button>
      </div>
    </motion.div>
  );
}

// ─── Check node in pipeline ────────────────────────────────────────────────

function CheckNode({ check, index, onEdit, onDelete, onToggle }) {
  const meta = STRATEGY_META[check.strategy_type] ?? STRATEGY_META.condition;
  const Icon = meta.icon;

  return (
    <div className="relative group">
      {/* Connector line */}
      {index > 0 && (
        <div className="flex justify-center -mt-1 mb-0">
          <div className="w-px h-5 bg-gray-200" />
        </div>
      )}

      <motion.div
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className={`border-l-4 ${meta.border.replace('border-', 'border-l-')} bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden transition-all duration-150 ${!check.is_active ? 'opacity-50' : ''}`}
      >
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Drag handle */}
          <GripVertical size={14} className="text-gray-300 cursor-grab active:cursor-grabbing flex-shrink-0" />

          {/* Icon */}
          <div className={`w-8 h-8 rounded-lg ${meta.bg} flex items-center justify-center flex-shrink-0`}>
            <Icon size={15} className={meta.badge.split(' ')[1]} />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-sm font-semibold text-gray-900 truncate">{check.name}</span>
              <span className={`flex-shrink-0 text-xs px-1.5 py-0.5 rounded-full font-medium ${meta.badge}`}>{meta.label}</span>
              {check.severity === 'warning' ? (
                <AlertTriangle size={11} className="flex-shrink-0 text-amber-500" />
              ) : (
                <Info size={11} className="flex-shrink-0 text-blue-400" />
              )}
            </div>
            {check.description && (
              <p className="text-xs text-gray-400 truncate">{check.description}</p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => onToggle(check)} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600" title={check.is_active ? 'Disable' : 'Enable'}>
              {check.is_active ? <CheckCircle2 size={13} className="text-green-500" /> : <CheckCircle2 size={13} />}
            </button>
            <button onClick={() => onEdit(check)} className="p-1.5 rounded hover:bg-blue-50 text-gray-400 hover:text-blue-600">
              <Pencil size={13} />
            </button>
            <button onClick={() => onDelete(check)} className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500">
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────

export default function FlowBuilderPage() {
  const { flowId } = useParams();
  const navigate = useNavigate();

  const [flow, setFlow] = useState(null);
  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingCheck, setEditingCheck] = useState(null);
  const [isNewCheck, setIsNewCheck] = useState(false);
  const [editingFlow, setEditingFlow] = useState(false);
  const [flowForm, setFlowForm] = useState({ name: '', description: '', is_active: true });
  const [savingFlow, setSavingFlow] = useState(false);

  useEffect(() => {
    const load = async () => {
      const [f, c] = await Promise.all([getFlowById ? null : null, getChecks(flowId)]);
      // getFlowById not exported individually, use listFlows
      const flowData = await fetch(`/api/rules/flows`).then(r => r.json()).then(list => list.find(fl => fl.id === flowId));
      setFlow(flowData);
      setFlowForm({ name: flowData?.name ?? '', description: flowData?.description ?? '', is_active: flowData?.is_active !== false });
      setChecks(c);
      setLoading(false);
    };
    load().catch(console.error);
  }, [flowId]);

  const handleAddCheck = () => {
    setEditingCheck(emptyCheck());
    setIsNewCheck(true);
  };

  const handleEditCheck = (check) => {
    setEditingCheck({ ...check });
    setIsNewCheck(false);
  };

  const handleSaveCheck = async (form) => {
    if (isNewCheck) {
      const created = await createCheck(flowId, form);
      setChecks((prev) => [...prev, created].sort((a, b) => a.order_index - b.order_index));
    } else {
      const updated = await updateCheck(editingCheck.id, form);
      setChecks((prev) => prev.map((c) => c.id === editingCheck.id ? updated : c));
    }
    setEditingCheck(null);
  };

  const handleDeleteCheck = async (check) => {
    if (!confirm(`Delete check "${check.name}"?`)) return;
    await deleteCheck(check.id);
    setChecks((prev) => prev.filter((c) => c.id !== check.id));
  };

  const handleToggleCheck = async (check) => {
    const updated = await updateCheck(check.id, { is_active: !check.is_active });
    setChecks((prev) => prev.map((c) => c.id === check.id ? updated : c));
  };

  const handleSaveFlow = async () => {
    setSavingFlow(true);
    try {
      const updated = await updateFlow(flowId, flowForm);
      setFlow(updated);
      setEditingFlow(false);
    } finally {
      setSavingFlow(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading flow…</div>
      </div>
    );
  }

  if (!flow) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-red-500 text-sm">Flow not found</div>
      </div>
    );
  }

  const activeCount = checks.filter((c) => c.is_active).length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center gap-4">
          <button onClick={() => navigate('/rules/flows')} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1">
            {editingFlow ? (
              <div className="flex items-center gap-2">
                <input
                  value={flowForm.name}
                  onChange={(e) => setFlowForm((f) => ({ ...f, name: e.target.value }))}
                  className="font-bold text-lg border-b border-blue-400 focus:outline-none bg-transparent"
                />
                <button onClick={handleSaveFlow} disabled={savingFlow} className="px-3 py-1 rounded-lg bg-blue-600 text-white text-xs font-medium">
                  {savingFlow ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => setEditingFlow(false)} className="px-3 py-1 rounded-lg border text-xs">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setEditingFlow(true)} className="flex items-center gap-2 group">
                <h1 className="font-bold text-lg text-gray-900 group-hover:text-blue-600">{flow.name}</h1>
                <Pencil size={12} className="text-gray-300 group-hover:text-blue-400" />
              </button>
            )}
            <p className="text-xs text-gray-400">{activeCount}/{checks.length} checks active</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate(`/rules/run?flowId=${flowId}`)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors"
            >
              <Play size={13} fill="currentColor" />
              Test Run
            </button>
            <button
              onClick={handleAddCheck}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
            >
              <Plus size={15} />
              Add Step
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-6 py-10">
        {/* Trigger node */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 flex items-center gap-3 mb-2">
          <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
            <Shield size={15} className="text-gray-500" />
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-900">Declaration Loaded</div>
            <div className="text-xs text-gray-400">Trigger — enter declaration ID to start</div>
          </div>
          <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${flow.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            {flow.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>

        {/* Checks */}
        {checks.length === 0 ? (
          <div className="text-center py-12">
            <div className="flex justify-center mb-1"><div className="w-px h-6 bg-gray-200" /></div>
            <div className="border-2 border-dashed border-gray-200 rounded-xl p-8">
              <p className="text-gray-400 text-sm mb-3">No checks yet — add your first step</p>
              <button
                onClick={handleAddCheck}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-50 text-blue-600 text-sm font-medium hover:bg-blue-100 mx-auto"
              >
                <Plus size={15} />
                Add Step
              </button>
            </div>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {checks.map((check, i) => (
              <CheckNode
                key={check.id}
                check={check}
                index={i}
                onEdit={handleEditCheck}
                onDelete={handleDeleteCheck}
                onToggle={handleToggleCheck}
              />
            ))}
          </AnimatePresence>
        )}

        {checks.length > 0 && (
          <>
            <div className="flex justify-center my-0">
              <div className="w-px h-5 bg-gray-200" />
            </div>
            <button
              onClick={handleAddCheck}
              className="w-full py-3 rounded-xl border-2 border-dashed border-gray-200 text-gray-400 hover:border-blue-300 hover:text-blue-500 hover:bg-blue-50 transition-all text-sm flex items-center justify-center gap-2"
            >
              <Plus size={15} />
              Add another step
            </button>
          </>
        )}

        {/* End node */}
        {checks.length > 0 && (
          <>
            <div className="flex justify-center my-0">
              <div className="w-px h-5 bg-gray-200" />
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex items-center justify-center gap-2 text-gray-400 text-sm">
              <CheckCircle2 size={15} />
              End — results returned
            </div>
          </>
        )}
      </div>

      {/* Side panel */}
      <AnimatePresence>
        {editingCheck && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/20 z-30"
              onClick={() => setEditingCheck(null)}
            />
            <CheckPanel
              check={editingCheck}
              isNew={isNewCheck}
              onSave={handleSaveCheck}
              onClose={() => setEditingCheck(null)}
            />
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
