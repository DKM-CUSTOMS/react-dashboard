import express from 'express';
import {
  clearImportReleaseMeta,
  executeRecordAction,
  getImportReleaseHealth,
  getImportReleaseSettings,
  getIrpAuthState,
  getIrpSetupScreenshot,
  getRecordDetails,
  listDossiers,
  listRuns,
  pollIrp,
  refreshIrpTokenFromProfile,
  runFullSync,
  sendIrpSetupInput,
  sendTestImportReleaseEmail,
  startIrpSetupSession,
  stopIrpSetupSession,
  syncSource,
  updateImportReleaseSettings,
} from '../services/importReleaseService.js';

const router = express.Router();

// ── Dossiers ──────────────────────────────────────────────────────────────────

router.get('/dossiers', async (req, res) => {
  try {
    res.json(await listDossiers(req.query));
  } catch (error) {
    console.error('[import-release] list failed:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/records/:id', async (req, res) => {
  try {
    res.json(await getRecordDetails(req.params.id));
  } catch (error) {
    console.error('[import-release] record detail failed:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/records/:id/action', async (req, res) => {
  try {
    res.json(await executeRecordAction(req.params.id, req.body?.action));
  } catch (error) {
    console.error('[import-release] record action failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Settings ──────────────────────────────────────────────────────────────────

router.get('/settings', async (_req, res) => {
  try {
    res.json(await getImportReleaseSettings());
  } catch (error) {
    console.error('[import-release] settings read failed:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/settings', async (req, res) => {
  try {
    res.json(await updateImportReleaseSettings(req.body || {}));
  } catch (error) {
    console.error('[import-release] settings update failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Health & runs ─────────────────────────────────────────────────────────────

router.get('/health', async (_req, res) => {
  try {
    res.json(await getImportReleaseHealth());
  } catch (error) {
    console.error('[import-release] health failed:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/runs', async (req, res) => {
  try {
    res.json(await listRuns(req.query));
  } catch (error) {
    console.error('[import-release] runs failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Email ─────────────────────────────────────────────────────────────────────

router.post('/test-email', async (req, res) => {
  try {
    res.json(await sendTestImportReleaseEmail(req.body?.to || ''));
  } catch (error) {
    console.error('[import-release] test email failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Sync / poll ───────────────────────────────────────────────────────────────

router.post('/sync-source', async (req, res) => {
  try {
    res.json(await syncSource({ force: req.body?.force === true }));
  } catch (error) {
    console.error('[import-release] source sync failed:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/poll-irp', async (req, res) => {
  try {
    res.json(await pollIrp(req.body?.limit || 50, { force: req.body?.force === true }));
  } catch (error) {
    console.error('[import-release] IRP poll failed:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/clear-meta', async (_req, res) => {
  try {
    res.json(await clearImportReleaseMeta());
  } catch (error) {
    console.error('[import-release] clear meta failed:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/run', async (req, res) => {
  try {
    res.json(await runFullSync({ force: req.body?.force === true }));
  } catch (error) {
    console.error('[import-release] run failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── IRP session management ────────────────────────────────────────────────────
// These endpoints power the automated Playwright-based auth + the UI setup flow.

/** Current auth state (status, token expiry, last refresh, errors). */
router.get('/irp-session/status', (_req, res) => {
  res.json(getIrpAuthState());
});

/** Manually trigger a headless token refresh from the saved browser profile. */
router.post('/irp-session/refresh', async (_req, res) => {
  try {
    const ok = await refreshIrpTokenFromProfile();
    res.json({ ok, state: getIrpAuthState() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** Start a setup session (opens IRP in a headless browser for the user to log in). */
router.post('/irp-session/setup/start', async (_req, res) => {
  try {
    res.json(await startIrpSetupSession());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** Stop / cancel the active setup session. */
router.post('/irp-session/setup/stop', async (_req, res) => {
  try {
    res.json(await stopIrpSetupSession());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * SSE stream: sends a screenshot frame + auth state every second while setup
 * is active.  The frontend renders frames in an <img> tag and forwards
 * mouse/keyboard events back via POST /irp-session/setup/input.
 */
router.get('/irp-session/setup/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = async () => {
    const state = getIrpAuthState();
    const screenshot = await getIrpSetupScreenshot();
    const payload = JSON.stringify({ state, screenshot });
    res.write(`data: ${payload}\n\n`);
  };

  await send();
  const interval = setInterval(send, 1000);
  req.on('close', () => clearInterval(interval));
});

/**
 * Forward a user interaction to the setup browser.
 * Body: { type: 'click', x, y } | { type: 'type', text } | { type: 'key', key }
 */
router.post('/irp-session/setup/input', async (req, res) => {
  try {
    res.json(await sendIrpSetupInput(req.body || {}));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
