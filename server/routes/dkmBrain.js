import express from "express";
import {
  getOverviewMetrics,
  getShipmentList,
  getOperationsTimeSeries,
  getCostBreakdown,
  getQualityMetrics,
  getClientList,
  getClientDetail,
  getShipmentDetail,
  getInsights,
} from "../services/dkmBrainAggregator.js";
import { brainCache, readClientRulesIndex, readClientRulesTemplate, readClientRule, writeClientRule } from "../services/dkmBrainBlobStore.js";

const router = express.Router();

function parseFilters(query) {
  const { dateFrom, dateTo, client, domain, regime, status, model, stage, q } = query;
  return { dateFrom, dateTo, client, domain, regime, status, model, stage, q };
}

// GET /api/dkm-brain/overview?dateFrom=&dateTo=&client=&regime=&status=
router.get("/overview", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const data = await getOverviewMetrics(filters);
    res.json(data);
  } catch (err) {
    console.error("[dkmBrain] overview error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dkm-brain/shipments?page=1&limit=50&...filters
router.get("/shipments", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, parseInt(req.query.limit, 10) || 50);
    const data = await getShipmentList(filters, page, limit);
    res.json(data);
  } catch (err) {
    console.error("[dkmBrain] shipments error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dkm-brain/shipments/:shipment_id
router.get("/shipments/:shipment_id", async (req, res) => {
  try {
    const data = await getShipmentDetail(req.params.shipment_id);
    if (!data?.shipment?.shipment_id) {
      return res.status(404).json({ error: "Shipment not found" });
    }
    res.json(data);
  } catch (err) {
    console.error("[dkmBrain] shipment detail error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dkm-brain/operations?granularity=day|week|month&...filters
router.get("/operations", async (req, res) => {
  try {
    const filters     = parseFilters(req.query);
    const granularity = ["day", "week", "month"].includes(req.query.granularity)
      ? req.query.granularity
      : "day";
    const [timeSeries, list] = await Promise.all([
      getOperationsTimeSeries(filters, granularity),
      getShipmentList(filters, 1, 50),
    ]);
    res.json({ time_series: timeSeries, list });
  } catch (err) {
    console.error("[dkmBrain] operations error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dkm-brain/costs?...filters
router.get("/costs", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const data = await getCostBreakdown(filters);
    res.json(data);
  } catch (err) {
    console.error("[dkmBrain] costs error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dkm-brain/quality?...filters
router.get("/quality", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const data = await getQualityMetrics(filters);
    res.json(data);
  } catch (err) {
    console.error("[dkmBrain] quality error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dkm-brain/clients
router.get("/clients", async (req, res) => {
  try {
    const data = await getClientList();
    res.json(data);
  } catch (err) {
    console.error("[dkmBrain] clients error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dkm-brain/clients/:client_key
router.get("/clients/:client_key", async (req, res) => {
  try {
    const data = await getClientDetail(req.params.client_key);
    res.json(data);
  } catch (err) {
    console.error("[dkmBrain] client detail error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dkm-brain/insights
router.get("/insights", async (req, res) => {
  try {
    const data = await getInsights();
    res.json(data);
  } catch (err) {
    console.error("[dkmBrain] insights error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dkm-brain/cache/clear
router.post("/cache/clear", (req, res) => {
  brainCache.clear();
  res.json({ ok: true, message: "Brain cache cleared" });
});

// GET /api/dkm-brain/clients_rules/index
router.get("/clients_rules/index", async (req, res) => {
  try {
    const data = await readClientRulesIndex();
    if (!data) return res.status(404).json({ error: "Index not found" });
    res.json(data);
  } catch (err) {
    console.error("[dkmBrain] clients_rules index error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dkm-brain/clients_rules/template
router.get("/clients_rules/template", async (req, res) => {
  try {
    const data = await readClientRulesTemplate();
    if (!data) return res.status(404).json({ error: "Template not found" });
    res.json(data);
  } catch (err) {
    console.error("[dkmBrain] clients_rules template error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dkm-brain/clients_rules/rule/:client_key
router.get("/clients_rules/rule/:client_key", async (req, res) => {
  try {
    const data = await readClientRule(req.params.client_key);
    if (!data) return res.status(404).json({ error: "Rule not found" });
    res.json(data);
  } catch (err) {
    console.error(`[dkmBrain] clients_rules rule ${req.params.client_key} error:`, err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dkm-brain/clients_rules/rule/:client_key
router.post("/clients_rules/rule/:client_key", async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || !payload.client_key) {
      return res.status(400).json({ error: "Invalid payload or missing client_key" });
    }
    
    // Save to Azure Blob
    await writeClientRule(req.params.client_key, payload);
    
    res.json({ success: true, message: "Rule saved successfully" });
  } catch (err) {
    console.error(`[dkmBrain] POST clients_rules rule ${req.params.client_key} error:`, err);
    res.status(500).json({ error: "Failed to save rule: " + err.message });
  }
});

export default router;
