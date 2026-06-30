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
import { HARDCODED_EXTRACTOR_FIELDS, HARDCODED_EXTRACTOR_RULES } from "./lib/aiDefaultConfigs";
import { seedAiAgentConfig } from "./lib/inbox/aiAgentConfig";

const isProd = process.env.NODE_ENV === "production";

process.on("unhandledRejection", (reason) => {
  console.error("[fatal] Unhandled promise rejection:", reason);
});

// In production, log uncaught exceptions but do NOT exit. A single stray
// exception from a background timer should not take down the entire server
// and cause every in-flight request to receive an opaque edge-proxy 403.
// Node.js will continue serving requests after the log.
process.on("uncaughtException", (err) => {
  console.error("[fatal] Uncaught exception (continuing):", err);
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

async function backfillStudentPhotoFlags() {
  // Repair the denormalized students.has_photo + photo_url from the actual
  // photo/photograph documents. The flag previously drifted false for photos
  // that carried only fileData (legacy uploads, public-apply, embed widget),
  // which hid the avatar on every list/kanban/Student Detail surface that gates
  // on the flag. has_photo must mirror EXACTLY what GET /api/students/:id/photo
  // would serve: it takes the LATEST photo/photograph doc and serves it only
  // when that doc has a file_key, file_data, or an http(s) file_url (a data:/
  // file: url is rejected 422 by the SSRF guard). Runs on every boot (outside
  // the bootstrap lock) so it heals existing/prod data; WHERE-guarded so only
  // drifted rows are written.
  try {
    const result = await db.execute(sql`
      UPDATE students s
      SET has_photo = sub.hp,
          photo_url = CASE WHEN sub.hp THEN '/api/students/' || s.id || '/photo' ELSE NULL END
      FROM (
        SELECT s2.id,
          COALESCE((
            SELECT (
              (d.file_key IS NOT NULL AND d.file_key <> '')
              OR (d.file_data IS NOT NULL AND d.file_data <> '')
              OR (d.file_url ~* '^https?://')
            )
            FROM documents d
            WHERE d.student_id = s2.id
              AND d.type IN ('photo', 'photograph')
              AND d.deleted_at IS NULL
            ORDER BY d.created_at DESC
            LIMIT 1
          ), false) AS hp
        FROM students s2
        WHERE s2.deleted_at IS NULL
      ) sub
      WHERE sub.id = s.id
        AND (
          s.has_photo IS DISTINCT FROM sub.hp
          OR (sub.hp AND s.photo_url IS DISTINCT FROM '/api/students/' || s.id || '/photo')
          OR (NOT sub.hp AND s.photo_url IS NOT NULL)
        )
    `);
    const count = (result as any)?.rowCount || 0;
    if (count > 0) {
      console.log(`[backfill] Resynced has_photo/photo_url for ${count} student(s)`);
    }
  } catch (err) {
    console.error("[backfill] backfillStudentPhotoFlags error:", err);
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

  // Step 1c: General-purpose key-value store for persisting system state across
  // restarts (e.g. assignment consistency checker last-known count for delta
  // alerting). Runs unconditionally on all processes so the table always exists
  // before any worker that reads from it starts.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    await pool.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS read_receipts_enabled BOOLEAN NOT NULL DEFAULT true`);
    await pool.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS bot_enabled BOOLEAN NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS needs_human BOOLEAN NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS bot_last_handled_message_id INTEGER`);
    await pool.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS bot_reply_count INTEGER NOT NULL DEFAULT 0`);
    // Task #554 — multi-account-per-channel: per-account active/default flags.
    // Mirrors migration 0021 (not journaled; boot DDL is the prod migration path).
    await pool.query(`ALTER TABLE channel_accounts ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true`);
    await pool.query(`ALTER TABLE channel_accounts ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false`);
    // Seed channel_accounts from the legacy integrations rows so the existing
    // single connected account becomes the first (default) per-channel account.
    // integrations.config is an already-encrypted JSON object; channel_accounts
    // .config_encrypted is TEXT, so store the JSON as text. Guarded so we only
    // seed when no account exists yet for the channel (idempotent, no cred loss).
    await pool.query(`
      INSERT INTO channel_accounts (channel, display_name, external_account_id, config_encrypted, status, is_active, is_default, created_at, updated_at)
      SELECT 'whatsapp', COALESCE(NULLIF(i.name, ''), 'WhatsApp Business'), NULLIF(i.config->>'phoneNumberId', ''), i.config::text,
             CASE WHEN i.is_enabled THEN 'active' ELSE 'inactive' END, COALESCE(i.is_enabled, false), true, now(), now()
      FROM integrations i
      WHERE i.key = 'whatsapp' AND NOT EXISTS (SELECT 1 FROM channel_accounts ca WHERE ca.channel = 'whatsapp')
    `);
    await pool.query(`
      INSERT INTO channel_accounts (channel, display_name, external_account_id, config_encrypted, status, is_active, is_default, created_at, updated_at)
      SELECT 'messenger', COALESCE(NULLIF(i.name, ''), 'Facebook Messenger'), NULLIF(i.config->>'pageId', ''), i.config::text,
             CASE WHEN i.is_enabled THEN 'active' ELSE 'inactive' END, COALESCE(i.is_enabled, false), true, now(), now()
      FROM integrations i
      WHERE i.key = 'facebook_messenger' AND NOT EXISTS (SELECT 1 FROM channel_accounts ca WHERE ca.channel = 'messenger')
    `);
    await pool.query(`
      INSERT INTO channel_accounts (channel, display_name, external_account_id, config_encrypted, status, is_active, is_default, created_at, updated_at)
      SELECT 'instagram', COALESCE(NULLIF(i.name, ''), 'Instagram'), COALESCE(NULLIF(i.config->>'igBusinessAccountId', ''), NULLIF(i.config->>'pageId', '')), i.config::text,
             CASE WHEN i.is_enabled THEN 'active' ELSE 'inactive' END, COALESCE(i.is_enabled, false), true, now(), now()
      FROM integrations i
      WHERE i.key = 'instagram' AND NOT EXISTS (SELECT 1 FROM channel_accounts ca WHERE ca.channel = 'instagram')
    `);
    await pool.query(`ALTER TABLE application_stage_documents ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE application_stage_documents ADD COLUMN IF NOT EXISTS expiry_notified_thresholds TEXT`);
    // FAZ 3 (AI agent lead capture): qualifying fields the intake bot collects
    // that lack a native leads column. budget→estimated_value, program→
    // interested_program, country→interested_country already exist.
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS interested_level TEXT`);
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS preferred_language TEXT`);
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS mother_name TEXT`);
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS father_name TEXT`);
    await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS offer_expiry_warning_days TEXT DEFAULT '30,14,7,1'`);
    await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS contract_expiry_reminder_days TEXT DEFAULT '30,14,7,1'`);
    await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS pdf_accent_color TEXT`);
    await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS agent_can_change_lead_stage BOOLEAN NOT NULL DEFAULT true`);
    await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS agent_can_change_student_app_stage BOOLEAN NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS direct_student_enrollment_bonus_rate TEXT NOT NULL DEFAULT '0'`);
    // Faz J — stage-doc mirror link: documents rows created by mirroring a
    // stage upload now carry a back-reference so the mirror can be removed
    // when the stage doc is deleted.
    await pool.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_stage_document_id INTEGER`);
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
    // C1 fix: self-fill email rebind lock. Locks the signer email at session
    // creation so send-code/verify-code cannot redirect a code to an arbitrary
    // inbox after the link has been issued. Idempotent.
    await pool.query(`ALTER TABLE signing_sessions ADD COLUMN IF NOT EXISTS expected_email TEXT`);

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

  // Step 2b2b: Persistent API tokens (Bearer auth for programmatic access).
  // Mirrors lib/db migration 0013_api_tokens. Idempotent (IF NOT EXISTS) — this
  // is the prod migration path (deploys run no Drizzle migrate step).
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS api_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        token_prefix TEXT NOT NULL,
        scopes TEXT[] NOT NULL DEFAULT '{}',
        last_used_at TIMESTAMP WITH TIME ZONE,
        expires_at TIMESTAMP WITH TIME ZONE,
        revoked_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_token_hash_unique ON api_tokens(token_hash)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS api_tokens_user_id_idx ON api_tokens(user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS api_tokens_token_prefix_idx ON api_tokens(token_prefix)`);
  } catch (err) {
    console.error("[migrate] api_tokens table:", err);
  }

  // Step 2b2b2: Versioned DB-backed declarative adapter SPECs (opt-in parallel
  // system to portal_adapters). Mirrors lib/db migration 0024. Idempotent —
  // this is the prod migration path (deploys run no Drizzle migrate step).
  try {
    await pool.query(`
      DO $$ BEGIN
        CREATE TYPE "portal_adapter_spec_source" AS ENUM ('builtin', 'uploaded');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS portal_adapter_specs (
        id SERIAL PRIMARY KEY,
        key TEXT NOT NULL,
        name TEXT NOT NULL,
        spec JSONB NOT NULL,
        version INTEGER NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT false,
        source portal_adapter_spec_source NOT NULL DEFAULT 'uploaded',
        js_hook_approved BOOLEAN NOT NULL DEFAULT false,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS portal_adapter_specs_key_version_uniq ON portal_adapter_specs(key, version)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS portal_adapter_specs_key_idx ON portal_adapter_specs(key)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS portal_adapter_specs_enabled_idx ON portal_adapter_specs(enabled)`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS portal_adapter_specs_one_enabled_per_key ON portal_adapter_specs(key) WHERE enabled`);
  } catch (err) {
    console.error("[migrate] portal_adapter_specs table:", err);
  }

  // Step 2b2b3: Phase 3 multi-portal membership. Junction
  // portal_account_universities (catalog university ↔ multi-portal account) +
  // member dimension on portal_program_mapping. Mirrors lib/db migration 0025.
  // Idempotent — this is the prod migration path (no Drizzle migrate on deploy).
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS portal_account_universities (
        id SERIAL PRIMARY KEY,
        portal_key TEXT NOT NULL,
        catalog_university_id INTEGER NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
        enabled BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS portal_acct_uni_catalog_uniq ON portal_account_universities(catalog_university_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS portal_acct_uni_portal_key_idx ON portal_account_universities(portal_key)`);

    await pool.query(`ALTER TABLE portal_program_mapping ADD COLUMN IF NOT EXISTS member_university_id INTEGER REFERENCES universities(id) ON DELETE CASCADE`);
    // Replace the old single UNIQUE(university_key) with two partial uniques so a
    // company key can hold one 1:1 row (member NULL) plus N member-scoped rows.
    await pool.query(`DROP INDEX IF EXISTS portal_prog_map_key_uniq`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS portal_prog_map_key_nomem_uniq ON portal_program_mapping(university_key) WHERE member_university_id IS NULL`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS portal_prog_map_key_mem_uniq ON portal_program_mapping(university_key, member_university_id) WHERE member_university_id IS NOT NULL`);

    // Migrate Phase 2 routes_via members → junction (idempotent). Only members
    // with a catalog id can be expressed in the catalog-keyed junction.
    await pool.query(`
      INSERT INTO portal_account_universities (portal_key, catalog_university_id, enabled)
      SELECT routes_via, crm_university_id, true
        FROM portal_universities
       WHERE routes_via IS NOT NULL
         AND crm_university_id IS NOT NULL
         AND deleted_at IS NULL
      ON CONFLICT (catalog_university_id) DO NOTHING
    `);
  } catch (err) {
    console.error("[migrate] portal_account_universities table:", err);
  }

  // Step 2b2d: Finance Sprint Phase 1 — staff commission fields on commissions +
  // new staff_commission_payouts table.
  // Mirrors lib/db migration 0014_finance_staff_columns. Idempotent (IF NOT EXISTS /
  // ADD COLUMN IF NOT EXISTS) — prod migration path.
  try {
    await pool.query(`ALTER TABLE commissions ADD COLUMN IF NOT EXISTS staff_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
    await pool.query(`ALTER TABLE commissions ADD COLUMN IF NOT EXISTS staff_commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE commissions ADD COLUMN IF NOT EXISTS staff_commission_currency TEXT`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS staff_commission_payouts (
        id SERIAL PRIMARY KEY,
        commission_id INTEGER REFERENCES commissions(id) ON DELETE SET NULL,
        staff_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        amount NUMERIC(12,2) NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        paid_at TIMESTAMP WITH TIME ZONE,
        reference TEXT,
        attachment_url TEXT,
        notes TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        deleted_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS staff_commission_payouts_commission_id_idx ON staff_commission_payouts(commission_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS staff_commission_payouts_staff_user_id_idx ON staff_commission_payouts(staff_user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS staff_commission_payouts_deleted_at_idx ON staff_commission_payouts(deleted_at) WHERE deleted_at IS NULL`);
  } catch (err) {
    console.error("[migrate] finance staff commission tables:", err);
  }

  // Step 2b2c: email_queue retry backoff columns.
  // retry_count — how many delivery attempts have been made so far.
  // max_retries — maximum attempts before the row is marked 'failed'.
  // next_retry_at — when the next attempt may be made (exponential backoff).
  // 'processing' status is used transiently during the UPDATE-based cluster-safe claim.
  // All steps are idempotent (ADD COLUMN IF NOT EXISTS).
  try {
    await pool.query(`ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS max_retries INTEGER NOT NULL DEFAULT 3`);
    await pool.query(`ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ`);
    await pool.query(`CREATE INDEX IF NOT EXISTS email_queue_retry_idx ON email_queue (status, next_retry_at)`);
    // Recover any rows stuck in 'processing' from a previous crashed worker.
    await pool.query(`UPDATE email_queue SET status = 'pending' WHERE status = 'processing'`);
  } catch (err) {
    console.error("[migrate] email_queue retry columns:", err);
  }

  // Step 2b2c2: countries.dial_code (Task #518).
  // Adds an OPTIONAL editable dial code (e.g. "+90") to the country catalog so
  // every phone-code dropdown across the product can source codes from the DB
  // instead of hardcoded arrays. Deploy runs NO migrations, so this idempotent
  // boot DDL is the only prod migration path. The backfill is WHERE dial_code
  // IS NULL guarded — it seeds an initial value from the canonical ISO map on
  // first boot but NEVER overwrites a value an admin has edited afterwards.
  try {
    await pool.query(`ALTER TABLE countries ADD COLUMN IF NOT EXISTS dial_code TEXT`);
    const { ISO_DIAL_CODES } = await import("./lib/dialCodes.js");
    const isoList = Object.keys(ISO_DIAL_CODES);
    const codeList = isoList.map((iso) => ISO_DIAL_CODES[iso]);
    // Single set-based UPDATE keyed on ISO code; only fills NULL dial_code rows.
    await pool.query(
      `UPDATE countries AS c
         SET dial_code = m.dial
         FROM (SELECT UNNEST($1::text[]) AS iso, UNNEST($2::text[]) AS dial) AS m
        WHERE c.dial_code IS NULL AND UPPER(c.code) = m.iso`,
      [isoList, codeList],
    );
  } catch (err) {
    console.error("[migrate] countries.dial_code:", err);
  }

  // Step 2b2d: Website CMS collections tables.
  // These mirror the Drizzle schema definitions in lib/db/src/schema/website.ts.
  // All steps are idempotent (CREATE TABLE IF NOT EXISTS).
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS website_collections_offices (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        city TEXT,
        country TEXT,
        address TEXT,
        phone TEXT,
        email TEXT,
        map_embed_url TEXT,
        image_url TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        translations_json JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`ALTER TABLE website_collections_offices ADD COLUMN IF NOT EXISTS translations_json JSONB NOT NULL DEFAULT '{}'`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS website_collections_team_members (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        title TEXT,
        bio TEXT,
        photo_url TEXT,
        email TEXT,
        linkedin_url TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        translations_json JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`ALTER TABLE website_collections_team_members ADD COLUMN IF NOT EXISTS translations_json JSONB NOT NULL DEFAULT '{}'`);
    // One-shot seed: populate with defaults sourced from the en.json i18n file
    // (about.team* and contact.office* keys). Uses a system_flags marker so
    // re-deploys don't overwrite edits made in the admin panel.
    const seedFlag = await pool.query(
      `INSERT INTO system_flags (key) VALUES ('cms_collections_seeded_v1') ON CONFLICT DO NOTHING RETURNING key`
    );
    if (seedFlag.rows.length > 0) {
      // Load i18n defaults from the frontend translations file so seed values
      // stay in sync with the static text that was previously shown on the page.
      let i18nEn: Record<string, Record<string, string>> = { about: {}, contact: {} };
      try {
        const enJsonPath = path.join(process.cwd(), "../edcons/src/lib/i18n/translations/en.json");
        const raw = fs.readFileSync(enJsonPath, "utf-8");
        i18nEn = JSON.parse(raw);
      } catch {
        console.warn("[migrate] Could not load en.json for CMS seed — using built-in defaults");
      }
      const a = i18nEn.about ?? {};
      const c = i18nEn.contact ?? {};
      const { rowCount: officeCount } = await pool.query(`SELECT 1 FROM website_collections_offices LIMIT 1`);
      if ((officeCount ?? 0) === 0) {
        const offices = [
          { name: a["office0City"] ?? c["office0City"] ?? "Istanbul Office", city: c["office0City"] ?? "Istanbul", country: "Türkiye", address: c["office0Address"] ?? "Levent Mahallesi, Buyukdere Cad. No:45, 34394 Istanbul, Turkiye", order: 0 },
          { name: a["office1City"] ?? c["office1City"] ?? "London Office",   city: c["office1City"] ?? "London",   country: "UK",       address: c["office1Address"] ?? "30 St Mary Axe, London EC3A 8BF, UK",                             order: 1 },
          { name: a["office2City"] ?? c["office2City"] ?? "Dubai Office",    city: c["office2City"] ?? "Dubai",    country: "UAE",      address: c["office2Address"] ?? "Dubai Internet City, Building 4, Office 220",                     order: 2 },
        ];
        for (const o of offices) {
          await pool.query(
            `INSERT INTO website_collections_offices (name, city, country, address, sort_order, is_active) VALUES ($1, $2, $3, $4, $5, TRUE)`,
            [o.name, o.city, o.country, o.address, o.order]
          );
        }
        console.log(`[migrate] website_collections_offices seeded with ${offices.length} offices from en.json`);
      }
      const { rowCount: memberCount } = await pool.query(`SELECT 1 FROM website_collections_team_members LIMIT 1`);
      if ((memberCount ?? 0) === 0) {
        const members = [
          { name: a["team0Name"] ?? "Dr. Ayse Yildiz",   title: a["team0Role"] ?? "Founder & CEO",                 bio: a["team0Bio"] ?? "15+ years in international education consulting.", order: 0 },
          { name: a["team1Name"] ?? "Marcus Chen",        title: a["team1Role"] ?? "Head of Admissions",            bio: a["team1Bio"] ?? "Guided 2,000+ students to their dream universities across 30 countries.", order: 1 },
          { name: a["team2Name"] ?? "Fatima Al-Hassan",   title: a["team2Role"] ?? "Visa & Immigration Specialist", bio: a["team2Bio"] ?? "Expert in student visa processes for UK, USA, Canada, Australia, and Europe.", order: 2 },
          { name: a["team3Name"] ?? "Olena Kovalenko",    title: a["team3Role"] ?? "Regional Manager - Europe",     bio: a["team3Bio"] ?? "Specializes in European university placements and scholarship programs.", order: 3 },
        ];
        for (const m of members) {
          await pool.query(
            `INSERT INTO website_collections_team_members (name, title, bio, sort_order, is_active) VALUES ($1, $2, $3, $4, TRUE)`,
            [m.name, m.title, m.bio, m.order]
          );
        }
        console.log(`[migrate] website_collections_team_members seeded with ${members.length} members from en.json`);
      }
    }
  } catch (err) {
    console.error("[migrate] website CMS collections tables:", err);
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
    // Perpetual idempotent sync — runs every boot to fix any drift between
    // the documents table and the denormalized has_photo flag (e.g. photos
    // uploaded via fileUrl-only path, or records created before the flag
    // was introduced). Both directions are covered: set TRUE where a photo
    // doc exists, clear FALSE where it no longer does.
    // The one-time system_flags guard is removed — this UPDATE only touches
    // rows where has_photo is already wrong, so it is always safe to run.
    const { rowCount: photoSet } = await pool.query(`
      UPDATE students s
      SET has_photo = TRUE
      WHERE has_photo = FALSE
        AND EXISTS (
          SELECT 1 FROM documents d
          WHERE d.student_id = s.id
            AND d.type IN ('photo', 'photograph')
            AND d.deleted_at IS NULL
        )
    `);
    const { rowCount: photoCleared } = await pool.query(`
      UPDATE students s
      SET has_photo = FALSE
      WHERE has_photo = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM documents d
          WHERE d.student_id = s.id
            AND d.type IN ('photo', 'photograph')
            AND d.deleted_at IS NULL
        )
    `);
    if ((photoSet ?? 0) > 0 || (photoCleared ?? 0) > 0) {
      console.log(`[migrate] students.has_photo synced: +${photoSet ?? 0} set, -${photoCleared ?? 0} cleared`);
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

    // Phase 1/3: automatic backup-programme (supersession) links on applications.
    // When a full programme is superseded by an auto-created fallback the original
    // points to the new one (superseded_by) and the new one points back
    // (superseded_from). Idempotent — required in prod for the fallback orchestrator.
    await pool.query(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS superseded_by_application_id INTEGER REFERENCES applications(id) ON DELETE SET NULL`);
    await pool.query(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS superseded_from_application_id INTEGER REFERENCES applications(id) ON DELETE SET NULL`);
    await pool.query(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS supersede_reason TEXT`);

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

  try {
    await pool.query(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS contact_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
  } catch (err) {
    console.error("[migrate] branches contact_user_id:", err);
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

  // Step 2b4: Dashboard FAZ 1 — entity_view_events table for per-entity view
  // tracking (leadsViewed/studentsViewed/applicationsViewed/messagesViewed).
  // Indexes: (userId, viewedAt) and (entityType, viewedAt).
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS entity_view_events (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        agent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        deleted_at TIMESTAMPTZ
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS entity_view_events_user_viewed_at_idx ON entity_view_events(user_id, viewed_at)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS entity_view_events_entity_type_viewed_at_idx ON entity_view_events(entity_type, viewed_at)`);
  } catch (err) {
    console.error("[migrate] entity_view_events:", err);
  }

  // Step 2b5: ai_default_configs — editable built-in defaults for AI extractors
  // and personas. Admin can override via the UI; DELETE reverts to hardcoded.
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_default_configs (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL DEFAULT '{}',
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  } catch (err) {
    console.error("[migrate] ai_default_configs:", err);
  }

  // Step 2b6: Seed 4 example AI personas (idempotent via ON CONFLICT DO NOTHING
  // on slug). All are seeded inactive so admins activate after review.
  try {
    await pool.query(`
      INSERT INTO ai_personas
        (name, slug, persona_type, description, provider, model, system_prompt,
         guidelines, negative_prompt, allowed_data_scopes, tools_enabled,
         trigger_mode, schedule_cron, event_subscriptions, output_targets, is_active)
      VALUES
        (
          'System Audit',
          'system-audit',
          'advisor',
          'Read-only system auditor — analyses audit logs, finance and HR data and produces structured reports.',
          'anthropic', 'claude-sonnet-4-6',
          'You are an expert system auditor for an international education consultancy. Analyse the provided system data and produce a concise, structured audit report. Do not take any actions — advisory only.',
          E'- Present findings in a structured format with clear sections\n- Highlight anomalies, suspicious patterns or data inconsistencies\n- Include counts and timestamps where relevant\n- Keep the report objective and factual',
          '',
          '["audit","finance","hr"]'::jsonb,
          '[]'::jsonb,
          'manual', NULL, NULL, '[]'::jsonb, false
        ),
        (
          'Blog Yazarı Zeynep',
          'blog-yazar-zeynep',
          'advisor',
          'Creative blog writer persona — drafts SEO-friendly education content in Turkish and English.',
          'anthropic', 'claude-sonnet-4-6',
          'Zeynep, uluslararası eğitim danışmanlığı şirketimiz için blog içerikleri yazan yaratıcı bir yazarsın. Hem Türkçe hem İngilizce içerik üretebilirsin. Hedef kitleye uygun, SEO dostu ve bilgilendirici yazılar hazırlarsın.',
          E'- Her yazıda net bir başlık, giriş, ana bölümler ve sonuç bulunmalı\n- Yurt dışı eğitim fırsatlarına odaklan\n- SEO anahtar kelimelerini doğal şekilde kullan\n- Akademik ama ulaşılabilir bir dil kullan',
          'Clickbait başlık, yanıltıcı bilgi veya garanti vaat etme.',
          '["blog"]'::jsonb,
          '["blog_draft"]'::jsonb,
          'manual', NULL, NULL, '[]'::jsonb, false
        ),
        (
          'Lead Özetleyici',
          'lead-summarizer',
          'advisor',
          'Summarises lead records — highlights key info, conversion likelihood and recommended next steps.',
          'anthropic', 'claude-sonnet-4-6',
          'You are a lead analysis specialist for an international education consultancy. Given lead data provided as context, produce concise summaries highlighting the most important information, conversion likelihood indicators, and recommended next actions for the sales team.',
          E'- Summarise in 3-5 bullet points maximum\n- Highlight urgency indicators (deadline, hot lead, stalled)\n- End with one clear recommended next action\n- Use plain, direct language',
          'Do not invent data not present in the context. Do not make promises on behalf of the company.',
          '[]'::jsonb,
          '[]'::jsonb,
          'manual', NULL, NULL, '[]'::jsonb, false
        ),
        (
          'Takip Hatırlatıcı',
          'followup-reminder',
          'operator',
          'Scheduled operator — composes a weekly follow-up reminder notification for the team. Actions go to Approval Queue.',
          'anthropic', 'claude-sonnet-4-6',
          'You are a follow-up reminder operator for an international education consultancy. Every week, compose a brief, actionable notification message reminding the team of pending leads and follow-up priorities. Be concise, professional, and motivating.',
          E'- Keep the message under 150 words\n- Mention the day/week context\n- Include a call-to-action\n- Use a friendly but professional tone',
          'Do not include specific student names or confidential data in the notification body.',
          '[]'::jsonb,
          '["notification"]'::jsonb,
          'scheduled', '0 9 * * MON', NULL, '[]'::jsonb, false
        )
      ON CONFLICT (slug) DO UPDATE SET is_active = true
    `);
  } catch (err) {
    console.error("[migrate] example ai_personas seed:", err);
  }

  // Step 2b7: Seed built-in Passport / Transcript extractor (idempotent via ON CONFLICT slug).
  // Uses the shared HARDCODED_EXTRACTOR_FIELDS and HARDCODED_EXTRACTOR_RULES from aiDefaultConfigs.
  try {
    await pool.query(
      `INSERT INTO ai_extractors
         (name, slug, description, provider, model, system_prompt,
          fields, rules, scopes, document_types,
          temperature, max_tokens, is_active, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12, $13, $14)
       ON CONFLICT (slug) DO UPDATE SET
         fields        = EXCLUDED.fields,
         rules         = EXCLUDED.rules,
         model         = EXCLUDED.model,
         temperature   = EXCLUDED.temperature,
         max_tokens    = EXCLUDED.max_tokens,
         is_active     = EXCLUDED.is_active,
         is_default    = EXCLUDED.is_default`,
      [
        "Passport / Transcript",
        "builtin-passport-transcript",
        "Built-in extractor for passport and academic documents. Uses the shared field schema and global extraction rules.",
        "anthropic",
        "claude-sonnet-4-6",
        "",
        JSON.stringify(HARDCODED_EXTRACTOR_FIELDS),
        JSON.stringify({ globalRules: HARDCODED_EXTRACTOR_RULES }),
        JSON.stringify(["public_apply", "embed", "staff", "agent"]),
        JSON.stringify(["passport", "diploma", "transcript"]),
        0.20,
        4096,
        true,
        true,
      ]
    );
  } catch (err) {
    console.error("[migrate] builtin extractor seed:", err);
  }

  // Step 2b8: One-shot data fix — move Tayma (2716) and Sarah (2717) from the
  // accidental "Genel Şube" branch (1373) back to the main "Find And Study"
  // branch (1). Also moves any leads or students stuck in branch 1373 to
  // branch 1 so their assignments remain visible in the main branch UI.
  try {
    const branchFix = await pool.query(
      `INSERT INTO system_flags (key) VALUES ('staff_branch_fix_v1') ON CONFLICT DO NOTHING RETURNING key`
    );
    if (branchFix.rows.length > 0) {
      const uResult = await pool.query(
        `UPDATE users SET branch_id = 1, updated_at = NOW()
         WHERE id IN (2716, 2717) AND branch_id = 1373`
      );
      const lResult = await pool.query(
        `UPDATE leads SET branch_id = NULL, updated_at = NOW()
         WHERE branch_id = 1373`
      );
      const sResult = await pool.query(
        `UPDATE students SET branch_id = NULL, updated_at = NOW()
         WHERE branch_id = 1373`
      );
      console.log(
        `[migrate] staff branch fix: ${uResult.rowCount} user(s), ` +
        `${lResult.rowCount} lead(s), ${sResult.rowCount} student(s) moved from branch 1373 → main`
      );
    }
  } catch (err) {
    console.error("[migrate] staff branch fix:", err);
  }

  // Step 2b9: One-shot cleanup — soft-delete the "PLAY WRITE" Playwright test
  // staff account (id=2803, apply@findandstudy.com) from production so it no
  // longer appears in the Users list.
  try {
    const playwrightFix = await pool.query(
      `INSERT INTO system_flags (key) VALUES ('cleanup_playwright_staff_v1') ON CONFLICT DO NOTHING RETURNING key`
    );
    if (playwrightFix.rows.length > 0) {
      const result = await pool.query(
        `UPDATE users SET deleted_at = NOW(), updated_at = NOW()
         WHERE id = 2803 AND role = 'staff' AND deleted_at IS NULL`
      );
      console.log(`[migrate] playwright staff cleanup: ${result.rowCount} user(s) soft-deleted`);
    }
  } catch (err) {
    console.error("[migrate] playwright staff cleanup:", err);
  }

  // Step 2b10: Restore apply@findandstudy.com (PLAY WRITE, id=2803) — was
  // accidentally soft-deleted by step 2b9; user is intentionally kept.
  try {
    await pool.query(
      `UPDATE users SET deleted_at = NULL, updated_at = NOW()
       WHERE id = 2803 AND email = 'apply@findandstudy.com' AND deleted_at IS NOT NULL`
    );
  } catch (err) {
    console.error("[migrate] restore apply@findandstudy.com:", err);
  }

  // Step 2b11: Portal Automation — portal_submissions table + enums (idempotent).
  try {
    await pool.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."portal_submission_mode" AS ENUM('dry', 'real');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$
    `);
    await pool.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."portal_submission_status" AS ENUM('queued', 'running', 'submitted', 'already_exists', 'program_missing', 'failed', 'canceled');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$
    `);
    await pool.query(`
      ALTER TYPE "public"."portal_submission_status" ADD VALUE IF NOT EXISTS 'dry_run'
    `);
    await pool.query(`
      ALTER TYPE "public"."portal_submission_status" ADD VALUE IF NOT EXISTS 'program_full'
    `);
    await pool.query(`
      ALTER TYPE "public"."portal_submission_status" ADD VALUE IF NOT EXISTS 'exclusive_region'
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS portal_submissions (
        id SERIAL PRIMARY KEY,
        application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        university_key TEXT NOT NULL,
        university_name TEXT NOT NULL,
        mode portal_submission_mode NOT NULL DEFAULT 'dry',
        status portal_submission_status NOT NULL DEFAULT 'queued',
        external_ref TEXT,
        result_json JSONB,
        screenshot_urls JSONB,
        error TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        locked_at TIMESTAMPTZ,
        locked_by TEXT,
        enqueued_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS portal_submissions_application_id_idx ON portal_submissions USING btree (application_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS portal_submissions_status_idx ON portal_submissions USING btree (status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS portal_submissions_locked_at_idx ON portal_submissions USING btree (locked_at)`);
    // Free-form metadata jsonb (supersession context / structured "Kontenjan
    // Dolu" program_full payload: requestedProgram + openPrograms). Idempotent.
    await pool.query(`ALTER TABLE portal_submissions ADD COLUMN IF NOT EXISTS meta JSONB`);
  } catch (err) {
    console.error("[migrate] portal_submissions:", err);
  }

  // Step 2b12: Portal Automation — portal_automation_settings + portal_universities (idempotent).
  try {
    await pool.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."portal_automation_mode" AS ENUM('dry', 'real');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$
    `);
    await pool.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."portal_automation_scope" AS ENUM('only_applied', 'selected', 'all');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS portal_automation_settings (
        id SERIAL PRIMARY KEY,
        is_enabled BOOLEAN NOT NULL DEFAULT false,
        trigger_stages JSONB NOT NULL DEFAULT '[]',
        mode portal_automation_mode NOT NULL DEFAULT 'dry',
        scope portal_automation_scope NOT NULL DEFAULT 'only_applied',
        selected_university_keys JSONB NOT NULL DEFAULT '[]',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS portal_universities (
        id SERIAL PRIMARY KEY,
        university_key TEXT NOT NULL,
        university_name TEXT NOT NULL,
        adapter_key TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        crm_university_id INTEGER,
        defaults JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS portal_uni_university_key_uniq ON portal_universities (university_key)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS portal_uni_adapter_key_idx ON portal_universities (adapter_key)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS portal_uni_is_active_idx ON portal_universities (is_active)`);
    // Idempotent migrations for new scheduled auto-process columns
    await pool.query(`ALTER TABLE portal_automation_settings ADD COLUMN IF NOT EXISTS auto_process_enabled BOOLEAN NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE portal_automation_settings ADD COLUMN IF NOT EXISTS auto_process_interval_minutes INTEGER NOT NULL DEFAULT 20`);
    await pool.query(`ALTER TABLE portal_automation_settings ADD COLUMN IF NOT EXISTS last_auto_drain_at TIMESTAMPTZ`);
    // Phase 3: program-fallback orchestrator kill-switch (opt-in, default off).
    await pool.query(`ALTER TABLE portal_automation_settings ADD COLUMN IF NOT EXISTS fallback_enabled BOOLEAN NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE portal_universities ADD COLUMN IF NOT EXISTS auto_process BOOLEAN NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE portal_universities ADD COLUMN IF NOT EXISTS is_multi_portal BOOLEAN NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE portal_universities ADD COLUMN IF NOT EXISTS routes_via TEXT`);
    await pool.query(`CREATE INDEX IF NOT EXISTS portal_uni_routes_via_idx ON portal_universities (routes_via)`);
    // Phase 3: program-fallback (supersession) rules. Maps a SOURCE CRM programme
    // (the full one) to an ordered list of fallback CRM program ids, scoped to a
    // portal university. Idempotent — required in prod for the fallback orchestrator.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS portal_program_fallbacks (
        id SERIAL PRIMARY KEY,
        university_key TEXT NOT NULL,
        source_program_id INTEGER NOT NULL,
        fallback_program_ids JSONB NOT NULL DEFAULT '[]',
        auto_submit BOOLEAN NOT NULL DEFAULT true,
        enabled BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);
    // Partial unique: only one ACTIVE rule per (university_key, source_program_id),
    // so a soft-deleted rule can be recreated. Drop any non-partial legacy index first.
    await pool.query(`DROP INDEX IF EXISTS portal_prog_fallback_key_source_uniq`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS portal_prog_fallback_key_source_uniq ON portal_program_fallbacks (university_key, source_program_id) WHERE deleted_at IS NULL`);
    // University-based nationality exclusions ("exclusive region"). When a
    // student's nationality is on the exclusive list for a portal university the
    // worker skips the portal entirely and marks status='exclusive_region'.
    // Idempotent — required in prod for the preventive exclusion check.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS portal_university_exclusions (
        id SERIAL PRIMARY KEY,
        university_key TEXT NOT NULL,
        nationality TEXT NOT NULL,
        agency_name TEXT,
        note TEXT,
        enabled BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);
    // Partial unique: only one ACTIVE rule per (university_key, nationality),
    // so a soft-deleted rule can be recreated.
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS portal_uni_exclusion_key_nat_uniq ON portal_university_exclusions (university_key, nationality) WHERE deleted_at IS NULL`);
  } catch (err) {
    console.error("[migrate] portal_automation_settings/portal_universities:", err);
  }

  // Step 2b13: Portal Adapters table + Program Mapping table (idempotent).
  try {
    await pool.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."portal_adapter_kind" AS ENUM('code', 'declarative');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS portal_adapters (
        id SERIAL PRIMARY KEY,
        key TEXT NOT NULL,
        label TEXT NOT NULL,
        base_url TEXT NOT NULL DEFAULT '',
        match_names TEXT NOT NULL DEFAULT '',
        kind portal_adapter_kind NOT NULL DEFAULT 'code',
        config_json JSONB,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS portal_adp_key_uniq ON portal_adapters (key)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS portal_adp_is_active_idx ON portal_adapters (is_active)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS portal_program_mapping (
        id SERIAL PRIMARY KEY,
        university_key TEXT NOT NULL,
        mappings JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS portal_prog_map_key_uniq ON portal_program_mapping (university_key)`);
    // Panel-managed matching data (single-source). Additive, idempotent — the
    // matcher reads these MERGED OVER the adapter's built-in defaults (DB wins).
    await pool.query(`ALTER TABLE portal_program_mapping ADD COLUMN IF NOT EXISTS program_overrides JSONB NOT NULL DEFAULT '{}'`);
    await pool.query(`ALTER TABLE portal_program_mapping ADD COLUMN IF NOT EXISTS synonyms JSONB NOT NULL DEFAULT '[]'`);
    await pool.query(`ALTER TABLE portal_program_mapping ADD COLUMN IF NOT EXISTS country_overrides JSONB NOT NULL DEFAULT '{}'`);
  } catch (err) {
    console.error("[migrate] portal_adapters/portal_program_mapping:", err);
  }

  // Step 2b13b: Portal Automation — portal_program_cache (LIVE program option
  // lists cached per (university_key, level); TTL refresh handled in the API).
  // `level` is NOT NULL DEFAULT '' so the unique key + ON CONFLICT upsert work
  // (PostgreSQL treats NULLs as distinct, which would break both).
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS portal_program_cache (
        id SERIAL PRIMARY KEY,
        university_key TEXT NOT NULL,
        level TEXT NOT NULL DEFAULT '',
        options JSONB NOT NULL DEFAULT '[]',
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS portal_prog_cache_key_level_uniq ON portal_program_cache (university_key, level)`);
  } catch (err) {
    console.error("[migrate] portal_program_cache:", err);
  }

  // Step 2b12: portal_credentials — encrypted per-portal username/password (AES-256-GCM).
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS portal_credentials (
        id SERIAL PRIMARY KEY,
        portal_key TEXT NOT NULL,
        username_enc TEXT NOT NULL,
        password_enc TEXT NOT NULL,
        extra_enc TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS portal_creds_portal_key_uniq ON portal_credentials (portal_key)`);
  } catch (err) {
    console.error("[migrate] portal_credentials:", err);
  }

  // Step 2b12b: Backfill portal_credentials stored under universityKey → adapterKey (canonical).
  // Idempotent: only updates rows where portal_key differs from the university's adapter_key.
  try {
    await pool.query(`
      UPDATE portal_credentials pc
      SET portal_key = pu.adapter_key, updated_at = NOW()
      FROM portal_universities pu
      WHERE pc.portal_key = pu.university_key
        AND pc.portal_key != pu.adapter_key
        AND pc.deleted_at IS NULL
    `);
  } catch (err) {
    console.error("[migrate] portal_credentials backfill universityKey→adapterKey:", err);
  }

  // Step 2b14: Backfill assignedToId consistency across Lead → Student → Application.
  // Runs on every boot; both UPDATEs are idempotent (IS DISTINCT FROM guard ensures
  // only genuinely out-of-sync rows are touched). Logs affected counts so each
  // deploy can confirm convergence.
  try {
    // Before counts — helps diagnose residual drift after the first run.
    const { rows: preRows } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM students s
           JOIN leads l ON l.id = s.origin_lead_id
          WHERE l.assigned_to_id IS NOT NULL
            AND s.assigned_to_id IS DISTINCT FROM l.assigned_to_id
            AND s.deleted_at IS NULL
            AND l.deleted_at IS NULL) AS student_drift,
        (SELECT COUNT(*) FROM applications a
           JOIN students s ON s.id = a.student_id
          WHERE s.assigned_to_id IS NOT NULL
            AND a.assigned_to_id IS DISTINCT FROM s.assigned_to_id
            AND a.deleted_at IS NULL
            AND s.deleted_at IS NULL) AS app_drift
    `);
    const preStudentDrift = parseInt(preRows[0]?.student_drift ?? "0", 10);
    const preAppDrift     = parseInt(preRows[0]?.app_drift     ?? "0", 10);

    // Pass 1: propagate lead's assignedToId → student (only when lead has one).
    const { rowCount: studentFixed } = await pool.query(`
      UPDATE students s
         SET assigned_to_id = l.assigned_to_id,
             updated_at     = NOW()
        FROM leads l
       WHERE s.origin_lead_id              = l.id
         AND l.assigned_to_id             IS NOT NULL
         AND s.assigned_to_id             IS DISTINCT FROM l.assigned_to_id
         AND s.deleted_at                 IS NULL
         AND l.deleted_at                 IS NULL
    `);

    // Pass 2: propagate student's (now-updated) assignedToId → application.
    const { rowCount: appFixed } = await pool.query(`
      UPDATE applications a
         SET assigned_to_id = s.assigned_to_id,
             updated_at     = NOW()
        FROM students s
       WHERE a.student_id                  = s.id
         AND s.assigned_to_id             IS NOT NULL
         AND a.assigned_to_id             IS DISTINCT FROM s.assigned_to_id
         AND a.deleted_at                 IS NULL
         AND s.deleted_at                 IS NULL
    `);

    if ((studentFixed ?? 0) > 0 || (appFixed ?? 0) > 0 || preStudentDrift > 0 || preAppDrift > 0) {
      console.log(
        `[migrate] assignedToId backfill: ` +
        `students ${studentFixed ?? 0} fixed (was ${preStudentDrift} drifted), ` +
        `applications ${appFixed ?? 0} fixed (was ${preAppDrift} drifted)`
      );
    }
  } catch (err) {
    console.error("[migrate] assignedToId backfill:", err);
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

    // Runs on EVERY boot (outside the bootstrap_done lock) so existing/prod
    // environments that were already bootstrapped still materialize the
    // ai_agent config row. Idempotent — only inserts when the row is absent.
    await seedAiAgentConfig();

    // Runs on EVERY boot (outside the bootstrap_done lock) so it heals
    // existing/prod data, not just freshly seeded environments. Idempotent and
    // WHERE-guarded — only writes the handful of students whose flag has drifted.
    await backfillStudentPhotoFlags();

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
    try {
      await pool.query(`ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ`);
    } catch (err) {
      console.error("[migrate] follow_ups.notified_at:", err);
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

    // Idempotent: upgrade message.new to include email channel (was in_app only),
    // and ensure note.created rule exists for environments seeded before it was added.
    try {
      await pool.query(`
        UPDATE notification_rules
        SET channels = '["in_app","email"]'::jsonb
        WHERE event = 'message.new'
          AND NOT (channels @> '["email"]'::jsonb)
      `);
      await pool.query(`
        INSERT INTO notification_rules (event, name, description, category, channels, recipient_type, recipient_roles, is_active, template)
        VALUES (
          'note.created',
          'Note Added',
          'When a note is added to an application, student, or lead record',
          'notes',
          '["in_app","email"]'::jsonb,
          'specific',
          '[]'::jsonb,
          true,
          '{}'::jsonb
        )
        ON CONFLICT (event) DO NOTHING
      `);
    } catch (err) {
      console.error("[migrate] notification_rules channel upgrades:", err);
    }

    // One-shot data fix: sync leads and applications whose assigned_to_id does
    // not match their student's assigned_to_id. These accumulated over time
    // because assignment cascades are permission-gated and many historical
    // reassignments pre-date the cascade feature. The student is the canonical
    // record; leads and applications inherit from it.
    // Gated by system_flags so it runs exactly once per environment, not on
    // every boot. A future manual change via the UI will continue to cascade
    // normally through the existing cascade helpers.
    try {
      const assignFix = await pool.query(
        `INSERT INTO system_flags (key) VALUES ('assignment_consistency_backfill_v1') ON CONFLICT DO NOTHING RETURNING key`
      );
      if (assignFix.rows.length > 0) {
        const leadResult = await pool.query(`
          UPDATE leads l
          SET assigned_to_id = s.assigned_to_id
          FROM students s
          WHERE l.converted_student_id = s.id
            AND l.assigned_to_id IS DISTINCT FROM s.assigned_to_id
            AND l.deleted_at IS NULL
            AND s.deleted_at IS NULL
        `);
        const appResult = await pool.query(`
          UPDATE applications a
          SET assigned_to_id = s.assigned_to_id
          FROM students s
          WHERE a.student_id = s.id
            AND a.assigned_to_id IS DISTINCT FROM s.assigned_to_id
            AND a.deleted_at IS NULL
            AND s.deleted_at IS NULL
        `);
        const leadsFixed = leadResult.rowCount ?? 0;
        const appsFixed = appResult.rowCount ?? 0;
        console.log(`[migrate] assignment consistency backfill: fixed ${leadsFixed} lead(s), ${appsFixed} application(s)`);
        // Reset the stored delta-alerting baseline so the checker doesn't
        // immediately alert with the (now-lower) fresh count on next run.
        await pool.query(
          `INSERT INTO system_kv (key, value, updated_at) VALUES ('assignment_inconsistency_last_count', '0', NOW())
           ON CONFLICT (key) DO UPDATE SET value = '0', updated_at = NOW()`
        );
      }
    } catch (err) {
      console.error("[migrate] assignment consistency backfill:", err);
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

    // Backfill records.assign_button for staff/consultant roles (prod migration).
    try {
      const assignBtnBackfill = await pool.query(
        `INSERT INTO system_flags (key) VALUES ('role_assign_button_staff_backfilled') ON CONFLICT DO NOTHING RETURNING key`
      );
      if (assignBtnBackfill.rows.length > 0) {
        await pool.query(`
          UPDATE roles
          SET permissions = (
            SELECT jsonb_agg(DISTINCT elem)
            FROM jsonb_array_elements_text(
              permissions || '["records.assign_button"]'::jsonb
            ) AS elem
          )
          WHERE name IN ('staff', 'consultant')
            AND NOT (permissions @> '["records.assign_button"]'::jsonb)
        `);
        console.log("[migrate] Backfilled records.assign_button for staff/consultant roles");
      }
    } catch (err) {
      console.error("[migrate] role assign_button backfill:", err);
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
    // Null-fill backfill: runs on every boot but is idempotent — only touches
    // records where assignedToId IS NULL, so a second run is always a no-op.
    setTimeout(async () => {
      try {
        const { backfillNullAssignments } = await import("./lib/leadAssignment");
        await backfillNullAssignments(null);
      } catch (err: any) {
        console.error("[boot] backfillNullAssignments error:", err?.message || err);
      }
    }, 15_000);
    const { startFollowUpChecker } = await import("./lib/followUpChecker");
    startFollowUpChecker();
    const { startPortalStuckReset } = await import("./routes/portalAutomation");
    startPortalStuckReset();
  }

  serveStaticFrontend();

  const { feedBus } = await import("./lib/feedBus");
  const shutdown = async (signal: string) => {
    console.log(`[shutdown] ${signal} received — releasing feedBus LISTEN connection`);
    try { await feedBus.shutdown(); } catch { /* ignore */ }
  };
  process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.once("SIGINT",  () => { void shutdown("SIGINT"); });

  app.listen(port, () => {
    console.log(`Server listening on port ${port} (${isProd ? "production" : "development"})`);
    if (typeof process.send === "function") {
      process.send("ready");
    }
  });
})();
