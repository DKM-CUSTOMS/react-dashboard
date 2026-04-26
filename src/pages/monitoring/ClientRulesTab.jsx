import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { fetchClientRulesIndex, fmtDate } from '../../api/dkmBrainApi';
import { Search, Plus, AlertTriangle, ShieldCheck, ChevronDown, ChevronRight, Globe, Clock } from 'lucide-react';

const SOURCE_MODE_LABELS = {
  profile_yaml:               { label: 'Profile',  color: 'bg-emerald-500 text-white border-emerald-600' },
  draft_from_observed_domain: { label: 'Draft',    color: 'bg-amber-500  text-white border-amber-600'  },
};

// Distinct solid colors per regime — used for group header accent + row hover
const REGIME_MAP = {
  export:     { header: 'bg-gradient-to-r from-emerald-600 to-emerald-500', text: 'text-white', dot: 'bg-emerald-300', rowHover: 'hover:bg-emerald-50/60' },
  import:     { header: 'bg-gradient-to-r from-blue-600    to-blue-500',    text: 'text-white', dot: 'bg-blue-300',    rowHover: 'hover:bg-blue-50/60'    },
  transit:    { header: 'bg-gradient-to-r from-violet-600  to-violet-500',  text: 'text-white', dot: 'bg-violet-300',  rowHover: 'hover:bg-violet-50/60'  },
  T1:         { header: 'bg-gradient-to-r from-purple-600  to-purple-500',  text: 'text-white', dot: 'bg-purple-300',  rowHover: 'hover:bg-purple-50/60'  },
  T2:         { header: 'bg-gradient-to-r from-fuchsia-600 to-fuchsia-500', text: 'text-white', dot: 'bg-fuchsia-300', rowHover: 'hover:bg-fuchsia-50/60' },
  EX:         { header: 'bg-gradient-to-r from-teal-600    to-teal-500',    text: 'text-white', dot: 'bg-teal-300',    rowHover: 'hover:bg-teal-50/60'    },
  IM:         { header: 'bg-gradient-to-r from-sky-600     to-sky-500',     text: 'text-white', dot: 'bg-sky-300',     rowHover: 'hover:bg-sky-50/60'     },
  intrastat:  { header: 'bg-gradient-to-r from-orange-600  to-orange-500',  text: 'text-white', dot: 'bg-orange-300',  rowHover: 'hover:bg-orange-50/60'  },
  Unset:      { header: 'bg-gradient-to-r from-gray-500    to-gray-400',    text: 'text-white', dot: 'bg-gray-300',    rowHover: 'hover:bg-gray-50/60'    },
};

function getRegime(r) {
  return REGIME_MAP[r] || REGIME_MAP[r?.toLowerCase()] || REGIME_MAP['Unset'];
}

const ClientRulesTab = () => {
  const navigate = useNavigate();
  const [search, setSearch]           = useState('');
  const [modeFilter, setModeFilter]   = useState('');
  const [collapsed, setCollapsed]     = useState({});

  const { data: indexData, isLoading, error } = useQuery({
    queryKey: ['client-rules-index'],
    queryFn:  fetchClientRulesIndex,
    staleTime: 5 * 60_000,
  });

  const clients = indexData?.clients || [];
  const modeOptions = [...new Set(clients.map(c => c.source_mode).filter(Boolean))];

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return clients.filter(c => {
      const matchSearch =
        !q ||
        c.client_key?.toLowerCase().includes(q) ||
        String(c.client_id ?? '').toLowerCase().includes(q) ||
        c.client_name?.toLowerCase().includes(q) ||
        c.primary_domain?.toLowerCase().includes(q);
      const matchMode = !modeFilter || c.source_mode === modeFilter;
      return matchSearch && matchMode;
    });
  }, [clients, search, modeFilter]);

  // Group by regime — index uses suggested_regime, detail uses default_regime
  const groups = useMemo(() => {
    const map = {};
    filtered.forEach(c => {
      const key = c.suggested_regime || c.default_regime || 'Unset';
      if (!map[key]) map[key] = [];
      map[key].push(c);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const toggleGroup = (regime) =>
    setCollapsed(prev => ({ ...prev, [regime]: !prev[regime] }));

  if (isLoading) return (
    <div className="py-20 text-center text-sm text-gray-400 animate-pulse">Loading client rules…</div>
  );
  if (error) return (
    <div className="py-20 text-center text-sm text-red-500">Failed to load: {error.message}</div>
  );

  const draftCount    = clients.filter(c => c.source_mode === 'draft_from_observed_domain').length;
  const profileCount  = clients.filter(c => c.source_mode === 'profile_yaml').length;

  return (
    <div className="space-y-5">

      {/* ── Top bar ─────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-gray-900">Client Rules</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {clients.length} clients · {profileCount} profiled · {draftCount} drafts pending review
            {indexData?.generated_at && <> · updated {fmtDate(indexData.generated_at)}</>}
          </p>
        </div>
        <button
          onClick={() => navigate('/monitoring/brain/client-rules/new')}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium shadow-sm transition shrink-0"
        >
          <Plus size={15} /> New Client Rule
        </button>
      </div>

      {/* ── Drafts banner ───────────────────────────────────── */}
      {draftCount > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800">
          <AlertTriangle size={18} className="shrink-0 mt-0.5 text-amber-500" />
          <span>
            <strong>{draftCount} draft client{draftCount > 1 ? 's' : ''}</strong> generated from observed email
            traffic — no profile YAML is backing them yet. Review each and promote to a real profile.
          </span>
        </div>
      )}

      {/* ── Filters ─────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 flex-1 min-w-[220px] shadow-sm">
          <Search size={14} className="text-gray-400 shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search client name, key, domain…"
            className="bg-transparent text-sm outline-none w-full placeholder-gray-400"
          />
        </div>
        <select
          value={modeFilter}
          onChange={e => setModeFilter(e.target.value)}
          className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 outline-none shadow-sm"
        >
          <option value="">All Types</option>
          {modeOptions.map(m => (
            <option key={m} value={m}>{SOURCE_MODE_LABELS[m]?.label || m}</option>
          ))}
        </select>
      </div>

      {/* ── Regime groups ───────────────────────────────────── */}
      {groups.length === 0 && (
        <div className="py-16 text-center text-gray-400 text-sm">No clients match your filters.</div>
      )}

      {groups.map(([regime, members]) => {
        const isOpen = !collapsed[regime];
        return (
          <div key={regime} className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">

            {/* Group header */}
            <button
              onClick={() => toggleGroup(regime)}
              className={`w-full flex items-center justify-between px-5 py-3.5 text-left transition ${getRegime(regime).header} ${getRegime(regime).text} hover:opacity-95`}
            >
              <div className="flex items-center gap-3">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${getRegime(regime).dot} shadow-sm`} />
                <span className="font-bold text-sm tracking-wide">{regime}</span>
                <span className="text-xs font-normal opacity-70 bg-white/20 px-2 py-0.5 rounded-full">
                  {members.length} client{members.length !== 1 ? 's' : ''}
                </span>
              </div>
              {isOpen
                ? <ChevronDown size={16} className="opacity-80" />
                : <ChevronRight size={16} className="opacity-80" />
              }
            </button>

            {/* Table */}
            {isOpen && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-y border-gray-100 text-xs text-gray-400 font-semibold uppercase tracking-wide">
                    <th className="px-5 py-2 text-left">Client</th>
                    <th className="px-4 py-2 text-left hidden md:table-cell">Domain</th>
                    <th className="px-4 py-2 text-left hidden lg:table-cell">ID</th>
                    <th className="px-4 py-2 text-left">Type</th>
                    <th className="px-4 py-2 text-left hidden xl:table-cell">Last Seen</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {members.map(client => {
                    const isDraft = client.source_mode === 'draft_from_observed_domain';
                    const modeInfo = SOURCE_MODE_LABELS[client.source_mode] || { label: client.source_mode, color: 'bg-gray-100 text-gray-600 border-gray-200' };
                    return (
                      <tr
                        key={client.client_key}
                        onClick={() => navigate(`/monitoring/brain/client-rules/${encodeURIComponent(client.client_key)}`)}
                        className={`cursor-pointer transition group ${getRegime(regime).rowHover}`}
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            {isDraft
                              ? <AlertTriangle size={13} className="text-amber-500 shrink-0" />
                              : <ShieldCheck  size={13} className="text-emerald-500 shrink-0" />
                            }
                            <span className="font-medium text-gray-900 group-hover:text-indigo-700 transition">
                              {client.client_label || client.client_name || client.client_key}
                            </span>
                          </div>
                          <div className="text-xs text-gray-400 ml-5 mt-0.5">{client.client_key}</div>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <span className="flex items-center gap-1.5 text-gray-500 text-xs">
                            <Globe size={12} className="text-gray-300" />
                            {client.primary_domain || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          <code className="text-[11px] bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded text-gray-500">
                            {client.client_id || '—'}
                          </code>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${modeInfo.color}`}>
                            {modeInfo.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 hidden xl:table-cell">
                          <span className="flex items-center gap-1 text-xs text-gray-400">
                            <Clock size={11} />
                            {fmtDate(client.last_seen_at)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-indigo-400 text-xs font-medium group-hover:text-indigo-600 transition">Edit →</span>
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
