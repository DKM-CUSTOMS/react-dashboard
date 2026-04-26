import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, CheckCircle2, AlertTriangle, Info, ArrowLeft, ChevronDown,
  GitBranch, Sparkles, Database, Shuffle, Zap, Layers,
  Loader2, Package, Globe, FileText, Hash, RefreshCw, Shield
} from 'lucide-react';
import { getFlows, runFlow } from '../../api/rulesFlowsApi';

const STRATEGY_ICONS = {
  condition: GitBranch,
  ai_prompt: Sparkles,
  db_lookup: Database,
  cross_declaration: Shuffle,
  external_api: Zap,
  composite: Layers,
};

const STRATEGY_COLORS = {
  condition: 'text-purple-600',
  ai_prompt: 'text-cyan-600',
  db_lookup: 'text-amber-600',
  cross_declaration: 'text-blue-600',
  external_api: 'text-emerald-600',
  composite: 'text-pink-600',
};

function ResultCard({ result, index }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = STRATEGY_ICONS[result.strategy_type] ?? GitBranch;
  const iconColor = STRATEGY_COLORS[result.strategy_type] ?? 'text-gray-500';

  const status = result.passed
    ? { icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200', label: 'Passed' }
    : result.severity === 'info'
    ? { icon: Info, color: 'text-blue-500', bg: 'bg-blue-50', border: 'border-blue-200', label: 'Info' }
    : { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', label: 'Warning' };

  const StatusIcon = status.icon;

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.08, duration: 0.3 }}
      className={`border rounded-xl overflow-hidden ${status.border} ${status.bg}`}
    >
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:brightness-95 transition-all"
        onClick={() => setExpanded((e) => !e)}
      >
        <StatusIcon size={18} className={`flex-shrink-0 ${status.color}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900 truncate">{result.checkName}</span>
            <span className={`flex-shrink-0 inline-flex items-center gap-1 text-xs font-medium ${status.color}`}>
              <Icon size={11} className={iconColor} />
            </span>
          </div>
          <p className="text-xs text-gray-600 mt-0.5 line-clamp-1">{result.message}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${status.bg} ${status.color}`}>
            {status.label}
          </span>
          <ChevronDown size={14} className={`text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </div>

      <AnimatePresence>
        {expanded && result.details && Object.keys(result.details).length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-current/10 overflow-hidden"
          >
            <div className="px-4 py-3 bg-white/60">
              <pre className="text-xs text-gray-600 font-mono whitespace-pre-wrap break-all overflow-x-auto">
                {JSON.stringify(result.details, null, 2)}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function DeclarationSummary({ decl, isDemo }) {
  const fields = [
    { icon: Hash, label: 'Declaration ID', value: decl.DECLARATIONID },
    { icon: FileText, label: 'Template', value: decl.TEMPLATECODE },
    { icon: Package, label: 'Incoterm', value: decl.DELIVERYTERMSCODE },
    { icon: Globe, label: 'Route', value: decl.DISPATCHCOUNTRY && decl.DESTINATIONCOUNTRY ? `${decl.DISPATCHCOUNTRY} → ${decl.DESTINATIONCOUNTRY}` : null },
    { icon: FileText, label: 'Invoice', value: decl.TOTALINVOICEAMOUNT && decl.TOTALINVOICEAMOUNTCURRENCY ? `${Number(decl.TOTALINVOICEAMOUNT).toLocaleString()} ${decl.TOTALINVOICEAMOUNTCURRENCY}` : null },
    { icon: Hash, label: 'MRN', value: decl.MRN },
    { icon: Package, label: 'Items', value: decl.item_count ? `${decl.item_count} item(s)` : null },
    { icon: Hash, label: 'HS Codes', value: decl.hs_codes?.join(', ') },
  ].filter((f) => f.value);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900 text-sm">Declaration Summary</h3>
        {isDemo && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
            Demo data — Streamliner not connected
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        {fields.map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex items-center gap-2">
            <Icon size={13} className="text-gray-300 flex-shrink-0" />
            <span className="text-xs text-gray-400 flex-shrink-0">{label}</span>
            <span className="text-xs font-medium text-gray-700 truncate ml-auto">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SummaryBar({ summary }) {
  const pct = summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : 100;
  const allGood = summary.warned === 0 && summary.info === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl p-5 mb-6 ${allGood ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {allGood ? (
            <CheckCircle2 size={20} className="text-green-600" />
          ) : (
            <AlertTriangle size={20} className="text-amber-600" />
          )}
          <span className={`font-bold text-lg ${allGood ? 'text-green-800' : 'text-amber-800'}`}>
            {allGood ? 'All checks passed' : `${summary.warned + summary.info} issue${summary.warned + summary.info > 1 ? 's' : ''} found`}
          </span>
        </div>
        <span className={`text-2xl font-black ${allGood ? 'text-green-600' : 'text-amber-600'}`}>{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-white/60 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut', delay: 0.2 }}
          className={`h-full rounded-full ${allGood ? 'bg-green-500' : 'bg-amber-500'}`}
        />
      </div>
      <div className="flex gap-4 mt-3 text-xs">
        <span className="text-green-700 font-medium">{summary.passed} passed</span>
        {summary.warned > 0 && <span className="text-amber-700 font-medium">{summary.warned} warnings</span>}
        {summary.info > 0 && <span className="text-blue-600 font-medium">{summary.info} info</span>}
        <span className="text-gray-400 ml-auto">{summary.total} checks total</span>
      </div>
    </motion.div>
  );
}

export default function RunFlowPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [flows, setFlows] = useState([]);
  const [selectedFlowId, setSelectedFlowId] = useState(searchParams.get('flowId') ?? '');
  const [declarationId, setDeclarationId] = useState('158493');
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState(null);
  const [error, setError] = useState(null);
  const resultsRef = useRef(null);

  useEffect(() => {
    getFlows().then(setFlows).catch(console.error);
  }, []);

  const selectedFlow = flows.find((f) => f.id === selectedFlowId);

  const handleRun = async () => {
    if (!selectedFlowId || !declarationId) return;
    setRunning(true);
    setRunResult(null);
    setError(null);
    try {
      const result = await runFlow(selectedFlowId, declarationId);
      setRunResult(result);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-4">
          <button onClick={() => navigate('/rules/flows')} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="font-bold text-lg text-gray-900">Run Checks</h1>
            <p className="text-xs text-gray-400">Validate a declaration against a flow</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Input panel */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 mb-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-6">
            {/* Flow selector */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Select Flow
              </label>
              <div className="relative">
                <select
                  value={selectedFlowId}
                  onChange={(e) => setSelectedFlowId(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white pr-8"
                >
                  <option value="">Choose a flow…</option>
                  {flows.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
              {selectedFlow && (
                <p className="text-xs text-gray-400 mt-1.5">{selectedFlow.active_check_count ?? selectedFlow.check_count ?? 0} checks will run</p>
              )}
            </div>

            {/* Declaration ID */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Declaration ID
              </label>
              <input
                value={declarationId}
                onChange={(e) => setDeclarationId(e.target.value)}
                placeholder="e.g. 158493"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
              <p className="text-xs text-gray-400 mt-1.5">Leave as 158493 for demo mode</p>
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
              {error}
            </div>
          )}

          <button
            onClick={handleRun}
            disabled={!selectedFlowId || !declarationId || running}
            className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold flex items-center justify-center gap-2 transition-colors shadow-sm"
          >
            {running ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Running checks…
              </>
            ) : (
              <>
                <Play size={16} fill="currentColor" />
                Run All Checks
              </>
            )}
          </button>
        </div>

        {/* Running animation */}
        <AnimatePresence>
          {running && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center py-12"
            >
              <div className="relative w-16 h-16 mx-auto mb-4">
                <div className="absolute inset-0 rounded-full border-4 border-blue-100" />
                <div className="absolute inset-0 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Shield size={20} className="text-blue-500" />
                </div>
              </div>
              <p className="text-gray-600 font-medium">Executing checks…</p>
              <p className="text-xs text-gray-400 mt-1">Fetching declaration and running validation pipeline</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Results */}
        {runResult && (
          <div ref={resultsRef}>
            {/* Declaration summary */}
            {runResult.declaration && (
              <DeclarationSummary decl={runResult.declaration} isDemo={runResult.isDemo} />
            )}

            {/* Summary bar */}
            <SummaryBar summary={runResult.summary} />

            {/* Individual results */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                Check Results
                <span className="text-xs font-normal text-gray-400">— click to expand details</span>
              </h3>
              {runResult.results.map((result, i) => (
                <ResultCard key={result.checkId} result={result} index={i} />
              ))}
            </div>

            {/* Re-run */}
            <div className="mt-6 flex justify-center">
              <button
                onClick={handleRun}
                className="flex items-center gap-2 px-5 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-600 text-sm font-medium"
              >
                <RefreshCw size={14} />
                Re-run
              </button>
            </div>

            <p className="text-center text-xs text-gray-400 mt-3">
              Ran at {new Date(runResult.ran_at).toLocaleString()} by {runResult.ran_by}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
