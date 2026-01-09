import { getPerformanceSummary } from "../../api/api";
import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Search,
  RefreshCw,
  Filter,
  Download,
  TrendingUp,
  FileText,
  Zap,
  Briefcase,
  AlertCircle,
  Calendar,
  BarChart3,
  PieChart,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  Flame,
  ShieldCheck,
  AlertTriangle,
  X,
  HelpCircle
} from "lucide-react";
import { Line, Doughnut } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  ArcElement
} from "chart.js";
import { useNavigate } from "react-router-dom";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  ArcElement
);

/* -------------------------------------------------
   Cache Logic
   ------------------------------------------------- */
const CACHE_KEY = "customs-dashboard-analytics-v1";
const CACHE_TTL = 60 * 60 * 1000; // 1 Hour

const readCache = () => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { ts, payload } = JSON.parse(raw);
    return Date.now() - ts < CACHE_TTL ? payload : null;
  } catch {
    return null;
  }
};

const writeCache = (payload) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), payload }));
  } catch { }
};

/* -------------------------------------------------
   Components
   ------------------------------------------------- */

const MetricStrip = ({ label, value, sub, icon: Icon, colorTheme, alertCount = 0, onClick, isActive }) => {
  const themes = {
    gray: "bg-gray-50 border-gray-100 text-gray-900",
    green: "bg-emerald-50 border-emerald-100 text-emerald-700",
    blue: "bg-blue-50 border-blue-100 text-blue-700",
    indigo: "bg-indigo-50 border-indigo-100 text-indigo-700",
    // Active state specifically for the risk card
    activeRisk: "bg-red-50 border-red-200 text-red-700 ring-2 ring-red-100",
  };

  const currentTheme = isActive ? themes.activeRisk : (themes[colorTheme] || themes.gray);

  return (
    <div
      onClick={onClick}
      className={`flex items-center justify-between p-4 rounded-sm border ${currentTheme} transition-all relative overflow-hidden ${onClick ? 'cursor-pointer hover:shadow-sm active:scale-[0.99] select-none' : ''}`}
    >
      <div>
        <p className="text-[10px] uppercase tracking-wider opacity-70 font-bold mb-1">{label}</p>
        <h3 className="text-2xl font-bold">{value}</h3>
        {sub && (
          <div className="flex items-center gap-1 mt-1">
            {alertCount > 0 && <Flame className="w-3 h-3 text-red-500 fill-red-500 animate-pulse" />}
            <p className={`text-[10px] font-medium ${alertCount > 0 ? 'text-red-600 font-bold' : 'opacity-60'}`}>
              {sub}
            </p>
          </div>
        )}
      </div>
      <div className={`p-2 rounded-sm bg-white/50`}>
        <Icon className="w-5 h-5 opacity-80" />
      </div>
    </div>
  );
};

// Simple Progress Bar for Consistency
const ConsistencyBar = ({ score }) => {
  let color = "bg-red-400";
  if (score > 60) color = "bg-orange-400";
  if (score > 80) color = "bg-blue-400";
  if (score > 90) color = "bg-emerald-500";

  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }}></div>
      </div>
      <span className="text-[9px] font-bold text-gray-500">{score}%</span>
    </div>
  )
}

const CustomsDashboard = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState("all"); // 'all' | 'risk'
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [data, setData] = useState({ users: [], globalStats: {}, dates: [] });
  const [error, setError] = useState(null);
  const [showCharts, setShowCharts] = useState(true);

  const fetchData = useCallback(async (force = false) => {
    if (force) setIsRefreshing(true);
    else setLoading(true);
    setError(null);

    // 1. Cache
    if (!force) {
      const cached = readCache();
      if (cached) {
        setData(cached);
        setLoading(false);
        return;
      }
    }

    // 2. Network
    try {
      // Use the new optimized Logic App fetch
      const result = await getPerformanceSummary();

      // Legacy support: result might be array or object with users_summary
      const usersList = Array.isArray(result) ? result : (result.users_summary || []);

      // Determine Dates (Sort assuming DD/MM)
      const allDatesSet = new Set();
      usersList.forEach(u => Object.keys(u.daily_file_creations || {}).forEach(d => allDatesSet.add(d)));
      const sortedDates = Array.from(allDatesSet).sort((a, b) => {
        const [d1, m1] = a.split('/').map(Number);
        const [d2, m2] = b.split('/').map(Number);
        if (Math.abs(m1 - m2) > 6) return m1 > m2 ? -1 : 1;
        if (m1 !== m2) return m1 - m2;
        return d1 - d2;
      });

      // Keep only last 10 days
      const relevantDates = sortedDates.slice(-10);

      const processedUsers = usersList.map(u => {
        // Filter strictly to visible range (context)
        const visibleValues = relevantDates.map(d => u.daily_file_creations[d] || 0);

        // Filter strictly to active days (ignore off-days/zeros)
        const activeValues = visibleValues.filter(v => v > 0);

        const total = visibleValues.reduce((a, b) => a + b, 0);
        const activeDays = activeValues.length;
        const avg = activeDays > 0 ? total / activeDays : 0;

        // --- Metric 1: Consistency Score ---
        let variance = 0;
        if (activeDays > 1) {
          const sumDiffSquares = activeValues.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0);
          variance = sumDiffSquares / activeDays;
        }
        const stdDev = Math.sqrt(variance);
        const cv = avg > 0 ? stdDev / avg : 0;

        // Scaled to be less harsh
        let consistency = Math.max(0, Math.min(100, 100 - (cv * 50)));
        if (activeDays < 2) consistency = 50;

        // --- Metric 2: Burnout Risk ---
        const recentActivity = activeValues.slice(-3);
        let burnoutRisk = false;
        if (recentActivity.length >= 3 && activeDays >= 3 && avg > 5) {
          // Only flag if consistently 30%+ above average
          burnoutRisk = recentActivity.every(val => val > (avg * 1.3));
        }

        return {
          ...u,
          displayName: u.user.replace(/\./g, " "),
          totalFiles: total,
          efficiency: avg,
          activeDays: activeDays,
          daily_file_creations: u.daily_file_creations || {},
          consistencyScore: Math.round(consistency),
          burnoutRisk: burnoutRisk
        };
      });

      // Global Totals
      const totalFiles = processedUsers.reduce((acc, u) => acc + u.totalFiles, 0);
      const totalImport = processedUsers.filter(u => u.team === 'import').reduce((acc, u) => acc + u.totalFiles, 0);
      const totalExport = processedUsers.filter(u => u.team === 'export').reduce((acc, u) => acc + u.totalFiles, 0);
      const totalBurnout = processedUsers.filter(u => u.burnoutRisk).length;

      const payload = {
        users: processedUsers,
        globalStats: { totalFiles, totalImport, totalExport, totalBurnout },
        dates: relevantDates
      };

      setData(payload);
      writeCache(payload);
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to load statistics");
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filteredUsers = useMemo(() => {
    return data.users.filter(u => {
      const matchName = u.user.toLowerCase().includes(searchTerm.toLowerCase());
      const matchTeam = activeTab === "all" || u.team === activeTab;
      // Risk Filter
      const matchRisk = viewMode === 'risk' ? u.burnoutRisk : true;
      return matchName && matchTeam && matchRisk;
    }).sort((a, b) => b.totalFiles - a.totalFiles);
  }, [data.users, searchTerm, activeTab, viewMode]);

  const dailyTotals = useMemo(() => {
    const totals = {};
    if (!data.dates) return totals;
    data.dates.forEach(date => {
      totals[date] = filteredUsers.reduce((sum, user) => sum + (user.daily_file_creations[date] || 0), 0);
    });
    return totals;
  }, [filteredUsers, data.dates]);

  const grandTotal = useMemo(() => filteredUsers.reduce((sum, u) => sum + u.totalFiles, 0), [filteredUsers]);

  const trendData = useMemo(() => {
    if (!data.dates.length) return null;
    const importDs = data.dates.map(d => data.users.filter(u => u.team === 'import').reduce((s, u) => s + (u.daily_file_creations[d] || 0), 0));
    const exportDs = data.dates.map(d => data.users.filter(u => u.team === 'export').reduce((s, u) => s + (u.daily_file_creations[d] || 0), 0));

    return {
      labels: data.dates,
      datasets: [
        { label: 'Import', data: importDs, borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', fill: true, tension: 0.3 },
        { label: 'Export', data: exportDs, borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', fill: true, tension: 0.3 }
      ]
    };
  }, [data]);

  const teamDistData = useMemo(() => {
    return {
      labels: ['Import', 'Export'],
      datasets: [{
        data: [data.globalStats.totalImport, data.globalStats.totalExport],
        backgroundColor: ['#3b82f6', '#10b981'],
        borderWidth: 0,
      }]
    };
  }, [data.globalStats]);

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-gray-50"><RefreshCw className="w-8 h-8 text-blue-500 animate-spin" /></div>;
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>;

  const importShare = data.globalStats.totalFiles ? Math.round((data.globalStats.totalImport / data.globalStats.totalFiles) * 100) : 0;

  return (
    <div className="min-h-screen bg-gray-50 p-4 font-sans text-slate-800">

      {/* Main Container - Full Width */}
      <div className="w-full bg-white border border-gray-200 rounded-sm shadow-sm overflow-hidden">

        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-gray-900 uppercase tracking-tight">Performance Analytics</h1>
            <p className="text-xs text-gray-500 mt-1">HR & Flow Intelligence: Monitor productivity consistency and Team Health.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCharts(!showCharts)}
              className={`px-3 py-1.5 text-xs font-bold uppercase rounded-sm border transition-colors ${showCharts ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
            >
              {showCharts ? 'Hide Visuals' : 'Show Visuals'}
            </button>
            <button
              onClick={() => fetchData(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-sm text-xs font-bold uppercase hover:bg-emerald-100 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>Live</span>
            </button>
          </div>
        </div>

        {/* Metrics Strip */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-6 bg-white border-b border-gray-100">
          <MetricStrip
            label="Total Executions"
            value={data.globalStats.totalFiles.toLocaleString()}
            icon={FileText}
            colorTheme="gray"
          />
          <MetricStrip
            label="Import Volume"
            value={data.globalStats.totalImport.toLocaleString()}
            sub={`${importShare}% of total`}
            icon={ArrowDownRight}
            colorTheme="blue"
          />
          <MetricStrip
            label="Export Volume"
            value={data.globalStats.totalExport.toLocaleString()}
            sub={`${100 - importShare}% of total`}
            icon={ArrowUpRight}
            colorTheme="green"
          />
          <MetricStrip
            label="Workforce Health"
            value={data.users.length.toString()}
            sub={data.globalStats.totalBurnout > 0 ? `${data.globalStats.totalBurnout} Overheating` : "All Systems Stable"}
            alertCount={data.globalStats.totalBurnout}
            icon={viewMode === 'risk' ? X : Activity}
            colorTheme="indigo"
            isActive={viewMode === 'risk'}
            onClick={() => setViewMode(prev => prev === 'risk' ? 'all' : 'risk')}
          />
        </div>

        {/* Chart Section */}
        {showCharts && viewMode !== 'risk' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6 border-b border-gray-100 bg-gray-50/30">
            <div className="lg:col-span-2 bg-white p-4 rounded-sm border border-gray-200 shadow-sm">
              <h3 className="text-xs font-bold text-gray-500 uppercase mb-4">Volume Trends (Last 10 Days)</h3>
              <div className="h-40">
                {trendData && <Line
                  data={trendData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'top', align: 'end', labels: { boxWidth: 6, usePointStyle: true, font: { size: 10 } } } },
                    scales: { x: { grid: { display: false }, ticks: { font: { size: 10 } } }, y: { border: { display: false }, ticks: { font: { size: 10 } } } }
                  }}
                />}
              </div>
            </div>
            <div className="bg-white p-4 rounded-sm border border-gray-200 shadow-sm flex flex-col relative">
              <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">Flow Distribution</h3>
              <div className="flex-1 flex items-center justify-center">
                <div className="w-28 h-28">
                  {teamDistData && <Doughnut
                    data={teamDistData}
                    options={{ cutout: '75%', plugins: { legend: { display: false } } }}
                  />}
                </div>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none mt-6">
                  <span className="text-lg font-bold text-gray-900">{importShare}%</span>
                  <span className="text-[9px] uppercase text-gray-400 font-bold">Import</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white">
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              placeholder="Search reference..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-1.5 bg-white border border-gray-200 rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all placeholder:text-gray-400"
            />
          </div>

          <div className="flex items-center gap-2">
            {viewMode === 'risk' && (
              <div className="flex items-center gap-2 mr-4 bg-red-50 px-3 py-1 rounded-sm border border-red-100 animate-in fade-in slide-in-from-right-4 duration-300">
                <Flame className="w-3.5 h-3.5 text-red-500" />
                <span className="text-xs font-bold text-red-700 uppercase">Filtered: High Risk Only</span>
                <button onClick={() => setViewMode('all')} className="ml-2 hover:bg-red-200 rounded-sm p-0.5"><X className="w-3 h-3 text-red-700" /></button>
              </div>
            )}
            {['all', 'import', 'export'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm border transition-all ${activeTab === tab
                  ? 'bg-gray-800 text-white border-gray-800'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Table - 10 Days View */}
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-y border-gray-100">
              <tr>
                <th className="px-6 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-50 z-10">User Reference</th>
                <th className="px-6 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider text-center">Team</th>
                {/* Dynamic Days */}
                {data.dates.map(date => (
                  <th key={date} className="px-2 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider text-center min-w-[50px]">
                    {date}
                  </th>
                ))}
                <th className="px-6 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider text-center bg-gray-100/50">Total</th>
                <th className="px-6 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                  <div className="flex items-center gap-1 group relative">
                    <span>Stability Plan</span>
                    <HelpCircle className="w-3 h-3 text-gray-400 cursor-help" />
                    {/* Tooltip - appears below to avoid overflow clipping */}
                    <div className="absolute top-full right-0 mt-2 px-4 py-3 bg-gray-900 text-white text-[10px] rounded-sm shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 w-72 z-[9999] normal-case font-normal leading-relaxed">
                      <div className="absolute top-0 right-4 -translate-y-full border-4 border-transparent border-b-gray-900"></div>

                      <p className="font-bold text-[11px] mb-2 text-emerald-400">📊 What is Stability Score?</p>
                      <p className="mb-2 text-gray-300">The Stability Score measures how <span className="text-white font-medium">consistent</span> a team member's daily work output is over the selected time period.</p>

                      <p className="font-bold text-[11px] mb-1 text-blue-400">🔍 How is it calculated?</p>
                      <p className="mb-2 text-gray-300">It analyzes the <span className="text-white font-medium">variance</span> in daily file creation. Lower variance = higher stability. Someone who processes 10-12 files daily scores higher than someone who does 0 one day and 30 the next.</p>

                      <p className="font-bold text-[11px] mb-1 text-orange-400">📈 Score Ranges:</p>
                      <ul className="space-y-1 mb-2">
                        <li className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0"></span> <span><strong className="text-emerald-400">90%+</strong> Excellent - Very consistent output</span></li>
                        <li className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0"></span> <span><strong className="text-blue-400">80-90%</strong> Good - Mostly stable</span></li>
                        <li className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-orange-400 flex-shrink-0"></span> <span><strong className="text-orange-400">60-80%</strong> Fair - Some variation</span></li>
                        <li className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0"></span> <span><strong className="text-red-400">&lt;60%</strong> Variable - Inconsistent pattern</span></li>
                      </ul>

                      <div className="pt-2 border-t border-gray-700 text-gray-400 text-[9px]">
                        💡 <em>Use this to identify workload distribution issues, not individual performance.</em>
                      </div>
                    </div>
                  </div>
                </th>
              </tr>

              {/* Summary Row */}
              <tr className="bg-gray-50/50 border-b border-gray-200">
                <th className="px-6 py-2 sticky left-0 bg-gray-50 z-20">
                  <div className="text-[10px] font-bold text-gray-400 uppercase text-right w-full flex justify-end items-center gap-2">
                    <TrendingUp className="w-3 h-3 text-gray-400" />
                    <span>Daily Volume:</span>
                  </div>
                </th>
                <th></th> {/* Team spacer */}
                {data.dates.map(date => (
                  <th key={`sum-${date}`} className="px-2 py-2 text-[10px] font-bold text-blue-600 text-center bg-blue-50/30">
                    {dailyTotals[date] || 0}
                  </th>
                ))}
                <th className="px-6 py-2 text-[10px] font-bold text-gray-900 text-center bg-gray-100/50">
                  {grandTotal}
                </th>
                <th></th> {/* Stability spacer */}
              </tr>

            </thead>
            <tbody className="divide-y divide-gray-50 bg-white">
              {filteredUsers.map((user, index) => {
                return (
                  <tr key={`${user.user}-${user.team}-${index}`} className="hover:bg-gray-50/80 transition-colors group cursor-pointer" onClick={() => navigate(`/statistics/performance/${user.user}`)}>
                    <td className="px-6 py-3 sticky left-0 bg-white group-hover:bg-gray-50/80 z-10 border-r border-transparent group-hover:border-gray-100">
                      <div className="flex items-center gap-3">
                        <div className={`w-6 h-6 rounded-sm flex items-center justify-center text-[10px] font-bold relative ${user.team === 'import' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {user.user.charAt(0).toUpperCase()}
                          {user.burnoutRisk && (
                            <div className="absolute -top-1.5 -right-1.5 bg-white rounded-full p-0.5">
                              <Flame className="w-3 h-3 text-red-500 fill-red-500 animate-pulse" />
                            </div>
                          )}
                        </div>
                        <div>
                          <span className="text-xs font-semibold text-gray-700 block">{user.displayName}</span>
                          {user.burnoutRisk && <span className="text-[8px] text-red-500 font-bold uppercase tracking-wide">High Risk</span>}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-3 text-center">
                      <span className={`px-1.5 py-0.5 rounded-sm text-[9px] font-bold uppercase tracking-wide border ${user.team === 'import' ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'
                        }`}>
                        {user.team}
                      </span>
                    </td>

                    {/* Daily Columns */}
                    {data.dates.map(date => {
                      const val = user.daily_file_creations[date] || 0;
                      let bgClass = "bg-transparent text-gray-300";
                      if (val > 0) bgClass = "bg-slate-50 text-slate-600";
                      if (val > 5) bgClass = "bg-blue-50 text-blue-700";
                      if (val > 15) bgClass = "bg-blue-100 text-blue-800 font-bold";
                      if (val > 30) bgClass = "bg-blue-200 text-blue-900 font-bold";

                      return (
                        <td key={date} className="px-2 py-3 text-center">
                          <div className={`mx-auto w-8 h-6 flex items-center justify-center rounded-sm text-xs ${val > 0 ? bgClass : ""}`}>
                            {val > 0 ? val : '-'}
                          </div>
                        </td>
                      )
                    })}

                    <td className="px-6 py-3 text-center bg-gray-50/30 border-l border-gray-50 font-bold text-xs text-gray-800">
                      {user.totalFiles}
                    </td>

                    <td className="px-6 py-3">
                      <ConsistencyBar score={user.consistencyScore} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Footer */}
          {filteredUsers.length === 0 ? (
            <div className="p-12 text-center text-gray-400 text-xs uppercase tracking-wide">
              {viewMode === 'risk' ? "Great News! No one is currently at risk." : "No data available"}
            </div>
          ) : (
            <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between bg-gray-50/50">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Results: {filteredUsers.length}</span>
              <div className="flex items-center gap-1">
                <div className="w-6 h-6 flex items-center justify-center rounded-sm border border-gray-200 bg-white text-xs text-gray-400 cursor-not-allowed">{'<'}</div>
                <div className="w-6 h-6 flex items-center justify-center rounded-sm border border-gray-200 bg-white text-xs text-gray-600 hover:bg-gray-50 cursor-pointer">{'>'}</div>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

export default CustomsDashboard;