import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Download, ChevronLeft, ChevronRight } from 'lucide-react';
import StatusBadge from '../../components/monitoring/StatusBadge';
import {
  CHART_PALETTE, STATUS_COLORS, TOOLTIP_STYLE, LEGEND_PROPS,
  GRID_PROPS, AXIS_STYLE, BAR_RADIUS, areaFill,
} from './chartTheme';
import { fetchBrainOperations, fetchBrainShipments, exportTableToCsv, fmtDate, fmtCost, fmtDuration, fmtTokens } from '../../api/dkmBrainApi';

const SectionLabel = ({ children }) => (
  <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">{children}</p>
);

const COLS = [
  { key: 'shipment_id',          label: 'Shipment ID',   render: v => <span className="font-mono text-xs text-indigo-600">{v||'—'}</span> },
  { key: 'client_name',          label: 'Client' },
  { key: 'commercial_reference', label: 'Reference' },
  { key: 'regime',               label: 'Regime' },
  { key: 'status',               label: 'Status',        render: v => <StatusBadge status={v} /> },
  { key: 'total_cost_usd',       label: 'Cost',          render: v => <span className="font-semibold text-violet-700">{fmtCost(v)}</span> },
  { key: 'total_tokens',         label: 'Tokens',        render: v => fmtTokens(v) },
  { key: 'duration_ms',          label: 'Duration',      render: v => fmtDuration(v) },
  { key: 'created_at',           label: 'Date',          render: v => <span className="text-gray-400">{fmtDate(v)}</span> },
];

const OperationsTab = ({ filters, granularity }) => {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const limit = 50;

  const { data: ops, isLoading: opsLoading } = useQuery({
    queryKey: ['brain-operations', filters, granularity],
    queryFn:  () => fetchBrainOperations(filters, granularity),
    staleTime: 5 * 60_000, retry: 1,
  });
  const { data: list, isLoading: listLoading } = useQuery({
    queryKey: ['brain-shipments', filters, page],
    queryFn:  () => fetchBrainShipments(filters, page, limit),
    staleTime: 5 * 60_000, keepPreviousData: true, retry: 1,
  });

  const series   = ops?.time_series || [];
  const items    = list?.items  || [];
  const total    = list?.total  || 0;
  const pages    = list?.pages  || 1;

  const handleExport = () => exportTableToCsv(
    `shipments-${new Date().toISOString().slice(0,10)}.csv`,
    items,
    COLS.map(c => ({ key: c.key, label: c.label }))
  );

  const cell = (col, row) => {
    const v = col.key.split('.').reduce((o,k) => o?.[k], row);
    return col.render ? col.render(v, row) : (v ?? '—');
  };

  const Skeleton = ({ h = 'h-48' }) => <div className={`${h} bg-gray-50 rounded-xl animate-pulse`} />;

  return (
    <div className="space-y-6">
      {/* Runs over time */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <SectionLabel>Runs Over Time</SectionLabel>
        {opsLoading ? <Skeleton /> : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="gradRendered" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={STATUS_COLORS.rendered}  stopOpacity={0.3} />
                  <stop offset="100%" stopColor={STATUS_COLORS.rendered} stopOpacity={0.03} />
                </linearGradient>
                <linearGradient id="gradReview" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={STATUS_COLORS.review_required}  stopOpacity={0.3} />
                  <stop offset="100%" stopColor={STATUS_COLORS.review_required} stopOpacity={0.03} />
                </linearGradient>
                <linearGradient id="gradFailed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={STATUS_COLORS.failed}  stopOpacity={0.3} />
                  <stop offset="100%" stopColor={STATUS_COLORS.failed} stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="date" {...AXIS_STYLE} />
              <YAxis {...AXIS_STYLE} allowDecimals={false} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Legend {...LEGEND_PROPS} />
              <Area type="monotone" dataKey="rendered" stackId="1" stroke={STATUS_COLORS.rendered}        fill="url(#gradRendered)" name="Rendered"  strokeWidth={2} />
              <Area type="monotone" dataKey="review"   stackId="1" stroke={STATUS_COLORS.review_required} fill="url(#gradReview)"   name="Review"    strokeWidth={2} />
              <Area type="monotone" dataKey="failed"   stackId="1" stroke={STATUS_COLORS.failed}          fill="url(#gradFailed)"   name="Failed"    strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Latency + cost */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <SectionLabel>Avg Duration Over Time</SectionLabel>
          {opsLoading ? <Skeleton h="h-40" /> : (
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="date" {...AXIS_STYLE} />
                <YAxis {...AXIS_STYLE} tickFormatter={v => `${(v/1000).toFixed(0)}s`} />
                <Tooltip {...TOOLTIP_STYLE} formatter={v => `${(v/1000).toFixed(1)}s`} />
                <Line type="monotone" dataKey="avg_duration_ms" stroke={CHART_PALETTE[3]} dot={false} strokeWidth={2.5} name="Avg Duration" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <SectionLabel>Cost Over Time</SectionLabel>
          {opsLoading ? <Skeleton h="h-40" /> : (
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="gradCost" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={CHART_PALETTE[0]} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={CHART_PALETTE[0]} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="date" {...AXIS_STYLE} />
                <YAxis {...AXIS_STYLE} tickFormatter={v => `$${v.toFixed(2)}`} />
                <Tooltip {...TOOLTIP_STYLE} formatter={v => `$${Number(v).toFixed(4)}`} />
                <Area type="monotone" dataKey="cost" stroke={CHART_PALETTE[0]} fill="url(#gradCost)" strokeWidth={2.5} name="Cost (USD)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Shipment table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-5">
          <SectionLabel>Shipments</SectionLabel>
          <div className="flex items-center gap-3 -mt-4">
            <span className="text-xs text-gray-400">{total.toLocaleString()} total</span>
            <button onClick={handleExport}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-indigo-600 border border-gray-200 rounded-xl px-3 py-1.5 hover:border-indigo-300 transition-colors">
              <Download size={11} /> Export
            </button>
          </div>
        </div>

        {listLoading ? (
          <div className="space-y-2">{[...Array(6)].map((_,i)=><div key={i} className="h-10 bg-gray-50 rounded-lg animate-pulse"/>)}</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    {COLS.map(c => (
                      <th key={c.key} className="pb-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider pr-5 whitespace-nowrap">{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((row,i) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-slate-50 cursor-pointer transition-colors"
                      onClick={() => navigate(`/monitoring/brain/shipment/${encodeURIComponent(row.shipment_id)}`)}>
                      {COLS.map(col => (
                        <td key={col.key} className="py-3 pr-5 whitespace-nowrap">{cell(col,row)}</td>
                      ))}
                    </tr>
                  ))}
                  {!items.length && (
                    <tr><td colSpan={COLS.length} className="py-10 text-center text-sm text-gray-300">No shipments match the current filters</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {pages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
                <span className="text-xs text-gray-400">Page {page} / {pages}</span>
                <div className="flex gap-1">
                  <button onClick={() => setPage(p => Math.max(1,p-1))} disabled={page<=1}
                    className="p-1.5 rounded-lg border border-gray-200 hover:border-indigo-300 disabled:opacity-30 transition-colors">
                    <ChevronLeft size={14} />
                  </button>
                  <button onClick={() => setPage(p => Math.min(pages,p+1))} disabled={page>=pages}
                    className="p-1.5 rounded-lg border border-gray-200 hover:border-indigo-300 disabled:opacity-30 transition-colors">
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default OperationsTab;
