import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, Ban, CheckCircle2, CheckCheck, Mail, RefreshCw, RotateCcw, Search, Settings2, XCircle } from 'lucide-react';
import { getImportReleaseDossiers, getImportReleaseRecord, runImportReleaseRecordAction, runImportReleaseSync } from '../../api/importReleaseApi';

const tabs = [
  { key: '', label: 'All' },
  { key: 'prelodged', label: 'Pre-lodged' },
  { key: 'no_crn', label: 'No CRN' },
  { key: 'invalidated', label: 'Invalidated' },
  { key: 'errors', label: 'Errors' },
  { key: 'email_pending', label: 'MRN / Email Pending' },
  { key: 'needs_check', label: 'Needs Check' },
  { key: 'waiting', label: 'ETA +7' },
  { key: 'done', label: 'Done' },
];

const fmtDate = (value) => value ? new Date(value).toLocaleDateString() : '-';
const fmtDateTime = (value) => value ? new Date(value).toLocaleString() : '-';
const fmtNumber = (value) => value == null || value === '' ? '-' : new Intl.NumberFormat().format(Number(value));
const normalizeStatus = (value) => String(value || '').trim().toUpperCase();
const hasValidationError = (row) => Array.isArray(row.validation_errors) && row.validation_errors.length > 0;
const hasRuntimeError = (row) => Boolean(!hasValidationError(row) && row.last_error && row.last_error !== 'CRN not found');
const isPreLodgedQueueRow = (row) => row.record_state !== 'done' && !hasValidationError(row) && Boolean(row.crn) && !row.mrn && normalizeStatus(row.tsd_status) !== 'INVALIDATED';
const isNoCrnQueueRow = (row) => row.record_state !== 'done' && !hasValidationError(row) && !row.crn && (row.last_irp_status === 'crn_not_found' || row.last_error === 'CRN not found');
const isInvalidatedQueueRow = (row) => row.record_state !== 'done' && !hasValidationError(row) && normalizeStatus(row.tsd_status) === 'INVALIDATED';
const isEmailPendingQueueRow = (row) => row.record_state === 'email_pending' && !hasValidationError(row) && Boolean(row.mrn) && !row.email_sent_at;
const isNeedsCheckQueueRow = (row) => row.record_state === 'needs_check' && !hasValidationError(row);
const isWaitingQueueRow = (row) => row.record_state === 'waiting' && !hasValidationError(row);
const fmtCooldown = (seconds) => {
  if (!seconds || seconds <= 0) return '';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs.toString().padStart(2, '0')}s`;
};

const statusBadge = (row) => {
  if (row.record_state === 'done') return { tone: 'green', label: 'Done' };
  if (hasValidationError(row)) return { tone: 'red', label: 'Invalid' };
  if (hasRuntimeError(row)) return { tone: 'red', label: 'Error' };
  if (row.last_irp_status === 'crn_not_found' || row.last_error === 'CRN not found') return { tone: 'amber', label: 'No CRN' };
  if (normalizeStatus(row.tsd_status) === 'INVALIDATED') return { tone: 'orange', label: 'Invalidated' };
  if (row.record_state === 'waiting') return { tone: 'gray', label: 'Waiting' };
  if (row.tsd_status) return { tone: 'blue', label: row.tsd_status };
  return { tone: 'gray', label: 'Pending' };
};

const comparisonBadge = (row) => {
  if (!row.mrn) return { tone: 'gray', label: '-' };
  if (row.comparison_state === 'mismatch') return { tone: 'red', label: 'Mismatch' };
  if (row.comparison_state === 'match') return { tone: 'green', label: 'Match' };
  return { tone: 'amber', label: 'Pending' };
};

const drawerSectionTone = (tone = 'gray') => {
  const tones = {
    gray: 'border-gray-200 bg-white',
    blue: 'border-blue-200 bg-blue-50/60',
    green: 'border-green-200 bg-green-50/60',
    amber: 'border-amber-200 bg-amber-50/60',
    red: 'border-red-200 bg-red-50/60',
    orange: 'border-orange-200 bg-orange-50/60',
  };
  return tones[tone] || tones.gray;
};

const actionButtonTone = {
  green: 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100',
  blue: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100',
  amber: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100',
  red: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
  gray: 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
};

const lifecycleTone = (type = '') => {
  const normalized = String(type).toLowerCase();
  if (normalized.includes('error')) return { tone: 'red', badge: 'Error' };
  if (normalized.includes('email')) return { tone: 'green', badge: 'Email' };
  if (normalized.includes('manual') || normalized.includes('reopen') || normalized.includes('suppress')) return { tone: 'amber', badge: 'Manual' };
  if (normalized.includes('source')) return { tone: 'blue', badge: 'Source' };
  if (normalized.includes('irp')) return { tone: 'orange', badge: 'IRP' };
  return { tone: 'gray', badge: 'Event' };
};

const humanizeLabel = (value = '') => String(value)
  .replace(/_/g, ' ')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

const looksLikeIsoDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value);

const formatEventValue = (value) => {
  if (value == null || value === '') return '-';
  if (Array.isArray(value)) return value.map((item) => humanizeLabel(String(item))).join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (looksLikeIsoDate(value)) return fmtDateTime(value);
  return String(value);
};

const flattenEventData = (data, prefix = '') => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  return Object.entries(data).flatMap(([key, value]) => {
    const label = prefix ? `${prefix} ${humanizeLabel(key)}` : humanizeLabel(key);
    if (Array.isArray(value)) {
      return [{ label, value: formatEventValue(value) }];
    }
    if (value && typeof value === 'object') {
      const keys = Object.keys(value);
      if (keys.includes('before') || keys.includes('after')) {
        return [{
          label,
          value: `${formatEventValue(value.before)} -> ${formatEventValue(value.after)}`,
        }];
      }
      return flattenEventData(value, label);
    }
    return [{ label, value: formatEventValue(value) }];
  });
};

const Badge = ({ children, tone = 'gray' }) => {
  const colors = {
    gray: 'bg-gray-100 text-gray-700 border-gray-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    orange: 'bg-orange-50 text-orange-700 border-orange-200',
  };
  return <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${colors[tone]}`}>{children}</span>;
};

const tabTone = {
  '': { active: 'bg-[#714B67] text-white', idle: 'bg-gray-100 text-gray-700 hover:bg-gray-200' },
  prelodged: { active: 'bg-blue-50 text-blue-700 border border-blue-200', idle: 'bg-white text-gray-700 border border-gray-200 hover:border-blue-200 hover:text-blue-700' },
  no_crn: { active: 'bg-amber-50 text-amber-700 border border-amber-200', idle: 'bg-white text-gray-700 border border-gray-200 hover:border-amber-200 hover:text-amber-700' },
  invalidated: { active: 'bg-orange-50 text-orange-700 border border-orange-200', idle: 'bg-white text-gray-700 border border-gray-200 hover:border-orange-200 hover:text-orange-700' },
  errors: { active: 'bg-red-50 text-red-700 border border-red-200', idle: 'bg-white text-gray-700 border border-gray-200 hover:border-red-200 hover:text-red-700' },
  email_pending: { active: 'bg-emerald-50 text-emerald-700 border border-emerald-200', idle: 'bg-white text-gray-700 border border-gray-200 hover:border-emerald-200 hover:text-emerald-700' },
  needs_check: { active: 'bg-violet-50 text-violet-700 border border-violet-200', idle: 'bg-white text-gray-700 border border-gray-200 hover:border-violet-200 hover:text-violet-700' },
  waiting: { active: 'bg-gray-100 text-gray-700 border border-gray-200', idle: 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50' },
  done: { active: 'bg-green-50 text-green-700 border border-green-200', idle: 'bg-white text-gray-700 border border-gray-200 hover:border-green-200 hover:text-green-700' },
};

const jobSummary = (job) => {
  if (!job) return 'No refresh yet';
  if (job.running?.startedAt) return `Running since ${fmtDateTime(job.running.startedAt)}`;
  if (job.lastFinishedAt) return `Last refresh ${fmtDateTime(job.lastFinishedAt)}`;
  return 'No refresh yet';
};

const SORTABLE_COLUMNS = {
  declaration_id: { label: 'Declaration', type: 'string' },
  container_number: { label: 'Container', type: 'string' },
  eta: { label: 'ETA', type: 'date' },
  bl: { label: 'BL', type: 'string' },
  eori_ship_agent: { label: 'EORI', type: 'string' },
  crn: { label: 'CRN', type: 'string' },
  mrn: { label: 'MRN', type: 'string' },
  source_total_packages: { label: 'Packages', type: 'number' },
  source_total_gross: { label: 'Gross', type: 'number' },
  comparison_state: { label: 'Check', type: 'string' },
  tsd_status: { label: 'TSD', type: 'string' },
  last_irp_check_at: { label: 'Last IRP', type: 'date' },
};

const compareValues = (left, right, type) => {
  if (type === 'number') {
    return (Number(left) || 0) - (Number(right) || 0);
  }
  if (type === 'date') {
    const leftTime = left ? new Date(left).getTime() : 0;
    const rightTime = right ? new Date(right).getTime() : 0;
    return leftTime - rightTime;
  }
  return String(left || '').localeCompare(String(right || ''), undefined, { numeric: true, sensitivity: 'base' });
};

const PAGE_SIZE = 50;

const buildPageItems = (current, total) => {
  if (total <= 1) return [1];
  const items = new Set([1, total, current, current - 1, current + 1]);
  if (current <= 3) {
    items.add(2);
    items.add(3);
    items.add(4);
  }
  if (current >= total - 2) {
    items.add(total - 1);
    items.add(total - 2);
    items.add(total - 3);
  }
  return [...items].filter((value) => value >= 1 && value <= total).sort((a, b) => a - b);
};

export default function ImportReleasePage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('prelodged');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState(null);
  const [sortBy, setSortBy] = useState('last_irp_check_at');
  const [sortDirection, setSortDirection] = useState('desc');
  const [selectedRecordId, setSelectedRecordId] = useState(null);

  const dossiers = useQuery({
    queryKey: ['import-release', status, search, page],
    queryFn: () => getImportReleaseDossiers({ status, search, page, pageSize: PAGE_SIZE }),
    staleTime: 30000,
    placeholderData: keepPreviousData,
  });
  const recordDetail = useQuery({
    queryKey: ['import-release-record', selectedRecordId],
    queryFn: () => getImportReleaseRecord(selectedRecordId),
    enabled: Boolean(selectedRecordId),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['import-release'] });
  const runAll = useMutation({
    mutationFn: () => runImportReleaseSync(),
    onSuccess: (data) => {
      setNotice({ type: 'success', message: data?.skipped ? 'Refresh not available yet' : 'Refresh completed' });
      setTimeout(() => setNotice(null), 3000);
      refresh();
    },
    onError: (error) => {
      setNotice({ type: 'error', message: error.message });
      setTimeout(() => setNotice(null), 5000);
    },
  });
  const recordAction = useMutation({
    mutationFn: ({ id, action }) => runImportReleaseRecordAction(id, action),
    onSuccess: () => {
      setNotice({ type: 'success', message: 'Record updated' });
      queryClient.invalidateQueries({ queryKey: ['import-release'] });
      queryClient.invalidateQueries({ queryKey: ['import-release-record', selectedRecordId] });
    },
    onError: (error) => setNotice({ type: 'error', message: error.message }),
  });

  const rows = dossiers.data?.rows || [];
  const totalRows = dossiers.data?.total || 0;
  const pageCount = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const jobs = dossiers.data?.meta?.jobs || {};
  const fullJob = jobs.full || null;
  const summary = dossiers.data?.summary || {};
  const fullCooldownRemaining = (() => {
    if (!fullJob?.lastFinishedAt) return 0;
    const cooldownMs = 15 * 60 * 1000;
    const remainingMs = new Date(fullJob.lastFinishedAt).getTime() + cooldownMs - Date.now();
    return Math.max(0, Math.ceil(remainingMs / 1000));
  })();
  const coolingDown = !runAll.isPending && fullCooldownRemaining > 0;
  const busy = runAll.isPending || Boolean(jobs.full?.running?.startedAt);

  useEffect(() => {
    setPage(1);
  }, [status, search]);

  useEffect(() => {
    // Only clamp when we have real data (not while a new query is loading).
    if (!dossiers.isFetching && page > pageCount) setPage(pageCount);
  }, [page, pageCount, dossiers.isFetching]);

  const stats = {
    shown: rows.length,
    total: totalRows,
    // Use server-side summary counts (whole store) so cards don't vary by page.
    prelodged: summary.prelodged ?? 0,
    emailPending: summary.email_pending ?? 0,
    needsCheck: summary.needs_check ?? 0,
    waiting: summary.waiting ?? 0,
    noCrn: summary.no_crn ?? 0,
    invalidated: summary.invalidated ?? 0,
    errors: summary.errors ?? 0,
  };

  const refreshTooltip = busy
    ? 'Refresh is currently running'
    : fullCooldownRemaining > 0
      ? `Available in ${fmtCooldown(fullCooldownRemaining)}`
      : 'Refresh now';

  const sortedRows = useMemo(() => [...rows].sort((left, right) => {
    const config = SORTABLE_COLUMNS[sortBy];
    if (!config) return 0;
    const result = compareValues(left[sortBy], right[sortBy], config.type);
    return sortDirection === 'asc' ? result : -result;
  }), [rows, sortBy, sortDirection]);

  const detailRow = recordDetail.data?.record || null;
  const detailStatusBadge = statusBadge(detailRow || {});
  const detailComparisonBadge = comparisonBadge(detailRow || {});
  const detailValidationErrors = detailRow?.validation_errors || [];
  const detailErrorMessage = detailRow?.last_error || detailRow?.email_last_error || '';
  const detailCheckTone = detailComparisonBadge.tone === 'red'
    ? 'red'
    : detailComparisonBadge.tone === 'green'
      ? 'green'
      : detailComparisonBadge.tone === 'amber'
        ? 'amber'
        : 'gray';

  const pageItems = useMemo(() => buildPageItems(page, pageCount), [page, pageCount]);

  const toggleSort = (column) => {
    if (sortBy === column) {
      setSortDirection((current) => current === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortBy(column);
    setSortDirection(column === 'last_irp_check_at' ? 'desc' : 'asc');
  };

  const sortIcon = (column) => {
    if (sortBy !== column) return <ArrowUpDown size={14} className="text-gray-400" />;
    return sortDirection === 'asc' ? <ArrowUp size={14} className="text-[#714B67]" /> : <ArrowDown size={14} className="text-[#714B67]" />;
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 text-gray-900">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Import Release</h1>
          <p className="mt-1 text-sm text-gray-500">Monitors import release dossiers, keeps current declarations under review, and updates IRP outcomes for the team.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-right">
            <div className="text-xs text-gray-500">{jobSummary(jobs.full)}</div>
          </div>
          <Link
            to="/import-release/settings"
            title="Notification settings"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 hover:border-[#714B67] hover:text-[#714B67]"
          >
            <Settings2 size={16} />
          </Link>
          <button title={refreshTooltip} onClick={() => runAll.mutate()} disabled={busy || coolingDown} className="inline-flex items-center gap-2 rounded-md bg-[#714B67] px-3 py-2 text-sm font-medium text-white hover:bg-[#5a3c52] disabled:opacity-50">
            <RefreshCw size={16} className={runAll.isPending ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border bg-white p-4">
          <div className="text-xs text-gray-500">Rows shown</div>
          <div className="mt-1 text-2xl font-semibold">{stats.shown}</div>
          {stats.total > stats.shown && <div className="mt-1 text-xs text-gray-400">{stats.total} total in filter</div>}
        </div>
        <div className="rounded-lg border bg-white p-4"><div className="text-xs text-gray-500">Pre-lodged</div><div className="mt-1 text-2xl font-semibold">{stats.prelodged}</div></div>
        <div className="rounded-lg border bg-white p-4"><div className="text-xs text-gray-500">Email Pending</div><div className="mt-1 text-2xl font-semibold">{stats.emailPending}</div></div>
        <div className="rounded-lg border bg-white p-4"><div className="text-xs text-gray-500">Errors</div><div className="mt-1 text-2xl font-semibold">{stats.errors}</div></div>
      </div>

      {notice && (
        <div className={`mb-4 flex items-start gap-2 rounded-md border p-3 text-sm ${notice.type === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-700'}`}>
          {notice.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          <div><div className="font-medium">{notice.message}</div></div>
        </div>
      )}

      <div className="rounded-lg border bg-white">
        <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => {
              const tone = tabTone[tab.key] || tabTone[''];
              return (
                <button
                  key={tab.key}
                  onClick={() => setStatus(tab.key)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${status === tab.key ? tone.active : tone.idle}`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
          <div className="relative w-full lg:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search declaration, container, BL, CRN, MRN, status, agent…" className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-[#714B67] focus:outline-none focus:ring-1 focus:ring-[#714B67]" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                {Object.entries(SORTABLE_COLUMNS).map(([column, config]) => (
                  <th key={column} className="px-4 py-3 text-left">
                    <button
                      type="button"
                      onClick={() => toggleSort(column)}
                      className="inline-flex items-center gap-1 font-medium uppercase tracking-wide text-gray-500 hover:text-gray-700"
                    >
                      <span>{config.label}</span>
                      {sortIcon(column)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {dossiers.isLoading && <tr><td colSpan="12" className="px-4 py-8 text-center text-gray-500">Loading...</td></tr>}
              {!dossiers.isLoading && rows.length === 0 && <tr><td colSpan="12" className="px-4 py-8 text-center text-gray-500">No dossiers found.</td></tr>}
              {sortedRows.map((row) => (
                <tr key={row.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setSelectedRecordId(row.id)}>
                  {(() => {
                    const badge = statusBadge(row);
                    const check = comparisonBadge(row);
                    return (
                      <>
                  <td className="px-4 py-3 font-medium">{row.declaration_id}<div className="text-xs text-gray-400">{row.message_status}</div></td>
                  <td className="px-4 py-3 font-mono">{row.container_number}</td>
                  <td className="px-4 py-3">{fmtDate(row.eta)}</td>
                  <td className="px-4 py-3 max-w-48 truncate" title={row.bl}>{row.bl}</td>
                  <td className="px-4 py-3 font-mono text-xs">{row.eori_ship_agent}</td>
                  <td className="px-4 py-3 font-mono text-xs">{row.crn || '-'}</td>
                  <td className="px-4 py-3">{row.mrn ? <Badge tone="green">{row.mrn}</Badge> : '-'}</td>
                  <td className="px-4 py-3 text-xs">
                    <div className="font-medium text-gray-900">{fmtNumber(row.source_total_packages)}</div>
                    <div className="text-gray-400">IRP {fmtNumber(row.irp_total_packages)}</div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div className="font-medium text-gray-900">{fmtNumber(row.source_total_gross)}</div>
                    <div className="text-gray-400">IRP {fmtNumber(row.irp_total_gross)}</div>
                  </td>
                  <td className="px-4 py-3"><Badge tone={check.tone}>{check.label}</Badge></td>
                  <td className="px-4 py-3"><Badge tone={badge.tone}>{badge.label}</Badge></td>
                  <td className="px-4 py-3 text-xs text-gray-500">{fmtDateTime(row.last_irp_check_at)}</td>
                      </>
                    );
                  })()}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="text-sm text-gray-500">
            Showing {(page - 1) * PAGE_SIZE + (rows.length ? 1 : 0)}-{(page - 1) * PAGE_SIZE + rows.length} of {totalRows}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Previous
            </button>
            {pageItems.map((pageItem, index) => {
              const previous = pageItems[index - 1];
              const showGap = previous && pageItem - previous > 1;
              return (
                <React.Fragment key={pageItem}>
                  {showGap && <span className="px-1 text-sm text-gray-400">...</span>}
                  <button
                    type="button"
                    onClick={() => setPage(pageItem)}
                    className={`min-w-9 rounded-md px-3 py-1.5 text-sm ${page === pageItem ? 'bg-[#714B67] text-white' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                  >
                    {pageItem}
                  </button>
                </React.Fragment>
              );
            })}
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              disabled={page >= pageCount}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {selectedRecordId && (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/30 backdrop-blur-[2px]" onClick={() => setSelectedRecordId(null)}>
          <div className="h-full w-full max-w-3xl overflow-y-auto bg-gray-50 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 px-5 py-4 backdrop-blur">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-lg font-semibold text-gray-900">Record Detail</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
                    <span>{detailRow?.declaration_id || '-'}</span>
                    <span className="text-gray-300">•</span>
                    <span>{detailRow?.container_number || '-'}</span>
                    {detailRow?.message_status && <Badge tone="gray">{detailRow.message_status}</Badge>}
                    <Badge tone={detailStatusBadge.tone}>{detailStatusBadge.label}</Badge>
                    <Badge tone={detailComparisonBadge.tone}>{detailComparisonBadge.label}</Badge>
                  </div>
                </div>
                <button onClick={() => setSelectedRecordId(null)} className="rounded-md border border-gray-300 p-2 text-gray-500 hover:text-gray-700">
                  <XCircle size={16} />
                </button>
              </div>
            </div>

            <div className="space-y-5 p-5">
              {recordDetail.isLoading && (
                <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-10 text-center text-sm text-gray-500">
                  Loading record details...
                </div>
              )}

              {!recordDetail.isLoading && detailRow && (
                <>
                  <section className={`rounded-xl border p-4 ${drawerSectionTone('blue')}`}>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-gray-900">Overview</div>
                      <div className="text-xs text-gray-500">Last IRP {fmtDateTime(detailRow.last_irp_check_at)}</div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-lg border border-white/70 bg-white/80 p-3">
                        <div className="text-xs uppercase tracking-wide text-gray-500">BL</div>
                        <div className="mt-1 text-sm font-medium text-gray-900">{detailRow.bl || '-'}</div>
                      </div>
                      <div className="rounded-lg border border-white/70 bg-white/80 p-3">
                        <div className="text-xs uppercase tracking-wide text-gray-500">EORI</div>
                        <div className="mt-1 text-sm font-medium text-gray-900">{detailRow.eori_ship_agent || '-'}</div>
                      </div>
                      <div className="rounded-lg border border-white/70 bg-white/80 p-3">
                        <div className="text-xs uppercase tracking-wide text-gray-500">CRN</div>
                        <div className="mt-1 break-all text-sm font-medium text-gray-900">{detailRow.crn || '-'}</div>
                      </div>
                      <div className="rounded-lg border border-white/70 bg-white/80 p-3">
                        <div className="text-xs uppercase tracking-wide text-gray-500">MRN</div>
                        <div className="mt-1 break-all text-sm font-medium text-gray-900">{detailRow.mrn || '-'}</div>
                      </div>
                      <div className="rounded-lg border border-white/70 bg-white/80 p-3">
                        <div className="text-xs uppercase tracking-wide text-gray-500">ETA</div>
                        <div className="mt-1 text-sm font-medium text-gray-900">{fmtDate(detailRow.eta)}</div>
                      </div>
                      <div className="rounded-lg border border-white/70 bg-white/80 p-3">
                        <div className="text-xs uppercase tracking-wide text-gray-500">Email Sent</div>
                        <div className="mt-1 text-sm font-medium text-gray-900">{fmtDateTime(detailRow.email_sent_at)}</div>
                      </div>
                      <div className="rounded-lg border border-white/70 bg-white/80 p-3">
                        <div className="text-xs uppercase tracking-wide text-gray-500">Done Reason</div>
                        <div className="mt-1 text-sm font-medium text-gray-900">{detailRow.done_reason || '-'}</div>
                      </div>
                      <div className="rounded-lg border border-white/70 bg-white/80 p-3">
                        <div className="text-xs uppercase tracking-wide text-gray-500">Record State</div>
                        <div className="mt-1 text-sm font-medium text-gray-900">{detailRow.record_state || '-'}</div>
                      </div>
                    </div>
                  </section>

                  <section className={`rounded-xl border p-4 ${drawerSectionTone(detailCheckTone)}`}>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-gray-900">Checks</div>
                      <Badge tone={detailComparisonBadge.tone}>{detailComparisonBadge.label}</Badge>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-2">
                      <div className="rounded-lg border border-white/70 bg-white/80 p-4">
                        <div className="text-xs uppercase tracking-wide text-gray-500">Packages</div>
                        <div className="mt-2 flex items-end justify-between gap-3">
                          <div>
                            <div className="text-xs text-gray-500">Source</div>
                            <div className="text-lg font-semibold text-gray-900">{fmtNumber(detailRow.source_total_packages)}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs text-gray-500">IRP</div>
                            <div className="text-lg font-semibold text-gray-900">{fmtNumber(detailRow.irp_total_packages)}</div>
                          </div>
                        </div>
                        <div className="mt-3 text-xs text-gray-600">Result: <span className="font-medium uppercase">{detailRow.package_check || '-'}</span></div>
                      </div>
                      <div className="rounded-lg border border-white/70 bg-white/80 p-4">
                        <div className="text-xs uppercase tracking-wide text-gray-500">Gross</div>
                        <div className="mt-2 flex items-end justify-between gap-3">
                          <div>
                            <div className="text-xs text-gray-500">Source</div>
                            <div className="text-lg font-semibold text-gray-900">{fmtNumber(detailRow.source_total_gross)}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs text-gray-500">IRP</div>
                            <div className="text-lg font-semibold text-gray-900">{fmtNumber(detailRow.irp_total_gross)}</div>
                          </div>
                        </div>
                        <div className="mt-3 text-xs text-gray-600">Result: <span className="font-medium uppercase">{detailRow.gross_check || '-'}</span></div>
                      </div>
                    </div>
                  </section>

                  {(detailValidationErrors.length > 0 || detailErrorMessage) && (
                    <section className={`rounded-xl border p-4 ${drawerSectionTone('red')}`}>
                      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-red-800">
                        <AlertCircle size={16} />
                        Issues
                      </div>
                      {Boolean(detailErrorMessage) && (
                        <div className="rounded-lg border border-red-200 bg-white/80 p-3 text-sm text-red-700">
                          {detailErrorMessage}
                        </div>
                      )}
                      {detailValidationErrors.length > 0 && (
                        <div className="mt-3 rounded-lg border border-red-200 bg-white/80 p-3">
                          <div className="mb-2 text-xs uppercase tracking-wide text-red-700">Lookup Validation</div>
                          <div className="space-y-1 text-sm text-red-700">
                            {detailValidationErrors.map((error) => (
                              <div key={error}>{error}</div>
                            ))}
                          </div>
                        </div>
                      )}
                    </section>
                  )}

                  <section className={`rounded-xl border p-4 ${drawerSectionTone('amber')}`}>
                    <div className="mb-3 text-sm font-medium text-gray-900">Actions</div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => recordAction.mutate({ id: selectedRecordId, action: 'resend_email' })}
                        className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${actionButtonTone.green}`}
                      >
                        <Mail size={14} />
                        Resend email
                      </button>
                      <button
                        onClick={() => recordAction.mutate({ id: selectedRecordId, action: 'reopen' })}
                        className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${actionButtonTone.blue}`}
                      >
                        <RotateCcw size={14} />
                        Reopen
                      </button>
                      <button
                        onClick={() => recordAction.mutate({ id: selectedRecordId, action: 'mark_done' })}
                        className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${actionButtonTone.amber}`}
                      >
                        <CheckCheck size={14} />
                        Mark done
                      </button>
                      <button
                        onClick={() => recordAction.mutate({ id: selectedRecordId, action: 'suppress_email' })}
                        className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${actionButtonTone.red}`}
                      >
                        <Ban size={14} />
                        Suppress email
                      </button>
                    </div>
                  </section>

                  <section className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="mb-3 text-sm font-medium text-gray-900">Lifecycle</div>
                    <div className="space-y-3">
                      {(detailRow.history || []).map((event, index) => {
                        const eventStyle = lifecycleTone(event.type);
                        const eventRows = flattenEventData(event.data);
                        return (
                          <div key={`${event.at}-${index}`} className={`rounded-lg border p-3 ${drawerSectionTone(eventStyle.tone)}`}>
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className="text-sm font-medium text-gray-900">{event.message}</div>
                                    <Badge tone={eventStyle.tone}>{eventStyle.badge}</Badge>
                                  </div>
                                  <div className="mt-1 text-xs uppercase tracking-wide text-gray-500">{humanizeLabel(event.type)}</div>
                                </div>
                              <div className="text-xs text-gray-500">{fmtDateTime(event.at)}</div>
                            </div>
                            {eventRows.length > 0 && (
                              <div className="mt-3 rounded-md border border-white/80 bg-white/80 p-3">
                                <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)]">
                                  {eventRows.map((row) => (
                                    <React.Fragment key={`${event.at}-${row.label}-${row.value}`}>
                                      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{row.label}</div>
                                      <div className="break-words text-sm text-gray-700">{row.value}</div>
                                    </React.Fragment>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {!(detailRow.history || []).length && (
                        <div className="rounded-md border border-dashed px-4 py-6 text-sm text-gray-500">No lifecycle events recorded yet.</div>
                      )}
                    </div>
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
