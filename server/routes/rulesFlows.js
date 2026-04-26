import express from "express";
import {
  listFlows, getFlowById, createFlow, updateFlow, deleteFlow,
  listChecks, createCheck, updateCheck, deleteCheck,
  listAudit, seedIfEmpty,
} from "../services/rulesFlowsBlobStore.js";
import { runEngine } from "../engine/runEngine.js";

const router = express.Router();

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function getUser(req) {
  return req.user ?? { id: "anon", username: "anonymous", role: "admin" };
}

function requireRole(...roles) {
  return (req, res, next) => {
    const user = getUser(req);
    if (roles.includes(user.role) || user.role === "admin") return next();
    res.status(403).json({ error: "Insufficient permissions" });
  };
}

// ─── Flows ─────────────────────────────────────────────────────────────────────

router.get("/flows", async (req, res) => {
  try {
    const flows = await listFlows();
    // Attach check counts
    const withCounts = await Promise.all(
      flows.map(async (f) => {
        const checks = await listChecks(f.id);
        return {
          ...f,
          check_count: checks.length,
          active_check_count: checks.filter((c) => c.is_active).length,
          strategy_counts: checks.reduce((acc, c) => {
            acc[c.strategy_type] = (acc[c.strategy_type] ?? 0) + 1;
            return acc;
          }, {}),
        };
      })
    );
    res.json(withCounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/flows", requireRole("admin", "manager"), async (req, res) => {
  try {
    const { name, description, is_active } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });
    const flow = await createFlow({ name, description, is_active }, getUser(req).username);
    res.status(201).json(flow);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/flows/:id", requireRole("admin", "manager"), async (req, res) => {
  try {
    const { name, description, is_active } = req.body;
    const updated = await updateFlow(req.params.id, { name, description, is_active }, getUser(req).username);
    if (!updated) return res.status(404).json({ error: "Flow not found" });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/flows/:id", requireRole("admin"), async (req, res) => {
  try {
    const ok = await deleteFlow(req.params.id, getUser(req).username);
    if (!ok) return res.status(404).json({ error: "Flow not found" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Checks ────────────────────────────────────────────────────────────────────

router.get("/flows/:flowId/checks", async (req, res) => {
  try {
    const checks = await listChecks(req.params.flowId);
    res.json(checks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/flows/:flowId/checks", requireRole("admin", "manager"), async (req, res) => {
  try {
    const { name, description, severity, strategy_type, config, warning_message, is_active, order_index } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });
    if (!strategy_type) return res.status(400).json({ error: "strategy_type is required" });

    const flow = await getFlowById(req.params.flowId);
    if (!flow) return res.status(404).json({ error: "Flow not found" });

    const check = await createCheck(
      req.params.flowId,
      { name, description, severity, strategy_type, config, warning_message, is_active, order_index },
      getUser(req).username
    );
    res.status(201).json(check);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/checks/:id", requireRole("admin", "manager"), async (req, res) => {
  try {
    const updated = await updateCheck(req.params.id, req.body, getUser(req).username);
    if (!updated) return res.status(404).json({ error: "Check not found" });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/checks/:id", requireRole("admin"), async (req, res) => {
  try {
    const ok = await deleteCheck(req.params.id, getUser(req).username);
    if (!ok) return res.status(404).json({ error: "Check not found" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Run ───────────────────────────────────────────────────────────────────────

router.post("/run/:flowId", async (req, res) => {
  try {
    const { declarationId } = req.body;
    if (!declarationId && declarationId !== 0) {
      return res.status(400).json({ error: "declarationId is required" });
    }

    const flow = await getFlowById(req.params.flowId);
    if (!flow) return res.status(404).json({ error: "Flow not found" });

    const checks = await listChecks(req.params.flowId);
    const engineResult = await runEngine(declarationId, checks);

    if (engineResult.error) {
      return res.status(502).json({ error: `Failed to fetch declaration: ${engineResult.error}` });
    }

    const { declaration, isDemo, results, summary } = engineResult;

    res.json({
      declarationId,
      flowId: flow.id,
      flowName: flow.name,
      isDemo,
      declaration: {
        DECLARATIONID: declaration.declaration?.DECLARATIONID,
        TEMPLATECODE: declaration.declaration?.TEMPLATECODE,
        DELIVERYTERMSCODE: declaration.declaration?.DELIVERYTERMSCODE,
        TOTALINVOICEAMOUNT: declaration.declaration?.TOTALINVOICEAMOUNT,
        TOTALINVOICEAMOUNTCURRENCY: declaration.declaration?.TOTALINVOICEAMOUNTCURRENCY,
        DESTINATIONCOUNTRY: declaration.declaration?.DESTINATIONCOUNTRY,
        DISPATCHCOUNTRY: declaration.declaration?.DISPATCHCOUNTRY,
        MRN: declaration.declaration?.MRN,
        item_count: declaration.items?.length ?? 0,
        hs_codes: (declaration.items ?? []).map((i) => i.item?.COMMODITYCODE).filter(Boolean),
      },
      results,
      summary,
      ran_at: new Date().toISOString(),
      ran_by: getUser(req).username,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Audit ─────────────────────────────────────────────────────────────────────

router.get("/audit", requireRole("admin", "manager"), async (req, res) => {
  try {
    const { entity_type, entity_id } = req.query;
    const log = await listAudit({ entity_type, entity_id });
    res.json(log);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Seed ──────────────────────────────────────────────────────────────────────

router.post("/seed", requireRole("admin"), async (req, res) => {
  try {
    await seedIfEmpty();
    res.json({ success: true, message: "Seed complete" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
