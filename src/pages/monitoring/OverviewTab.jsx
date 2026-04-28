import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  PieChart, Pie, Cell, Tooltip, Legend,
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { CheckCircle, AlertTriangle, XCircle, DollarSign, Zap, Package, AlertCircle, ArrowRight } from 'lucide-react';
import {
  CHART_PALETTE, STATUS_COLORS, TOOLTIP_STYLE, LEGEND_PROPS,
  BAR_RADIUS_H, GRID_PROPS, AXIS_STYLE,
} from './chartTheme';
import { fetchBrainOverview, fmtCostFull, fmtCost, fmtPct, fmtNum, fmtTokens } from '../../api/dkmBrainApi';
import { getClientRoute } from './clientContract';

// ---------------------------------------------------------------------------
// Shared UI primitives
// ---------------------------------------------------------------------------

const KpiCard = ({ label, value, sub, icon: Icon, gradient }) => (
  <div className={`rounded-2xl p-5 flex items-start gap-4 shadow-sm ${gradient}`}>
    <div className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
      {React.createElement(Icon, { size: 20, className: 'text-white' })}
    </div>
    <div className="min-w-0">
      <p className="text-xs font-medium text-white/70 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-2xl font-bold text-white leading-none">{value ?? '—'}</p>
      {sub && <p className="text-xs text-white/60 mt-1">{sub}</p>}
    </div>
  </div>
);

const StatusBlock = ({ label, count, rate, color, bg, border, icon: Icon }) => (
  <div className={`rounded-2xl border p-5 flex items-center justify-between shadow-sm ${bg} ${border}`}>
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color }}>{label}</p>
      <p className="text-3xl font-bold text-gray-900">{fmtNum(count)}</p>
      <p className="text-sm mt-1 font-medium" style={{ color }}>{rate}</p>
    </div>
    {React.createElement(Icon, { size: 36, style: { color, opacity: 0.18 } })}
  </div>
);

const SectionLabel = ({ children }) => (
  <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">{children}</p>
);

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={TOOLTIP_STYLE.contentStyle}>
      {label && <p style={TOOLTIP_STYLE.labelStyle} className="mb-1">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color || '#F8FAFC', margin: '2px 0' }}>
          {p.name}: <strong>{typeof p.value === 'number' && p.value < 1 && p.value > 0 ? fmtCost(p.value) : fmtNum(p.value)}</strong>
        </p>
      ))}
    </div>
  );
};

const AlertBanner = ({ items }) => {
  if (!items?.length) return null;
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <AlertCircle size={15} className="text-amber-600" />
        <span className="text-sm font-semibold text-amber-800">Action Required</span>
      </div>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2 text-sm text-amber-800">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 flex-shrink-0" />
            {item}
          </div>
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const KPIS_GRADIENT = [
  'bg-gradient-to-br from-indigo-500 to-indigo-600',
  'bg-gradient-to-br from-emerald-500 to-emerald-600',
  'bg-gradient-to-br from-violet-500 to-violet-600',
  'bg-gradient-to-br from-orange-400 to-orange-500',
];

const OverviewTab = ({ filters }) => {
  const navigate = useNavigate();

  const { data: d = {}, isLoading, error } = useQuery({
    queryKey: ['brain-overview', filters],
    queryFn: () => fetchBrainOverview(filters),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  if (isLoading) return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-gray-100 rounded-2xl" />)}
      </div>
    </div>
  );
  if (error) return (
    <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-red-700 text-sm">
      {error.message}
    </div>
  );

  const total    = d.total_shipments || 0;
  const rendered = d.total_rendered  || 0;
  const review   = d.total_review    || 0;
  const failed   = d.total_failed    || 0;
  const cost     = d.total_cost_usd  || 0;
  const renderedPct = total ? Math.round((rendered / total) * 100) : 0;

  const alerts = [];
  if (failed > 0) alerts.push(`${failed} failed run${failed > 1 ? 's' : ''} — likely output truncation (max_output_tokens exceeded on large invoices)`);
  if ((d.failure_rate || 0) > 0.25) alerts.push(`Failure rate ${fmtPct(d.failure_rate)} is above the 25% threshold`);

  // Donut data
  const donut = [
    { name: 'Rendered', value: rendered, color: STATUS_COLORS.rendered },
    { name: 'Review',   value: review,   color: STATUS_COLORS.review_required },
    { name: 'Failed',   value: failed,   color: STATUS_COLORS.failed },
  ].filter(x => x.value > 0);

  // Regime bar
  const regimeData = (d.regime_split || [])
    .filter(r => r.label !== 'unknown')
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  // Top clients
  const topClients = (d.top_clients_cost || []).slice(0, 7);
  const maxCost = topClients[0]?.value || 1;

  // Model breakdown
  const modelData = (d.model_usage || []).map((m, i) => ({
    ...m,
    fill: CHART_PALETTE[i % CHART_PALETTE.length],
  }));

  return (
    <div className="space-y-6">
      <AlertBanner items={alerts} />

      {/* Hero KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total Runs"       value={fmtNum(total)}           sub={d.generated_at ? `as of ${new Date(d.generated_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}` : undefined} icon={Package}      gradient={KPIS_GRADIENT[0]} />
        <KpiCard label="Rendered"         value={`${renderedPct}%`}       sub={`${fmtNum(rendered)} shipments`}  icon={CheckCircle}  gradient={KPIS_GRADIENT[1]} />
        <KpiCard label="Total Cost"       value={fmtCostFull(cost)}       sub={`avg ${fmtCost(rendered ? cost/rendered : 0)} / run`} icon={DollarSign}  gradient={KPIS_GRADIENT[2]} />
        <KpiCard label="Avg Tokens / Run" value={fmtTokens(d.avg_tokens)} sub={`${fmtNum(total)} runs total`}   icon={Zap}          gradient={KPIS_GRADIENT[3]} />
      </div>

      {/* Status breakdown */}
      <div>
        <SectionLabel>Pipeline Status</SectionLabel>
        <div className="grid grid-cols-3 gap-4">
          <StatusBlock label="Rendered"       count={rendered} rate={`${Math.round((rendered/Math.max(total,1))*100)}% success`} color={STATUS_COLORS.rendered}        bg="bg-emerald-50"  border="border border-emerald-100" icon={CheckCircle}  />
          <StatusBlock label="Review"         count={review}   rate={`${Math.round((review/Math.max(total,1))*100)}% flagged`}  color={STATUS_COLORS.review_required} bg="bg-amber-50"    border="border border-amber-100"   icon={AlertTriangle}/>
          <StatusBlock label="Failed"         count={failed}   rate={`${Math.round((failed/Math.max(total,1))*100)}% fail rate`} color={STATUS_COLORS.failed}          bg="bg-rose-50"     border="border border-rose-100"    icon={XCircle}      />
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Outcome donut */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <SectionLabel>Outcome Mix</SectionLabel>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={donut} dataKey="value" nameKey="name" cx="50%" cy="50%"
                innerRadius={55} outerRadius={85} paddingAngle={4} strokeWidth={0}>
                {donut.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <Tooltip {...TOOLTIP_STYLE} formatter={(v) => fmtNum(v)} />
              <Legend {...LEGEND_PROPS} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Regime bar */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <SectionLabel>Regime Split</SectionLabel>
          {regimeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={regimeData} layout="vertical" margin={{ left: 0, right: 8 }}>
                <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
                <XAxis type="number" {...AXIS_STYLE} allowDecimals={false} />
                <YAxis type="category" dataKey="label" {...AXIS_STYLE} width={60} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v) => fmtNum(v)} />
                <Bar dataKey="value" fill={CHART_PALETTE[0]} radius={BAR_RADIUS_H} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-44 flex items-center justify-center text-sm text-gray-300">No regime data yet</div>
          )}
        </div>

        {/* Model usage */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <SectionLabel>Model Usage</SectionLabel>
          {modelData.length > 0 ? (
            <div className="space-y-4 mt-1">
              {modelData.map((m, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="font-mono text-gray-600 truncate">{m.label}</span>
                    <span className="font-semibold ml-3" style={{ color: m.fill }}>
                      {fmtCostFull(m.cost_usd)} · {m.value} calls
                    </span>
                  </div>
                  <div className="bg-gray-100 rounded-full h-1.5">
                    <div className="h-1.5 rounded-full transition-all"
                      style={{ width: `${Math.round((m.value/(modelData[0]?.value||1))*100)}%`, backgroundColor: m.fill }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-44 flex items-center justify-center text-sm text-gray-300">No model data yet</div>
          )}
        </div>
      </div>

      {/* Top clients */}
      {topClients.length > 0 && (
        <div>
          <SectionLabel>Top Clients by Cost</SectionLabel>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            {topClients.map((c, i) => (
              <div key={i}
                className="flex items-center gap-4 px-5 py-3.5 border-b border-gray-50 last:border-0 hover:bg-slate-50 cursor-pointer transition-colors"
                onClick={() => navigate(getClientRoute(c) || `/monitoring/brain/client/${encodeURIComponent(c.client_key || c.label)}`)}>
                <span className="text-xs font-bold text-gray-300 w-5 flex-shrink-0">{String(i + 1).padStart(2,'0')}</span>
                <span className="flex-1 text-sm font-medium text-gray-700 truncate">{c.label}</span>
                <div className="w-36 bg-gray-100 rounded-full h-1.5 flex-shrink-0">
                  <div className="h-1.5 rounded-full" style={{ width:`${Math.round((c.value/maxCost)*100)}%`, backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length] }} />
                </div>
                <span className="text-sm font-semibold text-gray-800 w-20 text-right">{fmtCostFull(c.value)}</span>
                <ArrowRight size={13} className="text-gray-300 flex-shrink-0" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default OverviewTab;
