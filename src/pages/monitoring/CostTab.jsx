import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Download } from 'lucide-react';
import StatCard from '../../components/monitoring/StatCard';
import StatusBadge from '../../components/monitoring/StatusBadge';
import {
  CHART_PALETTE, TOOLTIP_STYLE, LEGEND_PROPS,
  GRID_PROPS, AXIS_STYLE, BAR_RADIUS, BAR_RADIUS_H, areaFill,
} from './chartTheme';
import { fetchBrainCosts, exportTableToCsv, fmtCostFull, fmtCost, fmtTokens, fmtDate, fmtNum } from '../../api/dkmBrainApi';
import { DollarSign, TrendingUp, TrendingDown } from 'lucide-react';

const SectionLabel = ({ children }) => (
  <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">{children}</p>
);

const Skeleton = ({ h = 'h-48' }) => <div className={`${h} bg-gray-50 rounded-xl animate-pulse`} />;

const CostTab = ({ filters }) => {
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ['brain-costs', filters],
    queryFn: () => fetchBrainCosts(filters),
    staleTime: 5 * 60_000, retry: 1,
  });

  if (isLoading) return <div className="space-y-4">{[...Array(3)].map((_,i)=><Skeleton key={i} />)}</div>;
  if (error) return <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-red-700 text-sm">{error.message}</div>;

  const d = data || {};

  const tokenPie = [
    { name: 'Input',          value: Math.max(0, (d.total_input_tokens||0) - (d.total_cached_tokens||0)), fill: CHART_PALETTE[0] },
    { name: 'Output',         value: d.total_output_tokens || 0,  fill: CHART_PALETTE[2] },
    { name: 'Cached input',   value: d.total_cached_tokens || 0,  fill: CHART_PALETTE[1] },
  ].filter(x => x.value > 0);

  const handleExport = () => exportTableToCsv(
    `cost-outliers-${new Date().toISOString().slice(0,10)}.csv`,
    d.outlier_shipments || [],
    [
      { key:'shipment_id', label:'Shipment' },
      { key:'client_name', label:'Client' },
      { key:'commercial_reference', label:'Ref' },
      { key:'cost_usd', label:'Cost USD' },
      { key:'status', label:'Status' },
      { key:'created_at', label:'Date' },
    ]
  );

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div>
        <SectionLabel>Cost Summary</SectionLabel>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatCard label="Total Cost"       value={fmtCostFull(d.total_cost_usd)}   icon={DollarSign}   color="purple" />
          <StatCard label="Cost / Rendered"  value={fmtCost(d.cost_per_rendered)}    icon={TrendingUp}   color="green"  />
          <StatCard label="Cost / Review"    value={fmtCost(d.cost_per_review)}      icon={TrendingUp}   color="yellow" />
          <StatCard label="Cost / Failed"    value={fmtCost(d.cost_per_failed)}      icon={TrendingDown} color="red"    />
          <StatCard label="Total Tokens"     value={fmtTokens(d.total_input_tokens)} icon={DollarSign}   color="blue"   />
        </div>
      </div>

      {/* Cost over time */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <SectionLabel>Cost Over Time</SectionLabel>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={d.by_day || []} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="gCost" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={CHART_PALETTE[2]} stopOpacity={0.3} />
                <stop offset="100%" stopColor={CHART_PALETTE[2]} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="date" {...AXIS_STYLE} />
            <YAxis {...AXIS_STYLE} tickFormatter={v => `$${v.toFixed(2)}`} />
            <Tooltip {...TOOLTIP_STYLE} formatter={v => `$${Number(v).toFixed(4)}`} />
            <Area type="monotone" dataKey="cost" stroke={CHART_PALETTE[2]} fill="url(#gCost)" strokeWidth={2.5} name="Cost (USD)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* By client / model / regime */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {[
          { title: 'Cost by Client (Top 15)', data: (d.by_client||[]).slice(0,15), fill: CHART_PALETTE[0] },
          { title: 'Cost by Model',           data: d.by_model || [],              fill: CHART_PALETTE[1] },
          { title: 'Cost by Regime',          data: d.by_regime|| [],              fill: CHART_PALETTE[2] },
        ].map(({ title, data, fill }) => (
          <div key={title} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <SectionLabel>{title}</SectionLabel>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data} layout="vertical" margin={{ left: 0, right: 8 }}>
                <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
                <XAxis type="number" {...AXIS_STYLE} tickFormatter={v => `$${v.toFixed(2)}`} />
                <YAxis type="category" dataKey="label" {...AXIS_STYLE} width={110} />
                <Tooltip {...TOOLTIP_STYLE} formatter={v => `$${Number(v).toFixed(4)}`} />
                <Bar dataKey="value" fill={fill} radius={BAR_RADIUS_H} maxBarSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>

      {/* Token split donut */}
      {tokenPie.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <SectionLabel>Token Distribution</SectionLabel>
          <div className="flex items-center gap-8">
            <div className="flex-shrink-0">
              <ResponsiveContainer width={180} height={180}>
                <PieChart>
                  <Pie data={tokenPie} dataKey="value" nameKey="name"
                    cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} strokeWidth={0}>
                    {tokenPie.map((t, i) => <Cell key={i} fill={t.fill} />)}
                  </Pie>
                  <Tooltip {...TOOLTIP_STYLE} formatter={v => fmtTokens(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-3">
              {tokenPie.map((t, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: t.fill }} />
                      <span className="text-gray-600">{t.name}</span>
                    </div>
                    <span className="font-semibold text-gray-800">{fmtTokens(t.value)}</span>
                  </div>
                  <div className="bg-gray-100 rounded-full h-1.5">
                    <div className="h-1.5 rounded-full" style={{
                      width:`${Math.round((t.value/tokenPie.reduce((s,x)=>s+x.value,0))*100)}%`,
                      backgroundColor: t.fill,
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Outlier shipments */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-5">
          <SectionLabel>Most Expensive Shipments</SectionLabel>
          <button onClick={handleExport}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-indigo-600 border border-gray-200 rounded-xl px-3 py-1.5 hover:border-indigo-300 transition-colors -mt-4">
            <Download size={11} /> Export
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {['Shipment','Client','Ref','Cost','Status','Date'].map(h=>(
                  <th key={h} className="pb-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider pr-5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(d.outlier_shipments||[]).map((row,i)=>(
                <tr key={i} className="border-b border-gray-50 hover:bg-slate-50 cursor-pointer transition-colors"
                  onClick={()=>navigate(`/monitoring/brain/shipment/${encodeURIComponent(row.shipment_id)}`)}>
                  <td className="py-3 pr-5 font-mono text-xs text-indigo-600">{row.shipment_id||'—'}</td>
                  <td className="py-3 pr-5 text-gray-700">{row.client_name||'—'}</td>
                  <td className="py-3 pr-5 text-gray-500 text-xs">{row.commercial_reference||'—'}</td>
                  <td className="py-3 pr-5 font-bold text-violet-700">{fmtCostFull(row.cost_usd)}</td>
                  <td className="py-3 pr-5"><StatusBadge status={row.status}/></td>
                  <td className="py-3 pr-5 text-gray-400 text-xs">{fmtDate(row.created_at)}</td>
                </tr>
              ))}
              {!(d.outlier_shipments?.length)&&(
                <tr><td colSpan={6} className="py-10 text-center text-sm text-gray-300">No data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default CostTab;
