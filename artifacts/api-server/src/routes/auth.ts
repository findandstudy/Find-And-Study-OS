import { Router, type IRouter } from "express";
import { requireAuth } from "../lib/auth";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  res.json(req.user);
});

router.post("/auth/logout", (_req, res): Promise<void> => {
  res.json({ success: true, message: "Logged out" });
  return Promise.resolve();
});

export default router;
