import express from "express";
import app from "./app";
import { db, pool, usersTable, integrationsTable, applicationsTable, commissionsTable, serviceFeesTable, studentsTable, agentsTable, pipelineStagesTable } from "@workspace/db";
import { eq, isNull, and, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { getCsrfCookieOptions } from "./lib/cookieOptions";
import { getCurrentSeason } from "./lib/season";
import { seedDocumentTypes } from "./scripts/seedDocumentTypes";
import { seedCurrencies } from "./scripts/seedCurrencies";

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
    // Guarantee the SPA always carries a CSRF cookie before it issues ANY
    // unsafe (POST/PUT/PATCH/DELETE) request. Otherwise a freshly-loaded
    // client that hasn't yet made a cookie-setting /api GET — e.g. an agent
    // landing straight on the contract-signing screen from a cached session —
    // would POST without the double-submit token and get a silent 403. The
    // client (customFetch / csrfSetup) only attaches x-csrf-token when this
    // cookie is readable, so it must exist by the time the page renders.
    if (!(req as any).cookies?.csrf_token) {
      const token = crypto.randomBytes(32).toString("hex");
      res.cookie("csrf_token", token, getCsrfCookieOptions(req, 7 * 24 * 60 * 60 * 1000));
    }
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

  // Step 1b: Object ownership bindings for storage access control (Task #314).
  // Records who uploaded each object so the generic download endpoint can
  // authorize access without trusting self-writable reference fields (IDOR fix).
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS object_owners (
        object_key TEXT PRIMARY KEY,
        uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        source_priority INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // Resumable backfill marker: a single completion row written only after the
    // whole backfill finishes. Using a marker (instead of "table is empty")
    // makes the backfill safe to resume — a run interrupted after partial
    // inserts simply re-runs on the next boot (inserts are idempotent via
    // ON CONFLICT DO NOTHING), so a partial run can never leave permanent gaps.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS object_owners_backfill (
        id INTEGER PRIMARY KEY DEFAULT 1,
        completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // Upgrade path: when source_priority is being added to a PRE-EXISTING table,
    // its legacy rows have unknown provenance. Marking them with DEFAULT 0 would
    // (wrongly) make them look like authoritative upload-time bindings that
    // neither a backfill retry nor a real upload could ever correct. Instead,
    // tag legacy rows as the weakest priority (INT_MAX) and clear the completion
    // marker so the backfill re-runs once and supersedes them with properly
    // ranked bindings. A fresh CREATE already has the column, so this DO block is
    // a no-op there. Idempotent: the guard skips entirely once the column exists.
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'object_owners' AND column_name = 'source_priority'
        ) THEN
          ALTER TABLE object_owners ADD COLUMN source_priority INTEGER;
          UPDATE object_owners SET source_priority = 2147483647 WHERE source_priority IS NULL;
          ALTER TABLE object_owners ALTER COLUMN source_priority SET DEFAULT 0;
          ALTER TABLE object_owners ALTER COLUMN source_priority SET NOT NULL;
          DELETE FROM object_owners_backfill;
        END IF;
      END $$;
    `);

    // Backfill from authoritative references so EXISTING objects are protected
    // too — the download endpoint denies self-writable references that lack a
    // matching uploader binding, so every legitimately-referenced object must be
    // bound. Highest-authority source wins per key. Runs until the completion
    // marker is present.
    const { rows: doneRows } = await pool.query(`SELECT 1 FROM object_owners_backfill LIMIT 1`);
    if (doneRows.length === 0) {
      const { canonicalizeKey } = await import("./lib/objectAuthz");
      const owners = new Map<string, { owner: number | null; priority: number }>();
      const add = (raw: string | null | undefined, ownerId: number | null, priority: number): void => {
        if (!raw) return;
        const key = canonicalizeKey(raw);
        if (!key) return;
        // First (highest-authority) source seen for a key wins within a run.
        const cur = owners.get(key);
        if (!cur || priority < cur.priority) owners.set(key, { owner: ownerId, priority });
      };
      // Priority order: trustworthy/sensitive references first.
      const sources: Array<{ sql: string; owner: (r: any) => number | null; val: (r: any) => string | null }> = [
        { sql: `SELECT object_path AS v, user_id AS o FROM staff_documents WHERE object_path IS NOT NULL AND deleted_at IS NULL`, val: (r) => r.v, owner: (r) => r.o },
        { sql: `SELECT contract_url AS v, user_id AS o FROM agents WHERE contract_url IS NOT NULL`, val: (r) => r.v, owner: (r) => r.o },
        { sql: `SELECT agent_id_proof_url AS v, user_id AS o FROM agents WHERE agent_id_proof_url IS NOT NULL`, val: (r) => r.v, owner: (r) => r.o },
        { sql: `SELECT file_url AS v FROM financial_transactions WHERE file_url IS NOT NULL`, val: (r) => r.v, owner: () => null },
        { sql: `SELECT metadata->'attachment'->>'fileUrl' AS v, sender_id AS o FROM messages WHERE metadata->'attachment'->>'fileUrl' IS NOT NULL`, val: (r) => r.v, owner: (r) => r.o },
        { sql: `SELECT contract_url AS v, id AS o FROM users WHERE contract_url IS NOT NULL`, val: (r) => r.v, owner: (r) => r.o },
        { sql: `SELECT passport_url AS v, id AS o FROM users WHERE passport_url IS NOT NULL`, val: (r) => r.v, owner: (r) => r.o },
        { sql: `SELECT business_cert_url AS v, user_id AS o FROM agents WHERE business_cert_url IS NOT NULL`, val: (r) => r.v, owner: (r) => r.o },
        { sql: `SELECT logo_url AS v, user_id AS o FROM agents WHERE logo_url IS NOT NULL`, val: (r) => r.v, owner: (r) => r.o },
        { sql: `SELECT avatar_url AS v, id AS o FROM users WHERE avatar_url IS NOT NULL`, val: (r) => r.v, owner: (r) => r.o },
        { sql: `SELECT logo_url AS v FROM branches WHERE logo_url IS NOT NULL`, val: (r) => r.v, owner: () => null },
        { sql: `SELECT logo_url AS v FROM universities WHERE logo_url IS NOT NULL`, val: (r) => r.v, owner: () => null },
        { sql: `SELECT logo_url AS v, logo_dark_url AS v2, logo_square_url AS v3, email_logo_url AS v4, pdf_logo_url AS v5 FROM settings`, val: (r) => r.v, owner: () => null },
      ];
      let hadSourceFailure = false;
      // Source priority: index + 1 so every backfill binding is strictly less
      // authoritative than an upload-time binding (sourcePriority 0). Lower =
      // more authoritative; earlier sources in the array win.
      for (let p = 0; p < sources.length; p++) {
        const src = sources[p];
        const priority = p + 1;
        try {
          const { rows } = await pool.query(src.sql);
          for (const r of rows) {
            add(src.val(r), src.owner(r), priority);
            // settings row carries multiple logo variants.
            if (r.v2 !== undefined) {
              add(r.v2, null, priority); add(r.v3, null, priority);
              add(r.v4, null, priority); add(r.v5, null, priority);
            }
          }
        } catch (e) {
          hadSourceFailure = true;
          console.error("[migrate] object_owners backfill source failed:", e);
        }
      }
      if (owners.size > 0) {
        const entries = Array.from(owners.entries());
        const CHUNK = 500;
        for (let i = 0; i < entries.length; i += CHUNK) {
          const slice = entries.slice(i, i + CHUNK);
          const values: string[] = [];
          const params: any[] = [];
          slice.forEach(([k, v], idx) => {
            values.push(`($${idx * 3 + 1}, $${idx * 3 + 2}, $${idx * 3 + 3})`);
            params.push(k, v.owner, v.priority);
          });
          // Precedence-aware upsert: overwrite only when the incoming binding is
          // strictly more authoritative. This lets a retried backfill correct a
          // weaker binding that a prior partial run inserted, while never
          // clobbering an upload-time (priority 0) binding.
          await pool.query(
            `INSERT INTO object_owners (object_key, uploaded_by, source_priority) VALUES ${values.join(", ")}
             ON CONFLICT (object_key) DO UPDATE
               SET uploaded_by = EXCLUDED.uploaded_by, source_priority = EXCLUDED.source_priority
               WHERE EXCLUDED.source_priority < object_owners.source_priority`,
            params,
          );
        }
        console.log(`[migrate] object_owners backfilled ${owners.size} object bindings`);
      }
      // Mark complete ONLY when every source query succeeded, so a transient
      // source failure leaves the marker absent and the backfill resumes (and
      // converges) on the next boot rather than locking in a permanent gap.
      if (hadSourceFailure) {
        console.error("[migrate] object_owners backfill incomplete (a source failed); will retry next boot");
      } else {
        await pool.query(`INSERT INTO object_owners_backfill (id) VALUES (1) ON CONFLICT DO NOTHING`);
        console.log(`[migrate] object_owners backfill complete`);
      }
    }
  } catch (err) {
    console.error("[migrate] object_owners table/backfill:", err);
  }

  // Step 2b: Idempotent migrations for offer-letter expiry feature.
  try {
    await pool.query(`ALTER TABLE application_stage_documents ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE application_stage_documents ADD COLUMN IF NOT EXISTS expiry_notified_thresholds TEXT`);
    await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS offer_expiry_warning_days TEXT DEFAULT '30,14,7,1'`);
    await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS contract_expiry_reminder_days TEXT DEFAULT '30,14,7,1'`);
    await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS pdf_accent_color TEXT`);
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
    // The signed-contract PDF is now generated lazily on first download instead of
    // synchronously during signing (heavy headless-Chromium render was crashing the
    // autoscale instance mid-request). The sign step therefore inserts NULL for
    // these columns and they are backfilled on first PDF access. Idempotent.
    await pool.query(`ALTER TABLE signed_contracts ALTER COLUMN pdf_object_key DROP NOT NULL`);
    await pool.query(`ALTER TABLE signed_contracts ALTER COLUMN evidence_hash DROP NOT NULL`);
    // Lease column used by the signed-contract delivery worker to claim a row
    // for processing without two instances double-sending. Distinct from
    // emailed_at (which marks successful delivery), so a crash after claiming
    // does not permanently lose the delivery — the lease expires and the row
    // is reclaimed. Idempotent.
    await pool.query(`ALTER TABLE signed_contracts ADD COLUMN IF NOT EXISTS delivery_claimed_at TIMESTAMPTZ`);
    // Signature base64 column: new sign attempts store the signature PNG as
    // a base64 TEXT string directly in the DB row, eliminating the GCS upload
    // from the sign hot path. The GCS upload (up to 30 s) was OOM-killing the
    // autoscale instance mid-request, causing the edge proxy to return an opaque
    // HTML "403 Forbidden" page. The GCS upload now happens lazily inside
    // ensureSignedContractPdf() on the first PDF download. Idempotent.
    await pool.query(`ALTER TABLE signed_contracts ADD COLUMN IF NOT EXISTS signature_image_base64 TEXT`);

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

    // Per-user permission overrides (tri-state map on top of role perms).
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS permission_overrides jsonb`);

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

  // Idempotent fix: agent_staff and sub_agent users provisioned before this
  // change had emailVerified left at false (DB default). Because they are
  // added by a trusted agent (not via public self-registration) they should
  // never be blocked by the 6-digit verification screen. Set emailVerified=true
  // for all such users who are still stuck on false.
  try {
    const fixRes = await pool.query(`
      UPDATE users
      SET email_verified = TRUE
      WHERE role IN ('agent_staff', 'sub_agent')
        AND email_verified = FALSE
    `);
    const fixed = fixRes.rowCount || 0;
    if (fixed > 0) {
      console.log(`[migrate] Set email_verified=true for ${fixed} agent_staff/sub_agent user(s) blocked on verification screen`);
    }
  } catch (err) {
    console.error("[migrate] agent_staff/sub_agent emailVerified fix:", err);
  }

  // Idempotent fix: revoke any admin_driven signing sessions that were mistakenly
  // assigned to agent_staff or sub_agent users. These roles should never sign
  // individual agency contracts — only the primary agent (role='agent') does.
  try {
    const revokeRes = await pool.query(`
      UPDATE signing_sessions ss
      SET status = 'revoked'
      FROM agents a
      JOIN users u ON u.id = a.user_id
      WHERE ss.agent_id = a.id
        AND ss.mode = 'admin_driven'
        AND ss.status NOT IN ('signed', 'revoked')
        AND u.role IN ('agent_staff', 'sub_agent')
    `);
    const revoked = revokeRes.rowCount || 0;
    if (revoked > 0) {
      console.log(`[migrate] Revoked ${revoked} admin_driven signing session(s) belonging to agent_staff/sub_agent users`);
    }
  } catch (err) {
    console.error("[migrate] revoke agent_staff/sub_agent sessions:", err);
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

    // Documents catalog: add metadata jsonb column if missing, then seed.
    // Runs on every boot (idempotent per-row), outside the bootstrap_done
    // lock so it backfills existing environments too.
    try {
      await pool.query(`ALTER TABLE catalog_options ADD COLUMN IF NOT EXISTS metadata jsonb`);
    } catch (err) {
      console.error("[migrate] catalog_options.metadata:", err);
    }
    try {
      await pool.query(`ALTER TABLE embed_widgets ADD COLUMN IF NOT EXISTS embed_api_key TEXT`);
    } catch (err) {
      console.error("[migrate] embed_widgets.embed_api_key:", err);
    }
    await seedDocumentTypes(pool);
    await seedCurrencies(pool);

    // Idempotent: ensure the assignment.inconsistency notification rule exists
    // for environments seeded before this event was introduced.
    try {
      await pool.query(`
        INSERT INTO notification_rules (event, name, description, category, channels, recipient_type, recipient_roles, is_active, template)
        VALUES (
          'assignment.inconsistency',
          'Assignment Inconsistency Detected',
          'Fired by the periodic consistency checker when a lead or application assignedToId does not match its student',
          'system',
          '["in_app", "email"]'::jsonb,
          'role',
          '["super_admin", "admin"]'::jsonb,
          true,
          '{}'::jsonb
        )
        ON CONFLICT (event) DO NOTHING
      `);
    } catch (err) {
      console.error("[migrate] assignment.inconsistency notification rule:", err);
    }

    // One-shot backfill: grant the three *.view_commission permission keys to
    // the roles that should see commission/earnings figures by default, for
    // environments that were seeded before these keys existed. Gated by a
    // system_flags marker so it runs exactly once — that way an admin who later
    // turns a toggle OFF in the Roles & Permissions editor won't have it
    // silently re-added on the next boot. Staff/consultant/editor are
    // intentionally excluded so commission stays hidden for them by default.
    try {
      const permBackfill = await pool.query(
        `INSERT INTO system_flags (key) VALUES ('role_commission_perms_backfilled') ON CONFLICT DO NOTHING RETURNING key`
      );
      if (permBackfill.rows.length > 0) {
        await pool.query(`
          UPDATE roles
          SET permissions = (
            SELECT jsonb_agg(DISTINCT elem)
            FROM jsonb_array_elements_text(
              permissions || '["leads.view_commission","applications.view_commission","students.view_commission"]'::jsonb
            ) AS elem
          )
          WHERE name IN ('super_admin', 'admin', 'manager', 'accountant')
        `);
        console.log("[migrate] Backfilled *.view_commission permissions for default earnings roles");
      }
    } catch (err) {
      console.error("[migrate] role commission permissions backfill:", err);
    }

    // One-shot backfill: grant the new stage/card-move/assignment permission
    // keys to the roles that should have them by default, for environments
    // seeded before these keys existed. Gated by a system_flags marker so it
    // runs exactly once — an admin who later turns a toggle OFF in the Roles &
    // Permissions editor won't have it silently re-added on the next boot.
    // super_admin/admin/manager get the full action set; staff/consultant get
    // the operational subset (stage changes + view_unassigned + move_cards).
    try {
      const stagePermBackfill = await pool.query(
        `INSERT INTO system_flags (key) VALUES ('role_stage_perms_backfilled') ON CONFLICT DO NOTHING RETURNING key`
      );
      if (stagePermBackfill.rows.length > 0) {
        await pool.query(`
          UPDATE roles
          SET permissions = (
            SELECT jsonb_agg(DISTINCT elem)
            FROM jsonb_array_elements_text(
              permissions || '["leads.change_stage","applications.change_stage","students.change_stage","records.change_assigned","records.view_others","records.view_unassigned","records.assign_button","records.move_cards"]'::jsonb
            ) AS elem
          )
          WHERE name IN ('super_admin', 'admin', 'manager')
        `);
        await pool.query(`
          UPDATE roles
          SET permissions = (
            SELECT jsonb_agg(DISTINCT elem)
            FROM jsonb_array_elements_text(
              permissions || '["leads.change_stage","applications.change_stage","students.change_stage","records.view_unassigned","records.move_cards"]'::jsonb
            ) AS elem
          )
          WHERE name IN ('staff', 'consultant')
        `);
        console.log("[migrate] Backfilled stage/card-move/assignment permissions for default roles");
      }
    } catch (err) {
      console.error("[migrate] role stage permissions backfill:", err);
    }

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
    const { startSignedContractDeliveryWorker } = await import("./lib/signedContractDelivery");
    startSignedContractDeliveryWorker();
    const { startAssignmentConsistencyChecker } = await import("./lib/assignmentConsistencyChecker");
    startAssignmentConsistencyChecker();
  }

  serveStaticFrontend();
  app.listen(port, () => {
    console.log(`Server listening on port ${port} (${isProd ? "production" : "development"})`);
  });
})();
