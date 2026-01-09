// src/pages/statistics/MonthlyReport.jsx
import { getMonthlyPerformance } from '../../api/api';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3, TrendingUp, Zap, User, ArrowUpDown, Loader,
  AlertTriangle, FileUp, FileDown, RefreshCw, Calendar,
  Filter, Download, ChevronRight
} from 'lucide-react';

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
const StatCard = ({ label, value, sub, icon: Icon, colorTheme }) => {
  const themes = {
    gray: "bg-gray-50 border-gray-100 text-gray-900",
    green: "bg-emerald-50 border-emerald-100 text-emerald-700",
    blue: "bg-blue-50 border-blue-100 text-blue-700",
    indigo: "bg-indigo-50 border-indigo-100 text-indigo-700",
    purple: "bg-purple-50 border-purple-100 text-purple-700",
    orange: "bg-orange-50 border-orange-100 text-orange-700",
  };
  const currentTheme = themes[colorTheme] || themes.gray;

  return (
    <div className={`p-4 rounded-sm border ${currentTheme} transition-all`}>
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
  const [teamData, setTeamData] = useState({ import: [], export: [] });
  const [activeTab, setActiveTab] = useState('import');
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

      // Normalize field names to handle API variations
      allUsersData = allUsersData.map(user => ({
        ...user,
        // Handle both old and new API field names
        total_files_created: user.total_files_created ?? user.total_files_handled ?? 0,
        avg_files_per_active_day: user.avg_files_per_active_day ?? user.avg_activity_per_day ?? 0,
        manual_files: user.manual_files ?? 0,
        automatic_files: user.automatic_files ?? 0,
      }));

      const importTeam = allUsersData.filter(u => u.team === 'import');
      const exportTeam = allUsersData.filter(u => u.team === 'export');

      console.log('Import Team:', importTeam);
      console.log('Export Team:', exportTeam);

      const newTeamData = { import: importTeam, export: exportTeam };
      setTeamData(newTeamData);
      writeCache(newTeamData); // Write fresh data to cache

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

  const sortedData = useMemo(() => {
    let sortableData = [...teamData[activeTab]];
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

  const summaryStats = useMemo(() => {
    const currentTeamData = teamData[activeTab];
    if (currentTeamData.length === 0) return { topManual: 'N/A', topAutomatic: 'N/A', totalFiles: 0 };

    const topManual = currentTeamData.reduce((max, user) => (user.manual_files ?? 0) > (max.manual_files ?? 0) ? user : max, currentTeamData[0]);
    const topAutomatic = currentTeamData.reduce((max, user) => (user.automatic_files ?? 0) > (max.automatic_files ?? 0) ? user : max, currentTeamData[0]);
    const totalFiles = currentTeamData.reduce((sum, user) => sum + (user.total_files_created ?? 0), 0);

    return {
      topManual: topManual?.user?.replace(".", " ") ?? 'N/A',
      topAutomatic: topAutomatic?.user?.replace(".", " ") ?? 'N/A',
      totalFiles
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

  return (
    <div className="min-h-screen bg-gray-50 p-4 font-sans text-slate-800">
      {/* Header */}
      <div className="w-full bg-white border border-gray-200 rounded-sm shadow-sm overflow-hidden mb-4">
        <div className="px-6 py-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-gray-900 uppercase tracking-tight flex items-center gap-2">
              Monthly Performance Report
              <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded-sm border border-gray-200 uppercase tracking-wide">30 Days</span>
            </h1>
            <p className="text-xs text-gray-500 mt-1">Team productivity analysis and leaderboard</p>
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
        <div className="px-6 flex items-center gap-6 border-t border-gray-100 bg-gray-50/50">
          <button
            onClick={() => setActiveTab('import')}
            className={`py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'import' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            <FileDown className="w-3.5 h-3.5" /> Import Team ({teamData.import.length})
          </button>
          <button
            onClick={() => setActiveTab('export')}
            className={`py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'export' ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            <FileUp className="w-3.5 h-3.5" /> Export Team ({teamData.export.length})
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <StatCard
          label="Total Files"
          value={summaryStats.totalFiles.toLocaleString()}
          sub="Files Processed in 30 Days"
          icon={BarChart3}
          colorTheme="blue"
        />
        <StatCard
          label="Top Manual"
          value={summaryStats.topManual}
          sub="Highest Manual Output"
          icon={TrendingUp}
          colorTheme="purple"
        />
        <StatCard
          label="Top Auto"
          value={summaryStats.topAutomatic}
          sub="Highest Automation Usage"
          icon={Zap}
          colorTheme="green"
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
                  <td className="px-6 py-3">
                    <span className="text-xs font-bold text-gray-700 group-hover:text-blue-600 transition-colors">
                      {row.user.replace(".", " ")}
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
