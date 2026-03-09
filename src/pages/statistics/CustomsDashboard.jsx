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
  TrendingDown
} from "lucide-react";
import { getTeamTailwindColors, getTeamHexColor } from "../../utils/teamColors";
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
const CACHE_KEY = "customs-dashboard-analytics-v3";
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

const MetricStrip = ({ label, value, sub, icon: Icon, colorTheme }) => {
  const themes = {
    gray: "bg-gray-50 border-gray-100 text-gray-900",
    green: "bg-emerald-50 border-emerald-100 text-emerald-700",
    blue: "bg-blue-50 border-blue-100 text-blue-700",
    indigo: "bg-indigo-50 border-indigo-100 text-indigo-700",
  };

  const currentTheme = themes[colorTheme] || themes.gray;

  return (
    <div className={`flex items-center justify-between p-4 rounded-sm border ${currentTheme} transition-all relative overflow-hidden`}>
      <div>
        <p className="text-[10px] uppercase tracking-wider opacity-70 font-bold mb-1">{label}</p>
        <h3 className="text-2xl font-bold">{value}</h3>
        {sub && (
          <p className="text-[10px] font-medium opacity-60 mt-1">{sub}</p>
        )}
      </div>
      <div className="p-2 rounded-sm bg-white/50">
        <Icon className="w-5 h-5 opacity-80" />
      </div>
    </div>
  );
};



const CustomsDashboard = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [data, setData] = useState({ users: [], globalStats: {}, dates: [] });
  const [error, setError] = useState(null);
  const [showCharts, setShowCharts] = useState(true);

  const getColorForTeam = (teamName) => {
    return getTeamTailwindColors(teamName);
  };

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

      let dbTeams = [];
      try {
        const tmRes = await fetch('/api/teams');
        if (tmRes.ok) {
          const tData = await tmRes.json();
          if (tData.success) dbTeams = tData.teams || [];
        }
      } catch (e) { console.warn("CustomsDashboard: Failed to fetch db teams", e); }

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

        const uId = u.user || '';
        const matchedTeam = dbTeams.find(t => t.members.some(m => m.toLowerCase() === uId.toLowerCase()));
        let finalTeam = u.team || 'Unassigned';
        if (matchedTeam) {
          if (matchedTeam.parent_id) {
            const parentTeam = dbTeams.find(t => t.id === matchedTeam.parent_id);
            finalTeam = parentTeam ? parentTeam.name : matchedTeam.name;
          } else {
            finalTeam = matchedTeam.name;
          }
        }

        return {
          ...u,
          team: finalTeam,
          displayName: u.user.replace(/\./g, " "),
          totalFiles: total,
          efficiency: avg,
          activeDays: activeDays,
          daily_file_creations: u.daily_file_creations || {},
        };
      });

      // Global Totals
      const totalFiles = processedUsers.reduce((acc, u) => acc + u.totalFiles, 0);
      const totalImport = processedUsers.filter(u => u.team && u.team.trim().toLowerCase() === 'import').reduce((acc, u) => acc + u.totalFiles, 0);
      const totalExport = processedUsers.filter(u => u.team && u.team.trim().toLowerCase() === 'export').reduce((acc, u) => acc + u.totalFiles, 0);

      const teamsDist = {};
      dbTeams.filter(t => !t.parent_id).forEach(t => { teamsDist[t.name] = 0; });

      processedUsers.forEach(u => {
        teamsDist[u.team] = (teamsDist[u.team] || 0) + u.totalFiles;
      });
      const sortedTeams = Object.keys(teamsDist).sort((a, b) => teamsDist[b] - teamsDist[a]);

      const payload = {
        users: processedUsers,
        globalStats: { totalFiles, totalImport, totalExport, teamsDist, sortedTeams },
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
      const matchTeam = activeTab === "all" || (u.team && u.team.trim().toLowerCase() === activeTab.trim().toLowerCase());
      return matchName && matchTeam;
    }).sort((a, b) => b.totalFiles - a.totalFiles);
  }, [data.users, searchTerm, activeTab]);

  const dailyTotals = useMemo(() => {
    const totals = {};
    if (!data.dates) return totals;
    data.dates.forEach(date => {
      totals[date] = filteredUsers.reduce((sum, user) => sum + (user.daily_file_creations[date] || 0), 0);
    });
    return totals;
  }, [filteredUsers, data.dates]);

  const grandTotal = useMemo(() => filteredUsers.reduce((sum, u) => sum + u.totalFiles, 0), [filteredUsers]);

  // --- Per-Day Peer Benchmarking ---
  // A "busy day" is one where the team's active-user average is >= 10 files.
  // A user is flagged as underperforming if they worked that day (val > 0)
  // but did less than 55% of the team's daily average.
  const dailyPeerStats = useMemo(() => {
    const stats = {};
    data.dates.forEach(date => {
      const activeVals = filteredUsers
        .map(u => u.daily_file_creations[date] || 0)
        .filter(v => v > 0);

      if (activeVals.length < 2) {
        stats[date] = { avg: 0, threshold: 0, isBusyDay: false };
        return;
      }

      const avg = activeVals.reduce((a, b) => a + b, 0) / activeVals.length;
      stats[date] = {
        avg: Math.round(avg * 10) / 10,
        threshold: avg * 0.55,
        isBusyDay: avg >= 10,
      };
    });
    return stats;
  }, [filteredUsers, data.dates]);

  const trendData = useMemo(() => {
    if (!data.dates || !data.dates.length) return null;
    const datasets = (data.globalStats?.sortedTeams || []).slice(0, 5).map((team, idx) => {
      const teamDs = data.dates.map(d => data.users.filter(u => u.team === team).reduce((s, u) => s + (u.daily_file_creations[d] || 0), 0));
      const teamHex = getTeamHexColor(team);
      return {
        label: team,
        data: teamDs,
        borderColor: teamHex,
        backgroundColor: `${teamHex}1a`,
        fill: true, tension: 0.3
      };
    });
    return { labels: data.dates, datasets };
  }, [data]);

  const teamDistData = useMemo(() => {
    if (!data.globalStats?.sortedTeams) return null;
    const topTeams = data.globalStats.sortedTeams.slice(0, 5);
    return {
      labels: topTeams,
      datasets: [{
        data: topTeams.map(t => data.globalStats.teamsDist[t]),
        backgroundColor: topTeams.map(t => getTeamHexColor(t)),
        borderWidth: 0,
      }]
    };
  }, [data.globalStats]);

  // Build per-team volumes for the metric cards (all known teams)
  // NOTE: Must be above all early returns to comply with Rules of Hooks
  const teamMetrics = useMemo(() => {
    const sortedTeams = data.globalStats?.sortedTeams || [];
    const teamsDist = data.globalStats?.teamsDist || {};
    const total = data.globalStats?.totalFiles || 0;
    return sortedTeams
      .filter(t => t !== 'Unassigned')
      .map(t => ({
        name: t,
        value: teamsDist[t] || 0,
        pct: total > 0 ? Math.round(((teamsDist[t] || 0) / total) * 100) : 0
      }));
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
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3 p-4 bg-white border-b border-gray-100">
          <MetricStrip
            label="Total Executions"
            value={data.globalStats.totalFiles.toLocaleString()}
            icon={FileText}
            colorTheme="gray"
          />
          {teamMetrics.map((tm, idx) => {
            const colorThemes = ['blue', 'green', 'indigo', 'gray', 'blue'];
            return (
              <MetricStrip
                key={tm.name}
                label={`${tm.name} Volume`}
                value={tm.value.toLocaleString()}
                sub={`${tm.pct}% of total`}
                icon={idx % 2 === 0 ? ArrowDownRight : ArrowUpRight}
                colorTheme={colorThemes[idx % colorThemes.length]}
              />
            );
          })}
          <MetricStrip
            label="Active Declarants"
            value={data.users.length.toString()}
            sub="Team Members"
            icon={Activity}
            colorTheme="indigo"
          />
        </div>

        {/* Chart Section */}
        {showCharts && (
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

          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar max-w-full">
            <button
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm border transition-all shrink-0 ${activeTab === 'all'
                ? 'bg-gray-800 text-white border-gray-800'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
            >
              All
            </button>
            {(data.globalStats.sortedTeams || []).map(tab => {
              if (tab.toLowerCase() === 'all') return null;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm border transition-all shrink-0 ${activeTab === tab
                    ? 'bg-gray-800 text-white border-gray-800'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }`}
                >
                  {tab}
                </button>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="px-6 py-2 border-t border-gray-100 flex items-center gap-4 bg-gray-50/50">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-blue-100 border border-blue-200"></div>
            <span className="text-[10px] text-gray-500 font-medium">Normal output</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-amber-100 border border-amber-300"></div>
            <TrendingDown className="w-3 h-3 text-amber-500" />
            <span className="text-[10px] text-amber-700 font-medium">Low effort — below 55% of team avg on a high-volume day</span>
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
              </tr>

            </thead>
            <tbody className="divide-y divide-gray-50 bg-white">
              {filteredUsers.map((user, index) => {
                const teamColors = getColorForTeam(user.team);
                return (
                  <tr key={`${user.user}-${user.team}-${index}`} className="hover:bg-gray-50/80 transition-colors group cursor-pointer" onClick={() => navigate(`/statistics/performance/${user.user}`)}>
                    <td className="px-6 py-3 sticky left-0 bg-white group-hover:bg-gray-50/80 z-10 border-r border-transparent group-hover:border-gray-100">
                      <div className="flex items-center gap-3">
                        <div className={`w-6 h-6 rounded-sm flex items-center justify-center text-[10px] font-bold ${teamColors.bg} ${teamColors.text}`}>
                          {user.user.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-xs font-semibold text-gray-700">{user.displayName}</span>
                      </div>
                    </td>
                    <td className="px-6 py-3 text-center">
                      <span className={`px-1.5 py-0.5 rounded-sm text-[9px] font-bold uppercase tracking-wide border ${teamColors.bg} ${teamColors.text} ${teamColors.border}`}>
                        {user.team}
                      </span>
                    </td>

                    {/* Daily Columns */}
                    {data.dates.map(date => {
                      const val = user.daily_file_creations[date] || 0;
                      const dayStats = dailyPeerStats[date];
                      const isUnderperforming = dayStats?.isBusyDay && val > 0 && val < dayStats.threshold;

                      let bgClass = "";
                      if (isUnderperforming) {
                        bgClass = "bg-amber-100 text-amber-700 font-bold ring-1 ring-amber-300";
                      } else if (val > 0) {
                        bgClass = "bg-slate-50 text-slate-600";
                        if (val > 5) bgClass = "bg-blue-50 text-blue-700";
                        if (val > 15) bgClass = "bg-blue-100 text-blue-800 font-bold";
                        if (val > 30) bgClass = "bg-blue-200 text-blue-900 font-bold";
                      }

                      return (
                        <td key={date} className="px-2 py-3 text-center">
                          <div
                            className={`mx-auto w-8 h-6 flex items-center justify-center rounded-sm text-xs ${val > 0 ? bgClass : "text-gray-200"}`}
                            title={isUnderperforming ? `⚠️ Low effort — team avg was ${dayStats.avg} files on this day` : ''}
                          >
                            {val > 0 ? val : '-'}
                          </div>
                          {isUnderperforming && (
                            <div className="flex justify-center mt-0.5">
                              <TrendingDown className="w-2.5 h-2.5 text-amber-500" />
                            </div>
                          )}
                        </td>
                      );
                    })}

                    <td className="px-6 py-3 text-center bg-gray-50/30 border-l border-gray-50 font-bold text-xs text-gray-800">
                      {user.totalFiles}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Footer */}
          {filteredUsers.length === 0 ? (
            <div className="p-12 text-center text-gray-400 text-xs uppercase tracking-wide">
              No data available
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