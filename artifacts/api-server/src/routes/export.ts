import { Router, type Request, type Response } from "express";
import { requireAuth, requirePermission, requireRole } from "../lib/auth";
import { ADMIN_ROLES } from "../lib/roles";
import { crmExportSelection } from "../lib/crmExcelExport";
import { listLeads } from "./leads";
import { listStudents } from "./students";
import { listApplications } from "./applications";

const router = Router();

function withSelection(list: (req: Request, res: Response, selectedIds: number[]) => Promise<void>) {
  return async (req: Request, res: Response) => {
    if (Object.values(req.query).some(value => typeof value !== "string")) {
      res.status(400).json({ error: "Invalid export filters" });
      return;
    }
    const selectedIds = crmExportSelection(req, res);
    if (selectedIds) await list(req, res, selectedIds);
  };
}

router.get("/export/leads", requireAuth, requireRole(...ADMIN_ROLES), requirePermission("leads.view"), withSelection(listLeads));
router.get("/export/students", requireAuth, requireRole(...ADMIN_ROLES), requirePermission("students.view"), withSelection(listStudents));
router.get("/export/applications", requireAuth, requireRole(...ADMIN_ROLES), requirePermission("applications.view"), withSelection(listApplications));

export default router;
