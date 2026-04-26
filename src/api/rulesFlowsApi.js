const BASE = "/api/rules";

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

// Flows
export const getFlows = () => req("GET", "/flows");
export const createFlow = (body) => req("POST", "/flows", body);
export const updateFlow = (id, body) => req("PUT", `/flows/${id}`, body);
export const deleteFlow = (id) => req("DELETE", `/flows/${id}`);

// Checks
export const getChecks = (flowId) => req("GET", `/flows/${flowId}/checks`);
export const createCheck = (flowId, body) => req("POST", `/flows/${flowId}/checks`, body);
export const updateCheck = (id, body) => req("PUT", `/checks/${id}`, body);
export const deleteCheck = (id) => req("DELETE", `/checks/${id}`);

// Run
export const runFlow = (flowId, declarationId) =>
  req("POST", `/run/${flowId}`, { declarationId });

// Audit
export const getAudit = (params = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  return req("GET", `/audit${qs ? `?${qs}` : ""}`);
};

// Seed demo data
export const seedDemo = () => req("POST", "/seed");
