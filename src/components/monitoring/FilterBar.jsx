import React from 'react';
import { Search, X } from 'lucide-react';

const STATUSES = [
  { value: '',               label: 'All Statuses' },
  { value: 'rendered',       label: '✓ Rendered' },
  { value: 'review_required',label: '⚠ Review Required' },
  { value: 'failed',         label: '✕ Failed' },
  { value: 'processing',     label: '↻ Processing' },
];

const GRANULARITIES = [
  { value: 'day',   label: 'Daily' },
  { value: 'week',  label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
];

const sel = 'text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50 transition text-gray-700';

const FilterBar = ({
  filters = {},
  onChange,
  clients = [],
  regimes = [],
  models  = [],
  showGranularity = false,
  granularity = 'day',
  onGranularityChange,
}) => {
  const set   = (key, value) => onChange({ ...filters, [key]: value || undefined });
  const clear = () => onChange({});
  const hasActive = Object.values(filters).some(Boolean);

  return (
    <div className="flex flex-wrap gap-2 items-center">

      {/* Search */}
      <div className="relative flex-1 min-w-[220px]">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          placeholder="Search ref, shipment, client, email…"
          value={filters.q || ''}
          onChange={e => set('q', e.target.value)}
          className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white
            outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50 transition placeholder-gray-400"
        />
      </div>

      {/* Date range */}
      <div className="flex items-center gap-1.5">
        <input
          type="date"
          value={filters.dateFrom || ''}
          onChange={e => set('dateFrom', e.target.value)}
          className={sel}
          title="From date"
        />
        <span className="text-gray-300 text-sm">→</span>
        <input
          type="date"
          value={filters.dateTo || ''}
          onChange={e => set('dateTo', e.target.value)}
          className={sel}
          title="To date"
        />
      </div>

      {/* Status */}
      <select value={filters.status || ''} onChange={e => set('status', e.target.value)} className={sel}>
        {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>

      {/* Client */}
      {clients.length > 0 && (
        <select value={filters.client || ''} onChange={e => set('client', e.target.value)} className={`${sel} max-w-[180px]`}>
          <option value="">All Clients</option>
          {clients.map(c => <option key={c.value ?? c} value={c.value ?? c}>{c.label ?? c}</option>)}
        </select>
      )}

      {/* Regime */}
      {regimes.length > 0 && (
        <select value={filters.regime || ''} onChange={e => set('regime', e.target.value)} className={sel}>
          <option value="">All Regimes</option>
          {regimes.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      )}

      {/* Model */}
      {models.length > 0 && (
        <select value={filters.model || ''} onChange={e => set('model', e.target.value)} className={sel}>
          <option value="">All Models</option>
          {models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      )}

      {/* Granularity */}
      {showGranularity && (
        <select value={granularity} onChange={e => onGranularityChange?.(e.target.value)} className={sel}>
          {GRANULARITIES.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
        </select>
      )}

      {/* Clear all */}
      {hasActive && (
        <button
          onClick={clear}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 px-2.5 py-1.5 rounded-lg border border-gray-200 hover:border-red-300 bg-white transition"
        >
          <X size={11} /> Clear
        </button>
      )}
    </div>
  );
};

export default FilterBar;
