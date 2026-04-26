import express from "express";
import app from "./app";
import { db, pool, usersTable, integrationsTable, applicationsTable, commissionsTable, serviceFeesTable, studentsTable, agentsTable, pipelineStagesTable, documentRequirementsTable } from "@workspace/db";
import { eq, isNull, and, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const isProd = process.env.NODE_ENV === "production";

process.on("unhandledRejection", (reason) => {
  console.error("[fatal] Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[fatal] Uncaught exception:", err);
  process.exit(1);
});

function getSeedDir(): string {
  try {
    if (typeof __dirname !== "undefined") return __dirname;
  } catch {}
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {}
  return process.cwd();
}
const seedDir = getSeedDir();

async function ensureSuperAdmin() {
  if (isProd) return;
  const seedPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!seedPassword) return;
  try {
    const email = "en@findandstudy.com";
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    if (!existing) {
      const hash = await bcrypt.hash(seedPassword, 10);
      await db.insert(usersTable).values({
        replitId: "local-admin",
        email,
        firstName: "Find",
        lastName: "Study",
        role: "super_admin",
        passwordHash: hash,
        isActive: true,
        language: "en",
      });
      console.log("[seed] Super admin created");
    }
  } catch (err) {
    console.error("[seed] ensureSuperAdmin error:", err);
  }
}

async function ensureAgentUser() {
  if (isProd) return;
  const seedPassword = process.env.SEED_AGENT_PASSWORD;
  if (!seedPassword) return;
  try {
    const email = "omar@agent.com";
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    if (!existing) {
      const hash = await bcrypt.hash(seedPassword, 10);
      await db.insert(usersTable).values({
        replitId: "local-agent",
        email,
        firstName: "Omar",
        lastName: "Hassan",
        role: "agent",
        passwordHash: hash,
        isActive: true,
        language: "en",
      });
      console.log("[seed] Agent user created");
    }
  } catch (err) {
    console.error("[seed] ensureAgentUser error:", err);
  }
}

async function runSeedSQL() {
  if (isProd) return;
  try {
    const seedPath = path.join(seedDir, "seed.sql");
    if (!fs.existsSync(seedPath)) {
      console.log("[seed] No seed.sql found, skipping");
      return;
    }
    const sql = fs.readFileSync(seedPath, "utf8");
    const statements = sql.split(";").map(s => s.trim()).filter(s => s.length > 0 && !s.startsWith("--"));
    let inserted = 0;
    for (const stmt of statements) {
      try {
        const res = await pool.query(stmt);
        if (res.rowCount && res.rowCount > 0) inserted++;
      } catch (err: any) {
        if (!err.message?.includes("duplicate") && !err.message?.includes("already exists")) {
          console.error("[seed] SQL error:", err.message, "stmt:", stmt.substring(0, 80));
        }
      }
    }
    if (inserted > 0) console.log(`[seed] Inserted ${inserted} records from seed.sql`);
  } catch (err) {
    console.error("[seed] runSeedSQL error:", err);
  }
}

async function linkAgentUser() {
  if (isProd) return;
  try {
    const [agentUser] = await db.select().from(usersTable).where(eq(usersTable.email, "omar@agent.com"));
    if (agentUser) {
      await pool.query(
        `UPDATE agents SET user_id = $1 WHERE email = 'omar@agent.com' AND (user_id IS NULL OR user_id != $1)`,
        [agentUser.id]
      );
    }
  } catch (err) {
    console.error("[seed] linkAgentUser error:", err);
  }
}

function serveStaticFrontend() {
  if (!isProd) return;

  const distPath = process.env.FRONTEND_DIST_PATH
    || path.resolve(getSeedDir(), "..", "..", "edcons", "dist", "public");

  if (!fs.existsSync(distPath)) {
    console.warn(`[static] Frontend dist not found at ${distPath}, skipping static serving`);
    return;
  }

  app.use(
    "/assets",
    (_req: express.Request, res: express.Response, next: express.NextFunction) => {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      next();
    },
    express.static(path.join(distPath, "assets"))
  );

  app.use(express.static(distPath, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      }
    },
  }));

  app.get("/{*splat}", (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.path.startsWith("/api")) return next();
    const indexPath = path.join(distPath, "index.html");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(indexPath);
  });

  console.log(`[static] Serving frontend from ${distPath}`);
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function backfillConversationChannel() {
  try {
    const result = await pool.query(
      `UPDATE conversations SET channel = 'internal' WHERE channel IS NULL`
    );
    const count = result.rowCount || 0;
    if (count > 0) {
      console.log(`[backfill] Set channel='internal' on ${count} conversations with NULL channel`);
    }
  } catch (err) {
    console.error("[backfill] backfillConversationChannel error:", err);
  }
}

async function backfillMissingCommissions() {
  try {
    const { resolveAgentCommission } = await import("./lib/agentCommission");
    const { getCommissionFinanceStatus, getServiceFeeFinanceStatus } = await import("./lib/stageFinance");

    const appsWithoutComm = await db
      .select({
        id: applicationsTable.id,
        studentId: applicationsTable.studentId,
        agentId: applicationsTable.agentId,
        stage: applicationsTable.stage,
        tuitionFee: applicationsTable.tuitionFee,
        discountedFee: applicationsTable.discountedFee,
        commissionRate: applicationsTable.commissionRate,
        serviceFeeAmount: applicationsTable.serviceFeeAmount,
        universityName: applicationsTable.universityName,
        programName: applicationsTable.programName,
        season: applicationsTable.season,
        currency: applicationsTable.currency,
      })
      .from(applicationsTable)
      .where(
        and(
          isNull(applicationsTable.deletedAt),
          sql`NOT EXISTS (SELECT 1 FROM commissions WHERE commissions.application_id = ${applicationsTable.id})`
        )
      );

    let created = 0;
    for (const app of appsWithoutComm) {
      const commStatus = await getCommissionFinanceStatus(app.stage);
      if (commStatus === "excluded") continue;

      const baseFee = (app.discountedFee != null && !isNaN(app.discountedFee))
        ? app.discountedFee : app.tuitionFee;
      const uCommAmt = baseFee && app.commissionRate
        ? (baseFee * app.commissionRate) / 100 : 0;

      const [studentRec] = await db.select({ firstName: studentsTable.firstName, lastName: studentsTable.lastName })
        .from(studentsTable).where(eq(studentsTable.id, app.studentId));
      const sName = studentRec ? `${studentRec.firstName || ""} ${studentRec.lastName || ""}`.trim() : null;

      const agentComm = await resolveAgentCommission(app.agentId, uCommAmt);

      await db.insert(commissionsTable).values({
        applicationId: app.id,
        studentId: app.studentId,
        agentId: agentComm.agentId,
        studentName: sName,
        universityName: app.universityName || null,
        programName: app.programName || null,
        season: app.season || String(new Date().getFullYear()),
        currency: app.currency || "USD",
        status: commStatus,
        programFee: baseFee ? String(baseFee) : null,
        universityCommissionRate: app.commissionRate ? String(app.commissionRate) : null,
        universityCommissionAmount: uCommAmt > 0 ? String(uCommAmt) : null,
        agentCommissionRate: agentComm.agentCommissionRate,
        agentCommissionAmount: agentComm.agentCommissionAmount,
        subAgentId: agentComm.subAgentId,
        subAgentCommissionRate: agentComm.subAgentCommissionRate,
        subAgentCommissionAmount: agentComm.subAgentCommissionAmount,
      });
      created++;
    }

    const commsWithoutAgent = await db.select().from(commissionsTable)
      .where(
        and(
          sql`${commissionsTable.agentId} IS NOT NULL`,
          sql`(${commissionsTable.agentCommissionRate} IS NULL OR CAST(${commissionsTable.agentCommissionRate} AS numeric) = 0 OR ${commissionsTable.agentCommissionAmount} IS NULL OR CAST(${commissionsTable.agentCommissionAmount} AS numeric) = 0)`,
          sql`${commissionsTable.universityCommissionAmount} IS NOT NULL`,
          sql`CAST(${commissionsTable.universityCommissionAmount} AS numeric) > 0`
        )
      );

    let updated = 0;
    for (const comm of commsWithoutAgent) {
      const uAmount = parseFloat(String(comm.universityCommissionAmount ?? "0")) || 0;
      if (uAmount <= 0) continue;
      const agentComm = await resolveAgentCommission(comm.agentId, uAmount);
      await db.update(commissionsTable).set({
        agentId: agentComm.agentId,
        agentCommissionRate: agentComm.agentCommissionRate,
        agentCommissionAmount: agentComm.agentCommissionAmount,
        subAgentId: agentComm.subAgentId,
        subAgentCommissionRate: agentComm.subAgentCommissionRate,
        subAgentCommissionAmount: agentComm.subAgentCommissionAmount,
      }).where(eq(commissionsTable.id, comm.id));
      updated++;
    }

    if (created > 0 || updated > 0) {
      console.log(`[backfill] Created ${created} missing commission records, updated ${updated} existing records with agent rates`);
    }
  } catch (err) {
    console.error("[backfill] backfillMissingCommissions error:", err);
  }
}

async function backfillStudentAppStatus() {
  try {
    const [appMadeStage] = await db.select({ key: pipelineStagesTable.key })
      .from(pipelineStagesTable)
      .where(and(eq(pipelineStagesTable.entityType, "student"), eq(pipelineStagesTable.variant, "won")));
    if (!appMadeStage) return;

    const result = await db.execute(sql`
      UPDATE students SET status = ${appMadeStage.key}
      WHERE id IN (
        SELECT DISTINCT s.id FROM students s
        JOIN applications a ON a.student_id = s.id
        WHERE s.status IN ('active', 'inactive')
      )
    `);
    const count = (result as any)?.rowCount || 0;
    if (count > 0) {
      console.log(`[backfill] Updated ${count} student(s) with applications to '${appMadeStage.key}' status`);
    }
  } catch (err) {
    console.error("[backfill] backfillStudentAppStatus error:", err);
  }
}

async function seedClaudeIntegration() {
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (!envKey) return;
  try {
    const [existing] = await db.select().from(integrationsTable).where(eq(integrationsTable.key, "claude"));
    if (!existing) {
      await db.insert(integrationsTable).values({
        key: "claude",
        name: "Anthropic Claude",
        category: "ai",
        isEnabled: true,
        config: { apiKey: envKey },
      });
      console.log("[seed] Anthropic Claude integration seeded from ANTHROPIC_API_KEY env var");
    }
  } catch (err) {
    console.error("[seed] seedClaudeIntegration error:", err);
  }
}

async function seedDocumentRequirements() {
  try {
    const existing = await db.select({ id: documentRequirementsTable.id }).from(documentRequirementsTable).limit(1);
    if (existing.length > 0) return;
    const LEVELS = ["pre_bachelors", "bachelors", "pre_masters", "masters", "phd", "others"];
    const TYPES = [
      "high_school_diploma_translation", "class_10th_ssc_marks_sheet",
      "class_12th_hsc_certificate", "class_12th_hsc_marks_sheet",
      "diploma_certificate", "diploma_transcript",
      "bachelors_certificate", "bachelors_transcript",
      "bachelors_provisional_certificate", "bachelors_transcript_all_semesters",
      "masters_certificate", "masters_transcript",
      "masters_provisional_certificate", "masters_transcript_all_semesters",
      "passport", "cv", "lor", "sop", "essay", "experience_letters",
      "other_certificates_documents", "ielts_pte_gre_gmat_toefl_duolingo",
    ];
    const rows: any[] = [];
    for (let i = 0; i < TYPES.length; i++) {
      const dt = TYPES[i];
      for (const level of LEVELS) {
        let enabled = false, mandatory = false;
        if (dt === "passport") { enabled = true; mandatory = true; }
        else if (dt === "diploma_certificate" || dt === "diploma_transcript") {
          if (level === "pre_bachelors" || level === "others") { enabled = true; mandatory = true; }
        } else if (dt === "bachelors_certificate" || dt === "bachelors_transcript") {
          if (level === "pre_masters" || level === "masters") { enabled = true; mandatory = true; }
        } else if (dt === "bachelors_transcript_all_semesters") {
          if (level === "masters") { enabled = true; }
        } else if (dt === "masters_certificate" || dt === "masters_transcript") {
          if (level === "phd") { enabled = true; mandatory = true; }
        } else if (dt === "other_certificates_documents" || dt === "ielts_pte_gre_gmat_toefl_duolingo") {
          enabled = true;
        } else if (dt === "sop") { enabled = true; }
        rows.push({ documentType: dt, level, enabled, mandatory, sortOrder: i });
      }
    }
    await db.insert(documentRequirementsTable).values(rows);
    console.log("[seed] Document requirements seeded:", rows.length, "rows");
  } catch (err) {
    console.error("[seed] seedDocumentRequirements error:", err);
  }
}

(async () => {
  const { ensureRateLimitsTable } = await import("./lib/pgRateLimiter");
  await ensureRateLimitsTable();
  await ensureSuperAdmin();
  await ensureAgentUser();
  await runSeedSQL();
  await linkAgentUser();
  await seedClaudeIntegration();
  await seedDocumentRequirements();
  await backfillConversationChannel();
  await backfillMissingCommissions();
  await backfillStudentAppStatus();
  const isWorkerZero = !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === "0";
  if (isWorkerZero) {
    console.log("[Worker] Background workers started on instance", process.env.NODE_APP_INSTANCE ?? "0-solo");
    const { startEmailWorker } = await import("./lib/email");
    startEmailWorker();
    const { startContractChecker } = await import("./lib/contractChecker");
    startContractChecker();
  }
  serveStaticFrontend();
  app.listen(port, () => {
    console.log(`Server listening on port ${port} (${isProd ? "production" : "development"})`);
  });
})();
