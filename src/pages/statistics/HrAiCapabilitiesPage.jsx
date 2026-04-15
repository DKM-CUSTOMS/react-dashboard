import React, { useState } from 'react';
import { Brain, BarChart3, Users, TrendingUp, AlertTriangle, Scale, Trash2, Calendar, GitCompare, Zap, CheckCircle2, Clock, ChevronRight, Sparkles, Target, BookOpen, Cpu } from 'lucide-react';

const CAPABILITIES = [
  {
    id: 'monthly',
    icon: Calendar,
    color: 'blue',
    title: 'Monthly Performance Report',
    status: 'live',
    replaces: 'Monthly Report page',
    description: 'Full calendar-month performance breakdown grouped by team. Ranks employees within each team, shows manual/auto split, avg files per active day, modifications, deletions, and flags anyone below the 13-file/day minimum.',
    triggers: ['"Monthly report"', '"How did the team do this month?"', '"Monthly rankings"', '"Who had the most files in March?"', '"Month-over-month comparison"'],
    outputFormats: ['Ranked team table', 'Dashboard KPI cards', 'Bar chart per team', 'CSV export', 'Underperformer flags'],
    params: ['month (YYYY-MM, default: current)', 'team_name (optional filter)'],
  },
  {
    id: 'compare',
    icon: GitCompare,
    color: 'purple',
    title: 'Employee Comparison Engine',
    status: 'live',
    replaces: 'Compare page (2–6 limit removed)',
    description: 'Side-by-side comparison of any number of employees. Computes efficiency scores (0–100), consistency scores, workload capacity, automation rates, and principal specialization depth. Includes a principal distribution table and capacity headroom bars.',
    triggers: ['"Compare X and Y"', '"Who is better between A and B?"', '"Head-to-head: X vs Y vs Z"', '"Contrast performance this month"'],
    outputFormats: ['Metrics table', 'Rankings per dimension', 'Principal distribution matrix', 'Capacity utilization bars', 'Decision log (copy-paste actions)'],
    params: ['employee_names (2+)', 'start_date / end_date (optional)'],
  },
  {
    id: 'assignment',
    icon: Target,
    color: 'green',
    title: 'Principal Assignment Planner',
    status: 'live',
    replaces: 'Manual work-distribution decisions',
    description: 'Scores every employee for each principal using three factors: exposure history (prior files with that client), efficiency score, and capacity headroom. Outputs PRIMARY + BACKUP assignments for every principal with a numbered copy-paste action list.',
    triggers: ['"Who should handle LEVACO?"', '"Redistribute principals across the team"', '"Work distribution plan for Import"', '"Assign these clients to the team"', '"How do I spread this workload?"'],
    outputFormats: ['Scored assignment table per principal', 'Primary + backup per client', 'Copy-paste action list', 'Concentration risk alerts (>70% one person)'],
    params: ['principals (optional list)', 'team_name (optional)', 'start_date / end_date (optional)'],
  },
  {
    id: 'underperf',
    icon: AlertTriangle,
    color: 'orange',
    title: 'Underperformance Pattern Scanner',
    status: 'live',
    replaces: 'Manual weekly reviews',
    description: 'Scans all employees for five pattern types: chronic below-target output (<13/day), inactivity streaks (3+ consecutive zero days), sudden output drops (35%+ week-over-week), high cross-deletion rates, and spike-crash volatility. Returns severity-ranked findings (CRITICAL / HIGH / MEDIUM / LOW) with a prioritized 1:1 action list.',
    triggers: ['"Who is underperforming?"', '"Weekly audit"', '"Any red flags this month?"', '"Who needs attention?"', '"Performance review prep"'],
    outputFormats: ['Severity-ranked employee list', 'Per-finding breakdown with detail', 'Priority action list (who to meet first)'],
    params: ['days_back (default 30)', 'min_active_days (default 5)'],
  },
  {
    id: 'workload',
    icon: Scale,
    color: 'teal',
    title: 'Workload Balance Analyzer',
    status: 'live',
    replaces: 'Gut-feel rebalancing decisions',
    description: 'Calculates each team member\'s current load vs their personal peak capacity. Flags overloaded (>22/day or >85% of peak) and underutilized (<10/day) employees. Proposes concrete file-count transfers — matched by shared principal exposure for smooth handover — with before/after projections.',
    triggers: ['"Is the Import team balanced?"', '"Who is overloaded?"', '"How to rebalance the team?"', '"Capacity planning for next month"', '"Workload distribution"'],
    outputFormats: ['Visual capacity bars per employee', 'Overloaded / on-target / underutilized classification', 'Rebalancing transfer suggestions', 'Before/after daily-rate projections'],
    params: ['team_name (required)', 'start_date / end_date (optional, default: last 30 days)'],
  },
  {
    id: 'deletion',
    icon: Trash2,
    color: 'red',
    title: 'Cross-Deletion Audit',
    status: 'live',
    replaces: 'Manual deletion review',
    description: 'Investigates who is deleting files created by other employees. Shows volumes, cross-deletion as % of total deletions, and cross-deletion as % of own output. Flags employees where cross-deletions exceed 10 files AND represent >30% of their total deletions.',
    triggers: ['"Who is deleting other people\'s work?"', '"Deletion audit"', '"Quality control review"', '"Cross-deletion patterns"', '"Check deletions for the Export team"'],
    outputFormats: ['Deletion table (own vs cross)', 'Cross-deletion rate per employee', 'Flagged employees with investigation prompts'],
    params: ['team_name (optional)', 'start_date / end_date (optional)'],
  },
  {
    id: 'individual',
    icon: Users,
    color: 'indigo',
    title: 'Individual Employee Deep Dive',
    status: 'live',
    description: 'Full 120-day profile for a single employee: daily metrics, peak hours, company + principal specialization, file type breakdown, deletion stats, avg creation time, workload consistency classification (Steady / Spiky / Flexible), and inactivity days.',
    triggers: ['"Tell me about Fadwa\'s performance"', '"What did Ayoub do last week?"', '"Deep dive on Sana"', '"Fadwa January vs February"'],
    outputFormats: ['Summary stats', 'Daily metrics table', 'Period totals when date-filtered', 'Specialization breakdown'],
    params: ['employee_name', 'start_date / end_date (optional)'],
  },
  {
    id: 'team',
    icon: BarChart3,
    color: 'cyan',
    title: 'Team Overview',
    status: 'live',
    description: 'Aggregated performance for a team with full sub-team hierarchy support. Shows per-member totals, deletions, top clients, top principals. Understands that Import → Sub-A, Sub-B structure and collects all members correctly.',
    triggers: ['"How is the Import team doing?"', '"Team overview for Export"', '"Compare sub-teams"'],
    outputFormats: ['Team hierarchy display', 'Per-member performance', 'Team totals', 'Date-filtered period stats'],
    params: ['team_name', 'start_date / end_date (optional)'],
  },
];

const GENERATIVE_UI = [
  { type: 'chart / barchart', desc: 'Interactive bar chart rendered inline — auto-infers bars from data keys', example: '```chart\n{ "title": "...", "xAxisKey": "name", "data": [...] }\n```' },
  { type: 'linechart / line', desc: 'Multi-line trend chart — supports multiple series with auto-color', example: '```linechart\n{ "title": "...", "xAxisKey": "date", "data": [...] }\n```' },
  { type: 'piechart / donut', desc: 'Pie or donut chart for distribution breakdowns', example: '```piechart\n{ "donut": true, "data": [...] }\n```' },
  { type: 'dashboard', desc: 'KPI metric cards — shows value + optional trend %, auto-grid layout', example: '```dashboard\n{ "metrics": [{ "title": "...", "value": 1245, "trend": 12 }] }\n```' },
  { type: 'export', desc: 'Download button — renders a CSV export from any data array', example: '```export\n{ "title": "...", "filename": "report.csv", "data": [...] }\n```' },
];

const ROADMAP = [
  { title: 'Month-over-month trend indicators', status: 'planned', desc: 'Auto-compare current month vs previous and add trend arrows to monthly report.' },
  { title: 'Principal difficulty scoring', status: 'planned', desc: 'Score each principal by avg mods/file across all handlers. Use to assign complex clients only to high-efficiency employees.' },
  { title: 'Team load forecasting', status: 'planned', desc: 'Based on last 30-day trend, project next month output per team. Flag if projected total falls below target.' },
  { title: 'Manager memory (custom instructions)', status: 'live', desc: 'Managers can set persona instructions via the Settings button — stored per email, injected into every prompt.' },
  { title: 'Context-aware follow-up pills', status: 'live', desc: 'After compare → pills suggest "Who should take PRINCIPAL X?". After monthly report → pills suggest "Who is below target?".' },
  { title: 'Persistent chat history', status: 'live', desc: '5-hour session restore on page reload. Full sidebar with named chats and delete.' },
  { title: 'Incognito mode', status: 'live', desc: 'Non-persistent chats — no history saved, no title generated.' },
  { title: 'Sub-team hierarchy awareness', status: 'live', desc: 'Import team includes all Sub-A, Sub-B members with senior/leader labels.' },
];

const colorMap = {
  blue: { bg: 'bg-blue-50', border: 'border-blue-200', icon: 'text-blue-600', badge: 'bg-blue-100 text-blue-700' },
  purple: { bg: 'bg-purple-50', border: 'border-purple-200', icon: 'text-purple-600', badge: 'bg-purple-100 text-purple-700' },
  green: { bg: 'bg-green-50', border: 'border-green-200', icon: 'text-green-600', badge: 'bg-green-100 text-green-700' },
  orange: { bg: 'bg-orange-50', border: 'border-orange-200', icon: 'text-orange-600', badge: 'bg-orange-100 text-orange-700' },
  teal: { bg: 'bg-teal-50', border: 'border-teal-200', icon: 'text-teal-600', badge: 'bg-teal-100 text-teal-700' },
  red: { bg: 'bg-red-50', border: 'border-red-200', icon: 'text-red-600', badge: 'bg-red-100 text-red-700' },
  indigo: { bg: 'bg-indigo-50', border: 'border-indigo-200', icon: 'text-indigo-600', badge: 'bg-indigo-100 text-indigo-700' },
  cyan: { bg: 'bg-cyan-50', border: 'border-cyan-200', icon: 'text-cyan-600', badge: 'bg-cyan-100 text-cyan-700' },
};

function CapabilityCard({ cap }) {
  const [open, setOpen] = useState(false);
  const Icon = cap.icon;
  const c = colorMap[cap.color] || colorMap.blue;

  return (
    <div className={`border ${c.border} rounded-xl overflow-hidden bg-white shadow-sm transition-shadow hover:shadow-md`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left p-5 flex items-start gap-4"
      >
        <div className={`mt-0.5 p-2 rounded-lg ${c.bg}`}>
          <Icon size={20} className={c.icon} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-gray-900 text-[15px]">{cap.title}</h3>
            {cap.status === 'live' && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">Live</span>
            )}
            {cap.replaces && (
              <span className="text-[10px] text-gray-400 font-medium">replaces: {cap.replaces}</span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1 leading-relaxed">{cap.description}</p>
        </div>
        <ChevronRight size={16} className={`mt-1 text-gray-400 transition-transform flex-shrink-0 ${open ? 'rotate-90' : ''}`} />
      </button>

      {open && (
        <div className={`border-t ${c.border} ${c.bg} px-5 py-4 space-y-4`}>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2">Example questions that trigger this tool</p>
            <div className="flex flex-wrap gap-2">
              {cap.triggers.map((t, i) => (
                <span key={i} className="text-[12px] bg-white border border-gray-200 text-gray-600 px-2.5 py-1 rounded-lg font-medium">{t}</span>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2">Output formats</p>
              <ul className="space-y-1">
                {cap.outputFormats.map((o, i) => (
                  <li key={i} className="flex items-center gap-2 text-[13px] text-gray-700">
                    <CheckCircle2 size={12} className="text-green-500 flex-shrink-0" />
                    {o}
                  </li>
                ))}
              </ul>
            </div>
            {cap.params && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2">Parameters</p>
                <ul className="space-y-1">
                  {cap.params.map((p, i) => (
                    <li key={i} className="text-[12px] text-gray-600 font-mono bg-white/70 px-2 py-0.5 rounded border border-gray-100">{p}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function HrAiCapabilitiesPage() {
  const totalLive = CAPABILITIES.filter(c => c.status === 'live').length;

  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 bg-primary/10 rounded-xl">
              <Brain size={24} className="text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">HR Intelligence AI</h1>
              <p className="text-sm text-gray-500">Capabilities Guide & Feature Status</p>
            </div>
          </div>
          <p className="text-[15px] text-gray-600 max-w-2xl mt-4 leading-relaxed">
            The HR Intelligence AI is a data-science analyst embedded in the chat interface. It replaces static dashboard pages with
            conversational, decision-ready analysis — from monthly reports to principal work-distribution plans.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <CheckCircle2 size={14} className="text-green-600" />
              <span className="text-[13px] font-semibold text-green-700">{totalLive} tools live</span>
            </div>
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              <Sparkles size={14} className="text-blue-600" />
              <span className="text-[13px] font-semibold text-blue-700">Generative UI (charts, cards, exports)</span>
            </div>
            <div className="flex items-center gap-2 bg-purple-50 border border-purple-200 rounded-lg px-3 py-2">
              <Cpu size={14} className="text-purple-600" />
              <span className="text-[13px] font-semibold text-purple-700">GPT-4o-mini + Python interpreter</span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 mt-8 space-y-10">

        {/* Capabilities */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Zap size={16} className="text-primary" />
            <h2 className="text-[17px] font-bold text-gray-900">What the AI Can Do</h2>
            <span className="text-[11px] text-gray-400 ml-1">Click any card to expand</span>
          </div>
          <div className="space-y-3">
            {CAPABILITIES.map(cap => <CapabilityCard key={cap.id} cap={cap} />)}
          </div>
        </section>

        {/* Generative UI */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={16} className="text-primary" />
            <h2 className="text-[17px] font-bold text-gray-900">Generative UI — Visual Output Formats</h2>
          </div>
          <p className="text-sm text-gray-500 mb-4">The AI renders interactive visuals inline in the chat. All chart types are auto-inferred from data when keys are not specified.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {GENERATIVE_UI.map((ui, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-mono text-[12px] bg-gray-100 text-gray-700 px-2 py-0.5 rounded font-bold">{ui.type}</span>
                </div>
                <p className="text-[13px] text-gray-600">{ui.desc}</p>
                <pre className="mt-2 text-[11px] bg-gray-50 border border-gray-100 rounded p-2 text-gray-500 overflow-x-auto">{ui.example}</pre>
              </div>
            ))}
          </div>
        </section>

        {/* Data Architecture */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <BookOpen size={16} className="text-primary" />
            <h2 className="text-[17px] font-bold text-gray-900">Data Architecture</h2>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { label: 'Employee Performance', source: 'Azure Blob Storage', path: 'Dashboard/cache/usersV3/*.json', detail: 'One JSON per employee. Contains daily_metrics[] (per-day breakdown) and summary (pre-aggregated totals). Hydrated into memory at server startup.', color: 'blue' },
                { label: 'Team Structure', source: 'MySQL Database', path: 'teams, team_members, users tables', detail: 'Full hierarchy: parent_id links sub-teams to parent. Refreshed live on every team query — always reflects latest UserManagement changes.', color: 'green' },
                { label: 'EUR-Lex Legal Notes', source: 'Pinecone Vector DB', path: 'customs-eurlex index', detail: 'Used only by the Customs AI Desk. Semantically searched by HS heading + product type. Not used by HR Intelligence AI.', color: 'purple' },
              ].map((d, i) => (
                <div key={i} className={`border border-${d.color}-200 bg-${d.color}-50 rounded-lg p-4`}>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">{d.label}</p>
                  <p className="text-[13px] font-semibold text-gray-800">{d.source}</p>
                  <p className="text-[11px] font-mono text-gray-500 mt-1 break-all">{d.path}</p>
                  <p className="text-[12px] text-gray-600 mt-2 leading-relaxed">{d.detail}</p>
                </div>
              ))}
            </div>

            <div className="border-t border-gray-100 pt-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2">Per-employee JSON schema (usersV3/*.json)</p>
              <pre className="text-[11px] bg-gray-50 border border-gray-100 rounded p-3 text-gray-600 overflow-x-auto leading-relaxed">{`{
  "user": "FIRSTNAME.LASTNAME",
  "daily_metrics": [
    {
      "date": "YYYY-MM-DD",
      "manual_files_created": N,
      "automatic_files_created": N,
      "modification_count": N,
      "total_files_handled": N,
      "avg_creation_time": N | null,
      "manual_file_ids": ["id1", ...],
      "deleted_own_file_ids": ["id1", ...],
      "deleted_others_file_ids": ["id1", ...]
    }
  ],
  "summary": {
    "total_files_handled": N,
    "avg_files_per_day": N,
    "days_active": N,
    "modifications_per_file": N,
    "principal_specialization": { "LEVACO": N, "TCI CAR": N, ... },
    "company_specialization": { "DKM": N, "TCI": N, ... },
    "manual_vs_auto_ratio": { "manual_percent": N, "automatic_percent": N },
    "activity_by_hour": { "8": N, "9": N, ..., "17": N },
    "most_productive_day": "YYYY-MM-DD",
    "total_deletions": N,
    "deleted_own_files": N,
    "deleted_others_files": N
  }
}`}</pre>
            </div>
          </div>
        </section>

        {/* Roadmap */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={16} className="text-primary" />
            <h2 className="text-[17px] font-bold text-gray-900">Feature Status & Roadmap</h2>
          </div>
          <div className="space-y-2">
            {ROADMAP.map((item, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-xl px-4 py-3.5 flex items-start gap-3 shadow-sm">
                <div className={`mt-0.5 flex-shrink-0 ${item.status === 'live' ? 'text-green-500' : 'text-gray-300'}`}>
                  {item.status === 'live' ? <CheckCircle2 size={16} /> : <Clock size={16} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[14px] font-semibold text-gray-800">{item.title}</p>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${item.status === 'live' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {item.status === 'live' ? 'Live' : 'Planned'}
                    </span>
                  </div>
                  <p className="text-[12px] text-gray-500 mt-0.5">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Quick start */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Sparkles size={16} className="text-primary" />
            <h2 className="text-[17px] font-bold text-gray-900">Quick Start — Try These Prompts</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { q: 'Monthly report for April', tag: 'Monthly Report' },
              { q: 'Compare Fadwa, Ayoub and Sana this month', tag: 'Compare' },
              { q: 'Who should handle LEVACO and TCI CAR in the Import team?', tag: 'Assignment' },
              { q: 'Any underperformance patterns in the last 30 days?', tag: 'Audit' },
              { q: 'Is the Export team workload balanced?', tag: 'Balance' },
              { q: 'Who is deleting other people\'s files?', tag: 'Deletion' },
              { q: 'How did Ikram do last week vs the week before?', tag: 'Individual' },
              { q: 'Show me the Import team structure and who the seniors are', tag: 'Teams' },
            ].map((item, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-start gap-3 shadow-sm hover:border-primary/30 hover:shadow-md transition-all">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary flex-shrink-0 mt-0.5">{item.tag}</span>
                <p className="text-[13px] text-gray-700 font-medium">{item.q}</p>
              </div>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}
