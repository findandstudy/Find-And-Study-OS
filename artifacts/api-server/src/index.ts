import express from "express";
import app from "./app";
import { db, pool, usersTable, integrationsTable, applicationsTable, commissionsTable, serviceFeesTable, studentsTable, agentsTable, pipelineStagesTable } from "@workspace/db";
import { eq, isNull, and, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getCurrentSeason } from "./lib/season";
import { seedDocumentTypes } from "./scripts/seedDocumentTypes";

const isProd = process.env.NODE_ENV === "production";

process.on("unhandledRejection", (reason) => {
  console.error("[fatal] Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[fatal] Uncaught exception:", err);
  if (isProd) {
    process.exit(1);
  }
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
        season: app.season || (await getCurrentSeason()),
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

async function backfillLeadConversion() {
  // Past public-form / embed flows didn't always promote a lead when the
  // applicant later completed full apply. Reconcile retroactively: any lead
  // whose email matches a student that already has at least one application
  // should be marked converted and linked. Idempotent — only touches rows
  // that are still in a pre-converted state OR missing the link.
  try {
    const result = await db.execute(sql`
      UPDATE leads l
      SET status = 'converted',
          converted_student_id = sub.student_id,
          updated_at = NOW()
      FROM (
        SELECT DISTINCT ON (LOWER(s.email)) LOWER(s.email) AS email_key, s.id AS student_id
        FROM students s
        WHERE s.email IS NOT NULL
          AND s.email <> ''
          AND s.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM applications a WHERE a.student_id = s.id AND a.deleted_at IS NULL)
        ORDER BY LOWER(s.email), s.created_at ASC
      ) sub
      WHERE LOWER(l.email) = sub.email_key
        AND (l.status <> 'converted' OR l.converted_student_id IS NULL)
    `);
    const count = (result as any)?.rowCount || 0;
    if (count > 0) {
      console.log(`[backfill] Linked ${count} historical lead(s) to existing students with applications (status=converted)`);
    }
  } catch (err) {
    console.error("[backfill] backfillLeadConversion error:", err);
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

(async () => {
  // Step 1: Create system_flags table — runs on all processes, idempotent.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_flags (
      key TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Step 2: Create rate-limits table — runs on all processes, idempotent.
  const { ensureRateLimitsTable } = await import("./lib/pgRateLimiter");
  await ensureRateLimitsTable();

  // Step 2b: Idempotent migrations for offer-letter expiry feature.
  try {
    await pool.query(`ALTER TABLE application_stage_documents ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE application_stage_documents ADD COLUMN IF NOT EXISTS expiry_notified_thresholds TEXT`);
    await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS offer_expiry_warning_days TEXT DEFAULT '30,14,7,1'`);
    await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS contract_expiry_reminder_days TEXT DEFAULT '30,14,7,1'`);
  } catch (err) {
    console.error("[migrate] offer-expiry columns:", err);
  }

  // Step 2b2: Idempotent migrations for the contract signing system (Task #110).
  try {
    await pool.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS entity_type TEXT NOT NULL DEFAULT 'company'`);
    await pool.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS tax_number TEXT`);
    await pool.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS preferred_contract_language TEXT NOT NULL DEFAULT 'en'`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS contract_templates (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'en',
        entity_type TEXT NOT NULL DEFAULT 'company',
        version INTEGER NOT NULL DEFAULT 1,
        body_html TEXT NOT NULL DEFAULT '',
        intake_schema JSONB,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        deleted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS contract_templates_language_idx ON contract_templates(language)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS contract_templates_entity_type_idx ON contract_templates(entity_type)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS contract_templates_active_idx ON contract_templates(is_active)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS signing_sessions (
        id SERIAL PRIMARY KEY,
        template_id INTEGER NOT NULL,
        agent_id INTEGER,
        token_hash TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'admin_driven',
        status TEXT NOT NULL DEFAULT 'review_pending',
        intake_data JSONB,
        signer_email TEXT NOT NULL,
        signer_name TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        opened_at TIMESTAMPTZ,
        signed_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS signing_sessions_token_hash_idx ON signing_sessions(token_hash)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS signing_sessions_status_idx ON signing_sessions(status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS signing_sessions_agent_id_idx ON signing_sessions(agent_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS signing_sessions_template_id_idx ON signing_sessions(template_id)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS signed_contracts (
        id SERIAL PRIMARY KEY,
        signing_session_id INTEGER NOT NULL,
        agent_id INTEGER,
        template_id INTEGER NOT NULL,
        pdf_object_key TEXT NOT NULL,
        signature_image_object_key TEXT,
        evidence_hash TEXT NOT NULL,
        signer_email TEXT NOT NULL,
        signer_name TEXT,
        signer_ip TEXT,
        signer_user_agent TEXT,
        signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        emailed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // Unique on signing_session_id prevents duplicate signed records (race protection).
    await pool.query(`DROP INDEX IF EXISTS signed_contracts_session_id_idx`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS signed_contracts_session_id_unique ON signed_contracts(signing_session_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS signed_contracts_agent_id_idx ON signed_contracts(agent_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS signed_contracts_template_id_idx ON signed_contracts(template_id)`);

    // Backfill the new contract permissions for the default admin role.
    const newPerms = [
      "contract_templates.view", "contract_templates.manage",
      "contracts.view", "contracts.manage",
      "self_fill_links.view", "self_fill_links.manage",
    ];
    const adminRoleRes = await pool.query(`SELECT id, permissions FROM roles WHERE name IN ('admin', 'super_admin')`);
    for (const row of adminRoleRes.rows) {
      const existing: string[] = Array.isArray(row.permissions) ? row.permissions : [];
      const merged = Array.from(new Set([...existing, ...newPerms]));
      if (merged.length !== existing.length) {
        await pool.query(`UPDATE roles SET permissions = $1::jsonb WHERE id = $2`, [JSON.stringify(merged), row.id]);
      }
    }
  } catch (err) {
    console.error("[migrate] contract-signing tables:", err);
  }

  // Step 2b3: Performance quick-wins (Task #141) — pg_trgm trigram GIN
  // indexes for ILIKE '%term%' searches, partial index for unread
  // notifications, and the students.has_photo denormalized flag with
  // one-time backfill. All steps are idempotent (IF NOT EXISTS).
  try {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    // Trigram indexes — Postgres can use these for ILIKE '%term%' planning,
    // turning O(n) sequential scans on 50K+ rows into index lookups.
    await pool.query(`CREATE INDEX IF NOT EXISTS students_first_name_trgm_idx ON students USING GIN (first_name gin_trgm_ops)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS students_last_name_trgm_idx ON students USING GIN (last_name gin_trgm_ops)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS students_email_trgm_idx ON students USING GIN (email gin_trgm_ops)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS leads_first_name_trgm_idx ON leads USING GIN (first_name gin_trgm_ops)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS leads_last_name_trgm_idx ON leads USING GIN (last_name gin_trgm_ops)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS leads_email_trgm_idx ON leads USING GIN (email gin_trgm_ops)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS programs_name_trgm_idx ON programs USING GIN (name gin_trgm_ops)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS universities_name_trgm_idx ON universities USING GIN (name gin_trgm_ops)`);

    // Partial index — every notification fetch reads only is_read=false rows;
    // a partial index is small (only unread rows) and dramatically speeds
    // up the unread-count queries used by the badge / SSE flow.
    await pool.query(`CREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON notifications (user_id) WHERE is_read = false`);

    // students.has_photo: denormalize the photo-presence check so the
    // listing query no longer needs an extra SELECT against documents.
    await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS has_photo BOOLEAN NOT NULL DEFAULT FALSE`);
    // One-time backfill (idempotent via system_flags so it only runs once
    // per deployment lifetime — safe to re-execute, but skipped after the
    // first successful run to avoid scanning the documents table on boot).
    const flagRes = await pool.query(
      `INSERT INTO system_flags (key) VALUES ('students_has_photo_backfilled') ON CONFLICT DO NOTHING RETURNING key`
    );
    if (flagRes.rows.length > 0) {
      await pool.query(`
        UPDATE students s
        SET has_photo = TRUE
        WHERE EXISTS (
          SELECT 1 FROM documents d
          WHERE d.student_id = s.id
            AND d.type IN ('photo', 'photograph')
            AND d.deleted_at IS NULL
        ) AND has_photo = FALSE
      `);
      console.log("[migrate] students.has_photo backfilled from documents");
    }
  } catch (err) {
    console.error("[migrate] perf quick-win indexes:", err);
  }

  // Step 2c: Idempotent migrations for the Branch system.
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS branches (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        country TEXT,
        city TEXT,
        contact_name TEXT,
        contact_email TEXT,
        contact_phone TEXT,
        logo_url TEXT,
        notes TEXT,
        archived_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS branches_name_idx ON branches(name)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS branches_archived_idx ON branches(archived_at)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS agent_branches (
        agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (agent_id, branch_id)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS agent_branches_branch_id_idx ON agent_branches(branch_id)`);

    // Add branch_id to other major tables.
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL`);
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL`);
    await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL`);
    await pool.query(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS users_branch_id_idx ON users(branch_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS leads_branch_id_idx ON leads(branch_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS students_branch_id_idx ON students(branch_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS applications_branch_id_idx ON applications(branch_id)`);

    // Seed a default branch on first run, then backfill orphan rows once.
    const seedRes = await pool.query(
      `INSERT INTO branches (name) VALUES ('Genel Şube') ON CONFLICT (name) DO NOTHING RETURNING id`
    );
    if (seedRes.rows.length > 0) {
      const defaultId = seedRes.rows[0].id;
      await pool.query(`UPDATE users SET branch_id = $1 WHERE branch_id IS NULL`, [defaultId]);
      await pool.query(`UPDATE leads SET branch_id = $1 WHERE branch_id IS NULL`, [defaultId]);
      await pool.query(`UPDATE students SET branch_id = $1 WHERE branch_id IS NULL`, [defaultId]);
      await pool.query(`UPDATE applications SET branch_id = $1 WHERE branch_id IS NULL`, [defaultId]);
      await pool.query(
        `INSERT INTO agent_branches (agent_id, branch_id)
         SELECT a.id, $1 FROM agents a
         ON CONFLICT DO NOTHING`,
        [defaultId]
      );
      console.log("[migrate] Branches: seeded default 'Genel Şube' (id=" + defaultId + ") and backfilled existing rows");
    }
  } catch (err) {
    console.error("[migrate] branches columns:", err);
  }

  // Steps 3–5: Only instance 0 runs seeds, backfills, and background workers.
  const isWorkerZero = !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === "0";
  if (isWorkerZero) {
    // DB-based lock: only one process wins the INSERT; others skip seeds.
    const lockResult = await pool.query(
      `INSERT INTO system_flags (key) VALUES ('bootstrap_done') ON CONFLICT DO NOTHING RETURNING key`
    );
    if (lockResult.rows.length > 0) {
      await ensureSuperAdmin();
      await ensureAgentUser();
      await runSeedSQL();
      await linkAgentUser();
      await seedClaudeIntegration();
      await backfillConversationChannel();
      await backfillMissingCommissions();
      await backfillStudentAppStatus();
      await backfillLeadConversion();
    }

    // Documents catalog seeder runs on every boot (idempotent per-row).
    // Outside the bootstrap_done lock so it can backfill existing envs.
    await seedDocumentTypes(pool);

    // One-shot data cleanup (idempotent via system_flags). Runs on every
    // boot but exits early once the version flag is set. This ensures
    // Replit autoscale publishes — which don't execute deploy/deploy.sh —
    // still apply the cleanup the first time the new build comes up.
    const { runDataCleanupOnce } = await import("./lib/dataCleanup");
    await runDataCleanupOnce();

    console.log("[Worker] Background workers started on instance", process.env.NODE_APP_INSTANCE ?? "0-solo");
    const { startEmailWorker } = await import("./lib/email");
    startEmailWorker();
    const { startContractChecker } = await import("./lib/contractChecker");
    startContractChecker();
    const { startOfferExpiryChecker } = await import("./lib/offerExpiryChecker");
    startOfferExpiryChecker();
    const { startUniversityContractChecker } = await import("./lib/universityContractChecker");
    startUniversityContractChecker();
  }

  serveStaticFrontend();
  app.listen(port, () => {
    console.log(`Server listening on port ${port} (${isProd ? "production" : "development"})`);
  });
})();
