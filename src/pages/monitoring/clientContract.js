const INTERNAL_FORWARDING_DOMAIN = "dkm-customs.com";
const MONITORING_ROUTE_PREFIX = "/monitoring/brain";

export const CLIENT_RULE_STATE_META = {
  runtime_profile: {
    label: "Verified",
    shortLabel: "Verified",
    color: "bg-emerald-500 text-white border-emerald-600",
    subtleColor: "bg-emerald-100 text-emerald-800 border-emerald-200",
  },
  draft_from_observed_domain: {
    label: "AI detected",
    shortLabel: "AI detected",
    color: "bg-amber-500 text-white border-amber-600",
    subtleColor: "bg-amber-100 text-amber-800 border-amber-200",
  },
};

export function toArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [String(value)];
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

export function getClientRulesState(record = {}) {
  return String(record.client_rules_status || record.source_mode || "").trim();
}

export function getClientRulesStateMeta(record = {}) {
  const state = getClientRulesState(record);
  return {
    key: state,
    ...(CLIENT_RULE_STATE_META[state] || {
      label: state ? state.replace(/_/g, " ") : "Unknown",
      shortLabel: state ? state.replace(/_/g, " ") : "Unknown",
      color: "bg-gray-100 text-gray-600 border-gray-200",
      subtleColor: "bg-gray-100 text-gray-700 border-gray-200",
    }),
  };
}

export function isDraftClientRules(record = {}) {
  return getClientRulesState(record) === "draft_from_observed_domain";
}

export function extractDomain(value) {
  if (!value) return "";
  let raw = String(value).trim().toLowerCase();
  raw = raw.replace(/^mailto:/, "");

  const emailMatch = raw.match(/<?[^@\s<>]+@([^>\s,;]+)>?$/);
  if (emailMatch?.[1]) {
    raw = emailMatch[1];
  }

  const atIndex = raw.lastIndexOf("@");
  if (atIndex >= 0) raw = raw.slice(atIndex + 1);

  return raw
    .replace(/^[<[(]+/, "")
    .replace(/[>\]),;:.]+$/, "")
    .replace(/^\.+|\.+$/g, "");
}

export function isInternalForwardingDomain(value) {
  const domain = extractDomain(value);
  return (
    domain === INTERNAL_FORWARDING_DOMAIN ||
    domain.endsWith(`.${INTERNAL_FORWARDING_DOMAIN}`)
  );
}

export function toExternalDomains(values) {
  return unique(
    toArray(values)
      .map((value) => extractDomain(value))
      .filter(Boolean)
      .filter((domain) => !isInternalForwardingDomain(domain))
  );
}

export function toVisibleSenderNames(values) {
  return unique(
    toArray(values)
      .map((value) => String(value).trim())
      .filter(Boolean)
      .filter((value) => !/@dkm-customs\.com/i.test(value))
  );
}

export function getClientSignals(record = {}) {
  const matching = record.matching || {};
  const rawObservedDomains = toArray(
    matching.observed_email_domains || record.observed_email_domains
  );

  const recognizedEmailDomains = toExternalDomains(
    matching.email_domains || record.email_domains || record.primary_domain
  );
  const observedEmailDomains = toExternalDomains(rawObservedDomains);
  const observedSenderNames = toVisibleSenderNames(
    matching.observed_sender_names ||
      record.observed_sender_names ||
      matching.sender_name_patterns ||
      record.sender_name_patterns
  );

  const primarySignal =
    observedEmailDomains[0] ||
    recognizedEmailDomains[0] ||
    (isInternalForwardingDomain(record.primary_domain)
      ? ""
      : extractDomain(record.primary_domain));

  return {
    recognizedEmailDomains,
    observedEmailDomains,
    observedSenderNames,
    primarySignal,
    hiddenForwardingDomainCount: rawObservedDomains.filter((value) =>
      isInternalForwardingDomain(value)
    ).length,
  };
}

function normalizePath(path) {
  return String(path || "")
    .trim()
    .replace(/\\/g, "/")
    .split(/[?#]/, 1)[0];
}

function isMonitoringRoute(path) {
  return normalizePath(path).startsWith(MONITORING_ROUTE_PREFIX);
}

function clientKeyFromJsonPath(path) {
  const clean = normalizePath(path);
  if (!clean) return "";

  if (clean.startsWith(`${MONITORING_ROUTE_PREFIX}/client-rules/`)) {
    return decodeURIComponent(clean.slice(`${MONITORING_ROUTE_PREFIX}/client-rules/`.length));
  }
  if (clean.startsWith(`${MONITORING_ROUTE_PREFIX}/client/`)) {
    return decodeURIComponent(clean.slice(`${MONITORING_ROUTE_PREFIX}/client/`.length));
  }

  const dashboardMatch =
    clean.match(/dashboard\/clients_rules\/([^/]+)\.json$/) ||
    clean.match(/dashboard\/clients\/([^/]+)\.json$/);
  if (dashboardMatch?.[1]) return decodeURIComponent(dashboardMatch[1]);

  const registryMatch = clean.match(/clients\/([^/]+)\/(?:client|summary)\.json$/);
  if (registryMatch?.[1]) return decodeURIComponent(registryMatch[1]);

  return "";
}

export function getClientKey(record = {}) {
  return (
    record.client_key ||
    clientKeyFromJsonPath(record.dashboard_client_path) ||
    clientKeyFromJsonPath(record.client_rules_path) ||
    clientKeyFromJsonPath(record.client_registry_path) ||
    clientKeyFromJsonPath(record.client_summary_path) ||
    ""
  );
}

export function getClientRoute(record = {}) {
  if (isMonitoringRoute(record.dashboard_client_path)) {
    return normalizePath(record.dashboard_client_path);
  }
  if (isMonitoringRoute(record.client_summary_path)) {
    return normalizePath(record.client_summary_path);
  }
  const clientKey = getClientKey(record);
  return clientKey
    ? `${MONITORING_ROUTE_PREFIX}/client/${encodeURIComponent(clientKey)}`
    : null;
}

export function getClientRulesRoute(record = {}) {
  if (isMonitoringRoute(record.client_rules_path)) {
    return normalizePath(record.client_rules_path);
  }
  const clientKey = clientKeyFromJsonPath(record.client_rules_path) || getClientKey(record);
  return clientKey
    ? `${MONITORING_ROUTE_PREFIX}/client-rules/${encodeURIComponent(clientKey)}`
    : null;
}

export function getSourceLinks(record = {}) {
  return [
    { label: "Dashboard client", path: record.dashboard_client_path || null },
    { label: "Client rules", path: record.client_rules_path || null },
    { label: "Client registry", path: record.client_registry_path || null },
    { label: "Client summary", path: record.client_summary_path || null },
  ].filter((entry) => entry.path);
}
