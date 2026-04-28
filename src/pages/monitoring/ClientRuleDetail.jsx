import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import {
  fetchClientRule,
  fetchClientRulesTemplate,
  saveClientRule,
  fmtDate,
} from '../../api/dkmBrainApi';
import {
  ArrowLeft, Save, Loader2, Check, AlertTriangle, ShieldCheck,
  Globe, Mail, Tag, FileCode2, Plus, X, GripVertical, RefreshCw, Cpu,
  BookOpen, ListChecks, AlertCircle, Link2, Flag, Route, UserRound
} from 'lucide-react';
import {
  getClientRoute,
  getClientRulesStateMeta,
  getClientSignals,
  getSourceLinks,
  isDraftClientRules,
  toArray,
  toExternalDomains,
  toVisibleSenderNames,
} from './clientContract';

// ─── helpers ────────────────────────────────────────────────────────────────
function prettyJson(value, fallback = []) {
  return JSON.stringify(value ?? fallback, null, 2);
}

function parseJsonField(label, text, fallback = []) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return fallback;
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
}

function getInstructionText(rule) {
  if (typeof rule?.instruction_text === 'string') return rule.instruction_text;
  return toArray(rule?.instructions).join('\n');
}

function asInputValue(value) {
  return value === undefined || value === null ? '' : String(value);
}

function parseOptionalNumberField(label, rawValue) {
  const trimmed = String(rawValue ?? '').trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a number.`);
  }
  return parsed;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJsonObject(value) {
  return isPlainObject(value) ? JSON.parse(JSON.stringify(value)) : {};
}

// ─── TagsInput ───────────────────────────────────────────────────────────────
const TagsInput = ({ values, onChange, placeholder, mono = false }) => {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft('');
  };
  const remove = i => onChange(values.filter((_, idx) => idx !== i));
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-2 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-50 transition min-h-[44px]">
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {values.map((v, i) => (
          <span key={i}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border
              bg-indigo-50 text-indigo-800 border-indigo-200 ${mono ? 'font-mono' : ''}`}>
            {v}
            <button type="button" onClick={() => remove(i)} className="text-indigo-400 hover:text-red-500 transition">
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); } }}
          placeholder={placeholder}
          className={`flex-1 text-sm outline-none placeholder-gray-400 bg-transparent ${mono ? 'font-mono' : ''}`}
        />
        {draft && (
          <button type="button" onClick={commit}
            className="text-xs bg-indigo-600 text-white px-2 py-0.5 rounded hover:bg-indigo-700 transition font-medium">
            Add
          </button>
        )}
      </div>
    </div>
  );
};

// ─── Instructions list editor ────────────────────────────────────────────────
const InstructionEditor = ({ items, onChange }) => {
  const [newLine, setNewLine] = useState('');
  const update = (i, val) => { const a = [...items]; a[i] = val; onChange(a); };
  const remove = i => onChange(items.filter((_, idx) => idx !== i));
  const add = () => {
    const v = newLine.trim();
    if (v) { onChange([...items, v]); setNewLine(''); }
  };
  return (
    <div className="space-y-2">
      {items.map((line, i) => (
        <div key={i} className="flex items-start gap-2 group">
          <GripVertical size={14} className="text-gray-300 mt-2.5 shrink-0" />
          <div className="flex-1 relative">
            <textarea
              value={line}
              onChange={e => update(i, e.target.value)}
              rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white
                outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50 transition resize-none leading-snug"
            />
          </div>
          <button onClick={() => remove(i)}
            className="mt-2.5 text-gray-300 hover:text-red-400 transition shrink-0">
            <X size={14} />
          </button>
        </div>
      ))}
      <div className="flex gap-2 mt-3">
        <textarea
          value={newLine}
          onChange={e => setNewLine(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); add(); } }}
          placeholder="Add new instruction line… (Enter to add)"
          rows={2}
          className="flex-1 border border-dashed border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white
            outline-none focus:border-indigo-400 resize-none placeholder-gray-400 transition"
        />
        <button onClick={add}
          className="self-start mt-1 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium flex items-center gap-1 transition shrink-0">
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
};

// ─── Section wrapper ─────────────────────────────────────────────────────────
void InstructionEditor;

const Section = ({ icon: Icon, color = 'indigo', title, subtitle, children }) => {
  const colors = {
    indigo:  { bar: 'from-indigo-600 to-indigo-500',   border: 'border-l-indigo-500'  },
    emerald: { bar: 'from-emerald-600 to-emerald-500', border: 'border-l-emerald-500' },
    amber:   { bar: 'from-amber-500 to-amber-400',     border: 'border-l-amber-500'   },
    blue:    { bar: 'from-blue-600 to-blue-500',       border: 'border-l-blue-500'    },
    violet:  { bar: 'from-violet-600 to-violet-500',   border: 'border-l-violet-500'  },
  };
  const c = colors[color] ?? colors.indigo;
  return (
    <div className={`bg-white rounded-2xl border border-gray-100 border-l-4 ${c.border} shadow-sm overflow-hidden`}>
      <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3 bg-gray-50/50">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-gradient-to-br ${c.bar}`}>
          {React.createElement(Icon, { size: 15, className: 'text-white' })}
        </div>
        <div>
          <div className="font-semibold text-sm text-gray-900">{title}</div>
          {subtitle && <div className="text-xs text-gray-400 mt-0.5">{subtitle}</div>}
        </div>
      </div>
      <div className="p-5 space-y-5">{children}</div>
    </div>
  );
};

// ─── Field wrapper ───────────────────────────────────────────────────────────
const Field = ({ label, hint, children }) => (
  <div className="flex flex-col gap-1.5">
    <div className="flex items-center justify-between gap-4">
      <label className="text-xs font-semibold text-gray-700 shrink-0">{label}</label>
      {hint && <span className="text-[11px] text-gray-400 text-right leading-tight">{hint}</span>}
    </div>
    {children}
  </div>
);

// ─── ReadOnly field ──────────────────────────────────────────────────────────
const ReadOnly = ({ label, value }) => (
  <div className="flex flex-col gap-1">
    <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</span>
    <span className="text-sm text-gray-700 font-medium font-mono bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 break-all">
      {value || '—'}
    </span>
  </div>
);

// ─── Select input ────────────────────────────────────────────────────────────
const SelectInput = ({ value, onChange, options, placeholder }) => (
  <select
    value={value ?? ''}
    onChange={e => onChange(e.target.value)}
    className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white
      outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50 transition w-full"
  >
    {placeholder && <option value="">{placeholder}</option>}
    {options.map(o => (
      <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
    ))}
  </select>
);

// ─── Text input ──────────────────────────────────────────────────────────────
const TextInput = ({ value, onChange, placeholder, mono }) => (
  <input
    type="text"
    value={value ?? ''}
    onChange={e => onChange(e.target.value)}
    placeholder={placeholder}
    className={`border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white
      outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50 transition w-full
      ${mono ? 'font-mono' : ''}`}
  />
);

const TextAreaInput = ({ value, onChange, placeholder, rows = 6, mono = false }) => (
  <textarea
    value={value ?? ''}
    onChange={e => onChange(e.target.value)}
    placeholder={placeholder}
    rows={rows}
    className={`w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900
      outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50 transition resize-none
      ${mono ? 'font-mono leading-relaxed' : ''}`}
  />
);

const REGIME_OPTIONS = [
  { value: 'export', label: 'Export' },
  { value: 'import', label: 'Import' },
  { value: 'transit', label: 'Transit' },
  { value: 'T1', label: 'T1 (Transit)' },
  { value: 'T2', label: 'T2 (Transit)' },
  { value: 'EX', label: 'EX (Export)' },
  { value: 'IM', label: 'IM (Import)' },
  { value: 'intrastat', label: 'Intrastat' },
];

const RULE_STATE_OPTIONS = [
  { value: 'runtime_profile', label: 'Verified by user' },
  { value: 'draft_from_observed_domain', label: 'AI detected - not verified' },
];

const HUMAN_INSTRUCTIONS_PRIORITY_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const LLM_POLICY_COMPLEXITY_FIELDS = [
  { key: 'attachment_count_threshold', label: 'Attachment count threshold' },
  { key: 'approved_attachment_count_threshold', label: 'Approved attachment threshold' },
  { key: 'email_chars_threshold', label: 'Email chars threshold' },
  { key: 'segment_pages_threshold', label: 'Segment pages threshold' },
  { key: 'segment_text_chars_threshold', label: 'Segment text chars threshold' },
  { key: 'resolver_gap_count_threshold', label: 'Resolver gap count threshold' },
  { key: 'resolver_item_count_threshold', label: 'Resolver item count threshold' },
];

const LLM_POLICY_STAGE_FIELDS = [
  { key: 'model', label: 'Model', type: 'text', placeholder: 'Use backend default model' },
  { key: 'reasoning_effort', label: 'Reasoning effort', type: 'text', placeholder: 'e.g. low, medium, high' },
  { key: 'verbosity', label: 'Verbosity', type: 'text', placeholder: 'e.g. low, medium, high' },
  { key: 'max_output_tokens', label: 'Max output tokens', type: 'number', placeholder: 'Use default token limit' },
  { key: 'retry_max_output_tokens', label: 'Retry max output tokens', type: 'number', placeholder: 'Use default retry limit' },
  { key: 'prompt_cache_retention', label: 'Prompt cache retention', type: 'text', placeholder: 'Use backend default retention' },
];

const LLM_POLICY_STAGES = [
  { key: 'labeler', label: 'Labeler', description: 'Classifies the incoming file and routes the next stage.' },
  { key: 'extractor', label: 'Extractor', description: 'Handles main document extraction for the client.' },
  { key: 'critic', label: 'Critic', description: 'Reviews extraction quality and catches missing evidence.' },
  { key: 'resolver', label: 'Resolver', description: 'Fixes gaps, ambiguities, and unresolved line-item issues.' },
  { key: 'simple', label: 'Simple', description: 'Shortcut path for straightforward files and low-complexity traffic.' },
];

function createEmptyComplexityThresholds() {
  return Object.fromEntries(LLM_POLICY_COMPLEXITY_FIELDS.map((field) => [field.key, '']));
}

function createEmptyStageRoutingState() {
  return Object.fromEntries(
    LLM_POLICY_STAGES.map((stage) => [
      stage.key,
      {
        standard: Object.fromEntries(LLM_POLICY_STAGE_FIELDS.map((field) => [field.key, ''])),
        complex: Object.fromEntries(LLM_POLICY_STAGE_FIELDS.map((field) => [field.key, ''])),
      },
    ])
  );
}

function summarizeAiSettings(record = {}) {
  const llmPolicy = isPlainObject(record.llm_policy) ? record.llm_policy : {};
  const configuredComplexityCount = LLM_POLICY_COMPLEXITY_FIELDS.filter((field) => {
    const value = llmPolicy.complexity?.[field.key];
    return value !== undefined && value !== null && String(value).trim() !== '';
  }).length;

  const configuredRouteCount = LLM_POLICY_STAGES.reduce((count, stage) => {
    return count + ['standard', 'complex'].filter((mode) => {
      const route = llmPolicy?.[stage.key]?.[mode];
      return isPlainObject(route) && Object.keys(route).length > 0;
    }).length;
  }, 0);

  const models = [...new Set(
    LLM_POLICY_STAGES.flatMap((stage) => ['standard', 'complex']
      .map((mode) => llmPolicy?.[stage.key]?.[mode]?.model)
      .filter(Boolean))
  )];

  return {
    priority: record.human_instructions_priority || '',
    configuredComplexityCount,
    configuredRouteCount,
    models,
  };
}

// ─── Main component ──────────────────────────────────────────────────────────
const ClientRuleDetail = () => {
  const { client_key: rawClientKey } = useParams();
  const requestedClientKey = decodeURIComponent(rawClientKey || '');
  const isNewRule = requestedClientKey === 'new';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: rule, isLoading, error } = useQuery({
    queryKey: isNewRule ? ['client-rule-template'] : ['client-rule', requestedClientKey],
    queryFn: () => (isNewRule ? fetchClientRulesTemplate() : fetchClientRule(requestedClientKey)),
    staleTime: 0,
    retry: 1,
  });

  // Editable state — only the mutable fields
  const [clientKeyValue, setClientKeyValue] = useState('');
  const [clientIdValue, setClientIdValue] = useState('');
  const [clientNameValue, setClientNameValue] = useState('');
  const [clientLabelValue, setClientLabelValue] = useState('');
  const [primaryDomainValue, setPrimaryDomainValue] = useState('');
  const [ruleState, setRuleState] = useState('runtime_profile');
  const [emailDomains, setEmailDomains] = useState([]);
  const [observedEmailDomains, setObservedEmailDomains] = useState([]);
  const [observedSenderNames, setObservedSenderNames] = useState([]);
  const [defaultRegime, setDefaultRegime] = useState('');
  const [principal, setPrincipal] = useState('');
  const [instructionText, setInstructionText] = useState('');
  const [humanInstructionsPriority, setHumanInstructionsPriority] = useState('');
  const [complexityThresholds, setComplexityThresholds] = useState(createEmptyComplexityThresholds);
  const [stageRouting, setStageRouting] = useState(createEmptyStageRoutingState);
  const [regimeOverrideRulesText, setRegimeOverrideRulesText] = useState('[]');
  const [redFlagsText, setRedFlagsText] = useState('[]');
  const [headerRulesText, setHeaderRulesText] = useState('[]');
  const [itemRulesText, setItemRulesText] = useState('[]');
  const [validationError, setValidationError] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  // Seed from loaded data
  useEffect(() => {
    if (!rule) return;
    const matching = rule.matching || {};
    const inferredRuleState =
      rule.client_rules_status ||
      rule.source_mode ||
      (isNewRule ? 'runtime_profile' : 'draft_from_observed_domain');

    setClientKeyValue(isNewRule ? '' : rule.client_key || requestedClientKey);
    setClientIdValue(rule.client_id || '');
    setClientNameValue(rule.client_name || '');
    setClientLabelValue(rule.client_label || rule.client_name || '');
    setPrimaryDomainValue(rule.primary_domain || '');
    setRuleState(inferredRuleState);
    setEmailDomains(toExternalDomains(matching.email_domains || []));
    setObservedEmailDomains(toExternalDomains(matching.observed_email_domains || []));
    setObservedSenderNames(
      toVisibleSenderNames(matching.observed_sender_names || matching.sender_name_patterns || [])
    );
    setDefaultRegime(rule.default_regime || '');
    setPrincipal(rule.principal || '');
    setInstructionText(getInstructionText(rule));
    setHumanInstructionsPriority(asInputValue(rule.human_instructions_priority));
    const nextComplexityThresholds = createEmptyComplexityThresholds();
    LLM_POLICY_COMPLEXITY_FIELDS.forEach((field) => {
      nextComplexityThresholds[field.key] = asInputValue(rule.llm_policy?.complexity?.[field.key]);
    });
    setComplexityThresholds(nextComplexityThresholds);

    const nextStageRouting = createEmptyStageRoutingState();
    LLM_POLICY_STAGES.forEach((stage) => {
      ['standard', 'complex'].forEach((mode) => {
        LLM_POLICY_STAGE_FIELDS.forEach((field) => {
          nextStageRouting[stage.key][mode][field.key] = asInputValue(
            rule.llm_policy?.[stage.key]?.[mode]?.[field.key]
          );
        });
      });
    });
    setStageRouting(nextStageRouting);
    setRegimeOverrideRulesText(prettyJson(rule.regime_override_rules, []));
    setRedFlagsText(prettyJson(rule.red_flags, []));
    setHeaderRulesText(prettyJson(rule.header_rules ?? rule.mandatory_header_fields, []));
    setItemRulesText(prettyJson(rule.item_rules ?? rule.mandatory_item_fields, []));
    setValidationError('');
    setIsDirty(false);
  }, [isNewRule, requestedClientKey, rule]);

  const track = (setter) => (value) => {
    setter(value);
    setIsDirty(true);
  };

  const updateComplexityThreshold = (fieldKey, value) => {
    setComplexityThresholds((previous) => ({
      ...previous,
      [fieldKey]: value,
    }));
    setIsDirty(true);
  };

  const updateStageRoutingField = (stageKey, modeKey, fieldKey, value) => {
    setStageRouting((previous) => ({
      ...previous,
      [stageKey]: {
        ...previous[stageKey],
        [modeKey]: {
          ...previous[stageKey][modeKey],
          [fieldKey]: value,
        },
      },
    }));
    setIsDirty(true);
  };

  const buildPayload = () => {
    if (!rule) throw new Error('Rule payload is not loaded yet.');

    const nextClientKey = String(clientKeyValue || '').trim();
    if (!nextClientKey) throw new Error('Client key is required.');

    const nextEmailDomains = toExternalDomains(emailDomains);
    const nextObservedDomains = toExternalDomains(observedEmailDomains);
    const nextObservedNames = toVisibleSenderNames(observedSenderNames);
    const preferredPrimaryDomain =
      toExternalDomains([primaryDomainValue, ...nextEmailDomains, ...nextObservedDomains])[0] ||
      String(primaryDomainValue || '').trim();
    const nextHumanInstructionsPriority = String(humanInstructionsPriority || '').trim();
    if (
      nextHumanInstructionsPriority &&
      !HUMAN_INSTRUCTIONS_PRIORITY_OPTIONS.some((option) => option.value === nextHumanInstructionsPriority)
    ) {
      throw new Error('Prompt priority must be normal, high, or critical.');
    }

    const nextLlmPolicy = cloneJsonObject(rule.llm_policy);
    const nextComplexity = isPlainObject(nextLlmPolicy.complexity) ? { ...nextLlmPolicy.complexity } : {};
    LLM_POLICY_COMPLEXITY_FIELDS.forEach((field) => {
      const parsed = parseOptionalNumberField(field.label, complexityThresholds[field.key]);
      if (parsed === undefined) delete nextComplexity[field.key];
      else nextComplexity[field.key] = parsed;
    });
    if (Object.keys(nextComplexity).length > 0) nextLlmPolicy.complexity = nextComplexity;
    else delete nextLlmPolicy.complexity;

    LLM_POLICY_STAGES.forEach((stage) => {
      const nextStage = isPlainObject(nextLlmPolicy[stage.key]) ? { ...nextLlmPolicy[stage.key] } : {};

      ['standard', 'complex'].forEach((mode) => {
        const nextRoute = isPlainObject(nextStage[mode]) ? { ...nextStage[mode] } : {};

        LLM_POLICY_STAGE_FIELDS.forEach((field) => {
          const rawValue = stageRouting?.[stage.key]?.[mode]?.[field.key] ?? '';
          if (field.type === 'number') {
            const parsed = parseOptionalNumberField(`${stage.label} ${mode} ${field.label}`, rawValue);
            if (parsed === undefined) delete nextRoute[field.key];
            else nextRoute[field.key] = parsed;
            return;
          }

          const trimmed = String(rawValue || '').trim();
          if (!trimmed) delete nextRoute[field.key];
          else nextRoute[field.key] = trimmed;
        });

        if (Object.keys(nextRoute).length > 0) nextStage[mode] = nextRoute;
        else delete nextStage[mode];
      });

      if (Object.keys(nextStage).length > 0) nextLlmPolicy[stage.key] = nextStage;
      else delete nextLlmPolicy[stage.key];
    });

    const payload = {
      ...rule,
      client_key: nextClientKey,
      client_id: String(clientIdValue || '').trim(),
      client_name: String(clientNameValue || '').trim(),
      client_label: String(clientLabelValue || '').trim() || String(clientNameValue || '').trim(),
      primary_domain: preferredPrimaryDomain,
      source_mode: ruleState,
      client_rules_status: ruleState,
      matching: {
        ...(rule.matching || {}),
        email_domains: nextEmailDomains,
        observed_email_domains: nextObservedDomains,
        observed_sender_names: nextObservedNames,
      },
      default_regime: defaultRegime,
      principal: String(principal || '').trim(),
      instruction_text: String(instructionText || '').trim(),
      human_instructions_priority: nextHumanInstructionsPriority,
      llm_policy: nextLlmPolicy,
      regime_override_rules: parseJsonField('Regime override rules', regimeOverrideRulesText, []),
      red_flags: parseJsonField('Red flags', redFlagsText, []),
      header_rules: parseJsonField('Header rules', headerRulesText, []),
      item_rules: parseJsonField('Item rules', itemRulesText, []),
    };

    if (ruleState === 'runtime_profile') {
      if (user?.name) payload.verified_by_name = String(user.name).trim();
      if (user?.email) payload.verified_by_email = String(user.email).trim();
      payload.verified_at = new Date().toISOString();
    } else {
      delete payload.verified_by_name;
      delete payload.verified_by_email;
      delete payload.verified_at;
    }

    if (!payload.human_instructions_priority) delete payload.human_instructions_priority;
    if (!Object.keys(nextLlmPolicy).length) delete payload.llm_policy;

    delete payload.instructions;
    delete payload.mandatory_header_fields;
    delete payload.mandatory_item_fields;
    if (payload.matching) delete payload.matching.sender_name_patterns;

    return payload;
  };

  const saveMutation = useMutation({
    mutationFn: (payload) => saveClientRule(payload.client_key, payload),
    onSuccess: (_, payload) => {
      queryClient.invalidateQueries({ queryKey: ['client-rules-index'] });
      queryClient.invalidateQueries({ queryKey: ['brain-clients'] });
      queryClient.invalidateQueries({ queryKey: ['brain-client', payload.client_key] });
      queryClient.invalidateQueries({ queryKey: ['client-rule', payload.client_key] });
      setValidationError('');
      setIsDirty(false);

      if (payload.client_key !== requestedClientKey) {
        navigate(`/monitoring/brain/client-rules/${encodeURIComponent(payload.client_key)}`, {
          replace: true,
        });
      }
    },
  });

  // Payload validation
  const previewLegacy = (() => {
    if (!rule) return '# loading…';
    return '# legacy preview removed';
    /*
    const lines = [
      `# Client Profile — ${rule.client_key}`,
      `client_key: "${rule.client_key}"`,
      `client_id: "${rule.client_id ?? ''}"`,
      `default_regime: "${defaultRegime}"`,
      `principal: "${principal}"`,
      '',
      'matching:',
      ...arrYaml('  email_domains', emailDomains, '    '),
      ...arrYaml('  sender_name_patterns', senderPatterns, '    '),
      '',
      ...arrYaml('mandatory_header_fields', mandatoryHeader),
      ...arrYaml('mandatory_item_fields', mandatoryItem),
      '',
      instructions.length ? 'instructions:' : '',
      ...instructions.map(i => `  - "${i.replace(/"/g, "'")}"`),
    ].filter(l => l !== undefined);
    return lines.join('\n');
    */
  })();

  void previewLegacy;

  const preview = (() => {
    if (!rule) {
      return { payload: null, text: '{\n  "status": "loading"\n}', error: null };
    }
    try {
      const payload = buildPayload();
      return { payload, text: JSON.stringify(payload, null, 2), error: null };
    } catch (buildError) {
      return { payload: null, text: '', error: buildError.message };
    }
  })();

  const viewRecord =
    preview.payload ||
    rule || {
      source_mode: ruleState,
      client_rules_status: ruleState,
      matching: {},
    };
  const stateMeta = getClientRulesStateMeta(viewRecord);
  const signals = getClientSignals(viewRecord);
  const sourceLinks = getSourceLinks(viewRecord);
  const displayLinks = sourceLinks.length
    ? sourceLinks
    : [{ label: 'Client rules', path: clientKeyValue ? `dashboard/clients_rules/${clientKeyValue}.json` : null }].filter(entry => entry.path);
  const clientDashboardRoute = !isNewRule ? getClientRoute(viewRecord) : null;
  const isDraft = isDraftClientRules(viewRecord);
  const aiSettingsSummary = summarizeAiSettings(viewRecord);
  const verifiedByName = String(
    viewRecord.verified_by_name ||
    viewRecord.verified_by ||
    viewRecord.verified_by_user_name ||
    ''
  ).trim();
  const verifiedByEmail = String(
    viewRecord.verified_by_email ||
    viewRecord.verified_by_user_email ||
    ''
  ).trim();
  const verifiedAt = viewRecord.verified_at || viewRecord.verified_on || null;

  const handleSave = () => {
    try {
      const payload = buildPayload();
      setValidationError('');
      saveMutation.mutate(payload);
    } catch (buildError) {
      setValidationError(buildError.message);
    }
  };

  if (isLoading) return (
    <div className="min-h-[60vh] flex items-center justify-center text-gray-400 text-sm animate-pulse">
      Loading client configuration…
    </div>
  );
  if (error) return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center">
        <AlertCircle size={40} className="text-red-400 mx-auto mb-3" />
        <p className="text-red-500 font-medium">{error.message}</p>
        <button onClick={() => navigate(-1)} className="mt-4 text-sm text-gray-500 hover:text-gray-700 underline">Go back</button>
      </div>
    </div>
  );
  if (!rule) return null;

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Sticky header ─────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex items-center justify-between px-6 py-3 gap-4">
          {/* Back */}
          <button onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition shrink-0">
            <ArrowLeft size={15} /> Back
          </button>

          {/* Identity */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-gray-900 text-sm truncate">
                {isNewRule ? 'New client rule' : clientLabelValue || clientNameValue || clientKeyValue}
              </span>
              {clientIdValue && (
                <code className="text-[11px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-mono">
                  {clientIdValue}
                </code>
              )}
              <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${stateMeta.subtleColor}`}>
                {isDraft ? <><AlertTriangle size={9} className="inline mr-1" />AI Detected</> : <><ShieldCheck size={9} className="inline mr-1" />Verified</>}
              </span>
              {isDirty && (
                <span className="text-[10px] text-amber-600 font-medium flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" /> Unsaved changes
                </span>
              )}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">
              {signals.primarySignal ? `${signals.primarySignal} · ` : ''}
              {isDraft
                ? 'AI detected, waiting for user verification'
                : verifiedByName
                  ? `Verified by ${verifiedByName}${verifiedAt ? ` on ${fmtDate(verifiedAt)}` : ''}`
                  : 'Verified rule'}
            </div>
          </div>

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending || !isDirty || Boolean(preview.error)}
            className={`flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl text-white shadow-sm transition shrink-0 ${
              saveMutation.isSuccess && !isDirty
                ? 'bg-emerald-600'
                : isDirty && !preview.error
                  ? 'bg-indigo-600 hover:bg-indigo-700'
                  : 'bg-gray-300 cursor-not-allowed'
            } disabled:opacity-70`}
          >
            {saveMutation.isPending ? <Loader2 size={15} className="animate-spin" /> :
             (saveMutation.isSuccess && !isDirty) ? <Check size={15} /> : <Save size={15} />}
            {saveMutation.isPending ? 'Saving...' : (saveMutation.isSuccess && !isDirty) ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>

      {/* ── Save error ─────────────────────────────────────────── */}
      {(validationError || preview.error || saveMutation.isError) && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl flex items-center gap-2">
          <AlertTriangle size={15} /> {validationError || preview.error || saveMutation.error?.message}
        </div>
      )}

      {/* ── Draft banner ───────────────────────────────────────── */}
      {isDraft && (
        <div className="mx-6 mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 flex items-start gap-3">
          <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-500" />
          <span>
            <strong>This rule was detected by AI and is not verified yet.</strong> Confirm the external sender signals,
            complete the editable settings below, and switch the status to
            <code className="mx-1 rounded bg-white px-1 py-0.5 font-mono text-[11px]">runtime_profile</code>
            when a signed-in user has verified it.
          </span>
        </div>
      )}

      {/* ── Body ───────────────────────────────────────────────── */}
      <div className="flex flex-col xl:flex-row gap-6 p-6">

        {/* ── LEFT: editable config ────────────────────────────── */}
        <div className="flex-1 space-y-6 min-w-0">

          <Section
            icon={Tag}
            color="blue"
            title="Client Identity"
            subtitle={isNewRule ? 'Define the JSON identity for the new rule' : 'Core identifiers from dashboard/clients_rules/*.json'}
          >
            {isNewRule ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <Field label="Client Key" hint="Used as the JSON filename under dashboard/clients_rules/">
                  <TextInput value={clientKeyValue} onChange={track(setClientKeyValue)} placeholder="e.g. dpworld" mono />
                </Field>
                <Field label="Client ID" hint="Optional backend identifier">
                  <TextInput value={clientIdValue} onChange={track(setClientIdValue)} placeholder="e.g. 1234" />
                </Field>
                <Field label="Client Name">
                  <TextInput value={clientNameValue} onChange={track(setClientNameValue)} placeholder="e.g. DP World" />
                </Field>
                <Field label="Client Label" hint="Display name used in cards and lists">
                  <TextInput value={clientLabelValue} onChange={track(setClientLabelValue)} placeholder="e.g. DP World Logistics" />
                </Field>
                <Field label="Primary Domain" hint="Prefer the external sender domain, not any DKM forwarding alias">
                  <TextInput value={primaryDomainValue} onChange={track(setPrimaryDomainValue)} placeholder="e.g. dpworld.com" mono />
                </Field>
                <Field label="Rules Status" hint="AI-detected rules can be marked as verified here">
                  <SelectInput value={ruleState} onChange={track(setRuleState)} options={RULE_STATE_OPTIONS} />
                </Field>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <ReadOnly label="Client Key" value={clientKeyValue} />
                <ReadOnly label="Client ID" value={clientIdValue} />
                <ReadOnly label="Client Name" value={clientNameValue} />
                <ReadOnly label="Client Label" value={clientLabelValue} />
                <ReadOnly label="Primary Domain" value={primaryDomainValue} />
              </div>
            )}
          </Section>

          {/* Email matching */}
          <Section icon={Mail} color="indigo" title="Client Identification"
            subtitle="External sender domains and sender names drive matching. Internal @dkm-customs.com forwarding hops stay hidden.">
            <Field label="Recognized Email Domains"
              hint="Domains actively used to match this client">
              <TagsInput
                values={emailDomains}
                onChange={track(setEmailDomains)}
                placeholder="Type a domain and press Enter — e.g. dpworld.com"
                mono
              />
            </Field>
            <Field label="Observed External Sender Domains"
              hint="Observed sender evidence from traffic, excluding forwarding aliases">
              <TagsInput
                values={observedEmailDomains}
                onChange={track(setObservedEmailDomains)}
                placeholder="Type a domain and press Enter"
                mono
              />
            </Field>
            <Field label="Observed Sender Names"
              hint="Human-readable sender names that repeatedly identify this client">
              <TagsInput
                values={observedSenderNames}
                onChange={track(setObservedSenderNames)}
                placeholder="Type a sender name and press Enter"
              />
            </Field>
            <Field label="External Signal Summary">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                <div className="font-medium">{signals.primarySignal || 'No external sender signal captured yet'}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {signals.observedEmailDomains.map(domain => (
                    <span key={domain} className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[11px] font-mono text-blue-700">
                      {domain}
                    </span>
                  ))}
                  {signals.observedSenderNames.map(name => (
                    <span key={name} className="rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                      {name}
                    </span>
                  ))}
                  {!signals.observedEmailDomains.length && !signals.observedSenderNames.length && (
                    <span className="text-xs text-slate-400">No external sender signals yet</span>
                  )}
                </div>
                {signals.hiddenForwardingDomainCount > 0 && (
                  <div className="mt-2 text-xs text-slate-500">
                    {signals.hiddenForwardingDomainCount} internal forwarding hop{signals.hiddenForwardingDomainCount > 1 ? 's' : ''} hidden
                  </div>
                )}
              </div>
            </Field>
          </Section>

          {/* Regime & principal */}
          <Section icon={Globe} color="emerald" title="Customs Setup"
            subtitle="Primary customs fields plus any regime-specific JSON overrides">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {!isNewRule && (
                <Field label="Rules Status"
                  hint="Mark AI-detected rules as verified here">
                  <SelectInput
                    value={ruleState}
                    onChange={track(setRuleState)}
                    options={RULE_STATE_OPTIONS}
                  />
                </Field>
              )}
              <Field label="Default Regime">
                <SelectInput
                  value={defaultRegime}
                  onChange={track(setDefaultRegime)}
                  placeholder="Select regime..."
                  options={REGIME_OPTIONS}
                />
              </Field>
              <Field label="Principal"
                hint="The legal entity name declared as the principal/exporter">
                <TextInput
                  value={principal}
                  onChange={track(setPrincipal)}
                  placeholder="e.g. DUPON"
                />
              </Field>
            </div>
            <Field label="Regime Override Rules"
              hint="JSON rules for exceptions or regime-specific branching">
              <TextAreaInput
                value={regimeOverrideRulesText}
                onChange={track(setRegimeOverrideRulesText)}
                placeholder="[]"
                rows={8}
                mono
              />
            </Field>
          </Section>

          <Section
            icon={Cpu}
            color="violet"
            title="Advanced AI Settings"
            subtitle="Editable SaaS configuration for prompt priority, complexity thresholds, and stage routing. Leave fields empty to fall back to backend defaults."
          >
            <div className="rounded-xl border border-violet-100 bg-violet-50 px-4 py-3 text-sm text-violet-900">
              <div className="font-semibold">Standard vs complex routing</div>
              <div className="mt-1 text-xs leading-relaxed text-violet-700">
                Standard settings apply to normal files. Complex settings override the route for harder files
                that cross the configured complexity thresholds below.
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,280px),minmax(0,1fr)]">
              <Field
                label="Prompt Priority"
                hint="How strongly client instructions should be prioritized in prompts"
              >
                <SelectInput
                  value={humanInstructionsPriority}
                  onChange={track(setHumanInstructionsPriority)}
                  options={HUMAN_INSTRUCTIONS_PRIORITY_OPTIONS}
                  placeholder="Use backend default priority"
                />
              </Field>

              <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
                Empty values are preserved as unset so the backend can continue falling back to defaults.
                Existing unknown `llm_policy` keys are retained when you save.
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Complexity Thresholds</h3>
                <p className="mt-1 text-xs text-gray-500">
                  These thresholds decide when a file should switch from the standard route to the complex route.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {LLM_POLICY_COMPLEXITY_FIELDS.map((field) => (
                  <Field
                    key={field.key}
                    label={field.label}
                    hint="Leave empty to inherit backend fallback"
                  >
                    <TextInput
                      value={complexityThresholds[field.key]}
                      onChange={(value) => updateComplexityThreshold(field.key, value)}
                      placeholder="Use default threshold"
                      mono
                    />
                  </Field>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Stage Routing</h3>
                <p className="mt-1 text-xs text-gray-500">
                  Configure each stage separately for standard files and for complex files.
                </p>
              </div>

              <div className="space-y-4">
                {LLM_POLICY_STAGES.map((stage) => (
                  <div key={stage.key} className="rounded-2xl border border-gray-200 bg-gray-50/60 p-4">
                    <div className="mb-4 flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
                      <div>
                        <h4 className="text-sm font-semibold text-gray-900">{stage.label}</h4>
                        <p className="text-xs text-gray-500">{stage.description}</p>
                      </div>
                      <code className="text-[11px] text-gray-400">{`llm_policy.${stage.key}`}</code>
                    </div>

                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                      {['standard', 'complex'].map((mode) => (
                        <div key={mode} className="rounded-xl border border-white bg-white p-4 shadow-sm">
                          <div className="mb-4 flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-gray-900">
                                {mode === 'standard' ? 'Standard' : 'Complex'}
                              </div>
                              <div className="text-xs text-gray-500">
                                {mode === 'standard'
                                  ? 'Normal files follow this route.'
                                  : 'Harder files follow this route after threshold escalation.'}
                              </div>
                            </div>
                            <code className="text-[11px] text-gray-400">{mode}</code>
                          </div>

                          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            {LLM_POLICY_STAGE_FIELDS.map((field) => (
                              <Field
                                key={`${stage.key}-${mode}-${field.key}`}
                                label={field.label}
                                hint="Leave empty to inherit backend fallback"
                              >
                                <TextInput
                                  value={stageRouting?.[stage.key]?.[mode]?.[field.key] ?? ''}
                                  onChange={(value) => updateStageRoutingField(stage.key, mode, field.key, value)}
                                  placeholder={field.placeholder}
                                  mono={field.type === 'number' || field.key === 'model'}
                                />
                              </Field>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Section>

          {/* Mandatory fields */}
          <Section icon={Flag} color="violet" title="Red Flags"
            subtitle="Fields that the AI extraction must resolve — any missing field will trigger a review">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field label="Red Flags"
                hint="Provide any array or object shape required by the backend contract">
                <TextAreaInput
                  value={redFlagsText}
                  onChange={track(setRedFlagsText)}
                  placeholder="[]"
                  rows={8}
                  mono
                />
              </Field>
              <Field label="Header Rules"
                hint="Header-level rules such as required references or party fields">
                <TextAreaInput
                  value={headerRulesText}
                  onChange={track(setHeaderRulesText)}
                  placeholder="[]"
                  rows={10}
                  mono
                />
              </Field>
              <Field label="Item Rules"
                hint="Line-item rules such as commodity, origin, or quantity checks">
                <TextAreaInput
                  value={itemRulesText}
                  onChange={track(setItemRulesText)}
                  placeholder="[]"
                  rows={10}
                  mono
                />
              </Field>
            </div>
          </Section>

          <Section icon={BookOpen} color="amber" title="Instruction Text"
            subtitle="Plain-language extraction guidance carried in the JSON contract">
            <Field
              label="Instruction Text"
              hint="Keep this specific to the client's documents, terminology, and extraction quirks">
              <TextAreaInput
                value={instructionText}
                onChange={track(setInstructionText)}
                placeholder="Explain how this client's documents should be interpreted..."
                rows={8}
              />
            </Field>
          </Section>
        </div>

        {/* ── RIGHT: JSON preview + meta ─────────────────────────── */}
        <div className="w-full xl:w-[380px] flex flex-col gap-5 shrink-0">

          {/* JSON preview */}
          <div className="hidden rounded-2xl border border-[#1e293b] bg-[#0f172a] shadow-lg overflow-hidden sticky top-[65px]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e293b] bg-[#0f172a]">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <FileCode2 size={14} className="text-indigo-400" />
                Contract Validation
              </div>
              <div className="flex items-center gap-2">
                {preview.error
                  ? <span className="text-[10px] font-medium text-red-300">invalid JSON</span>
                  : isDirty
                    ? <span className="text-[10px] text-amber-400 font-medium flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />modified</span>
                    : <span className="text-[10px] text-emerald-400 flex items-center gap-1"><RefreshCw size={10} className="animate-spin" style={{ animationDuration: '4s' }} />up to date</span>
                }
              </div>
            </div>
            <pre className="p-4 text-[11.5px] font-mono leading-relaxed overflow-x-auto max-h-[70vh] overflow-y-auto
              whitespace-pre text-slate-300 [&>*]:text-emerald-300">
              <code className="text-emerald-300">{preview.error ? `// ${preview.error}` : preview.text}</code>
            </pre>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-xs text-gray-500 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
              <Link2 size={14} className="text-indigo-500" />
              JSON Sources
            </div>
            <div className="space-y-2">
              {displayLinks.map((entry) => (
                <div key={entry.label} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-gray-400">{entry.label}</div>
                  <code className="break-all font-mono text-[11px] text-gray-600">{entry.path}</code>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 border-t border-gray-100 pt-3">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-gray-400">Rules status</div>
                <div className={`mt-1 font-medium ${isDraft ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {stateMeta.label}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-gray-400">Generated</div>
                <div className="mt-1 font-medium text-gray-700">{fmtDate(viewRecord.generated_at)}</div>
              </div>
            </div>
            <div className="border-t border-gray-100 pt-3">
              <div className="text-[11px] uppercase tracking-wide text-gray-400">Verification</div>
              {isDraft ? (
                <div className="mt-1 text-sm font-medium text-amber-700">
                  AI detected. Waiting for a signed-in user to verify this rule.
                </div>
              ) : (
                <div className="mt-1 space-y-1 text-sm text-gray-700">
                  <div className="font-medium">
                    {verifiedByName || verifiedByEmail || 'Verified user not recorded'}
                  </div>
                  {verifiedAt && (
                    <div className="text-xs text-gray-500">
                      Verified on {fmtDate(verifiedAt)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-xs text-gray-500 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
              <Cpu size={14} className="text-violet-500" />
              AI Settings Summary
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-gray-400">Prompt priority</div>
                <div className="mt-1 text-sm font-medium text-gray-700">
                  {aiSettingsSummary.priority || 'Backend default'}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-gray-400">Complexity rules</div>
                <div className="mt-1 text-sm font-medium text-gray-700">
                  {aiSettingsSummary.configuredComplexityCount} configured
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-gray-400">Stage routes</div>
                <div className="mt-1 text-sm font-medium text-gray-700">
                  {aiSettingsSummary.configuredRouteCount} configured
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-gray-400">Models</div>
                <div className="mt-1 text-sm font-medium text-gray-700">
                  {aiSettingsSummary.models.length ? aiSettingsSummary.models.length : 'Fallback only'}
                </div>
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-gray-400">Configured models</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {aiSettingsSummary.models.length > 0 ? (
                  aiSettingsSummary.models.map((model) => (
                    <span key={model} className="rounded-full border border-violet-100 bg-violet-50 px-2 py-0.5 font-mono text-[11px] text-violet-700">
                      {model}
                    </span>
                  ))
                ) : (
                  <span className="text-gray-300">No explicit models configured</span>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-xs text-gray-500 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
              <UserRound size={14} className="text-emerald-500" />
              Identification Summary
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-gray-400">Primary external signal</div>
              <div className="mt-1 text-sm font-medium text-gray-700">{signals.primarySignal || '-'}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-gray-400">Observed sender names</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {signals.observedSenderNames.length > 0 ? (
                  signals.observedSenderNames.map(name => (
                    <span key={name} className="rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                      {name}
                    </span>
                  ))
                ) : (
                  <span className="text-gray-300">No sender names captured</span>
                )}
              </div>
            </div>
          </div>

          {!isNewRule && clientDashboardRoute && (
            <button
              onClick={() => navigate(clientDashboardRoute)}
              className="flex items-center justify-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100"
            >
              <Route size={14} /> Open client dashboard
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClientRuleDetail;
