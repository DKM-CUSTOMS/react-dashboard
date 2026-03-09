import { BlobServiceClient } from "@azure/storage-blob";
import { monitoringCache } from "../utils/cache.js";

const CONTAINER_NAME = "document-intelligence";

function getBlobServiceClient() {
  const connStr = process.env.VITE_AZURE_STORAGE_CONNECTION_STRING;
  if (!connStr) {
    throw new Error("Missing VITE_AZURE_STORAGE_CONNECTION_STRING environment variable");
  }
  return BlobServiceClient.fromConnectionString(connStr);
}

function getPrefixesForLastNDays(appName, days) {
  const prefixes = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const yyyy = d.getUTCFullYear().toString();
    const MM = (d.getUTCMonth() + 1).toString().padStart(2, "0");
    const dd = d.getUTCDate().toString().padStart(2, "0");
    prefixes.push(`monitoring/runs/${appName}/${yyyy}/${MM}/${dd}/`);
  }
  return prefixes;
}

async function listLogicAppNames() {
  const client = getBlobServiceClient();
  const containerClient = client.getContainerClient(CONTAINER_NAME);
  const iter = containerClient.listBlobsByHierarchy("/", { prefix: "monitoring/runs/" });
  const apps = [];
  for await (const item of iter) {
    if (item.kind === "prefix") {
      const parts = item.name.split("/");
      if (parts.length >= 3 && parts[2]) {
        apps.push(parts[2]);
      }
    }
  }
  return apps;
}

async function fetchRunsList(appName, days) {
  const cacheKey = `runs_list_${appName}_${days}`;
  const cached = monitoringCache.get(cacheKey);
  if (cached) return cached;

  const client = getBlobServiceClient();
  const containerClient = client.getContainerClient(CONTAINER_NAME);
  const prefixes = getPrefixesForLastNDays(appName, days);

  const blobPaths = [];
  for (const prefix of prefixes) {
    for await (const blob of containerClient.listBlobsFlat({ prefix })) {
      if (blob.name.endsWith(".json")) {
        blobPaths.push(blob.name);
      }
    }
  }

  const allRuns = [];
  const chunkSize = 50;
  for (let i = 0; i < blobPaths.length; i += chunkSize) {
    const chunk = blobPaths.slice(i, i + chunkSize);
    const results = await Promise.all(
      chunk.map(async (blobPath) => {
        try {
          const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
          const buffer = await blockBlobClient.downloadToBuffer();
          return JSON.parse(buffer.toString("utf8"));
        } catch (err) {
          console.error(`Error downloading blob ${blobPath}:`, err);
          return null;
        }
      })
    );
    for (const res of results) {
      if (res) allRuns.push(res);
    }
  }

  const sorted = allRuns.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
  monitoringCache.set(cacheKey, sorted);
  return sorted;
}

/**
 * Fetch ALL runs across ALL pipelines in one call.
 * Returns { runs: [...], pipelines: [...], stats: {...} }
 */
async function fetchAllRuns(days) {
  const cacheKey = `all_runs_${days}`;
  const cached = monitoringCache.get(cacheKey);
  if (cached) return cached;

  const apps = await listLogicAppNames();
  if (!apps.length) {
    const empty = { runs: [], pipelines: [], stats: { total: 0, success: 0, warning: 0, failed: 0 } };
    monitoringCache.set(cacheKey, empty);
    return empty;
  }

  // Fetch runs for all apps in parallel
  const allRunsByApp = await Promise.all(
    apps.map(async (appName) => {
      try {
        return await fetchRunsList(appName, days);
      } catch (e) {
        console.error(`Error fetching runs for ${appName}:`, e);
        return [];
      }
    })
  );

  const allRuns = allRunsByApp.flat().sort(
    (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
  );

  // Flatten warning_count into each run
  const enrichedRuns = allRuns.map(r => ({
    ...r,
    warning_count: r.warnings_summary?.warning_count || 0,
    warnings: r.warnings_summary?.warnings || [],
    warning_aggregations: r.warnings_summary?.aggregations || {},
  }));

  // Compute per-pipeline stats
  const pipelineMap = {};
  for (const run of enrichedRuns) {
    const name = run.logic_app_name;
    if (!pipelineMap[name]) {
      pipelineMap[name] = { logic_app_name: name, total: 0, success: 0, warning: 0, failed: 0, last_run_time: '' };
    }
    const p = pipelineMap[name];
    p.total++;
    if (run.status === 'success') p.success++;
    else if (run.status === 'warning') p.warning++;
    else if (run.status === 'failed') p.failed++;
    if (!p.last_run_time || new Date(run.start_time) > new Date(p.last_run_time)) {
      p.last_run_time = run.start_time;
    }
  }

  const pipelines = Object.values(pipelineMap).map(p => ({
    ...p,
    success_rate: p.total > 0 ? p.success / p.total : 0,
  }));

  // Global stats
  const stats = {
    total: enrichedRuns.length,
    success: enrichedRuns.filter(r => r.status === 'success').length,
    warning: enrichedRuns.filter(r => r.status === 'warning').length,
    failed: enrichedRuns.filter(r => r.status === 'failed').length,
  };

  const result = { runs: enrichedRuns, pipelines, stats };
  monitoringCache.set(cacheKey, result);
  return result;
}

async function fetchAggregatedPipelines(days) {
  const { pipelines } = await fetchAllRuns(days);
  return pipelines;
}

async function fetchSingleRunDetails(appName, date, runId) {
  const cacheKey = `run_details_${appName}_${date}_${runId}`;
  const cached = monitoringCache.get(cacheKey);
  if (cached) return cached;

  const [yyyy, MM, dd] = date.split("-");
  const blobPath = `monitoring/runs/${appName}/${yyyy}/${MM}/${dd}/${runId}.json`;
  const client = getBlobServiceClient();
  const containerClient = client.getContainerClient(CONTAINER_NAME);
  const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
  try {
    const buffer = await blockBlobClient.downloadToBuffer();
    const result = JSON.parse(buffer.toString("utf8"));
    monitoringCache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.error(`Error downloading specific run blob ${blobPath}:`, err);
    throw err;
  }
}

export {
  fetchAggregatedPipelines,
  fetchAllRuns,
  fetchRunsList,
  fetchSingleRunDetails,
  getBlobServiceClient
};
