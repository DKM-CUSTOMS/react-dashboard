/* UserCompareDashboard.jsx - Expert Analytics Comparison */
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler } from "chart.js";
import { Bar, Line, Doughnut } from "react-chartjs-2";
import { format, subDays, eachDayOfInterval, parseISO, differenceInDays } from "date-fns";
import { useParams, useNavigate } from "react-router-dom";

import {
  TrendingUp, TrendingDown, FileText, Clock, BarChart3, Zap, Activity, X,
  ArrowLeftRight, FileEdit, Calendar, Printer, RefreshCw, Building2,
  Target, Award, AlertTriangle, CheckCircle, Users, ArrowLeft,
  ChevronRight, Scale, Flame, Shield, Brain, Lightbulb
} from "lucide-react";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler);

// --- Caching System ---
const CACHE_TTL = 15 * 60 * 1000;
const inMemoryPromiseCache = new Map();

const cache = {
  getKey: (username) => `user_compare_${username}`,
  read: (username) => {
    try {
      const raw = localStorage.getItem(cache.getKey(username));
      if (!raw) return null;
      const { timestamp, payload } = JSON.parse(raw);
      return { isStale: Date.now() - timestamp > CACHE_TTL, payload };
    } catch { return null; }
  },
  write: (username, payload) => {
    try {
      localStorage.setItem(cache.getKey(username), JSON.stringify({ ts: Date.now(), payload }));
    } catch { }
  },
};

// --- Expert Analytics Engine ---
const AnalyticsEngine = {
  // Calculate Efficiency Score (0-100) for Customs Declarant Context
  // Declarants enter data from declaration files into the system
  // More modifications = handling complex declarations with more data fields (positive)
  calculateEfficiencyScore: (user) => {
    const avgFilesPerDay = parseFloat(user.avgFilesPerDay) || 0;
    const modsPerFile = parseFloat(user.modificationsPerFile) || 0;
    const autoPercentage = user.autoPercentage || 0;

    // For declarants: output volume is key, complexity handling is valuable
    const outputScore = Math.min(avgFilesPerDay * 8, 50); // max 50 points for volume
    const complexityBonus = Math.min(modsPerFile * 1.5, 25); // max 25 points (more edits = complex declarations)
    const automationScore = autoPercentage * 0.25; // max 25 points

    return Math.round(Math.min(100, outputScore + complexityBonus + automationScore));
  },

  // Calculate Consistency Score based on daily variance
  calculateConsistency: (dailyMetrics) => {
    if (!dailyMetrics || dailyMetrics.length < 5) return { score: 50, label: 'Insufficient Data' };

    const files = dailyMetrics.slice(-30).map(d => d.files || 0).filter(f => f > 0);
    if (files.length < 3) return { score: 50, label: 'Insufficient Data' };

    const mean = files.reduce((a, b) => a + b, 0) / files.length;
    const variance = files.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / files.length;
    const stdDev = Math.sqrt(variance);
    const cv = mean > 0 ? (stdDev / mean) * 100 : 100; // Coefficient of variation

    const score = Math.max(0, Math.min(100, 100 - cv));
    let label = 'Variable';
    if (score >= 80) label = 'Very Consistent';
    else if (score >= 60) label = 'Consistent';
    else if (score >= 40) label = 'Moderate';

    return { score: Math.round(score), label };
  },

  // Calculate Workload Capacity
  calculateCapacity: (user, dailyMetrics) => {
    const maxDay = Math.max(...(dailyMetrics || []).map(d => d.files || 0));
    const avgDay = parseFloat(user.avgFilesPerDay) || 0;
    const utilizationRate = maxDay > 0 ? (avgDay / maxDay) * 100 : 0;

    return {
      max: maxDay,
      avg: avgDay,
      utilization: Math.round(utilizationRate),
      headroom: Math.round(100 - utilizationRate)
    };
  },

  // Generate Strategic Recommendations
  generateRecommendations: (u1, u2, data1, data2) => {
    const recommendations = [];

    const efficiency1 = AnalyticsEngine.calculateEfficiencyScore(u1);
    const efficiency2 = AnalyticsEngine.calculateEfficiencyScore(u2);
    const consistency1 = AnalyticsEngine.calculateConsistency(data1.dailyMetrics);
    const consistency2 = AnalyticsEngine.calculateConsistency(data2.dailyMetrics);

    // Efficiency comparison
    if (Math.abs(efficiency1 - efficiency2) > 15) {
      const winner = efficiency1 > efficiency2 ? u1 : u2;
      const loser = efficiency1 > efficiency2 ? u2 : u1;
      recommendations.push({
        type: 'efficiency',
        priority: 'high',
        title: 'Efficiency Gap Detected',
        description: `${winner.name} operates at ${Math.max(efficiency1, efficiency2)}% efficiency vs ${loser.name}'s ${Math.min(efficiency1, efficiency2)}%. Consider knowledge transfer.`,
        action: `Review ${winner.name}'s workflow practices for ${loser.name} to adopt.`,
        icon: Zap
      });
    }

    // Consistency analysis
    if (consistency1.score < 50 || consistency2.score < 50) {
      const inconsistent = consistency1.score < consistency2.score ? u1 : u2;
      recommendations.push({
        type: 'consistency',
        priority: 'medium',
        title: 'Workload Inconsistency',
        description: `${inconsistent.name} shows high variance in daily output. This may indicate workload distribution issues or external blockers.`,
        action: 'Investigate daily work patterns and identify potential bottlenecks.',
        icon: Activity
      });
    }

    // Automation opportunity
    if (u1.autoPercentage < 20 && u2.autoPercentage > 50) {
      recommendations.push({
        type: 'automation',
        priority: 'high',
        title: 'Automation Opportunity',
        description: `${u1.name} relies heavily on manual processing (${100 - u1.autoPercentage}% manual) while ${u2.name} leverages automation effectively.`,
        action: `Explore automating ${u1.name}'s repetitive tasks based on ${u2.name}'s approach.`,
        icon: Target
      });
    } else if (u2.autoPercentage < 20 && u1.autoPercentage > 50) {
      recommendations.push({
        type: 'automation',
        priority: 'high',
        title: 'Automation Opportunity',
        description: `${u2.name} relies heavily on manual processing (${100 - u2.autoPercentage}% manual) while ${u1.name} leverages automation effectively.`,
        action: `Explore automating ${u2.name}'s repetitive tasks based on ${u1.name}'s approach.`,
        icon: Target
      });
    }

    // Complex declaration handling (high modifications = handling complex files)
    const modsPerFile1 = parseFloat(u1.modificationsPerFile) || 0;
    const modsPerFile2 = parseFloat(u2.modificationsPerFile) || 0;
    if (Math.abs(modsPerFile1 - modsPerFile2) > 10) {
      const complexHandler = modsPerFile1 > modsPerFile2 ? u1 : u2;
      const simpleHandler = modsPerFile1 > modsPerFile2 ? u2 : u1;
      recommendations.push({
        type: 'complexity',
        priority: 'low',
        title: 'Declaration Complexity Distribution',
        description: `${complexHandler.name} handles more complex declarations (${Math.max(modsPerFile1, modsPerFile2).toFixed(1)} edits/file avg) with more data fields. ${simpleHandler.name} processes simpler declarations.`,
        action: 'Consider if complex declaration assignments should be balanced across the team.',
        icon: FileEdit
      });
    }

    // Company specialization synergy
    if (u1.mostActiveCompany !== u2.mostActiveCompany) {
      recommendations.push({
        type: 'synergy',
        priority: 'low',
        title: 'Complementary Specializations',
        description: `${u1.name} specializes in ${u1.mostActiveCompany}, while ${u2.name} focuses on ${u2.mostActiveCompany}.`,
        action: 'Consider cross-training to improve team coverage.',
        icon: Users
      });
    }

    return recommendations;
  },

  // Determine winner for each metric
  compareMetric: (val1, val2, higherIsBetter = true) => {
    const v1 = parseFloat(val1) || 0;
    const v2 = parseFloat(val2) || 0;
    if (v1 === v2) return 'tie';
    if (higherIsBetter) return v1 > v2 ? 'user1' : 'user2';
    return v1 < v2 ? 'user1' : 'user2';
  }
};

// --- Data Transformation ---
const transformApiData = (apiData, username) => {
  if (!apiData?.user || !apiData?.daily_metrics || !apiData?.summary) return null;

  const { summary, daily_metrics } = apiData;
  const dailyMetrics = daily_metrics.map(day => ({
    date: day.date,
    manual: day.manual_files_created || 0,
    auto: day.automatic_files_created || 0,
    files: (day.manual_files_created || 0) + (day.automatic_files_created || 0),
    modifications: day.modification_count || 0,
  }));

  const companySpecialization = Object.entries(summary.company_specialization || {})
    .map(([company, files]) => ({ company, files }))
    .sort((a, b) => b.files - a.files);

  const hourlyActivity = Array.from({ length: 24 }, (_, h) => h)
    .filter(h => h >= 7 && h <= 19)
    .map(h => ({ hour: `${h}:00`, activity: summary.activity_by_hour?.[h] || 0 }));

  const activityDays = Object.entries(summary.activity_days || {}).map(([date, count]) => ({ date, count }));
  const mostActiveCompany = companySpecialization[0] || { company: "N/A", files: 0 };

  return {
    user: {
      id: username,
      name: username.replace(".", " ").replace(/\b\w/g, l => l.toUpperCase()),
      totalFiles: summary.total_files_handled || 0,
      totalModifications: summary.total_modifications || 0,
      avgTime: (summary.avg_creation_time || 0).toFixed(2),
      avgFilesPerDay: (summary.avg_files_per_day || 0).toFixed(1),
      modificationsPerFile: (summary.modifications_per_file || 0).toFixed(1),
      mostActiveCompany: mostActiveCompany.company,
      mostActiveHour: summary.hour_with_most_activity ? `${summary.hour_with_most_activity}:00` : "N/A",
      manualPercentage: Math.round(summary.manual_vs_auto_ratio?.manual_percent || 0),
      autoPercentage: Math.round(summary.manual_vs_auto_ratio?.automatic_percent || 0),
      daysActive: summary.days_active || 0,
    },
    dailyMetrics,
    charts: { companySpecialization, hourlyActivity, activityDays },
  };
};

// --- API Fetching ---
const fetchUser = (username, force = false) => {
  const cachedData = cache.read(username);
  if (!force && inMemoryPromiseCache.has(username)) return inMemoryPromiseCache.get(username);

  const fetchPromise = new Promise(async (resolve, reject) => {
    if (!force && cachedData && !cachedData.isStale) return resolve(cachedData.payload);

    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/performance?user=${username}&code=${import.meta.env.VITE_API_CODE}`);
      if (!res.ok) throw new Error(`API error: ${res.statusText}`);
      const transformed = transformApiData(await res.json(), username);
      if (!transformed) throw new Error("Transform failed");
      cache.write(username, transformed);
      resolve(transformed);
    } catch (err) {
      if (cachedData) resolve(cachedData.payload);
      else reject(err);
    } finally {
      inMemoryPromiseCache.delete(username);
    }
  });

  if (!force) inMemoryPromiseCache.set(username, fetchPromise);
  return fetchPromise;
};

// --- UI Components ---
const ScoreGauge = ({ score, label, color = "blue", size = "md" }) => {
  const sizeClasses = { sm: "w-16 h-16", md: "w-24 h-24", lg: "w-32 h-32" };
  const textSizes = { sm: "text-lg", md: "text-2xl", lg: "text-3xl" };
  const colorMap = { blue: "#3b82f6", emerald: "#10b981", orange: "#f97316", red: "#ef4444", purple: "#8b5cf6" };

  return (
    <div className="flex flex-col items-center">
      <div className={`relative ${sizeClasses[size]}`}>
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle cx="50" cy="50" r="40" stroke="#e5e7eb" strokeWidth="8" fill="none" />
          <circle
            cx="50" cy="50" r="40"
            stroke={colorMap[color]}
            strokeWidth="8"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${score * 2.51} 251`}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`${textSizes[size]} font-bold text-gray-900`}>{score}</span>
        </div>
      </div>
      <p className="text-xs text-gray-500 mt-1 font-medium">{label}</p>
    </div>
  );
};

const MetricCompareCard = ({ title, icon: Icon, value1, value2, unit = "", higherIsBetter = true, u1Name, u2Name }) => {
  const winner = AnalyticsEngine.compareMetric(value1, value2, higherIsBetter);

  return (
    <div className="bg-white rounded-sm border border-gray-100 p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-3 text-gray-600">
        <Icon className="w-4 h-4" />
        <span className="text-xs font-bold uppercase tracking-wide">{title}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className={`p-3 rounded-sm text-center ${winner === 'user1' ? 'bg-blue-50 ring-2 ring-blue-200' : 'bg-gray-50'}`}>
          <p className={`text-xl font-bold ${winner === 'user1' ? 'text-blue-600' : 'text-gray-700'}`}>
            {value1}{unit}
          </p>
          <p className="text-[10px] text-gray-500 truncate">{u1Name}</p>
          {winner === 'user1' && <Award className="w-3 h-3 text-blue-500 mx-auto mt-1" />}
        </div>
        <div className={`p-3 rounded-sm text-center ${winner === 'user2' ? 'bg-emerald-50 ring-2 ring-emerald-200' : 'bg-gray-50'}`}>
          <p className={`text-xl font-bold ${winner === 'user2' ? 'text-emerald-600' : 'text-gray-700'}`}>
            {value2}{unit}
          </p>
          <p className="text-[10px] text-gray-500 truncate">{u2Name}</p>
          {winner === 'user2' && <Award className="w-3 h-3 text-emerald-500 mx-auto mt-1" />}
        </div>
      </div>
    </div>
  );
};

const RecommendationCard = ({ recommendation }) => {
  const Icon = recommendation.icon;
  const priorityColors = {
    high: 'border-red-200 bg-red-50',
    medium: 'border-orange-200 bg-orange-50',
    low: 'border-blue-200 bg-blue-50'
  };
  const iconColors = {
    high: 'text-red-600 bg-red-100',
    medium: 'text-orange-600 bg-orange-100',
    low: 'text-blue-600 bg-blue-100'
  };

  return (
    <div className={`p-4 rounded-sm border ${priorityColors[recommendation.priority]}`}>
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-sm ${iconColors[recommendation.priority]}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-bold text-gray-900 text-sm">{recommendation.title}</h4>
            <span className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded-full ${recommendation.priority === 'high' ? 'bg-red-200 text-red-700' :
              recommendation.priority === 'medium' ? 'bg-orange-200 text-orange-700' :
                'bg-blue-200 text-blue-700'
              }`}>
              {recommendation.priority}
            </span>
          </div>
          <p className="text-xs text-gray-600 mb-2">{recommendation.description}</p>
          <div className="flex items-center gap-1.5 text-xs text-gray-800 font-medium">
            <Lightbulb className="w-3 h-3 text-yellow-500" />
            <span>{recommendation.action}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const UserSummaryCard = ({ user, data, color, efficiencyScore, consistencyScore }) => {
  const colorClasses = {
    blue: { bg: 'bg-blue-600', ring: 'ring-blue-200', text: 'text-blue-600', light: 'bg-blue-50' },
    emerald: { bg: 'bg-emerald-600', ring: 'ring-emerald-200', text: 'text-emerald-600', light: 'bg-emerald-50' }
  };
  const c = colorClasses[color];

  return (
    <div className="bg-white rounded-sm border border-gray-100 p-5 shadow-sm">
      <div className="flex items-center gap-4 mb-4">
        <div className={`w-14 h-14 rounded-sm ${c.bg} flex items-center justify-center text-white text-xl font-bold`}>
          {user.name.split(' ').map(n => n[0]).join('')}
        </div>
        <div>
          <h3 className="font-bold text-gray-900 text-lg">{user.name}</h3>
          <p className="text-xs text-gray-500">
            {user.daysActive} active days • {user.mostActiveCompany} specialist
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <ScoreGauge score={efficiencyScore} label="Efficiency" color={color} size="sm" />
        <ScoreGauge score={consistencyScore.score} label="Consistency" color={color} size="sm" />
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className={`${c.light} p-2 rounded-sm`}>
          <p className={`text-lg font-bold ${c.text}`}>{user.totalFiles}</p>
          <p className="text-[9px] text-gray-500 uppercase">Files</p>
        </div>
        <div className={`${c.light} p-2 rounded-sm`}>
          <p className={`text-lg font-bold ${c.text}`}>{user.avgFilesPerDay}</p>
          <p className="text-[9px] text-gray-500 uppercase">Avg/Day</p>
        </div>
        <div className={`${c.light} p-2 rounded-sm`}>
          <p className={`text-lg font-bold ${c.text}`}>{user.autoPercentage}%</p>
          <p className="text-[9px] text-gray-500 uppercase">Auto</p>
        </div>
      </div>
    </div>
  );
};

const ChartCard = ({ title, icon: Icon, children }) => (
  <div className="bg-white rounded-sm border border-gray-100 shadow-sm">
    <div className="px-4 py-3 border-b border-gray-50 flex items-center gap-2">
      <Icon className="w-4 h-4 text-gray-400" />
      <h3 className="text-sm font-bold text-gray-800">{title}</h3>
    </div>
    <div className="p-4 h-64">{children}</div>
  </div>
);

// --- Main Dashboard ---
const UserCompareDashboard = () => {
  const navigate = useNavigate();
  const params = useParams();
  const dashboardRef = useRef(null);

  // Handle both routes: /compare/:user1/:user2 OR /compare-multi/:usernames
  const userList = useMemo(() => {
    if (params.usernames) {
      // Multi-user route
      return params.usernames.split(',').filter(Boolean);
    } else if (params.user1 && params.user2) {
      // 2-user route
      return [params.user1, params.user2];
    }
    return [];
  }, [params]);

  const [usersData, setUsersData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadUsers = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const results = await Promise.all(userList.map(username => fetchUser(username, force)));
      const validResults = results.filter(Boolean);
      if (validResults.length < 2) throw new Error("Need at least 2 users");
      setUsersData(validResults);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userList]);

  useEffect(() => {
    if (username1 && username2) loadUsers();
    else { setError("Two usernames required"); setLoading(false); }
  }, [username1, username2, loadUsers]);

  // Computed Analytics
  const analytics = useMemo(() => {
    if (!data1 || !data2) return null;

    const u1 = data1.user;
    const u2 = data2.user;

    return {
      efficiency1: AnalyticsEngine.calculateEfficiencyScore(u1),
      efficiency2: AnalyticsEngine.calculateEfficiencyScore(u2),
      consistency1: AnalyticsEngine.calculateConsistency(data1.dailyMetrics),
      consistency2: AnalyticsEngine.calculateConsistency(data2.dailyMetrics),
      capacity1: AnalyticsEngine.calculateCapacity(u1, data1.dailyMetrics),
      capacity2: AnalyticsEngine.calculateCapacity(u2, data2.dailyMetrics),
      recommendations: AnalyticsEngine.generateRecommendations(u1, u2, data1, data2),
      overallWinner: AnalyticsEngine.calculateEfficiencyScore(u1) > AnalyticsEngine.calculateEfficiencyScore(u2) ? 'user1' : 'user2'
    };
  }, [data1, data2]);

  // Chart Data
  const chartData = useMemo(() => {
    if (!data1 || !data2) return null;

    const allDates = [...new Set([...data1.dailyMetrics.map(d => d.date), ...data2.dailyMetrics.map(d => d.date)])].sort().slice(-30);

    return {
      productivity: {
        labels: allDates.map(d => format(parseISO(d), 'MMM dd')),
        datasets: [
          { label: data1.user.name, data: allDates.map(date => data1.dailyMetrics.find(d => d.date === date)?.files || 0), borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', fill: true, tension: 0.4 },
          { label: data2.user.name, data: allDates.map(date => data2.dailyMetrics.find(d => d.date === date)?.files || 0), borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', fill: true, tension: 0.4 }
        ]
      },
      hourly: {
        labels: data1.charts.hourlyActivity.map(h => h.hour),
        datasets: [
          { label: data1.user.name, data: data1.charts.hourlyActivity.map(h => h.activity), backgroundColor: 'rgba(59, 130, 246, 0.8)', barPercentage: 0.6 },
          { label: data2.user.name, data: data2.charts.hourlyActivity.map(h => h.activity), backgroundColor: 'rgba(16, 185, 129, 0.8)', barPercentage: 0.6 }
        ]
      },
      workStyle: {
        labels: ['Manual', 'Automatic'],
        user1: [data1.user.manualPercentage, data1.user.autoPercentage],
        user2: [data2.user.manualPercentage, data2.user.autoPercentage]
      }
    };
  }, [data1, data2]);

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'top', labels: { font: { size: 10 } } } },
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: '#f3f4f6' } } }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-10 h-10 text-blue-500 animate-spin mx-auto mb-3" />
          <p className="text-gray-600 text-sm">Loading comparison data...</p>
        </div>
      </div>
    );
  }

  if (error || !data1 || !data2 || !analytics) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center bg-white p-8 rounded-sm shadow-sm border border-gray-100">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-3" />
          <p className="text-gray-900 font-bold mb-2">Error Loading Data</p>
          <p className="text-gray-500 text-sm mb-4">{error || "Unknown error"}</p>
          <button onClick={() => navigate(-1)} className="px-4 py-2 bg-gray-900 text-white text-sm rounded-sm hover:bg-gray-800">
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const u1 = data1.user;
  const u2 = data2.user;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-20">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-sm">
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
            <div>
              <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <Brain className="w-5 h-5 text-purple-600" />
                Expert Comparison Analysis
              </h1>
              <p className="text-xs text-gray-500">{u1.name} vs {u2.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadUsers(true)}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-sm hover:bg-gray-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main ref={dashboardRef} className="p-6">
        <div className="space-y-6 max-w-7xl mx-auto">

          {/* User Summary Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <UserSummaryCard
              user={u1}
              data={data1}
              color="blue"
              efficiencyScore={analytics.efficiency1}
              consistencyScore={analytics.consistency1}
            />
            <UserSummaryCard
              user={u2}
              data={data2}
              color="emerald"
              efficiencyScore={analytics.efficiency2}
              consistencyScore={analytics.consistency2}
            />
          </div>

          {/* Key Metrics Comparison */}
          <div className="bg-white rounded-sm border border-gray-100 shadow-sm p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Scale className="w-4 h-4 text-gray-400" />
              HEAD-TO-HEAD COMPARISON
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCompareCard title="Total Output" icon={FileText} value1={u1.totalFiles} value2={u2.totalFiles} u1Name={u1.name} u2Name={u2.name} />
              <MetricCompareCard title="Daily Average" icon={TrendingUp} value1={u1.avgFilesPerDay} value2={u2.avgFilesPerDay} u1Name={u1.name} u2Name={u2.name} />
              <MetricCompareCard title="Complexity/File" icon={FileEdit} value1={u1.modificationsPerFile} value2={u2.modificationsPerFile} higherIsBetter={true} u1Name={u1.name} u2Name={u2.name} />
              <MetricCompareCard title="Automation" icon={Zap} value1={u1.autoPercentage} value2={u2.autoPercentage} unit="%" u1Name={u1.name} u2Name={u2.name} />
            </div>
          </div>

          {/* Strategic Recommendations */}
          <div className="bg-white rounded-sm border border-gray-100 shadow-sm p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Brain className="w-4 h-4 text-purple-500" />
              STRATEGIC RECOMMENDATIONS
              <span className="ml-auto text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                {analytics.recommendations.length} Insights
              </span>
            </h2>
            {analytics.recommendations.length > 0 ? (
              <div className="space-y-3">
                {analytics.recommendations.map((rec, idx) => (
                  <RecommendationCard key={idx} recommendation={rec} />
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <CheckCircle className="w-10 h-10 mx-auto mb-2 text-green-400" />
                <p className="text-sm">Both users are performing optimally. No immediate actions needed.</p>
              </div>
            )}
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard title="30-Day Production Trend" icon={BarChart3}>
              <Line data={chartData.productivity} options={chartOptions} />
            </ChartCard>
            <ChartCard title="Hourly Activity Pattern" icon={Clock}>
              <Bar data={chartData.hourly} options={chartOptions} />
            </ChartCard>
          </div>

          {/* Work Style Comparison */}
          <div className="bg-white rounded-sm border border-gray-100 shadow-sm p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4 text-gray-400" />
              WORK STYLE ANALYSIS
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex items-center gap-6">
                <div className="w-32 h-32">
                  <Doughnut
                    data={{
                      labels: ['Manual', 'Auto'],
                      datasets: [{ data: chartData.workStyle.user1, backgroundColor: ['#3b82f6', '#93c5fd'], borderWidth: 0 }]
                    }}
                    options={{ cutout: '70%', plugins: { legend: { display: false } } }}
                  />
                </div>
                <div>
                  <p className="font-bold text-gray-900">{u1.name}</p>
                  <p className="text-sm text-gray-500 mb-2">
                    {u1.manualPercentage > 60 ? 'Manual Specialist' : u1.autoPercentage > 40 ? 'Automation Focused' : 'Balanced Approach'}
                  </p>
                  <div className="space-y-1 text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-blue-500 rounded-sm"></div>
                      <span>Manual: {u1.manualPercentage}%</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-blue-300 rounded-sm"></div>
                      <span>Automatic: {u1.autoPercentage}%</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <div className="w-32 h-32">
                  <Doughnut
                    data={{
                      labels: ['Manual', 'Auto'],
                      datasets: [{ data: chartData.workStyle.user2, backgroundColor: ['#10b981', '#6ee7b7'], borderWidth: 0 }]
                    }}
                    options={{ cutout: '70%', plugins: { legend: { display: false } } }}
                  />
                </div>
                <div>
                  <p className="font-bold text-gray-900">{u2.name}</p>
                  <p className="text-sm text-gray-500 mb-2">
                    {u2.manualPercentage > 60 ? 'Manual Specialist' : u2.autoPercentage > 40 ? 'Automation Focused' : 'Balanced Approach'}
                  </p>
                  <div className="space-y-1 text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-emerald-500 rounded-sm"></div>
                      <span>Manual: {u2.manualPercentage}%</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-emerald-300 rounded-sm"></div>
                      <span>Automatic: {u2.autoPercentage}%</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
};

export default UserCompareDashboard;