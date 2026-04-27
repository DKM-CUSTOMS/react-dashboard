import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactFlow, {
  Background, Controls, MiniMap,
  addEdge, useNodesState, useEdgesState,
  Handle, Position, ReactFlowProvider, useReactFlow,
  MarkerType, Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Play, Save, Plus, X, GitBranch, Sparkles,
  Database, Shuffle, Zap, Layers, Shield, CheckCircle2,
  AlertTriangle, Info, ChevronDown, GripVertical, Trash2,
  Settings2, ToggleLeft, ToggleRight, Search, Pencil,
} from 'lucide-react';
import { getFlows, getChecks, createCheck, updateCheck, deleteCheck, updateFlow } from '../../api/rulesFlowsApi';

// ─── Constants ────────────────────────────────────────────────────────────────

const STRATEGY_META = {
  condition:         { label: 'Condition',        desc: 'Field value logic rules',        icon: GitBranch,  accent: '#8b5cf6', light: '#f5f3ff', border: '#c4b5fd' },
  ai_prompt:         { label: 'AI Review',         desc: 'Ask GPT to validate',             icon: Sparkles,   accent: '#0891b2', light: '#ecfeff', border: '#a5f3fc' },
  db_lookup:         { label: 'DB Lookup',         desc: 'Check internal tables',           icon: Database,   accent: '#d97706', light: '#fffbeb', border: '#fcd34d' },
  cross_declaration: { label: 'Cross-Check',       desc: 'Detect duplicates',               icon: Shuffle,    accent: '#2563eb', light: '#eff6ff', border: '#93c5fd' },
  external_api:      { label: 'External API',      desc: 'TARIC or third-party',            icon: Zap,        accent: '#059669', light: '#ecfdf5', border: '#6ee7b7' },
  composite:         { label: 'Composite',         desc: 'Combine strategies',              icon: Layers,     accent: '#db2777', light: '#fdf2f8', border: '#f9a8d4' },
};

const DECLARATION_FIELDS = {
  header: [
    { path: 'declaration.DECLARATIONID',            label: 'Declaration ID' },
    { path: 'declaration.TYPEDECLARATIONSSW',        label: 'Declaration Type (SSW)' },
    { path: 'declaration.TEMPLATECODE',              label: 'Template Code' },
    { path: 'declaration.DELIVERYTERMSCODE',         label: 'Incoterm Code' },
    { path: 'declaration.DELIVERYTERMSCOUNTRY',      label: 'Incoterm Country' },
    { path: 'declaration.TOTALGROSSMASS',            label: 'Total Gross Mass' },
    { path: 'declaration.CONTROLNETMASS',            label: 'Net Mass' },
    { path: 'declaration.CONTROLPACKAGES',           label: 'Packages Count' },
    { path: 'declaration.TOTALINVOICEAMOUNT',        label: 'Invoice Amount' },
    { path: 'declaration.TOTALINVOICEAMOUNTCURRENCY',label: 'Invoice Currency' },
    { path: 'declaration.DESTINATIONCOUNTRY',        label: 'Destination Country' },
    { path: 'declaration.DISPATCHCOUNTRY',           label: 'Dispatch Country' },
    { path: 'declaration.DECLARATIONTYPE',           label: 'Declaration Type (IM/EX)' },
    { path: 'declaration.FISCALDIRECTTRANSIT',       label: 'Fiscal Direct Transit' },
    { path: 'declaration.FISCALREPRESENTATIVECODE',  label: 'Fiscal Representative' },
    { path: 'declaration.DECLARATIONTAXSTATUS',      label: 'Tax Status' },
    { path: 'declaration.MRN',                       label: 'MRN' },
    { path: 'declaration.LRN',                       label: 'LRN' },
    { path: 'declaration.PROCEDURETYPESSW',          label: 'Procedure Type (SSW)' },
    { path: 'declaration.FISCALSALESVALUE',          label: 'Fiscal Sales Value' },
  ],
  item: [
    { path: 'item.COMMODITYCODE',            label: 'HS Code (Commodity)' },
    { path: 'item.COMMODITYNATIONALADDITIONAL1', label: 'National Add. Code' },
    { path: 'item.PROCEDURECURRENT',         label: 'Procedure Current' },
    { path: 'item.PROCEDUREPREVIOUS',        label: 'Procedure Previous' },
    { path: 'item.ORIGINCOUNTRY',            label: 'Origin Country' },
    { path: 'item.PREFERENCE',               label: 'Preference Code' },
    { path: 'item.VALUATIONMETHOD',          label: 'Valuation Method' },
    { path: 'item.GROSSMASS',                label: 'Gross Mass' },
    { path: 'item.NETMASS',                  label: 'Net Mass' },
    { path: 'item.SUPPLEMENTARYUNITS',       label: 'Supplementary Units' },
    { path: 'item.UNITCODE',                 label: 'Unit Code' },
    { path: 'item.INVOICEAMOUNT',            label: 'Invoice Amount' },
    { path: 'item.INVOICEAMOUNTCURRENCY',    label: 'Invoice Currency' },
    { path: 'item.STATISTICALVALUE',         label: 'Statistical Value' },
    { path: 'item.GOODSDESCRIPTION',         label: 'Goods Description' },
    { path: 'item.PAYMENTMETHOD',            label: 'Payment Method' },
    { path: 'item.ADDITIONALPROCEDURECODE1', label: 'Add. Procedure 1' },
    { path: 'item.ADDITIONALPROCEDURECODE2', label: 'Add. Procedure 2' },
    { path: 'item.CUSTOMSVALUEAMOUNT',       label: 'Customs Value' },
  ],
  document: [
    { path: 'document.DOCUMENTTYPE',    label: 'Document Type' },
    { path: 'document.REFERENCE',       label: 'Reference' },
    { path: 'document.DATEOFVALIDITY',  label: 'Date of Validity' },
  ],
  fiscal: [
    { path: 'fiscal.ROLE',              label: 'Fiscal Role (FR1/FR2)' },
    { path: 'fiscal.VATIDENTIFICATION', label: 'VAT Identification' },
    { path: 'fiscal.RELATIONCODE',      label: 'Relation Code' },
  ],
};

const SCOPE_FROM_PATH = (path) => {
  if (path.startsWith('declaration.')) return 'header';
  if (path.startsWith('item.'))        return 'item';
  if (path.startsWith('document.'))   return 'document';
  if (path.startsWith('fiscal.'))     return 'fiscal';
  return 'header';
};

const ALL_FIELDS_FLAT = Object.entries(DECLARATION_FIELDS).flatMap(([scope, fields]) =>
  fields.map(f => ({ ...f, scope }))
);

const OPERATORS = [
  { value: 'equals',      label: 'equals' },
  { value: 'notEquals',   label: 'not equals' },
  { value: 'greaterThan', label: '> greater than' },
  { value: 'lessThan',    label: '< less than' },
  { value: 'contains',    label: 'contains' },
  { value: 'isEmpty',     label: 'is empty' },
  { value: 'isNotEmpty',  label: 'is not empty' },
  { value: 'isOneOf',     label: 'is one of (comma sep.)' },
  { value: 'isNotOneOf',  label: 'is not one of' },
];

const emptyCondition = () => ({ field: 'declaration.DELIVERYTERMSCODE', operator: 'equals', value: '', scope: 'header' });

const emptyConfig = (type) => ({
  condition:         { logic: 'AND', conditions: [emptyCondition()] },
  ai_prompt:         { question: '', fields_to_include: [] },
  db_lookup:         { lookup_table: '', match_field: 'item.COMMODITYCODE', lookup_key: 'hs_code', condition: 'exists' },
  cross_declaration: { check_type: 'duplicate_invoice', fields: [] },
  external_api:      { api: 'taric', endpoint: 'validate_hs_code', field: 'item.COMMODITYCODE' },
  composite:         { logic: 'AND', steps: [] },
}[type] ?? {});

const newCheckData = (type) => ({
  name: `New ${STRATEGY_META[type]?.label ?? 'Check'}`,
  description: '',
  severity: 'warning',
  strategy_type: type,
  config: emptyConfig(type),
  warning_message: '',
  is_active: true,
  _isNew: true,
});

// ─── Custom Nodes ─────────────────────────────────────────────────────────────

function TriggerNode({ data }) {
  return (
    <div className="bg-white border-2 border-gray-300 rounded-2xl px-5 py-3 min-w-[220px] shadow-md flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center">
        <Shield size={18} className="text-gray-500" />
      </div>
      <div>
        <div className="text-xs text-gray-400 font-medium uppercase tracking-wide">Trigger</div>
        <div className="text-sm font-bold text-gray-800">Declaration Loaded</div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: '#6366f1', width: 10, height: 10, border: '2px solid white' }} />
    </div>
  );
}

function EndNode({ data }) {
  return (
    <div className="bg-white border-2 border-green-200 rounded-2xl px-5 py-3 min-w-[220px] shadow-md flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl bg-green-50 flex items-center justify-center">
        <CheckCircle2 size={18} className="text-green-500" />
      </div>
      <div>
        <div className="text-xs text-green-400 font-medium uppercase tracking-wide">Output</div>
        <div className="text-sm font-bold text-gray-800">Results Ready</div>
      </div>
      <Handle type="target" position={Position.Top} style={{ background: '#22c55e', width: 10, height: 10, border: '2px solid white' }} />
    </div>
  );
}

function CheckNode({ data, selected }) {
  const meta = STRATEGY_META[data.strategy_type] ?? STRATEGY_META.condition;
  const Icon = meta.icon;
  const isWarning = data.severity === 'warning';

  return (
    <div
      className="bg-white rounded-2xl shadow-md min-w-[260px] max-w-[320px] overflow-hidden transition-all duration-150"
      style={{
        border: selected ? `2px solid ${meta.accent}` : '2px solid #e5e7eb',
        boxShadow: selected ? `0 0 0 4px ${meta.accent}22, 0 4px 20px rgba(0,0,0,0.1)` : '0 2px 8px rgba(0,0,0,0.08)',
        opacity: data.is_active ? 1 : 0.55,
      }}
    >
      {/* colour accent bar */}
      <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${meta.accent}, ${meta.border})` }} />

      <Handle type="target" position={Position.Top} style={{ background: meta.accent, width: 10, height: 10, border: '2px solid white', top: -5 }} />

      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: meta.light }}>
            <Icon size={16} style={{ color: meta.accent }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-sm font-bold text-gray-900 truncate">{data.name}</span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full" style={{ background: meta.light, color: meta.accent }}>
                {meta.label}
              </span>
              {isWarning
                ? <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">⚠ warning</span>
                : <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600 font-medium">ℹ info</span>
              }
              {!data.is_active && <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-400">off</span>}
            </div>
            {data.description && (
              <p className="text-xs text-gray-400 mt-1.5 leading-relaxed line-clamp-2">{data.description}</p>
            )}
          </div>
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} style={{ background: meta.accent, width: 10, height: 10, border: '2px solid white', bottom: -5 }} />
    </div>
  );
}

const nodeTypes = { triggerNode: TriggerNode, checkNode: CheckNode, endNode: EndNode };

// ─── Field Picker (visual dropdown) ──────────────────────────────────────────

function FieldPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const chosen = ALL_FIELDS_FLAT.find(f => f.path === value);
  const filtered = search
    ? ALL_FIELDS_FLAT.filter(f => f.label.toLowerCase().includes(search.toLowerCase()) || f.path.toLowerCase().includes(search.toLowerCase()))
    : ALL_FIELDS_FLAT;

  const grouped = Object.entries(DECLARATION_FIELDS).map(([scope, fields]) => ({
    scope,
    label: { header: 'Header', item: 'Item', document: 'Document', fiscal: 'Fiscal' }[scope],
    fields: fields.filter(f => filtered.includes(f) || !search),
  })).filter(g => g.fields.length > 0);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white hover:border-blue-400 transition-colors text-left"
      >
        <span className={chosen ? 'text-gray-800 font-medium' : 'text-gray-400'}>
          {chosen ? chosen.label : 'Select field…'}
        </span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {chosen && <span className="text-xs px-1.5 py-0.5 bg-gray-100 rounded text-gray-500 font-mono">{chosen.scope}</span>}
          <ChevronDown size={14} className="text-gray-400" />
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className="absolute z-50 top-full mt-1 left-0 right-0 bg-white rounded-xl border border-gray-200 shadow-2xl overflow-hidden"
            style={{ maxHeight: 280 }}
          >
            <div className="p-2 border-b border-gray-100 sticky top-0 bg-white">
              <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50">
                <Search size={12} className="text-gray-400" />
                <input
                  autoFocus
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search fields…"
                  className="flex-1 text-xs bg-transparent outline-none"
                />
              </div>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
              {grouped.map(({ scope, label, fields }) => (
                <div key={scope}>
                  <div className="px-3 py-1.5 text-xs font-bold text-gray-400 uppercase tracking-wider bg-gray-50 sticky top-0">{label}</div>
                  {fields.map(f => (
                    <button
                      key={f.path}
                      type="button"
                      onClick={() => { onChange(f.path, scope); setOpen(false); setSearch(''); }}
                      className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-blue-50 transition-colors text-left ${value === f.path ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-700'}`}
                    >
                      <span>{f.label}</span>
                      <span className="text-xs text-gray-300 font-mono truncate ml-2">{f.path.split('.')[1]}</span>
                    </button>
                  ))}
                </div>
              ))}
              {filtered.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-gray-400">No fields match</div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Config editors ───────────────────────────────────────────────────────────

function ConditionConfigEditor({ config, onChange }) {
  const conditions = config.conditions ?? [];

  const updateCond = (i, patch) => {
    const next = conditions.map((c, idx) => idx === i ? { ...c, ...patch } : c);
    onChange({ ...config, conditions: next });
  };

  const addCond = () => onChange({ ...config, conditions: [...conditions, emptyCondition()] });
  const removeCond = (i) => onChange({ ...config, conditions: conditions.filter((_, idx) => idx !== i) });

  return (
    <div className="space-y-3">
      {/* Logic toggle */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 font-medium">Match</span>
        {['AND', 'OR'].map(l => (
          <button key={l} type="button"
            onClick={() => onChange({ ...config, logic: l })}
            className={`px-3 py-1 rounded-full text-xs font-bold border transition-all ${config.logic === l ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-500 border-gray-200 hover:border-purple-300'}`}
          >{l}</button>
        ))}
        <span className="text-xs text-gray-400">of the conditions below</span>
      </div>

      {conditions.map((cond, i) => {
        const fieldMeta = ALL_FIELDS_FLAT.find(f => f.path === cond.field);
        const noValue = ['isEmpty', 'isNotEmpty'].includes(cond.operator);
        return (
          <div key={i} className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-gray-500">Condition {i + 1}</span>
              {conditions.length > 1 && (
                <button type="button" onClick={() => removeCond(i)} className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-400">
                  <X size={12} />
                </button>
              )}
            </div>
            {/* Field picker */}
            <FieldPicker
              value={cond.field}
              onChange={(path, scope) => updateCond(i, { field: path, scope })}
            />
            {/* Operator */}
            <select
              value={cond.operator}
              onChange={e => updateCond(i, { operator: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-400"
            >
              {OPERATORS.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
            </select>
            {/* Value */}
            {!noValue && (
              <input
                value={cond.value}
                onChange={e => updateCond(i, { value: e.target.value })}
                placeholder="Value to compare…"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-400"
              />
            )}
            {/* Item match */}
            {cond.scope === 'item' && (
              <div className="flex items-center gap-2 pt-1">
                <span className="text-xs text-gray-400">Fire if</span>
                {['any', 'all'].map(v => (
                  <button key={v} type="button"
                    onClick={() => updateCond(i, { itemMatch: v })}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${(cond.itemMatch ?? 'any') === v ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-500 border-gray-200'}`}
                  >{v} item matches</button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <button type="button" onClick={addCond}
        className="w-full py-2 rounded-xl border border-dashed border-purple-200 text-purple-600 text-xs hover:bg-purple-50 transition-colors flex items-center justify-center gap-1"
      >
        <Plus size={12} /> Add condition
      </button>
    </div>
  );
}

function AiPromptConfigEditor({ config, onChange }) {
  const [fieldSearch, setFieldSearch] = useState('');
  const selected = new Set(config.fields_to_include ?? []);

  const toggleField = (path) => {
    const next = new Set(selected);
    next.has(path) ? next.delete(path) : next.add(path);
    onChange({ ...config, fields_to_include: [...next] });
  };

  const filtered = fieldSearch
    ? ALL_FIELDS_FLAT.filter(f => f.label.toLowerCase().includes(fieldSearch.toLowerCase()))
    : ALL_FIELDS_FLAT;

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">What should the AI check? *</label>
        <textarea
          value={config.question ?? ''}
          onChange={e => onChange({ ...config, question: e.target.value })}
          placeholder="e.g. Do the goods descriptions match the declared HS codes for all items?"
          rows={3}
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-cyan-400"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">Fields to send to AI ({selected.size} selected)</label>
        <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 mb-2">
          <Search size={12} className="text-gray-400" />
          <input value={fieldSearch} onChange={e => setFieldSearch(e.target.value)} placeholder="Search fields…" className="flex-1 text-xs bg-transparent outline-none" />
        </div>
        <div className="rounded-xl border border-gray-100 overflow-y-auto" style={{ maxHeight: 200 }}>
          {Object.entries(DECLARATION_FIELDS).map(([scope, fields]) => {
            const scopeFiltered = fields.filter(f => filtered.includes(f));
            if (!scopeFiltered.length) return null;
            return (
              <div key={scope}>
                <div className="px-3 py-1.5 text-xs font-bold text-gray-400 uppercase tracking-wider bg-gray-50 sticky top-0">
                  {{ header: 'Header', item: 'Item', document: 'Document', fiscal: 'Fiscal' }[scope]}
                </div>
                {scopeFiltered.map(f => (
                  <label key={f.path} className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-cyan-50 transition-colors ${selected.has(f.path) ? 'bg-cyan-50' : ''}`}>
                    <input type="checkbox" checked={selected.has(f.path)} onChange={() => toggleField(f.path)} className="w-3.5 h-3.5 accent-cyan-500" />
                    <span className={`text-sm ${selected.has(f.path) ? 'text-cyan-700 font-medium' : 'text-gray-700'}`}>{f.label}</span>
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ExternalApiConfigEditor({ config, onChange }) {
  const fieldMeta = ALL_FIELDS_FLAT.find(f => f.path === config.field);
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">API Source</label>
        <select value={config.api ?? 'taric'} onChange={e => onChange({ ...config, api: e.target.value })}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400">
          <option value="taric">TARIC (EU Tariff Database)</option>
          <option value="custom">Custom API</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">Field to validate</label>
        <FieldPicker value={config.field} onChange={(path) => onChange({ ...config, field: path })} />
      </div>
    </div>
  );
}

function DbLookupConfigEditor({ config, onChange }) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">Lookup Table</label>
        <input value={config.lookup_table ?? ''} onChange={e => onChange({ ...config, lookup_table: e.target.value })}
          placeholder="e.g. quota_alerts"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">Match on field</label>
        <FieldPicker value={config.match_field} onChange={(path) => onChange({ ...config, match_field: path })} />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">Condition</label>
        <select value={config.condition ?? 'exists'} onChange={e => onChange({ ...config, condition: e.target.value })}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400">
          <option value="exists">Record exists → fire warning</option>
          <option value="not_exists">Record missing → fire warning</option>
        </select>
      </div>
    </div>
  );
}

function ConfigEditor({ type, config, onChange }) {
  switch (type) {
    case 'condition':         return <ConditionConfigEditor config={config} onChange={onChange} />;
    case 'ai_prompt':         return <AiPromptConfigEditor config={config} onChange={onChange} />;
    case 'external_api':      return <ExternalApiConfigEditor config={config} onChange={onChange} />;
    case 'db_lookup':         return <DbLookupConfigEditor config={config} onChange={onChange} />;
    default:
      return (
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Config (JSON)</label>
          <textarea value={JSON.stringify(config, null, 2)} onChange={e => { try { onChange(JSON.parse(e.target.value)); } catch {} }}
            rows={6} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
      );
  }
}

// ─── Properties Panel ─────────────────────────────────────────────────────────

function PropertiesPanel({ node, onUpdate, onDelete, onClose }) {
  const [form, setForm] = useState(node.data);
  const [saving, setSaving] = useState(false);
  const meta = STRATEGY_META[form.strategy_type] ?? STRATEGY_META.condition;
  const Icon = meta.icon;

  useEffect(() => { setForm(node.data); }, [node.id]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try { await onUpdate(node.id, form); } finally { setSaving(false); }
  };

  return (
    <motion.div
      key={node.id}
      initial={{ x: 320, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 320, opacity: 0 }}
      transition={{ type: 'spring', damping: 28, stiffness: 320 }}
      className="w-80 bg-white border-l border-gray-200 flex flex-col shadow-2xl h-full overflow-hidden"
    >
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-gray-100" style={{ background: meta.light }}>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'white' }}>
              <Icon size={16} style={{ color: meta.accent }} />
            </div>
            <div>
              <div className="text-xs text-gray-400 font-medium">{meta.label}</div>
              <div className="text-sm font-bold text-gray-900 truncate max-w-[160px]">{form.name}</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/60 transition-colors">
            <X size={15} className="text-gray-400" />
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Name */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Name</label>
          <input value={form.name} onChange={e => set('name', e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Description</label>
          <textarea value={form.description} onChange={e => set('description', e.target.value)}
            placeholder="What does this check verify?" rows={2}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        {/* Config */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Configuration</label>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <ConfigEditor type={form.strategy_type} config={form.config} onChange={cfg => set('config', cfg)} />
          </div>
        </div>

        {/* Severity */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Severity</label>
          <div className="grid grid-cols-2 gap-2">
            {[['warning', '⚠ Warning', 'bg-amber-500'], ['info', 'ℹ Info', 'bg-blue-500']].map(([v, l, c]) => (
              <button key={v} type="button" onClick={() => set('severity', v)}
                className={`py-2 rounded-xl text-sm font-semibold border-2 transition-all ${form.severity === v ? `${c} text-white border-transparent` : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'}`}
              >{l}</button>
            ))}
          </div>
        </div>

        {/* Warning message */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Message shown when check fires</label>
          <textarea value={form.warning_message} onChange={e => set('warning_message', e.target.value)}
            placeholder="e.g. EXW detected — verify transport costs…" rows={2}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        {/* Active */}
        <div className="flex items-center justify-between py-2.5 px-3 bg-gray-50 rounded-xl">
          <div>
            <div className="text-sm font-semibold text-gray-700">Active</div>
            <div className="text-xs text-gray-400">Include this check in runs</div>
          </div>
          <button type="button" onClick={() => set('is_active', !form.is_active)}
            className={`w-12 h-6 rounded-full transition-all ${form.is_active ? 'bg-green-500' : 'bg-gray-200'}`}
          >
            <div className={`w-5 h-5 rounded-full bg-white shadow-sm mx-0.5 transition-transform ${form.is_active ? 'translate-x-6' : 'translate-x-0'}`} />
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 p-4 border-t border-gray-100 space-y-2">
        <button onClick={handleSave} disabled={saving || !form.name.trim()}
          className="w-full py-2.5 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
          style={{ background: meta.accent }}
        >
          <Save size={15} />
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
        <button onClick={() => onDelete(node.id)}
          className="w-full py-2 rounded-xl border border-red-200 text-red-500 hover:bg-red-50 text-sm font-medium flex items-center justify-center gap-2 transition-colors"
        >
          <Trash2 size={14} /> Delete Check
        </button>
      </div>
    </motion.div>
  );
}

// ─── Node Palette ─────────────────────────────────────────────────────────────

function NodePalette() {
  const onDragStart = (e, type) => {
    e.dataTransfer.setData('application/reactflow-type', type);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="w-56 bg-white border-r border-gray-200 flex flex-col h-full overflow-y-auto">
      <div className="p-3 border-b border-gray-100">
        <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">Check Types</div>
        <div className="text-xs text-gray-400 mt-0.5">Drag onto canvas</div>
      </div>
      <div className="p-2 space-y-1.5 flex-1">
        {Object.entries(STRATEGY_META).map(([type, meta]) => {
          const Icon = meta.icon;
          return (
            <div
              key={type}
              draggable
              onDragStart={e => onDragStart(e, type)}
              className="flex items-center gap-2.5 p-2.5 rounded-xl border border-gray-100 cursor-grab active:cursor-grabbing hover:border-gray-300 hover:shadow-sm transition-all select-none group"
              style={{ background: meta.light }}
            >
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'white', border: `1.5px solid ${meta.border}` }}>
                <Icon size={15} style={{ color: meta.accent }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-gray-800">{meta.label}</div>
                <div className="text-xs text-gray-400 truncate">{meta.desc}</div>
              </div>
              <GripVertical size={12} className="text-gray-300 group-hover:text-gray-400" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Inner builder (needs ReactFlowProvider context) ──────────────────────────

const SAVED_POSITIONS_KEY = (flowId) => `rf_positions_${flowId}`;

function checksToGraph(checks, flowId) {
  const saved = JSON.parse(localStorage.getItem(SAVED_POSITIONS_KEY(flowId)) ?? '{}');
  const sorted = [...checks].sort((a, b) => a.order_index - b.order_index);

  const nodes = [
    { id: '__trigger', type: 'triggerNode', position: saved['__trigger'] ?? { x: 200, y: 0 }, data: {}, deletable: false, selectable: false },
    ...sorted.map((c, i) => ({
      id: c.id,
      type: 'checkNode',
      position: saved[c.id] ?? { x: 200, y: (i + 1) * 160 },
      data: { ...c, label: c.name },
    })),
    { id: '__end', type: 'endNode', position: saved['__end'] ?? { x: 200, y: (sorted.length + 1) * 160 }, data: {}, deletable: false, selectable: false },
  ];

  const checkIds = ['__trigger', ...sorted.map(c => c.id), '__end'];
  const edges = checkIds.slice(0, -1).map((id, i) => ({
    id: `e-${id}-${checkIds[i + 1]}`,
    source: id,
    target: checkIds[i + 1],
    type: 'smoothstep',
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: '#6366f1', strokeWidth: 2 },
  }));

  return { nodes, edges };
}

function FlowBuilderInner() {
  const { flowId } = useParams();
  const navigate = useNavigate();
  const rfInstance = useReactFlow();

  const [flow, setFlow]         = useState(null);
  const [dbChecks, setDbChecks] = useState([]);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [editName, setEditName] = useState(false);
  const [flowName, setFlowName] = useState('');
  const reactFlowWrapper        = useRef(null);

  // Load data
  useEffect(() => {
    const load = async () => {
      const [allFlows, checks] = await Promise.all([fetch('/api/rules/flows').then(r => r.json()), getChecks(flowId)]);
      const f = allFlows.find(fl => fl.id === flowId) ?? null;
      setFlow(f);
      setFlowName(f?.name ?? '');
      setDbChecks(checks);
      const { nodes: n, edges: e } = checksToGraph(checks, flowId);
      setNodes(n);
      setEdges(e);
      setLoading(false);
    };
    load().catch(console.error);
  }, [flowId]);

  // Save node positions to localStorage on move
  const onNodeDragStop = useCallback((_, node) => {
    const saved = JSON.parse(localStorage.getItem(SAVED_POSITIONS_KEY(flowId)) ?? '{}');
    saved[node.id] = node.position;
    localStorage.setItem(SAVED_POSITIONS_KEY(flowId), JSON.stringify(saved));
  }, [flowId]);

  // Connect nodes
  const onConnect = useCallback((params) => {
    setEdges(eds => addEdge({ ...params, type: 'smoothstep', animated: true, markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: '#6366f1', strokeWidth: 2 } }, eds));
  }, []);

  // Drop from palette
  const onDragOver = useCallback((e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }, []);
  const onDrop = useCallback((e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/reactflow-type');
    if (!type) return;
    const bounds = reactFlowWrapper.current.getBoundingClientRect();
    const position = rfInstance.screenToFlowPosition({ x: e.clientX - bounds.left, y: e.clientY - bounds.top });
    const tempId = `new_${Date.now()}`;
    const newNode = {
      id: tempId,
      type: 'checkNode',
      position,
      data: { ...newCheckData(type), id: tempId, _isNew: true, label: `New ${STRATEGY_META[type].label}` },
    };
    setNodes(nds => [...nds, newNode]);
    setSelectedNode(newNode);
  }, [rfInstance]);

  // Click node to select
  const onNodeClick = useCallback((_, node) => {
    if (node.type !== 'checkNode') return;
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => setSelectedNode(null), []);

  // Update node data from panel
  const handleUpdateNode = async (nodeId, formData) => {
    const isNew = nodeId.startsWith('new_');
    let savedCheck;
    if (isNew) {
      const { _isNew, id: _, label, ...payload } = formData;
      savedCheck = await createCheck(flowId, payload);
      setDbChecks(prev => [...prev, savedCheck]);
    } else {
      const { label, _isNew, ...payload } = formData;
      savedCheck = await updateCheck(nodeId, payload);
      setDbChecks(prev => prev.map(c => c.id === nodeId ? savedCheck : c));
    }
    setNodes(nds => nds.map(n => {
      if (n.id !== nodeId) return n;
      return { ...n, id: savedCheck.id, data: { ...savedCheck, label: savedCheck.name } };
    }));
    setSelectedNode(prev => prev ? { ...prev, id: savedCheck.id, data: { ...savedCheck, label: savedCheck.name } } : null);
  };

  // Delete from panel
  const handleDeleteNode = async (nodeId) => {
    if (!confirm('Delete this check?')) return;
    if (!nodeId.startsWith('new_')) {
      await deleteCheck(nodeId);
      setDbChecks(prev => prev.filter(c => c.id !== nodeId));
    }
    setNodes(nds => nds.filter(n => n.id !== nodeId));
    setEdges(eds => eds.filter(e => e.source !== nodeId && e.target !== nodeId));
    setSelectedNode(null);
  };

  // Save flow name
  const saveFlowName = async () => {
    if (flowName.trim() && flowName !== flow?.name) {
      await updateFlow(flowId, { name: flowName.trim() });
      setFlow(f => ({ ...f, name: flowName.trim() }));
    }
    setEditName(false);
  };

  // Recenter
  const fitView = () => rfInstance.fitView({ padding: 0.2, duration: 400 });

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-sm">Loading flow builder…</div>
      </div>
    );
  }

  const activeChecks = dbChecks.filter(c => c.is_active).length;

  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
      {/* Top bar */}
      <div className="h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-3 flex-shrink-0 z-20">
        <button onClick={() => navigate('/rules/flows')} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
          <ArrowLeft size={18} />
        </button>

        <div className="w-px h-5 bg-gray-200" />

        {/* Flow name */}
        {editName ? (
          <div className="flex items-center gap-2">
            <input autoFocus value={flowName} onChange={e => setFlowName(e.target.value)}
              onBlur={saveFlowName} onKeyDown={e => e.key === 'Enter' && saveFlowName()}
              className="font-bold text-base border-b-2 border-blue-500 focus:outline-none bg-transparent min-w-[180px]" />
          </div>
        ) : (
          <button onClick={() => setEditName(true)} className="flex items-center gap-2 group">
            <span className="font-bold text-base text-gray-900 group-hover:text-blue-600 transition-colors">{flow?.name}</span>
            <Pencil size={12} className="text-gray-300 group-hover:text-blue-400" />
          </button>
        )}

        <span className="text-xs text-gray-400 ml-1">{activeChecks}/{dbChecks.length} checks active</span>

        <div className="ml-auto flex items-center gap-2">
          <button onClick={fitView} className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-sm text-gray-600 transition-colors">
            Fit View
          </button>
          <button
            onClick={() => navigate(`/rules/run?flowId=${flowId}`)}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors shadow-sm"
          >
            <Play size={13} fill="currentColor" /> Test Run
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        <NodePalette />

        {/* Canvas */}
        <div className="flex-1 relative" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeDragStop={onNodeDragStop}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            deleteKeyCode="Delete"
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#e5e7eb" gap={20} size={1} />
            <Controls showInteractive={false} className="!bg-white !border-gray-200 !shadow-md !rounded-xl" />
            <MiniMap
              nodeColor={(n) => {
                if (n.type === 'triggerNode') return '#6366f1';
                if (n.type === 'endNode') return '#22c55e';
                const meta = STRATEGY_META[n.data?.strategy_type];
                return meta?.accent ?? '#6366f1';
              }}
              className="!bg-white !border-gray-200 !rounded-xl !shadow-md"
              maskColor="rgba(243,244,246,0.6)"
            />
            <Panel position="top-right" className="text-xs text-gray-400 bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm">
              Drag from palette · Click to edit · Del to remove
            </Panel>
          </ReactFlow>
        </div>

        {/* Properties panel */}
        <AnimatePresence>
          {selectedNode && selectedNode.type === 'checkNode' && (
            <PropertiesPanel
              node={selectedNode}
              onUpdate={handleUpdateNode}
              onDelete={handleDeleteNode}
              onClose={() => setSelectedNode(null)}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default function FlowBuilderPage() {
  return (
    <ReactFlowProvider>
      <FlowBuilderInner />
    </ReactFlowProvider>
  );
}
