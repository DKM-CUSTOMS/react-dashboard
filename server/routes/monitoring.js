import express from "express";
import {
  fetchAllRuns,
  fetchAggregatedPipelines,
  fetchRunsList,
  fetchSingleRunDetails,
} from "../services/blobMonitoringStore.js";

const router = express.Router();

// GET /api/monitoring/all?days=7
// Single endpoint that returns everything the UI needs
router.get("/all", async (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 7;
    const data = await fetchAllRuns(days);
    res.json(data);
  } catch (err) {
    console.error("Error fetching all monitoring data:", err);
    res.status(500).json({ error: "Failed to fetch monitoring data", details: err.message });
  }
});

// GET /api/monitoring/pipelines?days=7
router.get("/pipelines", async (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 7;
    const data = await fetchAggregatedPipelines(days);
    res.json(data);
  } catch (err) {
    console.error("Error fetching pipelines:", err);
    res.status(500).json({ error: "Failed to fetch pipeline metrics", details: err.message });
  }
});

// GET /api/monitoring/runs?logic_app_name=...&days=3&status=all
router.get("/runs", async (req, res) => {
  try {
    const appName = req.query.logic_app_name;
    const days = parseInt(req.query.days, 10) || 3;
    const status = req.query.status || "all";
    if (!appName) {
      return res.status(400).json({ error: "logic_app_name is required" });
    }
    let runs = await fetchRunsList(appName, days);
    if (status && status !== "all") {
      runs = runs.filter((r) => r.status === status);
    }
    const formattedRuns = runs.map((r) => ({
      ...r,
      warning_count: r.warnings_summary?.warning_count || 0,
    }));
    res.json(formattedRuns);
  } catch (err) {
    console.error("Error fetching runs:", err);
    res.status(500).json({ error: "Failed to fetch runs list", details: err.message });
  }
});

// GET /api/monitoring/runs/:run_id?logic_app_name=...&date=YYYY-MM-DD
router.get("/runs/:run_id", async (req, res) => {
  try {
    const runId = req.params.run_id;
    const appName = req.query.logic_app_name;
    const date = req.query.date;
    if (!appName || !date) {
      return res.status(400).json({ error: "logic_app_name and date (YYYY-MM-DD) are required" });
    }
    const runDetails = await fetchSingleRunDetails(appName, date, runId);
    res.json(runDetails);
  } catch (err) {
    console.error("Error fetching run details:", err);
    if (err.statusCode === 404) {
      res.status(404).json({ error: "Run report not found" });
    } else {
      res.status(500).json({ error: "Failed to fetch run details", details: err.message });
    }
  }
});

export default router;
