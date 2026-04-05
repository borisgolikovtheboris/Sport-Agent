import express from "express";
import { authMiddleware } from "./middleware/auth";
import statsRouter from "./routes/stats";

export async function startAPI() {
  const app = express();
  const port = parseInt(process.env.DASHBOARD_PORT || "3000");

  app.use("/api/stats", authMiddleware, statsRouter);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.listen(port, () => {
    console.log(`📊 Dashboard API running on port ${port}`);
  });
}
