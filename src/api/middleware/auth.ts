import { Request, Response, NextFunction } from "express";

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const key =
    (req.query.key as string) ||
    req.headers.authorization?.replace("Bearer ", "");
  if (!key || key !== process.env.DASHBOARD_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
