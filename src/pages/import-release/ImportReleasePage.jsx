import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, Ban, CheckCircle2, CheckCheck, Mail, RefreshCw, RotateCcw, Search, Settings2, XCircle } from 'lucide-react';
import { getImportReleaseDossiers, getImportReleaseRecord, runImportReleaseRecordAction, runImportReleaseSync } from '../../api/importReleaseApi';

const tabs = [
  { key: '', label: 'All' },
  { key: 'prelodged', label: 'Pre-lodged' },
  { key: 'no_crn', label: 'No CRN' },
  { key: 'errors', label: 'Errors' },
  { key: 'mrn_found', label: 'MRN Found' },
  { key: 'waiting', label: 'ETA +7' },
  { key: 'done', label: 'Done' },
];

const fmtDate = (value) => value ? new Date(value).toLocaleDateString() : '-';
const fmtDateTime = (value) => value ? new Date(value).toLocaleString() : '-';
const normalizeStatus = (value) => String(value || '').trim().toUpperCase();
const hasValidationError = (row) => Array.isArray(row.validation_errors) && row.validation_errors.length > 0;
const hasRuntimeError = (row) => Boolean(!hasValidationError(row) && row.last_error && row.last_error !== 'CRN not found');
const isPreLodgedQueueRow = (row) => row.record_state !== 'done' && !hasValidationError(row) && Boolean(row.crn) && !row.mrn && normalizeStatus(row.tsd_status) === 'PRE-LODGED';
const isNoCrnQueueRow = (row) => row.record_state !== 'done' && !hasValidationError(row) && !row.crn && (row.last_irp_status === 'crn_not_found' || row.last_error === 'CRN not found');
const isMrnFoundQueueRow = (row) => row.record_state !== 'done' && !hasValidationError(row) && Boolean(row.mrn);
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
  if (row.record_state === 'waiting') return { tone: 'gray', label: 'Waiting' };
  if (row.tsd_status) return { tone: 'blue', label: row.tsd_status };
  return { tone: 'gray', label: 'Pending' };
};

const Badge = ({ children, tone = 'gray' }) => {
  const colors = {
    gray: 'bg-gray-100 text-gray-700 border-gray-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    red: 'bg-red-50 text-red-700 border-red-200',
  };
  return <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${colors[tone]}`}>{children}</span>;
};

const jobSummary = (job) => {
  if (!job) return 'No refresh yet';
  if (job.running?.startedAt) return `Last refresh ${fmtDateTime(job.running.startedAt)}`;
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
  tsd_status: { label: 'TSD', type: 'string' },
  last_irp_check_at: { label: 'Last IRP', type: 'date' },
};

const compareValues = (left, right, type) => {
  if (type === 'date') {
    const leftTime = left ? new Date(left).getTime() : 0;
    const rightTime = right ? new Date(right).getTime() : 0;
    return leftTime - rightTime;
  }
  return String(left || '').localeCompare(String(right || ''), undefined, { numeric: true, sensitivity: 'base' });
};

export default function ImportReleasePage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('prelodged');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState(null);
  const [sortBy, setSortBy] = useState('last_irp_check_at');
  const [sortDirection, setSortDirection] = useState('desc');
  const [selectedRecordId, setSelectedRecordId] = useState(null);

  const dossiers = useQuery({
    queryKey: ['import-release', status, search],
    queryFn: () => getImportReleaseDossiers({ status, search, pageSize: 100 }),
    refetchInterval: 60000,
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
      refresh();
    },
    onError: (error) => setNotice({ type: 'error', message: error.message }),
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
  const jobs = dossiers.data?.meta?.jobs || {};
  const fullJob = jobs.full || null;
  const fullCooldownRemaining = (() => {
    if (!fullJob?.lastFinishedAt) return 0;
    const cooldownMs = 15 * 60 * 1000;
    const remainingMs = new Date(fullJob.lastFinishedAt).getTime() + cooldownMs - Date.now();
    return Math.max(0, Math.ceil(remainingMs / 1000));
  })();
  const coolingDown = !runAll.isPending && fullCooldownRemaining > 0;
  const busy = runAll.isPending || Boolean(jobs.full?.running?.startedAt);

  const stats = {
    total: dossiers.data?.total || 0,
    prelodged: rows.filter(isPreLodgedQueueRow).length,
    waiting: rows.filter(isWaitingQueueRow).length,
    noCrn: rows.filter(isNoCrnQueueRow).length,
    errors: rows.filter(hasValidationError).length,
  };

  const refreshTooltip = busy
    ? 'Refresh is currently running'
    : fullCooldownRemaining > 0
      ? `Available in ${fmtCooldown(fullCooldownRemaining)}`
      : 'Refresh now';

  const sortedRows = [...rows].sort((left, right) => {
    const config = SORTABLE_COLUMNS[sortBy];
    if (!config) return 0;
    const result = compareValues(left[sortBy], right[sortBy], config.type);
    return sortDirection === 'asc' ? result : -result;
  });

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
        <div className="rounded-lg border bg-white p-4"><div className="text-xs text-gray-500">Rows in view</div><div className="mt-1 text-2xl font-semibold">{stats.total}</div></div>
        <div className="rounded-lg border bg-white p-4"><div className="text-xs text-gray-500">Pre-lodged in view</div><div className="mt-1 text-2xl font-semibold">{stats.prelodged}</div></div>
        <div className="rounded-lg border bg-white p-4"><div className="text-xs text-gray-500">ETA +7 in view</div><div className="mt-1 text-2xl font-semibold">{stats.waiting}</div></div>
        <div className="rounded-lg border bg-white p-4"><div className="text-xs text-gray-500">Errors in view</div><div className="mt-1 text-2xl font-semibold">{stats.errors}</div></div>
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
            {tabs.map((tab) => <button key={tab.key} onClick={() => setStatus(tab.key)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${status === tab.key ? 'bg-[#714B67] text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>{tab.label}</button>)}
          </div>
          <div className="relative w-full lg:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search declaration, container, BL, CRN, MRN" className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-[#714B67] focus:outline-none focus:ring-1 focus:ring-[#714B67]" />
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
              {dossiers.isLoading && <tr><td colSpan="9" className="px-4 py-8 text-center text-gray-500">Loading...</td></tr>}
              {!dossiers.isLoading && rows.length === 0 && <tr><td colSpan="9" className="px-4 py-8 text-center text-gray-500">No dossiers found.</td></tr>}
              {sortedRows.map((row) => (
                <tr key={row.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setSelectedRecordId(row.id)}>
                  {(() => {
                    const badge = statusBadge(row);
                    return (
                      <>
                  <td className="px-4 py-3 font-medium">{row.declaration_id}<div className="text-xs text-gray-400">{row.message_status}</div></td>
                  <td className="px-4 py-3 font-mono">{row.container_number}</td>
                  <td className="px-4 py-3">{fmtDate(row.eta)}</td>
                  <td className="px-4 py-3 max-w-48 truncate" title={row.bl}>{row.bl}</td>
                  <td className="px-4 py-3 font-mono text-xs">{row.eori_ship_agent}</td>
                  <td className="px-4 py-3 font-mono text-xs">{row.crn || '-'}</td>
                  <td className="px-4 py-3">{row.mrn ? <Badge tone="green">{row.mrn}</Badge> : '-'}</td>
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
      </div>

      {selectedRecordId && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onClick={() => setSelectedRecordId(null)}>
          <div className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-5 py-4">
              <div>
                <div className="text-lg font-semibold text-gray-900">Record Detail</div>
                <div className="text-sm text-gray-500">{recordDetail.data?.record?.declaration_id || '-'}</div>
              </div>
              <button onClick={() => setSelectedRecordId(null)} className="rounded-md border border-gray-300 p-2 text-gray-500 hover:text-gray-700">
                <XCircle size={16} />
              </button>
            </div>

            <div className="space-y-6 p-5">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-md border p-3"><div className="text-xs uppercase tracking-wide text-gray-500">Container</div><div className="mt-1 text-sm font-medium">{recordDetail.data?.record?.container_number || '-'}</div></div>
                <div className="rounded-md border p-3"><div className="text-xs uppercase tracking-wide text-gray-500">Done Reason</div><div className="mt-1 text-sm font-medium">{recordDetail.data?.record?.done_reason || '-'}</div></div>
                <div className="rounded-md border p-3"><div className="text-xs uppercase tracking-wide text-gray-500">CRN / MRN</div><div className="mt-1 text-sm font-medium">{recordDetail.data?.record?.crn || '-'} / {recordDetail.data?.record?.mrn || '-'}</div></div>
                <div className="rounded-md border p-3"><div className="text-xs uppercase tracking-wide text-gray-500">Email Sent</div><div className="mt-1 text-sm font-medium">{fmtDateTime(recordDetail.data?.record?.email_sent_at)}</div></div>
              </div>

              {Boolean(recordDetail.data?.record?.validation_errors?.length) && (
                <div className="rounded-md border border-red-200 bg-red-50 p-4">
                  <div className="mb-2 text-sm font-medium text-red-800">Lookup Validation</div>
                  <div className="space-y-1 text-sm text-red-700">
                    {recordDetail.data.record.validation_errors.map((error) => (
                      <div key={error}>{error}</div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="mb-2 text-sm font-medium text-gray-800">Actions</div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => recordAction.mutate({ id: selectedRecordId, action: 'resend_email' })} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-gray-50"><Mail size={14} />Resend email</button>
                  <button onClick={() => recordAction.mutate({ id: selectedRecordId, action: 'reopen' })} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-gray-50"><RotateCcw size={14} />Reopen</button>
                  <button onClick={() => recordAction.mutate({ id: selectedRecordId, action: 'mark_done' })} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-gray-50"><CheckCheck size={14} />Mark done</button>
                  <button onClick={() => recordAction.mutate({ id: selectedRecordId, action: 'suppress_email' })} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-gray-50"><Ban size={14} />Suppress email</button>
                </div>
              </div>

              <div>
                <div className="mb-2 text-sm font-medium text-gray-800">Lifecycle</div>
                <div className="space-y-3">
                  {(recordDetail.data?.record?.history || []).map((event, index) => (
                    <div key={`${event.at}-${index}`} className="rounded-md border border-gray-200 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium text-gray-900">{event.message}</div>
                        <div className="text-xs text-gray-500">{fmtDateTime(event.at)}</div>
                      </div>
                      <div className="mt-1 text-xs uppercase tracking-wide text-gray-500">{event.type}</div>
                      {event.data && Object.keys(event.data).length > 0 && (
                        <div className="mt-2 text-xs text-gray-600">{JSON.stringify(event.data)}</div>
                      )}
                    </div>
                  ))}
                  {!(recordDetail.data?.record?.history || []).length && (
                    <div className="rounded-md border border-dashed px-4 py-6 text-sm text-gray-500">No lifecycle events recorded yet.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
