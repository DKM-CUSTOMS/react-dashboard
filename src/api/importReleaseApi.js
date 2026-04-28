const BASE_URL = '/api/import-release';

const request = async (path, options = {}) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Import release request failed');
  return data;
};

export const getImportReleaseDossiers = ({ status = '', search = '', page = 1, pageSize = 50 } = {}) => {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) params.set('status', status);
  if (search) params.set('search', search);
  return request(`/dossiers?${params.toString()}`);
};

export const runImportReleaseSync = (options = {}) => request('/run', { method: 'POST', body: JSON.stringify(options) });
export const clearImportReleaseMeta = () => request('/clear-meta', { method: 'POST' });
export const getImportReleaseSettings = () => request('/settings');
export const updateImportReleaseSettings = (settings) => request('/settings', { method: 'PUT', body: JSON.stringify(settings) });
export const getImportReleaseHealth = () => request('/health');
export const getImportReleaseRuns = (limit = 20) => request(`/runs?limit=${encodeURIComponent(String(limit))}`);
export const getImportReleaseRecord = (id) => request(`/records/${encodeURIComponent(id)}`);
export const sendImportReleaseTestEmail = (to = '') => request('/test-email', { method: 'POST', body: JSON.stringify({ to }) });
export const runImportReleaseRecordAction = (id, action) => request(`/records/${encodeURIComponent(id)}/action`, { method: 'POST', body: JSON.stringify({ action }) });


