import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Download } from 'lucide-react';
import StatCard from '../../components/monitoring/StatCard';
import {
  CHART_PALETTE, STATUS_COLORS, TOOLTIP_STYLE,
  GRID_PROPS, AXIS_STYLE, BAR_RADIUS_H,
} from './chartTheme';
import { fetchBrainQuality, exportTableToCsv, fmtPct, fmtNum } from '../../api/dkmBrainApi';
import { Users, AlertTriangle, HelpCircle, Target } from 'lucide-react';
import { getClientRoute } from './clientContract';

const SectionLabel = ({ children }) => (
  <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">{children}</p>
);

const RateBar = ({ pct, color }) => (
  <div className="flex items-center gap-2">
    <span className="w-8 text-xs font-semibold" style={{ color }}>{pct}%</span>
    <div className="flex-1 bg-gray-100 rounded-full h-1.5">
      <div className="h-1.5 rounded-full transition-all" style={{ width:`${Math.min(100,pct)}%`, backgroundColor: color }} />
    </div>
  </div>
);

const QualityTab = ({ filters }) => {
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ['brain-quality', filters],
    queryFn: () => fetchBrainQuality(filters),
    staleTime: 5 * 60_000, retry: 1,
  });

  if (isLoading) return <div className="space-y-4">{[...Array(3)].map((_,i)=><div key={i} className="h-48 bg-gray-50 rounded-2xl animate-pulse"/>)}</div>;
  if (error) return <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-red-700 text-sm">{error.message}</div>;

  const d = data || {};

  const handleExport = () => exportTableToCsv(
    `quality-clients-${new Date().toISOString().slice(0,10)}.csv`,
    d.clients_by_review_rate||[],
    [
      { key:'label',        label:'Client' },
      { key:'total',        label:'Total' },
      { key:'review_count', label:'Reviews' },
      { key:'fail_count',   label:'Failures' },
      { key:'review_rate',  label:'Review %' },
      { key:'fail_rate',    label:'Fail %' },
    ]
  );

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div>
        <SectionLabel>Quality Summary</SectionLabel>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="Avg Items / Shipment" value={fmtNum(Math.round(d.avg_items_per_shipment||0))} icon={Target}        color="blue"   />
          <StatCard label="Unknown Client Rate"  value={fmtPct(d.unknown_client_rate||0)}              icon={HelpCircle}    color="yellow" />
          <StatCard label="Profile Match Rate"   value={fmtPct(d.profile_match_rate||0)}               icon={Users}         color="green"  />
          <StatCard label="Distinct Review Types" value={fmtNum((d.top_review_reasons||[]).length)}    icon={AlertTriangle} color="red"    />
        </div>
      </div>

      {/* Review reasons chart */}
      {(d.top_review_reasons?.length > 0) && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <SectionLabel>Review Reasons Frequency</SectionLabel>
          <ResponsiveContainer width="100%" height={Math.max(220, (d.top_review_reasons.length * 28))}>
            <BarChart data={(d.top_review_reasons||[]).slice(0,15)} layout="vertical" margin={{ left:0, right:16 }}>
              <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
              <XAxis type="number" {...AXIS_STYLE} allowDecimals={false} />
              <YAxis type="category" dataKey="label" {...AXIS_STYLE} width={280} tick={{ fontSize:10, fill:'#64748B' }} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Bar dataKey="value" fill={CHART_PALETTE[2]} radius={BAR_RADIUS_H} maxBarSize={16} name="Occurrences" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Client review + fail rates */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-5">
          <SectionLabel>Clients by Review &amp; Fail Rate</SectionLabel>
          <button onClick={handleExport}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-indigo-600 border border-gray-200 rounded-xl px-3 py-1.5 hover:border-indigo-300 transition-colors -mt-4">
            <Download size={11} /> Export
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {['Client','Total','Reviews','Failures','Review Rate','Fail Rate'].map(h=>(
                  <th key={h} className="pb-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider pr-6">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(d.clients_by_review_rate||[]).slice(0,25).map((row,i)=>(
                <tr key={i} className="border-b border-gray-50 hover:bg-slate-50 cursor-pointer transition-colors"
                  onClick={() => navigate(getClientRoute(row) || `/monitoring/brain/client/${encodeURIComponent(row.client_key || row.label)}`)}>
                  <td className="py-3 pr-6 font-medium text-gray-700">{row.label}</td>
                  <td className="py-3 pr-6 text-gray-500">{fmtNum(row.total)}</td>
                  <td className="py-3 pr-6 font-semibold" style={{ color: CHART_PALETTE[2] }}>{fmtNum(row.review_count)}</td>
                  <td className="py-3 pr-6 font-semibold" style={{ color: STATUS_COLORS.failed }}>{fmtNum(row.fail_count)}</td>
                  <td className="py-3 pr-6 min-w-[140px]"><RateBar pct={row.review_rate} color={CHART_PALETTE[2]} /></td>
                  <td className="py-3 pr-6 min-w-[140px]"><RateBar pct={row.fail_rate}   color={STATUS_COLORS.failed} /></td>
                </tr>
              ))}
              {!(d.clients_by_review_rate?.length)&&(
                <tr><td colSpan={6} className="py-10 text-center text-sm text-gray-300">No data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Regime fail rates */}
      {(d.regimes_by_fail_rate?.filter(r=>r.fail_rate>0).length>0) && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <SectionLabel>Regimes by Fail Rate</SectionLabel>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={(d.regimes_by_fail_rate||[]).filter(r=>r.fail_rate>0).slice(0,12)} layout="vertical" margin={{ left:0, right:16 }}>
              <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
              <XAxis type="number" {...AXIS_STYLE} tickFormatter={v=>`${v}%`} />
              <YAxis type="category" dataKey="label" {...AXIS_STYLE} width={80} />
              <Tooltip {...TOOLTIP_STYLE} formatter={v=>`${v}%`} />
              <Bar dataKey="fail_rate" fill={STATUS_COLORS.failed} radius={BAR_RADIUS_H} maxBarSize={16} name="Fail Rate %" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default QualityTab;
