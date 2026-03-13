import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import leadsRouter from "./leads";
import studentsRouter from "./students";
import agentsRouter from "./agents";
import applicationsRouter from "./applications";
import documentsRouter from "./documents";
import universitiesRouter from "./universities";
import financeRouter from "./finance";
import contentRouter from "./content";
import settingsRouter from "./settings";
import auditRouter from "./audit";
import statsRouter from "./stats";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(leadsRouter);
router.use(studentsRouter);
router.use(agentsRouter);
router.use(applicationsRouter);
router.use(documentsRouter);
router.use(universitiesRouter);
router.use(financeRouter);
router.use(contentRouter);
router.use(settingsRouter);
router.use(auditRouter);
router.use(statsRouter);

export default router;
