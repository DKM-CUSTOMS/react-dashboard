import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

import { BlobServiceClient } from '@azure/storage-blob';
import mysql from 'mysql2/promise';
import syncRoutes from './server/routes/sync.js';
import declarationRoutes from './server/routes/declarations.js';
import teamRoutes from './server/routes/teams.js';
import monitoringRoutes from './server/routes/monitoring.js';
import hrAiRoutes from './server/routes/hrAi.js';
import customsAiRoutes from './server/routes/customsAi.js';
import customInstructionsRoutes from './server/routes/customInstructions.js';
import userRolesRoutes from './server/routes/userRoles.js';
import { hydrateAzureCache } from './server/services/hrAiTools.js';

// Load environment variables from .env file natively (Node.js 21.7.0+)
try {
  process.loadEnvFile();
  console.log('Environment variables loaded from .env');
} catch (e) {
  // .env file might not exist in production
  console.log('No .env file found, using system environment variables');
}



// Fix __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'dist')));

const warnedLegacyEnv = new Set();
function readEnv(name, options = {}) {
  const {
    fallbacks = [],
    required = false,
    defaultValue = '',
  } = options;

  const value = process.env[name];
  if (value != null && String(value).trim() !== '') return value;

  for (const fallback of fallbacks) {
    const fallbackValue = process.env[fallback];
    if (fallbackValue != null && String(fallbackValue).trim() !== '') {
      const warningKey = `${name}<-${fallback}`;
      if (!warnedLegacyEnv.has(warningKey)) {
        warnedLegacyEnv.add(warningKey);
        console.warn(`[env] Using legacy ${fallback} for ${name}. Please migrate to ${name}.`);
      }
      return fallbackValue;
    }
  }

  if (required) {
    throw new Error(`${name} is not configured`);
  }

  return defaultValue;
}

// Path to JSON store
const DATA_FILE = path.join(__dirname, 'tracking-data.json');

// Helper to read data
const readData = () => {
  if (!fs.existsSync(DATA_FILE)) {
    return { records: [] };
  }
  const data = fs.readFileSync(DATA_FILE, 'utf8');
  return JSON.parse(data);
};

// Helper to write data
const writeData = (data) => {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
};

// API Routes
app.get('/api/tracking', (req, res) => {
  const data = readData();
  res.json({ records: data.records });
});

app.get('/api/tracking/:mrn', (req, res) => {
  const { mrn } = req.params;
  const data = readData();
  const record = data.records.find(r => r.MRN === mrn);
  res.json({ tracking_records: record ? record.tracking_records : [] });
});

app.post('/api/tracking', (req, res) => {
  const { mrn, tracking_data } = req.body;

  if (!mrn || !tracking_data) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const data = readData();
  let record = data.records.find(r => r.MRN === mrn);

  if (!record) {
    record = { MRN: mrn, tracking_records: [] };
    data.records.push(record);
  }

  record.tracking_records.unshift(tracking_data); // Add new record at start
  writeData(data);

  res.json({ success: true, message: 'Tracking recorded' });
});

app.post('/api/tracking/bulk', (req, res) => {
  const { records } = req.body; // Array of { mrn, tracking_data }

  if (!records || !Array.isArray(records)) {
    return res.status(400).json({ error: 'Invalid input containing records array' });
  }

  const data = readData();
  let updateCount = 0;

  records.forEach(({ mrn, tracking_data }) => {
    let record = data.records.find(r => r.MRN === mrn);
    if (!record) {
      record = { MRN: mrn, tracking_records: [] };
      data.records.push(record);
    }
    // Add new record at start
    record.tracking_records.unshift(tracking_data);
    updateCount++;
  });

  writeData(data);
  res.json({ success: true, message: `${updateCount} records updated successfully` });
});

// ============================================================
// Fiscal Representation - Azure Blob Storage CRUD for Principals
// ============================================================
const FISCAL_CONTAINER = "document-intelligence";
const FISCAL_BLOB_PATH = "FiscalRepresentationWebApp/principals.json";
const FISCAL_FILTERS_BLOB_PATH = "FiscalRepresentationWebApp/filters.json";

// Helper: get blob client
const getFiscalBlobClient = (blobPath = FISCAL_BLOB_PATH) => {
  const connectionString = readEnv('AZURE_STORAGE_CONNECTION_STRING', {
    fallbacks: ['VITE_AZURE_STORAGE_CONNECTION_STRING'],
    required: true,
  });
  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient(FISCAL_CONTAINER);
  return containerClient.getBlockBlobClient(blobPath);
};

// Helper: read principals from blob
const readPrincipals = async () => {
  try {
    const blobClient = getFiscalBlobClient(FISCAL_BLOB_PATH);
    const downloadResponse = await blobClient.download(0);
    const chunks = [];
    for await (const chunk of downloadResponse.readableStreamBody) {
      chunks.push(chunk);
    }
    const content = Buffer.concat(chunks).toString('utf8');
    const data = JSON.parse(content);
    return data.principals || [];
  } catch (err) {
    if (err.statusCode === 404) {
      return [];
    }
    throw err;
  }
};

// Helper: write principals to blob
const writePrincipals = async (principals) => {
  const blobClient = getFiscalBlobClient(FISCAL_BLOB_PATH);
  const content = JSON.stringify({ principals }, null, 2);
  await blobClient.upload(content, content.length, {
    overwrite: true,
    blobHTTPHeaders: { blobContentType: 'application/json' },
  });
};

// GET - List all principals
app.get('/api/fiscal/principals', async (req, res) => {
  try {
    const principals = await readPrincipals();
    res.json({ principals });
  } catch (err) {
    console.error('Error reading principals:', err);
    res.status(500).json({ error: 'Failed to read principals' });
  }
});

// POST - Add a principal
app.post('/api/fiscal/principals', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Principal name is required' });
    }

    const principals = await readPrincipals();
    const trimmed = name.trim();

    if (principals.some(p => p.toLowerCase() === trimmed.toLowerCase())) {
      return res.status(409).json({ error: 'Principal already exists' });
    }

    principals.push(trimmed);
    principals.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    await writePrincipals(principals);

    res.json({ success: true, message: `"${trimmed}" added`, principals });
  } catch (err) {
    console.error('Error adding principal:', err);
    res.status(500).json({ error: 'Failed to add principal' });
  }
});

// PUT - Update a principal
app.put('/api/fiscal/principals', async (req, res) => {
  try {
    const { oldName, newName } = req.body;
    if (!oldName || !newName || !newName.trim()) {
      return res.status(400).json({ error: 'Both oldName and newName are required' });
    }

    const principals = await readPrincipals();
    const index = principals.findIndex(p => p === oldName);

    if (index === -1) {
      return res.status(404).json({ error: 'Principal not found' });
    }

    const trimmed = newName.trim();
    if (principals.some(p => p.toLowerCase() === trimmed.toLowerCase() && p !== oldName)) {
      return res.status(409).json({ error: 'A principal with this name already exists' });
    }

    principals[index] = trimmed;
    principals.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    await writePrincipals(principals);

    res.json({ success: true, message: `"${oldName}" renamed to "${trimmed}"`, principals });
  } catch (err) {
    console.error('Error updating principal:', err);
    res.status(500).json({ error: 'Failed to update principal' });
  }
});

// DELETE - Remove a principal
app.delete('/api/fiscal/principals', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Principal name is required' });
    }

    const principals = await readPrincipals();
    const index = principals.findIndex(p => p === name);

    if (index === -1) {
      return res.status(404).json({ error: 'Principal not found' });
    }

    principals.splice(index, 1);
    await writePrincipals(principals);

    res.json({ success: true, message: `"${name}" removed`, principals });
  } catch (err) {
    console.error('Error deleting principal:', err);
    res.status(500).json({ error: 'Failed to delete principal' });
  }
});

// ============================================================
// Fiscal Representation - Bestming Filters
// ============================================================
const readFilters = async () => {
  try {
    const blobClient = getFiscalBlobClient(FISCAL_FILTERS_BLOB_PATH);
    const downloadResponse = await blobClient.download(0);
    const chunks = [];
    for await (const chunk of downloadResponse.readableStreamBody) {
      chunks.push(chunk);
    }
    const content = Buffer.concat(chunks).toString('utf8');
    const data = JSON.parse(content);
    return data.filters || [];
  } catch (err) {
    if (err.statusCode === 404) {
      return [];
    }
    throw err;
  }
};

const writeFilters = async (filters) => {
  const blobClient = getFiscalBlobClient(FISCAL_FILTERS_BLOB_PATH);
  const content = JSON.stringify({ filters }, null, 2);
  await blobClient.upload(content, content.length, {
    overwrite: true,
    blobHTTPHeaders: { blobContentType: 'application/json' },
  });
};

app.get('/api/fiscal/filters', async (req, res) => {
  try {
    const filters = await readFilters();
    res.json({ filters });
  } catch (err) {
    console.error('Error reading filters:', err);
    res.status(500).json({ error: 'Failed to read filters' });
  }
});

app.post('/api/fiscal/filters', async (req, res) => {
  try {
    const { filters } = req.body;
    if (!Array.isArray(filters)) {
      return res.status(400).json({ error: 'Filters format invalid.' });
    }
    await writeFilters(filters);
    res.json({ success: true, filters });
  } catch (err) {
    console.error('Error saving filters:', err);
    res.status(500).json({ error: 'Failed to save filters' });
  }
});

// POST - Request Logic App generation 
app.post('/api/fiscal/generate-documents', async (req, res) => {
  const url = process.env.LOGIC_APP_DEBENOTE_URL;
  if (!url) {
    return res.status(500).json({ error: 'Logic App URL not configured in environment' });
  }

  try {
    // Forward the POST request to the Logic App URL
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({
        status: data.status || 'error',
        message: data.message || `Logic App request failed with status ${response.status}`
      });
    }

    res.json(data);
  } catch (err) {
    console.error('Error calling logic app:', err);
    res.status(500).json({ error: 'Failed to connect to Logic App' });
  }
});

// GET - BestMing docs from Logic App (proxy — keeps SAS URL server-side)
app.get('/api/fiscal/bestming-docs', async (_req, res) => {
  const url = process.env.LOGIC_APP_BESTMING_URL;
  if (!url) {
    return res.status(500).json({ error: 'LOGIC_APP_BESTMING_URL not configured in environment' });
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: `Logic App returned status ${response.status}`,
      });
    }

    const data = await response.json();
    // Logic App returns either an array or { Table1: [...] }
    let rows = Array.isArray(data) ? data : (data.Table1 ?? []);
    
    // Apply filters
    try {
      const filters = await readFilters();
      filters.filter(f => f.active).forEach(filter => {
        const { field, operator, value } = filter;
        rows = rows.filter(row => {
            const rowVal = String(row[field] || '').toLowerCase();
            const filterVal = String(value || '').toLowerCase();
            switch (operator) {
                case 'equals': return rowVal === filterVal;
                case 'not_equals': return rowVal !== filterVal;
                case 'contains': return rowVal.includes(filterVal);
                case 'not_contains': return !rowVal.includes(filterVal);
                default: return true;
            }
        });
      });
    } catch (err) {
        console.error('[bestming-docs] Error applying filters:', err);
    }
    
    res.json(rows);
  } catch (err) {
    console.error('[bestming-docs] Error calling Logic App:', err);
    res.status(500).json({ error: 'Failed to connect to Logic App' });
  }
});

// ============================================================
// Fiscal Representation - BestMing DocuSign (Secure Proxy + Cache)
// ============================================================
const DOCUSIGN_PROCESSOR_URL =
  readEnv('DOCUSIGN_PROCESSOR_URL', {
    fallbacks: ['AZURE_DOCUSIGN_PROCESSOR_URL'],
  }) ||
  (() => {
    const legacyBaseUrl = readEnv('LEGACY_DOCUSIGN_PROCESSOR_BASE_URL', {
      fallbacks: ['VITE_API_BASE_URL'],
    });
    if (!legacyBaseUrl) return '';
    return `${legacyBaseUrl.replace(/\/+$/, '')}/api/DocuSignProcessor`;
  })();
const DOCUSIGN_PROCESSOR_CODE =
  readEnv('DOCUSIGN_PROCESSOR_CODE', {
    fallbacks: ['DOCUSIGN_FUNCTION_CODE', 'VITE_API_CODE'],
    defaultValue: '',
  });

const PRECHECK_ITEM_TTL_MS = Number(process.env.BESTMING_PRECHECK_ITEM_TTL_MS || 10 * 60 * 1000);
const PRECHECK_MAX_CACHE_ITEMS = Number(process.env.BESTMING_PRECHECK_MAX_CACHE_ITEMS || 10000);
const PRECHECK_BATCH_SIZE = Math.max(1, Number(process.env.BESTMING_PRECHECK_BATCH_SIZE || 200));
const precheckCache = new Map();

function precheckKey(declarationId, processfactuurnummer) {
  return `${declarationId || ''}|${processfactuurnummer || ''}`;
}

function getCachedPrecheckResult(key) {
  const cached = precheckCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt < Date.now()) {
    precheckCache.delete(key);
    return null;
  }
  return cached.value;
}

function setCachedPrecheckResult(key, value) {
  if (precheckCache.size >= PRECHECK_MAX_CACHE_ITEMS) {
    const oldestKey = precheckCache.keys().next().value;
    if (oldestKey) precheckCache.delete(oldestKey);
  }
  precheckCache.set(key, {
    value,
    expiresAt: Date.now() + PRECHECK_ITEM_TTL_MS,
  });
}

function buildDocuSignProcessorUrl() {
  if (!DOCUSIGN_PROCESSOR_URL) {
    throw new Error('DOCUSIGN_PROCESSOR_URL is not configured');
  }

  const base = DOCUSIGN_PROCESSOR_URL.trim();
  if (!DOCUSIGN_PROCESSOR_CODE) return base;
  if (base.includes('code=')) return base;
  return `${base}${base.includes('?') ? '&' : '?'}code=${encodeURIComponent(DOCUSIGN_PROCESSOR_CODE)}`;
}

async function callDocuSignProcessor(payload) {
  const url = buildDocuSignProcessorUrl();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = data.error || data.message || `DocuSignProcessor returned status ${response.status}`;
    const err = new Error(msg);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  return data;
}

async function runBestmingPrecheck(items, options = {}) {
  const forceFresh = options?.forceFresh === true;
  const normalizedItems = items
    .map((item) => ({
      declaration_id: item?.declaration_id,
      processfactuurnummer: item?.processfactuurnummer,
    }))
    .filter((item) => item.declaration_id != null || item.processfactuurnummer != null);

  const uniqueItemsByKey = new Map();
  for (const item of normalizedItems) {
    const key = precheckKey(item.declaration_id, item.processfactuurnummer);
    if (!uniqueItemsByKey.has(key)) uniqueItemsByKey.set(key, item);
  }

  const orderedKeys = [...uniqueItemsByKey.keys()];
  const resultsByKey = new Map();
  const pending = [];

  for (const key of orderedKeys) {
    const item = uniqueItemsByKey.get(key);
    const cached = forceFresh ? null : getCachedPrecheckResult(key);
    if (cached) {
      resultsByKey.set(key, cached);
    } else {
      pending.push(item);
    }
  }

  for (let i = 0; i < pending.length; i += PRECHECK_BATCH_SIZE) {
    const batch = pending.slice(i, i + PRECHECK_BATCH_SIZE);
    const response = await callDocuSignProcessor({
      operation: 'precheck',
      items: batch,
    });

    const remoteResults = Array.isArray(response.results) ? response.results : [];
    for (const entry of remoteResults) {
      const normalizedEntry = { ...entry };
      const hasBlobPath = typeof normalizedEntry.blob_path === 'string' && normalizedEntry.blob_path.trim() !== '';
      if (!hasBlobPath) {
        normalizedEntry.can_send = false;
        normalizedEntry.status = 'no_bs_found';
        normalizedEntry.reason = 'Bestemmingsrapport PDF not found in Blob Storage';
      }

      if (!normalizedEntry.status && normalizedEntry.can_send === false) {
        normalizedEntry.status = 'blocked';
      }

      const key = precheckKey(entry.declaration_id, entry.processfactuurnummer);
      setCachedPrecheckResult(key, normalizedEntry);
      resultsByKey.set(key, normalizedEntry);
    }

    for (const item of batch) {
      const key = precheckKey(item.declaration_id, item.processfactuurnummer);
      if (!resultsByKey.has(key)) {
        resultsByKey.set(key, {
          declaration_id: item.declaration_id,
          processfactuurnummer: item.processfactuurnummer,
          status: 'no_bs_found',
          can_send: false,
          reason: 'Bestemmingsrapport PDF not found in Blob Storage',
        });
      }
    }
  }

  return orderedKeys
    .map((key) => resultsByKey.get(key))
    .filter(Boolean);
}

app.post('/api/fiscal/bestming-precheck', async (req, res) => {
  try {
    const incomingItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const forceRefresh = req.body?.force_refresh === true;
    if (incomingItems.length === 0) {
      return res.status(400).json({ error: 'items array is required' });
    }
    if (incomingItems.length > 1000) {
      return res.status(400).json({ error: 'Maximum 1000 items per precheck request' });
    }

    const deduped = [];
    const seen = new Set();
    for (const item of incomingItems) {
      const key = precheckKey(item?.declaration_id, item?.processfactuurnummer);
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(item);
      }
    }

    const results = await runBestmingPrecheck(deduped, { forceFresh: forceRefresh });
    const readyCount = results.filter((r) => r?.can_send).length;
    const blockedCount = results.length - readyCount;

    res.json({
      success: true,
      operation: 'precheck',
      total: results.length,
      ready_count: readyCount,
      blocked_count: blockedCount,
      results,
    });
  } catch (err) {
    console.error('[bestming-precheck] Error:', err);
    res.status(err.status || 500).json({
      error: err.message || 'Failed to run bestming precheck',
      details: err.data || null,
    });
  }
});

app.post('/api/fiscal/bestming-sign', async (req, res) => {
  try {
    const declarationId = req.body?.declaration_id ?? req.body?.id;
    const processfactuurnummer = req.body?.processfactuurnummer ?? req.body?.processFactuurnummer;

    if (declarationId == null && processfactuurnummer == null) {
      return res.status(400).json({
        error: 'declaration_id or processfactuurnummer is required',
      });
    }

    const precheckResults = await runBestmingPrecheck([{
      declaration_id: declarationId,
      processfactuurnummer,
    }]);
    const precheck = precheckResults[0];

    if (!precheck?.can_send) {
      return res.status(409).json({
        error: 'Cannot send for signature: recipient email not available',
        code: 'MISSING_EMAIL',
        precheck,
      });
    }

    const payload = {
      declaration_id: declarationId,
      processfactuurnummer,
      recipient_email: req.body?.recipient_email || precheck?.recipient_email,
      recipient_name: req.body?.recipient_name || precheck?.recipient_name,
      signer_function: req.body?.signer_function || precheck?.signer_function,
      document_name: req.body?.document_name,
      email_subject: req.body?.email_subject,
      status: req.body?.status,
      delete_blob_after_send: req.body?.delete_blob_after_send,
    };

    const result = await callDocuSignProcessor(payload);
    const key = precheckKey(declarationId, processfactuurnummer);
    precheckCache.delete(key);

    res.json({
      success: true,
      message: 'Signature request sent',
      declaration_id: declarationId,
      processfactuurnummer,
      docusign: result,
    });
  } catch (err) {
    console.error('[bestming-sign] Error:', err);
    res.status(err.status || 500).json({
      error: err.message || 'Failed to send bestming signature request',
      details: err.data || null,
    });
  }
});

// GET - Fetch users from Azure via proxy
app.get('/api/users/azure', async (req, res) => {
  const url = process.env.AZURE_FUNCTION_URL;
  if (!url) {
    console.error('AZURE_FUNCTION_URL not configured in environment');
    return res.status(500).json({ error: 'Azure Function URL not configured in environment' });
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(response.status).json({ error: `Azure Function returned status ${response.status}` });
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Error proxying Azure Function request:', err);
    res.status(500).json({ error: 'Failed to connect to Azure Function' });
  }
});

// Health Check & Version
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.3.1-debug', timestamp: new Date().toISOString() });
});

// ============================================================
// Database Debugging Tools (VNet Proxy)
// ============================================================
const DB_DEBUG_SECRET = "debug123";

const getDbConnection = async () => {
  return await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DB,
    ssl: { rejectUnauthorized: false }
  });
};

// ============================================================
// Sync Endpoint for Logic App
// ============================================================
app.use('/api/sync', syncRoutes);

// Declarations API
app.use('/api/declarations', declarationRoutes);

// Teams API
app.use('/api/teams', teamRoutes);

// Pipeline Monitoring API
app.use('/api/monitoring', monitoringRoutes);

// AI Agent API
app.use('/api/statistics/ai', hrAiRoutes);
app.use('/api/statistics/customs', customsAiRoutes);
app.use('/api/ai/instructions', customInstructionsRoutes);
app.use('/api/user-roles', userRolesRoutes);

// ============================================================
// Database Debugging Tools (VNet Proxy)
// ============================================================
// 1. Inspect Schema (Understand the DB)
app.get("/api/dev/schema", async (req, res) => {
  if (req.query.secret !== DB_DEBUG_SECRET) {
    return res.status(401).json({ error: "Unauthorized. Add ?secret=debug123" });
  }

  try {
    const connection = await getDbConnection();
    // Get all tables
    const [tables] = await connection.execute("SHOW TABLES");
    const schema = {};

    // Get columns for each table
    for (const row of tables) {
      const tableName = Object.values(row)[0];
      const [columns] = await connection.execute(`DESCRIBE \`${tableName}\``);
      schema[tableName] = columns;
    }

    await connection.end();
    res.json({ success: true, schema });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Run Raw SQL (Get a connection)
// Usage: POST /api/dev/query with body { "sql": "SELECT * FROM ...", "secret": "debug123" }
app.post("/api/dev/query", async (req, res) => {
  const { sql, secret } = req.body;
  if (secret !== DB_DEBUG_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!sql) {
    return res.status(400).json({ error: "Missing 'sql' in body" });
  }

  try {
    const connection = await getDbConnection();
    const [rows] = await connection.execute(sql);
    await connection.end();
    res.json({ success: true, count: rows.length, rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Use existing db-check but refactor to use helper
app.get("/api/dev/db-check", async (req, res) => {
  try {
    const connection = await getDbConnection();
    const [rows] = await connection.execute("SELECT NOW() as time");
    await connection.end();
    res.json({ success: true, result: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Debug middleware for unhandled requests
app.use((req, res, next) => {
  console.log(`[Request] ${req.method} ${req.url}`);
  next();
});

// Handle SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await hydrateAzureCache();
});
