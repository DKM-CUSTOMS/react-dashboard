import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, CheckCircle2, AlertTriangle, Info, ArrowLeft, ChevronDown,
  GitBranch, Sparkles, Database, Shuffle, Zap, Layers,
  Loader2, Package, Globe, FileText, Hash, RefreshCw, Shield,
  BarChart2, Clock,
} from 'lucide-react';
import { getFlows, runFlow } from '../../api/rulesFlowsApi';

// ─── Strategy meta ────────────────────────────────────────────────────────────

const STRATEGY_META = {
  condition:         { Icon: GitBranch,  accent: '#7c3aed', light: '#f5f3ff' },
  ai_prompt:         { Icon: Sparkles,   accent: '#0891b2', light: '#ecfeff' },
  db_lookup:         { Icon: Database,   accent: '#d97706', light: '#fffbeb' },
  cross_declaration: { Icon: Shuffle,    accent: '#2563eb', light: '#eff6ff' },
  external_api:      { Icon: Zap,        accent: '#059669', light: '#ecfdf5' },
  composite:         { Icon: Layers,     accent: '#db2777', light: '#fdf2f8' },
};

// ─── Result Row ───────────────────────────────────────────────────────────────

function ResultRow({ result, index }) {
  const [expanded, setExpanded] = useState(false);
  const meta = STRATEGY_META[result.strategy_type] ?? STRATEGY_META.condition;
  const { Icon } = meta;

  const status = result.passed
    ? { Icon: CheckCircle2, color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', label: 'Passed',  stripe: '#16a34a' }
    : result.severity === 'info'
    ? { Icon: Info,          color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', label: 'Info',    stripe: '#2563eb' }
    : { Icon: AlertTriangle, color: '#d97706', bg: '#fffbeb', border: '#fcd34d', label: 'Warning', stripe: '#d97706' };

  const StatusIcon = status.Icon;
  const hasDetails = result.details && Object.keys(result.details).length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.18, ease: 'easeOut' }}
      className="bg-white border border-gray-200 rounded overflow-hidden"
    >
      {/* top accent stripe */}
      <div className="h-0.5 w-full" style={{ background: status.stripe }} />

      <div
        className={`flex items-center gap-3 px-4 py-3 ${hasDetails ? 'cursor-pointer hover:bg-gray-50' : ''} transition-colors`}
        onClick={() => hasDetails && setExpanded(e => !e)}
      >
        {/* status icon */}
        <StatusIcon size={16} className="flex-shrink-0" style={{ color: status.color }} />

        {/* name + message */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-semibold text-gray-900 truncate">{result.checkName}</span>
            <div className="flex items-center justify-center w-4 h-4 rounded flex-shrink-0" style={{ background: meta.light }}>
              <Icon size={10} style={{ color: meta.accent }} />
            </div>
          </div>
          <p className="text-xs text-gray-500 truncate">{result.message}</p>
        </div>

        {/* badge + chevron */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs font-semibold px-2 py-0.5 rounded"
            style={{ background: status.bg, color: status.color, border: `1px solid ${status.border}` }}>
            {status.label}
          </span>
          {hasDetails && (
            <ChevronDown size={13} className="text-gray-400 transition-transform" style={{ transform: expanded ? 'rotate(180deg)' : '' }} />
          )}
        </div>
      </div>

      {/* Expandable details */}
      <AnimatePresence>
        {expanded && hasDetails && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 pt-1 border-t border-gray-100 bg-gray-50">
              <pre className="text-xs text-gray-600 font-mono whitespace-pre-wrap break-all leading-relaxed">
                {JSON.stringify(result.details, null, 2)}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Summary Panel ────────────────────────────────────────────────────────────

function SummaryPanel({ summary, ranAt, isDemo }) {
  const pct = summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : 100;
  const allGood = summary.warned === 0 && summary.info === 0;

  return (
    <div className="space-y-4">
      {/* Score card */}
      <div className="border border-gray-200 rounded bg-white p-4">
        <div className="flex items-end justify-between mb-3">
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Score</div>
            <div className="text-4xl font-black" style={{ color: allGood ? '#16a34a' : '#d97706' }}>
              {pct}%
            </div>
          </div>
          <div className="flex items-center gap-1.5 pb-1">
            {allGood
              ? <CheckCircle2 size={18} className="text-green-600" />
              : <AlertTriangle size={18} className="text-amber-600" />
            }
            <span className="text-sm font-bold" style={{ color: allGood ? '#16a34a' : '#d97706' }}>
              {allGood ? 'All clear' : 'Review needed'}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 bg-gray-100 rounded overflow-hidden mb-3">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.5, ease: 'easeOut', delay: 0.1 }}
            className="h-full rounded"
            style={{ background: allGood ? '#16a34a' : '#d97706' }}
          />
        </div>

        {/* Stat grid */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-green-50 border border-green-100 rounded p-2">
            <div className="text-lg font-black text-green-700">{summary.passed}</div>
            <div className="text-[10px] text-green-600 font-semibold uppercase tracking-wide">Passed</div>
          </div>
          <div className="bg-amber-50 border border-amber-100 rounded p-2">
            <div className="text-lg font-black text-amber-700">{summary.warned}</div>
            <div className="text-[10px] text-amber-600 font-semibold uppercase tracking-wide">Warnings</div>
          </div>
          <div className="bg-blue-50 border border-blue-100 rounded p-2">
            <div className="text-lg font-black text-blue-700">{summary.info}</div>
            <div className="text-[10px] text-blue-600 font-semibold uppercase tracking-wide">Info</div>
          </div>
        </div>
      </div>

      {/* Meta */}
      <div className="border border-gray-200 rounded bg-white px-4 py-3 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-400 flex items-center gap-1.5"><BarChart2 size={11} /> Total checks</span>
          <span className="font-semibold text-gray-700">{summary.total}</span>
        </div>
        {ranAt && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400 flex items-center gap-1.5"><Clock size={11} /> Ran at</span>
            <span className="font-semibold text-gray-700">{new Date(ranAt).toLocaleTimeString()}</span>
          </div>
        )}
        {isDemo && (
          <div className="pt-1 border-t border-gray-100">
            <span className="text-[10px] px-2 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200 font-medium">
              Demo data — Streamliner not connected
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Declaration Info Panel ───────────────────────────────────────────────────

function DeclarationPanel({ decl }) {
  const rows = [
    { label: 'Declaration ID', value: decl.DECLARATIONID },
    { label: 'MRN',            value: decl.MRN },
    { label: 'LRN',            value: decl.LRN },
    { label: 'Template',       value: decl.TEMPLATECODE },
    { label: 'Procedure',      value: decl.PROCEDURETYPESSW },
    { label: 'Incoterm',       value: decl.DELIVERYTERMSCODE },
    { label: 'Dispatch',       value: decl.DISPATCHCOUNTRY },
    { label: 'Destination',    value: decl.DESTINATIONCOUNTRY },
    { label: 'Invoice',        value: decl.TOTALINVOICEAMOUNT
        ? `${Number(decl.TOTALINVOICEAMOUNT).toLocaleString()} ${decl.TOTALINVOICEAMOUNTCURRENCY ?? ''}`
        : null },
    { label: 'Gross Mass',     value: decl.TOTALGROSSMASS ? `${decl.TOTALGROSSMASS} kg` : null },
    { label: 'Tax Status',     value: decl.DECLARATIONTAXSTATUS },
  ].filter(r => r.value != null && r.value !== '');

  return (
    <div className="border border-gray-200 rounded bg-white overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50">
        <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">Declaration</span>
      </div>
      <div className="divide-y divide-gray-100">
        {rows.map(({ label, value }) => (
          <div key={label} className="flex items-center justify-between px-4 py-2">
            <span className="text-xs text-gray-400">{label}</span>
            <span className="text-xs font-semibold text-gray-800 font-mono truncate ml-3 max-w-[140px] text-right">{String(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function RunFlowPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [flows, setFlows]               = useState([]);
  const [selectedFlowId, setSelectedFlowId] = useState(searchParams.get('flowId') ?? '');
  const [declarationId, setDeclarationId]   = useState('158493');
  const [running, setRunning]           = useState(false);
  const [runResult, setRunResult]       = useState(null);
  const [error, setError]               = useState(null);

  useEffect(() => { getFlows().then(setFlows).catch(console.error); }, []);

  const selectedFlow = flows.find(f => f.id === selectedFlowId);

  const handleRun = async () => {
    if (!selectedFlowId || !declarationId) return;
    setRunning(true);
    setRunResult(null);
    setError(null);
    try {
      const result = await runFlow(selectedFlowId, declarationId);
      setRunResult(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">

      {/* ── Topbar ── */}
      <div className="h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-3 flex-shrink-0 z-20">
        <button onClick={() => navigate('/rules/flows')}
          className="p-1.5 rounded hover:bg-gray-100 text-gray-500 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="w-px h-5 bg-gray-200" />

        <Shield size={15} className="text-indigo-500 flex-shrink-0" />
        <div>
          <span className="font-bold text-sm text-gray-900">Run Checks</span>
          <span className="text-xs text-gray-400 ml-2">Validate a declaration against a flow</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Flow selector */}
          <div className="relative">
            <select
              value={selectedFlowId}
              onChange={e => setSelectedFlowId(e.target.value)}
              className="border border-gray-200 rounded px-3 py-1.5 pr-7 text-sm bg-white focus:outline-none focus:border-indigo-400 appearance-none min-w-[200px]"
            >
              <option value="">Select flow…</option>
              {flows.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>

          {/* Declaration ID */}
          <input
            value={declarationId}
            onChange={e => setDeclarationId(e.target.value)}
            placeholder="Declaration ID…"
            className="border border-gray-200 rounded px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-indigo-400 w-36"
          />

          {/* Run button */}
          <button
            onClick={handleRun}
            disabled={!selectedFlowId || !declarationId || running}
            className="flex items-center gap-2 px-4 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
          >
            {running
              ? <><Loader2 size={14} className="animate-spin" /> Running…</>
              : <><Play size={13} fill="currentColor" /> Run Checks</>
            }
          </button>

          {runResult && (
            <button onClick={handleRun}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-gray-200 hover:bg-gray-50 text-gray-600 text-sm transition-colors">
              <RefreshCw size={13} /> Re-run
            </button>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-hidden flex">

        {/* ── Left sidebar: summary + declaration ── */}
        {runResult && (
          <div className="w-72 flex-shrink-0 border-r border-gray-200 bg-white overflow-y-auto">
            <div className="p-4 space-y-4">
              <SummaryPanel
                summary={runResult.summary}
                ranAt={runResult.ran_at}
                isDemo={runResult.isDemo}
              />
              {runResult.declaration?.declaration && (
                <DeclarationPanel decl={runResult.declaration.declaration} />
              )}
              {/* Items count strip */}
              {runResult.declaration?.items?.length > 0 && (
                <div className="border border-gray-200 rounded bg-white px-4 py-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400 flex items-center gap-1.5"><Package size={11} /> Items</span>
                    <span className="font-semibold text-gray-700">{runResult.declaration.items.length}</span>
                  </div>
                  <div className="mt-2 space-y-1">
                    {runResult.declaration.items.map((it, i) => (
                      <div key={i} className="flex items-center justify-between text-[11px]">
                        <span className="text-gray-500 font-mono">{it.item?.COMMODITYCODE ?? '—'}</span>
                        <span className="text-gray-400 truncate ml-2 max-w-[120px]">{it.item?.GOODSDESCRIPTION?.slice(0, 24) ?? ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Right: results or idle state ── */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* Error */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Running spinner */}
          <AnimatePresence>
            {running && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center h-full text-center"
              >
                <div className="relative w-14 h-14 mb-4">
                  <div className="absolute inset-0 rounded border-4 border-indigo-100" style={{ borderRadius: 4 }} />
                  <div className="absolute inset-0 border-4 border-indigo-500 border-t-transparent animate-spin" style={{ borderRadius: 4 }} />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Shield size={18} className="text-indigo-500" />
                  </div>
                </div>
                <p className="text-sm font-semibold text-gray-700">Executing checks…</p>
                <p className="text-xs text-gray-400 mt-1">Fetching declaration and running validation pipeline</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Idle state — no result yet */}
          {!running && !runResult && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-12 h-12 rounded bg-indigo-50 flex items-center justify-center mx-auto mb-4">
                <Shield size={20} className="text-indigo-400" />
              </div>
              <div className="text-sm font-semibold text-gray-700 mb-1">Ready to run</div>
              <div className="text-xs text-gray-400 max-w-xs mb-6">
                Select a flow and enter a declaration ID, then click <strong>Run Checks</strong> to validate.
              </div>
              {flows.length > 0 && !selectedFlowId && (
                <div className="text-xs text-gray-400">
                  {flows.length} flow{flows.length !== 1 ? 's' : ''} available
                </div>
              )}
            </div>
          )}

          {/* Results list */}
          {runResult && !running && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-sm font-bold text-gray-900">Check Results</span>
                <span className="text-xs text-gray-400">· click a row to expand details</span>
                {selectedFlow && (
                  <span className="ml-auto text-xs text-gray-400">{selectedFlow.name}</span>
                )}
              </div>
              <div className="space-y-2">
                {runResult.results.map((result, i) => (
                  <ResultRow key={result.checkId ?? i} result={result} index={i} />
                ))}
              </div>
              {runResult.results.length === 0 && (
                <div className="text-center py-12 text-sm text-gray-400">
                  No checks ran — the flow may have no active checks.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
