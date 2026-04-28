import { useState, useEffect, useCallback, useRef } from 'react';
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
  ArrowLeft, Play, Plus, X, GitBranch, Sparkles,
  Database, Shuffle, Zap, Layers, Shield, CheckCircle2,
  AlertTriangle, Info, ChevronDown, Trash2, Search, Pencil, Save,
} from 'lucide-react';
import { getChecks, createCheck, updateCheck, deleteCheck, updateFlow } from '../../api/rulesFlowsApi';

// ─── Strategy Metadata ────────────────────────────────────────────────────────

const STRATEGY_META = {
  condition: {
    label: 'Field Condition',
    tagline: 'Rule-based field logic',
    desc: 'Check if declaration fields equal, contain, or match specific values using AND/OR logic.',
    example: 'e.g. Flag EXW incoterm · Require MRN to be filled',
    icon: GitBranch,
    accent: '#7c3aed',
    light: '#f5f3ff',
    border: '#c4b5fd',
  },
  ai_prompt: {
    label: 'AI Review',
    tagline: 'Ask Claude to validate',
    desc: 'Write a plain-English question. Claude reads the declaration fields and returns a pass/fail verdict.',
    example: 'e.g. Do goods descriptions match the HS codes?',
    icon: Sparkles,
    accent: '#0891b2',
    light: '#ecfeff',
    border: '#a5f3fc',
  },
  db_lookup: {
    label: 'Database Lookup',
    tagline: 'Check internal tables',
    desc: 'Match a field value against internal tables — quota alerts, watchlists, or reference data.',
    example: 'e.g. Is this HS code on the quota alert list?',
    icon: Database,
    accent: '#d97706',
    light: '#fffbeb',
    border: '#fcd34d',
  },
  cross_declaration: {
    label: 'Cross-Check',
    tagline: 'Detect duplicates & conflicts',
    desc: 'Compare against previous declarations to catch duplicate invoices or conflicting entries.',
    example: 'e.g. Same invoice number used twice in 30 days',
    icon: Shuffle,
    accent: '#2563eb',
    light: '#eff6ff',
    border: '#93c5fd',
  },
  external_api: {
    label: 'External API',
    tagline: 'TARIC & third-party checks',
    desc: 'Validate against EU TARIC tariff database or a custom external API for live validation.',
    example: 'e.g. Validate HS code exists in TARIC',
    icon: Zap,
    accent: '#059669',
    light: '#ecfdf5',
    border: '#6ee7b7',
  },
  composite: {
    label: 'Composite',
    tagline: 'Chain multiple strategies',
    desc: 'Combine check types using AND/OR logic — run condition checks together with AI reviews.',
    example: 'e.g. Condition AND AI Review must both pass',
    icon: Layers,
    accent: '#db2777',
    light: '#fdf2f8',
    border: '#f9a8d4',
  },
};

// ─── Declaration Fields ───────────────────────────────────────────────────────

const DECLARATION_FIELDS = {
  header: [
    { path: 'declaration.DECLARATIONID',             label: 'Declaration ID' },
    { path: 'declaration.TYPEDECLARATIONSSW',         label: 'Declaration Type (SSW)' },
    { path: 'declaration.TEMPLATECODE',               label: 'Template Code' },
    { path: 'declaration.DELIVERYTERMSCODE',          label: 'Incoterm Code' },
    { path: 'declaration.DELIVERYTERMSCOUNTRY',       label: 'Incoterm Country' },
    { path: 'declaration.TOTALGROSSMASS',             label: 'Total Gross Mass' },
    { path: 'declaration.CONTROLNETMASS',             label: 'Net Mass' },
    { path: 'declaration.CONTROLPACKAGES',            label: 'Packages Count' },
    { path: 'declaration.TOTALINVOICEAMOUNT',         label: 'Invoice Amount' },
    { path: 'declaration.TOTALINVOICEAMOUNTCURRENCY', label: 'Invoice Currency' },
    { path: 'declaration.DESTINATIONCOUNTRY',         label: 'Destination Country' },
    { path: 'declaration.DISPATCHCOUNTRY',            label: 'Dispatch Country' },
    { path: 'declaration.DECLARATIONTYPE',            label: 'Declaration Type (IM/EX)' },
    { path: 'declaration.FISCALDIRECTTRANSIT',        label: 'Fiscal Direct Transit' },
    { path: 'declaration.FISCALREPRESENTATIVECODE',   label: 'Fiscal Representative' },
    { path: 'declaration.DECLARATIONTAXSTATUS',       label: 'Tax Status' },
    { path: 'declaration.MRN',                        label: 'MRN' },
    { path: 'declaration.LRN',                        label: 'LRN' },
    { path: 'declaration.PROCEDURETYPESSW',           label: 'Procedure Type (SSW)' },
    { path: 'declaration.FISCALSALESVALUE',           label: 'Fiscal Sales Value' },
  ],
  item: [
    { path: 'item.COMMODITYCODE',               label: 'HS Code (Commodity)' },
    { path: 'item.COMMODITYNATIONALADDITIONAL1', label: 'National Add. Code' },
    { path: 'item.PROCEDURECURRENT',            label: 'Procedure Current' },
    { path: 'item.PROCEDUREPREVIOUS',           label: 'Procedure Previous' },
    { path: 'item.ORIGINCOUNTRY',               label: 'Origin Country' },
    { path: 'item.PREFERENCE',                  label: 'Preference Code' },
    { path: 'item.VALUATIONMETHOD',             label: 'Valuation Method' },
    { path: 'item.GROSSMASS',                   label: 'Gross Mass' },
    { path: 'item.NETMASS',                     label: 'Net Mass' },
    { path: 'item.SUPPLEMENTARYUNITS',          label: 'Supplementary Units' },
    { path: 'item.UNITCODE',                    label: 'Unit Code' },
    { path: 'item.INVOICEAMOUNT',               label: 'Invoice Amount' },
    { path: 'item.INVOICEAMOUNTCURRENCY',       label: 'Invoice Currency' },
    { path: 'item.STATISTICALVALUE',            label: 'Statistical Value' },
    { path: 'item.GOODSDESCRIPTION',            label: 'Goods Description' },
    { path: 'item.PAYMENTMETHOD',               label: 'Payment Method' },
    { path: 'item.ADDITIONALPROCEDURECODE1',    label: 'Add. Procedure 1' },
    { path: 'item.ADDITIONALPROCEDURECODE2',    label: 'Add. Procedure 2' },
    { path: 'item.CUSTOMSVALUEAMOUNT',          label: 'Customs Value' },
  ],
  document: [
    { path: 'document.DOCUMENTTYPE',   label: 'Document Type' },
    { path: 'document.REFERENCE',      label: 'Reference' },
    { path: 'document.DATEOFVALIDITY', label: 'Date of Validity' },
  ],
  fiscal: [
    { path: 'fiscal.ROLE',              label: 'Fiscal Role (FR1/FR2)' },
    { path: 'fiscal.VATIDENTIFICATION', label: 'VAT Identification' },
    { path: 'fiscal.RELATIONCODE',      label: 'Relation Code' },
  ],
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

// ─── Smart Value Suggestions ──────────────────────────────────────────────────
// Shown as clickable chips beneath the value input when the selected field has known coded values.

const FIELD_VALUE_SUGGESTIONS = {
  'declaration.DELIVERYTERMSCODE': [
    { value: 'EXW', label: 'EXW', sub: 'Ex Works' },
    { value: 'FCA', label: 'FCA', sub: 'Free Carrier' },
    { value: 'CPT', label: 'CPT', sub: 'Carriage Paid To' },
    { value: 'CIP', label: 'CIP', sub: 'Carriage & Insurance Paid' },
    { value: 'DAP', label: 'DAP', sub: 'Delivered at Place' },
    { value: 'DPU', label: 'DPU', sub: 'Delivered at Place Unloaded' },
    { value: 'DDP', label: 'DDP', sub: 'Delivered Duty Paid' },
    { value: 'FAS', label: 'FAS', sub: 'Free Alongside Ship' },
    { value: 'FOB', label: 'FOB', sub: 'Free On Board' },
    { value: 'CFR', label: 'CFR', sub: 'Cost & Freight' },
    { value: 'CIF', label: 'CIF', sub: 'Cost, Insurance, Freight' },
  ],
  'item.PROCEDURECURRENT': [
    { value: '10', label: '10', sub: 'Permanent export' },
    { value: '21', label: '21', sub: 'Temporary export' },
    { value: '31', label: '31', sub: 'Re-export' },
    { value: '40', label: '40', sub: 'Free circulation' },
    { value: '42', label: '42', sub: '4200 – VAT relief' },
    { value: '51', label: '51', sub: 'Inward processing' },
    { value: '53', label: '53', sub: 'Temporary admission' },
    { value: '61', label: '61', sub: 'Re-importation' },
    { value: '71', label: '71', sub: 'Customs warehousing' },
  ],
  'item.PROCEDUREPREVIOUS': [
    { value: '00', label: '00', sub: 'No previous procedure' },
    { value: '07', label: '07', sub: 'Free zone' },
    { value: '40', label: '40', sub: 'Free circulation' },
    { value: '51', label: '51', sub: 'Inward processing' },
    { value: '71', label: '71', sub: 'Customs warehouse' },
  ],
  'item.PREFERENCE': [
    { value: '100', label: '100', sub: 'Duty-free (preferential)' },
    { value: '200', label: '200', sub: 'Reduced rate' },
    { value: '300', label: '300', sub: 'MFN tariff rate' },
    { value: '400', label: '400', sub: 'Tariff suspension' },
  ],
  'item.VALUATIONMETHOD': [
    { value: '1', label: 'M1', sub: 'Transaction value (standard)' },
    { value: '2', label: 'M2', sub: 'Identical goods' },
    { value: '3', label: 'M3', sub: 'Similar goods' },
    { value: '4', label: 'M4', sub: 'Deductive method' },
    { value: '5', label: 'M5', sub: 'Computed value' },
    { value: '6', label: 'M6', sub: 'Fall-back method' },
  ],
  'item.ORIGINCOUNTRY': [
    { value: 'CN', label: 'CN', sub: 'China' },
    { value: 'US', label: 'US', sub: 'United States' },
    { value: 'IN', label: 'IN', sub: 'India' },
    { value: 'TR', label: 'TR', sub: 'Turkey' },
    { value: 'RU', label: 'RU ⚠', sub: 'Russia – sanctions' },
    { value: 'BY', label: 'BY ⚠', sub: 'Belarus – sanctions' },
    { value: 'UA', label: 'UA', sub: 'Ukraine' },
    { value: 'TN', label: 'TN', sub: 'Tunisia' },
    { value: 'MA', label: 'MA', sub: 'Morocco' },
    { value: 'GB', label: 'GB', sub: 'United Kingdom' },
    { value: 'DE', label: 'DE', sub: 'Germany' },
    { value: 'NL', label: 'NL', sub: 'Netherlands' },
    { value: 'BE', label: 'BE', sub: 'Belgium' },
    { value: 'FR', label: 'FR', sub: 'France' },
  ],
  'declaration.DISPATCHCOUNTRY': [
    { value: 'CN', label: 'CN', sub: 'China' },
    { value: 'TR', label: 'TR', sub: 'Turkey' },
    { value: 'RU', label: 'RU ⚠', sub: 'Russia – sanctions' },
    { value: 'BY', label: 'BY ⚠', sub: 'Belarus – sanctions' },
    { value: 'US', label: 'US', sub: 'United States' },
    { value: 'IN', label: 'IN', sub: 'India' },
    { value: 'GB', label: 'GB', sub: 'United Kingdom' },
    { value: 'DE', label: 'DE', sub: 'Germany' },
    { value: 'NL', label: 'NL', sub: 'Netherlands' },
    { value: 'BE', label: 'BE', sub: 'Belgium' },
  ],
  'declaration.DESTINATIONCOUNTRY': [
    { value: 'BE', label: 'BE', sub: 'Belgium' },
    { value: 'NL', label: 'NL', sub: 'Netherlands' },
    { value: 'DE', label: 'DE', sub: 'Germany' },
    { value: 'FR', label: 'FR', sub: 'France' },
    { value: 'LU', label: 'LU', sub: 'Luxembourg' },
    { value: 'GB', label: 'GB', sub: 'United Kingdom' },
  ],
  'declaration.DECLARATIONTYPE': [
    { value: 'IM', label: 'IM', sub: 'Import' },
    { value: 'EX', label: 'EX', sub: 'Export' },
    { value: 'CO', label: 'CO', sub: 'Community/transit' },
  ],
  'declaration.DECLARATIONTAXSTATUS': [
    { value: 'E', label: 'E', sub: 'Electronic' },
    { value: 'P', label: 'P', sub: 'Paper' },
  ],
  'fiscal.ROLE': [
    { value: 'FR1', label: 'FR1', sub: 'Direct fiscal rep.' },
    { value: 'FR2', label: 'FR2', sub: 'Indirect fiscal rep.' },
  ],
};

// ─── Quick-Start Rule Library ─────────────────────────────────────────────────
// Pre-built checks authored by a senior customs declarant.
// Each entry fully pre-fills the Check Editor — zero configuration needed.

const QUICK_RULES = [
  {
    id: 'exw_incoterm',
    title: 'EXW Incoterm Flag',
    description: 'Flag EXW deliveries where transport costs must be added to the customs value (Art. 71 UCC)',
    category: 'Valuation',
    icon: '🚛',
    check: {
      name: 'EXW Incoterm — Customs Value Check',
      description: 'EXW declarations require that transport costs from the place of origin be added to the customs value. Flags these for manual review.',
      severity: 'warning',
      strategy_type: 'condition',
      config: { logic: 'AND', conditions: [{ field: 'declaration.DELIVERYTERMSCODE', operator: 'equals', value: 'EXW', scope: 'header' }] },
      warning_message: 'EXW incoterm detected — transport costs from origin must be added to the customs value per Art. 71 UCC',
      is_active: true,
    },
  },
  {
    id: 'mrn_missing',
    title: 'MRN Missing',
    description: 'Alert when the Movement Reference Number is empty — declaration not yet accepted by customs',
    category: 'Compliance',
    icon: '🔴',
    check: {
      name: 'MRN Missing Check',
      description: 'An empty MRN means the declaration has not been accepted by customs. Should be resolved before release.',
      severity: 'warning',
      strategy_type: 'condition',
      config: { logic: 'AND', conditions: [{ field: 'declaration.MRN', operator: 'isEmpty', value: '', scope: 'header' }] },
      warning_message: 'MRN is missing — the declaration has not been accepted by customs yet',
      is_active: true,
    },
  },
  {
    id: 'fiscal_4200',
    title: '4200 Fiscal Representative',
    description: 'Ensure FR1 fiscal representative is declared on procedure 42 imports — required for VAT relief',
    category: 'Fiscal',
    icon: '🏛',
    check: {
      name: '4200 Regime — Fiscal Representative Required',
      description: 'Procedure 42 (4200 fiscal regime) requires a FR1 fiscal representative for VAT deferred accounting.',
      severity: 'warning',
      strategy_type: 'condition',
      config: {
        logic: 'AND',
        conditions: [
          { field: 'item.PROCEDURECURRENT', operator: 'equals', value: '42', scope: 'item', itemMatch: 'any' },
          { field: 'fiscal.ROLE', operator: 'notEquals', value: 'FR1', scope: 'fiscal' },
        ],
      },
      warning_message: '4200 fiscal procedure detected but no FR1 fiscal representative declared — VAT relief may be denied',
      is_active: true,
    },
  },
  {
    id: 'sanctions_ru_by',
    title: 'Russia / Belarus Sanctions',
    description: 'Flag goods from Russia or Belarus — EU sanctions Regulation 833/2014 may prohibit import',
    category: 'Sanctions',
    icon: '🚫',
    check: {
      name: 'Russia / Belarus Origin — Sanction Check',
      description: 'EU sanctions restrict imports of goods originating from or dispatched via Russia or Belarus.',
      severity: 'warning',
      strategy_type: 'condition',
      config: {
        logic: 'OR',
        conditions: [
          { field: 'item.ORIGINCOUNTRY', operator: 'isOneOf', value: 'RU,BY', scope: 'item', itemMatch: 'any' },
          { field: 'declaration.DISPATCHCOUNTRY', operator: 'isOneOf', value: 'RU,BY', scope: 'header' },
        ],
      },
      warning_message: 'Goods from Russia or Belarus — verify compliance with EU sanctions Regulation 833/2014 before release',
      is_active: true,
    },
  },
  {
    id: 'zero_invoice',
    title: 'Zero Invoice Amount',
    description: 'Detect items with a zero or missing invoice value — likely data error or undervaluation',
    category: 'Valuation',
    icon: '💶',
    check: {
      name: 'Zero or Missing Invoice Amount',
      description: 'A zero invoice amount is likely a data entry error or deliberate undervaluation. Requires review.',
      severity: 'warning',
      strategy_type: 'condition',
      config: {
        logic: 'OR',
        conditions: [
          { field: 'item.INVOICEAMOUNT', operator: 'equals', value: '0', scope: 'item', itemMatch: 'any' },
          { field: 'item.INVOICEAMOUNT', operator: 'isEmpty', value: '', scope: 'item', itemMatch: 'any' },
        ],
      },
      warning_message: 'Zero or missing invoice amount — verify the customs value is correctly declared',
      is_active: true,
    },
  },
  {
    id: 'preferential_origin',
    title: 'Preferential Origin Check',
    description: 'When preference code 100 (duty-free) is claimed, ensure a valid proof of origin is attached',
    category: 'Origin',
    icon: '📋',
    check: {
      name: 'Preferential Origin — Proof of Origin Required',
      description: 'Preference code 100 claims duty-free treatment under a trade agreement. A valid EUR.1, REX statement, or A.TR must be on file.',
      severity: 'warning',
      strategy_type: 'condition',
      config: { logic: 'AND', conditions: [{ field: 'item.PREFERENCE', operator: 'equals', value: '100', scope: 'item', itemMatch: 'any' }] },
      warning_message: 'Preferential origin (code 100) claimed — confirm a valid proof of origin document is declared (EUR.1 / REX / A.TR)',
      is_active: true,
    },
  },
  {
    id: 'ai_goods_desc',
    title: 'AI: Description vs HS Code',
    description: 'Ask Claude to verify goods descriptions are consistent with the declared HS commodity codes',
    category: 'AI Review',
    icon: '🤖',
    check: {
      name: 'AI — Goods Description vs HS Code Consistency',
      description: 'Uses Claude to validate that goods descriptions semantically match the declared commodity codes.',
      severity: 'warning',
      strategy_type: 'ai_prompt',
      config: {
        question: 'For each item, does the goods description match the declared HS commodity code? Flag any items where the description does not match the HS code chapter or heading. Be specific about which item and why.',
        fields_to_include: ['item.COMMODITYCODE', 'item.GOODSDESCRIPTION'],
      },
      warning_message: 'AI detected a potential mismatch between goods description and HS code — manual review required',
      is_active: true,
    },
  },
  {
    id: 'high_value_low_weight',
    title: 'High Value / Low Weight Anomaly',
    description: 'Flag declarations where invoice value is very high but gross mass is very low — risk indicator',
    category: 'Risk',
    icon: '⚖',
    check: {
      name: 'High Value / Low Weight Anomaly',
      description: 'Very high invoice value with very low gross mass can indicate overvaluation or goods description mismatch.',
      severity: 'info',
      strategy_type: 'condition',
      config: {
        logic: 'AND',
        conditions: [
          { field: 'declaration.TOTALINVOICEAMOUNT', operator: 'greaterThan', value: '50000', scope: 'header' },
          { field: 'declaration.TOTALGROSSMASS', operator: 'lessThan', value: '10', scope: 'header' },
        ],
      },
      warning_message: 'High invoice value with very low gross mass — verify goods description and valuation method',
      is_active: true,
    },
  },
  {
    id: 'non_standard_valuation',
    title: 'Non-Standard Valuation Method',
    description: 'Flag when valuation method is not Method 1 (transaction value) — requires written justification',
    category: 'Valuation',
    icon: '📊',
    check: {
      name: 'Non-Standard Valuation Method (M2–M6)',
      description: 'Methods 2–6 require written justification per Art. 74 UCC. Ensure supporting documentation is on file.',
      severity: 'info',
      strategy_type: 'condition',
      config: { logic: 'AND', conditions: [{ field: 'item.VALUATIONMETHOD', operator: 'notEquals', value: '1', scope: 'item', itemMatch: 'any' }] },
      warning_message: 'Non-transaction value method used — ensure written justification per Art. 74 UCC is on file',
      is_active: true,
    },
  },
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
  name: '',
  description: '',
  severity: 'warning',
  strategy_type: type,
  config: emptyConfig(type),
  warning_message: '',
  is_active: true,
  _isNew: true,
});

const POSITIONS_KEY = (flowId) => `rf_positions_${flowId}`;

// ─── Custom Nodes ─────────────────────────────────────────────────────────────

function TriggerNode() {
  return (
    <div className="bg-white border border-indigo-200 rounded px-3.5 py-2.5 min-w-[200px] shadow-sm">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded bg-indigo-50 flex items-center justify-center flex-shrink-0">
          <Shield size={12} className="text-indigo-500" />
        </div>
        <div>
          <div className="text-[10px] text-indigo-400 font-semibold uppercase tracking-wide">Trigger</div>
          <div className="text-xs font-bold text-gray-800">Declaration Loaded</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom}
        style={{ background: '#6366f1', width: 8, height: 8, border: '2px solid white' }} />
    </div>
  );
}

function EndNode() {
  return (
    <div className="bg-white border border-green-200 rounded px-3.5 py-2.5 min-w-[200px] shadow-sm">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded bg-green-50 flex items-center justify-center flex-shrink-0">
          <CheckCircle2 size={12} className="text-green-500" />
        </div>
        <div>
          <div className="text-[10px] text-green-500 font-semibold uppercase tracking-wide">Output</div>
          <div className="text-xs font-bold text-gray-800">Results Ready</div>
        </div>
      </div>
      <Handle type="target" position={Position.Top}
        style={{ background: '#22c55e', width: 8, height: 8, border: '2px solid white' }} />
    </div>
  );
}

function CheckNode({ data, selected }) {
  const meta = STRATEGY_META[data.strategy_type] ?? STRATEGY_META.condition;
  const Icon = meta.icon;
  return (
    <div
      className="bg-white rounded min-w-[220px] max-w-[260px] overflow-hidden cursor-pointer transition-all duration-150 hover:shadow-sm"
      style={{
        border: selected ? `1.5px solid ${meta.accent}` : '1.5px solid #e5e7eb',
        boxShadow: selected ? `0 0 0 3px ${meta.accent}18` : '0 1px 4px rgba(0,0,0,0.06)',
        opacity: data.is_active ? 1 : 0.5,
      }}
    >
      <div className="h-0.5 w-full" style={{ background: meta.accent }} />
      <Handle type="target" position={Position.Top}
        style={{ background: meta.accent, width: 8, height: 8, border: '2px solid white', top: -4 }} />
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0" style={{ background: meta.light }}>
            <Icon size={12} style={{ color: meta.accent }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 mb-0.5">
              <span className="text-xs font-bold text-gray-900 truncate">{data.name || 'Unnamed Check'}</span>
              {!data.is_active && (
                <span className="text-[10px] px-1 py-0.5 rounded bg-gray-100 text-gray-400 font-medium flex-shrink-0">off</span>
              )}
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: meta.light, color: meta.accent }}>
                {meta.label}
              </span>
              {data.severity === 'warning'
                ? <span className="text-[10px] px-1 py-0.5 rounded bg-amber-50 text-amber-600 font-medium">⚠ warn</span>
                : <span className="text-[10px] px-1 py-0.5 rounded bg-blue-50 text-blue-600 font-medium">ℹ info</span>
              }
            </div>
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom}
        style={{ background: meta.accent, width: 8, height: 8, border: '2px solid white', bottom: -4 }} />
    </div>
  );
}

const nodeTypes = { triggerNode: TriggerNode, checkNode: CheckNode, endNode: EndNode };

// ─── Field Picker ─────────────────────────────────────────────────────────────

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
    ? ALL_FIELDS_FLAT.filter(f =>
        f.label.toLowerCase().includes(search.toLowerCase()) ||
        f.path.toLowerCase().includes(search.toLowerCase())
      )
    : ALL_FIELDS_FLAT;

  const grouped = Object.entries(DECLARATION_FIELDS)
    .map(([scope, fields]) => ({
      scope,
      label: { header: 'Header', item: 'Item', document: 'Document', fiscal: 'Fiscal' }[scope],
      fields: search ? fields.filter(f => filtered.some(ff => ff.path === f.path)) : fields,
    }))
    .filter(g => g.fields.length > 0);

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 border border-gray-200 rounded px-3 py-2 text-sm bg-white hover:border-blue-400 transition-colors text-left">
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
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.1 }}
            className="absolute z-[70] top-full mt-1 left-0 right-0 bg-white rounded border border-gray-300 shadow overflow-hidden"
            style={{ maxHeight: 280 }}
          >
            <div className="p-2 border-b border-gray-100 sticky top-0 bg-white">
              <div className="flex items-center gap-2 border border-gray-200 rounded px-2 py-1.5 bg-gray-50">
                <Search size={12} className="text-gray-400" />
                <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search fields…" className="flex-1 text-xs bg-transparent outline-none" />
              </div>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
              {grouped.map(({ scope, label, fields }) => (
                <div key={scope}>
                  <div className="px-3 py-1.5 text-xs font-bold text-gray-400 uppercase tracking-wider bg-gray-50">{label}</div>
                  {fields.map(f => (
                    <button key={f.path} type="button"
                      onClick={() => { onChange(f.path, scope); setOpen(false); setSearch(''); }}
                      className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-blue-50 transition-colors text-left ${value === f.path ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-700'}`}>
                      <span>{f.label}</span>
                      <span className="text-xs text-gray-300 font-mono truncate ml-2">{f.path.split('.')[1]}</span>
                    </button>
                  ))}
                </div>
              ))}
              {filtered.length === 0 && <div className="px-3 py-6 text-center text-xs text-gray-400">No fields match</div>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Config Editors ───────────────────────────────────────────────────────────

// Converts a single condition object into a plain-English preview string
function conditionToText(cond) {
  const fieldLabel = ALL_FIELDS_FLAT.find(f => f.path === cond.field)?.label ?? cond.field;
  const opMap = {
    equals:      'equals',
    notEquals:   'is not',
    greaterThan: 'is greater than',
    lessThan:    'is less than',
    contains:    'contains',
    isEmpty:     'is empty',
    isNotEmpty:  'is not empty',
    isOneOf:     'is one of',
    isNotOneOf:  'is not one of',
  };
  const opLabel = opMap[cond.operator] ?? cond.operator;
  const noValue = ['isEmpty', 'isNotEmpty'].includes(cond.operator);
  if (noValue) return `${fieldLabel} ${opLabel}`;
  const val = cond.value ? `"${cond.value}"` : '…';
  return `${fieldLabel} ${opLabel} ${val}`;
}

function ConditionConfigEditor({ config, onChange }) {
  const conditions = config.conditions ?? [];
  const updateCond = (i, patch) =>
    onChange({ ...config, conditions: conditions.map((c, idx) => idx === i ? { ...c, ...patch } : c) });
  const addCond = () => onChange({ ...config, conditions: [...conditions, emptyCondition()] });
  const removeCond = (i) => onChange({ ...config, conditions: conditions.filter((_, idx) => idx !== i) });

  return (
    <div className="space-y-3">
      {/* Logic toggle — feels like reading a sentence */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500 font-medium">Flag when</span>
        {['AND', 'OR'].map(l => (
          <button key={l} type="button" onClick={() => onChange({ ...config, logic: l })}
            className={`px-2.5 py-0.5 rounded text-xs font-bold border transition-all ${config.logic === l ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-500 border-gray-200 hover:border-violet-300'}`}>
            {l}
          </button>
        ))}
        <span className="text-xs text-gray-400">
          {config.logic === 'AND' ? 'of these are true (all must match)' : 'of these is true (any one matches)'}
        </span>
      </div>
      {conditions.map((cond, i) => {
        const noValue = ['isEmpty', 'isNotEmpty'].includes(cond.operator);
        const preview = conditionToText(cond);
        return (
          <div key={i} className="rounded border border-gray-200 bg-white p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Condition {i + 1}</span>
                <div className="text-xs text-violet-700 font-medium mt-0.5 truncate" title={preview}>{preview}</div>
              </div>
              {conditions.length > 1 && (
                <button type="button" onClick={() => removeCond(i)} className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors flex-shrink-0 mt-0.5">
                  <X size={12} />
                </button>
              )}
            </div>
            <FieldPicker value={cond.field} onChange={(path, scope) => updateCond(i, { field: path, scope })} />
            <select value={cond.operator} onChange={e => updateCond(i, { operator: e.target.value })}
              className="w-full border border-gray-200 rounded px-3 py-2 text-sm bg-white focus:outline-none focus:border-violet-400 border-gray-200">
              {OPERATORS.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
            </select>
            {!noValue && (
              <>
                <input value={cond.value} onChange={e => updateCond(i, { value: e.target.value })}
                  placeholder="Value to compare…"
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-violet-400" />
                {FIELD_VALUE_SUGGESTIONS[cond.field] && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {FIELD_VALUE_SUGGESTIONS[cond.field].map(s => {
                      const isMulti = cond.operator === 'isOneOf' || cond.operator === 'isNotOneOf';
                      const active = isMulti
                        ? cond.value.split(',').map(v => v.trim()).includes(s.value)
                        : cond.value === s.value;
                      return (
                        <button
                          key={s.value}
                          type="button"
                          title={s.sub}
                          onClick={() => {
                            if (isMulti) {
                              const parts = cond.value ? cond.value.split(',').map(v => v.trim()).filter(Boolean) : [];
                              const next = active ? parts.filter(v => v !== s.value) : [...parts, s.value];
                              updateCond(i, { value: next.join(',') });
                            } else {
                              updateCond(i, { value: active ? '' : s.value });
                            }
                          }}
                          className={`px-2 py-0.5 rounded border text-[11px] font-semibold transition-all ${active ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-600 border-gray-200 hover:border-violet-300 hover:text-violet-600'}`}
                        >
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
            {cond.scope === 'item' && (
              <div className="flex items-center gap-2 pt-1">
                <span className="text-xs text-gray-400">Fire if</span>
                {['any', 'all'].map(v => (
                  <button key={v} type="button" onClick={() => updateCond(i, { itemMatch: v })}
                    className={`px-2.5 py-1 rounded text-xs font-medium border transition-all ${(cond.itemMatch ?? 'any') === v ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-500 border-gray-200'}`}>
                    {v} item matches
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <button type="button" onClick={addCond}
        className="w-full py-2 rounded border border-dashed border-violet-200 text-violet-600 text-xs hover:bg-violet-50 transition-colors flex items-center justify-center gap-1">
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
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">What should Claude check? *</label>
        <textarea value={config.question ?? ''} onChange={e => onChange({ ...config, question: e.target.value })}
          placeholder="e.g. Do the goods descriptions match the declared HS codes for all items?"
          rows={3} className="w-full border border-gray-200 rounded px-3 py-2 text-sm resize-none focus:outline-none focus:border-cyan-400" />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">Declaration fields to send ({selected.size} selected)</label>
        <div className="flex items-center gap-2 border border-gray-200 rounded px-2 py-1.5 bg-gray-50 mb-2">
          <Search size={12} className="text-gray-400" />
          <input value={fieldSearch} onChange={e => setFieldSearch(e.target.value)} placeholder="Search fields…" className="flex-1 text-xs bg-transparent outline-none" />
        </div>
        <div className="rounded border border-gray-200 overflow-y-auto" style={{ maxHeight: 180 }}>
          {Object.entries(DECLARATION_FIELDS).map(([scope, fields]) => {
            const scopeFiltered = fields.filter(f => filtered.some(ff => ff.path === f.path));
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
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">API Source</label>
        <select value={config.api ?? 'taric'} onChange={e => onChange({ ...config, api: e.target.value })}
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm bg-white focus:outline-none focus:border-emerald-400">
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
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-400" />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">Match on field</label>
        <FieldPicker value={config.match_field} onChange={(path) => onChange({ ...config, match_field: path })} />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">Trigger condition</label>
        <select value={config.condition ?? 'exists'} onChange={e => onChange({ ...config, condition: e.target.value })}
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm bg-white focus:outline-none focus:border-amber-400">
          <option value="exists">Record exists → fire warning</option>
          <option value="not_exists">Record missing → fire warning</option>
        </select>
      </div>
    </div>
  );
}

const CROSS_CHECK_TYPES = [
  { value: 'duplicate_invoice', label: 'Duplicate Invoice',  desc: 'Same invoice reference used across multiple declarations' },
  { value: 'duplicate_mrn',     label: 'Duplicate MRN',      desc: 'Same MRN referenced in different declarations' },
  { value: 'value_spike',       label: 'Value Spike',        desc: 'Invoice amount significantly higher than recent declarations for the same HS code' },
  { value: 'origin_conflict',   label: 'Origin Conflict',    desc: 'Same goods declared with different origin countries in the look-back window' },
];

const CROSS_FIELDS = [
  { path: 'declaration.MRN',       label: 'MRN' },
  { path: 'document.REFERENCE',    label: 'Invoice Ref.' },
  { path: 'item.COMMODITYCODE',    label: 'HS Code' },
  { path: 'item.INVOICEAMOUNT',    label: 'Invoice Amount' },
  { path: 'item.ORIGINCOUNTRY',    label: 'Origin Country' },
  { path: 'declaration.DECLARATIONID', label: 'Declaration ID' },
];

function CrossDeclarationConfigEditor({ config, onChange }) {
  const selectedFields = new Set(config.fields ?? []);
  const toggleField = (path) => {
    const next = new Set(selectedFields);
    next.has(path) ? next.delete(path) : next.add(path);
    onChange({ ...config, fields: [...next] });
  };

  return (
    <div className="space-y-4">
      {/* Check type */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">What to detect</label>
        <div className="space-y-1.5">
          {CROSS_CHECK_TYPES.map(ct => (
            <button key={ct.value} type="button"
              onClick={() => onChange({ ...config, check_type: ct.value })}
              className={`w-full text-left p-2.5 rounded border transition-all ${config.check_type === ct.value ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
              <div className={`text-xs font-bold ${config.check_type === ct.value ? 'text-blue-700' : 'text-gray-800'}`}>{ct.label}</div>
              <div className="text-[11px] text-gray-400 mt-0.5">{ct.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Fields to compare */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">Fields to compare across declarations</label>
        <div className="flex flex-wrap gap-1.5">
          {CROSS_FIELDS.map(f => {
            const active = selectedFields.has(f.path);
            return (
              <button key={f.path} type="button" onClick={() => toggleField(f.path)}
                className={`px-2.5 py-1 rounded border text-xs font-medium transition-all ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}>
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Time window */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">Look-back window</label>
        <div className="flex items-center gap-3">
          {[7, 14, 30, 60, 90].map(d => (
            <button key={d} type="button"
              onClick={() => onChange({ ...config, time_window_days: d })}
              className={`px-3 py-1.5 rounded border text-xs font-semibold transition-all ${(config.time_window_days ?? 30) === d ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}>
              {d}d
            </button>
          ))}
          <span className="text-xs text-gray-400">days back</span>
        </div>
      </div>
    </div>
  );
}

const COMPOSITE_STRATEGY_OPTIONS = [
  { value: 'condition',         label: 'Field Condition' },
  { value: 'ai_prompt',         label: 'AI Review' },
  { value: 'db_lookup',         label: 'Database Lookup' },
  { value: 'cross_declaration', label: 'Cross-Check' },
  { value: 'external_api',      label: 'External API' },
];

function CompositeConfigEditor({ config, onChange }) {
  const steps = config.steps ?? [];

  const addStep = (strategyType) => {
    const newStep = {
      strategy_type: strategyType,
      config: emptyConfig(strategyType),
      name: `${COMPOSITE_STRATEGY_OPTIONS.find(o => o.value === strategyType)?.label ?? strategyType} step`,
    };
    onChange({ ...config, steps: [...steps, newStep] });
  };

  const removeStep = (i) => onChange({ ...config, steps: steps.filter((_, idx) => idx !== i) });

  return (
    <div className="space-y-4">
      {/* Logic */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 font-medium">All steps must pass using</span>
        {['AND', 'OR'].map(l => (
          <button key={l} type="button" onClick={() => onChange({ ...config, logic: l })}
            className={`px-2.5 py-0.5 rounded text-xs font-bold border transition-all ${config.logic === l ? 'bg-pink-600 text-white border-pink-600' : 'bg-white text-gray-500 border-gray-200 hover:border-pink-300'}`}>
            {l}
          </button>
        ))}
        <span className="text-xs text-gray-400">logic</span>
      </div>

      {/* Steps list */}
      {steps.length > 0 && (
        <div className="space-y-1.5">
          {steps.map((step, i) => {
            const meta = STRATEGY_META[step.strategy_type];
            const Icon = meta?.icon ?? GitBranch;
            return (
              <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded border border-gray-200 bg-white">
                <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0" style={{ background: meta?.light ?? '#f3f4f6' }}>
                  <Icon size={10} style={{ color: meta?.accent ?? '#6b7280' }} />
                </div>
                <span className="flex-1 text-xs font-medium text-gray-700 truncate">{step.name}</span>
                <span className="text-[10px] text-gray-400 font-mono">{step.strategy_type}</span>
                <button type="button" onClick={() => removeStep(i)}
                  className="p-0.5 rounded hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors">
                  <X size={11} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Add step */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">Add a step</label>
        <div className="flex flex-wrap gap-1.5">
          {COMPOSITE_STRATEGY_OPTIONS.map(opt => {
            const meta = STRATEGY_META[opt.value];
            const Icon = meta?.icon ?? GitBranch;
            return (
              <button key={opt.value} type="button" onClick={() => addStep(opt.value)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-medium transition-all hover:brightness-95"
                style={{ background: meta?.light ?? '#f9fafb', borderColor: meta?.border ?? '#e5e7eb', color: meta?.accent ?? '#374151' }}>
                <Icon size={11} />
                {opt.label}
              </button>
            );
          })}
        </div>
        {steps.length === 0 && (
          <p className="text-[11px] text-gray-400 mt-2">Add at least two steps to chain checks together.</p>
        )}
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
    case 'cross_declaration': return <CrossDeclarationConfigEditor config={config} onChange={onChange} />;
    case 'composite':         return <CompositeConfigEditor config={config} onChange={onChange} />;
    default:
      return (
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Config (JSON)</label>
          <textarea value={JSON.stringify(config, null, 2)}
            onChange={e => { try { onChange(JSON.parse(e.target.value)); } catch {} }}
            rows={5} className="w-full border border-gray-200 rounded px-3 py-2 text-xs font-mono resize-none focus:outline-none" />
        </div>
      );
  }
}

// ─── Modal Shell ──────────────────────────────────────────────────────────────

function ModalOverlay({ children, onClose }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.1 }}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <AnimatePresence mode="wait">
        {children}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Check Type Picker ────────────────────────────────────────────────────────

function CheckTypePicker({ onSelect, onSelectQuick, onClose }) {
  return (
    <motion.div
      key="type-picker"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="bg-white rounded border border-gray-300 shadow w-full max-w-3xl flex flex-col overflow-hidden"
      style={{ maxHeight: '88vh' }}
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 flex-shrink-0">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Add a Check</h2>
          <p className="text-xs text-gray-500 mt-0.5">Pick a ready-made scenario or build a custom check from scratch</p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100 transition-colors">
          <X size={15} className="text-gray-400" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ── Quick-start scenarios ── */}
        <div className="px-5 pt-4 pb-3">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-bold text-gray-800">Quick-start scenarios</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 font-semibold">
              Ready to use
            </span>
            <span className="text-[11px] text-gray-400">— click to add instantly, edit anytime</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {QUICK_RULES.map(qr => (
              <button key={qr.id} onClick={() => onSelectQuick(qr)}
                className="text-left p-3 rounded border border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/40 transition-all group">
                <div className="text-lg mb-1.5 leading-none">{qr.icon}</div>
                <div className="text-xs font-bold text-gray-900 group-hover:text-indigo-700 leading-snug mb-0.5">{qr.title}</div>
                <div className="text-[11px] text-gray-400 leading-snug line-clamp-2 mb-2">{qr.description}</div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium">{qr.category}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Divider ── */}
        <div className="flex items-center gap-3 px-5 py-2">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Or build custom</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* ── Strategy type buttons ── */}
        <div className="px-5 pb-4 grid grid-cols-3 gap-2">
          {Object.entries(STRATEGY_META).map(([type, meta]) => {
            const Icon = meta.icon;
            return (
              <button key={type} onClick={() => onSelect(type)}
                className="flex items-center gap-2.5 p-2.5 rounded border text-left transition-all"
                style={{ background: meta.light, borderColor: meta.border }}
                onMouseEnter={e => e.currentTarget.style.filter = 'brightness(0.97)'}
                onMouseLeave={e => e.currentTarget.style.filter = ''}
              >
                <div className="w-7 h-7 rounded bg-white flex items-center justify-center flex-shrink-0"
                  style={{ border: `1px solid ${meta.border}` }}>
                  <Icon size={13} style={{ color: meta.accent }} />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-gray-900 truncate">{meta.label}</div>
                  <div className="text-[10px] truncate" style={{ color: meta.accent }}>{meta.tagline}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Check Editor Modal ───────────────────────────────────────────────────────

function CheckEditor({ check, isNew, onSave, onDelete, onClose }) {
  const [form, setForm] = useState({ ...check });
  const [saving, setSaving] = useState(false);
  const meta = STRATEGY_META[form.strategy_type] ?? STRATEGY_META.condition;
  const Icon = meta.icon;
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } catch (e) {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${form.name}"? This cannot be undone.`)) return;
    await onDelete();
    onClose();
  };

  return (
    <motion.div
      key="check-editor"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="bg-white rounded border border-gray-300 shadow w-full max-w-2xl flex flex-col overflow-hidden"
      style={{ maxHeight: '88vh' }}
      onClick={e => e.stopPropagation()}
    >
      {/* Colored header */}
      <div className="flex items-center justify-between px-5 py-3.5 flex-shrink-0"
        style={{ background: meta.light, borderBottom: `1px solid ${meta.border}` }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded bg-white flex items-center justify-center"
            style={{ border: `1px solid ${meta.border}` }}>
            <Icon size={14} style={{ color: meta.accent }} />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: meta.accent }}>
              {meta.label} · {meta.tagline}
            </div>
            <div className="text-sm font-bold text-gray-900">
              {isNew ? `New ${meta.label}` : (form.name || 'Edit Check')}
            </div>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded hover:bg-white/60 transition-colors">
          <X size={14} className="text-gray-500" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Name */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">
            Check Name <span className="text-red-400">*</span>
          </label>
          <input
            autoFocus
            value={form.name}
            onChange={e => set('name', e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            placeholder="Give this check a clear name…"
            className="w-full border border-gray-200 rounded px-3 py-2 text-sm font-medium focus:outline-none focus:border-gray-400 transition-colors"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">
            Description <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea value={form.description} onChange={e => set('description', e.target.value)}
            placeholder="What does this check verify? Why does it matter?"
            rows={2} className="w-full border border-gray-200 rounded px-3 py-2 text-sm resize-none focus:outline-none focus:border-gray-400 transition-colors" />
        </div>

        {/* Config divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Configuration</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        <div className="border border-gray-200 bg-gray-50 p-3 rounded">
          <ConfigEditor type={form.strategy_type} config={form.config} onChange={cfg => set('config', cfg)} />
        </div>

        {/* Outcome divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Outcome</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* Severity */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Severity when check triggers</label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { v: 'warning', label: 'Warning', sub: 'Requires attention', SIcon: AlertTriangle, c: '#d97706', bg: '#fffbeb', b: '#fcd34d' },
              { v: 'info',    label: 'Info',    sub: 'For reference only',  SIcon: Info,          c: '#2563eb', bg: '#eff6ff', b: '#93c5fd' },
            ].map(({ v, label, sub, SIcon, c, bg, b }) => (
              <button key={v} type="button" onClick={() => set('severity', v)}
                className="flex items-center gap-2.5 p-2.5 rounded border-2 transition-all text-left"
                style={form.severity === v ? { borderColor: b, background: bg } : { borderColor: '#e5e7eb', background: 'white' }}>
                <SIcon size={14} style={{ color: form.severity === v ? c : '#9ca3af' }} />
                <div>
                  <div className="text-xs font-semibold text-gray-800">{label}</div>
                  <div className="text-[11px] text-gray-400">{sub}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Warning message */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">
            Message shown when this check fires
          </label>
          <textarea value={form.warning_message} onChange={e => set('warning_message', e.target.value)}
            placeholder="e.g. EXW incoterm detected — verify transport costs are excluded from the customs value"
            rows={2} className="w-full border border-gray-200 rounded px-3 py-2 text-sm resize-none focus:outline-none focus:border-gray-400 transition-colors" />
        </div>

        {/* Active toggle */}
        <div className="flex items-center justify-between px-3 py-2.5 bg-gray-50 border border-gray-200 rounded">
          <div>
            <div className="text-xs font-semibold text-gray-700">Enable this check</div>
            <div className="text-[11px] text-gray-400 mt-0.5">Disabled checks are skipped during flow runs</div>
          </div>
          <button type="button" onClick={() => set('is_active', !form.is_active)}
            className="relative w-10 h-5 rounded-full transition-colors duration-150 flex-shrink-0"
            style={{ background: form.is_active ? meta.accent : '#d1d5db' }}>
            <div className={`absolute w-4 h-4 bg-white rounded-full shadow-sm top-0.5 transition-transform duration-150 ${form.is_active ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 px-5 py-3 border-t border-gray-200 flex items-center gap-2 bg-white">
        {!isNew && (
          <button onClick={handleDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-red-200 text-red-500 hover:bg-red-50 text-xs font-medium transition-colors">
            <Trash2 size={12} /> Delete
          </button>
        )}
        <div className="flex-1" />
        <button onClick={onClose} className="px-3 py-1.5 rounded text-xs text-gray-600 hover:bg-gray-100 transition-colors">
          Cancel
        </button>
        <button onClick={handleSave} disabled={saving || !form.name.trim()}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded text-white text-xs font-semibold disabled:opacity-50 transition-colors"
          style={{ background: meta.accent }}>
          <Save size={12} />
          {saving ? 'Saving…' : isNew ? 'Add Check' : 'Save Changes'}
        </button>
      </div>
    </motion.div>
  );
}

// ─── Graph helpers ────────────────────────────────────────────────────────────

function buildEdges(orderedIds) {
  return orderedIds.slice(0, -1).map((id, i) => ({
    id: `e-${id}-${orderedIds[i + 1]}`,
    source: id,
    target: orderedIds[i + 1],
    type: 'smoothstep',
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: '#6366f1', strokeWidth: 2 },
  }));
}

// ─── Main Builder ─────────────────────────────────────────────────────────────

function FlowBuilderInner() {
  const { flowId } = useParams();
  const navigate = useNavigate();
  const rfInstance = useReactFlow();

  const [flow, setFlow]         = useState(null);
  const [dbChecks, setDbChecks] = useState([]);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loading, setLoading]   = useState(true);
  const [editName, setEditName] = useState(false);
  const [flowName, setFlowName] = useState('');
  // modal: null | { mode: 'typePicker' } | { mode: 'editor', nodeId, checkData, isNew }
  const [modal, setModal]       = useState(null);

  const rebuildGraph = useCallback((checks) => {
    const saved = JSON.parse(localStorage.getItem(POSITIONS_KEY(flowId)) ?? '{}');
    const sorted = [...checks].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    const newNodes = [
      { id: '__trigger', type: 'triggerNode', position: saved['__trigger'] ?? { x: 300, y: 0 }, data: {}, deletable: false, selectable: false },
      ...sorted.map((c, i) => ({
        id: c.id,
        type: 'checkNode',
        position: saved[c.id] ?? { x: 300, y: (i + 1) * 170 },
        data: { ...c, label: c.name },
      })),
      { id: '__end', type: 'endNode', position: saved['__end'] ?? { x: 300, y: (sorted.length + 1) * 170 }, data: {}, deletable: false, selectable: false },
    ];
    const ids = ['__trigger', ...sorted.map(c => c.id), '__end'];
    setNodes(newNodes);
    setEdges(buildEdges(ids));
  }, [flowId, setNodes, setEdges]);

  useEffect(() => {
    const load = async () => {
      const [allFlows, checks] = await Promise.all([
        fetch('/api/rules/flows').then(r => r.json()),
        getChecks(flowId),
      ]);
      const f = allFlows.find(fl => fl.id === flowId) ?? null;
      setFlow(f);
      setFlowName(f?.name ?? '');
      setDbChecks(checks);
      rebuildGraph(checks);
      setLoading(false);
    };
    load().catch(console.error);
  }, [flowId]);

  const onNodeDragStop = useCallback((_, node) => {
    const saved = JSON.parse(localStorage.getItem(POSITIONS_KEY(flowId)) ?? '{}');
    saved[node.id] = node.position;
    localStorage.setItem(POSITIONS_KEY(flowId), JSON.stringify(saved));
  }, [flowId]);

  const onConnect = useCallback((params) => {
    setEdges(eds => addEdge({
      ...params, type: 'smoothstep', animated: true,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: '#6366f1', strokeWidth: 2 },
    }, eds));
  }, [setEdges]);

  const onNodeClick = useCallback((_, node) => {
    if (node.type !== 'checkNode') return;
    setModal({ mode: 'editor', nodeId: node.id, checkData: { ...node.data }, isNew: false });
  }, []);

  const openTypePicker = () => setModal({ mode: 'typePicker' });
  const selectType = (type) => setModal({ mode: 'editor', nodeId: null, checkData: newCheckData(type), isNew: true });
  const selectQuickRule = (qr) => setModal({ mode: 'editor', nodeId: null, checkData: { ...qr.check, _isNew: true }, isNew: true });

  const handleModalSave = async (formData) => {
    if (modal.isNew) {
      const { _isNew, label, ...payload } = formData;
      const saved = await createCheck(flowId, payload);
      const next = [...dbChecks, saved];
      setDbChecks(next);
      rebuildGraph(next);
    } else {
      const { label, _isNew, ...payload } = formData;
      const saved = await updateCheck(modal.nodeId, payload);
      const next = dbChecks.map(c => c.id === modal.nodeId ? saved : c);
      setDbChecks(next);
      setNodes(nds => nds.map(n => n.id !== modal.nodeId ? n : { ...n, data: { ...saved, label: saved.name } }));
    }
    setTimeout(() => rfInstance.fitView({ padding: 0.25, duration: 350 }), 80);
  };

  const handleModalDelete = async () => {
    const { nodeId } = modal;
    if (nodeId && !String(nodeId).startsWith('new_')) {
      await deleteCheck(nodeId);
    }
    const next = dbChecks.filter(c => c.id !== nodeId);
    setDbChecks(next);
    rebuildGraph(next);
  };

  const saveFlowName = async () => {
    if (flowName.trim() && flowName !== flow?.name) {
      await updateFlow(flowId, { name: flowName.trim() });
      setFlow(f => ({ ...f, name: flowName.trim() }));
    }
    setEditName(false);
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-10 h-10 rounded bg-indigo-50 flex items-center justify-center mx-auto mb-3">
            <GitBranch size={20} className="text-indigo-400" />
          </div>
          <div className="text-sm text-gray-400">Loading flow…</div>
        </div>
      </div>
    );
  }

  const activeChecks = dbChecks.filter(c => c.is_active).length;

  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
      {/* ── Top bar ── */}
      <div className="h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-3 flex-shrink-0 z-20 shadow-sm">
        <button onClick={() => navigate('/rules/flows')}
          className="p-1.5 rounded hover:bg-gray-100 text-gray-500 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="w-px h-5 bg-gray-200" />

        {editName ? (
          <input autoFocus value={flowName} onChange={e => setFlowName(e.target.value)}
            onBlur={saveFlowName} onKeyDown={e => e.key === 'Enter' && saveFlowName()}
            className="font-bold text-base border-b-2 border-indigo-500 focus:outline-none bg-transparent min-w-[180px]" />
        ) : (
          <button onClick={() => setEditName(true)} className="flex items-center gap-1.5 group">
            <span className="font-bold text-base text-gray-900 group-hover:text-indigo-600 transition-colors">
              {flow?.name ?? 'Unnamed Flow'}
            </span>
            <Pencil size={12} className="text-gray-300 group-hover:text-indigo-400" />
          </button>
        )}

        <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500 font-medium">
          {activeChecks}/{dbChecks.length} checks active
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button onClick={openTypePicker}
            className="flex items-center gap-2 px-4 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors">
            <Plus size={15} /> Add Check
          </button>
          <button onClick={() => navigate(`/rules/run?flowId=${flowId}`)}
            className="flex items-center gap-2 px-4 py-1.5 rounded border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-sm font-semibold transition-colors">
            <Play size={13} fill="currentColor" /> Test Run
          </button>
        </div>
      </div>

      {/* ── Full-width canvas ── */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onNodeDragStop={onNodeDragStop}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          deleteKeyCode={null}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant="dots" color="#d1d5db" gap={20} size={1.5} />
          <Controls showInteractive={false} className="!bg-white !border-gray-200 !shadow-sm !rounded" />
          <MiniMap
            nodeColor={(n) => {
              if (n.type === 'triggerNode') return '#6366f1';
              if (n.type === 'endNode') return '#22c55e';
              return STRATEGY_META[n.data?.strategy_type]?.accent ?? '#6366f1';
            }}
            className="!bg-white !border-gray-200 !rounded !shadow-sm"
            maskColor="rgba(243,244,246,0.6)"
          />

          {dbChecks.length === 0 && (
            <Panel position="top-center">
              <div className="mt-16 text-center bg-white border border-dashed border-gray-300 rounded px-12 py-10">
                <div className="w-10 h-10 rounded bg-indigo-50 flex items-center justify-center mx-auto mb-3">
                  <GitBranch size={18} className="text-indigo-400" />
                </div>
                <div className="text-sm font-semibold text-gray-700 mb-1">No checks yet</div>
                <div className="text-xs text-gray-400 mb-4 max-w-xs">
                  Build your validation pipeline by adding checks.
                </div>
                <button onClick={openTypePicker}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors">
                  <Plus size={12} /> Add First Check
                </button>
              </div>
            </Panel>
          )}

          <Panel position="bottom-right"
            className="text-xs text-gray-400 bg-white border border-gray-200 rounded px-2.5 py-1">
            Click to edit · Drag to rearrange
          </Panel>
        </ReactFlow>
      </div>

      {/* ── Modals ── */}
      <AnimatePresence>
        {modal && (
          <ModalOverlay onClose={() => setModal(null)}>
            {modal.mode === 'typePicker' && (
              <CheckTypePicker onSelect={selectType} onSelectQuick={selectQuickRule} onClose={() => setModal(null)} />
            )}
            {modal.mode === 'editor' && (
              <CheckEditor
                check={modal.checkData}
                isNew={modal.isNew}
                onSave={handleModalSave}
                onDelete={handleModalDelete}
                onClose={() => setModal(null)}
              />
            )}
          </ModalOverlay>
        )}
      </AnimatePresence>
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
