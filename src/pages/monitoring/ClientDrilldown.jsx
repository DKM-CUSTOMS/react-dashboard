import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { ArrowLeft, Download, AlertTriangle, XCircle, Cpu, FileText, Layers, Hash, Link2 } from 'lucide-react';
import StatCard from '../../components/monitoring/StatCard';
import StatusBadge from '../../components/monitoring/StatusBadge';
import {
  CHART_PALETTE, STATUS_COLORS, TOOLTIP_STYLE, LEGEND_PROPS, GRID_PROPS, AXIS_STYLE,
} from './chartTheme';
import {
  fetchBrainClientDetail, exportTableToCsv,
  fmtCostFull, fmtCost, fmtPct, fmtNum, fmtDate,
} from '../../api/dkmBrainApi';
import { Package, DollarSign, CheckCircle, AlertTriangle as AT, XCircle as XC } from 'lucide-react';
import { getClientRulesRoute, getClientRulesStateMeta } from './clientContract';

const SL = ({ children }) => (
  <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">{children}</p>
);

// ---------------------------------------------------------------------------
// Model usage block
// ---------------------------------------------------------------------------
const ModelUsage = ({ models }) => {
  if (!models?.length) return <p className="text-xs text-gray-300">No model data</p>;
  const maxCalls = models[0]?.value || 1;
  return (
    <div className="space-y-3">
      {models.map((m, i) => (
        <div key={i}>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length] }} />
              <span className="font-mono text-gray-700">{m.label}</span>
            </div>
            <div className="flex items-center gap-3 ml-3">
              <span className="text-gray-400">{m.value} calls</span>
              {m.cost_usd > 0 && <span className="font-semibold text-violet-700">{fmtCostFull(m.cost_usd)}</span>}
            </div>
          </div>
          <div className="bg-gray-100 rounded-full h-1.5">
            <div className="h-1.5 rounded-full transition-all"
              style={{ width: `${Math.round((m.value / maxCalls) * 100)}%`, backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length] }} />
          </div>
        </div>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Review flags breakdown — categorised, no chart
// ---------------------------------------------------------------------------
const ReviewFlags = ({ cats }) => {
  const { missing = [], model = [], declarant = [] } = cats || {};
  const totalFlags = missing.length + model.length + declarant.length;
  if (totalFlags === 0) return <p className="text-xs text-gray-300">No review flags recorded</p>;

  const Section = ({ title, items, color, bg }) => {
    if (!items.length) return null;
    return (
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${bg}`} style={{ color }}>{title}</span>
          <span className="text-xs text-gray-400">{items.length} type{items.length > 1 ? 's' : ''}</span>
        </div>
        <div className="space-y-1.5">
          {items.map((item, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="text-gray-600 truncate mr-3">{item.label}</span>
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="w-16 bg-gray-100 rounded-full h-1">
                  <div className="h-1 rounded-full" style={{
                    width: `${Math.round((item.count / (items[0]?.count || 1)) * 100)}%`,
                    backgroundColor: color,
                  }} />
                </div>
                <span className="font-semibold w-4 text-right" style={{ color }}>{item.count}×</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div>
      <Section title="Missing Fields"     items={missing}   color="#EF4444" bg="bg-red-50" />
      <Section title="Model Flags"        items={model}     color="#F59E0B" bg="bg-amber-50" />
      <Section title="Declarant Flags"    items={declarant} color="#6366F1" bg="bg-indigo-50" />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Automation health signals — replaces Regime Breakdown
// ---------------------------------------------------------------------------
const AutomationHealth = ({ d }) => {
  const runs = d.latest_shipments || [];
  const failedRuns = (d.failed_runs || []);
  const avgItems = d.avg_items_per_run || 0;
  const maxRun = d.max_items_run || {};

  // Cost per rendered vs total
  const renderedCost = runs.filter(r => r.status === 'rendered').reduce((s, r) => s + (r.total_cost_usd || 0), 0);
  const renderedCount = runs.filter(r => r.status === 'rendered').length;
  const avgCostRendered = renderedCount ? renderedCost / renderedCount : 0;

  const signals = [
    {
      icon: FileText,
      label: 'Avg items / invoice',
      value: fmtNum(avgItems),
      sub: maxRun.item_count ? `max ${fmtNum(maxRun.item_count)} on ${maxRun.commercial_reference || 'one run'}` : null,
      color: 'text-indigo-600', bg: 'bg-indigo-50',
    },
    {
      icon: DollarSign,
      label: 'Avg cost / rendered run',
      value: fmtCost(avgCostRendered),
      sub: `${renderedCount} rendered runs`,
      color: 'text-violet-600', bg: 'bg-violet-50',
    },
    {
      icon: Cpu,
      label: 'Total LLM calls',
      value: fmtNum(d.llm_call_count || 0),
      sub: d.total_shipments ? `${((d.llm_call_count || 0) / d.total_shipments).toFixed(1)} calls / run` : null,
      color: 'text-cyan-600', bg: 'bg-cyan-50',
    },
    {
      icon: Layers,
      label: 'Token spend',
      value: d.total_input_tokens
        ? `${((d.total_input_tokens + d.total_output_tokens) / 1000).toFixed(1)}K`
        : '—',
      sub: d.total_output_tokens ? `${((d.total_output_tokens / Math.max(d.total_input_tokens + d.total_output_tokens, 1)) * 100).toFixed(0)}% output` : null,
      color: 'text-orange-600', bg: 'bg-orange-50',
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {signals.map((s, i) => (
          <div key={i} className="bg-gray-50 rounded-xl p-3 flex items-start gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${s.bg}`}>
              <s.icon size={15} className={s.color} />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-400 mb-0.5">{s.label}</p>
              <p className="text-base font-bold text-gray-800">{s.value}</p>
              {s.sub && <p className="text-xs text-gray-400 mt-0.5 truncate">{s.sub}</p>}
            </div>
          </div>
        ))}
      </div>

      {/* Failed runs alert */}
      {failedRuns.length > 0 && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <XCircle size={13} className="text-red-500" />
            <span className="text-xs font-semibold text-red-700">{failedRuns.length} failed run{failedRuns.length > 1 ? 's' : ''}</span>
          </div>
          <div className="space-y-1">
            {failedRuns.slice(0, 3).map((r, i) => (
              <div key={i} className="text-xs text-red-600 flex items-center gap-2">
                <span className="font-mono truncate">{r.run_id?.slice(0, 12)}…</span>
                <span className="text-red-400">{fmtDate(r.created_at)}</span>
                {r.subject && <span className="text-red-400 truncate">{r.subject?.slice(0, 40)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const ClientDrilldown = () => {
  const { client_key: rawKey } = useParams();
  const client_key = decodeURIComponent(rawKey || '');
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ['brain-client', client_key],
    queryFn: () => fetchBrainClientDetail(client_key),
    staleTime: 5 * 60_000, retry: 1,
  });

  if (isLoading) return (
    <div className="p-6 space-y-4 animate-pulse">
      <div className="h-8 w-48 bg-gray-100 rounded" />
      <div className="grid grid-cols-5 gap-4">{[...Array(5)].map((_,i)=><div key={i} className="h-24 bg-white rounded-2xl border"/>)}</div>
    </div>
  );
  if (error) return (
    <div className="p-6"><div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-red-700 text-sm">{error.message}</div></div>
  );

  const d = data || {};
  const shipments = d.latest_shipments || [];
  const clientRulesRoute = getClientRulesRoute(d);
  const rulesStateMeta = getClientRulesStateMeta(d);

  const handleExport = () => exportTableToCsv(
    `client-${client_key}.csv`, shipments,
    [
      { key:'shipment_id',          label:'Shipment ID' },
      { key:'commercial_reference', label:'Reference' },
      { key:'regime',               label:'Regime' },
      { key:'status',               label:'Status' },
      { key:'total_cost_usd',       label:'Cost USD' },
      { key:'created_at',           label:'Date' },
    ]
  );

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-4">
        <button onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-indigo-600 mb-3 transition-colors">
          <ArrowLeft size={15} /> Back
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{d.client_name || client_key}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {d.domain && <span className="text-xs bg-gray-100 text-gray-500 rounded-lg px-2 py-0.5">{d.domain}</span>}
              {d.principal && <span className="text-xs bg-slate-100 text-slate-700 rounded-lg px-2 py-0.5">{d.principal}</span>}
              {(d.client_rules_status || d.source_mode) && (
                <span className={`text-xs rounded-lg border px-2 py-0.5 ${rulesStateMeta.subtleColor}`}>
                  {rulesStateMeta.label}
                </span>
              )}
              {!d.is_known && <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-lg px-2 py-0.5">Domain fallback — no profile match</span>}
              {d.last_seen && <span className="text-xs text-gray-400">Last seen {fmtDate(d.last_seen)}</span>}
            </div>
          </div>
          {clientRulesRoute && (
            <button
              onClick={() => navigate(clientRulesRoute)}
              className="flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100"
            >
              <Link2 size={12} /> Open client rules
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 px-6 py-6 space-y-6">

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatCard label="Total Runs"    value={fmtNum(d.total_shipments)}     icon={Package}    color="blue"   />
          <StatCard label="Rendered"      value={fmtNum(d.total_rendered)}      icon={CheckCircle} color="green"  sub={fmtPct(1 - (d.review_rate||0) - (d.fail_rate||0))} />
          <StatCard label="Review"        value={fmtNum(d.total_review)}        icon={AT}          color="yellow" sub={fmtPct(d.review_rate)} />
          <StatCard label="Failed"        value={fmtNum(d.total_failed)}        icon={XC}          color="red"    sub={fmtPct(d.fail_rate)} />
          <StatCard label="Total Cost"    value={fmtCostFull(d.total_cost_usd)} icon={DollarSign}  color="purple" sub={`avg ${fmtCost(d.avg_cost)}`} />
        </div>

        {/* Trend chart */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <SL>Shipments Over Time</SL>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={d.shipments_trend || []} margin={{ top:4, right:8, bottom:0, left:0 }}>
              <defs>
                {[['rendered', STATUS_COLORS.rendered], ['review', STATUS_COLORS.review_required], ['failed', STATUS_COLORS.failed]].map(([k, c]) => (
                  <linearGradient key={k} id={`gCL${k}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={c} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={c} stopOpacity={0.02} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="date" {...AXIS_STYLE} />
              <YAxis {...AXIS_STYLE} allowDecimals={false} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Legend {...LEGEND_PROPS} />
              <Area type="monotone" dataKey="rendered" stackId="1" stroke={STATUS_COLORS.rendered}        fill="url(#gCLrendered)" strokeWidth={2} name="Rendered" />
              <Area type="monotone" dataKey="review"   stackId="1" stroke={STATUS_COLORS.review_required} fill="url(#gCLreview)"   strokeWidth={2} name="Review"   />
              <Area type="monotone" dataKey="failed"   stackId="1" stroke={STATUS_COLORS.failed}          fill="url(#gCLfailed)"   strokeWidth={2} name="Failed"   />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Three-column decision row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Automation health — replaces Regime Breakdown */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <SL>Automation Health</SL>
            <AutomationHealth d={d} />
          </div>

          {/* Model usage — fixed */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <SL>Model Usage</SL>
            <ModelUsage models={d.model_breakdown} />
          </div>

          {/* Review flag breakdown — replaces Top Review Reasons chart */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <SL>What Blocks Automation</SL>
            <ReviewFlags cats={d.review_category_counts} totalShipments={d.total_shipments} />
          </div>
        </div>

        {/* Shipment table */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-5">
            <SL>Recent Runs</SL>
            <button onClick={handleExport}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-indigo-600 border border-gray-200 rounded-xl px-3 py-1.5 hover:border-indigo-300 transition-colors -mt-4">
              <Download size={11} /> Export
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Shipment','Reference','Regime','Status','Cost','Date'].map(h => (
                    <th key={h} className="pb-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider pr-5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shipments.map((s, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-slate-50 cursor-pointer transition-colors"
                    onClick={() => navigate(`/monitoring/brain/shipment/${encodeURIComponent(s.shipment_id)}`)}>
                    <td className="py-3 pr-5 font-mono text-xs text-indigo-600">{s.shipment_id || '—'}</td>
                    <td className="py-3 pr-5 text-gray-600 text-xs">{s.commercial_reference || '—'}</td>
                    <td className="py-3 pr-5 text-gray-500 text-xs">{s.regime || '—'}</td>
                    <td className="py-3 pr-5"><StatusBadge status={s.status} /></td>
                    <td className="py-3 pr-5 font-semibold text-violet-700">{fmtCost(s.total_cost_usd)}</td>
                    <td className="py-3 pr-5 text-gray-400 text-xs">{fmtDate(s.created_at)}</td>
                  </tr>
                ))}
                {!shipments.length && (
                  <tr><td colSpan={6} className="py-10 text-center text-sm text-gray-300">No runs found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClientDrilldown;
