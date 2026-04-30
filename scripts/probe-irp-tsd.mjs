import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function resolveProjectPath(value, fallbackName) {
  const target = String(value || fallbackName || '').trim();
  if (!target) return '';
  return path.isAbsolute(target) ? target : path.join(ROOT, target);
}

function parseCookie(cookie) {
  return Object.fromEntries(
    String(cookie || '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        return index === -1 ? [part, ''] : [part.slice(0, index), part.slice(index + 1)];
      }),
  );
}

function cookieHeader(cookies) {
  return Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join('; ');
}

function normalizeBearerToken(value) {
  return String(value || '').replace(/^Bearer\s+/i, '').trim();
}

function toNumericValue(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value).trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function getNestedValue(object, dottedPath) {
  return String(dottedPath || '')
    .split('.')
    .filter(Boolean)
    .reduce((current, key) => (current == null ? undefined : current[key]), object);
}

function firstNumericValue(object, paths) {
  for (const dottedPath of paths) {
    const value = toNumericValue(getNestedValue(object, dottedPath));
    if (value != null) return { path: dottedPath, value };
  }
  return { path: null, value: null };
}

function extractIrpTotals(payload) {
  const packages = firstNumericValue(payload, [
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

  const gross = firstNumericValue(payload, [
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

  return {
    packages,
    gross,
  };
}

function collectInterestingPaths(value, prefix = '', result = [], depth = 0) {
  if (depth > 6 || value == null) return result;

  const interesting = /(package|gross|mass|release|written|customs|declarant|remaining|total)/i;

  if (Array.isArray(value)) {
    value.slice(0, 10).forEach((item, index) => {
      collectInterestingPaths(item, `${prefix}[${index}]`, result, depth + 1);
    });
    return result;
  }

  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      if (child != null && typeof child !== 'object') {
        if (interesting.test(nextPrefix)) {
          result.push({ path: nextPrefix, value: child });
        }
      } else {
        collectInterestingPaths(child, nextPrefix, result, depth + 1);
      }
    }
  }

  return result;
}

async function readIrpCaptureAuth() {
  const filePath = resolveProjectPath(process.env.IRP_CAPTURE_FILE, 'irp.json');
  const raw = await fs.readFile(filePath, 'utf8');
  const entries = JSON.parse(raw);
  if (!Array.isArray(entries)) return {};
  const sorted = [...entries].sort((a, b) => {
    const ta = a.capturedAt ? new Date(a.capturedAt).getTime() : 0;
    const tb = b.capturedAt ? new Date(b.capturedAt).getTime() : 0;
    return tb - ta;
  });
  const bearerEntry = sorted.find((entry) => typeof entry.cookie === 'string' && entry.cookie.trim().startsWith('Bearer '));
  const sessionEntry = sorted.find((entry) => typeof entry.cookie === 'string' && entry.cookie.includes('__Secure-next-auth'));
  return {
    bearerToken: normalizeBearerToken(bearerEntry?.cookie),
    sessionCookie: sessionEntry?.cookie || null,
    captureFile: filePath,
  };
}

async function exchangeSessionCookieForToken(sessionCookie) {
  const response = await fetch('https://irp.nxtport.com/api/auth/session', {
    headers: {
      Accept: 'application/json',
      Cookie: cookieHeader(parseCookie(sessionCookie)),
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://irp.nxtport.com/search',
    },
  });
  if (!response.ok) throw new Error(`IRP session returned HTTP ${response.status}`);
  const data = await response.json();
  if (!data.idToken) throw new Error('IRP session did not return an idToken');
  return data.idToken;
}

async function getIrpToken() {
  const envBearer = normalizeBearerToken(process.env.IRP_BEARER_TOKEN);
  if (envBearer) return { token: envBearer, source: 'env-bearer' };

  const captured = await readIrpCaptureAuth();
  if (captured.sessionCookie) {
    try {
      const token = await exchangeSessionCookieForToken(captured.sessionCookie);
      return { token, source: 'session-cookie' };
    } catch (error) {
      if (captured.bearerToken) {
        return { token: captured.bearerToken, source: `captured-bearer-fallback (${error.message})` };
      }
      throw error;
    }
  }

  if (captured.bearerToken) return { token: captured.bearerToken, source: 'captured-bearer' };
  throw new Error('No IRP auth available. Provide irp.json, IRP_SESSION_COOKIE, or IRP_BEARER_TOKEN.');
}

async function callIrpEndpoint(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Active-Role': 'LSP',
      'User-Agent': 'Mozilla/5.0',
    },
  });

  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const body = isJson ? await response.json() : await response.text();
  return {
    status: response.status,
    ok: response.ok,
    contentType,
    body,
  };
}

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

async function main() {
  const args = process.argv.slice(2);
  const crn = args.find((arg) => !arg.startsWith('--')) || process.env.IRP_PROBE_CRN;
  if (!crn) {
    console.error('Usage: npm run irp:probe -- <CRN>');
    process.exit(1);
  }

  const save = args.includes('--save');
  const { token, source } = await getIrpToken();
  console.log(`[irp-probe] Using auth source: ${source}`);
  console.log(`[irp-probe] CRN: ${crn}`);

  const endpoints = [
    { label: 'TSD detail', path: `/irp-bff/v1/tsd/${encodeURIComponent(crn)}` },
    { label: 'TSD LSP IRP', path: `/irp-bff/v1/tsd/${encodeURIComponent(crn)}/lsp-irp` },
    { label: 'TSD write-off', path: `/irp-bff/v1/tsd/${encodeURIComponent(crn)}/write-off` },
  ];

  const results = {};
  for (const endpoint of endpoints) {
    printSection(endpoint.label);
    const url = `https://api.irp.nxtport.com${endpoint.path}`;
    const result = await callIrpEndpoint(url, token);
    results[endpoint.label] = { url, ...result };

    console.log(`URL: ${url}`);
    console.log(`HTTP: ${result.status}`);

    if (!result.ok) {
      console.log(`Body: ${typeof result.body === 'string' ? result.body.slice(0, 500) : JSON.stringify(result.body, null, 2).slice(0, 1000)}`);
      continue;
    }

    if (typeof result.body !== 'object' || result.body == null) {
      console.log(`Body: ${String(result.body).slice(0, 1000)}`);
      continue;
    }

    console.log(`Top-level keys: ${Object.keys(result.body).join(', ') || '(none)'}`);
    const totals = extractIrpTotals(result.body);
    console.log(`Detected packages: ${totals.packages.value ?? '-'} ${totals.packages.path ? `(path: ${totals.packages.path})` : ''}`);
    console.log(`Detected gross: ${totals.gross.value ?? '-'} ${totals.gross.path ? `(path: ${totals.gross.path})` : ''}`);

    const interesting = collectInterestingPaths(result.body).slice(0, 30);
    if (interesting.length) {
      console.log('Interesting fields:');
      for (const item of interesting) {
        console.log(`- ${item.path}: ${JSON.stringify(item.value)}`);
      }
    } else {
      console.log('Interesting fields: none found by heuristic');
    }
  }

  if (save) {
    const outDir = path.join(ROOT, '.tmp');
    await fs.mkdir(outDir, { recursive: true });
    const outFile = path.join(outDir, `irp-probe-${crn}.json`);
    await fs.writeFile(outFile, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
    console.log(`\n[irp-probe] Saved raw responses to ${outFile}`);
  }
}

main().catch((error) => {
  console.error('[irp-probe] Failed:', error.message);
  process.exit(1);
});
