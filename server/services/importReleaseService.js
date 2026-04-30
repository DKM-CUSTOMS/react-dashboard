import { BlobServiceClient } from '@azure/storage-blob';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const CONTAINER = 'document-intelligence';
const STORE_BLOB = 'IMPORT_IRP/dossiers.json';
const RUNS_BLOB = 'IMPORT_IRP/runs.json';
const META_BLOB = 'IMPORT_IRP/meta.json';
const SETTINGS_BLOB = 'IMPORT_IRP/settings.json';
const HEALTH_BLOB = 'IMPORT_IRP/health.json';
const TSD_BASE = 'https://api.irp.nxtport.com/irp-bff/v1/tsd';
const DONE_MESSAGE_STATUSES = new Set(['DMSCLE']);

// =============================================================================
// IRP AUTH MANAGER
// Playwright-based, fully automated. No irp.json file required.
// Uses a persistent browser profile so re-authentication is only needed when
// the IRP session actually expires (typically every 30+ days), not every hour.
// Bearer tokens are refreshed automatically in-process 5 minutes before expiry.
// =============================================================================

// Lazy — PROJECT_ROOT is defined further down but this is only called at runtime.
function getIrpProfileDir() {
  const v = process.env.IRP_BROWSER_PROFILE;
  if (!v) return path.join(PROJECT_ROOT, '.irp-browser-profile');
  return path.isAbsolute(v) ? v : path.join(PROJECT_ROOT, v);
}

const IRP_LOGIN_URL = process.env.IRP_LOGIN_URL || 'https://irp.nxtport.com/search';

// Single shared state object — never persisted to disk.
const irpAuth = {
  status: 'unknown',      // 'unknown'|'connected'|'needs_setup'|'refreshing'|'setup_active'
  token: null,            // current bearer token (in memory only)
  tokenExpiresAt: null,   // ISO string
  lastRefreshedAt: null,  // ISO string
  lastError: null,
  _refreshTimer: null,    // setTimeout handle for next scheduled refresh
  _refreshLock: null,     // deduplication Promise — prevents concurrent Playwright launches
  _setupContext: null,    // Playwright BrowserContext while setup is active
  _setupPage: null,       // Playwright Page while setup is active
};

/**
 * Clear the 'full' job cooldown timestamp so the next automation tick is not
 * blocked.  Called after a successful token refresh so auth errors self-heal
 * in < 5 minutes rather than waiting a full cooldown cycle.
 * References readMeta/writeMeta which are hoisted function declarations.
 */
async function _resetFullJobCooldown() {
  try {
    const meta = await readMeta();
    if (meta.jobs?.full?.lastFinishedAt) {
      meta.jobs.full = { ...meta.jobs.full, lastFinishedAt: null };
      await writeMeta(meta);
      console.log('[irp-auth] Full job cooldown reset — next tick will run immediately.');
    }
  } catch (e) {
    console.warn('[irp-auth] Could not reset full job cooldown:', e.message);
  }
}

/** Returns a safe copy of the auth state for the health endpoint / UI. */
function getIrpAuthState() {
  return {
    status: irpAuth.status,
    tokenExpiresAt: irpAuth.tokenExpiresAt,
    lastRefreshedAt: irpAuth.lastRefreshedAt,
    lastError: irpAuth.lastError,
    profileDir: getIrpProfileDir(),
  };
}

/** True when the in-memory token still has > 5 minutes of life. */
function isIrpTokenValid() {
  if (!irpAuth.token || !irpAuth.tokenExpiresAt) return false;
  return new Date(irpAuth.tokenExpiresAt).getTime() - Date.now() > 5 * 60 * 1000;
}

/** Store a freshly acquired token and mark the manager as connected. */
function setIrpToken(token, source) {
  const payload = decodeJwtPayload(token);
  const expiresAtMs = payload?.exp ? payload.exp * 1000 : Date.now() + 55 * 60 * 1000;
  irpAuth.token = token;
  irpAuth.tokenExpiresAt = new Date(expiresAtMs).toISOString();
  irpAuth.lastRefreshedAt = new Date().toISOString();
  irpAuth.status = 'connected';
  irpAuth.lastError = null;
  console.log(`[irp-auth] Token set from '${source}'. Expires ${irpAuth.tokenExpiresAt}`);
}

/** Invalidate the in-memory token (called on 401 responses). */
function clearIrpToken() {
  irpAuth.token = null;
  irpAuth.tokenExpiresAt = null;
  if (irpAuth.status === 'connected') irpAuth.status = 'unknown';
}

/**
 * Exchange the session cookies stored in the persistent browser profile for a
 * fresh IRP bearer token.  Runs Playwright in headless mode — no display needed.
 * Deduplicates concurrent callers: if a refresh is already in flight they all
 * receive the same Promise.
 */
async function refreshIrpTokenFromProfile() {
  if (irpAuth._refreshLock) return irpAuth._refreshLock;

  irpAuth._refreshLock = (async () => {
    if (irpAuth._refreshTimer) {
      clearTimeout(irpAuth._refreshTimer);
      irpAuth._refreshTimer = null;
    }
    irpAuth.status = 'refreshing';
    irpAuth.lastError = null;

    let context = null;
    try {
      const { chromium } = await import('playwright');
      context = await chromium.launchPersistentContext(getIrpProfileDir(), {
        headless: true,
        args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox'],
      });

      const cookies = await context.cookies(['https://irp.nxtport.com', 'https://api.irp.nxtport.com']);
      const sessionCookies = cookies.filter((c) =>
        ['ASLBSA', 'ASLBSACORS'].includes(c.name) || c.name.includes('next-auth')
      );

      if (sessionCookies.length === 0) {
        throw new Error('No IRP session cookies found in the browser profile. Please reconnect via Settings → IRP Connection.');
      }

      const cookieStr = sessionCookies.map((c) => `${c.name}=${c.value}`).join('; ');
      const resp = await fetch('https://irp.nxtport.com/api/auth/session', {
        headers: { Accept: 'application/json', Cookie: cookieStr, 'User-Agent': 'Mozilla/5.0', Referer: IRP_LOGIN_URL },
      });

      if (!resp.ok) {
        const expired = resp.status === 401 || resp.status === 403;
        throw new Error(expired
          ? `IRP session expired (HTTP ${resp.status}). Please reconnect via Settings → IRP Connection.`
          : `IRP session endpoint returned HTTP ${resp.status}`
        );
      }

      const data = await resp.json();
      if (!data.idToken) throw new Error('IRP session did not return an idToken.');

      setIrpToken(data.idToken, 'playwright-profile');
      scheduleIrpTokenRefresh();
      // Reset the 'full' job cooldown so the next automation tick runs immediately
      // rather than waiting up to 15 min after auth was fixed.
      _resetFullJobCooldown().catch(() => {});
      return true;
    } catch (error) {
      irpAuth.status = 'needs_setup';
      irpAuth.lastError = error.message;
      console.error(`[irp-auth] Profile refresh failed: ${error.message}`);
      // Retry in 5 minutes so a transient network error heals automatically.
      irpAuth._refreshTimer = setTimeout(() => {
        irpAuth._refreshLock = null;
        refreshIrpTokenFromProfile();
      }, 5 * 60 * 1000);
      return false;
    } finally {
      if (context) await context.close().catch(() => {});
      irpAuth._refreshLock = null;
    }
  })();

  return irpAuth._refreshLock;
}

/** Schedule the next automatic refresh 5 minutes before the current token expires. */
function scheduleIrpTokenRefresh() {
  if (irpAuth._refreshTimer) {
    clearTimeout(irpAuth._refreshTimer);
    irpAuth._refreshTimer = null;
  }
  if (!irpAuth.tokenExpiresAt) return;
  const expiresAtMs = new Date(irpAuth.tokenExpiresAt).getTime();
  const delayMs = Math.max(expiresAtMs - Date.now() - 5 * 60 * 1000, 30 * 1000);
  console.log(`[irp-auth] Next auto-refresh in ${Math.round(delayMs / 60000)} min.`);
  irpAuth._refreshTimer = setTimeout(refreshIrpTokenFromProfile, delayMs);
}

/** Called at server startup. Seeds the token from env or profile. */
async function initIrpAuth() {
  const envToken = String(process.env.IRP_BEARER_TOKEN || '').replace(/^Bearer\s+/i, '').trim();
  if (envToken) {
    setIrpToken(envToken, 'env');
    scheduleIrpTokenRefresh();
    return;
  }
  console.log('[irp-auth] Initialising from browser profile…');
  await refreshIrpTokenFromProfile();
}

// ── Setup session: lets the user log in via an embedded remote browser ──

/**
 * Start a Playwright browser in headless mode, navigate to the IRP login page,
 * and mark auth status as 'setup_active'.  The frontend polls screenshots and
 * forwards click/keyboard events via the /irp-session/setup/* routes.
 */
async function startIrpSetupSession() {
  if (irpAuth._setupContext) return { started: false, reason: 'Setup already active' };

  try {
    const { chromium } = await import('playwright');
    const context = await chromium.launchPersistentContext(getIrpProfileDir(), {
      headless: true,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox'],
      viewport: { width: 1280, height: 800 },
    });
    const page = context.pages()[0] || await context.newPage();
    irpAuth._setupContext = context;
    irpAuth._setupPage = page;
    irpAuth.status = 'setup_active';

    await page.goto(IRP_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // If the profile already has a valid session, we may be done immediately.
    const alreadyConnected = await _tryConnectFromSetupSession();
    if (alreadyConnected) {
      await stopIrpSetupSession();
      return { started: true, alreadyConnected: true };
    }

    return { started: true, alreadyConnected: false };
  } catch (error) {
    irpAuth._setupContext = null;
    irpAuth._setupPage = null;
    irpAuth.status = 'needs_setup';
    return { started: false, error: error.message };
  }
}

/** Internal: try to exchange session cookies from the live setup context. */
async function _tryConnectFromSetupSession() {
  if (!irpAuth._setupContext) return false;
  try {
    const cookies = await irpAuth._setupContext.cookies(['https://irp.nxtport.com', 'https://api.irp.nxtport.com']);
    const sessionCookies = cookies.filter((c) =>
      ['ASLBSA', 'ASLBSACORS'].includes(c.name) || c.name.includes('next-auth')
    );
    if (sessionCookies.length === 0) return false;

    const cookieStr = sessionCookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const resp = await fetch('https://irp.nxtport.com/api/auth/session', {
      headers: { Accept: 'application/json', Cookie: cookieStr, 'User-Agent': 'Mozilla/5.0' },
    });
    if (!resp.ok) return false;
    const data = await resp.json();
    if (!data.idToken) return false;

    setIrpToken(data.idToken, 'playwright-setup');
    scheduleIrpTokenRefresh();
    _resetFullJobCooldown().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/** Stop the setup browser session. */
async function stopIrpSetupSession() {
  const context = irpAuth._setupContext;
  irpAuth._setupContext = null;
  irpAuth._setupPage = null;
  if (irpAuth.status === 'setup_active') {
    irpAuth.status = irpAuth.token ? 'connected' : 'needs_setup';
  }
  if (context) await context.close().catch(() => {});
  return { stopped: true };
}

/**
 * Capture a JPEG screenshot of the current setup browser page.
 * Returns base64 string or null if setup is not active.
 */
async function getIrpSetupScreenshot() {
  if (!irpAuth._setupPage) return null;
  try {
    const buf = await irpAuth._setupPage.screenshot({ type: 'jpeg', quality: 75 });
    return buf.toString('base64');
  } catch {
    return null;
  }
}

/**
 * Forward a user interaction event to the setup browser page.
 * Supported types: 'click' {x,y}, 'type' {text}, 'key' {key}.
 * After each event, checks whether the session is now established.
 */
async function sendIrpSetupInput(event) {
  const page = irpAuth._setupPage;
  if (!page) return { ok: false, error: 'No active setup session' };
  try {
    if (event.type === 'click') {
      await page.mouse.click(Number(event.x), Number(event.y));
    } else if (event.type === 'type') {
      await page.keyboard.type(String(event.text || ''));
    } else if (event.type === 'key') {
      await page.keyboard.press(String(event.key || ''));
    }
    // Short pause so the page can react (login redirect, cookie set, etc.)
    await new Promise((r) => setTimeout(r, 800));
    const connected = await _tryConnectFromSetupSession();
    if (connected) await stopIrpSetupSession();
    return { ok: true, connected };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// In-process mutex that serialises all dossiers.json read-modify-write operations.
// Prevents concurrent source sync and IRP poll from overwriting each other's store changes.
// IRP API calls (slow network) run outside the lock; only the final store write is held.
let _storeMutex = Promise.resolve();
async function withStoreMutex(fn) {
  let release;
  const previous = _storeMutex;
  _storeMutex = new Promise((res) => { release = res; });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const SOURCE_QUERY = `SELECT d.DECLARATIONID, d.MESSAGESTATUS, d.ARRIVALTRANSPORTIDENTIFICATION, d.CONSIGNMENTINFOEORISHIPAGENT,
    TO_DATE((SELECT vdet.VALUE FROM DEFDATA.VARFIELDS_LINKVALUESDET vdet WHERE vdet.KEY1 = d.DECLARATIONID AND vdet.APPLICATION = 'CUSTOMS' AND vdet.FIELDID = 'ETA'), 'YYYYMMDD') AS ETA,
    cc.CONTAINERNUMBER,
    (SELECT LISTAGG(doc.REFERENCE, ', ') WITHIN GROUP (ORDER BY doc.SEQUENCENUMBER) FROM EUCDM.EUCDOCUMENT doc WHERE doc.DECLARATIONGUID = d.DECLARATIONGUID AND doc.DOCUMENTTYPE = 'N705') AS N705_REFERENCES
FROM EUCDM.EUCDECLARATION d
INNER JOIN (SELECT DISTINCT i.DECLARATIONGUID, con.IDENTIFICATIONNUMBER AS CONTAINERNUMBER FROM EUCDM.EUCITEM i JOIN EUCDM.EUCCONTAINER con ON i.ITEMGUID = con.ITEMGUID) cc ON d.DECLARATIONGUID = cc.DECLARATIONGUID
WHERE d.ISSUEDATETIME >= TRUNC(SYSDATE)
  AND TRIM(d.ARRIVALTRANSPORTIDENTIFICATION) IS NOT NULL
  AND TRIM(d.CONSIGNMENTINFOEORISHIPAGENT) IS NOT NULL
  AND EXISTS (SELECT 1 FROM EUCDM.EUCDOCUMENT doc WHERE doc.DECLARATIONGUID = d.DECLARATIONGUID AND doc.DOCUMENTTYPE = 'N705')
ORDER BY d.DECLARATIONID, cc.CONTAINERNUMBER`;

let containerClient = null;
const nowIso = () => new Date().toISOString();
const uniqueId = (...parts) => crypto.createHash('sha1').update(parts.join('|')).digest('hex');


function decodeJwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload.padEnd(payload.length + ((4 - payload.length % 4) % 4), '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

// (token caching is now handled by the IRP Auth Manager above)
async function getContainer() {
  if (containerClient) return containerClient;
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.VITE_AZURE_STORAGE_CONNECTION_STRING;
  if (!connStr) throw new Error('Missing AZURE_STORAGE_CONNECTION_STRING');
  const service = BlobServiceClient.fromConnectionString(connStr);
  containerClient = service.getContainerClient(CONTAINER);
  await containerClient.createIfNotExists();
  return containerClient;
}

async function archiveCorruptBlob(container, name, buffer, error) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archiveName = `${name}.corrupt-${stamp}`;
  await container.getBlockBlobClient(archiveName).uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: 'application/octet-stream' },
    metadata: { parseError: String(error.message || 'invalid-json').slice(0, 250) },
  });
  console.warn(`[import-release] Archived corrupt blob ${name} to ${archiveName}: ${error.message}`);
}

async function readJsonBlob(name, fallback) {
  const container = await getContainer();
  try {
    const buffer = await container.getBlobClient(name).downloadToBuffer();
    try {
      return JSON.parse(buffer.toString('utf8'));
    } catch (parseError) {
      await archiveCorruptBlob(container, name, buffer, parseError);
      try {
        const backup = await container.getBlobClient(`${name}.bak`).downloadToBuffer();
        return JSON.parse(backup.toString('utf8'));
      } catch (backupError) {
        if (backupError.statusCode !== 404) console.warn(`[import-release] Backup read failed for ${name}: ${backupError.message}`);
        return fallback;
      }
    }
  } catch (error) {
    if (error.statusCode === 404) return fallback;
    throw error;
  }
}

async function writeJsonBlob(name, data) {
  const container = await getContainer();
  const current = container.getBlobClient(name);
  try {
    const existing = await current.downloadToBuffer();
    JSON.parse(existing.toString('utf8'));
    await container.getBlockBlobClient(`${name}.bak`).uploadData(existing, {
      blobHTTPHeaders: { blobContentType: 'application/json' },
    });
  } catch (error) {
    if (error.statusCode !== 404) console.warn(`[import-release] Skipped backup for ${name}: ${error.message}`);
  }
  const body = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
  await container.getBlockBlobClient(name).uploadData(body, { blobHTTPHeaders: { blobContentType: 'application/json' } });
}

function emptyStore() {
  return { version: 1, updatedAt: nowIso(), rows: [] };
}

function defaultHealthSnapshot() {
  return {
    updatedAt: null,
    sourceReachable: false,
    sourceDetail: 'Unknown',
    irpAuthValid: false,
    irpAuthError: null,
    irpAuthState: 'unknown',
    irpAuthDetail: 'Unknown',
    irpSession: { status: 'unknown', tokenExpiresAt: null, lastRefreshedAt: null, lastError: null },
    emailConfigured: false,
    emailDetail: 'Unknown',
    automationRunning: false,
    automationDetail: 'Unknown',
    lastFullRunAt: null,
    fullJobRunning: false,
    latestRunStatus: null,
    latestRunIrpChecked: null,
    latestRunIrpErrors: null,
    latestRunIrpCompleted: null,
  };
}

function limitHistory(items, max = 100) {
  return (Array.isArray(items) ? items : []).slice(0, max);
}

function appendRowEvent(row, type, message, data = {}) {
  return {
    ...row,
    history: limitHistory([
      {
        at: nowIso(),
        type,
        message,
        data,
      },
      ...(Array.isArray(row.history) ? row.history : []),
    ]),
  };
}

function defaultEmailSettings() {
  return {
    to: process.env.IMPORT_RELEASE_EMAIL_TO || 'anas.benabbou@dkm-customs.com',
    cc: process.env.IMPORT_RELEASE_EMAIL_CC || '',
    subject_template: process.env.IMPORT_RELEASE_EMAIL_SUBJECT || 'Import Release Update - Declaration {{declaration_id}}',
    body_text: [
      'Hello,',
      '',
      'The import release for declaration {{declaration_id}} is ready.',
      'We found the MRN and the shipment is good to proceed.',
      '',
      'MRN: {{mrn}}',
      'Container: {{container_number}}',
      'Transport document: {{bl}}',
      'CRN: {{crn}}',
    ].join('\n'),
    body_html: '',
    body_template: '',
    signature_image_url: '',
    signature_content_html: '',
    signature_text: 'Regards,\nDKM Customs',
    signature_html: '',
  };
}

function defaultSettingsEnvelope() {
  return { version: 1, updatedAt: nowIso(), email: defaultEmailSettings() };
}

async function readStore() {
  const store = await readJsonBlob(STORE_BLOB, emptyStore());
  const rows = Array.isArray(store.rows) ? store.rows.map(reconcileRow) : [];
  return { ...emptyStore(), ...store, rows };
}

async function readImportReleaseSettings() {
  const stored = await readJsonBlob(SETTINGS_BLOB, defaultSettingsEnvelope());
  const merged = {
    ...defaultSettingsEnvelope(),
    ...stored,
    email: {
      ...defaultEmailSettings(),
      ...(stored.email || {}),
    },
  };
  if (!merged.email.body_text && stored.email?.body_template) {
    merged.email.body_text = htmlToPlainText(String(stored.email.body_template || '').replace('{{signature_html}}', '').trim());
  }
  if (!merged.email.body_html) {
    merged.email.body_html = stored.email?.body_html || plainTextToHtml(merged.email.body_text || '');
  }
  if (!merged.email.signature_text && stored.email?.signature_html) {
    merged.email.signature_text = htmlToPlainText(stored.email.signature_html);
  }
  if (!merged.email.signature_content_html) {
    merged.email.signature_content_html = stored.email?.signature_content_html || plainTextToHtml(merged.email.signature_text || '');
  }
  merged.email.signature_html = buildSignatureHtml(merged.email);
  merged.email.body_template = buildBodyHtml(merged.email);
  return merged;
}

async function writeImportReleaseSettings(settings) {
  const email = {
    ...defaultEmailSettings(),
    ...(settings.email || {}),
  };
  email.signature_html = buildSignatureHtml(email);
  email.body_template = buildBodyHtml(email);
  await writeJsonBlob(SETTINGS_BLOB, {
    version: 1,
    updatedAt: nowIso(),
    email,
  });
}

function pruneStore(rows) {
  const retentionDays = Number(process.env.IMPORT_RELEASE_DONE_RETENTION_DAYS || 30);
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  return rows.filter((row) => {
    if (row.record_state !== 'done') return true;
    const ts = row.closed_at || row.updated_at || row.created_at;
    return !ts || new Date(ts).getTime() >= cutoffMs;
  });
}

async function writeStore(store) {
  const rows = pruneStore(Array.isArray(store.rows) ? store.rows : []);
  await writeJsonBlob(STORE_BLOB, { ...store, rows, updatedAt: nowIso() });
}

function cooldownMs(name) {
  const defaults = { source: 10 * 60 * 1000, irp: 15 * 60 * 1000, full: 15 * 60 * 1000 };
  return Number(process.env[`IMPORT_RELEASE_${name.toUpperCase()}_COOLDOWN_MS`] || defaults[name] || 0);
}

async function readMeta() {
  const meta = await readJsonBlob(META_BLOB, { updatedAt: null, jobs: {} });
  return { updatedAt: meta.updatedAt || null, jobs: meta.jobs || {} };
}

async function writeMeta(meta) {
  await writeJsonBlob(META_BLOB, { ...meta, updatedAt: nowIso() });
}

async function readHealthSnapshot() {
  return {
    ...defaultHealthSnapshot(),
    ...(await readJsonBlob(HEALTH_BLOB, defaultHealthSnapshot())),
  };
}

async function writeHealthSnapshot(snapshot) {
  await writeJsonBlob(HEALTH_BLOB, {
    ...defaultHealthSnapshot(),
    ...snapshot,
    updatedAt: nowIso(),
  });
}

function cooldownResponse(name, meta) {
  const job = meta.jobs?.[name];
  if (!job?.lastFinishedAt) return null;
  const serialized = JSON.stringify(job.lastResult || {});
  if (serialized.includes('not defined') || serialized.includes('ReferenceError')) return null;
  const remainingMs = new Date(job.lastFinishedAt).getTime() + cooldownMs(name) - Date.now();
  if (remainingMs <= 0) return null;
  return { skipped: true, reason: 'cooldown', job: name, remainingSeconds: Math.ceil(remainingMs / 1000), lastFinishedAt: job.lastFinishedAt, lastResult: job.lastResult || null };
}

async function runJob(name, fn, { force = false } = {}) {
  const meta = await readMeta();
  if (!force) {
    const cooldown = cooldownResponse(name, meta);
    if (cooldown) return cooldown;
  }
  const running = meta.jobs[name]?.running;
  if (running?.startedAt && Date.now() - new Date(running.startedAt).getTime() < 10 * 60 * 1000) {
    return { skipped: true, reason: 'already_running', job: name, startedAt: running.startedAt };
  }
  meta.jobs[name] = { ...(meta.jobs[name] || {}), running: { startedAt: nowIso() } };
  await writeMeta(meta);
  try {
    const result = await fn();
    const next = await readMeta();
    next.jobs[name] = { ...(next.jobs[name] || {}), running: null, lastFinishedAt: nowIso(), lastResult: result, lastError: null };
    await writeMeta(next);
    return result;
  } catch (error) {
    const next = await readMeta();
    next.jobs[name] = { ...(next.jobs[name] || {}), running: null, lastFinishedAt: nowIso(), lastError: error.message };
    await writeMeta(next);
    throw error;
  }
}

async function appendRun(run) {
  const runs = await readJsonBlob(RUNS_BLOB, []);
  runs.unshift({ id: crypto.randomUUID(), startedAt: nowIso(), ...run });
  await writeJsonBlob(RUNS_BLOB, runs.slice(0, 200));
}

function toDateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{8}$/.test(value.trim())) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  if (typeof value === 'string' && /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(value.trim())) {
    const [d, m, y] = value.trim().split('/');
    return `${y.length === 2 ? `20${y}` : y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function toNumericValue(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value).trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function getNestedValue(object, path) {
  return String(path || '')
    .split('.')
    .filter(Boolean)
    .reduce((current, key) => (current == null ? undefined : current[key]), object);
}

function firstNumericValue(object, paths) {
  for (const path of paths) {
    const value = toNumericValue(getNestedValue(object, path));
    if (value != null) return value;
  }
  return null;
}

function normalizeSourceRow(row) {
  const get = (name) => row[name] ?? row[name.toLowerCase()] ?? row[name.toUpperCase()] ?? '';
  const declarationId = String(get('DECLARATIONID') || get('DossierId')).trim();
  const containerNumber = String(get('CONTAINERNUMBER') || get('Container')).trim().toUpperCase();
  const n705References = String(get('N705_REFERENCES') || '').trim();
  const bl = String(n705References || get('BL') || get('ARRIVALTRANSPORTIDENTIFICATION')).trim();
  const arrivalTransportIdentification = String(get('ARRIVALTRANSPORTIDENTIFICATION') || '').trim();
  const eori = String(get('CONSIGNMENTINFOEORISHIPAGENT') || get('EORI')).trim();
  return {
    id: uniqueId(declarationId, containerNumber || '__missing_container__', n705References || '__missing_bl__', eori || '__missing_eori__'),
    declaration_id: declarationId,
    container_number: containerNumber,
    message_status: String(get('MESSAGESTATUS') || '').trim(),
    bl,
    eori_ship_agent: eori,
    eta: toDateOnly(get('ETA')),
    n705_references: String(get('N705_REFERENCES') || '').trim(),
    arrival_transport_identification: arrivalTransportIdentification,
    source_total_gross: toNumericValue(get('TOTAL_GROSS')),
    source_total_packages: toNumericValue(get('TOTAL_PACKAGES')),
  };
}

function rowBusinessKey(row) {
  return [
    row.declaration_id || '',
    row.container_number || '__missing_container__',
    row.bl || '__missing_bl__',
    row.eori_ship_agent || '__missing_eori__',
  ].join('|');
}

function mergeRows(existingRows, incomingRows, source) {
  const byKey = new Map(existingRows.map((row) => [rowBusinessKey(row), row]));
  let inserted = 0;
  let updated = 0;
  for (const incoming of incomingRows) {
    const key = rowBusinessKey(incoming);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, appendRowEvent(
        reconcileRow({
          ...incoming,
          first_source_message_status: incoming.message_status,
          source,
          created_at: nowIso(),
          updated_at: nowIso(),
          last_source_sync_at: nowIso(),
          last_error: null,
        }),
        'source_added',
        'Declaration added from source feed.',
        { message_status: incoming.message_status, eta: incoming.eta }
      ));
      inserted += 1;
    } else {
      let next = reconcileRow({
        ...existing,
        ...incoming,
        first_source_message_status: getInitialSourceMessageStatus(existing) || normalizeStatus(incoming.message_status),
        source: existing.source || source,
        created_at: existing.created_at,
        updated_at: nowIso(),
        last_source_sync_at: nowIso(),
      });
      const sourceChanges = {};
      for (const field of ['message_status', 'eta', 'bl', 'eori_ship_agent', 'source_total_packages', 'source_total_gross']) {
        if (String(existing[field] || '') !== String(incoming[field] || '')) {
          sourceChanges[field] = { before: existing[field] || null, after: incoming[field] || null };
        }
      }
      if (Object.keys(sourceChanges).length > 0) {
        next = appendRowEvent(next, 'source_updated', 'Source data changed.', sourceChanges);
      }
      byKey.set(key, next);
      updated += 1;
    }
  }
  return { rows: [...byKey.values()], inserted, updated };
}

function normalizeStatus(value) {
  return String(value || '').trim().toUpperCase();
}

function validateContainerNumber(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return 'Container is required for IRP lookup.';
  if (!/^[A-Z]{4}\d{7}$/.test(normalized)) return 'Container must follow ISO container format, for example MEDU2900426.';
  return null;
}

function validateEori(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return 'EORI ship agent is required for IRP lookup.';
  if (!/^[A-Z]{2}[A-Z0-9]{7,15}$/.test(normalized)) return 'EORI must start with a country code and contain 9-17 alphanumeric characters.';
  return null;
}

function validateTransportDocument(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return 'Transport document is required for IRP lookup.';
  if (/\s/.test(normalized)) return 'Transport document cannot contain spaces. Vessel names such as MSC NATHAVIA are not valid reference keys.';
  if (!/^[A-Z0-9/-]{6,35}$/.test(normalized)) return 'Transport document must be 6-35 characters using only letters, digits, slash, or dash.';
  return null;
}

function getLookupValidationErrors(row) {
  return [
    validateContainerNumber(row.container_number),
    validateTransportDocument(row.bl),
    validateEori(row.eori_ship_agent),
  ].filter(Boolean);
}

function hasValidationError(row) {
  return Array.isArray(row.validation_errors) && row.validation_errors.length > 0;
}

function hasRuntimeError(row) {
  return Boolean(!hasValidationError(row) && row.last_error && row.last_error !== 'CRN not found');
}

function isRetriableIrpErrorMessage(message) {
  const normalized = String(message || '').toLowerCase();
  if (!normalized) return false;
  return [
    'idtoken',
    'invalid jwt',
    'http 401',
    'fetch failed',
    'network',
    'timeout',
    'econn',
    'und_err',
    'session returned http',
    'no irp token available',
  ].some((needle) => normalized.includes(needle));
}

function hasRetriableIrpError(row) {
  return Boolean(hasRuntimeError(row) && isRetriableIrpErrorMessage(row.last_error));
}

function getNumericComparisonState(leftValue, rightValue, tolerance = 0) {
  const left = toNumericValue(leftValue);
  const right = toNumericValue(rightValue);
  if (left == null || right == null) return 'pending';
  return Math.abs(left - right) <= tolerance ? 'match' : 'mismatch';
}

function needsIrpComparisonRefresh(row) {
  return Boolean(row.mrn) && (toNumericValue(row.irp_total_packages) == null || toNumericValue(row.irp_total_gross) == null);
}

function isNeedsCheckQueueRow(row) {
  return !isDoneRecord(row) && !hasValidationError(row) && row.record_state === 'needs_check';
}

function isEmailPendingQueueRow(row) {
  return !isDoneRecord(row)
    && !hasValidationError(row)
    && row.record_state === 'email_pending'
    && Boolean(row.mrn)
    && !row.email_sent_at;
}

function isPreLodgedQueueRow(row) {
  return !isDoneRecord(row) && !hasValidationError(row) && Boolean(row.crn) && !row.mrn && normalizeStatus(row.tsd_status) !== 'INVALIDATED';
}

function isNoCrnQueueRow(row) {
  return !isDoneRecord(row) && !hasValidationError(row) && !row.crn && (row.last_irp_status === 'crn_not_found' || row.last_error === 'CRN not found');
}

function isInvalidatedQueueRow(row) {
  return !isDoneRecord(row) && !hasValidationError(row) && normalizeStatus(row.tsd_status) === 'INVALIDATED';
}

function isWaitingQueueRow(row) {
  return !isDoneRecord(row) && !hasValidationError(row) && row.record_state === 'waiting';
}

function hasReleaseOutcome(row) {
  return Boolean(row.crn && row.mrn);
}

function getInitialSourceMessageStatus(row) {
  const history = Array.isArray(row.history) ? row.history : [];
  const sourceAdded = history.find((event) => String(event?.type || '').toLowerCase() === 'source_added');
  const addedStatus = normalizeStatus(sourceAdded?.data?.message_status || '');
  if (addedStatus) return addedStatus;

  const oldestBefore = [...history]
    .reverse()
    .find((event) => String(event?.type || '').toLowerCase() === 'source_updated' && event?.data?.message_status?.before);
  const beforeStatus = normalizeStatus(oldestBefore?.data?.message_status?.before || '');
  if (beforeStatus) return beforeStatus;

  // History is the most reliable source of truth. Only fall back to the persisted field
  // when there is no lifecycle evidence for the first source status.
  const explicit = normalizeStatus(row.first_source_message_status || '');
  if (explicit) return explicit;

  // Return empty string — do NOT fall back to current message_status.
  // Falling back to the current status caused rows with no history (e.g. migrated data) and
  // a current DMSCLE status to be silently treated as "was always DMSCLE", making them done
  // before any IRP check or email was processed.
  return '';
}

function isDoneMessageStatus(row) {
  if (!DONE_MESSAGE_STATUSES.has(normalizeStatus(row.message_status))) return false;
  // Once a record has entered the IRP outcome flow (CRN and/or MRN present),
  // source DMSCLE must not auto-close it anymore. Those rows now belong to the
  // review/email pipeline and are only closed manually (or via explicit suppress).
  if (row.crn || row.mrn) return false;

  const originalStatus = getInitialSourceMessageStatus(row);
  if (originalStatus) return DONE_MESSAGE_STATUSES.has(originalStatus);
  return false;
}


function isWithinEtaWindow(row) {
  if (!row.eta) return true;
  const eta = new Date(row.eta);
  const threshold = new Date();
  threshold.setDate(threshold.getDate() + 7);
  return eta <= threshold;
}

function isPreLodgedTrackingRow(row) {
  return Boolean(row.crn) && !row.mrn;
}

function isDoneRecord(row) {
  if (isDoneMessageStatus(row)) return true;
  if (row.manual_done_at) return true;
  if (row.email_suppressed_at) return true;
  return false;
}

function getDoneReason(row) {
  if (isDoneMessageStatus(row)) return 'message_status_dmscle';
  if (row.manual_done_at) return 'manual_done';
  if (row.email_suppressed_at) return 'email_suppressed';
  return null;
}

function getRecordState(row) {
  if ((row.validation_errors || []).length > 0) return 'error';
  if (isDoneRecord(row)) return 'done';
  if (Boolean(row.mrn)) {
    return row.comparison_state === 'match' ? 'email_pending' : 'needs_check';
  }
  // All records without MRN are either due (within ETA window) or waiting — never inactive.
  // Any message status can reach IRP: DMSREG, DEC_DAT, CREATE, DMSREJ, DMSCTL, etc.
  return isWithinEtaWindow(row) ? 'due' : 'waiting';
}

function reconcileRow(row) {
  const next = {
    ...row,
    message_status: normalizeStatus(row.message_status),
    tsd_status: normalizeStatus(row.tsd_status),
    history: Array.isArray(row.history) ? row.history : [],
    source_total_gross: toNumericValue(row.source_total_gross ?? row.total_gross),
    source_total_packages: toNumericValue(row.source_total_packages ?? row.total_packages),
    irp_total_gross: toNumericValue(row.irp_total_gross),
    irp_total_packages: toNumericValue(row.irp_total_packages),
  };
  next.first_source_message_status = getInitialSourceMessageStatus(next) || '';
  next.validation_errors = getLookupValidationErrors(next);
  next.lookup_ready = next.validation_errors.length === 0;
  next.package_check = getNumericComparisonState(next.source_total_packages, next.irp_total_packages, 0);
  next.gross_check = getNumericComparisonState(next.source_total_gross, next.irp_total_gross, 0.001);
  next.comparison_state = !next.mrn
    ? null
    : (next.package_check === 'mismatch' || next.gross_check === 'mismatch')
      ? 'mismatch'
      : (next.package_check === 'match' && next.gross_check === 'match')
        ? 'match'
        : 'pending';
  next.has_discrepancy = next.comparison_state === 'mismatch';
  next.done_reason = getDoneReason(next);
  next.record_state = getRecordState(next);
  next.stop_checking = next.record_state === 'done' ? 1 : 0;
  next.closed_at = next.record_state === 'done' ? (row.closed_at || nowIso()) : null;
  return next;
}

async function processPendingEmails(rows) {
  const updatedRows = [];
  let sent = 0;
  let errors = 0;

  for (const row of rows) {
    // Fast-path: only manually approved release rows are eligible for notification.
    // Everyone else skips the email path entirely.
    if (!row.manual_done_at || !row.crn || !row.mrn || row.email_sent_at || row.email_suppressed_at) {
      updatedRows.push(row);
      continue;
    }
    let next = reconcileRow(row);
    if (!shouldSendEmail(next)) {
      updatedRows.push(next);
      continue;
    }

    try {
      const emailPayload = await sendNotificationEmail(next);
      next = appendRowEvent(reconcileRow({
        ...next,
        email_sent_at: nowIso(),
        email_last_error: null,
        email_to: emailPayload.to || '',
        email_cc: emailPayload.cc || '',
        email_subject: emailPayload.subject || '',
        updated_at: nowIso(),
      }), 'email_sent', 'Notification email sent.', {
        to: emailPayload.to || '',
        cc: emailPayload.cc || '',
        subject: emailPayload.subject || '',
      });
      sent += 1;
    } catch (error) {
      next = appendRowEvent(reconcileRow({
        ...next,
        email_last_error: error.message,
        updated_at: nowIso(),
      }), 'email_error', 'Notification email failed.', { error: error.message });
      errors += 1;
    }

    updatedRows.push(next);
  }

  return { rows: updatedRows, sent, errors };
}

function shouldSendEmail(row) {
  return Boolean(row.manual_done_at && row.crn && row.mrn && !row.email_sent_at && !row.email_suppressed_at);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function plainTextToHtml(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br/>')}</p>`)
    .join('\n');
}

function htmlToPlainText(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function sanitizeRichHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '');
}

function buildSignatureHtml(email) {
  const imageUrl = String(email?.signature_image_url || '').trim();
  const textHtml = sanitizeRichHtml(email?.signature_content_html || '') || plainTextToHtml(email?.signature_text || '');
  const imageHtml = imageUrl
    ? `<p><img src="${imageUrl}" alt="Signature" style="max-width:280px;height:auto;display:block;" /></p>`
    : '';
  return `${imageHtml}${textHtml}`.trim() || '<p>Regards,<br/>DKM Customs</p>';
}

function buildBodyHtml(email) {
  const bodyHtml = sanitizeRichHtml(email?.body_html || '') || plainTextToHtml(email?.body_text || '');
  return [bodyHtml, '{{signature_html}}'].filter(Boolean).join('\n');
}

function emailVariableDefinitions() {
  return [
    { key: 'declaration_id', label: 'Declaration ID', description: 'Declaration identifier from the source row.' },
    { key: 'container_number', label: 'Container', description: 'Transport equipment ID / container number.' },
    { key: 'eta', label: 'ETA', description: 'Estimated time of arrival.' },
    { key: 'bl', label: 'Transport document', description: 'N705 reference / transport document.' },
    { key: 'eori_ship_agent', label: 'EORI ship agent', description: 'EORI ship agent value.' },
    { key: 'crn', label: 'CRN', description: 'Customs reference number from IRP.' },
    { key: 'mrn', label: 'MRN', description: 'Master reference number from IRP.' },
    { key: 'source_total_packages', label: 'Source packages', description: 'Package count from the source declaration feed.' },
    { key: 'source_total_gross', label: 'Source gross', description: 'Gross mass from the source declaration feed.' },
    { key: 'irp_total_packages', label: 'IRP packages', description: 'Released package count from the IRP TSD response, with write-off fallback if needed.' },
    { key: 'irp_total_gross', label: 'IRP gross', description: 'Released gross mass from the IRP TSD response, with write-off fallback if needed.' },
    { key: 'comparison_state', label: 'Comparison state', description: 'Comparison result between source and IRP totals.' },
    { key: 'tsd_status', label: 'TSD status', description: 'Latest TSD status from IRP.' },
    { key: 'clearance_status', label: 'Clearance status', description: 'Latest clearance status from IRP.' },
  ];
}

function renderTemplate(template, variables) {
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    return String(variables[key] ?? '');
  });
}

async function buildEmailPayload(row) {
  const settings = await readImportReleaseSettings();
  const email = settings.email || defaultEmailSettings();
  const signatureHtml = buildSignatureHtml(email);
  const variableMap = {
    declaration_id: row.declaration_id || '',
    container_number: row.container_number || '',
    eta: row.eta || '',
    bl: row.bl || '',
    eori_ship_agent: row.eori_ship_agent || '',
    crn: row.crn || '',
    mrn: row.mrn || '',
    source_total_packages: row.source_total_packages ?? '',
    source_total_gross: row.source_total_gross ?? '',
    irp_total_packages: row.irp_total_packages ?? '',
    irp_total_gross: row.irp_total_gross ?? '',
    comparison_state: row.comparison_state || '',
    tsd_status: row.tsd_status || '',
    clearance_status: row.clearance_status || '',
    signature_html: signatureHtml,
  };

  return {
    to: renderTemplate(email.to, variableMap),
    cc: renderTemplate(email.cc, variableMap),
    subject: renderTemplate(email.subject_template, variableMap),
    body: renderTemplate(email.body_template, variableMap),
  };
}

async function sendNotificationEmail(row) {
  const url = process.env.IMPORT_RELEASE_EMAIL_URL;
  if (!url) throw new Error('IMPORT_RELEASE_EMAIL_URL is not configured');

  const payload = await buildEmailPayload(row);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Email Logic App returned HTTP ${response.status}`);
  return payload;
}

async function fetchSourceDeclarations() {
  const url = process.env.IMPORT_RELEASE_SOURCE_URL || process.env.STREAMLINER_LOGIC_APP_URL;
  if (!url) throw new Error('IMPORT_RELEASE_SOURCE_URL is not configured');
  const attempts = Number(process.env.IMPORT_RELEASE_SOURCE_RETRIES || 3);
  const timeoutMs = Number(process.env.IMPORT_RELEASE_SOURCE_TIMEOUT_MS || 30000);
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: SOURCE_QUERY }), signal: controller.signal });
      if (!response.ok) throw new Error(`Source Logic App returned HTTP ${response.status}`);
      const payload = await response.json();
      const rows = Array.isArray(payload) ? payload : payload.rows || payload.data || payload.result || [];
      if (!Array.isArray(rows)) throw new Error('Source Logic App response must contain rows/data/result array');
      return rows.map(normalizeSourceRow).filter((row) => row.declaration_id);
    } catch (error) {
      lastError = error;
      const cause = error.cause?.code ? ` (${error.cause.code})` : '';
      console.warn(`[import-release] Source sync attempt ${attempt}/${attempts} failed${cause}: ${error.message}`);
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    } finally {
      clearTimeout(timeout);
    }
  }
  const cause = lastError?.cause?.code ? ` (${lastError.cause.code})` : '';
  throw new Error(`Source Logic App unreachable after ${attempts} attempt(s)${cause}: ${lastError?.message || 'unknown error'}`);
}

async function syncSource(options = {}) {
  return runJob('source', async () => {
    // Fetch from Logic App outside the mutex — network call, no store involvement.
    const incoming = await fetchSourceDeclarations();
    // Acquire mutex only for the read-modify-write so IRP poll writes don't interleave.
    return withStoreMutex(async () => {
      const store = await readStore();
      const merged = mergeRows(store.rows, incoming, 'logic_app');
      await writeStore({ ...store, rows: merged.rows });
      const result = { fetched: incoming.length, inserted: merged.inserted, updated: merged.updated, blob: `${CONTAINER}/${STORE_BLOB}` };
      if (!options.suppressRunLog) await appendRun({ type: 'source', result });
      return result;
    });
  }, options);
}

const normalizeBearerToken = (value) => String(value || '').replace(/^Bearer\s+/i, '').trim();

async function getIrpToken(options = {}) {
  const excluded = normalizeBearerToken(options.excludeBearerToken);

  // Env override: manual bearer token (escape hatch, e.g. for debugging)
  const envToken = normalizeBearerToken(process.env.IRP_BEARER_TOKEN);
  if (!options.skipBearer && envToken && envToken !== excluded) return envToken;

  // Logic App path: no bearer token needed
  if (process.env.IMPORT_RELEASE_IRP_URL) return null;

  // In-memory token (populated by initIrpAuth / refreshIrpTokenFromProfile)
  if (!options.skipCache && isIrpTokenValid()) {
    const t = normalizeBearerToken(irpAuth.token);
    if (!excluded || t !== excluded) return irpAuth.token;
  }

  // Token missing or near-expiry: refresh from the browser profile
  await refreshIrpTokenFromProfile();
  if (isIrpTokenValid()) {
    const t = normalizeBearerToken(irpAuth.token);
    if (!excluded || t !== excluded) return irpAuth.token;
  }

  throw new Error(irpAuth.lastError || 'IRP authentication failed. Please reconnect via Settings → IRP Connection.');
}

async function checkIrpViaLogicApp(row) {
  const response = await fetch(process.env.IMPORT_RELEASE_IRP_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row) });
  if (!response.ok) throw new Error(`IRP Logic App returned HTTP ${response.status}`);
  return response.json();
}


async function irpFetch(pathname, headers, context) {
  const response = await fetch(`${TSD_BASE}${pathname}`, { headers });
  if (response.status !== 401 || context?.retriedAuth) return response;

  const failedToken = normalizeBearerToken(headers.Authorization);
  clearIrpToken();
  const freshToken = await getIrpToken({ skipCache: true, excludeBearerToken: failedToken });
  if (!freshToken) return response;
  context.retriedAuth = true;
  const retryHeaders = { ...headers, Authorization: `Bearer ${freshToken}` };
  return fetch(`${TSD_BASE}${pathname}`, { headers: retryHeaders });
}

async function fetchIrpAccountStatus() {
  const token = await getIrpToken();
  if (!token) return { ok: false, error: 'No IRP token available' };

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'User-Agent': 'Mozilla/5.0',
  };
  let retriedAuth = false;

  let response = await fetch('https://api.irp.nxtport.com/irp-bff/v1/account', { headers });
  if (response.status === 401) {
    const failedToken = normalizeBearerToken(headers.Authorization);
    clearIrpToken();
    try {
      const freshToken = await getIrpToken({ skipCache: true, excludeBearerToken: failedToken });
      if (freshToken) {
        retriedAuth = true;
        response = await fetch('https://api.irp.nxtport.com/irp-bff/v1/account', {
          headers: { ...headers, Authorization: `Bearer ${freshToken}` },
        });
      }
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  if (!response.ok) {
    return { ok: false, error: `HTTP ${response.status}`, retriedAuth };
  }

  return { ok: true, retriedAuth };
}

function extractIrpTotalsFromTsdInfo(info) {
  const irp_total_packages = firstNumericValue(info, [
    'numberOfPackages.releasedByCustoms.totalIncluded',
    'numberOfPackages.releasedByCustoms.total',
    'numberOfPackages.releasedByCustoms',
    'releasedByCustoms.packages.totalIncluded',
    'releasedByCustoms.packages.total',
    'releasedByCustoms.packages',
    'writtenOfPackages.totalIncluded',
    'writtenOffPackages.totalIncluded',
    'writtenOfPackages.total',
    'writtenOffPackages.total',
    'writtenOfPackages',
    'writtenOffPackages',
    'packagesReleased',
    'totalPackagesReleased',
  ]);

  const irp_total_gross = firstNumericValue(info, [
    'totalGrossMass.releasedByCustoms.totalIncluded',
    'totalGrossMass.releasedByCustoms.total',
    'totalGrossMass.releasedByCustoms',
    'releasedByCustoms.grossMass.totalIncluded',
    'releasedByCustoms.grossMass.total',
    'releasedByCustoms.grossMass',
    'writtenOffGrossMass.totalIncluded',
    'writtenOfGrossMass.totalIncluded',
    'writtenOffGrossMass.total',
    'writtenOfGrossMass.total',
    'writtenOffGrossMass',
    'writtenOfGrossMass',
    'grossMassReleased',
    'totalGrossMassReleased',
  ]);

  return { irp_total_packages, irp_total_gross };
}

async function fetchIrpWriteOff(crn, headers, authContext) {
  try {
    const response = await irpFetch(`/${encodeURIComponent(crn)}/write-off`, headers, authContext);
    if (response.status === 404) return { irp_total_packages: null, irp_total_gross: null };
    if (!response.ok) throw new Error(`TSD write-off HTTP ${response.status}`);
    const payload = await response.json();
    const packageInfo = payload?.writtenOfPackages || payload?.writtenOffPackages || {};
    const grossInfo = payload?.writtenOffGrossMass || payload?.writtenOfGrossMass || {};
    return {
      irp_total_packages: toNumericValue(packageInfo?.totalIncluded ?? packageInfo),
      irp_total_gross: toNumericValue(grossInfo?.totalIncluded ?? grossInfo),
    };
  } catch (error) {
    return {
      irp_total_packages: null,
      irp_total_gross: null,
      writeOffError: error.message,
    };
  }
}

async function fetchIrpLspDetails(crn, headers, authContext) {
  try {
    const response = await irpFetch(`/${encodeURIComponent(crn)}/lsp-irp`, headers, authContext);
    if (response.status === 404) return { irp_total_packages: null, irp_total_gross: null };
    if (!response.ok) throw new Error(`TSD lsp-irp HTTP ${response.status}`);
    const payload = await response.json();
    const totals = extractIrpTotalsFromTsdInfo(payload);
    return {
      irp_total_packages: totals.irp_total_packages,
      irp_total_gross: totals.irp_total_gross,
    };
  } catch (error) {
    return {
      irp_total_packages: null,
      irp_total_gross: null,
      lspIrpError: error.message,
    };
  }
}

async function checkIrpDirect(row, options = {}) {
  if (options.forceFreshAuth) clearIrpToken();
  const token = options.forceFreshAuth
    ? await getIrpToken({ skipCache: true })
    : await getIrpToken();
  if (!token) return checkIrpViaLogicApp(row);
  let crn = row.crn;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json', 'Active-Role': 'LSP', 'User-Agent': 'Mozilla/5.0' };
  const authContext = { retriedAuth: false };
  if (!crn) {
    const transportDocuments = [
      ...String(row.n705_references || '').split(',').map((value) => value.trim()).filter(Boolean),
      String(row.bl || '').trim(),
    ].filter((value, index, array) => value && array.indexOf(value) === index);
    const transportEquipmentId = String(row.container_number || '').trim().toUpperCase();
    const eori = String(row.eori_ship_agent || '').trim();
    if (!transportDocuments.length || !transportEquipmentId || !eori) {
      throw new Error(`Missing IRP reference key fields: transportDocument=${transportDocuments[0] || '-'}, teId=${transportEquipmentId || '-'}, eori=${eori || '-'}`);
    }

    const attempts = [];
    for (const transportDocument of transportDocuments) {
      const params = new URLSearchParams({ bl: transportDocument, teId: transportEquipmentId, eori, sn: '' });
      const ref = await irpFetch(`/reference?${params.toString()}`, headers, authContext);
      attempts.push({ transportDocument, transportEquipmentId, eori, httpStatus: ref.status });
      if (ref.status === 404) continue;
      if (!ref.ok) {
        const body = await ref.text().catch(() => '');
        throw new Error(`CRN lookup HTTP ${ref.status} for transportDocument=${transportDocument}, teId=${transportEquipmentId}, eori=${eori}: ${body.slice(0, 180)}`);
      }
      const data = await ref.json();
      crn = typeof data === 'string' ? data : data.crn;
      break;
    }
    if (!crn) return { crn: null, status: 'crn_not_found', lookup: { attempts } };
  }
  const infoResponse = await irpFetch(`/${encodeURIComponent(crn)}`, headers, authContext);
  if (!infoResponse.ok) throw new Error(`TSD lookup HTTP ${infoResponse.status}`);
  const info = await infoResponse.json();
  const inlineTotals = extractIrpTotalsFromTsdInfo(info);
  const hasInlineTotals = inlineTotals.irp_total_packages != null || inlineTotals.irp_total_gross != null;
  const lspIrpTotals = hasInlineTotals
    ? { irp_total_packages: null, irp_total_gross: null, lspIrpError: null }
    : await fetchIrpLspDetails(crn, headers, authContext);
  const hasLspIrpTotals = lspIrpTotals.irp_total_packages != null || lspIrpTotals.irp_total_gross != null;
  const shouldFetchWriteOff = !hasInlineTotals && !hasLspIrpTotals;
  const writeOff = shouldFetchWriteOff
    ? await fetchIrpWriteOff(crn, headers, authContext)
    : { irp_total_packages: row.irp_total_packages ?? null, irp_total_gross: row.irp_total_gross ?? null, writeOffError: null };
  return {
    crn,
    mrn: info.mrn || null,
    tsd_status: info.status?.tsd || '',
    clearance_status: info.status?.clearance || '',
    irp_total_packages: inlineTotals.irp_total_packages ?? lspIrpTotals.irp_total_packages ?? writeOff.irp_total_packages,
    irp_total_gross: inlineTotals.irp_total_gross ?? lspIrpTotals.irp_total_gross ?? writeOff.irp_total_gross,
    lsp_irp_error: hasInlineTotals ? null : (lspIrpTotals.lspIrpError || null),
    write_off_error: (hasInlineTotals || hasLspIrpTotals) ? null : (writeOff.writeOffError || null),
  };
}
function shouldCheckIrp(row) {
  if (!row.lookup_ready) return false;
  if (isDoneRecord(row)) return false;
  // Always refresh IRP totals when a row has MRN but missing weight/package data.
  if (needsIrpComparisonRefresh(row)) return true;
  // Row already has MRN — no further CRN/MRN lookup needed (unless comparison refresh above).
  if (Boolean(row.mrn)) return false;
  // Auth/network errors are always retried so they self-heal once the token is refreshed.
  if (hasRetriableIrpError(row)) return true;
  // Any record without MRN within the ETA window is eligible — regardless of message status.
  // DMSREG, DEC_DAT, CREATE, DMSCTL, DMSREJ, DMSCLE (no CRN/MRN) all need the IRP check.
  return isWithinEtaWindow(row);
}

function getIrpCandidatePriority(row) {
  if (hasRetriableIrpError(row)) return 0;
  if (needsIrpComparisonRefresh(row)) return 1;
  if (isPreLodgedTrackingRow(row)) return 2;
  if (!row.crn) return 3;
  return 4;
}

// batchSize: rows processed per batch iteration (env IMPORT_RELEASE_IRP_BATCH_SIZE, default 50).
// Total rows checked per run is controlled separately by IMPORT_RELEASE_IRP_MAX_PER_RUN (0 = all).
async function pollIrp(batchSize = 50, options = {}) {
  return runJob('irp', async () => {
    const store = await readStore();
    const resolvedBatchSize = Math.max(1, Number(batchSize) || 50);
    const eligibleRows = store.rows
      .filter(shouldCheckIrp)
      .sort((a, b) => {
        const priorityDiff = getIrpCandidatePriority(a) - getIrpCandidatePriority(b);
        if (priorityDiff !== 0) return priorityDiff;
        return new Date(a.last_irp_check_at || 0) - new Date(b.last_irp_check_at || 0);
      });
    const configuredMaxPerRun = Number(options.maxPerRun ?? process.env.IMPORT_RELEASE_IRP_MAX_PER_RUN ?? 0);
    const maxPerRun = Number.isFinite(configuredMaxPerRun) && configuredMaxPerRun > 0
      ? configuredMaxPerRun
      : eligibleRows.length;
    const candidates = eligibleRows.slice(0, maxPerRun);
    const byId = new Map(store.rows.map((row) => [row.id, row]));
    const results = [];
    for (let offset = 0; offset < candidates.length; offset += resolvedBatchSize) {
      const batch = candidates.slice(offset, offset + resolvedBatchSize);
      for (const row of batch) {
        try {
          const irp = await checkIrpDirect(row, { forceFreshAuth: hasRetriableIrpError(row) });
          const next = appendRowEvent(
            reconcileRow({ ...row, ...irp, last_irp_status: irp.status || 'checked', lookup: irp.lookup || row.lookup || null, last_irp_check_at: nowIso(), last_error: null, updated_at: nowIso() }),
            'irp_checked',
            'IRP check completed.',
            {
              status: irp.status || 'checked',
              crn: irp.crn || null,
              mrn: irp.mrn || null,
              tsd_status: irp.tsd_status || null,
              irp_total_packages: irp.irp_total_packages ?? null,
              irp_total_gross: irp.irp_total_gross ?? null,
              write_off_error: irp.write_off_error || null,
            }
          );
          byId.set(row.id, next);
          results.push({
            id: row.id,
            declarationId: row.declaration_id,
            status: irp.status || 'checked',
            crn: next.crn,
            mrn: next.mrn,
            tsdStatus: next.tsd_status,
            emailSentAt: next.email_sent_at || null,
            emailError: next.email_last_error || null,
          });
        } catch (error) {
          const retriable = isRetriableIrpErrorMessage(error.message);
          byId.set(row.id, appendRowEvent(
            reconcileRow({ ...row, last_irp_status: 'error', last_irp_check_at: nowIso(), last_error: error.message, updated_at: nowIso() }),
            'irp_error',
            'IRP check failed.',
            { error: error.message, retriable }
          ));
          results.push({ id: row.id, declarationId: row.declaration_id, status: 'error', error: error.message, retriable });
        }
      }
    }
    // Reactive: if ≥50% of checked rows returned auth errors, the token is likely stale.
    // Trigger a background refresh so the next poll succeeds without manual intervention.
    // Reactive: if ≥50% of checked rows returned auth errors the token is likely stale.
    // Clear and schedule an immediate background refresh so the next poll succeeds.
    const authErrors = results.filter((r) => r.status === 'error' && /401|unauthorized|token|auth/i.test(r.error || '')).length;
    if (results.length > 0 && authErrors / results.length >= 0.5) {
      console.log(`[irp-auth] Reactive: ${authErrors}/${results.length} auth errors — scheduling immediate token refresh.`);
      clearIrpToken();
      refreshIrpTokenFromProfile(); // fire-and-forget; next poll will use the fresh token
    }

    // Acquire mutex for write-back. Re-read the store so that any source sync that completed
    // while IRP API calls were in-flight is not overwritten. Merge IRP results on top of the
    // fresh rows (rows not touched by IRP are taken as-is from the fresh read).
    return withStoreMutex(async () => {
      const freshStore = await readStore();
      const mergedRows = freshStore.rows.map((row) => byId.get(row.id) ?? row);
      const emailProcessing = await processPendingEmails(mergedRows);
      await writeStore({ ...freshStore, rows: emailProcessing.rows });
      const result = {
        eligible: eligibleRows.length,
        checked: results.length,
        batchSize: resolvedBatchSize,
        batches: results.length > 0 ? Math.ceil(results.length / resolvedBatchSize) : 0,
        emailsSent: emailProcessing.sent,
        emailErrors: emailProcessing.errors,
        results,
        blob: `${CONTAINER}/${STORE_BLOB}`,
      };
      if (!options.suppressRunLog) await appendRun({ type: 'irp', result });
      return result;
    });
  }, options);
}

async function listDossiers({ status = '', search = '', page = 1, pageSize = 50 }) {
  const store = await readStore();
  const allRows = store.rows;

  // Global counts computed before any filter — these power the stats cards in the UI so they
  // always reflect the full store, not just the current page or active tab.
  const summary = {
    total: allRows.length,
    prelodged: allRows.filter(isPreLodgedQueueRow).length,
    no_crn: allRows.filter(isNoCrnQueueRow).length,
    invalidated: allRows.filter(isInvalidatedQueueRow).length,
    errors: allRows.filter(hasValidationError).length,
    email_pending: allRows.filter(isEmailPendingQueueRow).length,
    needs_check: allRows.filter(isNeedsCheckQueueRow).length,
    waiting: allRows.filter(isWaitingQueueRow).length,
    done: allRows.filter((row) => row.record_state === 'done').length,
  };

  let rows = [...allRows];
  if (status === 'prelodged') rows = rows.filter(isPreLodgedQueueRow);
  if (status === 'no_crn') rows = rows.filter(isNoCrnQueueRow);
  if (status === 'invalidated') rows = rows.filter(isInvalidatedQueueRow);
  if (status === 'errors') rows = rows.filter(hasValidationError);
  if (status === 'email_pending') rows = rows.filter(isEmailPendingQueueRow);
  if (status === 'needs_check') rows = rows.filter(isNeedsCheckQueueRow);
  if (status === 'waiting') rows = rows.filter(isWaitingQueueRow);
  if (status === 'done') rows = rows.filter((row) => row.record_state === 'done');
  if (search) {
    const term = search.toLowerCase();
    rows = rows.filter((row) => [
      row.declaration_id,
      row.container_number,
      row.bl,
      row.crn,
      row.mrn,
      row.eori_ship_agent,
      row.eta,
      row.tsd_status,
      row.record_state,
      row.message_status,
      row.last_irp_status,
      row.last_error,
    ].some((value) => String(value || '').toLowerCase().includes(term)));
  }
  rows.sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));
  const total = rows.length;
  const offset = (Number(page) - 1) * Number(pageSize);
  const meta = await readMeta();
  return { rows: rows.slice(offset, offset + Number(pageSize)), total, page: Number(page), pageSize: Number(pageSize), blob: `${CONTAINER}/${STORE_BLOB}`, meta, summary };
}

function summarizeIrpRun(result = {}) {
  const results = Array.isArray(result.results) ? result.results : [];
  const checked = Number(result.checked ?? results.length ?? 0);
  const errors = results.filter((item) => item?.status === 'error').length;
  const noCrn = results.filter((item) => item?.status === 'crn_not_found').length;
  const completed = Math.max(0, checked - errors);
  return {
    checked,
    completed,
    errors,
    noCrn,
  };
}

function summarizeFullRun(run) {
  const source = run?.result?.source || {};
  const irp = summarizeIrpRun(run?.result?.irp || run?.result || {});
  const emailErrors = Number(run?.result?.irp?.emailErrors ?? run?.result?.emailErrors ?? 0);
  const hasIssues = Boolean(source.error || irp.errors > 0 || emailErrors > 0);
  return {
    id: run.id,
    type: run.type,
    startedAt: run.startedAt,
    sourceFetched: source.fetched ?? null,
    sourceInserted: source.inserted ?? null,
    sourceUpdated: source.updated ?? null,
    sourceError: source.error ?? null,
    irpChecked: irp.checked,
    irpCompleted: irp.completed,
    irpErrors: irp.errors,
    irpNoCrn: irp.noCrn,
    emailsSent: run?.result?.irp?.emailsSent ?? run?.result?.emailsSent ?? null,
    emailErrors,
    skipped: run?.result?.skipped === true || run?.skipped === true,
    reason: run?.result?.reason || run?.reason || null,
    status: run?.result?.skipped === true || run?.skipped === true
      ? 'skipped'
      : (hasIssues ? 'issue' : 'completed'),
  };
}

async function listRuns({ limit = 50 } = {}) {
  const runs = await readJsonBlob(RUNS_BLOB, []);
  return {
    runs: runs
      .filter((run) => String(run.type || '').toLowerCase() === 'full')
      .slice(0, Number(limit))
      .map(summarizeFullRun),
  };
}

async function getRecordDetails(id) {
  const store = await readStore();
  const row = store.rows.find((item) => item.id === id);
  if (!row) throw new Error('Record not found');
  return { record: row };
}

async function updateRecordById(id, updater) {
  const store = await readStore();
  const index = store.rows.findIndex((item) => item.id === id);
  if (index === -1) throw new Error('Record not found');
  const nextRow = reconcileRow(await updater(store.rows[index]));
  const rows = [...store.rows];
  rows[index] = nextRow;
  await writeStore({ ...store, rows });
  return nextRow;
}

async function executeRecordAction(id, action) {
  const normalized = String(action || '').trim().toLowerCase();
  if (!normalized) throw new Error('Action is required');

  if (normalized === 'resend_email') {
    const record = await updateRecordById(id, async (row) => {
      if (!row.crn || !row.mrn) throw new Error('Cannot resend email before CRN and MRN exist');
      const emailPayload = await sendNotificationEmail(row);
      return appendRowEvent({
        ...row,
        email_sent_at: nowIso(),
        email_last_error: null,
        email_to: emailPayload.to || '',
        email_cc: emailPayload.cc || '',
        email_subject: emailPayload.subject || '',
        updated_at: nowIso(),
      }, 'email_resent', 'Notification email resent manually.', {
        to: emailPayload.to || '',
        cc: emailPayload.cc || '',
        subject: emailPayload.subject || '',
      });
    });
    return { record };
  }

  if (normalized === 'reopen') {
    const record = await updateRecordById(id, async (row) => appendRowEvent({
      ...row,
      manual_done_at: null,
      // email_suppressed_at is intentionally kept: suppression is an explicit opt-out that
      // survives reopen. If the user also wants email sent they must use resend_email after.
      email_sent_at: null,
      email_last_error: null,
      last_error: null,
      last_irp_status: null,
      closed_at: null,
      updated_at: nowIso(),
    }, 'record_reopened', 'Record reopened manually.', {
      cleared: ['manual_done_at', 'email_sent_at', 'email_last_error', 'last_error', 'last_irp_status', 'closed_at'],
    }));
    return { record };
  }

  if (normalized === 'mark_done') {
    const record = await updateRecordById(id, async (row) => {
      const markedAt = nowIso();
      let next = {
        ...row,
        manual_done_at: markedAt,
        updated_at: markedAt,
      };

      if (row.crn && row.mrn && !row.email_sent_at && !row.email_suppressed_at) {
        try {
          const emailPayload = await sendNotificationEmail(next);
          next = appendRowEvent({
            ...next,
            email_sent_at: nowIso(),
            email_last_error: null,
            email_to: emailPayload.to || '',
            email_cc: emailPayload.cc || '',
            email_subject: emailPayload.subject || '',
            updated_at: nowIso(),
          }, 'email_sent', 'Notification email sent.', {
            to: emailPayload.to || '',
            cc: emailPayload.cc || '',
            subject: emailPayload.subject || '',
          });
        } catch (error) {
          next = appendRowEvent({
            ...next,
            email_last_error: error.message,
            updated_at: nowIso(),
          }, 'email_error', 'Notification email failed.', { error: error.message });
        }
      }

      return appendRowEvent(next, 'record_done', 'Record marked done manually.');
    });
    return { record };
  }

  if (normalized === 'suppress_email') {
    const record = await updateRecordById(id, async (row) => appendRowEvent({
      ...row,
      email_suppressed_at: nowIso(),
      updated_at: nowIso(),
    }, 'email_suppressed', 'Email sending suppressed manually.'));
    return { record };
  }

  throw new Error('Unsupported action');
}

async function sendTestImportReleaseEmail(toOverride = '') {
  const payload = await buildEmailPayload({
    declaration_id: '257979',
    container_number: 'MEDU2900426',
    eta: '2026-05-06',
    bl: '2166031770',
    eori_ship_agent: 'BE0464255361',
    crn: 'CRN123456789',
    mrn: '26BE000000000001',
    tsd_status: 'RELEASED',
    clearance_status: 'CLEARED',
  });
  if (toOverride) payload.to = toOverride;
  const url = process.env.IMPORT_RELEASE_EMAIL_URL;
  if (!url) throw new Error('IMPORT_RELEASE_EMAIL_URL is not configured');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Email Logic App returned HTTP ${response.status}`);
  return { sent: true, to: payload.to, cc: payload.cc || '', subject: payload.subject };
}

async function getImportReleaseHealth() {
  const meta = await readMeta();
  const fullJob = meta.jobs?.full || {};
  const irpJob = meta.jobs?.irp || {};
  const previousSnapshot = await readHealthSnapshot();
  const irpSession = getIrpAuthState();
  const recentRuns = await readJsonBlob(RUNS_BLOB, []);
  const latestFullRun = recentRuns.find((run) => String(run.type || '').toLowerCase() === 'full');
  const latestFullSummary = latestFullRun ? summarizeFullRun(latestFullRun) : null;
  const sourceConfigured = Boolean(process.env.IMPORT_RELEASE_SOURCE_URL) || latestFullSummary?.sourceFetched != null || previousSnapshot.sourceReachable;
  const emailConfigured = Boolean(process.env.IMPORT_RELEASE_EMAIL_URL) || previousSnapshot.emailConfigured;
  const automationEnabled = process.env.IMPORT_RELEASE_AUTOMATION_ENABLED
    ? process.env.IMPORT_RELEASE_AUTOMATION_ENABLED !== '0'
    : (Boolean(latestFullRun) || previousSnapshot.automationRunning);

  // Derive IRP connection validity from in-memory state + recent runtime results.
  const fullIrpResult = fullJob?.lastResult?.irp;
  const irpJobResult = irpJob?.lastResult;
  const recentRuntimeSuccess =
    (fullIrpResult && Number(fullIrpResult.checked || 0) > 0 && Number(fullIrpResult.results?.filter?.((r) => r.status === 'error').length || 0) < Number(fullIrpResult.checked || 0)) ||
    (irpJobResult && Number(irpJobResult.checked || 0) > 0 && Number(irpJobResult.results?.filter?.((r) => r.status === 'error').length || 0) < Number(irpJobResult.checked || 0)) ||
    (latestFullSummary && latestFullSummary.irpChecked > 0 && latestFullSummary.irpErrors < latestFullSummary.irpChecked);

  let irpAuthValid = irpSession.status === 'connected' || recentRuntimeSuccess;
  let irpAuthError = null;

  if (!irpAuthValid) {
    const accountCheck = await fetchIrpAccountStatus();
    irpAuthValid = accountCheck.ok;
    irpAuthError = accountCheck.ok ? null : accountCheck.error;
  }

  const tokenNearExpiry = irpSession.tokenExpiresAt
    ? new Date(irpSession.tokenExpiresAt).getTime() - Date.now() < 10 * 60 * 1000
    : false;

  const irpAuthStateLabel = irpAuthValid
    ? (tokenNearExpiry ? 'expiring' : 'connected')
    : (irpSession.status === 'setup_active' ? 'setup_active' : 'needs_setup');

  const irpAuthDetail = irpAuthValid
    ? (tokenNearExpiry ? 'Connected — token refreshing soon' : 'Connected via browser profile session')
    : (irpSession.status === 'setup_active'
      ? 'Setup in progress — complete login in Settings → IRP Connection'
      : (irpAuthError || 'Session expired — reconnect via Settings → IRP Connection'));

  const snapshot = {
    sourceReachable: sourceConfigured,
    sourceDetail: sourceConfigured ? 'Configured' : 'Missing configuration',
    irpAuthValid,
    irpAuthError,
    irpAuthState: irpAuthStateLabel,
    irpAuthDetail,
    irpSession,                          // replaces old irpCapture / irpRefresh
    emailConfigured,
    emailDetail: emailConfigured ? 'Configured' : 'Missing configuration',
    automationRunning: automationEnabled,
    automationDetail: fullJob?.running?.startedAt ? 'Running' : (automationEnabled ? 'Enabled' : 'Disabled'),
    lastFullRunAt: fullJob?.lastFinishedAt || latestFullRun?.startedAt || previousSnapshot.lastFullRunAt || null,
    fullJobRunning: Boolean(fullJob?.running?.startedAt),
    latestRunStatus: latestFullSummary?.status || null,
    latestRunIrpChecked: latestFullSummary?.irpChecked ?? null,
    latestRunIrpErrors: latestFullSummary?.irpErrors ?? null,
    latestRunIrpCompleted: latestFullSummary?.irpCompleted ?? null,
  };

  await writeHealthSnapshot(snapshot);
  return snapshot;
}


async function clearImportReleaseMeta() {
  await writeMeta({ updatedAt: nowIso(), jobs: {} });
  return { cleared: true, blob: `${CONTAINER}/${META_BLOB}` };
}

async function startImportReleaseAutomation() {
  const enabled = process.env.IMPORT_RELEASE_AUTOMATION_ENABLED !== '0';
  if (!enabled) {
    console.log('[import-release] Automation disabled.');
    return;
  }

  // Boot the IRP auth manager. It loads the browser profile, exchanges cookies
  // for a bearer token, and schedules automatic refresh before token expiry.
  // This runs in the background — automation starts immediately without waiting.
  initIrpAuth().catch((err) => console.error('[irp-auth] Init error:', err.message));

  const intervalMs = Number(process.env.IMPORT_RELEASE_AUTOMATION_INTERVAL_MS || 5 * 60 * 1000);

  const tick = async () => {
    try {
      const result = await runFullSync();
      const skipped = result?.skipped === true || result?.reason === 'cooldown';
      const summary = skipped ? `skipped (${result.reason})` : 'completed';
      console.log(`[import-release] Automated full sync ${summary}.`);
    } catch (error) {
      console.error('[import-release] Automated full sync failed:', error.message);
    }
  };

  await tick();
  setInterval(tick, intervalMs);
  console.log(`[import-release] Automation started. Interval ${Math.round(intervalMs / 1000)}s.`);
}

async function runFullSync(options = {}) {
  return runJob('full', async () => {
    let source;
    try {
      source = await syncSource({ force: true, suppressRunLog: true });
    } catch (error) {
      source = { skipped: true, error: error.message };
    }
    const irp = await pollIrp(Number(process.env.IMPORT_RELEASE_IRP_BATCH_SIZE || 50), { force: true, suppressRunLog: true });
    const result = { source, irp };
    await appendRun({ type: 'full', result });
    return result;
  }, options);
}

async function getImportReleaseSettings() {
  const settings = await readImportReleaseSettings();
  return {
    ...settings,
    available_variables: emailVariableDefinitions(),
  };
}

async function updateImportReleaseSettings(input) {
  const next = {
    version: 1,
    updatedAt: nowIso(),
    email: {
      ...defaultEmailSettings(),
      ...(input?.email || {}),
    },
  };
  await writeImportReleaseSettings(next);
  return getImportReleaseSettings();
}

export { SOURCE_QUERY, clearImportReleaseMeta, executeRecordAction, getImportReleaseHealth, getImportReleaseSettings, getIrpAuthState, getRecordDetails, getIrpSetupScreenshot, listDossiers, listRuns, pollIrp, runFullSync, sendIrpSetupInput, sendTestImportReleaseEmail, startImportReleaseAutomation, startIrpSetupSession, stopIrpSetupSession, syncSource, refreshIrpTokenFromProfile, updateImportReleaseSettings };
