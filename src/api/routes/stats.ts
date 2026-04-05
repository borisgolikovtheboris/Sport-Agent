import { Router } from "express";
import { getOverview, getEventsByPeriod, getGroups, getNLUStats } from "../services/statsService";

const router = Router();

router.get("/overview", async (_req, res) => {
  try {
    const data = await getOverview();
    res.json(data);
  } catch (err) {
    console.error("Stats overview error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

router.get("/events", async (req, res) => {
  const period = (req.query.period as string) || "30d";
  const days = parseInt(period) || 30;
  try {
    const data = await getEventsByPeriod(days);
    res.json(data);
  } catch (err) {
    console.error("Stats events error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

router.get("/groups", async (_req, res) => {
  try {
    const data = await getGroups();
    res.json(data);
  } catch (err) {
    console.error("Stats groups error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

router.get("/nlu", async (_req, res) => {
  try {
    const data = await getNLUStats();
    res.json(data);
  } catch (err) {
    console.error("Stats NLU error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
