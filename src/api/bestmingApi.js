// API for BestMing Signatures — fetches from Logic App via backend proxy
// Backend route: GET /api/fiscal/bestming-docs
//
// ── Toggle mock data ────────────────────────────────────────────────────────
// Set USE_MOCK = false when the Logic App backend route is live.
const USE_MOCK = false;
// ────────────────────────────────────────────────────────────────────────────

const FISCAL_API_BASE = '/api/fiscal';
const PRECHECK_SESSION_CACHE_KEY = 'BESTMING_PRECHECK_CACHE_V1';
const PRECHECK_CACHE_TTL_MS = 5 * 60 * 1000;

// ─── Mock Dataset ────────────────────────────────────────────────────────────
const MOCK_DATA = [
  // KLANT === RELATIECODE_KLANT → no ICL tag
  { DECLARATION_ID: 1675,  ACTIVECOMPANY: 'DKM_NLD',   TRACESIDENTIFICATION: 'BEST - PRIO',         FISCALCONSIGNEECODE: 'BSN TRADIN',  IMPORTERCODE: 'BSN TRADIN',  IMPORTERCOUNTRY: 'BE', LINKIDERP4: null,    MESSAGESTATUS: 'DMSCLE', PRINCIPAL: ' ',       DATEOFACCEPTANCE: '2024-07-18T00:00:00', PROCESSFACTUURNUMMER: 2008000041, C88NUMMER: 1675,  RELATIECODE_KLANT: 'BSN TRADIN',  KLANT: 'BSN TRADIN'  },
  // KLANT !== RELATIECODE_KLANT → ICL tag
  { DECLARATION_ID: 35238, ACTIVECOMPANY: 'DKM_NLD',   TRACESIDENTIFICATION: 'BEST - CMR',           FISCALCONSIGNEECODE: 'DRAGOMOCAB',  IMPORTERCODE: 'DRAGOMOCAB',  IMPORTERCOUNTRY: 'DE', LINKIDERP4: null,    MESSAGESTATUS: 'CREATE', PRINCIPAL: 'VANHOOL', DATEOFACCEPTANCE: '2025-03-04T00:00:00', PROCESSFACTUURNUMMER: 2009000005, C88NUMMER: 35238, RELATIECODE_KLANT: 'DRAGOMOCAB',  KLANT: 'VANHOOL'     },
  { DECLARATION_ID: 1944,  ACTIVECOMPANY: 'DKM_NLD',   TRACESIDENTIFICATION: 'BEST- PRIO',           FISCALCONSIGNEECODE: 'FEDERGLOBA',  IMPORTERCODE: 'FEDERGLOBA',  IMPORTERCOUNTRY: 'BE', LINKIDERP4: null,    MESSAGESTATUS: 'DMSCLE', PRINCIPAL: ' ',       DATEOFACCEPTANCE: '2024-08-14T00:00:00', PROCESSFACTUURNUMMER: 2008000002, C88NUMMER: 1944,  RELATIECODE_KLANT: 'FEDERGLOBA',  KLANT: 'FEDERGLOBA'  },
  { DECLARATION_ID: 2309,  ACTIVECOMPANY: 'DKM_NLD',   TRACESIDENTIFICATION: 'BEST- PRIO',           FISCALCONSIGNEECODE: 'FEDERGLOBA',  IMPORTERCODE: 'FEDERGLOBA',  IMPORTERCOUNTRY: 'BE', LINKIDERP4: null,    MESSAGESTATUS: 'DMSCLE', PRINCIPAL: ' ',       DATEOFACCEPTANCE: '2024-10-01T00:00:00', PROCESSFACTUURNUMMER: 2008000007, C88NUMMER: 2309,  RELATIECODE_KLANT: 'FEDERGLOBA',  KLANT: 'FEDERGLOBA'  },
  { DECLARATION_ID: 3238,  ACTIVECOMPANY: 'LILY_MAAS', TRACESIDENTIFICATION: 'BEST - PRIO - CM.RNL', FISCALCONSIGNEECODE: 'VANCA',       IMPORTERCODE: 'VANCA',       IMPORTERCOUNTRY: 'BE', LINKIDERP4: 'LINK4', MESSAGESTATUS: 'DELETED',PRINCIPAL: ' ',       DATEOFACCEPTANCE: '2024-05-03T07:27:32', PROCESSFACTUURNUMMER: 2008000007, C88NUMMER: 3238,  RELATIECODE_KLANT: 'VANCA',       KLANT: 'VANCA'       },
  // ICL
  { DECLARATION_ID: 4112,  ACTIVECOMPANY: 'DKM_NLD',   TRACESIDENTIFICATION: 'BEST - PRIO',          FISCALCONSIGNEECODE: 'ALPHATRANS',  IMPORTERCODE: 'ALPHATRANS',  IMPORTERCOUNTRY: 'NL', LINKIDERP4: null,    MESSAGESTATUS: 'CREATE', PRINCIPAL: 'SCHENKER',DATEOFACCEPTANCE: '2025-01-10T00:00:00', PROCESSFACTUURNUMMER: 2009000011, C88NUMMER: 4112,  RELATIECODE_KLANT: 'ALPHATRANS',  KLANT: 'SCHENKER'    },
  { DECLARATION_ID: 4890,  ACTIVECOMPANY: 'DKM_NLD',   TRACESIDENTIFICATION: 'BEST - CMR',           FISCALCONSIGNEECODE: 'GLOBALTRD',   IMPORTERCODE: 'GLOBALTRD',   IMPORTERCOUNTRY: 'FR', LINKIDERP4: null,    MESSAGESTATUS: 'DMSCLE', PRINCIPAL: 'KUEHNE',  DATEOFACCEPTANCE: '2025-02-20T00:00:00', PROCESSFACTUURNUMMER: 2009000014, C88NUMMER: 4890,  RELATIECODE_KLANT: 'GLOBALTRD',   KLANT: 'GLOBALTRD'   },
  // ICL
  { DECLARATION_ID: 5033,  ACTIVECOMPANY: 'LILY_MAAS', TRACESIDENTIFICATION: 'BEST - PRIO',          FISCALCONSIGNEECODE: 'BREMERTRD',   IMPORTERCODE: 'BREMERTRD',   IMPORTERCOUNTRY: 'DE', LINKIDERP4: 'LINK2', MESSAGESTATUS: 'CREATE', PRINCIPAL: 'VANHOOL', DATEOFACCEPTANCE: '2025-03-11T00:00:00', PROCESSFACTUURNUMMER: 2009000017, C88NUMMER: 5033,  RELATIECODE_KLANT: 'BREMERTRD',   KLANT: 'VANHOOL'     },
  { DECLARATION_ID: 5501,  ACTIVECOMPANY: 'DKM_NLD',   TRACESIDENTIFICATION: 'BEST - PRIO - NL',     FISCALCONSIGNEECODE: 'FEDEX_NL',    IMPORTERCODE: 'FEDEX_NL',    IMPORTERCOUNTRY: 'NL', LINKIDERP4: null,    MESSAGESTATUS: 'DMSCLE', PRINCIPAL: ' ',       DATEOFACCEPTANCE: '2025-01-28T00:00:00', PROCESSFACTUURNUMMER: 2009000009, C88NUMMER: 5501,  RELATIECODE_KLANT: 'FEDEX_NL',    KLANT: 'FEDEX_NL'    },
  { DECLARATION_ID: 6044,  ACTIVECOMPANY: 'DKM_NLD',   TRACESIDENTIFICATION: 'BEST - CMR',           FISCALCONSIGNEECODE: 'PANDASHIP',   IMPORTERCODE: 'PANDASHIP',   IMPORTERCOUNTRY: 'BE', LINKIDERP4: null,    MESSAGESTATUS: 'DELETED',PRINCIPAL: 'SCHENKER',DATEOFACCEPTANCE: '2024-11-05T00:00:00', PROCESSFACTUURNUMMER: 2008000019, C88NUMMER: 6044,  RELATIECODE_KLANT: 'PANDASHIP',   KLANT: 'PANDASHIP'   },
  // ICL
  { DECLARATION_ID: 6712,  ACTIVECOMPANY: 'LILY_MAAS', TRACESIDENTIFICATION: 'BEST - PRIO',          FISCALCONSIGNEECODE: 'ALPHATRANS',  IMPORTERCODE: 'ALPHATRANS',  IMPORTERCOUNTRY: 'FR', LINKIDERP4: 'LINK4', MESSAGESTATUS: 'CREATE', PRINCIPAL: 'KUEHNE',  DATEOFACCEPTANCE: '2025-04-01T00:00:00', PROCESSFACTUURNUMMER: 2009000023, C88NUMMER: 6712,  RELATIECODE_KLANT: 'ALPHATRANS',  KLANT: 'KUEHNE'      },
  { DECLARATION_ID: 7089,  ACTIVECOMPANY: 'DKM_NLD',   TRACESIDENTIFICATION: 'BEST- PRIO',           FISCALCONSIGNEECODE: 'FEDERGLOBA',  IMPORTERCODE: 'FEDERGLOBA',  IMPORTERCOUNTRY: 'BE', LINKIDERP4: null,    MESSAGESTATUS: 'DMSCLE', PRINCIPAL: ' ',       DATEOFACCEPTANCE: '2024-12-19T00:00:00', PROCESSFACTUURNUMMER: 2008000025, C88NUMMER: 7089,  RELATIECODE_KLANT: 'FEDERGLOBA',  KLANT: 'FEDERGLOBA'  },
  { DECLARATION_ID: 7450,  ACTIVECOMPANY: 'DKM_NLD',   TRACESIDENTIFICATION: 'BEST - PRIO',          FISCALCONSIGNEECODE: 'BSN TRADIN',  IMPORTERCODE: 'BSN TRADIN',  IMPORTERCOUNTRY: 'NL', LINKIDERP4: null,    MESSAGESTATUS: 'CREATE', PRINCIPAL: ' ',       DATEOFACCEPTANCE: '2025-04-10T00:00:00', PROCESSFACTUURNUMMER: 2009000028, C88NUMMER: 7450,  RELATIECODE_KLANT: 'BSN TRADIN',  KLANT: 'BSN TRADIN'  },
  { DECLARATION_ID: 8001,  ACTIVECOMPANY: 'LILY_MAAS', TRACESIDENTIFICATION: 'BEST - CMR',           FISCALCONSIGNEECODE: 'DRAGOMOCAB',  IMPORTERCODE: 'DRAGOMOCAB',  IMPORTERCOUNTRY: 'DE', LINKIDERP4: 'LINK1', MESSAGESTATUS: 'DMSCLE', PRINCIPAL: 'VANHOOL', DATEOFACCEPTANCE: '2025-02-07T00:00:00', PROCESSFACTUURNUMMER: 2009000031, C88NUMMER: 8001,  RELATIECODE_KLANT: 'DRAGOMOCAB',  KLANT: 'DRAGOMOCAB'  },
  // ICL
  { DECLARATION_ID: 8345,  ACTIVECOMPANY: 'DKM_NLD',   TRACESIDENTIFICATION: 'BEST - PRIO - CM.RNL', FISCALCONSIGNEECODE: 'GLOBALTRD',   IMPORTERCODE: 'GLOBALTRD',   IMPORTERCOUNTRY: 'FR', LINKIDERP4: null,    MESSAGESTATUS: 'CREATE', PRINCIPAL: 'SCHENKER',DATEOFACCEPTANCE: '2025-03-22T00:00:00', PROCESSFACTUURNUMMER: 2009000035, C88NUMMER: 8345,  RELATIECODE_KLANT: 'GLOBALTRD',   KLANT: 'SCHENKER'    },
];
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch BestMing documents.
 * Returns mock data when USE_MOCK = true, otherwise calls the Logic App proxy.
 * @returns {Promise<Array>}
 */
export async function getBestmingDocs() {
  if (USE_MOCK) {
    // Simulate network delay so loading states are visible
    await new Promise(r => setTimeout(r, 600));
    return MOCK_DATA;
  }

  const response = await fetch(`${FISCAL_API_BASE}/bestming-docs`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || `Failed to fetch BestMing data: ${response.status}`);
  }

  const data = await response.json();
  // Normalize: Logic App returns { Table1: [...] }
  const normalized = Array.isArray(data) ? data : (data.Table1 ?? []);

  // Sync to physical SSD cache for instant hydration
  try {
    localStorage.setItem('BESTMING_CACHE_DATA', JSON.stringify(normalized));
    localStorage.setItem('BESTMING_CACHE_TIME', Date.now().toString());
  } catch (err) {}

  return normalized;
}

/**
 * Send a DocuSign signature request.
 * Payload: { id/declaration_id, processfactuurnummer/processFactuurnummer }
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
export async function sendDocuSignRequest(payload) {
  const response = await fetch(`${FISCAL_API_BASE}/bestming-sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const precheckReason = err?.precheck?.reason ? ` (${err.precheck.reason})` : '';
    const error = new Error(err.error || err.message || `DocuSign request failed: ${response.status}${precheckReason}`);
    error.code = err.code || null;
    error.precheck = err.precheck || null;
    throw error;
  }

  return response.json();
}

function normalizePrecheckItem(item) {
  return {
    declaration_id: item?.declaration_id,
    processfactuurnummer: item?.processfactuurnummer,
  };
}

function precheckKey(item) {
  return `${item?.declaration_id ?? ''}|${item?.processfactuurnummer ?? ''}`;
}

function loadPrecheckSessionCache() {
  try {
    const raw = sessionStorage.getItem(PRECHECK_SESSION_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

function savePrecheckSessionCache(cache) {
  try {
    sessionStorage.setItem(PRECHECK_SESSION_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

export function clearBestmingPrecheckSessionCache() {
  try {
    sessionStorage.removeItem(PRECHECK_SESSION_CACHE_KEY);
  } catch {}
}

/**
 * Bulk precheck for BestMing rows.
 * Payload: [{ declaration_id, processfactuurnummer }]
 * @param {Array<{declaration_id:number|string, processfactuurnummer:number|string}>} items
 * @param {{forceRefresh?: boolean}} options
 * @returns {Promise<Object>}
 */
export async function precheckBestmingSignatures(items, options = {}) {
  const forceRefresh = options?.forceRefresh === true;
  const normalized = items
    .map(normalizePrecheckItem)
    .filter((item) => item.declaration_id != null || item.processfactuurnummer != null);

  const dedupedMap = new Map();
  normalized.forEach((item) => {
    const key = precheckKey(item);
    if (!dedupedMap.has(key)) dedupedMap.set(key, item);
  });
  const deduped = [...dedupedMap.values()];

  if (deduped.length === 0) {
    return {
      success: true,
      operation: 'precheck',
      total: 0,
      ready_count: 0,
      blocked_count: 0,
      results: [],
    };
  }

  const now = Date.now();
  const cache = forceRefresh ? {} : loadPrecheckSessionCache();
  const missing = [];
  const resultByKey = new Map();

  for (const item of deduped) {
    const key = precheckKey(item);
    const cached = cache[key];
    if (!forceRefresh && cached?.expires_at && cached.expires_at > now && cached.result) {
      resultByKey.set(key, cached.result);
    } else {
      missing.push(item);
    }
  }

  if (missing.length > 0) {
  const response = await fetch(`${FISCAL_API_BASE}/bestming-precheck`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: missing, force_refresh: forceRefresh }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || err.message || `BestMing precheck failed: ${response.status}`);
  }

    const data = await response.json();
    const fetchedResults = Array.isArray(data?.results) ? data.results : [];
    for (const result of fetchedResults) {
      const key = precheckKey(result);
      resultByKey.set(key, result);
      cache[key] = {
        result,
        expires_at: now + PRECHECK_CACHE_TTL_MS,
      };
    }
    savePrecheckSessionCache(cache);
  }

  const mergedResults = deduped
    .map((item) => resultByKey.get(precheckKey(item)))
    .filter(Boolean);
  const readyCount = mergedResults.filter((r) => r?.can_send).length;

  return {
    success: true,
    operation: 'precheck',
    total: mergedResults.length,
    ready_count: readyCount,
    blocked_count: mergedResults.length - readyCount,
    results: mergedResults,
  };
}
