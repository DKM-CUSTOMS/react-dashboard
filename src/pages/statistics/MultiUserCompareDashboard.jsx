/* MultiUserCompareDashboard.jsx - Expert Comparison for 2-6 Users */
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler } from "chart.js";
import { Bar, Line, Doughnut } from "react-chartjs-2";
import { useParams, useNavigate } from "react-router-dom";
import {
    TrendingUp, FileText, Clock, BarChart3, Zap, Activity, X,
    ArrowLeft, RefreshCw, Users, Target, Award, AlertTriangle,
    CheckCircle, Brain, Lightbulb, Scale, FileEdit, Trophy
} from "lucide-react";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler);

// Cache
const CACHE_TTL = 15 * 60 * 1000;
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
            localStorage.setItem(cache.getKey(username), JSON.stringify({ timestamp: Date.now(), payload }));
        } catch { }
    },
};

// Analytics Engine
const AnalyticsEngine = {
    calculateEfficiencyScore: (user) => {
        const avgFilesPerDay = parseFloat(user.avgFilesPerDay) || 0;
        const modsPerFile = parseFloat(user.modificationsPerFile) || 0;
        const autoPercentage = user.autoPercentage || 0;

        const outputScore = Math.min(avgFilesPerDay * 8, 50);
        const complexityBonus = Math.min(modsPerFile * 1.5, 25);
        const automationScore = autoPercentage * 0.25;

        return Math.round(Math.min(100, outputScore + complexityBonus + automationScore));
    },

    calculateConsistency: (dailyMetrics) => {
        if (!dailyMetrics || dailyMetrics.length < 5) return { score: 50, label: 'Insufficient Data' };

        const files = dailyMetrics.slice(-30).map(d => d.files || 0).filter(f => f > 0);
        if (files.length < 3) return { score: 50, label: 'Insufficient Data' };

        const mean = files.reduce((a, b) => a + b, 0) / files.length;
        const variance = files.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / files.length;
        const stdDev = Math.sqrt(variance);
        const cv = mean > 0 ? (stdDev / mean) * 100 : 100;

        const score = Math.max(0, Math.min(100, 100 - cv));
        let label = 'Variable';
        if (score >= 80) label = 'Very Consistent';
        else if (score >= 60) label = 'Consistent';
        else if (score >= 40) label = 'Moderate';

        return { score: Math.round(score), label };
    },

    compareMetric: (val1, val2, higherIsBetter = true) => {
        const v1 = parseFloat(val1) || 0;
        const v2 = parseFloat(val2) || 0;
        if (v1 === v2) return 'tie';
        if (higherIsBetter) return v1 > v2 ? 'user1' : 'user2';
        return v1 < v2 ? 'user1' : 'user2';
    }
};

// Data transformation
const transformApiData = (apiData, username) => {
    if (!apiData?.user || !apiData?.daily_metrics || !apiData?.summary) return null;
    const { summary, daily_metrics } = apiData;

    return {
        user: {
            id: username,
            name: username.replace(/\./g, " ").replace(/\b\w/g, l => l.toUpperCase()),
            totalFiles: summary.total_files_handled || 0,
            avgFilesPerDay: (summary.avg_files_per_day || 0).toFixed(1),
            modificationsPerFile: (summary.modifications_per_file || 0).toFixed(1),
            autoPercentage: Math.round(summary.manual_vs_auto_ratio?.automatic_percent || 0),
            manualPercentage: Math.round(summary.manual_vs_auto_ratio?.manual_percent || 0),
            daysActive: summary.days_active || 0,
            mostActiveCompany: Object.entries(summary.company_specialization || {})
                .sort(([, a], [, b]) => b - a)[0]?.[0] || "N/A"
        },
        dailyMetrics: daily_metrics.map(d => ({
            date: d.date,
            files: (d.manual_files_created || 0) + (d.automatic_files_created || 0)
        }))
    };
};

// Fetch user
const fetchUser = async (username) => {
    const cached = cache.read(username);
    if (cached && !cached.isStale) return cached.payload;

    try {
        const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/performance?user=${username}&code=${import.meta.env.VITE_API_CODE}`);
        if (!res.ok) throw new Error("API error");
        const transformed = transformApiData(await res.json(), username);
        cache.write(username, transformed);
        return transformed;
    } catch {
        return cached?.payload || null;
    }
};

// Components
const ScoreGauge = ({ score, label, color = "blue", size = "md" }) => {
    const sizeClasses = { sm: "w-16 h-16", md: "w-24 h-24", lg: "w-32 h-32" };
    const textSizes = { sm: "text-lg", md: "text-2xl", lg: "text-3xl" };
    const colorMap = { blue: "#3b82f6", emerald: "#10b981", purple: "#8b5cf6", orange: "#f97316", pink: "#ec4899", cyan: "#06b6d4" };

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

const UserSummaryCard = ({ data, color, efficiencyScore, consistencyScore }) => {
    const user = data.user;
    const colorClasses = {
        blue: { bg: 'bg-blue-600', light: 'bg-blue-50', text: 'text-blue-600' },
        emerald: { bg: 'bg-emerald-600', light: 'bg-emerald-50', text: 'text-emerald-600' },
        purple: { bg: 'bg-purple-600', light: 'bg-purple-50', text: 'text-purple-600' },
        orange: { bg: 'bg-orange-600', light: 'bg-orange-50', text: 'text-orange-600' },
        pink: { bg: 'bg-pink-600', light: 'bg-pink-50', text: 'text-pink-600' },
        cyan: { bg: 'bg-cyan-600', light: 'bg-cyan-50', text: 'text-cyan-600' }
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

const MultiUserCompareDashboard = () => {
    const navigate = useNavigate();
    const { usernames } = useParams();
    const [usersData, setUsersData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const userList = useMemo(() => usernames?.split(',').filter(Boolean) || [], [usernames]);
    const userColors = useMemo(() => ['blue', 'emerald', 'purple', 'orange', 'pink', 'cyan'], []);

    const loadUsers = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const results = await Promise.all(userList.map(fetchUser));
            const validResults = results.filter(Boolean);
            if (validResults.length < 2) throw new Error("Need at least 2 users");
            setUsersData(validResults);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [userList]);

    useEffect(() => {
        if (userList.length >= 2) loadUsers();
        else { setError("At least 2 users required"); setLoading(false); }
    }, [userList, loadUsers]);

    const analytics = useMemo(() => {
        if (!usersData.length) return null;

        return usersData.map(data => ({
            user: data.user,
            efficiency: AnalyticsEngine.calculateEfficiencyScore(data.user),
            consistency: AnalyticsEngine.calculateConsistency(data.dailyMetrics)
        }));
    }, [usersData]);

    const chartData = useMemo(() => {
        if (!usersData.length) return null;

        const colors = ['#3b82f6', '#10b981', '#8b5cf6', '#f97316', '#ec4899', '#06b6d4'];
        return {
            output: {
                labels: usersData.map(d => d.user.name),
                datasets: [{
                    label: 'Total Files',
                    data: usersData.map(d => d.user.totalFiles),
                    backgroundColor: colors.slice(0, usersData.length)
                }]
            },
            daily: {
                labels: usersData.map(d => d.user.name),
                datasets: [{
                    label: 'Files/Day',
                    data: usersData.map(d => parseFloat(d.user.avgFilesPerDay)),
                    backgroundColor: colors.slice(0, usersData.length)
                }]
            },
            complexity: {
                labels: usersData.map(d => d.user.name),
                datasets: [{
                    label: 'Edits/File',
                    data: usersData.map(d => parseFloat(d.user.modificationsPerFile)),
                    backgroundColor: colors.slice(0, usersData.length)
                }]
            }
        };
    }, [usersData]);

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center">
                    <RefreshCw className="w-10 h-10 text-blue-500 animate-spin mx-auto mb-3" />
                    <p className="text-gray-600 text-sm">Loading expert analysis...</p>
                </div>
            </div>
        );
    }

    if (error || !analytics || !chartData) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center bg-white p-8 rounded-sm shadow-sm border border-gray-100">
                    <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-3" />
                    <p className="text-gray-900 font-bold mb-2">Error</p>
                    <p className="text-gray-500 text-sm mb-4">{error || "Failed to load"}</p>
                    <button onClick={() => navigate(-1)} className="px-4 py-2 bg-gray-900 text-white text-sm rounded-sm hover:bg-gray-800">
                        Go Back
                    </button>
                </div>
            </div>
        );
    }

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { font: { size: 10 } } } },
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: '#f3f4f6' } } }
    };

    return (
        <div className="min-h-screen bg-gray-50">
            <header className="bg-white border-b border-gray-100 sticky top-0 z-20">
                <div className="px-6 py-4 flex items-center gap-4">
                    <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-sm">
                        <ArrowLeft className="w-5 h-5 text-gray-600" />
                    </button>
                    <div>
                        <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                            <Brain className="w-5 h-5 text-purple-600" />
                            Expert Comparison Analysis
                        </h1>
                        <p className="text-xs text-gray-500">{usersData.length} declarants compared</p>
                    </div>
                    <button
                        onClick={loadUsers}
                        className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-sm hover:bg-gray-50"
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Refresh
                    </button>
                </div>
            </header>

            <main className="p-6 max-w-7xl mx-auto">
                <div className="space-y-6">

                    {/* User Summary Cards Grid */}
                    <div className={`grid grid-cols-1 ${usersData.length === 2 ? 'lg:grid-cols-2' : usersData.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-3'} gap-6`}>
                        {analytics.map((analytic, index) => (
                            <UserSummaryCard
                                key={analytic.user.id}
                                data={usersData[index]}
                                color={userColors[index]}
                                efficiencyScore={analytic.efficiency}
                                consistencyScore={analytic.consistency}
                            />
                        ))}
                    </div>

                    {/* Key Metrics Comparison */}
                    <div className="bg-white rounded-sm border border-gray-100 shadow-sm p-5">
                        <h2 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
                            <Scale className="w-4 h-4 text-gray-400" />
                            KEY METRICS COMPARISON
                        </h2>
                        <div className={`grid grid-cols-2 ${usersData.length > 2 ? 'md:grid-cols-3 lg:grid-cols-6' : 'md:grid-cols-4'} gap-4`}>
                            {usersData.map((data, index) => (
                                <div key={data.user.id} className="text-center p-3 bg-gray-50 rounded-sm">
                                    <div className={`w-10 h-10 mx-auto mb-2 rounded-sm bg-${userColors[index]}-600 flex items-center justify-center text-white text-sm font-bold`}>
                                        {data.user.name.split(' ').map(n => n[0]).join('')}
                                    </div>
                                    <p className="text-xs font-medium text-gray-900 truncate mb-2">{data.user.name}</p>
                                    <div className="space-y-1 text-xs">
                                        <div>
                                            <span className="text-gray-500">Efficiency:</span>{' '}
                                            <span className="font-bold text-gray-900">{analytics[index].efficiency}</span>
                                        </div>
                                        <div>
                                            <span className="text-gray-500">Output:</span>{' '}
                                            <span className="font-bold text-gray-900">{data.user.totalFiles}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Charts */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="bg-white rounded-sm border border-gray-100 shadow-sm">
                            <div className="px-4 py-3 border-b border-gray-100">
                                <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                                    <BarChart3 className="w-4 h-4 text-gray-400" />
                                    Total Output Comparison
                                </h3>
                            </div>
                            <div className="p-4 h-64">
                                <Bar data={chartData.output} options={chartOptions} />
                            </div>
                        </div>

                        <div className="bg-white rounded-sm border border-gray-100 shadow-sm">
                            <div className="px-4 py-3 border-b border-gray-100">
                                <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                                    <TrendingUp className="w-4 h-4 text-gray-400" />
                                    Daily Average Comparison
                                </h3>
                            </div>
                            <div className="p-4 h-64">
                                <Bar data={chartData.daily} options={chartOptions} />
                            </div>
                        </div>

                        <div className="bg-white rounded-sm border border-gray-100 shadow-sm">
                            <div className="px-4 py-3 border-b border-gray-100">
                                <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                                    <FileEdit className="w-4 h-4 text-gray-400" />
                                    Complexity Handled
                                </h3>
                            </div>
                            <div className="p-4 h-64">
                                <Bar data={chartData.complexity} options={chartOptions} />
                            </div>
                        </div>

                        {/* Work Style Distribution */}
                        <div className="bg-white rounded-sm border border-gray-100 shadow-sm">
                            <div className="px-4 py-3 border-b border-gray-100">
                                <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                                    <Activity className="w-4 h-4 text-gray-400" />
                                    Work Style Overview
                                </h3>
                            </div>
                            <div className="p-4">
                                <div className="space-y-4">
                                    {usersData.map((data, index) => (
                                        <div key={data.user.id}>
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="text-xs font-medium text-gray-700">{data.user.name}</span>
                                                <span className="text-xs text-gray-500">{data.user.autoPercentage}% Auto</span>
                                            </div>
                                            <div className="h-6 bg-gray-100 rounded-full overflow-hidden flex">
                                                <div
                                                    className={`bg-${userColors[index]}-600 flex items-center justify-center text-[10px] font-bold text-white`}
                                                    style={{ width: `${data.user.manualPercentage}%` }}
                                                >
                                                    {data.user.manualPercentage > 15 && `${data.user.manualPercentage}% M`}
                                                </div>
                                                <div
                                                    className={`bg-${userColors[index]}-300 flex items-center justify-center text-[10px] font-bold text-white`}
                                                    style={{ width: `${data.user.autoPercentage}%` }}
                                                >
                                                    {data.user.autoPercentage > 15 && `${data.user.autoPercentage}% A`}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Strategic Insights */}
                    <div className="bg-white rounded-sm border border-gray-100 shadow-sm p-5">
                        <h2 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
                            <Brain className="w-4 h-4 text-purple-500" />
                            EXPERT INSIGHTS
                        </h2>
                        <div className="space-y-3">
                            {/* Top Performer */}
                            {(() => {
                                const topPerformer = analytics.reduce((max, curr) =>
                                    curr.efficiency > max.efficiency ? curr : max
                                );
                                return (
                                    <div className="p-4 bg-green-50 border border-green-100 rounded-sm">
                                        <div className="flex items-start gap-3">
                                            <Trophy className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                                            <div>
                                                <h4 className="font-bold text-green-900 text-sm">Highest Efficiency</h4>
                                                <p className="text-xs text-green-700 mt-1">
                                                    <strong>{topPerformer.user.name}</strong> leads with an efficiency score of <strong>{topPerformer.efficiency}</strong>,
                                                    processing {topPerformer.user.avgFilesPerDay} files/day with {topPerformer.user.modificationsPerFile} edits/file average.
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* Consistency Leader */}
                            {(() => {
                                const mostConsistent = analytics.reduce((max, curr) =>
                                    curr.consistency.score > max.consistency.score ? curr : max
                                );
                                return (
                                    <div className="p-4 bg-blue-50 border border-blue-100 rounded-sm">
                                        <div className="flex items-start gap-3">
                                            <CheckCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                                            <div>
                                                <h4 className="font-bold text-blue-900 text-sm">Most Consistent</h4>
                                                <p className="text-xs text-blue-700 mt-1">
                                                    <strong>{mostConsistent.user.name}</strong> shows the highest consistency score ({mostConsistent.consistency.score}),
                                                    maintaining stable daily output patterns.
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* Automation Opportunity */}
                            {(() => {
                                const lowAuto = usersData.filter(d => d.user.autoPercentage < 20);
                                if (lowAuto.length > 0) {
                                    return (
                                        <div className="p-4 bg-amber-50 border border-amber-100 rounded-sm">
                                            <div className="flex items-start gap-3">
                                                <Lightbulb className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                                                <div>
                                                    <h4 className="font-bold text-amber-900 text-sm">Automation Opportunity</h4>
                                                    <p className="text-xs text-amber-700 mt-1">
                                                        {lowAuto.map(d => d.user.name).join(', ')} {lowAuto.length === 1 ? 'has' : 'have'} low automation rates.
                                                        Consider identifying repetitive tasks that can be automated to improve efficiency.
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }
                                return null;
                            })()}
                        </div>
                    </div>

                </div>
            </main>
        </div>
    );
};

export default MultiUserCompareDashboard;
