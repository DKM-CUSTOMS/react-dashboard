import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchClientRule, saveClientRule, fmtDate } from '../../api/dkmBrainApi';
import {
  ArrowLeft, Save, Loader2, Check, AlertTriangle, ShieldCheck,
  Globe, Mail, Tag, FileCode2, Plus, X, GripVertical, RefreshCw,
  BookOpen, ListChecks, AlertCircle
} from 'lucide-react';

// ─── helpers ────────────────────────────────────────────────────────────────
const toArr = v =>
  !v ? [] : Array.isArray(v) ? v.map(String) : String(v).split(',').map(s => s.trim()).filter(Boolean);

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
          <Icon size={15} className="text-white" />
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

// ─── Main component ──────────────────────────────────────────────────────────
const ClientRuleDetail = () => {
  const { client_key } = useParams();
  const navigate       = useNavigate();
  const queryClient    = useQueryClient();

  const { data: rule, isLoading, error } = useQuery({
    queryKey: ['client-rule', client_key],
    queryFn:  () => fetchClientRule(decodeURIComponent(client_key)),
    staleTime: 0,
    retry: 1,
  });

  // Editable state — only the mutable fields
  const [emailDomains,      setEmailDomains]      = useState([]);
  const [senderPatterns,    setSenderPatterns]    = useState([]);
  const [defaultRegime,     setDefaultRegime]     = useState('');
  const [principal,         setPrincipal]         = useState('');
  const [instructions,      setInstructions]      = useState([]);
  const [mandatoryHeader,   setMandatoryHeader]   = useState([]);
  const [mandatoryItem,     setMandatoryItem]     = useState([]);
  const [isDirty,           setIsDirty]           = useState(false);

  // Seed from loaded data
  useEffect(() => {
    if (!rule) return;
    setEmailDomains(toArr(rule.matching?.email_domains));
    setSenderPatterns(toArr(rule.matching?.sender_name_patterns));
    setDefaultRegime(rule.default_regime ?? '');
    setPrincipal(rule.principal ?? '');
    setInstructions(toArr(rule.instructions));
    setMandatoryHeader(toArr(rule.mandatory_header_fields));
    setMandatoryItem(toArr(rule.mandatory_item_fields));
    setIsDirty(false);
  }, [rule]);

  // Mark dirty on any change
  const track = useCallback(fn => (...args) => { fn(...args); setIsDirty(true); }, []);

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        ...rule,
        matching: {
          ...rule.matching,
          email_domains:        emailDomains,
          sender_name_patterns: senderPatterns,
        },
        default_regime:          defaultRegime,
        principal,
        instructions,
        mandatory_header_fields: mandatoryHeader,
        mandatory_item_fields:   mandatoryItem,
      };
      return saveClientRule(decodeURIComponent(client_key), payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['client-rules-index']);
      queryClient.invalidateQueries(['client-rule', client_key]);
      setIsDirty(false);
    },
  });

  // Live YAML preview
  const liveYaml = (() => {
    if (!rule) return '# loading…';
    const arrYaml = (key, vals, indent = '  ') =>
      vals?.length ? [`${key}:`, ...vals.map(v => `${indent}- "${v}"`)] : [];
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
  })();

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

  const isDraft = rule.source_mode === 'draft_from_observed_domain';

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
              <span className="font-bold text-gray-900 text-sm truncate">{rule.client_label || rule.client_key}</span>
              <code className="text-[11px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-mono">{rule.client_id}</code>
              <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                isDraft
                  ? 'bg-amber-100 text-amber-800 border-amber-200'
                  : 'bg-emerald-100 text-emerald-800 border-emerald-200'
              }`}>
                {isDraft ? <><AlertTriangle size={9} className="inline mr-1" />Draft</> : <><ShieldCheck size={9} className="inline mr-1" />Live Profile</>}
              </span>
              {isDirty && (
                <span className="text-[10px] text-amber-600 font-medium flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" /> Unsaved changes
                </span>
              )}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">
              {rule.primary_domain} · generated {fmtDate(rule.generated_at)}
            </div>
          </div>

          {/* Save */}
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !isDirty}
            className={`flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl text-white shadow-sm transition shrink-0 ${
              saveMutation.isSuccess && !isDirty
                ? 'bg-emerald-600'
                : isDirty
                  ? 'bg-indigo-600 hover:bg-indigo-700'
                  : 'bg-gray-300 cursor-not-allowed'
            } disabled:opacity-70`}
          >
            {saveMutation.isPending ? <Loader2 size={15} className="animate-spin" /> :
             (saveMutation.isSuccess && !isDirty) ? <Check size={15} /> : <Save size={15} />}
            {saveMutation.isPending ? 'Saving…' : (saveMutation.isSuccess && !isDirty) ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>

      {/* ── Save error ─────────────────────────────────────────── */}
      {saveMutation.isError && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl flex items-center gap-2">
          <AlertTriangle size={15} /> {saveMutation.error?.message}
        </div>
      )}

      {/* ── Draft banner ───────────────────────────────────────── */}
      {isDraft && (
        <div className="mx-6 mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 flex items-start gap-3">
          <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-500" />
          <span>
            <strong>No confirmed profile YAML backs this client.</strong> It was auto-generated from
            observed email traffic. Review the data below, fill in any missing fields, and save to
            promote it to a live profile.
          </span>
        </div>
      )}

      {/* ── Body ───────────────────────────────────────────────── */}
      <div className="flex flex-col xl:flex-row gap-6 p-6">

        {/* ── LEFT: editable config ────────────────────────────── */}
        <div className="flex-1 space-y-6 min-w-0">

          {/* Read-only identity */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Tag size={12} /> Client Identity <span className="font-normal normal-case text-gray-300">(read-only)</span>
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <ReadOnly label="Client Key"  value={rule.client_key} />
              <ReadOnly label="Client ID"   value={rule.client_id} />
              <ReadOnly label="Client Name" value={rule.client_name} />
              <ReadOnly label="Domain"      value={rule.primary_domain} />
            </div>
          </div>

          {/* Email matching */}
          <Section icon={Mail} color="indigo" title="Email Matching Rules"
            subtitle="The pipeline identifies this client from incoming emails using these rules">
            <Field label="Recognised Email Domains"
              hint="Emails from these domains will be assigned to this client">
              <TagsInput
                values={emailDomains}
                onChange={track(setEmailDomains)}
                placeholder="Type a domain and press Enter — e.g. dpworld.com"
                mono
              />
            </Field>
            <Field label="Sender Name Patterns"
              hint="Keywords in the sender name that also match this client (case-insensitive)">
              <TagsInput
                values={senderPatterns}
                onChange={track(setSenderPatterns)}
                placeholder="e.g. DUPON, FRONERI…"
              />
            </Field>
          </Section>

          {/* Regime & principal */}
          <Section icon={Globe} color="emerald" title="Customs Setup"
            subtitle="Default customs settings applied to all declarations for this client">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field label="Default Regime">
                <SelectInput
                  value={defaultRegime}
                  onChange={track(setDefaultRegime)}
                  placeholder="Select regime…"
                  options={[
                    { value: 'export',    label: 'Export' },
                    { value: 'import',    label: 'Import' },
                    { value: 'transit',   label: 'Transit' },
                    { value: 'T1',        label: 'T1 (Transit)' },
                    { value: 'T2',        label: 'T2 (Transit)' },
                    { value: 'EX',        label: 'EX (Export)' },
                    { value: 'IM',        label: 'IM (Import)' },
                    { value: 'intrastat', label: 'Intrastat' },
                  ]}
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
          </Section>

          {/* Mandatory fields */}
          <Section icon={ListChecks} color="violet" title="Mandatory Fields"
            subtitle="Fields that the AI extraction must resolve — any missing field will trigger a review">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field label="Mandatory Header Fields"
                hint="Fields required on the declaration header">
                <TagsInput
                  values={mandatoryHeader}
                  onChange={track(setMandatoryHeader)}
                  placeholder="e.g. vat_number, commercial_reference…"
                  mono
                />
              </Field>
              <Field label="Mandatory Item Fields"
                hint="Fields required on every line item">
                <TagsInput
                  values={mandatoryItem}
                  onChange={track(setMandatoryItem)}
                  placeholder="e.g. hs_code, origin_country…"
                  mono
                />
              </Field>
            </div>
          </Section>

          {/* Instructions */}
          <Section icon={BookOpen} color="amber" title="AI Extraction Instructions"
            subtitle="Plain-language rules the AI reads when processing documents for this client. Be specific and concrete.">
            <InstructionEditor
              items={instructions}
              onChange={track(setInstructions)}
            />
          </Section>
        </div>

        {/* ── RIGHT: live YAML + meta ──────────────────────────── */}
        <div className="w-full xl:w-[380px] flex flex-col gap-5 shrink-0">

          {/* Live YAML */}
          <div className="rounded-2xl border border-[#1e293b] bg-[#0f172a] shadow-lg overflow-hidden sticky top-[65px]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e293b] bg-[#0f172a]">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <FileCode2 size={14} className="text-indigo-400" />
                Live Preview
              </div>
              <div className="flex items-center gap-2">
                {isDirty
                  ? <span className="text-[10px] text-amber-400 font-medium flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />modified</span>
                  : <span className="text-[10px] text-emerald-400 flex items-center gap-1"><RefreshCw size={10} className="animate-spin" style={{ animationDuration: '4s' }} />up to date</span>
                }
              </div>
            </div>
            <pre className="p-4 text-[11.5px] font-mono leading-relaxed overflow-x-auto max-h-[70vh] overflow-y-auto
              whitespace-pre text-slate-300 [&>*]:text-emerald-300">
              <code className="text-emerald-300">{liveYaml}</code>
            </pre>
          </div>

          {/* File meta */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-xs text-gray-500 space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-400">Blob path</span>
              <code className="font-mono text-gray-600 text-[11px]">{rule.path || `dashboard/clients_rules/${rule.client_key}.json`}</code>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Source mode</span>
              <span className={`font-medium ${isDraft ? 'text-amber-600' : 'text-emerald-600'}`}>
                {rule.source_mode?.replace(/_/g, ' ')}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Generated</span>
              <span>{fmtDate(rule.generated_at)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClientRuleDetail;
