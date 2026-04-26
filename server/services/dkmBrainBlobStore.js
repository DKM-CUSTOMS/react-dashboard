import { BlobServiceClient } from "@azure/storage-blob";
import { Cache } from "../utils/cache.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const getContainerName = () =>
  process.env.DKM_FINAL_STORAGE_CONTAINER || "dkm-brain-final";

function getBrainBlobClient() {
  // Priority: dedicated brain key → shared storage key → legacy VITE_ key
  const connStr =
    process.env.DKM_FINAL_STORAGE_CONNECTION_STRING ||
    process.env.AZURE_STORAGE_CONNECTION_STRING ||
    process.env.VITE_AZURE_STORAGE_CONNECTION_STRING;
  if (!connStr) {
    throw new Error(
      "Missing AZURE_STORAGE_CONNECTION_STRING (or DKM_FINAL_STORAGE_CONNECTION_STRING)"
    );
  }
  return BlobServiceClient.fromConnectionString(connStr);
}

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------

export const brainCache = new Cache(300);       // 5 min for aggregated data
const blobItemCache = new Cache(600);           // 10 min for individual blobs

// ---------------------------------------------------------------------------
// Core primitives
// ---------------------------------------------------------------------------

async function readBlob(blobPath) {
  const cacheKey = `blob:${blobPath}`;
  const cached = blobItemCache.get(cacheKey);
  if (cached !== undefined && cached !== null) return cached;

  try {
    const client = getBrainBlobClient();
    const container = client.getContainerClient(getContainerName());
    const blockBlob = container.getBlockBlobClient(blobPath);
    const buffer = await blockBlob.downloadToBuffer();
    const parsed = JSON.parse(buffer.toString("utf8"));
    blobItemCache.set(cacheKey, parsed);
    return parsed;
  } catch (err) {
    if (
      err.statusCode === 404 ||
      err.code === "BlobNotFound" ||
      err.message?.includes("BlobNotFound")
    ) {
      blobItemCache.set(cacheKey, null);
      return null;
    }
    console.warn(`[dkmBrain] blob read error (${blobPath}): ${err.message}`);
    return null;
  }
}

async function writeBlob(blobPath, data) {
  const cacheKey = `blob:${blobPath}`;
  try {
    const client = getBrainBlobClient();
    const container = client.getContainerClient(getContainerName());
    const blockBlob = container.getBlockBlobClient(blobPath);
    
    // Stringify and upload
    const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    await blockBlob.upload(content, Buffer.byteLength(content), {
      blobHTTPHeaders: { blobContentType: 'application/json' }
    });
    
    // Update local cache
    blobItemCache.set(cacheKey, typeof data === 'string' ? JSON.parse(data) : data);
    return true;
  } catch (err) {
    console.error(`[dkmBrain] blob write error (${blobPath}):`, err);
    throw err;
  }
}

async function listBlobsFlat(prefix) {
  try {
    const client = getBrainBlobClient();
    const container = client.getContainerClient(getContainerName());
    const names = [];
    for await (const blob of container.listBlobsFlat({ prefix })) {
      names.push(blob.name);
    }
    return names;
  } catch (err) {
    console.warn(`[dkmBrain] list error (${prefix}): ${err.message}`);
    return [];
  }
}

async function listVirtualDirs(prefix) {
  try {
    const client = getBrainBlobClient();
    const container = client.getContainerClient(getContainerName());
    const dirs = [];
    for await (const item of container.listBlobsByHierarchy("/", { prefix })) {
      if (item.kind === "prefix") dirs.push(item.name);
    }
    return dirs;
  } catch (err) {
    console.warn(`[dkmBrain] hierarchy error (${prefix}): ${err.message}`);
    return [];
  }
}

async function readBlobsBatch(paths, concurrency = 20) {
  const results = [];
  for (let i = 0; i < paths.length; i += concurrency) {
    const chunk = paths.slice(i, i + concurrency);
    const chunkResults = await Promise.all(chunk.map(readBlob));
    results.push(...chunkResults);
  }
  return results.filter(Boolean);
}

// ---------------------------------------------------------------------------
// Dashboard pre-computed blobs (cheapest path)
// ---------------------------------------------------------------------------

export async function readDashboardOverview() {
  return readBlob("dashboard/overview.json");
}

export async function readDashboardClient(clientKey) {
  return readBlob(`dashboard/clients/${clientKey}.json`);
}

export async function readAllDashboardClients() {
  const cacheKey = "brain:all_dashboard_clients";
  const cached = brainCache.get(cacheKey);
  if (cached) return cached;

  const paths = await listBlobsFlat("dashboard/clients/");
  const blobs = await readBlobsBatch(paths.filter((p) => p.endsWith(".json")));
  brainCache.set(cacheKey, blobs);
  return blobs;
}

export async function readClientRulesIndex() {
  return readBlob("dashboard/clients_rules/index.json");
}

export async function readClientRulesTemplate() {
  return readBlob("dashboard/clients_rules/template.json");
}

export async function readClientRule(clientKey) {
  return readBlob(`dashboard/clients_rules/${clientKey}.json`);
}

export async function writeClientRule(clientKey, payload) {
  return writeBlob(`dashboard/clients_rules/${clientKey}.json`, payload);
}

// ---------------------------------------------------------------------------
// Client paths
// ---------------------------------------------------------------------------

export async function listClientKeys() {
  const cacheKey = "brain:client_keys";
  const cached = brainCache.get(cacheKey);
  if (cached) return cached;

  const dirs = await listVirtualDirs("clients/");
  const keys = dirs.map((d) => d.replace("clients/", "").replace("/", ""));
  brainCache.set(cacheKey, keys);
  return keys;
}

export async function readClientProfile(clientKey) {
  const [client, summary] = await Promise.all([
    readBlob(`clients/${clientKey}/client.json`),
    readBlob(`clients/${clientKey}/summary.json`),
  ]);
  return { client, summary };
}

export async function readClientRunBlobs(clientKey) {
  const paths = await listBlobsFlat(`clients/${clientKey}/runs/`);
  return readBlobsBatch(paths.filter((p) => p.endsWith(".json")));
}

export async function readClientShipmentBlobs(clientKey) {
  const cacheKey = `brain:client_shipments:${clientKey}`;
  const cached = brainCache.get(cacheKey);
  if (cached) return cached;

  const paths = await listBlobsFlat(`clients/${clientKey}/shipments/`);
  const blobs = await readBlobsBatch(paths.filter((p) => p.endsWith(".json")));
  brainCache.set(cacheKey, blobs);
  return blobs;
}

// ---------------------------------------------------------------------------
// Shipment paths
// ---------------------------------------------------------------------------

export async function listShipmentIds() {
  const cacheKey = "brain:shipment_ids";
  const cached = brainCache.get(cacheKey);
  if (cached) return cached;

  const dirs = await listVirtualDirs("shipments/");
  const ids = dirs.map((d) => d.replace("shipments/", "").replace("/", ""));
  brainCache.set(cacheKey, ids);
  return ids;
}

export async function readShipmentRoot(shipmentId) {
  return readBlob(`shipments/${shipmentId}/shipment.json`);
}

export async function readShipmentRuns(shipmentId) {
  const paths = await listBlobsFlat(`shipments/${shipmentId}/runs/`);
  return readBlobsBatch(paths.filter((p) => p.endsWith(".json")));
}

export async function readShipmentLlmCalls(shipmentId, runId) {
  const prefix = runId
    ? `shipments/${shipmentId}/llm_calls/${runId}/`
    : `shipments/${shipmentId}/llm_calls/`;
  const paths = await listBlobsFlat(prefix);
  return readBlobsBatch(paths.filter((p) => p.endsWith(".json")));
}

export async function readShipmentTrace(shipmentId, runId) {
  return readBlob(`shipments/${shipmentId}/traces/${runId}.json`);
}

export async function readShipmentRequest(shipmentId, runId) {
  return readBlob(`shipments/${shipmentId}/requests/${runId}.json`);
}

export async function readShipmentRenders(shipmentId, runId) {
  const prefix = runId
    ? `shipments/${shipmentId}/renders/${runId}/`
    : `shipments/${shipmentId}/renders/`;
  return listBlobsFlat(prefix);
}

// ---------------------------------------------------------------------------
// Bulk read: all client shipment blobs across all clients
// Used as the primary data source for the overview and operations pages
// ---------------------------------------------------------------------------

export async function readAllClientShipments({ maxClients = 200, maxPerClient = 500 } = {}) {
  const cacheKey = `brain:all_client_shipments:${maxClients}:${maxPerClient}`;
  const cached = brainCache.get(cacheKey);
  if (cached) return cached;

  const clientKeys = await listClientKeys();
  const allShipments = [];

  for (const clientKey of clientKeys.slice(0, maxClients)) {
    try {
      const shipments = await readClientShipmentBlobs(clientKey);
      allShipments.push(...shipments.slice(0, maxPerClient));
    } catch (err) {
      console.warn(`[dkmBrain] skip client ${clientKey}: ${err.message}`);
    }
  }

  brainCache.set(cacheKey, allShipments);
  return allShipments;
}

export { readBlob, readBlobsBatch };
