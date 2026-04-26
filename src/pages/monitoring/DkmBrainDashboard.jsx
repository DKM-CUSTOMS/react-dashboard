import React, { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Brain, RefreshCw, Calendar, ChevronDown, ChevronUp,
  Activity, DollarSign, Search, BarChart3, Lightbulb, BookOpen,
  SlidersHorizontal, X
} from 'lucide-react';
import FilterBar from '../../components/monitoring/FilterBar';
import OverviewTab from './OverviewTab';
import OperationsTab from './OperationsTab';
import CostTab from './CostTab';
import QualityTab from './QualityTab';
import InsightsPanel from './InsightsPanel';
import ClientRulesTab from './ClientRulesTab';
import { fetchBrainClients, clearBrainCache } from '../../api/dkmBrainApi';

const TABS = [
  { id: 'overview',      label: 'Overview',        icon: Activity,     desc: 'Pipeline health at a glance' },
  { id: 'operations',    label: 'Shipments',        icon: Search,       desc: 'Browse and search all runs' },
  { id: 'cost',          label: 'Cost & Usage',     icon: DollarSign,   desc: 'Token spend and model usage' },
  { id: 'quality',       label: 'Review Analysis',  icon: BarChart3,    desc: 'What triggers reviews and failures' },
  { id: 'insights',      label: 'Smart Insights',   icon: Lightbulb,    desc: 'Derived optimisation signals' },
  { id: 'client-rules',  label: 'Client Rules',     icon: BookOpen,     desc: 'Manage client-specific parsing rules' },
];

const QUICK_RANGES = [
  { label: 'Today',     days: 1  },
  { label: '7 days',   days: 7  },
  { label: '30 days',  days: 30 },
  { label: 'All time', days: 0  },
];

const DkmBrainDashboard = () => {
  const queryClient = useQueryClient();
  const [activeTab,   setActiveTab]   = useState('overview');
  const [filters,     setFilters]     = useState({});
  const [granularity, setGranularity] = useState('day');
  const [refreshing,  setRefreshing]  = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const { data: clients = [] } = useQuery({
    queryKey: ['brain-clients'],
    queryFn:   fetchBrainClients,
    staleTime: 5 * 60_000,
  });

  const clientOptions = clients.map(c => ({
    value: c.client_key,
    label: c.client_name || c.client_key,
  }));

  // Fix: refresh data without page reload — invalidate all brain queries
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await clearBrainCache();
      await queryClient.invalidateQueries({ queryKey: ['brain'] });
      await queryClient.invalidateQueries({ queryKey: ['brain-overview'] });
      await queryClient.invalidateQueries({ queryKey: ['brain-operations'] });
      await queryClient.invalidateQueries({ queryKey: ['brain-costs'] });
      await queryClient.invalidateQueries({ queryKey: ['brain-quality'] });
      await queryClient.invalidateQueries({ queryKey: ['brain-insights'] });
      await queryClient.invalidateQueries({ queryKey: ['brain-clients'] });
      await queryClient.invalidateQueries({ queryKey: ['client-rules-index'] });
    } finally {
      setTimeout(() => setRefreshing(false), 800);
    }
  }, [queryClient]);

  const setQuickRange = (days) => {
    if (!days) {
      setFilters(f => { const { dateFrom, dateTo, ...rest } = f; return rest; });
      return;
    }
    const to   = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    setFilters(f => ({
      ...f,
      dateFrom: from.toISOString().slice(0, 10),
      dateTo:   to.toISOString().slice(0, 10),
    }));
  };

  const activeQuick = QUICK_RANGES.find(r => {
    if (!r.days) return !filters.dateFrom && !filters.dateTo;
    if (!filters.dateFrom) return false;
    const diff = (new Date() - new Date(filters.dateFrom)) / (24 * 60 * 60 * 1000);
    return Math.abs(diff - r.days) < 1;
  });

  const activeTabMeta  = TABS.find(t => t.id === activeTab);
  const hasActiveFilters = Object.values(filters).some(Boolean);
  const showFilterBar  = activeTab !== 'client-rules' && activeTab !== 'insights';

  return (
    <div className="flex flex-col min-h-screen bg-[#f8f9fb]">

      {/* ══════════════════════════════════════════════════════
          HEADER — Enterprise-grade command strip
      ═══════════════════════════════════════════════════════ */}
      <div className="bg-white border-b border-gray-200/80">

        {/* Top row */}
        <div className="flex items-center justify-between px-6 py-3.5 gap-4">

          {/* Brand */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="relative">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center shadow-md">
                <Brain size={18} className="text-white" />
              </div>
              <span className="absolute -bottom-1 -right-1 w-3 h-3 bg-emerald-400 rounded-full border-2 border-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-gray-900 leading-none">Brain Analytics</h1>
              <p className="text-[11px] text-gray-400 mt-0.5 leading-none">dkm-brain-final · AI customs pipeline</p>
            </div>
          </div>

          {/* Date range pills */}
          <div className="flex items-center gap-1.5 bg-gray-100 rounded-xl p-1">
            <Calendar size={13} className="text-gray-400 ml-1.5" />
            {QUICK_RANGES.map(r => (
              <button
                key={r.label}
                onClick={() => setQuickRange(r.days)}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all leading-none ${
                  activeQuick?.label === r.label
                    ? 'bg-white text-indigo-700 shadow-sm border border-gray-200 font-semibold'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Filters toggle — only when relevant */}
            {showFilterBar && (
              <button
                onClick={() => setShowFilters(v => !v)}
                className={`flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-xl border transition-all ${
                  showFilters || hasActiveFilters
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700'
                }`}
              >
                <SlidersHorizontal size={13} />
                Filters
                {hasActiveFilters && (
                  <span className="w-4 h-4 rounded-full bg-indigo-600 text-white text-[9px] flex items-center justify-center font-bold">
                    {Object.values(filters).filter(Boolean).length}
                  </span>
                )}
                {showFilters ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              </button>
            )}

            {/* Refresh — no page reload */}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              title="Fetch fresh data from Azure Blob"
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-xl border transition-all ${
                refreshing
                  ? 'border-indigo-200 bg-indigo-50 text-indigo-500'
                  : 'border-gray-200 text-gray-500 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50'
              }`}
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* Expandable filter bar */}
        {showFilters && showFilterBar && (
          <div className="px-6 pb-3 border-t border-gray-100 pt-3">
            <FilterBar
              filters={filters}
              onChange={setFilters}
              clients={clientOptions}
              showGranularity={activeTab === 'operations' || activeTab === 'cost'}
              granularity={granularity}
              onGranularityChange={setGranularity}
            />
          </div>
        )}

        {/* Tab strip */}
        <div className="flex items-end gap-0 px-6">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${
                  isActive
                    ? 'border-indigo-600 text-indigo-700 bg-indigo-50/60'
                    : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                }`}
              >
                <Icon size={14} className={isActive ? 'text-indigo-600' : 'text-gray-400'} />
                {tab.label}
                {/* active indicator dot */}
                {isActive && (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-0 w-6 h-0.5 bg-indigo-600 rounded-t-full" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Page subtitle breadcrumb */}
      <div className="px-6 pt-4 pb-2 flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-400 flex items-center gap-1.5">
            <span className="text-gray-300">Brain Analytics</span>
            <span className="text-gray-300">/</span>
            <span className="text-gray-600 font-medium">{activeTabMeta?.label}</span>
          </p>
        </div>
        {hasActiveFilters && showFilterBar && (
          <button
            onClick={() => setFilters({})}
            className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-red-500 transition"
          >
            <X size={11} /> Clear all filters
          </button>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════
          TAB CONTENT
      ═══════════════════════════════════════════════════════ */}
      <div className="flex-1 px-6 pb-8">
        {activeTab === 'overview'      && <OverviewTab   filters={filters} />}
        {activeTab === 'operations'    && <OperationsTab filters={filters} granularity={granularity} />}
        {activeTab === 'cost'          && <CostTab       filters={filters} granularity={granularity} />}
        {activeTab === 'quality'       && <QualityTab    filters={filters} />}
        {activeTab === 'insights'      && <InsightsPanel />}
        {activeTab === 'client-rules'  && <ClientRulesTab />}
      </div>
    </div>
  );
};

export default DkmBrainDashboard;
