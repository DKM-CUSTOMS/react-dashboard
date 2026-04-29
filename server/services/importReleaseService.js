import { BlobServiceClient } from '@azure/storage-blob';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const CONTAINER = 'document-intelligence';
const STORE_BLOB = 'IMPORT_IRP/dossiers.json';
const RUNS_BLOB = 'IMPORT_IRP/runs.json';
const META_BLOB = 'IMPORT_IRP/meta.json';
const SETTINGS_BLOB = 'IMPORT_IRP/settings.json';
const TSD_BASE = 'https://api.irp.nxtport.com/irp-bff/v1/tsd';
const ACTIVE_MESSAGE_STATUSES = new Set(['CREATE', 'DMSREJ', 'DMSCTL']);
const DONE_MESSAGE_STATUSES = new Set(['DMSCLE']);
let cachedIrpToken = null;

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

function cacheToken(token, source) {
  const payload = decodeJwtPayload(token);
  const expiresAtMs = payload?.exp ? payload.exp * 1000 : Date.now() + 30 * 60 * 1000;
  cachedIrpToken = { token, source, expiresAtMs };
  return token;
}

function getCachedToken() {
  if (!cachedIrpToken?.token) return null;
  const refreshBeforeMs = Number(process.env.IRP_TOKEN_REFRESH_BEFORE_MS || 2 * 60 * 60 * 1000);
  if (cachedIrpToken.expiresAtMs - Date.now() <= refreshBeforeMs) return null;
  return cachedIrpToken.token;
}
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

async function writeStore(store) {
  await writeJsonBlob(STORE_BLOB, { ...store, updatedAt: nowIso() });
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
        first_source_message_status: existing.first_source_message_status || existing.message_status || incoming.message_status,
        source: existing.source || source,
        created_at: existing.created_at,
        updated_at: nowIso(),
        last_source_sync_at: nowIso(),
      });
      const sourceChanges = {};
      for (const field of ['message_status', 'eta', 'bl', 'eori_ship_agent']) {
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

function isPreLodgedQueueRow(row) {
  return !isDoneRecord(row) && !hasValidationError(row) && Boolean(row.crn) && !row.mrn && normalizeStatus(row.tsd_status) !== 'INVALIDATED';
}

function isNoCrnQueueRow(row) {
  return !isDoneRecord(row) && !hasValidationError(row) && !row.crn && (row.last_irp_status === 'crn_not_found' || row.last_error === 'CRN not found');
}

function isInvalidatedQueueRow(row) {
  return !isDoneRecord(row) && !hasValidationError(row) && normalizeStatus(row.tsd_status) === 'INVALIDATED';
}

function isMrnFoundQueueRow(row) {
  return !isDoneRecord(row) && !hasValidationError(row) && Boolean(row.mrn);
}

function isWaitingQueueRow(row) {
  return !isDoneRecord(row) && !hasValidationError(row) && row.record_state === 'waiting';
}

function isActiveMessageStatus(row) {
  return ACTIVE_MESSAGE_STATUSES.has(normalizeStatus(row.message_status));
}

function hasReleaseOutcome(row) {
  return Boolean(row.crn && row.mrn);
}

function getInitialSourceMessageStatus(row) {
  const explicit = normalizeStatus(row.first_source_message_status || '');
  if (explicit) return explicit;

  const history = Array.isArray(row.history) ? row.history : [];
  const sourceAdded = history.find((event) => String(event?.type || '').toLowerCase() === 'source_added');
  const addedStatus = normalizeStatus(sourceAdded?.data?.message_status || '');
  if (addedStatus) return addedStatus;

  const oldestBefore = [...history]
    .reverse()
    .find((event) => String(event?.type || '').toLowerCase() === 'source_updated' && event?.data?.message_status?.before);
  const beforeStatus = normalizeStatus(oldestBefore?.data?.message_status?.before || '');
  if (beforeStatus) return beforeStatus;

  return normalizeStatus(row.message_status || '');
}

function isDoneMessageStatus(row) {
  if (!DONE_MESSAGE_STATUSES.has(normalizeStatus(row.message_status))) return false;
  if (row.crn && !row.mrn) return false;

  const originalStatus = getInitialSourceMessageStatus(row);
  if (originalStatus) return DONE_MESSAGE_STATUSES.has(originalStatus);
  return false;
}

function isDoneTsdStatus(row) {
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
  if (hasReleaseOutcome(row) && row.email_sent_at) return true;
  if (row.manual_done_at) return true;
  if (row.email_suppressed_at) return true;
  return false;
}

function getDoneReason(row) {
  if (isDoneMessageStatus(row)) return 'message_status_dmscle';
  if (hasReleaseOutcome(row) && row.email_sent_at) return 'release_emailed';
  if (row.manual_done_at) return 'manual_done';
  if (row.email_suppressed_at) return 'email_suppressed';
  return null;
}

function getRecordState(row) {
  if ((row.validation_errors || []).length > 0) return 'error';
  if (isDoneRecord(row)) return 'done';
  if (!isActiveMessageStatus(row) && !isPreLodgedTrackingRow(row)) return 'inactive';
  return isWithinEtaWindow(row) ? 'due' : 'waiting';
}

function reconcileRow(row) {
  const next = {
    ...row,
    message_status: normalizeStatus(row.message_status),
    tsd_status: normalizeStatus(row.tsd_status),
    history: Array.isArray(row.history) ? row.history : [],
  };
  next.validation_errors = getLookupValidationErrors(next);
  next.lookup_ready = next.validation_errors.length === 0;
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
  return Boolean(isActiveMessageStatus(row) && row.crn && row.mrn && !row.email_sent_at);
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
    const incoming = await fetchSourceDeclarations();
    const store = await readStore();
    const merged = mergeRows(store.rows, incoming, 'logic_app');
    await writeStore({ ...store, rows: merged.rows });
    const result = { fetched: incoming.length, inserted: merged.inserted, updated: merged.updated, blob: `${CONTAINER}/${STORE_BLOB}` };
    if (!options.suppressRunLog) await appendRun({ type: 'source', result });
    return result;
  }, options);
}

const parseCookie = (cookie) => Object.fromEntries(String(cookie || '').split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
  const index = part.indexOf('=');
  return index === -1 ? [part, ''] : [part.slice(0, index), part.slice(index + 1)];
}));
const cookieHeader = (cookies) => Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join('; ');

async function readIrpCaptureAuth() {
  const filePath = process.env.IRP_CAPTURE_FILE || path.resolve(process.cwd(), 'irp.json');
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) return {};
    const bearerEntry = entries.find((entry) => typeof entry.cookie === 'string' && entry.cookie.trim().startsWith('Bearer '));
    const sessionEntry = entries.find((entry) => typeof entry.cookie === 'string' && entry.cookie.includes('__Secure-next-auth'));
    return {
      bearerToken: bearerEntry?.cookie?.trim().replace(/^Bearer\s+/i, '') || null,
      sessionCookie: sessionEntry?.cookie || null,
    };
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`Could not read IRP capture file: ${error.message}`);
  }
}

async function getIrpCaptureStatus() {
  const captured = await readIrpCaptureAuth();
  const bearerPayload = captured.bearerToken ? decodeJwtPayload(captured.bearerToken) : null;
  const bearerExpiresAt = bearerPayload?.exp ? new Date(bearerPayload.exp * 1000).toISOString() : null;
  const refreshBeforeMs = Number(process.env.IRP_TOKEN_REFRESH_BEFORE_MS || 2 * 60 * 60 * 1000);
  const tokenRemainingMs = bearerPayload?.exp ? (bearerPayload.exp * 1000) - Date.now() : null;

  return {
    hasBearerCapture: Boolean(captured.bearerToken),
    hasSessionCookieCapture: Boolean(captured.sessionCookie),
    bearerExpiresAt,
    bearerExpired: tokenRemainingMs != null ? tokenRemainingMs <= 0 : null,
    tokenNearExpiry: tokenRemainingMs != null ? tokenRemainingMs <= refreshBeforeMs : null,
    captureFile: process.env.IRP_CAPTURE_FILE || 'irp.json',
  };
}

async function getIrpToken(options = {}) {
  const cached = options.skipCache ? null : getCachedToken();
  if (cached) return cached;

  if (!options.skipBearer && process.env.IRP_BEARER_TOKEN) return cacheToken(process.env.IRP_BEARER_TOKEN, 'env');

  const captured = await readIrpCaptureAuth();
  const sessionCookie = process.env.IRP_SESSION_COOKIE || captured.sessionCookie;
  if (sessionCookie) {
    const response = await fetch('https://irp.nxtport.com/api/auth/session', { headers: { Accept: 'application/json', Cookie: cookieHeader(parseCookie(sessionCookie)), 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) throw new Error(`IRP session returned HTTP ${response.status}`);
    const data = await response.json();
    if (!data.idToken) throw new Error('IRP session did not return an idToken');
    return cacheToken(data.idToken, 'session-cookie');
  }
  if (!options.skipBearer && captured.bearerToken) return cacheToken(captured.bearerToken, 'irp.json');
  if (process.env.IMPORT_RELEASE_IRP_URL) return null;
  throw new Error('IRP authentication is not configured. Set IRP_BEARER_TOKEN, IRP_SESSION_COOKIE, IMPORT_RELEASE_IRP_URL, or provide irp.json.');
}

async function checkIrpViaLogicApp(row) {
  const response = await fetch(process.env.IMPORT_RELEASE_IRP_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row) });
  if (!response.ok) throw new Error(`IRP Logic App returned HTTP ${response.status}`);
  return response.json();
}


async function irpFetch(pathname, headers, context) {
  const response = await fetch(`${TSD_BASE}${pathname}`, { headers });
  if (response.status !== 401 || context?.retriedAuth) return response;

  cachedIrpToken = null;
  const freshToken = await getIrpToken({ skipCache: true, skipBearer: true });
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
    cachedIrpToken = null;
    try {
      const freshToken = await getIrpToken({ skipCache: true, skipBearer: true });
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
async function checkIrpDirect(row) {
  const token = await getIrpToken();
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
  return { crn, mrn: info.mrn || null, tsd_status: info.status?.tsd || '', clearance_status: info.status?.clearance || '' };
}
function shouldCheckIrp(row) {
  if (!row.lookup_ready) return false;
  if (!isActiveMessageStatus(row) && !isPreLodgedTrackingRow(row)) return false;
  if (isDoneRecord(row)) return false;
  return isWithinEtaWindow(row);
}

async function pollIrp(limit = 50, options = {}) {
  return runJob('irp', async () => {
    const store = await readStore();
    const candidates = store.rows.filter(shouldCheckIrp).sort((a, b) => new Date(a.last_irp_check_at || 0) - new Date(b.last_irp_check_at || 0)).slice(0, Number(limit));
    const byId = new Map(store.rows.map((row) => [row.id, row]));
    const results = [];
    for (const row of candidates) {
      try {
        const irp = await checkIrpDirect(row);
        const next = appendRowEvent(
          reconcileRow({ ...row, ...irp, last_irp_status: irp.status || 'checked', lookup: irp.lookup || row.lookup || null, last_irp_check_at: nowIso(), last_error: null, updated_at: nowIso() }),
          'irp_checked',
          'IRP check completed.',
          { status: irp.status || 'checked', crn: irp.crn || null, mrn: irp.mrn || null, tsd_status: irp.tsd_status || null }
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
        byId.set(row.id, appendRowEvent(
          reconcileRow({ ...row, last_irp_status: 'error', last_irp_check_at: nowIso(), last_error: error.message, updated_at: nowIso() }),
          'irp_error',
          'IRP check failed.',
          { error: error.message }
        ));
        results.push({ id: row.id, declarationId: row.declaration_id, status: 'error', error: error.message });
      }
    }
    const emailProcessing = await processPendingEmails([...byId.values()]);
    await writeStore({ ...store, rows: emailProcessing.rows });
    const result = { checked: results.length, emailsSent: emailProcessing.sent, emailErrors: emailProcessing.errors, results, blob: `${CONTAINER}/${STORE_BLOB}` };
    if (!options.suppressRunLog) await appendRun({ type: 'irp', result });
    return result;
  }, options);
}

async function listDossiers({ status = '', search = '', page = 1, pageSize = 50 }) {
  const store = await readStore();
  let rows = [...store.rows];
  if (status === 'prelodged') rows = rows.filter(isPreLodgedQueueRow);
  if (status === 'no_crn') rows = rows.filter(isNoCrnQueueRow);
  if (status === 'invalidated') rows = rows.filter(isInvalidatedQueueRow);
  if (status === 'errors') rows = rows.filter(hasValidationError);
  if (status === 'mrn_found') rows = rows.filter(isMrnFoundQueueRow);
  if (status === 'waiting') rows = rows.filter(isWaitingQueueRow);
  if (status === 'done') rows = rows.filter((row) => row.record_state === 'done');
  if (search) {
    const term = search.toLowerCase();
    rows = rows.filter((row) => [row.declaration_id, row.container_number, row.bl, row.crn, row.mrn].some((value) => String(value || '').toLowerCase().includes(term)));
  }
  rows.sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));
  const total = rows.length;
  const offset = (Number(page) - 1) * Number(pageSize);
  const meta = await readMeta();
  return { rows: rows.slice(offset, offset + Number(pageSize)), total, page: Number(page), pageSize: Number(pageSize), blob: `${CONTAINER}/${STORE_BLOB}`, meta };
}

async function listRuns({ limit = 50 } = {}) {
  const runs = await readJsonBlob(RUNS_BLOB, []);
  return {
    runs: runs
      .filter((run) => String(run.type || '').toLowerCase() === 'full')
      .slice(0, Number(limit))
      .map((run) => ({
      id: run.id,
      type: run.type,
      startedAt: run.startedAt,
      sourceFetched: run.result?.source?.fetched ?? null,
      sourceInserted: run.result?.source?.inserted ?? null,
      sourceUpdated: run.result?.source?.updated ?? null,
      sourceError: run.result?.source?.error ?? null,
      irpChecked: run.result?.irp?.checked ?? run.result?.checked ?? null,
      emailsSent: run.result?.irp?.emailsSent ?? run.result?.emailsSent ?? null,
      emailErrors: run.result?.irp?.emailErrors ?? run.result?.emailErrors ?? null,
      skipped: run.result?.skipped === true || run.skipped === true,
      reason: run.result?.reason || run.reason || null,
    })),
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
      email_suppressed_at: null,
      email_sent_at: null,
      email_last_error: null,
      last_error: null,
      last_irp_status: null,
      closed_at: null,
      updated_at: nowIso(),
    }, 'record_reopened', 'Record reopened manually.', {
      cleared: ['manual_done_at', 'email_suppressed_at', 'email_sent_at', 'email_last_error', 'last_error', 'last_irp_status', 'closed_at'],
    }));
    return { record };
  }

  if (normalized === 'mark_done') {
    const record = await updateRecordById(id, async (row) => appendRowEvent({
      ...row,
      manual_done_at: nowIso(),
      updated_at: nowIso(),
    }, 'record_done', 'Record marked done manually.'));
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
  const sourceJob = meta.jobs?.source || {};
  const fullJob = meta.jobs?.full || {};
  const irpJob = meta.jobs?.irp || {};
  const captureStatus = await getIrpCaptureStatus();

  let irpAuthValid = false;
  let irpAuthError = null;

  const fullIrpResult = fullJob?.lastResult?.irp;
  const irpResult = irpJob?.lastResult;
  const recentRuntimeSuccess =
    (fullIrpResult && Number(fullIrpResult.checked || 0) > 0 && Number(fullIrpResult.results?.filter?.((r) => r.status === 'error').length || 0) < Number(fullIrpResult.checked || 0)) ||
    (irpResult && Number(irpResult.checked || 0) > 0 && Number(irpResult.results?.filter?.((r) => r.status === 'error').length || 0) < Number(irpResult.checked || 0));

  if (recentRuntimeSuccess) {
    irpAuthValid = true;
  } else {
    const irpAuth = await fetchIrpAccountStatus();
    irpAuthValid = irpAuth.ok;
    irpAuthError = irpAuth.ok ? null : irpAuth.error;
  }

  const irpAuthState = irpAuthValid
    ? (captureStatus.tokenNearExpiry ? 'expiring' : 'connected')
    : 'manual_refresh_required';
  const irpAuthDetail = irpAuthValid
    ? (
      captureStatus.hasSessionCookieCapture
        ? 'Connected through the saved trusted profile session'
        : (captureStatus.tokenNearExpiry ? 'Connected, session refresh recommended soon' : 'Connected')
    )
    : 'Session refresh required from a trusted local browser profile';
  const sessionWindowLabel = captureStatus.hasSessionCookieCapture
    ? 'Trusted profile session in use'
    : (captureStatus.bearerExpiresAt ? 'Captured bearer token window' : 'No token window available');
  const sessionWindowDetail = captureStatus.hasSessionCookieCapture
    ? (
      captureStatus.bearerExpiresAt
        ? `The saved browser session is active. The last captured bearer token was issued for a window ending ${new Date(captureStatus.bearerExpiresAt).toLocaleString()}.`
        : 'The saved browser session is active.'
    )
    : (
      captureStatus.bearerExpiresAt
        ? `Captured bearer token expires ${new Date(captureStatus.bearerExpiresAt).toLocaleString()}.`
        : 'No token expiry available.'
    );

  return {
    sourceReachable: Boolean(process.env.IMPORT_RELEASE_SOURCE_URL) && !sourceJob?.lastError,
    irpAuthValid,
    irpAuthError,
    irpAuthState,
    irpAuthDetail,
    irpCapture: captureStatus,
    sessionWindowLabel,
    sessionWindowDetail,
    emailConfigured: Boolean(process.env.IMPORT_RELEASE_EMAIL_URL),
    automationRunning: process.env.IMPORT_RELEASE_AUTOMATION_ENABLED !== '0',
    lastFullRunAt: fullJob?.lastFinishedAt || null,
    fullJobRunning: Boolean(fullJob?.running?.startedAt),
    localRefreshProcedure: [
      'Open the trusted local Dashboard project folder.',
      'Run npm run irp:auth.',
      'If Chromium opens, let the saved profile load IRP and complete login only if requested.',
      'Wait for irp.json to refresh, then redeploy or sync the updated auth file.',
      'Return here and confirm IRP Auth shows connected.',
    ],
  };
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
    const irp = await pollIrp(Number(process.env.IMPORT_RELEASE_POLL_LIMIT || 50), { force: true, suppressRunLog: true });
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

export { SOURCE_QUERY, clearImportReleaseMeta, executeRecordAction, getImportReleaseHealth, getImportReleaseSettings, getRecordDetails, listDossiers, listRuns, pollIrp, runFullSync, sendTestImportReleaseEmail, startImportReleaseAutomation, syncSource, updateImportReleaseSettings };
