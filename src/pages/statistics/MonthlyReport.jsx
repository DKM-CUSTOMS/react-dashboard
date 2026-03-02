// src/pages/statistics/MonthlyReport.jsx
import { getMonthlyPerformance } from '../../api/api';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3, TrendingUp, Zap, User, Users, ArrowUpDown, Loader,
  AlertTriangle, FileUp, FileDown, RefreshCw, Calendar,
  Filter, Download, ChevronRight, FileText, Activity
} from 'lucide-react';
import { getTeamTailwindColors } from '../../utils/teamColors';

// --- Caching Helpers ---
const CACHE_KEY = "monthly-report-cache-v2"; // Changed to invalidate old cache
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

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
  } catch (err) {
    console.warn("Could not write to cache", err);
  }
};


// --- Helper Components ---
const StatCard = ({ label, value, sub, icon: Icon, themeObj }) => {
  return (
    <div className={`p-4 rounded-sm border ${themeObj.bg} ${themeObj.border} ${themeObj.text} transition-all`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wider opacity-70 font-bold mb-1">{label}</p>
          <h3 className="text-xl font-bold">{value}</h3>
          <p className="text-[10px] opacity-70 mt-1">{sub}</p>
        </div>
        <div className="p-1.5 rounded-sm bg-white/50">
          <Icon className="w-4 h-4 opacity-80" />
        </div>
      </div>
    </div>
  );
};

// --- Main Component ---
const MonthlyReport = () => {
  const navigate = useNavigate();
  const [teamData, setTeamData] = useState({ teamsMap: {}, availableTeams: [], list: [] });
  const [activeTab, setActiveTab] = useState('Unassigned'); // Default fallback
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: 'total_files_created', direction: 'desc' });

  const fetchData = useCallback(async (force = false) => {
    if (force) {
      setIsRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    // Try cache first unless forcing a refresh
    if (!force) {
      const cached = readCache();
      if (cached) {
        setTeamData(cached);
        setLoading(false);
        return;
      }
    }

    try {
      const result = await getMonthlyPerformance();

      let allUsersData = [];
      if (typeof result === 'object' && !Array.isArray(result) && result !== null) {
        allUsersData = Object.entries(result).map(([user, metrics]) => ({
          user,
          ...metrics
        }));
      } else {
        allUsersData = result;
      }

      // Use the 'team' field from API instead of hardcoded lists
      console.log('API Response:', result);
      console.log('All Users Data:', allUsersData);

      // FETCH DB TEAMS
      let dbTeams = [];
      try {
        const tmRes = await fetch('/api/teams');
        if (tmRes.ok) {
          const tData = await tmRes.json();
          if (tData.success) dbTeams = tData.teams || [];
        }
      } catch (e) { console.warn("MonthlyReport: Failed to fetch db teams", e); }

      // Normalize field names to handle API variations
      allUsersData = allUsersData.map(user => {
        const uId = user.user || '';
        const matchedTeam = dbTeams.find(t => t.members.some(m => m.toLowerCase() === uId.toLowerCase()));
        let finalTeam = 'Unassigned';
        if (matchedTeam) {
          if (matchedTeam.parent_id) {
            const parentTeam = dbTeams.find(t => t.id === matchedTeam.parent_id);
            finalTeam = parentTeam ? parentTeam.name : matchedTeam.name;
          } else {
            finalTeam = matchedTeam.name;
          }
        }
        return {
          ...user,
          team: finalTeam,
          // Handle both old and new API field names
          total_files_created: user.total_files_created ?? user.total_files_handled ?? 0,
          avg_files_per_active_day: user.avg_files_per_active_day ?? user.avg_activity_per_day ?? 0,
          manual_files: user.manual_files ?? 0,
          automatic_files: user.automatic_files ?? 0,
        };
      });

      const newTeamData = {};
      allUsersData.forEach(u => {
        if (!newTeamData[u.team]) newTeamData[u.team] = [];
        newTeamData[u.team].push(u);
      });
      const availableTeams = Object.keys(newTeamData).sort();

      const payload = { teamsMap: newTeamData, availableTeams, list: allUsersData };

      setTeamData(payload);
      writeCache(payload); // Write fresh data to cache

    } catch (err) {
      console.error("Failed to fetch monthly report:", err);
      // If error, try to fallback to cache even if expired? No, strict for now.
      setError(err.message);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (teamData.availableTeams.length > 0 && !teamData.availableTeams.includes(activeTab)) {
      setActiveTab(teamData.availableTeams[0]);
    }
  }, [teamData.availableTeams, activeTab]);

  const sortedData = useMemo(() => {
    let sortableData = [...(teamData.teamsMap[activeTab] || [])];
    if (sortConfig.key) {
      sortableData.sort((a, b) => {
        if (a[sortConfig.key] < b[sortConfig.key]) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (a[sortConfig.key] > b[sortConfig.key]) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableData;
  }, [teamData, activeTab, sortConfig]);

  const requestSort = (key) => {
    let direction = 'desc';
    if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = 'asc';
    }
    setSortConfig({ key, direction });
  };

  const handleRowClick = (username) => {
    navigate(`/statistics/performance/${username}`);
  };

  const aggregatedStats = useMemo(() => {
    const currentTeamData = teamData.teamsMap[activeTab] || [];
    if (currentTeamData.length === 0) return { totalFiles: 0, maxDailyAvg: 0, globalEfficiency: 0 };

    const totalFiles = currentTeamData.reduce((sum, user) => sum + (user.total_files_created ?? 0), 0);
    const maxDailyAvg = Math.max(...currentTeamData.map(u => u.avg_files_per_active_day ?? 0));

    let activeUserDays = 0;
    currentTeamData.forEach(u => {
      if (u.avg_files_per_active_day > 0) {
        activeUserDays += (u.total_files_created ?? 0) / u.avg_files_per_active_day;
      }
    });

    const globalEfficiency = activeUserDays > 0 ? (totalFiles / activeUserDays).toFixed(1) : 0;

    return {
      totalFiles: totalFiles.toLocaleString(),
      maxDailyAvg: maxDailyAvg > 0 ? maxDailyAvg.toFixed(1) : 0,
      globalEfficiency
    };
  }, [teamData, activeTab]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <RefreshCw className="h-6 w-6 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="p-6 bg-white rounded-sm border border-gray-200 shadow-sm max-w-md text-center">
          <AlertTriangle className="h-10 w-10 text-red-500 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-gray-900 mb-2">Error Loading Report</h2>
          <p className="text-sm text-gray-500 mb-4">{error}</p>
          <button
            onClick={() => fetchData(true)}
            className="px-4 py-2 bg-blue-50 text-blue-600 rounded-sm font-medium text-sm hover:bg-blue-100 transition-colors"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  const themeColors = getTeamTailwindColors(activeTab);

  return (
    <div className="p-4 md:p-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <Calendar className={`w-8 h-8 ${themeColors.textSolid}`} />
            Monthly Performance Report
            <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded-sm border border-gray-200 uppercase tracking-wide">30 Days</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">Team productivity analysis and leaderboard</p>
        </div>
        <button
          onClick={() => fetchData(true)}
          disabled={isRefreshing}
          className="flex items-center justify-center gap-2 px-3 py-1.5 bg-white border border-gray-200 text-gray-600 rounded-sm text-xs font-bold uppercase tracking-wider hover:bg-gray-50 hover:border-gray-300 transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? 'Syncing...' : 'Refresh Data'}
        </button>
      </div>

      {/* Tabs */}
      <div className="w-full bg-white border border-gray-200 rounded-sm shadow-sm overflow-hidden mb-4">
        <div className="px-6 flex items-center gap-6 border-t border-gray-100 bg-gray-50/50 overflow-x-auto whitespace-nowrap hidden-scrollbar">
          {teamData.availableTeams.map(team => {
            const tempColors = getTeamTailwindColors(team);
            return (
              <button
                key={team}
                onClick={() => setActiveTab(team)}
                className={`py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors flex items-center gap-2 ${activeTab === team ? `${tempColors.borderSolid} ${tempColors.textSolid}` : 'border-transparent text-gray-500 hover:text-gray-700'}`}
              >
                <Users className="w-3.5 h-3.5" /> {team} ({teamData.teamsMap[team]?.length || 0})
              </button>
            );
          })}
          {teamData.availableTeams.length === 0 && (
            <span className="py-3 text-xs font-bold uppercase text-gray-400 border-b-2 border-transparent">No Teams Available</span>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <StatCard
          label="Total Files"
          value={aggregatedStats.totalFiles}
          sub="Processed this month"
          icon={FileText}
          themeObj={themeColors}
        />
        <StatCard
          label="Highest Avg/Day"
          value={aggregatedStats.maxDailyAvg}
          sub="Per single user"
          icon={TrendingUp}
          themeObj={themeColors}
        />
        <StatCard
          label="Global Efficiency"
          value={aggregatedStats.globalEfficiency}
          sub="Total / Active User-Days"
          icon={Activity}
          themeObj={themeColors}
        />
      </div>

      {/* Performance Table */}
      <div className="bg-white border border-gray-200 rounded-sm shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-xs font-bold text-gray-600 uppercase tracking-wide flex items-center gap-2">
            <User className="w-3.5 h-3.5" /> Team Leaderboard
          </h3>
          <div className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">
            Sort by clicking columns
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-y border-gray-100">
              <tr>
                <th className="px-6 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">User</th>
                <th className="px-6 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-blue-600 transition-colors" onClick={() => requestSort('manual_files')}>
                  <div className="flex items-center gap-1">Manual <ArrowUpDown className="w-3 h-3" /></div>
                </th>
                <th className="px-6 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-emerald-600 transition-colors" onClick={() => requestSort('automatic_files')}>
                  <div className="flex items-center gap-1">Auto <ArrowUpDown className="w-3 h-3" /></div>
                </th>
                <th className="px-6 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 transition-colors" onClick={() => requestSort('total_files_created')}>
                  <div className="flex items-center gap-1">Total <ArrowUpDown className="w-3 h-3" /></div>
                </th>
                <th className="px-6 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 transition-colors" onClick={() => requestSort('avg_files_per_active_day')}>
                  <div className="flex items-center gap-1">Avg/Day <ArrowUpDown className="w-3 h-3" /></div>
                </th>
                <th className="w-10 px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sortedData.map((row, index) => (
                <tr key={`${row.user}-${row.team}-${index}`} className="hover:bg-gray-50/80 transition-colors cursor-pointer group" onClick={() => handleRowClick(row.user)}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`text-xs font-bold text-gray-700 group-hover:${themeColors.textSolid} transition-colors capitalize`}>
                      {(row.user || '').replace(/\./g, ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-100">
                      {(row.manual_files ?? 0).toLocaleString()}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-100">
                      {(row.automatic_files ?? 0).toLocaleString()}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-xs font-bold text-gray-900">
                    {(row.total_files_created ?? 0).toLocaleString()}
                  </td>
                  <td className="px-6 py-3 text-xs text-gray-500 font-mono">
                    {row.avg_files_per_active_day ?? 0}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-400" />
                  </td>
                </tr>
              ))}
              {sortedData.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-xs text-gray-400 italic">
                    No data available for this team.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default MonthlyReport;
