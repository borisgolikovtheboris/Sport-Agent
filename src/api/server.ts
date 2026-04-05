import express from "express";
import path from "path";
import { authMiddleware } from "./middleware/auth";
import statsRouter from "./routes/stats";

export async function startAPI() {
  const app = express();
  const port = parseInt(process.env.DASHBOARD_PORT || "3000");

  app.use("/api/stats", authMiddleware, statsRouter);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Dashboard — serve static HTML
  app.use("/dashboard", express.static(path.join(__dirname, "../dashboard")));
  app.get("/", (_req, res) => {
    res.redirect("/dashboard/");
  });

  app.listen(port, () => {
    console.log(`📊 Dashboard API running on port ${port}`);
  });
}
