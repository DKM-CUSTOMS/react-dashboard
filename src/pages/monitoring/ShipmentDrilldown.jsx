import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, ChevronRight, FileText, Download } from 'lucide-react';
import StatusBadge from '../../components/monitoring/StatusBadge';
import StatCard from '../../components/monitoring/StatCard';
import {
  fetchBrainShipmentDetail, exportTableToCsv,
  fmtCostFull, fmtCost, fmtTokens, fmtDuration, fmtDate, fmtNum,
} from '../../api/dkmBrainApi';
import { DollarSign, Zap, Clock, Package } from 'lucide-react';

const SectionLabel = ({ children }) => (
  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">{children}</h3>
);

const MetaRow = ({ label, value, mono, badge }) => {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-b-0">
      <span className="w-44 flex-shrink-0 text-xs text-gray-400">{label}</span>
      {badge ? (
        <StatusBadge status={String(value)} />
      ) : (
        <span className={`text-sm text-gray-700 break-all ${mono ? 'font-mono text-xs' : ''}`}>
          {String(value)}
        </span>
      )}
    </div>
  );
};

const TagList = ({ items, color = 'yellow' }) => {
  const cls = {
    yellow: 'bg-yellow-50 text-yellow-800 border-yellow-200',
    red:    'bg-red-50 text-red-800 border-red-200',
    blue:   'bg-blue-50 text-blue-800 border-blue-200',
  }[color];
  if (!items?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {items.map((v, i) => (
        <span key={i} className={`text-xs border rounded-lg px-2 py-1 ${cls}`}>
          {typeof v === 'string' ? v : JSON.stringify(v)}
        </span>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// LLM call row inside an expanded run
// ---------------------------------------------------------------------------

const LlmCallRow = ({ call }) => {
  const usage = call.usage || {};
  const cost  = call.estimated_cost_usd ?? 0;
  const inputTokens    = usage.input_tokens    || call.input_tokens    || 0;
  const outputTokens   = usage.output_tokens   || call.output_tokens   || 0;
  const cachedTokens   = usage.cached_input_tokens || call.cached_tokens || 0;
  const reasoningTokens= usage.reasoning_output_tokens || 0;

  return (
    <tr className={`border-b border-gray-50 text-xs ${call.error || call.status === 'failed' ? 'bg-red-50' : ''}`}>
      <td className="py-2 pr-3 text-gray-500">{call.stage || '—'}</td>
      <td className="py-2 pr-3 font-mono text-blue-700 whitespace-nowrap">{call.model || '—'}</td>
      <td className="py-2 pr-3 text-gray-500">{call.response_schema || '—'}</td>
      <td className="py-2 pr-3 text-center">
        <span className={`px-1.5 py-0.5 rounded text-xs ${call.status === 'succeeded' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {call.status}
        </span>
      </td>
      <td className="py-2 pr-3 text-gray-600">{fmtTokens(inputTokens)}</td>
      <td className="py-2 pr-3 text-gray-600">{fmtTokens(outputTokens)}</td>
      <td className="py-2 pr-3 text-green-700">{cachedTokens ? fmtTokens(cachedTokens) : '—'}</td>
      <td className="py-2 pr-3 text-orange-600">{reasoningTokens ? fmtTokens(reasoningTokens) : '—'}</td>
      <td className="py-2 pr-3 font-semibold text-purple-700">{fmtCost(cost)}</td>
      <td className="py-2 pr-3 text-gray-400">{fmtDuration(call.duration_ms)}</td>
      <td className="py-2 pr-3 text-gray-400">{call.reasoning_effort || '—'}</td>
      <td className="py-2 max-w-xs">
        {call.error
          ? <span className="text-red-600 text-xs leading-tight line-clamp-2" title={call.error}>{call.error.slice(0, 120)}{call.error.length > 120 ? '…' : ''}</span>
          : <span className="text-gray-300">—</span>
        }
      </td>
    </tr>
  );
};

// ---------------------------------------------------------------------------
// Expanded run panel
// ---------------------------------------------------------------------------

const RunPanel = ({ run }) => {
  // llm_calls are embedded in the run blob
  const calls = run.llm_calls || [];
  const traceSummary = run.trace_summary?.simple_pipeline;

  return (
    <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-4">

      {/* Run meta */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div><span className="text-gray-400">Duration</span><div className="font-semibold text-gray-800 mt-0.5">{fmtDuration(run.duration_ms)}</div></div>
        <div><span className="text-gray-400">Items extracted</span><div className="font-semibold text-gray-800 mt-0.5">{fmtNum(run.item_count)}</div></div>
        <div><span className="text-gray-400">Cost</span><div className="font-semibold text-purple-700 mt-0.5">{fmtCostFull(run.total_estimated_cost_usd)}</div></div>
        <div><span className="text-gray-400">LLM calls</span><div className="font-semibold text-gray-800 mt-0.5">{fmtNum(run.llm_call_count)}</div></div>
      </div>

      {/* Review reasons */}
      {run.review_reasons?.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Review Reasons</p>
          <TagList items={run.review_reasons} color="yellow" />
        </div>
      )}

      {/* Trace diagnostics */}
      {traceSummary?.diagnostics && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Documents Seen</p>
            <div className="flex flex-wrap gap-1">
              {(traceSummary.diagnostics.documents_seen || []).map((d, i) => (
                <span key={i} className="text-xs bg-blue-50 text-blue-700 border border-blue-100 rounded px-2 py-0.5">{d}</span>
              ))}
            </div>
          </div>
          {(traceSummary.diagnostics.missing_critical_fields || []).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Missing Critical Fields</p>
              <TagList items={traceSummary.diagnostics.missing_critical_fields} color="red" />
            </div>
          )}
        </div>
      )}

      {/* Pipeline notes */}
      {traceSummary?.notes && (
        <div className="text-xs text-gray-600 bg-white rounded-lg border border-gray-200 p-3">
          <span className="font-semibold text-gray-500">Pipeline notes: </span>{traceSummary.notes}
        </div>
      )}

      {/* LLM calls table */}
      {calls.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">LLM Calls ({calls.length})</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200">
                  {['Stage','Model','Schema','Status','Input','Output','Cached','Reasoning','Cost','Duration','Effort','Error'].map(h => (
                    <th key={h} className="pb-1.5 pr-3 text-left text-gray-400 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {calls.map((c, i) => <LlmCallRow key={i} call={c} />)}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const ShipmentDrilldown = () => {
  const { shipment_id } = useParams();
  const navigate = useNavigate();
  const [expandedRuns, setExpandedRuns] = useState({});

  const { data, isLoading, error } = useQuery({
    queryKey: ['brain-shipment', shipment_id],
    queryFn: () => fetchBrainShipmentDetail(shipment_id),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const toggle = (id) => setExpandedRuns(p => ({ ...p, [id]: !p[id] }));

  if (isLoading) return (
    <div className="p-6 space-y-4">
      <div className="h-8 w-64 bg-gray-100 rounded animate-pulse" />
      <div className="grid grid-cols-4 gap-4">{[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-white rounded-2xl border animate-pulse" />)}</div>
    </div>
  );
  if (error) return (
    <div className="p-6"><div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-red-700 text-sm">Error: {error.message}</div></div>
  );

  const d       = data || {};
  const s       = d.shipment || {};
  const runs    = d.runs || [];
  const allCalls = runs.flatMap(r => r.llm_calls || []);

  const handleExport = () => {
    exportTableToCsv(`llm-calls-${shipment_id}.csv`, allCalls, [
      { key: 'stage',            label: 'Stage' },
      { key: 'model',            label: 'Model' },
      { key: 'response_schema',  label: 'Schema' },
      { key: 'status',           label: 'Status' },
      { key: 'usage.input_tokens',  label: 'Input' },
      { key: 'usage.output_tokens', label: 'Output' },
      { key: 'usage.cached_input_tokens', label: 'Cached' },
      { key: 'usage.reasoning_output_tokens', label: 'Reasoning' },
      { key: 'estimated_cost_usd', label: 'Cost USD' },
      { key: 'duration_ms',      label: 'Duration ms' },
      { key: 'reasoning_effort', label: 'Effort' },
      { key: 'error',            label: 'Error' },
    ]);
  };

  const totalCost  = runs.reduce((s, r) => s + (r.total_estimated_cost_usd || 0), 0);
  const totalTokens = runs.reduce((s, r) => s + (r.total_tokens || 0), 0);
  const totalDuration = runs.reduce((s, r) => s + (r.duration_ms || 0), 0);

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-4">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-400 hover:text-blue-600 mb-3 transition-colors">
          <ArrowLeft size={15} /> Back
        </button>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <span className="font-mono text-sm text-gray-400">{shipment_id}</span>
              <StatusBadge status={s.status} size="md" />
            </div>
            <h1 className="text-lg font-bold text-gray-900 truncate">{s.subject || 'Shipment Detail'}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {s.client_key && <span className="text-xs bg-blue-50 text-blue-700 rounded-lg px-2 py-0.5 border border-blue-100">{s.client_key}</span>}
              {s.regime     && <span className="text-xs bg-gray-100 text-gray-600 rounded-lg px-2 py-0.5">{s.regime}</span>}
              {s.commercial_reference && <span className="text-xs text-gray-500 font-mono">{s.commercial_reference}</span>}
            </div>
          </div>
          <button onClick={handleExport} className="flex-shrink-0 flex items-center gap-1.5 text-xs text-gray-400 hover:text-blue-600 border border-gray-200 rounded-xl px-3 py-2 hover:border-blue-300 transition-colors">
            <Download size={12} /> Export Calls
          </button>
        </div>
      </div>

      <div className="flex-1 px-6 py-6 space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="Total Cost"    value={fmtCostFull(totalCost)}   icon={DollarSign} color="purple" />
          <StatCard label="Total Tokens"  value={fmtTokens(totalTokens)}   icon={Zap}        color="blue"   />
          <StatCard label="Duration"      value={fmtDuration(totalDuration)} icon={Clock}    color="gray"   />
          <StatCard label="Runs"          value={fmtNum(runs.length)}       icon={Package}   color="blue"   />
        </div>

        {/* Metadata + references */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <SectionLabel>Shipment Info</SectionLabel>
            <MetaRow label="Shipment ID"    value={s.shipment_id}     mono />
            <MetaRow label="Client"         value={s.client_key} />
            <MetaRow label="Sender domain"  value={s.sender_domain || s.client_domain} />
            <MetaRow label="Regime"         value={s.regime} />
            <MetaRow label="Status"         value={s.status}          badge />
            <MetaRow label="Items"          value={runs[0]?.item_count} />
            <MetaRow label="Attachments"    value={s.attachment_count} />
            <MetaRow label="First seen"     value={fmtDate(s.first_seen_at)} />
            {s.attachments?.length > 0 && (
              <div className="mt-3 space-y-1">
                {s.attachments.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-gray-500">
                    <FileText size={11} className="text-gray-300" />
                    <span className="truncate">{a.filename}</span>
                    <span className="text-gray-300 flex-shrink-0">{a.kind} · {Math.round((a.size_bytes || 0) / 1024)}KB</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <SectionLabel>References &amp; Review</SectionLabel>
            <MetaRow label="Commercial ref"   value={s.commercial_reference} />
            <MetaRow label="Reference DR"     value={s.reference_dr} />
            <MetaRow label="Primary ref"      value={s.primary_reference} />
            <MetaRow label="Subject"          value={s.subject} />

            {(s.review_reasons?.length > 0) && (
              <div className="mt-4">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-1">Review Reasons</p>
                <TagList items={s.review_reasons} color="yellow" />
              </div>
            )}

            {(d.render_paths?.length > 0) && (
              <div className="mt-4">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-1">Rendered Files</p>
                {d.render_paths.map((p, i) => (
                  <div key={i} className="text-xs font-mono text-blue-600 truncate">{p.split('/').pop()}</div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Runs */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <SectionLabel>Runs ({runs.length})</SectionLabel>
            {runs.length > 1 && (
              <button
                onClick={() => {
                  const all = {};
                  runs.forEach(r => { all[r.run_id] = true; });
                  setExpandedRuns(all);
                }}
                className="text-xs text-blue-500 hover:underline"
              >
                Expand all
              </button>
            )}
          </div>

          {runs.length === 0 ? (
            <p className="text-xs text-gray-400">No run data available.</p>
          ) : (
            <div className="space-y-2">
              {runs.map(run => (
                <div key={run.run_id} className="border border-gray-200 rounded-xl overflow-hidden">
                  {/* Run header row */}
                  <div
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => toggle(run.run_id)}
                  >
                    {expandedRuns[run.run_id]
                      ? <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
                      : <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />
                    }
                    <span className="font-mono text-xs text-blue-600 flex-1 truncate">{run.run_id}</span>
                    <StatusBadge status={run.status} />
                    <span className="text-xs text-gray-500 hidden sm:block">{fmtDate(run.start_time)}</span>
                    <span className="text-xs text-gray-400 w-14 text-right">{fmtDuration(run.duration_ms)}</span>
                    <span className="text-xs font-semibold text-purple-700 w-20 text-right">{fmtCostFull(run.total_estimated_cost_usd)}</span>
                    <span className="text-xs text-gray-400 w-16 text-right">{fmtTokens(run.total_tokens)}</span>
                  </div>
                  {/* Expanded detail */}
                  {expandedRuns[run.run_id] && (
                    <div className="border-t border-gray-100 p-4">
                      <RunPanel run={run} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ShipmentDrilldown;
