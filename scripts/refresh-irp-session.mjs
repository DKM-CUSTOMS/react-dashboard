import fs from 'fs/promises';
import path from 'path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const PROFILE_DIR = process.env.IRP_BROWSER_PROFILE || path.join(ROOT, '.irp-browser-profile');
const OUTPUT_FILE = process.env.IRP_CAPTURE_FILE || path.join(ROOT, 'irp.json');
const HEADLESS = process.env.IRP_HEADLESS === '1';
const LOGIN_URL = process.env.IRP_LOGIN_URL || 'https://irp.nxtport.com/search';
const KEEP_OPEN_MS = Number(process.env.IRP_CAPTURE_WINDOW_MS || 180000);
const REFRESH_BEFORE_MS = Number(process.env.IRP_REFRESH_BEFORE_MS || 15 * 60 * 1000);
const FORCE_REFRESH = process.env.IRP_FORCE_REFRESH === '1';

const captures = new Map();

function upsertCapture(key, patch) {
  captures.set(key, {
    ...(captures.get(key) || {}),
    ...patch,
    capturedAt: new Date().toISOString(),
  });
}


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

async function readExistingCapture() {
  try {
    const raw = await fs.readFile(OUTPUT_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function getBearerToken(entry) {
  const value = entry?.cookie || entry?.authorization || '';
  return String(value).replace(/^Bearer\s+/i, '').trim();
}

async function validateBearerToken(entries) {
  const bearerEntry = entries.find((entry) => String(entry?.cookie || '').trim().startsWith('Bearer '));
  if (!bearerEntry) return { hasBearer: false, valid: false };

  const token = getBearerToken(bearerEntry);
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return { hasBearer: true, valid: false, reason: 'Bearer token has no readable exp claim' };

  const expiresAtMs = payload.exp * 1000;
  const remainingMs = expiresAtMs - Date.now();
  const basic = {
    hasBearer: true,
    valid: remainingMs > REFRESH_BEFORE_MS,
    expiresAt: new Date(expiresAtMs).toISOString(),
    remainingMinutes: Math.floor(remainingMs / 60000),
    refreshBeforeMinutes: Math.floor(REFRESH_BEFORE_MS / 60000),
  };

  if (!basic.valid) return basic;

  try {
    const response = await fetch('https://api.irp.nxtport.com/irp-bff/v1/account', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Active-Role': 'LSP',
        'User-Agent': 'Mozilla/5.0',
      },
    });
    if (response.ok) return { ...basic, valid: true, checkedAccount: true };
    return { ...basic, valid: false, checkedAccount: true, reason: `IRP account returned HTTP ${response.status}` };
  } catch (error) {
    return { ...basic, valid: false, checkedAccount: true, reason: error.message };
  }
}
function cookieHeader(cookies) {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

async function writeCapture(context) {
  const cookies = await context.cookies(['https://irp.nxtport.com', 'https://api.irp.nxtport.com']);
  const sessionCookie = cookieHeader(cookies.filter((cookie) =>
    ['ASLBSA', 'ASLBSACORS'].includes(cookie.name) || cookie.name.includes('next-auth')
  ));

  if (sessionCookie) {
    upsertCapture('session', {
      'Request URL': 'https://irp.nxtport.com/api/auth/session',
      cookie: sessionCookie,
      source: 'playwright-persistent-profile',
    });
  }

  const data = [...captures.values()];
  await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`[irp-auth] Wrote ${data.length} capture(s) to ${OUTPUT_FILE}`);
}

async function main() {
  const existing = await readExistingCapture();
  const tokenStatus = await validateBearerToken(existing);

  if (!FORCE_REFRESH && tokenStatus.valid) {
    console.log(`[irp-auth] Existing bearer token is still valid until ${tokenStatus.expiresAt} (${tokenStatus.remainingMinutes} minutes left).`);
    console.log('[irp-auth] Skipping browser refresh. Set IRP_FORCE_REFRESH=1 to force it.');
    return;
  }

  if (tokenStatus.hasBearer) {
    console.log(`[irp-auth] Existing bearer token needs refresh. Expires at: ${tokenStatus.expiresAt || 'unknown'}. ${tokenStatus.reason || ''}`.trim());
  } else {
    console.log('[irp-auth] No bearer token found in irp.json; opening browser profile.');
  }

  for (const entry of existing) {
    const key = String(entry?.cookie || '').startsWith('Bearer ') ? 'bearer' : String(entry.source || entry['Request URL'] || Math.random());
    captures.set(key, entry);
  }

  console.log(`[irp-auth] Using browser profile: ${PROFILE_DIR}`);
  console.log('[irp-auth] If IRP asks for MFA, complete it in the opened browser. The profile is reused on future runs.');
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: HEADLESS,
    viewport: { width: 1400, height: 900 },
    channel: process.env.IRP_CHROME_CHANNEL || 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
  });

  context.on('request', async (request) => {
    const url = request.url();
    const headers = request.headers();
    const authorization = headers.authorization || headers.Authorization;

    if (url.includes('api.irp.nxtport.com/irp-bff') && authorization?.startsWith('Bearer ')) {
      upsertCapture('bearer', {
        'Request URL': url,
        cookie: authorization,
        origin: headers.origin || 'https://irp.nxtport.com',
        source: 'playwright-network-request',
      });
      await writeCapture(context);
    }

    if (url.includes('irp.nxtport.com/api/auth/session')) {
      await writeCapture(context);
    }
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

  console.log(`[irp-auth] Browser open for ${Math.round(KEEP_OPEN_MS / 1000)}s to capture IRP auth traffic.`);
  console.log('[irp-auth] Open/search IRP normally if the capture is not written immediately.');
  await page.waitForTimeout(KEEP_OPEN_MS);
  await writeCapture(context);
  await context.close();
}

main().catch((error) => {
  console.error('[irp-auth] Failed:', error.message);
  if (error.message.includes("Cannot find package 'playwright'")) {
    console.error('[irp-auth] Install once with: npm install -D playwright');
    console.error('[irp-auth] Then install the browser with: npx playwright install chromium');
  }
  process.exit(1);
});


