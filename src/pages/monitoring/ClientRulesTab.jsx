import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock,
  Globe,
  Plus,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { fetchClientRulesIndex, fmtDate } from '../../api/dkmBrainApi';
import {
  getClientKey,
  getClientRulesRoute,
  getClientRulesState,
  getClientRulesStateMeta,
  getClientSignals,
  isDraftClientRules,
} from './clientContract';

const REGIME_MAP = {
  export: { header: 'bg-gradient-to-r from-emerald-600 to-emerald-500', text: 'text-white', dot: 'bg-emerald-300', rowHover: 'hover:bg-emerald-50/60' },
  import: { header: 'bg-gradient-to-r from-blue-600 to-blue-500', text: 'text-white', dot: 'bg-blue-300', rowHover: 'hover:bg-blue-50/60' },
  transit: { header: 'bg-gradient-to-r from-violet-600 to-violet-500', text: 'text-white', dot: 'bg-violet-300', rowHover: 'hover:bg-violet-50/60' },
  T1: { header: 'bg-gradient-to-r from-purple-600 to-purple-500', text: 'text-white', dot: 'bg-purple-300', rowHover: 'hover:bg-purple-50/60' },
  T2: { header: 'bg-gradient-to-r from-fuchsia-600 to-fuchsia-500', text: 'text-white', dot: 'bg-fuchsia-300', rowHover: 'hover:bg-fuchsia-50/60' },
  EX: { header: 'bg-gradient-to-r from-teal-600 to-teal-500', text: 'text-white', dot: 'bg-teal-300', rowHover: 'hover:bg-teal-50/60' },
  IM: { header: 'bg-gradient-to-r from-sky-600 to-sky-500', text: 'text-white', dot: 'bg-sky-300', rowHover: 'hover:bg-sky-50/60' },
  intrastat: { header: 'bg-gradient-to-r from-orange-600 to-orange-500', text: 'text-white', dot: 'bg-orange-300', rowHover: 'hover:bg-orange-50/60' },
  Unset: { header: 'bg-gradient-to-r from-gray-500 to-gray-400', text: 'text-white', dot: 'bg-gray-300', rowHover: 'hover:bg-gray-50/60' },
};

function getRegime(regime) {
  return REGIME_MAP[regime] || REGIME_MAP[regime?.toLowerCase()] || REGIME_MAP.Unset;
}

function SignalChip({ value, tone = 'gray', mono = false }) {
  const palette = {
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    gray: 'bg-gray-100 text-gray-600 border-gray-200',
  };

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${palette[tone] || palette.gray} ${mono ? 'font-mono' : ''}`}>
      {value}
    </span>
  );
}

function SignalsCell({ client }) {
  const signals = getClientSignals(client);
  const domainSignals = signals.observedEmailDomains.length
    ? signals.observedEmailDomains
    : signals.recognizedEmailDomains;
  const nameSignals = signals.observedSenderNames.slice(0, 2);
  const hasSignals = domainSignals.length > 0 || nameSignals.length > 0;

  if (!hasSignals) {
    return <span className="text-xs text-gray-300">No external sender signals</span>;
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {domainSignals.slice(0, 2).map((domain) => (
          <SignalChip key={domain} value={domain} tone="blue" mono />
        ))}
        {!domainSignals.length && (
          <span className="text-xs text-gray-300">No external sender domains</span>
        )}
      </div>
      {nameSignals.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {nameSignals.map((name) => (
            <SignalChip key={name} value={name} tone="emerald" />
          ))}
        </div>
      )}
      {signals.hiddenForwardingDomainCount > 0 && (
        <div className="text-[11px] text-gray-400">
          {signals.hiddenForwardingDomainCount} internal forwarding hop{signals.hiddenForwardingDomainCount > 1 ? 's' : ''} hidden
        </div>
      )}
    </div>
  );
}

function getAiSettingsSummary(client = {}) {
  const llmPolicy = client?.llm_policy && typeof client.llm_policy === 'object' ? client.llm_policy : {};
  const stageKeys = ['labeler', 'extractor', 'critic', 'resolver', 'simple'];
  const routeCount = stageKeys.reduce((count, stageKey) => {
    const stageConfig = llmPolicy?.[stageKey];
    return count + ['standard', 'complex'].filter((mode) => {
      const route = stageConfig?.[mode];
      return route && typeof route === 'object' && Object.keys(route).length > 0;
    }).length;
  }, 0);

  const models = [...new Set(
    stageKeys.flatMap((stageKey) => ['standard', 'complex']
      .map((mode) => llmPolicy?.[stageKey]?.[mode]?.model)
      .filter(Boolean))
  )];

  return {
    priority: String(client.human_instructions_priority || '').trim(),
    routeCount,
    models,
  };
}

const ClientRulesTab = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [modeFilter, setModeFilter] = useState('');
  const [collapsed, setCollapsed] = useState({});

  const { data: indexData, isLoading, error } = useQuery({
    queryKey: ['client-rules-index'],
    queryFn: fetchClientRulesIndex,
    staleTime: 5 * 60_000,
  });

  const clients = useMemo(() => indexData?.clients ?? [], [indexData]);
  const modeOptions = useMemo(
    () => [...new Set(clients.map((client) => getClientRulesState(client)).filter(Boolean))],
    [clients]
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return clients.filter((client) => {
      const signals = getClientSignals(client);
      const haystack = [
        getClientKey(client),
        client.client_id,
        client.client_label,
        client.client_name,
        client.primary_domain,
        client.principal,
        client.instruction_text,
        client.human_instructions_priority,
        ...getAiSettingsSummary(client).models,
        ...signals.recognizedEmailDomains,
        ...signals.observedEmailDomains,
        ...signals.observedSenderNames,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      const matchesSearch = !query || haystack.includes(query);
      const matchesMode = !modeFilter || getClientRulesState(client) === modeFilter;
      return matchesSearch && matchesMode;
    });
  }, [clients, search, modeFilter]);

  const groups = useMemo(() => {
    const map = {};
    filtered.forEach((client) => {
      const key = client.suggested_regime || client.default_regime || 'Unset';
      if (!map[key]) map[key] = [];
      map[key].push(client);
    });
    return Object.entries(map).sort(([left], [right]) => left.localeCompare(right));
  }, [filtered]);

  const draftCount = clients.filter((client) => isDraftClientRules(client)).length;
  const profileCount = clients.filter((client) => getClientRulesState(client) === 'runtime_profile').length;

  const toggleGroup = (regime) => {
    setCollapsed((previous) => ({ ...previous, [regime]: !previous[regime] }));
  };

  if (isLoading) {
    return (
      <div className="py-20 text-center text-sm text-gray-400 animate-pulse">
        Loading client rules...
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-20 text-center text-sm text-red-500">
        Failed to load: {error.message}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-bold text-gray-900">Client Rules</h2>
          <p className="mt-0.5 text-xs text-gray-400">
            {clients.length} clients | {profileCount} verified | {draftCount} AI detected
            {indexData?.generated_at && <> · updated {fmtDate(indexData.generated_at)}</>}
          </p>
        </div>
        <button
          onClick={() => navigate('/monitoring/brain/client-rules/new')}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700"
        >
          <Plus size={15} /> New Client Rule
        </button>
      </div>

      {draftCount > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-500" />
          <span>
            <strong>{draftCount} client{draftCount > 1 ? 's' : ''}</strong> were detected from
            observed external sender traffic and still need a user to verify them.
          </span>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
        Client matching is shown from external sender domains and sender names. Internal forwarding hops at
        <code className="mx-1 rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-700">@dkm-customs.com</code>
        are intentionally hidden from this view.
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
          <Search size={14} className="shrink-0 text-gray-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search client, principal, sender signal..."
            className="w-full bg-transparent text-sm outline-none placeholder-gray-400"
          />
        </div>
        <select
          value={modeFilter}
          onChange={(event) => setModeFilter(event.target.value)}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none shadow-sm"
        >
          <option value="">All Types</option>
          {modeOptions.map((mode) => (
            <option key={mode} value={mode}>
              {getClientRulesStateMeta({ source_mode: mode }).label}
            </option>
          ))}
        </select>
      </div>

      {groups.length === 0 && (
        <div className="py-16 text-center text-sm text-gray-400">
          No clients match your filters.
        </div>
      )}

      {groups.map(([regime, members]) => {
        const isOpen = !collapsed[regime];
        const regimeStyle = getRegime(regime);
        return (
          <div key={regime} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <button
              onClick={() => toggleGroup(regime)}
              className={`flex w-full items-center justify-between px-5 py-3.5 text-left transition ${regimeStyle.header} ${regimeStyle.text} hover:opacity-95`}
            >
              <div className="flex items-center gap-3">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full shadow-sm ${regimeStyle.dot}`} />
                <span className="text-sm font-bold tracking-wide">{regime}</span>
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-normal opacity-70">
                  {members.length} client{members.length !== 1 ? 's' : ''}
                </span>
              </div>
              {isOpen ? <ChevronDown size={16} className="opacity-80" /> : <ChevronRight size={16} className="opacity-80" />}
            </button>

            {isOpen && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    <th className="px-5 py-2 text-left">Client</th>
                    <th className="hidden px-4 py-2 text-left md:table-cell">Sender Signals</th>
                    <th className="hidden px-4 py-2 text-left lg:table-cell">Principal</th>
                    <th className="px-4 py-2 text-left">Type</th>
                    <th className="hidden px-4 py-2 text-left xl:table-cell">Last Seen</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {members.map((client) => {
                    const clientKey = getClientKey(client) || client.client_key;
                    const stateMeta = getClientRulesStateMeta(client);
                    const isDraft = isDraftClientRules(client);
                    const route = getClientRulesRoute(client) || `/monitoring/brain/client-rules/${encodeURIComponent(clientKey)}`;
                    const redFlagCount = Array.isArray(client.red_flags) ? client.red_flags.length : 0;
                    const instructionPreview = String(client.instruction_text || '').trim();
                    const signals = getClientSignals(client);
                    const aiSettings = getAiSettingsSummary(client);
                    const fallbackSignal = signals.primarySignal || 'No external sender match yet';

                    return (
                      <tr
                        key={clientKey}
                        onClick={() => navigate(route)}
                        className={`group cursor-pointer transition ${regimeStyle.rowHover}`}
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            {isDraft ? (
                              <AlertTriangle size={13} className="shrink-0 text-amber-500" />
                            ) : (
                              <ShieldCheck size={13} className="shrink-0 text-emerald-500" />
                            )}
                            <span className="font-medium text-gray-900 transition group-hover:text-indigo-700">
                              {client.client_label || client.client_name || clientKey}
                            </span>
                          </div>
                          <div className="ml-5 mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                            <span className="font-mono">{clientKey}</span>
                            <span className="inline-flex items-center gap-1">
                              <Globe size={11} className="text-gray-300" />
                              {fallbackSignal}
                            </span>
                            {redFlagCount > 0 && (
                              <SignalChip value={`${redFlagCount} red flag${redFlagCount > 1 ? 's' : ''}`} tone="amber" />
                            )}
                            {aiSettings.priority && (
                              <SignalChip value={`priority ${aiSettings.priority}`} tone="emerald" />
                            )}
                            {aiSettings.routeCount > 0 && (
                              <SignalChip value={`${aiSettings.routeCount} AI route${aiSettings.routeCount > 1 ? 's' : ''}`} tone="gray" />
                            )}
                          </div>
                          {instructionPreview && (
                            <div className="ml-5 mt-1 max-w-xl truncate text-xs text-gray-500">
                              {instructionPreview}
                            </div>
                          )}
                          {aiSettings.models.length > 0 && (
                            <div className="ml-5 mt-1 flex flex-wrap gap-1.5">
                              {aiSettings.models.slice(0, 3).map((model) => (
                                <SignalChip key={model} value={model} tone="gray" mono />
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="hidden px-4 py-3 md:table-cell">
                          <SignalsCell client={client} />
                        </td>
                        <td className="hidden px-4 py-3 lg:table-cell">
                          {client.principal ? (
                            <span className="text-xs font-medium text-gray-700">{client.principal}</span>
                          ) : (
                            <span className="text-xs text-gray-300">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${stateMeta.color}`}>
                            {stateMeta.shortLabel}
                          </span>
                        </td>
                        <td className="hidden px-4 py-3 xl:table-cell">
                          <span className="flex items-center gap-1 text-xs text-gray-400">
                            <Clock size={11} />
                            {fmtDate(client.last_seen_at || client.last_seen)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-xs font-medium text-indigo-400 transition group-hover:text-indigo-600">
                            Review →
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default ClientRulesTab;


