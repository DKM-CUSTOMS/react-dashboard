const BASE = '/api/dkm-brain';

function buildQS(obj) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined && v !== null && v !== '') params.set(k, v);
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

async function apiFetch(path) {
  const res = await fetch(path);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// --- Overview (A) ---
export const fetchBrainOverview = (filters = {}) =>
  apiFetch(`${BASE}/overview${buildQS(filters)}`);

// --- Operations (B) ---
export const fetchBrainOperations = (filters = {}, granularity = 'day') =>
  apiFetch(`${BASE}/operations${buildQS({ ...filters, granularity })}`);

export const fetchBrainShipments = (filters = {}, page = 1, limit = 50) =>
  apiFetch(`${BASE}/shipments${buildQS({ ...filters, page, limit })}`);

// --- Cost (C) ---
export const fetchBrainCosts = (filters = {}) =>
  apiFetch(`${BASE}/costs${buildQS(filters)}`);

// --- Quality (D) ---
export const fetchBrainQuality = (filters = {}) =>
  apiFetch(`${BASE}/quality${buildQS(filters)}`);

// --- Clients ---
export const fetchBrainClients = () =>
  apiFetch(`${BASE}/clients`);

export const fetchBrainClientDetail = (clientKey) =>
  apiFetch(`${BASE}/clients/${encodeURIComponent(clientKey)}`);

// --- Shipment drilldown (F) ---
export const fetchBrainShipmentDetail = (shipmentId) =>
  apiFetch(`${BASE}/shipments/${encodeURIComponent(shipmentId)}`);

// --- Insights (G) ---
export const fetchBrainInsights = () =>
  apiFetch(`${BASE}/insights`);

// --- Cache ---
export const clearBrainCache = () =>
  fetch(`${BASE}/cache/clear`, { method: 'POST' }).then((r) => r.json());

// --- Client Rules ---
export const fetchClientRulesIndex = () =>
  apiFetch(`${BASE}/clients_rules/index`);

export const fetchClientRulesTemplate = () =>
  apiFetch(`${BASE}/clients_rules/template`);

export const fetchClientRule = (clientKey) =>
  apiFetch(`${BASE}/clients_rules/rule/${encodeURIComponent(clientKey)}`);

export const saveClientRule = async (clientKey, ruleData) => {
  const res = await fetch(`${BASE}/clients_rules/rule/${encodeURIComponent(clientKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ruleData),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || `HTTP ${res.status}`);
  }
  return res.json();
};

// --- CSV export utility ---
export function exportTableToCsv(filename, rows, columns) {
  const header = columns.map((c) => `"${c.label ?? c.key}"`).join(',');
  const lines = rows.map((row) =>
    columns.map((c) => {
      const v = c.key.split('.').reduce((o, k) => o?.[k], row);
      const s = v === undefined || v === null ? '' : String(v);
      return `"${s.replace(/"/g, '""')}"`;
    }).join(',')
  );
  const csv = [header, ...lines].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// --- Formatters ---
export const fmtCost = (v) =>
  v === undefined || v === null ? '—' : `$${Number(v).toFixed(4)}`;

export const fmtCostFull = (v) =>
  v === undefined || v === null ? '—' : `$${Number(v).toFixed(2)}`;

export const fmtPct = (v) =>
  v === undefined || v === null ? '—' : `${Math.round(Number(v) * 100)}%`;

export const fmtNum = (v) =>
  v === undefined || v === null ? '—' : Number(v).toLocaleString();

export const fmtTokens = (v) => {
  if (v === undefined || v === null) return '—';
  const n = Number(v);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

export const fmtDuration = (ms) => {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
};

export const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
};
