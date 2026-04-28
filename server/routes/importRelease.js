import express from 'express';
import { clearImportReleaseMeta, executeRecordAction, getImportReleaseHealth, getImportReleaseSettings, getRecordDetails, listDossiers, listRuns, pollIrp, runFullSync, sendTestImportReleaseEmail, syncSource, updateImportReleaseSettings } from '../services/importReleaseService.js';

const router = express.Router();

router.get('/dossiers', async (req, res) => {
  try {
    const data = await listDossiers(req.query);
    res.json(data);
  } catch (error) {
    console.error('[import-release] list failed:', error);
    res.status(500).json({ error: error.message });
  }
});

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

router.get('/records/:id', async (req, res) => {
  try {
    res.json(await getRecordDetails(req.params.id));
  } catch (error) {
    console.error('[import-release] record detail failed:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/test-email', async (req, res) => {
  try {
    res.json(await sendTestImportReleaseEmail(req.body?.to || ''));
  } catch (error) {
    console.error('[import-release] test email failed:', error);
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

export default router;
