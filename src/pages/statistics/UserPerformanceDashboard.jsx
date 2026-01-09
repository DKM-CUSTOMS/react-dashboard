import { getUserPerformance } from "../../api/api";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Line, Bar, Doughnut } from "react-chartjs-2";
import {
  RefreshCw, Award,
  User, Clock, FileText, TrendingUp, Calendar, ChevronDown, ChevronRight,
  Activity, X, BarChart3, PieChart, Users, Zap, FileEdit,
  FilePlus, Search, Download, Scale, ArrowLeft, Check, Eye, Copy
} from "lucide-react";
import { format, subDays, eachDayOfInterval, differenceInDays } from "date-fns";
import { useParams, useNavigate } from "react-router-dom";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

/* -------------------------------------------------
   Helper Logic & Transformations
   ------------------------------------------------- */
const transformApiData = (apiData) => {
  if (!apiData || !apiData.daily_metrics) return null;

  const today = new Date();

  // 1. Filter Last 120 Days & Map
  const dailyMetrics = apiData.daily_metrics
    .filter(day => {
      const d = new Date(day.date);
      return differenceInDays(today, d) <= 120;
    })
    .map((day) => {
      const date = new Date(day.date);
      return {
        date: format(date, "dd/MM/yyyy"),
        rawDate: date,
        manual: day.manual_files_created,
        auto: day.automatic_files_created,
        sending: day.sending_count || 0,
        modifs: day.modification_count,
        files: day.total_files_handled,
        avgTime: day.avg_creation_time != null ? day.avg_creation_time.toFixed(2) : "0.00",
        modPerFile: day.total_files_handled > 0 ? (day.modification_count / day.total_files_handled).toFixed(2) : "0.00",
        manualFileIds: Array.isArray(day.manual_file_ids) ? day.manual_file_ids : [],
        autoFileIds: Array.isArray(day.automatic_file_ids) ? day.automatic_file_ids : [],
        modificationFileIds: Array.isArray(day.modification_file_ids) ? day.modification_file_ids : [],
        sendingFileIds: Array.isArray(day.sending_file_ids) ? day.sending_file_ids : [],
      };
    });

  // Sort: Newest first for Table
  dailyMetrics.sort((a, b) => b.rawDate - a.rawDate);

  // Chart: Oldest to newest
  const dailyFiles = [...dailyMetrics]
    .sort((a, b) => a.rawDate - b.rawDate)
    .map((d) => ({
      date: d.date.slice(0, 5),
      total: d.files,
    }));

  // Company Stats
  const companySpecialization = Object.entries(apiData.summary.company_specialization || {})
    .map(([company, files]) => ({ company, files }))
    .sort((a, b) => b.files - a.files);
  const mostActiveCompany = companySpecialization[0] || { company: "N/A", files: 0 };

  // Hourly Stats
  const activityByHour = apiData.summary.activity_by_hour || {};
  const hourLabels = Array.from({ length: 24 }, (_, i) => i).filter(h => h >= 6 && h <= 19);
  const hourlyActivity = hourLabels.map((h) => ({
    hour: `${h}:00`,
    activity: activityByHour[h] || 0,
  }));

  // Heatmap Data (Last 120 days - 4 months)
  const startDate = subDays(today, 120);
  const allDays = eachDayOfInterval({ start: startDate, end: today });
  const activityDataMap = new Map(Object.entries(apiData.summary.activity_days));
  const activeDays = allDays.map((date) => {
    const dateStr = format(date, "yyyy-MM-dd");
    return {
      date: dateStr,
      count: activityDataMap.get(dateStr) || 0,
      displayDate: format(date, "MMM dd, yyyy")
    };
  });

  const fileTypes = Object.entries(apiData.summary.file_type_counts || {}).map(
    ([type, count]) => ({ type, count })
  );

  const workloadAnalysis = calculateWorkloadConsistency(dailyFiles.map(d => d.total));

  return {
    user: {
      name: apiData.user.replace(/\./g, " "),
      team: "Export Team", // Placeholder, ideally comes from API
      totalFiles: apiData.summary.total_files_handled,
      totalModifications: apiData.summary.total_modifications,
      manualPercentage: Math.round(apiData.summary.manual_vs_auto_ratio.manual_percent),
      autoPercentage: Math.round(apiData.summary.manual_vs_auto_ratio.automatic_percent),
      avgTime: apiData.summary.avg_creation_time != null ? apiData.summary.avg_creation_time.toFixed(2) : "0.00",
      avgFilesPerDay: apiData.summary.avg_files_per_day.toFixed(1),
      mostProductiveDay: apiData.summary.most_productive_day ? format(new Date(apiData.summary.most_productive_day), "dd/MM/yyyy") : "N/A",
      mostActiveCompany: mostActiveCompany.company,
      mostActiveCompanyFiles: mostActiveCompany.files,
      mostActiveHour: `${apiData.summary.hour_with_most_activity}:00`,
      daysActive: apiData.summary.days_active,
      modificationsPerFile: apiData.summary.modifications_per_file.toFixed(2),
      workloadConsistency: workloadAnalysis,
    },
    dailyMetrics,
    chartData: {
      dailyFiles,
      companySpecialization,
      manualVsAuto: [
        { name: "Manual", value: Math.round(apiData.summary.manual_vs_auto_ratio.manual_percent), color: "#3b82f6" },
        { name: "Auto", value: Math.round(apiData.summary.manual_vs_auto_ratio.automatic_percent), color: "#10b981" },
      ],
      activeDays,
      fileTypes,
      hourlyActivity,
    },
  };
};

// Workload Analysis
const calculateWorkloadConsistency = (dailyTotals) => {
  if (dailyTotals.length === 0) return { category: "No Data", description: "No data available", chartData: { labels: [], datasets: [] } };

  const mean = dailyTotals.reduce((sum, val) => sum + val, 0) / dailyTotals.length;
  const variance = dailyTotals.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / dailyTotals.length;
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = mean > 0 ? (stdDev / mean) : 0;

  let category, description;
  if (coefficientOfVariation <= 0.3) {
    category = "Steady Performer";
    description = "Maintains a balanced rhythm, delivering reliable output day-to-day.";
  } else if (coefficientOfVariation >= 0.8) {
    category = "Spiky Performer";
    description = "Handles workload in concentrated bursts, excelling at high-volume tasks.";
  } else {
    category = "Flexible Performer";
    description = "Adapts to demand fluctuations, maintaining efficiency across varying volumes.";
  }

  return { category, description };
};

/* -------------------------------------------------
   Components (Styled for New Aesthetic)
   ------------------------------------------------- */

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

const ChartSection = ({ title, children, icon: Icon }) => (
  <div className="bg-white p-4 rounded-sm border border-gray-200 shadow-sm h-full flex flex-col">
    <div className="flex items-center gap-2 mb-4 border-b border-gray-50 pb-2">
      <Icon className="w-3.5 h-3.5 text-gray-400" />
      <h3 className="text-xs font-bold text-gray-600 uppercase tracking-wide">{title}</h3>
    </div>
    <div className="flex-1 min-h-[200px] relative">
      {children}
    </div>
  </div>
);

const CopyBadge = ({ id }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e) => {
    e.stopPropagation();
    const text = Math.floor(id).toString();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <span
      onClick={handleCopy}
      className={`
                inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-mono cursor-pointer transition-all border
                ${copied
          ? 'bg-green-100 text-green-700 border-green-200 scale-105 font-bold'
          : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200'}
            `}
      title="Click to copy ID"
    >
      {Math.floor(id)}
      {copied && <Check className="w-3 h-3 ml-1" />}
    </span>
  );
};

const ActivityHeatmap = ({ data }) => {
  // data is array of { date, count, displayDate }
  // 120 days.
  // We need to align start date day-of-week.
  if (!data || data.length === 0) return null;

  const startDate = new Date(data[0].date);
  const startDay = startDate.getDay(); // 0=Sun, 1=Mon...
  // Github usually starts with Sun at row 0 or Mon at row 1? 
  // Let's assume Mon=1. If we use grid-rows-7, row 1 is Sun or Mon?
  // Let's map 0 (Sun) -> 6, 1 (Mon) -> 0, etc. to make Mon top?
  // Or standard: Sun(0), Mon(1)...Sat(6).
  // Visual image shows Mon, Wed, Fri.
  // Let's use 0=Sun as top row? Or Mon. Image shows Mon is 2nd row? No, Mon is first label.
  // Usually rows are: Sun, Mon, Tue, Wed, Thu, Fri, Sat.
  // Mon label is usually next to row 1 (if 0-indexed).

  // Let's just render a grid with 7 rows.
  // We need to pad the beginning with empty cells if start date is not Sunday (or whatever top row is).
  // Let's assume Top Row = Sunday.
  const emptyStartDays = Array.from({ length: startDay }).fill(null);
  const allCells = [...emptyStartDays, ...data];

  const getColor = (count) => {
    if (count === 0) return "bg-gray-100/50";
    if (count <= 2) return "bg-emerald-200";
    if (count <= 5) return "bg-emerald-400";
    return "bg-emerald-600";
  };

  // Month labels logic (simplified)
  const months = [];
  let currentMonth = -1;
  data.forEach((d, i) => {
    const m = new Date(d.date).getMonth();
    if (m !== currentMonth) {
      // Approximate column: (i + startDay) / 7
      const col = Math.floor((i + startDay) / 7);
      months.push({ name: format(new Date(d.date), 'MMM'), col });
      currentMonth = m;
    }
  });

  return (
    <div className="flex flex-col h-full items-center justify-center w-full">
      <div className="relative">
        {/* Month Labels */}
        <div className="flex mb-2 text-[10px] text-gray-400 relative h-4 w-full font-medium">
          {months.map((m, i) => (
            <span key={i} style={{ left: `${m.col * 24}px` }} className="absolute">{m.name}</span>
          ))}
        </div>

        <div className="flex gap-3">
          {/* Day Labels */}
          <div className="flex flex-col justify-between text-[10px] text-gray-400 pt-3 pb-3 h-[120px] leading-3 font-medium">
            <span>Mon</span>
            <span>Wed</span>
            <span>Fri</span>
          </div>

          {/* The Grid */}
          <div className="grid grid-rows-7 grid-flow-col gap-x-2 gap-y-1">
            {allCells.map((day, i) => (
              day ? (
                <div
                  key={day.date}
                  className={`w-4 h-4 rounded-sm ${getColor(day.count)} transition-all hover:scale-125 hover:ring-2 ring-offset-1 ring-emerald-300 relative z-0 hover:z-10 cursor-pointer`}
                  title={`${day.displayDate}: ${day.count} contributions`}
                />
              ) : (
                <div key={`empty-${i}`} className="w-4 h-4 bg-transparent" />
              )
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-end gap-1.5 text-[10px] text-gray-400 mt-3 font-medium">
          <span>Less</span>
          <div className="w-3 h-3 bg-gray-100/50 rounded-sm"></div>
          <div className="w-3 h-3 bg-emerald-200 rounded-sm"></div>
          <div className="w-3 h-3 bg-emerald-400 rounded-sm"></div>
          <div className="w-3 h-3 bg-emerald-600 rounded-sm"></div>
          <span>More</span>
        </div>
        <p className="text-[9px] text-gray-300 mt-1 text-right hover:text-blue-500 cursor-pointer transition-colors">Learn how we count contributions</p>
      </div>
    </div>
  );
};

// Day Detail Modal Component
const DayDetailModal = ({ isOpen, onClose, dayData }) => {
  const [activeTab, setActiveTab] = useState('all');
  const [copiedAll, setCopiedAll] = useState(false);

  if (!isOpen || !dayData) return null;

  const tabs = [
    { id: 'all', label: 'All Files', count: dayData.files, color: 'gray' },
    { id: 'manual', label: 'Manual', count: dayData.manualFileIds?.length || 0, color: 'blue' },
    { id: 'auto', label: 'Automatic', count: dayData.autoFileIds?.length || 0, color: 'emerald' },
    { id: 'sending', label: 'Sending', count: dayData.sendingFileIds?.length || 0, color: 'purple' },
    { id: 'modifs', label: 'Modifications', count: dayData.modificationFileIds?.length || 0, color: 'orange' },
  ];

  const getFileIds = () => {
    switch (activeTab) {
      case 'manual': return dayData.manualFileIds || [];
      case 'auto': return dayData.autoFileIds || [];
      case 'sending': return dayData.sendingFileIds || [];
      case 'modifs': return dayData.modificationFileIds || [];
      default:
        // Combine all unique IDs
        const all = new Set([
          ...(dayData.manualFileIds || []),
          ...(dayData.autoFileIds || []),
          ...(dayData.sendingFileIds || []),
        ]);
        return Array.from(all);
    }
  };

  const fileIds = getFileIds();

  const copyAllIds = () => {
    const idsText = fileIds.map(id => Math.floor(id)).join(', ');
    navigator.clipboard.writeText(idsText);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const getTabColorClasses = (tabId, color) => {
    const isActive = activeTab === tabId;
    const colors = {
      gray: isActive ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100',
      blue: isActive ? 'bg-blue-600 text-white' : 'text-blue-600 hover:bg-blue-50',
      emerald: isActive ? 'bg-emerald-600 text-white' : 'text-emerald-600 hover:bg-emerald-50',
      purple: isActive ? 'bg-purple-600 text-white' : 'text-purple-600 hover:bg-purple-50',
      orange: isActive ? 'bg-orange-500 text-white' : 'text-orange-600 hover:bg-orange-50',
    };
    return colors[color] || colors.gray;
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
          <div>
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-blue-600" />
              {dayData.date}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">Daily Activity Details</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-5 gap-2 p-4 bg-gray-50/50 border-b border-gray-100">
          <div className="text-center p-2 bg-white rounded-sm border border-gray-100">
            <p className="text-lg font-bold text-gray-900">{dayData.files}</p>
            <p className="text-[9px] text-gray-500 uppercase font-medium">Total</p>
          </div>
          <div className="text-center p-2 bg-blue-50 rounded-sm border border-blue-100">
            <p className="text-lg font-bold text-blue-700">{dayData.manual}</p>
            <p className="text-[9px] text-blue-600 uppercase font-medium">Manual</p>
          </div>
          <div className="text-center p-2 bg-emerald-50 rounded-sm border border-emerald-100">
            <p className="text-lg font-bold text-emerald-700">{dayData.auto}</p>
            <p className="text-[9px] text-emerald-600 uppercase font-medium">Auto</p>
          </div>
          <div className="text-center p-2 bg-purple-50 rounded-sm border border-purple-100">
            <p className="text-lg font-bold text-purple-700">{dayData.sending || 0}</p>
            <p className="text-[9px] text-purple-600 uppercase font-medium">Sending</p>
          </div>
          <div className="text-center p-2 bg-orange-50 rounded-sm border border-orange-100">
            <p className="text-lg font-bold text-orange-700">{dayData.modifs}</p>
            <p className="text-[9px] text-orange-600 uppercase font-medium">Modifs</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-100 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${getTabColorClasses(tab.id, tab.color)}`}
            >
              {tab.label}
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${activeTab === tab.id ? 'bg-white/20' : 'bg-gray-100'}`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* File IDs List */}
        <div className="p-4 max-h-[300px] overflow-y-auto">
          {fileIds.length > 0 ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-gray-500">
                  Showing <span className="font-bold text-gray-700">{fileIds.length}</span> file IDs
                </p>
                <button
                  onClick={copyAllIds}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-medium transition-all ${copiedAll
                    ? 'bg-green-100 text-green-700 border border-green-200'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                >
                  {copiedAll ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedAll ? 'Copied!' : 'Copy All'}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {fileIds.map((id, idx) => (
                  <CopyBadge key={`${id}-${idx}`} id={id} />
                ))}
              </div>
            </>
          ) : (
            <div className="text-center py-8">
              <FileText className="w-10 h-10 text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No file IDs in this category</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
          <p className="text-[10px] text-gray-400">
            💡 Click on any ID to copy it to clipboard
          </p>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-sm hover:bg-gray-800 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

const UserPerformanceDashboard = () => {
  const { username } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedRows, setExpandedRows] = useState(new Set());

  const [timeRange, setTimeRange] = useState('90');
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [modalData, setModalData] = useState(null); // For day detail modal

  // Filter Logic - strict calendar days
  const filteredMetrics = useMemo(() => {
    if (!data || !data.dailyMetrics) return [];

    const daysToShow = parseInt(timeRange);
    const result = [];
    const now = new Date();

    // Create a lookup map for existing data
    // Data dates are "DD/MM/YYYY"
    const metricsMap = new Map();
    data.dailyMetrics.forEach(m => metricsMap.set(m.date, m));

    for (let i = 0; i < daysToShow; i++) {
      const d = subDays(now, i);
      const dateStr = format(d, 'dd/MM/yyyy');

      const existing = metricsMap.get(dateStr);
      if (existing) {
        result.push({ ...existing, isReal: true });
      }
    }
    return result;
  }, [data, timeRange]);

  // Selection Totals Logic
  const selectionTotals = useMemo(() => {
    let files = 0, manual = 0, auto = 0, modifs = 0;
    selectedRows.forEach(dateStr => {
      // Find in generated filtered list (filteredMetrics is stable for timeRange)
      const day = filteredMetrics.find(m => m.date === dateStr);
      if (day) {
        files += day.files;
        manual += day.manual;
        auto += day.auto;
        modifs += day.modifs;
      }
    });
    return { files, manual, auto, modifs };
  }, [selectedRows, filteredMetrics]);

  const toggleSelection = (dateStr) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(dateStr)) next.delete(dateStr);
      else next.add(dateStr);
      return next;
    });
  };

  const toggleRow = (dateStr) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(dateStr)) next.delete(dateStr);
      else next.add(dateStr);
      return next;
    });
  };

  // Export table data to CSV
  const exportToCSV = () => {
    if (!filteredMetrics || filteredMetrics.length === 0) return;

    const headers = ['Date', 'Total Files', 'Manual', 'Automatic', 'Modifications', 'Avg Time (min)', 'Manual File IDs', 'Auto File IDs', 'Modification File IDs'];

    const rows = filteredMetrics.map(day => [
      day.date,
      day.files,
      day.manual,
      day.auto,
      day.modifs,
      day.avgTime,
      day.manualFileIds?.join('; ') || '',
      day.autoFileIds?.join('; ') || '',
      day.modificationFileIds?.join('; ') || ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${username}_activity_${timeRange}days_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const fetchUser = useCallback(async () => {
    setLoading(true);
    try {
      // Use optimized Logic App fetch
      const json = await getUserPerformance(username);
      setData(transformApiData(json));
    } catch (e) {
      console.log(e);
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => { fetchUser(); }, [fetchUser]);



  if (loading) return <div className="min-h-screen flex items-center justify-center bg-gray-50"><RefreshCw className="w-6 h-6 animate-spin text-blue-500" /></div>;
  if (!data) return <div className="min-h-screen flex items-center justify-center">User not found.</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-4 font-sans text-slate-800">

      {/* Header */}
      <div className="w-full bg-white border border-gray-200 rounded-sm shadow-sm overflow-hidden mb-4">
        <div className="px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/statistics/performance')} className="p-1.5 hover:bg-gray-100 rounded-sm border border-transparent hover:border-gray-200 transition-all">
              <ArrowLeft className="w-4 h-4 text-gray-600" />
            </button>
            <div>
              <h1 className="text-lg font-bold text-gray-900 uppercase tracking-tight flex items-center gap-2">
                {data.user.name}
                <span className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded-sm border border-blue-100 uppercase tracking-wide">{data.user.workloadConsistency.category}</span>
              </h1>
              <p className="text-xs text-gray-500 mt-1">90-Day Performance Profile • {data.user.team}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right hidden md:block mr-4">
              <p className="text-[10px] text-gray-400 uppercase font-bold">Total Output</p>
              <p className="text-lg font-bold text-gray-800">{data.user.totalFiles.toLocaleString()}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
        <StatCard label="Productivity" value={data.user.avgFilesPerDay} sub="Files / Active Day" icon={TrendingUp} colorTheme="blue" />
        <StatCard label="Efficiency" value={`${data.user.avgTime}m`} sub="Avg Creation Time" icon={Clock} colorTheme="green" />
        <StatCard label="Quality" value={data.user.modificationsPerFile} sub="Mods / File" icon={FileEdit} colorTheme="purple" />
        <StatCard label="Peak Time" value={data.user.mostActiveHour} sub="Most Active Hour" icon={Zap} colorTheme="orange" />
        <StatCard label="Top Client" value={data.user.mostActiveCompanyFiles} sub={data.user.mostActiveCompany} icon={Award} colorTheme="indigo" />
      </div>

      {/* Insights Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Workload Consistency */}
        <div className="bg-white p-5 rounded-sm border border-gray-200 shadow-sm flex flex-col justify-center relative overflow-hidden">
          <div className="absolute right-0 top-0 p-4 opacity-5">
            <Activity className="w-32 h-32" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-4 h-4 text-blue-500" />
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wide">Workload Consistency</h3>
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">{data.user.workloadConsistency.category}</h2>
            <p className="text-sm text-gray-500 leading-relaxed max-w-md">
              {data.user.workloadConsistency.description}
            </p>
            <div className="mt-4 flex items-center gap-2">
              <span className="text-[10px] bg-green-50 text-green-700 px-2 py-1 rounded-full font-bold border border-green-100">Efficiency Benchmark</span>
              <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-1 rounded-full font-bold border border-gray-200">High Performer</span>
            </div>
          </div>
        </div>

        {/* Performance Highlights */}
        <div className="bg-white p-5 rounded-sm border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2 mb-6 text-gray-400">
            <Zap className="w-4 h-4" />
            <h3 className="text-xs font-bold uppercase tracking-wide">Performance Highlights</h3>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="flex flex-col">
              <span className="text-[10px] uppercase text-gray-400 font-bold mb-1">Most Productive Day</span>
              <span className="text-lg font-bold text-gray-800">{data.user.mostProductiveDay}</span>
              <span className="text-[10px] text-green-600 font-medium">Peak activity day</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase text-gray-400 font-bold mb-1">Avg Output</span>
              <span className="text-lg font-bold text-gray-800">{data.user.avgFilesPerDay}</span>
              <span className="text-[10px] text-blue-600 font-medium">Files per active day</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase text-gray-400 font-bold mb-1">Work Rhythm</span>
              <span className="text-lg font-bold text-gray-800">{data.user.mostActiveHour}</span>
              <span className="text-[10px] text-orange-600 font-medium">Peak productivity window</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase text-gray-400 font-bold mb-1">Active Days</span>
              <span className="text-lg font-bold text-gray-800">{data.user.daysActive}</span>
              <span className="text-[10px] text-gray-500 font-medium">In last 90 days</span>
            </div>
          </div>
        </div>
      </div>

      {/* Primary Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="lg:col-span-2 h-72">
          <ChartSection title="90-Day Production Trend" icon={BarChart3}>
            <Line
              data={{
                labels: data.chartData.dailyFiles.map(d => d.date),
                datasets: [{
                  label: 'Files',
                  data: data.chartData.dailyFiles.map(d => d.total),
                  borderColor: '#3b82f6',
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  tension: 0.3,
                  fill: true,
                  pointRadius: 2
                }]
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: { grid: { display: false } }, y: { border: { display: false }, grid: { color: '#f3f4f6' } } }
              }}
            />
          </ChartSection>
        </div>
        <div className="h-72">
          <ChartSection title="Work Type" icon={PieChart}>
            <div className="flex flex-col items-center justify-center h-full py-2">
              {/* Semi-circular gauge */}
              <div className="relative w-36 h-20 mb-3">
                {/* Background arc */}
                <svg viewBox="0 0 100 50" className="w-full h-full">
                  {/* Gray background arc */}
                  <path
                    d="M 5 50 A 45 45 0 0 1 95 50"
                    fill="none"
                    stroke="#e5e7eb"
                    strokeWidth="8"
                    strokeLinecap="round"
                  />
                  {/* Manual (blue) arc - starts from left */}
                  <path
                    d="M 5 50 A 45 45 0 0 1 95 50"
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={`${(data.user.manualPercentage / 100) * 141.3} 141.3`}
                  />
                </svg>
                {/* Center percentage */}
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 text-center">
                  <span className="text-2xl font-bold text-gray-900">{Math.round(data.user.manualPercentage)}%</span>
                  <p className="text-[9px] text-gray-500 font-medium uppercase tracking-wide">Manual</p>
                </div>
              </div>

              {/* Stats breakdown */}
              <div className="w-full grid grid-cols-2 gap-3 px-2">
                {/* Manual */}
                <div className="bg-blue-50 rounded-sm p-2.5 border border-blue-100">
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                    <span className="text-[9px] font-bold text-blue-700 uppercase">Manual</span>
                  </div>
                  <p className="text-lg font-bold text-blue-900">{data.user.manualFiles?.toLocaleString() || Math.round(data.user.totalFiles * data.user.manualPercentage / 100)}</p>
                  <p className="text-[9px] text-blue-600">{data.user.manualPercentage}% of total</p>
                </div>

                {/* Automatic */}
                <div className="bg-emerald-50 rounded-sm p-2.5 border border-emerald-100">
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                    <span className="text-[9px] font-bold text-emerald-700 uppercase">Automatic</span>
                  </div>
                  <p className="text-lg font-bold text-emerald-900">{data.user.autoFiles?.toLocaleString() || Math.round(data.user.totalFiles * data.user.autoPercentage / 100)}</p>
                  <p className="text-[9px] text-emerald-600">{data.user.autoPercentage}% of total</p>
                </div>
              </div>
            </div>
          </ChartSection>
        </div>
      </div>

      {/* Secondary Charts Row (Hourly + Heatmap + Companies) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="h-72">
          <ChartSection title="Hourly Activity Pattern" icon={Clock}>
            <Bar
              data={{
                labels: data.chartData.hourlyActivity.map(h => h.hour),
                datasets: [{
                  label: 'Files',
                  data: data.chartData.hourlyActivity.map(h => h.activity),
                  backgroundColor: '#6366f1',
                  borderRadius: 2
                }]
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                  x: { grid: { display: false }, ticks: { font: { size: 9 } } },
                  y: { display: false }
                }
              }}
            />
          </ChartSection>
        </div>

        {/* Heatmap (Middle) */}
        <div className="h-72">
          <ChartSection title="Recent Activity" icon={Calendar}>
            <ActivityHeatmap data={data.chartData.activeDays} />
          </ChartSection>
        </div>

        <div className="h-72">
          <ChartSection title="Top Companies" icon={Users}>
            <Bar
              data={{
                labels: data.chartData.companySpecialization.slice(0, 5).map(c => c.company),
                datasets: [{
                  label: 'Files',
                  data: data.chartData.companySpecialization.slice(0, 5).map(c => c.files),
                  backgroundColor: '#8b5cf6',
                  borderRadius: 2
                }]
              }}
              options={{
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                  x: { display: false },
                  y: { grid: { display: false }, ticks: { font: { size: 10 }, autoSkip: false } }
                }
              }}
            />
          </ChartSection>
        </div>
      </div>

      {/* Detailed Table Section */}
      <div className="bg-white border border-gray-200 rounded-sm shadow-sm overflow-hidden relative">
        {/* Table Header & Filters */}
        <div className="px-6 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h3 className="text-xs font-bold text-gray-600 uppercase tracking-wide flex items-center gap-2">
            <FileText className="w-3.5 h-3.5" /> Recent Activity Log
          </h3>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <select
                value={timeRange}
                onChange={(e) => {
                  setTimeRange(e.target.value);
                  setSelectedRows(new Set()); // Clear selection on filter change
                }}
                className="pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-sm text-xs font-medium text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer hover:bg-gray-100 transition-colors"
              >
                <option value="7">Last 7 Days</option>
                <option value="30">Last 30 Days</option>
                <option value="90">Last 90 Days</option>
              </select>
            </div>

            {/* Export Button */}
            <button
              onClick={exportToCSV}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-sm text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors"
              title="Export to CSV"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Export</span>
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto min-h-[300px]">
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-y border-gray-100">
              <tr>
                <th className="w-10 px-6 py-3">
                  <input
                    type="checkbox"
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    onChange={(e) => {
                      if (e.target.checked) {
                        // Select all visible
                        const allDates = filteredMetrics.map(m => m.date);
                        setSelectedRows(new Set(allDates));
                      } else {
                        setSelectedRows(new Set());
                      }
                    }}
                    checked={filteredMetrics.length > 0 && filteredMetrics.every(m => selectedRows.has(m.date))}
                  />
                </th>
                <th className="w-10 px-2 py-3"></th>{/* Expand Toggle */}
                <th className="px-6 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider text-center">Output</th>
                <th className="px-6 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider text-center">Breakdown</th>
                <th className="px-6 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider text-center">Modifications</th>
                <th className="px-6 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider text-center">Avg Time</th>
                <th className="px-6 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredMetrics.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-xs text-gray-400">No activity found for this period.</td></tr>
              ) : filteredMetrics.map((day) => {
                const dateKey = day.date;
                const isSelected = selectedRows.has(dateKey);
                const isExpanded = expandedRows.has(dateKey);

                return (
                  <React.Fragment key={dateKey}>
                    <tr
                      className={`transition-colors cursor-pointer group ${isSelected ? 'bg-blue-50/50' : isExpanded ? 'bg-gray-50/80' : 'hover:bg-gray-50/50'}`}
                      onClick={() => toggleRow(dateKey)}
                    >
                      <td className="px-6 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelection(dateKey)}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-2 py-3 text-center">
                        {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                      </td>
                      <td className="px-6 py-3 text-xs font-medium text-gray-700">{day.date}</td>
                      <td className="px-6 py-3 text-center text-xs font-bold text-gray-900">{day.files}</td>
                      <td className="px-6 py-3 text-center">
                        <div className="flex items-center justify-center gap-2 text-[10px]">
                          <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded-sm border border-blue-100">{day.manual} M</span>
                          <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded-sm border border-emerald-100">{day.auto} A</span>
                        </div>
                      </td>
                      <td className="px-6 py-3 text-center">
                        <span className={`text-xs ${day.modifs > 10 ? 'text-red-500 font-bold' : 'text-gray-600'}`}>
                          {day.modifs}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-center text-xs text-gray-500">{day.avgTime} m</td>
                      <td className="px-6 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => setModalData(day)}
                          className="p-1.5 rounded-sm bg-gray-100 hover:bg-blue-100 text-gray-500 hover:text-blue-600 transition-colors"
                          title="View all file IDs"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>

                    {/* Expanded Detail Row */}
                    {isExpanded && (
                      <tr className="bg-gray-50/50">
                        <td colSpan={8} className="px-6 py-4 border-t border-gray-100 shadow-inner">
                          <div className="flex flex-col gap-3 text-xs pl-12">
                            {day.manual > 0 && (
                              <div className="flex items-start gap-2">
                                <span className="font-bold text-blue-600 uppercase tracking-wider min-w-[80px] pt-1">Manual ({day.manual}):</span>
                                <div className="flex-1 flex flex-wrap gap-1">
                                  {day.manualFileIds.slice(0, 50).map(id => <CopyBadge key={id} id={id} />)}
                                  {day.manualFileIds.length > 50 && <span className="text-gray-400 text-[10px] self-center">+{day.manualFileIds.length - 50} more</span>}
                                </div>
                              </div>
                            )}
                            {day.auto > 0 && (
                              <div className="flex items-start gap-2">
                                <span className="font-bold text-emerald-600 uppercase tracking-wider min-w-[80px] pt-1">Auto ({day.auto}):</span>
                                <div className="flex-1 flex flex-wrap gap-1">
                                  {day.autoFileIds.slice(0, 50).map(id => <CopyBadge key={id} id={id} />)}
                                  {day.autoFileIds.length > 50 && <span className="text-gray-400 text-[10px] self-center">+{day.autoFileIds.length - 50} more</span>}
                                </div>
                              </div>
                            )}
                            {day.sendingFileIds?.length > 0 && (
                              <div className="flex items-start gap-2">
                                <span className="font-bold text-purple-600 uppercase tracking-wider min-w-[80px] pt-1">Sending ({day.sendingFileIds.length}):</span>
                                <div className="flex-1 flex flex-wrap gap-1">
                                  {day.sendingFileIds.slice(0, 50).map((id, idx) => <CopyBadge key={`s-${id}-${idx}`} id={id} />)}
                                  {day.sendingFileIds.length > 50 && <span className="text-gray-400 text-[10px] self-center">+{day.sendingFileIds.length - 50} more</span>}
                                </div>
                              </div>
                            )}
                            {day.modifs > 0 && (
                              <div className="flex items-start gap-2">
                                <span className="font-bold text-orange-600 uppercase tracking-wider min-w-[80px] pt-1">Modifs ({day.modifs}):</span>
                                <div className="flex-1 flex flex-wrap gap-1">
                                  {day.modificationFileIds.slice(0, 50).map(id => <CopyBadge key={id} id={id} />)}
                                  {day.modificationFileIds.length > 50 && <span className="text-gray-400 text-[10px] self-center">+{day.modificationFileIds.length - 50} more</span>}
                                </div>
                              </div>
                            )}
                            {day.manual === 0 && day.auto === 0 && day.modifs === 0 && (!day.sendingFileIds || day.sendingFileIds.length === 0) && (
                              <p className="text-gray-400 italic">No specific file IDs available.</p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Floating Totals Bar */}
        {selectedRows.size > 0 && (
          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-gray-900/90 backdrop-blur-sm text-white px-6 py-3 rounded-md shadow-xl flex items-center gap-6 animate-in slide-in-from-bottom-5 fade-in duration-300 z-50 border border-gray-700/50">
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Selected</span>
              <span className="font-bold text-sm">{selectedRows.size} Days</span>
            </div>
            <div className="h-8 w-px bg-gray-700"></div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Total Files</span>
              <span className="font-bold text-sm text-white">{selectionTotals.files}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider text-blue-400 font-bold">Manual</span>
              <span className="font-bold text-sm">{selectionTotals.manual}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider text-emerald-400 font-bold">Auto</span>
              <span className="font-bold text-sm">{selectionTotals.auto}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider text-purple-400 font-bold">Modifs</span>
              <span className="font-bold text-sm">{selectionTotals.modifs}</span>
            </div>
            <button
              onClick={() => setSelectedRows(new Set())}
              className="ml-2 hover:bg-gray-700 p-1 rounded-full transition-colors"
            >
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>
        )}
      </div>

      {/* Day Detail Modal */}
      <DayDetailModal
        isOpen={modalData !== null}
        onClose={() => setModalData(null)}
        dayData={modalData}
      />
    </div>
  );
};

export default UserPerformanceDashboard;