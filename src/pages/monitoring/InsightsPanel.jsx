import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Lightbulb, TrendingDown, AlertTriangle, Zap } from 'lucide-react';
import StatusBadge from '../../components/monitoring/StatusBadge';
import {
  CHART_PALETTE, STATUS_COLORS, TOOLTIP_STYLE,
  GRID_PROPS, AXIS_STYLE, BAR_RADIUS_H,
} from './chartTheme';
import { fetchBrainInsights, fmtCostFull, fmtCost, fmtTokens, fmtPct, fmtNum, fmtDate } from '../../api/dkmBrainApi';

const SectionLabel = ({ children, icon: Icon, color }) => (
  <div className="flex items-center gap-2 mb-4">
    {Icon && <Icon size={15} style={{ color }} />}
    <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">{children}</p>
  </div>
);

const InsightCard = ({ title, icon: Icon, accent, children }) => (
  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
    <div className="flex items-center gap-2 mb-1">
      {Icon && (
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${accent}18` }}>
          <Icon size={14} style={{ color: accent }} />
        </div>
      )}
      <span className="text-sm font-semibold text-gray-800">{title}</span>
    </div>
    <div className="mt-3">{children}</div>
  </div>
);

const MiniTable = ({ rows, cols, onRowClick }) => (
  <table className="w-full text-sm">
    <thead>
      <tr className="border-b border-gray-100">
        {cols.map(c => (
          <th key={c.key} className={`pb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider ${c.right ? 'text-right' : 'text-left'} pr-3`}>{c.label}</th>
        ))}
      </tr>
    </thead>
    <tbody>
      {rows.map((row, i) => (
        <tr key={i} className={`border-b border-gray-50 last:border-0 ${onRowClick ? 'hover:bg-slate-50 cursor-pointer' : ''} transition-colors`}
          onClick={() => onRowClick?.(row)}>
          {cols.map(c => {
            const v = c.key.split('.').reduce((o,k)=>o?.[k], row);
            return (
              <td key={c.key} className={`py-2 pr-3 ${c.right ? 'text-right' : ''}`}>
                {c.render ? c.render(v, row) : (v ?? '—')}
              </td>
            );
          })}
        </tr>
      ))}
      {!rows.length && <tr><td colSpan={cols.length} className="py-6 text-center text-sm text-gray-300">No anomalies found</td></tr>}
    </tbody>
  </table>
);

const InsightsPanel = () => {
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ['brain-insights'],
    queryFn: fetchBrainInsights,
    staleTime: 10 * 60_000, retry: 1,
  });

  if (isLoading) return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {[...Array(5)].map((_,i) => <div key={i} className="h-52 bg-white rounded-2xl border border-gray-100 animate-pulse"/>)}
    </div>
  );
  if (error) return (
    <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-red-700 text-sm">{error.message}</div>
  );

  const d = data || {};

  return (
    <div className="space-y-4">
      {/* Banner */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 flex items-start gap-3">
        <Lightbulb size={16} className="text-indigo-500 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-indigo-800">
          <strong>Smart Insights</strong> — derived automatically from dashboard telemetry.
          These signal optimisation opportunities and root-cause patterns.
          Refresh by clearing the cache.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* 1. High cost, low render */}
        <InsightCard title="High Cost · Low Render Success" icon={TrendingDown} accent={STATUS_COLORS.failed}>
          <p className="text-xs text-gray-400 mb-3">Clients spending the most with under 60% render rate — best ROI targets for prompt tuning.</p>
          <MiniTable
            rows={d.high_cost_low_success || []}
            onRowClick={row => navigate(`/monitoring/brain/client/${encodeURIComponent(row.client_key || row.client)}`)}
            cols={[
              { key:'client',         label:'Client',   render: v => <span className="font-medium text-gray-700 truncate max-w-[140px] block">{v}</span> },
              { key:'total_cost_usd', label:'Cost',     right:true, render: v => <span className="font-semibold text-violet-700">{fmtCostFull(v)}</span> },
              { key:'success_rate',   label:'Success',  right:true, render: v => <span className="text-red-600 font-semibold">{fmtPct(v)}</span> },
              { key:'total',          label:'Runs',     right:true, render: v => <span className="text-gray-400">{v}</span> },
            ]}
          />
        </InsightCard>

        {/* 2. High review, low fail */}
        <InsightCard title="High Review · Low Failure" icon={AlertTriangle} accent={CHART_PALETTE[2]}>
          <p className="text-xs text-gray-400 mb-3">Extractions are nearly right — a rule or prompt tweak could eliminate the reviews entirely.</p>
          <MiniTable
            rows={d.high_review_low_fail || []}
            onRowClick={row => navigate(`/monitoring/brain/client/${encodeURIComponent(row.client_key || row.client)}`)}
            cols={[
              { key:'client',      label:'Client',  render: v => <span className="font-medium text-gray-700 truncate max-w-[140px] block">{v}</span> },
              { key:'review_rate', label:'Review',  right:true, render: v => <span className="text-amber-600 font-semibold">{fmtPct(v)}</span> },
              { key:'fail_rate',   label:'Fail',    right:true, render: v => <span className="text-emerald-600 font-semibold">{fmtPct(v)}</span> },
              { key:'total',       label:'Runs',    right:true, render: v => <span className="text-gray-400">{v}</span> },
            ]}
          />
        </InsightCard>

        {/* 3. Repeated review reasons */}
        <InsightCard title="Repeated Review Reasons" icon={AlertTriangle} accent={CHART_PALETTE[2]}>
          <p className="text-xs text-gray-400 mb-3">Each pattern here is a deterministic fix opportunity — a prompt rule or post-processing step.</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={(d.repeated_review_reasons||[]).slice(0,8)} layout="vertical" margin={{ left:0, right:8 }}>
              <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
              <XAxis type="number" {...AXIS_STYLE} allowDecimals={false} />
              <YAxis type="category" dataKey="label" {...AXIS_STYLE} width={220} tick={{ fontSize:9, fill:'#64748B' }} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Bar dataKey="value" fill={CHART_PALETTE[2]} radius={BAR_RADIUS_H} maxBarSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </InsightCard>

        {/* 4. Token outliers */}
        <InsightCard title="Abnormally High Token Runs" icon={Zap} accent={CHART_PALETTE[3]}>
          <p className="text-xs text-gray-400 mb-3">
            Runs &gt; mean + 2σ ({fmtTokens(d.token_stats?.threshold)}).
            Candidates for chunked extraction or tighter max_output_tokens.
          </p>
          <MiniTable
            rows={d.high_token_shipments || []}
            onRowClick={row => navigate(`/monitoring/brain/shipment/${encodeURIComponent(row.shipment_id)}`)}
            cols={[
              { key:'shipment_id',   label:'Shipment', render: v => <span className="font-mono text-xs text-indigo-600">{(v||'').slice(0,8)}…</span> },
              { key:'client_name',   label:'Client',   render: v => <span className="text-gray-600 truncate max-w-[100px] block">{v||'—'}</span> },
              { key:'total_tokens',  label:'Tokens',   right:true, render: v => <span className="font-semibold" style={{color:CHART_PALETTE[3]}}>{fmtTokens(v)}</span> },
              { key:'total_cost_usd',label:'Cost',     right:true, render: v => <span className="text-violet-700 font-semibold">{fmtCost(v)}</span> },
            ]}
          />
        </InsightCard>

        {/* 5. Regime cost per shipment */}
        <InsightCard title="Cost per Run by Regime" icon={TrendingDown} accent={CHART_PALETTE[0]}>
          <p className="text-xs text-gray-400 mb-3">Regimes with highest average cost — primary targets for model routing optimisation.</p>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={(d.regime_cost_per_shipment||[]).slice(0,8)} layout="vertical" margin={{ left:0, right:8 }}>
              <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
              <XAxis type="number" {...AXIS_STYLE} tickFormatter={v=>`$${v.toFixed(3)}`} />
              <YAxis type="category" dataKey="label" {...AXIS_STYLE} width={80} />
              <Tooltip {...TOOLTIP_STYLE} formatter={v=>`$${Number(v).toFixed(4)}`} />
              <Bar dataKey="value" fill={CHART_PALETTE[0]} radius={BAR_RADIUS_H} maxBarSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </InsightCard>

      </div>

      {/* Token stats footer */}
      {d.token_stats && (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-wrap gap-6 text-xs text-slate-500">
          <span><strong className="text-slate-700">Token mean:</strong> {fmtTokens(d.token_stats.mean)}</span>
          <span><strong className="text-slate-700">Std dev:</strong> {fmtTokens(d.token_stats.stdev)}</span>
          <span><strong className="text-slate-700">Outlier threshold (μ+2σ):</strong> {fmtTokens(d.token_stats.threshold)}</span>
        </div>
      )}
    </div>
  );
};

export default InsightsPanel;
