import { BlobServiceClient } from "@azure/storage-blob";
import crypto from "crypto";

const CONTAINER = "dkm-rules-engine";
let _container = null;

async function getContainer() {
  if (_container) return _container;
  const connStr =
    process.env.DKM_FINAL_STORAGE_CONNECTION_STRING ||
    process.env.AZURE_STORAGE_CONNECTION_STRING ||
    process.env.VITE_AZURE_STORAGE_CONNECTION_STRING;
  if (!connStr) throw new Error("No Azure storage connection string configured for rules engine");
  const svc = BlobServiceClient.fromConnectionString(connStr);
  _container = svc.getContainerClient(CONTAINER);
  await _container.createIfNotExists({ access: "private" });
  return _container;
}

async function readBlob(name) {
  const c = await getContainer();
  try {
    const buf = await c.getBlobClient(name).downloadToBuffer();
    return JSON.parse(buf.toString("utf-8"));
  } catch (e) {
    if (e.statusCode === 404) return null;
    throw e;
  }
}

async function writeBlob(name, data) {
  const c = await getContainer();
  const buf = Buffer.from(JSON.stringify(data, null, 2), "utf-8");
  await c.getBlockBlobClient(name).uploadData(buf, {
    blobHTTPHeaders: { blobContentType: "application/json" },
  });
}

// ─── Flows ───────────────────────────────────────────────────────────────────

export async function listFlows() {
  return (await readBlob("flows.json")) ?? [];
}

export async function getFlowById(id) {
  const flows = await listFlows();
  return flows.find((f) => f.id === id) ?? null;
}

export async function createFlow(data, by = "system") {
  const flows = await listFlows();
  const now = new Date().toISOString();
  const flow = {
    id: crypto.randomUUID(),
    name: data.name,
    description: data.description ?? "",
    is_active: data.is_active !== false,
    created_by: by, created_at: now,
    updated_by: by, updated_at: now,
  };
  flows.push(flow);
  await writeBlob("flows.json", flows);
  await appendAudit("flow", flow.id, "created", by, flow);
  return flow;
}

export async function updateFlow(id, data, by) {
  const flows = await listFlows();
  const i = flows.findIndex((f) => f.id === id);
  if (i < 0) return null;
  const updated = { ...flows[i], ...data, id, updated_by: by, updated_at: new Date().toISOString() };
  flows[i] = updated;
  await writeBlob("flows.json", flows);
  await appendAudit("flow", id, "updated", by, updated);
  return updated;
}

export async function deleteFlow(id, by) {
  const flows = await listFlows();
  const next = flows.filter((f) => f.id !== id);
  if (next.length === flows.length) return false;
  await writeBlob("flows.json", next);
  try {
    await (await getContainer()).getBlobClient(`checks/${id}.json`).deleteIfExists();
  } catch {}
  await appendAudit("flow", id, "deleted", by, { id });
  return true;
}

// ─── Checks ──────────────────────────────────────────────────────────────────

export async function listChecks(flowId) {
  return (await readBlob(`checks/${flowId}.json`)) ?? [];
}

export async function createCheck(flowId, data, by = "system") {
  const checks = await listChecks(flowId);
  const now = new Date().toISOString();
  const check = {
    id: crypto.randomUUID(),
    flow_id: flowId,
    name: data.name,
    description: data.description ?? "",
    severity: data.severity ?? "warning",
    strategy_type: data.strategy_type,
    config: data.config ?? {},
    warning_message: data.warning_message ?? "",
    is_active: data.is_active !== false,
    order_index: data.order_index ?? checks.length,
    created_by: by, created_at: now,
    updated_by: by, updated_at: now,
  };
  checks.push(check);
  checks.sort((a, b) => a.order_index - b.order_index);
  await writeBlob(`checks/${flowId}.json`, checks);
  await appendAudit("check", check.id, "created", by, check);
  return check;
}

export async function updateCheck(checkId, data, by) {
  const flows = await listFlows();
  for (const flow of flows) {
    const checks = await listChecks(flow.id);
    const i = checks.findIndex((c) => c.id === checkId);
    if (i >= 0) {
      const updated = { ...checks[i], ...data, id: checkId, flow_id: flow.id, updated_by: by, updated_at: new Date().toISOString() };
      checks[i] = updated;
      checks.sort((a, b) => a.order_index - b.order_index);
      await writeBlob(`checks/${flow.id}.json`, checks);
      await appendAudit("check", checkId, "updated", by, updated);
      return updated;
    }
  }
  return null;
}

export async function deleteCheck(checkId, by) {
  const flows = await listFlows();
  for (const flow of flows) {
    const checks = await listChecks(flow.id);
    const i = checks.findIndex((c) => c.id === checkId);
    if (i >= 0) {
      const removed = checks.splice(i, 1)[0];
      await writeBlob(`checks/${flow.id}.json`, checks);
      await appendAudit("check", checkId, "deleted", by, removed);
      return true;
    }
  }
  return false;
}

// ─── Audit ───────────────────────────────────────────────────────────────────

async function appendAudit(entityType, entityId, action, by, snapshot) {
  const log = (await readBlob("audit.json")) ?? [];
  log.push({
    id: crypto.randomUUID(),
    entity_type: entityType,
    entity_id: entityId,
    action,
    performed_by: by,
    performed_at: new Date().toISOString(),
    snapshot,
  });
  if (log.length > 500) log.splice(0, log.length - 500);
  await writeBlob("audit.json", log);
}

export async function listAudit({ entity_type, entity_id } = {}) {
  let log = (await readBlob("audit.json")) ?? [];
  if (entity_type) log = log.filter((e) => e.entity_type === entity_type);
  if (entity_id) log = log.filter((e) => e.entity_id === entity_id);
  return [...log].reverse();
}

// ─── Demo seed ───────────────────────────────────────────────────────────────

export async function seedIfEmpty() {
  const existing = await listFlows();
  if (existing.length > 0) return;
  console.log("[rules-engine] Seeding demo data...");

  const f1 = await createFlow({ name: "4200 Import", description: "Full validation pipeline for 4200 fiscal import declarations" }, "system");
  await createCheck(f1.id, { name: "EXW Transport Cost Alert", description: "Fires when Incoterm is EXW — transport costs may need to be added to customs value", severity: "warning", strategy_type: "condition", config: { logic: "AND", conditions: [{ field: "declaration.DELIVERYTERMSCODE", operator: "equals", value: "EXW", scope: "header" }] }, warning_message: "Incoterm EXW detected — verify transport costs are included in customs value", order_index: 0 }, "system");
  await createCheck(f1.id, { name: "Procedure 42 — VAT Review", description: "Flags items with procedure code 42 for mandatory VAT check", severity: "warning", strategy_type: "condition", config: { logic: "AND", conditions: [{ field: "item.PROCEDURECURRENT", operator: "equals", value: "42", scope: "item", itemMatch: "any" }] }, warning_message: "Procedure 42 found — confirm fiscal representative and VAT handling", order_index: 1 }, "system");
  await createCheck(f1.id, { name: "HS Code vs Description (AI)", description: "AI verifies goods descriptions are consistent with declared HS codes", severity: "warning", strategy_type: "ai_prompt", config: { prompt_template: "You are an EU customs expert. Answer only YES or NO followed by one sentence.\n\nQuestion: {{question}}\n\nDeclaration data:\n{{declaration_summary}}", question: "Do the goods descriptions logically match their declared HS codes for all items?", fields_to_include: ["items.item.COMMODITYCODE", "items.item.GOODSDESCRIPTION"] }, warning_message: "AI detected a potential mismatch between goods description and HS code", order_index: 2 }, "system");
  await createCheck(f1.id, { name: "Invoice Amount Completeness", description: "Both total invoice amount and currency must be present", severity: "warning", strategy_type: "condition", config: { logic: "AND", conditions: [{ field: "declaration.TOTALINVOICEAMOUNT", operator: "isNotEmpty", scope: "header" }, { field: "declaration.TOTALINVOICEAMOUNTCURRENCY", operator: "isNotEmpty", scope: "header" }] }, warning_message: "Invoice amount or currency is missing — declaration may be incomplete", order_index: 3 }, "system");
  await createCheck(f1.id, { name: "Quota Alert (DB Lookup)", description: "Checks commodity codes against active quota alert table", severity: "info", strategy_type: "db_lookup", config: { lookup_table: "quota_alerts", match_field: "item.COMMODITYCODE", lookup_key: "hs_code", condition: "exists" }, warning_message: "One or more HS codes are under active quota — verify entitlement", order_index: 4 }, "system");

  const f2 = await createFlow({ name: "NCTS Transit", description: "Pre-submission validation for NCTS T1/T2 transit declarations" }, "system");
  await createCheck(f2.id, { name: "Mass Fields Present", description: "Both gross and net mass must be declared", severity: "warning", strategy_type: "condition", config: { logic: "AND", conditions: [{ field: "declaration.TOTALGROSSMASS", operator: "isNotEmpty", scope: "header" }, { field: "declaration.CONTROLNETMASS", operator: "isNotEmpty", scope: "header" }] }, warning_message: "Gross or net mass is missing from the declaration", order_index: 0 }, "system");
  await createCheck(f2.id, { name: "MRN Issued Check", description: "MRN must be present — confirms acceptance by customs", severity: "warning", strategy_type: "condition", config: { logic: "AND", conditions: [{ field: "declaration.MRN", operator: "isNotEmpty", scope: "header" }] }, warning_message: "MRN not yet issued — declaration may not be accepted by customs", order_index: 1 }, "system");
  await createCheck(f2.id, { name: "Duplicate Invoice Detection", description: "Cross-checks for duplicate commercial reference numbers", severity: "warning", strategy_type: "cross_declaration", config: { check_type: "duplicate_invoice", fields: ["declaration.COMMERCIALREFERENCE", "declaration.DECLARANTCODE"] }, warning_message: "Potential duplicate invoice reference detected in recent declarations", order_index: 2 }, "system");

  const f3 = await createFlow({ name: "Export EX1", description: "Pre-submission checks for EX1 standard export declarations" }, "system");
  await createCheck(f3.id, { name: "Origin Country on All Items", description: "Every item must have an origin country declared", severity: "warning", strategy_type: "condition", config: { logic: "AND", conditions: [{ field: "item.ORIGINCOUNTRY", operator: "isNotEmpty", scope: "item", itemMatch: "any" }] }, warning_message: "One or more items are missing origin country declaration", order_index: 0 }, "system");
  await createCheck(f3.id, { name: "TARIC HS Code Validation", description: "Validates HS codes against the TARIC database", severity: "warning", strategy_type: "external_api", config: { api: "taric", endpoint: "validate_hs_code", field: "item.COMMODITYCODE" }, warning_message: "HS code could not be validated against TARIC — may be invalid or expired", order_index: 1 }, "system");
  await createCheck(f3.id, { name: "Statistical Value Review (AI)", description: "AI checks statistical value consistency across all items", severity: "info", strategy_type: "ai_prompt", config: { prompt_template: "You are an EU customs expert. Answer only YES or NO followed by one sentence.\n\nQuestion: {{question}}\n\nDeclaration data:\n{{declaration_summary}}", question: "Are the statistical values consistent with the invoice amounts across all items?", fields_to_include: ["items.item.STATISTICALVALUE", "items.item.INVOICEAMOUNT", "items.item.CUSTOMSVALUEAMOUNT"] }, warning_message: "Statistical value inconsistency detected across items", order_index: 2 }, "system");

  console.log("[rules-engine] Demo seed complete: 3 flows, 11 checks.");
}
