/**
 * dkmBrainAggregator.js
 *
 * Reads exclusively from the pre-computed dashboard blobs:
 *   dashboard/overview.json
 *   dashboard/clients/<client_key>.json
 *
 * Real field names (from actual blob schema):
 *   total_estimated_cost_usd  (not total_cost_usd)
 *   model_usage               object keyed by model name
 *   review_reason_counts      object keyed by reason string
 *   status_counts             { rendered, failed, review_required }
 *   regime_counts             object keyed by regime string
 *   recent_runs               array of run summaries per client blob
 */

// Only reads from dashboard/ folder — no raw shipments/ or clients/ paths.
import {
  readDashboardOverview,
  readDashboardClient,
  readAllDashboardClients,
  brainCache,
} from "./dkmBrainBlobStore.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toSortedTopN(obj, n = 10) {
  return Object.entries(obj || {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([label, value]) => ({ label, value }));
}

function toDateKey(iso, granularity = "day") {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (isNaN(d)) return "unknown";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  if (granularity === "month") return `${y}-${m}`;
  if (granularity === "week") {
    const s = new Date(d);
    s.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return `${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, "0")}-${String(s.getUTCDate()).padStart(2, "0")}`;
  }
  return `${y}-${m}-${day}`;
}

function modelUsageToArray(modelUsageObj) {
  return Object.entries(modelUsageObj || {}).map(([model, stats]) => ({
    label: model,
    value: stats.calls || 0,
    input_tokens: stats.input_tokens || 0,
    output_tokens: stats.output_tokens || 0,
    total_tokens: stats.total_tokens || 0,
    cost_usd: stats.estimated_cost_usd || 0,
  }));
}

// Normalise a recent_run entry from a client dashboard blob into a flat shipment row
function normalizeRun(run, clientBlob) {
  return {
    shipment_id:          run.shipment_id,
    run_id:               run.run_id,
    client_key:           run.client_key   || clientBlob?.client_key,
    client_name:          run.client_label || clientBlob?.client_label || clientBlob?.client_name || clientBlob?.client_key,
    sender_domain:        run.sender_domain,
    sender_email:         run.sender_email || null,
    commercial_reference: run.commercial_reference,
    reference_dr:         run.reference_dr,
    primary_reference:    run.primary_reference,
    subject:              run.subject,
    regime:               run.regime,
    status:               run.status,
    stage:                run.stage,
    item_count:           run.item_count   || 0,
    llm_call_count:       run.llm_call_count || 0,
    total_cost_usd:       run.total_estimated_cost_usd || 0,
    models_used:          run.model_names  || [],
    review_reasons:       run.review_reasons || [],
    created_at:           run.start_time,
    updated_at:           run.end_time,
  };
}

function applyFilters(rows, filters = {}) {
  let out = rows;
  if (filters.dateFrom) {
    const from = new Date(filters.dateFrom).getTime();
    out = out.filter((r) => r.created_at && new Date(r.created_at).getTime() >= from);
  }
  if (filters.dateTo) {
    const to = new Date(filters.dateTo).getTime();
    out = out.filter((r) => r.created_at && new Date(r.created_at).getTime() <= to);
  }
  if (filters.client)  out = out.filter((r) => r.client_key === filters.client);
  if (filters.domain)  out = out.filter((r) => r.sender_domain?.includes(filters.domain));
  if (filters.regime)  out = out.filter((r) => r.regime === filters.regime);
  if (filters.status)  out = out.filter((r) => r.status === filters.status);
  if (filters.model)   out = out.filter((r) => r.models_used?.includes(filters.model));
  if (filters.q) {
    const q = filters.q.toLowerCase();
    out = out.filter((r) =>
      [r.commercial_reference, r.reference_dr, r.primary_reference,
       r.shipment_id, r.run_id, r.subject, r.sender_email, r.client_name, r.client_key]
        .some((v) => v && String(v).toLowerCase().includes(q))
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// A — Executive Overview
// ---------------------------------------------------------------------------

export async function getOverviewMetrics(filters = {}) {
  const cacheKey = `brain:overview:${JSON.stringify(filters)}`;
  const cached = brainCache.get(cacheKey);
  if (cached) return cached;

  const [overview, clientBlobs] = await Promise.all([
    readDashboardOverview(),
    readAllDashboardClients(),
  ]);

  if (!overview) {
    return { error: "dashboard/overview.json not found in container" };
  }

  // Collect all recent_runs across all client blobs for filter-sensitive metrics
  const allRuns = clientBlobs.flatMap((cb) =>
    (cb.recent_runs || []).map((r) => normalizeRun(r, cb))
  );
  const filtered = applyFilters(allRuns, filters);

  // Status counts — from overview clients array (or filtered runs if filters active)
  const hasFilters = Object.values(filters).some(Boolean);

  let totalShipments, totalRendered, totalReview, totalFailed, totalCost;

  if (!hasFilters) {
    // Use pre-computed overview numbers exactly as-is
    totalShipments = overview.included_shipment_count || 0;
    totalRendered  = overview.clients?.reduce((s, c) => s + (c.status_counts?.rendered || 0), 0) || 0;
    totalReview    = overview.clients?.reduce((s, c) => s + (c.status_counts?.review_required || 0), 0) || 0;
    totalFailed    = overview.clients?.reduce((s, c) => s + (c.status_counts?.failed || 0), 0) || 0;
    totalCost      = overview.total_estimated_cost_usd || 0;
  } else {
    totalShipments = filtered.length;
    totalRendered  = filtered.filter((r) => r.status === "rendered").length;
    totalReview    = filtered.filter((r) => r.status === "review_required").length;
    totalFailed    = filtered.filter((r) => r.status === "failed").length;
    totalCost      = filtered.reduce((s, r) => s + (r.total_cost_usd || 0), 0);
  }

  // Top clients by cost — from overview.clients
  const topClientsByCost = [...(overview.clients || [])]
    .filter((c) => c.client_key !== "unknown")
    .sort((a, b) => (b.total_estimated_cost_usd || 0) - (a.total_estimated_cost_usd || 0))
    .slice(0, 10)
    .map((c) => ({
      client_key: c.client_key,
      label: c.client_label || c.client_name || c.client_key,
      value: c.total_estimated_cost_usd || 0,
    }));

  // Top clients by review rate (need per-client status_counts)
  const clientReviewRates = (overview.clients || [])
    .filter((c) => c.client_key !== "unknown" && (c.shipment_count || 0) >= 2)
    .map((c) => {
      const total   = c.shipment_count || 0;
      const reviews = c.status_counts?.review_required || 0;
      return {
        client_key: c.client_key,
        label: c.client_label || c.client_name || c.client_key,
        value: total ? Math.round((reviews / total) * 100) : 0,
      };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  // Review reason counts — aggregate from all client blobs
  const reviewReasonCounts = {};
  for (const cb of clientBlobs) {
    for (const [reason, count] of Object.entries(cb.review_reason_counts || {})) {
      reviewReasonCounts[reason] = (reviewReasonCounts[reason] || 0) + count;
    }
  }

  // Failure reasons — from failed recent_runs
  const failureReasonCounts = {};
  for (const cb of clientBlobs) {
    for (const r of (cb.recent_runs || [])) {
      if (r.status === "failed" && r.review_reasons?.length) {
        for (const reason of r.review_reasons) {
          failureReasonCounts[reason] = (failureReasonCounts[reason] || 0) + 1;
        }
      }
    }
  }

  // Model usage — from overview.model_usage object
  const modelUsage = modelUsageToArray(overview.model_usage);

  // Regime split — aggregate regime_counts across all client blobs
  const regimeCounts = {};
  for (const cb of clientBlobs) {
    for (const [regime, count] of Object.entries(cb.regime_counts || {})) {
      regimeCounts[regime] = (regimeCounts[regime] || 0) + count;
    }
  }

  // Token averages
  const avgTokens   = totalShipments ? (overview.total_tokens || 0) / totalShipments : 0;
  const renderedCount = totalRendered || 1;
  const costPerRendered = totalCost / Math.max(renderedCount, 1);

  const result = {
    total_shipments:    totalShipments,
    total_rendered:     totalRendered,
    total_review:       totalReview,
    total_failed:       totalFailed,
    review_rate:        totalShipments ? totalReview / totalShipments : 0,
    failure_rate:       totalShipments ? totalFailed / totalShipments : 0,
    total_cost_usd:     totalCost,
    cost_per_rendered:  costPerRendered,
    avg_tokens:         avgTokens,
    avg_duration_ms:    null, // not in dashboard blobs
    top_clients_cost:   topClientsByCost,
    top_clients_review: clientReviewRates,
    top_review_reasons: toSortedTopN(reviewReasonCounts, 10),
    top_failure_reasons:toSortedTopN(failureReasonCounts, 10),
    model_usage:        modelUsage,
    regime_split:       Object.entries(regimeCounts).map(([label, value]) => ({ label, value })),
    generated_at:       overview.generated_at,
  };

  brainCache.set(cacheKey, result);
  return result;
}

// ---------------------------------------------------------------------------
// B — Operations list (paginated)
// ---------------------------------------------------------------------------

export async function getShipmentList(filters = {}, page = 1, limit = 50) {
  const clientBlobs = await readAllDashboardClients();

  const allRuns = clientBlobs.flatMap((cb) =>
    (cb.recent_runs || []).map((r) => normalizeRun(r, cb))
  );

  const filtered = applyFilters(allRuns, filters).sort(
    (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
  );

  const total  = filtered.length;
  const start  = (page - 1) * limit;
  const items  = filtered.slice(start, start + limit);
  return { items, total, page, limit, pages: Math.ceil(total / limit) };
}

// ---------------------------------------------------------------------------
// B — Operations time-series
// ---------------------------------------------------------------------------

export async function getOperationsTimeSeries(filters = {}, granularity = "day") {
  const cacheKey = `brain:ops_ts:${JSON.stringify(filters)}:${granularity}`;
  const cached = brainCache.get(cacheKey);
  if (cached) return cached;

  const clientBlobs = await readAllDashboardClients();
  const allRuns = clientBlobs.flatMap((cb) =>
    (cb.recent_runs || []).map((r) => normalizeRun(r, cb))
  );
  const filtered = applyFilters(allRuns, filters);

  const buckets = {};
  for (const r of filtered) {
    const key = toDateKey(r.created_at, granularity);
    if (!buckets[key]) buckets[key] = { date: key, total: 0, rendered: 0, review: 0, failed: 0, cost: 0 };
    const b = buckets[key];
    b.total++;
    if (r.status === "rendered")         b.rendered++;
    else if (r.status === "review_required") b.review++;
    else if (r.status === "failed")      b.failed++;
    b.cost += r.total_cost_usd || 0;
  }

  const series = Object.values(buckets).sort((a, b) => a.date.localeCompare(b.date));
  brainCache.set(cacheKey, series);
  return series;
}

// ---------------------------------------------------------------------------
// C — Cost breakdown
// ---------------------------------------------------------------------------

export async function getCostBreakdown(filters = {}) {
  const cacheKey = `brain:cost:${JSON.stringify(filters)}`;
  const cached = brainCache.get(cacheKey);
  if (cached) return cached;

  const [overview, clientBlobs] = await Promise.all([
    readDashboardOverview(),
    readAllDashboardClients(),
  ]);

  const allRuns = clientBlobs.flatMap((cb) =>
    (cb.recent_runs || []).map((r) => normalizeRun(r, cb))
  );
  const filtered = applyFilters(allRuns, filters);

  const byDay    = {};
  const byClient = {};
  const byRegime = {};
  const byStatus = { rendered: 0, review_required: 0, failed: 0 };

  for (const r of filtered) {
    const cost   = r.total_cost_usd || 0;
    const day    = toDateKey(r.created_at, "day");
    const client = r.client_name || r.client_key || "unknown";
    const regime = r.regime || "unknown";

    byDay[day]       = (byDay[day] || 0) + cost;
    byClient[client] = (byClient[client] || 0) + cost;
    byRegime[regime] = (byRegime[regime] || 0) + cost;
    if (byStatus[r.status] !== undefined) byStatus[r.status] += cost;
  }

  // Model cost — from client blobs model_usage (aggregated, not per-run)
  const byModel = {};
  for (const cb of clientBlobs) {
    for (const [model, stats] of Object.entries(cb.model_usage || {})) {
      byModel[model] = (byModel[model] || 0) + (stats.estimated_cost_usd || 0);
    }
  }

  // Token totals — from overview (most accurate) or filtered runs
  const hasFilters = Object.values(filters).some(Boolean);
  const totalInput  = hasFilters
    ? filtered.reduce((s, r) => s + (r.input_tokens || 0), 0)
    : (overview?.total_input_tokens || 0);
  const totalOutput = hasFilters
    ? filtered.reduce((s, r) => s + (r.output_tokens || 0), 0)
    : (overview?.total_output_tokens || 0);
  const totalCost   = hasFilters
    ? filtered.reduce((s, r) => s + (r.total_cost_usd || 0), 0)
    : (overview?.total_estimated_cost_usd || 0);

  // Outlier shipments by cost
  const outlierShipments = [...filtered]
    .sort((a, b) => (b.total_cost_usd || 0) - (a.total_cost_usd || 0))
    .slice(0, 20)
    .map((r) => ({
      shipment_id:          r.shipment_id,
      client_name:          r.client_name || r.client_key,
      commercial_reference: r.commercial_reference,
      cost_usd:             r.total_cost_usd,
      status:               r.status,
      created_at:           r.created_at,
    }));

  const renderedRuns = filtered.filter((r) => r.status === "rendered");
  const reviewRuns   = filtered.filter((r) => r.status === "review_required");
  const failedRuns   = filtered.filter((r) => r.status === "failed");

  const result = {
    total_cost_usd:       totalCost,
    total_input_tokens:   totalInput,
    total_output_tokens:  totalOutput,
    total_cached_tokens:  0,
    by_day:    Object.entries(byDay).map(([date, cost]) => ({ date, cost })).sort((a, b) => a.date.localeCompare(b.date)),
    by_client: toSortedTopN(byClient, 20),
    by_regime: toSortedTopN(byRegime, 20),
    by_model:  toSortedTopN(byModel, 20),
    by_status: Object.entries(byStatus).map(([label, cost]) => ({ label, cost })),
    cost_per_rendered: renderedRuns.length ? byStatus.rendered / renderedRuns.length : 0,
    cost_per_review:   reviewRuns.length   ? byStatus.review_required / reviewRuns.length : 0,
    cost_per_failed:   failedRuns.length   ? byStatus.failed / failedRuns.length : 0,
    outlier_shipments: outlierShipments,
    outlier_clients:   toSortedTopN(byClient, 10),
  };

  brainCache.set(cacheKey, result);
  return result;
}

// ---------------------------------------------------------------------------
// D — Quality metrics
// ---------------------------------------------------------------------------

export async function getQualityMetrics(filters = {}) {
  const cacheKey = `brain:quality:${JSON.stringify(filters)}`;
  const cached = brainCache.get(cacheKey);
  if (cached) return cached;

  const clientBlobs = await readAllDashboardClients();

  const allRuns = clientBlobs.flatMap((cb) =>
    (cb.recent_runs || []).map((r) => normalizeRun(r, cb))
  );
  const filtered = applyFilters(allRuns, filters);

  // Aggregate review_reason_counts from client blobs
  const reviewReasonCounts = {};
  for (const cb of clientBlobs) {
    for (const [reason, count] of Object.entries(cb.review_reason_counts || {})) {
      reviewReasonCounts[reason] = (reviewReasonCounts[reason] || 0) + count;
    }
  }

  // Per-client review / fail rates
  const clientStats = {};
  for (const cb of clientBlobs) {
    const key    = cb.client_label || cb.client_name || cb.client_key || "unknown";
    const total  = cb.shipment_count || 0;
    const counts = cb.status_counts || {};
    clientStats[key] = {
      client_key:   cb.client_key,
      label:        key,
      total,
      review_count: counts.review_required || 0,
      fail_count:   counts.failed || 0,
      review_rate:  total ? Math.round(((counts.review_required || 0) / total) * 100) : 0,
      fail_rate:    total ? Math.round(((counts.failed || 0) / total) * 100) : 0,
    };
  }

  const clientsByReviewRate = Object.values(clientStats)
    .filter((c) => c.total >= 1)
    .sort((a, b) => b.review_rate - a.review_rate);

  // Regime fail rates
  const regimeStats = {};
  for (const cb of clientBlobs) {
    for (const [regime, count] of Object.entries(cb.regime_counts || {})) {
      if (!regimeStats[regime]) regimeStats[regime] = { label: regime, total: 0, fail_count: 0 };
      regimeStats[regime].total += count;
    }
  }
  // failed runs by regime from recent_runs
  for (const r of filtered) {
    if (r.status === "failed" && r.regime) {
      if (regimeStats[r.regime]) regimeStats[r.regime].fail_count++;
    }
  }
  const regimeFailRates = Object.values(regimeStats)
    .map((r) => ({ ...r, fail_rate: r.total ? Math.round((r.fail_count / r.total) * 100) : 0 }))
    .sort((a, b) => b.fail_rate - a.fail_rate);

  // Avg items per run
  const itemCounts = filtered.map((r) => r.item_count || 0).filter((n) => n > 0);
  const avgItems   = itemCounts.length ? itemCounts.reduce((s, n) => s + n, 0) / itemCounts.length : 0;

  // Unknown client rate
  const unknownRuns = filtered.filter((r) => !r.client_key || r.client_key === "unknown").length;

  // Per-client categorized review reasons (model_missing / model_review / declarant_review)
  function categorizeReason(reason) {
    if (reason.startsWith("model_missing:"))   return "missing";
    if (reason.startsWith("model_review:"))    return "model";
    if (reason.startsWith("declarant_review:"))return "declarant";
    return "other";
  }

  const clientsReviewDetail = clientBlobs.map((cb) => {
    const groups = { missing: [], model: [], declarant: [], other: [] };
    for (const [reason, count] of Object.entries(cb.review_reason_counts || {})) {
      const cat = categorizeReason(reason);
      const label = reason.replace(/^(model_missing:|model_review:|declarant_review:)\s*/i, "").trim();
      groups[cat].push({ label, count });
    }
    for (const k of Object.keys(groups)) {
      groups[k].sort((a, b) => b.count - a.count);
    }
    return {
      client_key:   cb.client_key,
      client_label: cb.client_label || cb.client_key,
      total:        cb.shipment_count || 0,
      review_count: cb.status_counts?.review_required || 0,
      fail_count:   cb.status_counts?.failed || 0,
      reasons:      groups,
      total_reasons: Object.values(cb.review_reason_counts || {}).reduce((s, n) => s + n, 0),
    };
  }).filter(c => c.total_reasons > 0)
    .sort((a, b) => b.total_reasons - a.total_reasons);

  const result = {
    top_review_reasons:     toSortedTopN(reviewReasonCounts, 20),
    top_validation_issues:  [],
    clients_by_review_rate: clientsByReviewRate.slice(0, 20),
    clients_review_detail:  clientsReviewDetail,
    regimes_by_fail_rate:   regimeFailRates,
    avg_items_per_shipment: avgItems,
    unknown_client_rate:    filtered.length ? unknownRuns / filtered.length : 0,
    profile_match_rate:     filtered.length ? (filtered.length - unknownRuns) / filtered.length : 0,
  };

  brainCache.set(cacheKey, result);
  return result;
}

// ---------------------------------------------------------------------------
// Clients list
// ---------------------------------------------------------------------------

export async function getClientList() {
  const cacheKey = "brain:client_list";
  const cached = brainCache.get(cacheKey);
  if (cached) return cached;

  const clientBlobs = await readAllDashboardClients();

  const result = clientBlobs.map((cb) => ({
    client_key:      cb.client_key,
    client_name:     cb.client_label || cb.client_name || cb.client_key,
    domain:          cb.primary_domain,
    is_known:        cb.client_key !== "unknown" && cb.dashboard_included !== false,
    first_seen:      cb.first_seen_at,
    last_seen:       cb.last_seen_at,
    total_shipments: cb.shipment_count || 0,
    total_cost_usd:  cb.total_estimated_cost_usd || 0,
    total_tokens:    cb.total_tokens || 0,
    review_rate:     cb.shipment_count
      ? (cb.status_counts?.review_required || 0) / cb.shipment_count
      : 0,
    fail_rate:       cb.shipment_count
      ? (cb.status_counts?.failed || 0) / cb.shipment_count
      : 0,
    status_counts:   cb.status_counts || {},
    regime_breakdown: Object.entries(cb.regime_counts || {}).map(([label, value]) => ({ label, value })),
  }));

  brainCache.set(cacheKey, result);
  return result;
}

// ---------------------------------------------------------------------------
// E — Client drilldown
// ---------------------------------------------------------------------------

export async function getClientDetail(clientKey) {
  const cacheKey = `brain:client_detail:${clientKey}`;
  const cached = brainCache.get(cacheKey);
  if (cached) return cached;

  const cb = await readDashboardClient(clientKey);
  if (!cb) return { error: `No dashboard blob found for client: ${clientKey}` };

  const shipments = (cb.recent_runs || []).map((r) => normalizeRun(r, cb));

  // Time series from recent_runs
  const timeSeries = {};
  for (const r of shipments) {
    const day = toDateKey(r.created_at, "day");
    if (!timeSeries[day]) timeSeries[day] = { date: day, total: 0, rendered: 0, review: 0, failed: 0, cost: 0 };
    const b = timeSeries[day];
    b.total++;
    if (r.status === "rendered")         b.rendered++;
    else if (r.status === "review_required") b.review++;
    else if (r.status === "failed")      b.failed++;
    b.cost += r.total_cost_usd || 0;
  }

  const result = {
    client_key:      cb.client_key,
    client_name:     cb.client_label || cb.client_name || cb.client_key,
    domain:          cb.primary_domain,
    is_known:        cb.client_key !== "unknown",
    first_seen:      cb.first_seen_at,
    last_seen:       cb.last_seen_at,
    total_shipments: cb.shipment_count || 0,
    total_rendered:  cb.status_counts?.rendered || 0,
    total_review:    cb.status_counts?.review_required || 0,
    total_failed:    cb.status_counts?.failed || 0,
    total_cost_usd:  cb.total_estimated_cost_usd || 0,
    avg_cost:        (cb.shipment_count || 0) > 0
      ? (cb.total_estimated_cost_usd || 0) / cb.shipment_count
      : 0,
    review_rate:     (cb.shipment_count || 0) > 0
      ? (cb.status_counts?.review_required || 0) / cb.shipment_count
      : 0,
    fail_rate:       (cb.shipment_count || 0) > 0
      ? (cb.status_counts?.failed || 0) / cb.shipment_count
      : 0,
    total_input_tokens:  cb.total_input_tokens  || 0,
    total_output_tokens: cb.total_output_tokens || 0,
    total_tokens:        cb.total_tokens        || 0,
    review_reasons: toSortedTopN(cb.review_reason_counts || {}, 10),
    regime_breakdown: Object.entries(cb.regime_counts || {}).map(([label, value]) => ({ label, value })),
    model_breakdown: (() => {
      // prefer model_usage object; fall back to model_names from recent_runs
      let arr = modelUsageToArray(cb.model_usage);
      if (!arr.length) {
        const counts = {};
        for (const run of (cb.recent_runs || [])) {
          for (const m of (run.model_names || [])) {
            if (!counts[m]) counts[m] = { calls: 0, cost: 0 };
            counts[m].calls++;
            counts[m].cost += run.total_estimated_cost_usd
              ? run.total_estimated_cost_usd / Math.max((run.model_names || []).length, 1)
              : 0;
          }
        }
        arr = Object.entries(counts).map(([label, v]) => ({
          label, value: v.calls, cost_usd: v.cost,
        }));
      }
      return arr.map(m => ({ label: m.label, value: m.value, cost_usd: m.cost_usd || 0 }));
    })(),
    shipments_trend:  Object.values(timeSeries).sort((a, b) => a.date.localeCompare(b.date)),
    latest_shipments: shipments.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)),

    // Operational signals derived from recent_runs
    avg_items_per_run: (() => {
      const counts = (cb.recent_runs || []).map(r => r.item_count || 0).filter(n => n > 0);
      return counts.length ? Math.round(counts.reduce((s,n)=>s+n,0) / counts.length) : 0;
    })(),
    max_items_run: (cb.recent_runs || []).reduce((max, r) =>
      (r.item_count || 0) > (max.item_count || 0) ? r : max, {}),
    failed_runs: (cb.recent_runs || []).filter(r => r.status === 'failed'),
    review_category_counts: (() => {
      const missing = [], model = [], declarant = [];
      for (const [r, c] of Object.entries(cb.review_reason_counts || {})) {
        if (r.startsWith('model_missing:'))    missing.push({ label: r.replace('model_missing:', '').trim(), count: c });
        else if (r.startsWith('model_review:')) model.push({ label: r.replace('model_review:', '').trim(), count: c });
        else if (r.startsWith('declarant_review:')) declarant.push({ label: r.replace('declarant_review:', '').trim(), count: c });
      }
      missing.sort((a,b)=>b.count-a.count);
      model.sort((a,b)=>b.count-a.count);
      declarant.sort((a,b)=>b.count-a.count);
      return { missing, model, declarant };
    })(),
  };

  brainCache.set(cacheKey, result);
  return result;
}

// ---------------------------------------------------------------------------
// F — Shipment drilldown (still reads raw shipment blobs)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// F — Shipment drilldown (dashboard-only, searches recent_runs across clients)
// ---------------------------------------------------------------------------

export async function getShipmentDetail(shipmentId) {
  const cacheKey = `brain:shipment_detail:${shipmentId}`;
  const cached = brainCache.get(cacheKey);
  if (cached) return cached;

  const clientBlobs = await readAllDashboardClients();

  // Find the run summary for this shipment across all client blobs
  let matchedRun = null;
  let matchedClient = null;
  for (const cb of clientBlobs) {
    const run = (cb.recent_runs || []).find(r => r.shipment_id === shipmentId);
    if (run) { matchedRun = run; matchedClient = cb; break; }
  }

  if (!matchedRun) {
    return {
      shipment: { shipment_id: shipmentId },
      runs: [], llm_calls: [], render_paths: [],
      total_cost_usd: 0, total_tokens: 0, total_duration_ms: 0,
      _not_found: true,
    };
  }

  // Build shipment object from run summary fields
  const shipment = {
    shipment_id:          matchedRun.shipment_id,
    client_key:           matchedRun.client_key  || matchedClient?.client_key,
    client_label:         matchedRun.client_label || matchedClient?.client_label,
    sender_domain:        matchedRun.sender_domain,
    sender_email:         matchedRun.sender_email,
    subject:              matchedRun.subject,
    regime:               matchedRun.regime,
    status:               matchedRun.status,
    stage:                matchedRun.stage,
    commercial_reference: matchedRun.commercial_reference,
    reference_dr:         matchedRun.reference_dr,
    primary_reference:    matchedRun.primary_reference,
    review_reasons:       matchedRun.review_reasons || [],
    item_count:           matchedRun.item_count,
    llm_call_count:       matchedRun.llm_call_count,
    attachment_count:     matchedRun.attachment_count,
    first_seen_at:        matchedRun.start_time,
  };

  // Build run object — model_names available, per-call detail needs shipments/ folder
  const run = {
    run_id:                   matchedRun.run_id,
    shipment_id:              matchedRun.shipment_id,
    status:                   matchedRun.status,
    stage:                    matchedRun.stage,
    start_time:               matchedRun.start_time,
    end_time:                 matchedRun.end_time,
    duration_ms:              matchedRun.duration_ms || 0,
    regime:                   matchedRun.regime,
    total_estimated_cost_usd: matchedRun.total_estimated_cost_usd || 0,
    total_tokens:             matchedRun.total_tokens || 0,
    item_count:               matchedRun.item_count  || 0,
    llm_call_count:           matchedRun.llm_call_count || 0,
    review_reasons:           matchedRun.review_reasons || [],
    model_names:              matchedRun.model_names || [],
    llm_calls:                [], // per-call detail lives in shipments/ folder
  };

  const result = {
    shipment,
    runs:              [run],
    llm_calls:         [],
    render_paths:      [],
    total_cost_usd:    matchedRun.total_estimated_cost_usd || 0,
    total_tokens:      matchedRun.total_tokens  || 0,
    total_duration_ms: matchedRun.duration_ms   || 0,
  };

  brainCache.set(cacheKey, result);
  return result;
}

// ---------------------------------------------------------------------------
// G — Insights
// ---------------------------------------------------------------------------

export async function getInsights() {
  const cacheKey = "brain:insights";
  const cached = brainCache.get(cacheKey);
  if (cached) return cached;

  const clientBlobs = await readAllDashboardClients();

  // 1. High cost, low success
  const highCostLowSuccess = clientBlobs
    .filter((cb) => (cb.total_estimated_cost_usd || 0) > 0 && (cb.shipment_count || 0) >= 2)
    .map((cb) => {
      const total    = cb.shipment_count || 1;
      const rendered = cb.status_counts?.rendered || 0;
      return {
        client_key:     cb.client_key,
        client:         cb.client_label || cb.client_key,
        total_cost_usd: cb.total_estimated_cost_usd || 0,
        success_rate:   rendered / total,
        total,
      };
    })
    .filter((x) => x.success_rate < 0.6)
    .sort((a, b) => b.total_cost_usd - a.total_cost_usd)
    .slice(0, 10);

  // 2. High review, low fail
  const highReviewLowFail = clientBlobs
    .filter((cb) => (cb.shipment_count || 0) >= 2)
    .map((cb) => {
      const total  = cb.shipment_count || 1;
      const review = cb.status_counts?.review_required || 0;
      const failed = cb.status_counts?.failed || 0;
      return {
        client_key:  cb.client_key,
        client:      cb.client_label || cb.client_key,
        review_rate: review / total,
        fail_rate:   failed / total,
        total,
      };
    })
    .filter((x) => x.review_rate > 0.2 && x.fail_rate < 0.1)
    .sort((a, b) => b.review_rate - a.review_rate)
    .slice(0, 10);

  // 3. Most repeated review reasons
  const reviewReasonCounts = {};
  for (const cb of clientBlobs) {
    for (const [reason, count] of Object.entries(cb.review_reason_counts || {})) {
      reviewReasonCounts[reason] = (reviewReasonCounts[reason] || 0) + count;
    }
  }
  const repeatedReviewReasons = toSortedTopN(reviewReasonCounts, 10);

  // 4. Token outliers from recent_runs
  const allRuns = clientBlobs.flatMap((cb) =>
    (cb.recent_runs || []).map((r) => normalizeRun(r, cb))
  );
  const tokenCounts = allRuns.map((r) => r.total_tokens || 0).filter((t) => t > 0);
  const mean   = tokenCounts.length ? tokenCounts.reduce((s, v) => s + v, 0) / tokenCounts.length : 0;
  const stdev  = tokenCounts.length
    ? Math.sqrt(tokenCounts.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / tokenCounts.length)
    : 0;
  const threshold = mean + 2 * stdev;

  const highTokenShipments = allRuns
    .filter((r) => (r.total_tokens || 0) > threshold && threshold > 0)
    .sort((a, b) => (b.total_tokens || 0) - (a.total_tokens || 0))
    .slice(0, 10)
    .map((r) => ({
      shipment_id:    r.shipment_id,
      client_name:    r.client_name || r.client_key,
      total_tokens:   r.total_tokens,
      total_cost_usd: r.total_cost_usd,
      status:         r.status,
      created_at:     r.created_at,
    }));

  // 5. Regime cost per shipment
  const regimeCost  = {};
  const regimeCount = {};
  for (const cb of clientBlobs) {
    const perRegimeCost = cb.total_estimated_cost_usd && cb.shipment_count
      ? cb.total_estimated_cost_usd / cb.shipment_count
      : 0;
    for (const [regime, count] of Object.entries(cb.regime_counts || {})) {
      regimeCost[regime]  = (regimeCost[regime]  || 0) + perRegimeCost * count;
      regimeCount[regime] = (regimeCount[regime] || 0) + count;
    }
  }
  const regimeCostPerShipment = Object.entries(regimeCost)
    .map(([label, total]) => ({
      label,
      value: regimeCount[label] ? total / regimeCount[label] : 0,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const result = {
    high_cost_low_success:    highCostLowSuccess,
    high_review_low_fail:     highReviewLowFail,
    repeated_review_reasons:  repeatedReviewReasons,
    high_token_shipments:     highTokenShipments,
    regime_cost_per_shipment: regimeCostPerShipment,
    small_model_candidates:   [],
    token_stats: { mean: Math.round(mean), stdev: Math.round(stdev), threshold: Math.round(threshold) },
  };

  brainCache.set(cacheKey, result);
  return result;
}
