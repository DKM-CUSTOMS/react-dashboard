const BASE_URL = "https://functionapp-python-api-atfnhbf0b7c2b0ds.westeurope-01.azurewebsites.net/api/logs";
// Logic App Configuration for Arrivals
const LOGIC_APP_URL = "https://prod-243.westeurope.logic.azure.com:443/workflows/35c2398954db4915a9c7767fc068166d/triggers/When_an_HTTP_request_is_received/paths/invoke?api-version=2016-10-01&sp=%2Ftriggers%2FWhen_an_HTTP_request_is_received%2Frun&sv=1.0&sig=yrdQOz1v19Tq4fCCUISH7WwHFm3kfkbjl-mYiy6Yk3Y";
const CONTAINER_NAME = "document-intelligence";
const MASTER_FILE_PATH = "MasterData/MRN_Master_Records.json";

export async function getUploads(companyName = "", options = {}) {
  const {
    limit = 50,
    status = null,
    recent = true
  } = options;

  // Build query parameters
  const params = new URLSearchParams({
    code: import.meta.env.VITE_API_MAIN_KEY,
    recent: recent.toString(),
    limit: limit.toString()
  });

  if (status) params.append('status', status);
  if (companyName) params.append('company', companyName);

  // Build URL
  const url = companyName ? 
    `${BASE_URL}/${companyName}?${params}` : 
    `${BASE_URL}?${params}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);

  const data = await res.json();

  // Handle new optimized response format
  if (data.logs) {
    // New format from optimized API
    return {
      logs: data.logs,
      total: data.total || data.logs.length,
      timedOut: data.timedOutWorkflows || [],
      cached: data.cached || false
    };
  } else {
    // Fallback for old format (plain array)
    console.warn("Using fallback format - API may not be optimized yet");
    return {
      logs: Array.isArray(data) ? data : [],
      total: Array.isArray(data) ? data.length : 0,
      timedOut: [],
      cached: false
    };
  }
}

export async function getMasterRecords() {
  const payload = {
    container: CONTAINER_NAME,
    filepath: MASTER_FILE_PATH
  };
  
  try {
    const response = await fetch(LOGIC_APP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch master records: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    // Handle new optimized response format
    return {
      records: Array.isArray(data) ? data : [],
      total: Array.isArray(data) ? data.length : 0
    };
    
  } catch (error) {
    console.error('Error fetching master records:', error);
    throw error;
  }
}

export async function addOutbound(inboundMrn, outboundData) {
  const API_URL = "https://functionapp-python-uploads-huaafaf5f0cxc8g4.westeurope-01.azurewebsites.net/api/DgMRNExtractor";
  const API_KEY = import.meta.env.VITE_API_V2_KEY;
  
  const payload = {
    route: "add_outbound",
    inbound_mrn: inboundMrn,
    outbound_data: outboundData
  };

  try {
    const response = await fetch(`${API_URL}?code=${API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to add outbound: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    return data;
    
  } catch (error) {
    console.error('Error adding outbound:', error);
    throw error;
  }
}

// Performance Cache Paths
const PERFORMANCE_LOGIC_APP_URL = "https://prod-247.westeurope.logic.azure.com:443/workflows/70684bd0dcdf4af7862e22f5b532c61c/triggers/When_an_HTTP_request_is_received/paths/invoke?api-version=2016-10-01&sp=%2Ftriggers%2FWhen_an_HTTP_request_is_received%2Frun&sv=1.0&sig=aO7GvuqCc4KAA-s5I_dqSsk9jVqfcaND0kLMS-dF5IM";
const SUMMARY_BLOB_PATH = "Dashboard/cache/users_summaryV2.json";
const USER_CACHE_PATH_PREFIX = "Dashboard/cache/usersV2/";
const MONTHLY_SUMMARY_BLOB_PATH = "Dashboard/cache/monthly_report_cacheV2.json";

/**
 * Fetches the main performance summary (fast cache via Logic App)
 */
export async function getPerformanceSummary() {
  const payload = {
    container: CONTAINER_NAME,
    filepath: SUMMARY_BLOB_PATH
  };

  try {
    const response = await fetch(PERFORMANCE_LOGIC_APP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch performance summary: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Error fetching performance summary:", error);
    throw error;
  }
}

/**
 * Fetches monthly performance report (fast cache via Logic App)
 */
export async function getMonthlyPerformance() {
  const payload = {
    container: CONTAINER_NAME,
    filepath: MONTHLY_SUMMARY_BLOB_PATH
  };

  try {
    const response = await fetch(PERFORMANCE_LOGIC_APP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
        // Fallback or throw? Let's just throw for now as monthly report might be critical
        // OR fallback if you prefer, consistent with user performance?
        // Let's stick to throwing main error to match getPerformanceSummary behavior for now unless requested
      throw new Error(`Failed to fetch monthly report: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Error fetching monthly report:", error);
    throw error;
  }
}

/**
 * Fetches specific user performance data (fast cache via Logic App)
 * Falls back to legacy API if cache is missing
 */
export async function getUserPerformance(username) {
  // 1. Try Fast Cache (Logic App)
  const filename = `${username}.json`;
  const payload = {
    container: CONTAINER_NAME,
    filepath: USER_CACHE_PATH_PREFIX + filename
  };

  try {
    const response = await fetch(PERFORMANCE_LOGIC_APP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
        return await response.json();
    }
    console.warn(`Cache miss for ${username}, falling back to legacy API.`);
  } catch (error) {
    console.warn(`Error fetching cache for ${username}, falling back to legacy API:`, error);
  }

  // 2. Fallback to Legacy API
  const legacyUrl = `${import.meta.env.VITE_API_BASE_URL}/api/performance?user=${username}&code=${import.meta.env.VITE_API_CODE}`;
  const res = await fetch(legacyUrl);
  if (!res.ok) throw new Error("API Error");
  return await res.json();
}