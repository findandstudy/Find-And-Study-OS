/**
 * RBAC E2E Setup Script
 * Creates missing audit accounts and agent records needed for Bölüm A2 E2E tests.
 *
 * Run: cd artifacts/api-server && pnpm exec tsx scripts/rbac-e2e-setup.ts
 */
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const HASH = "$2b$10$Qx/oEqGzMqoQGvizNRuTK.u8jff4.rbnMfPkLttmmrYDIL2u2OsXi"; // TestAudit2026!
const ALL_PERMS = ["leads", "students", "applications", "documents", "course_finder", "messages", "commissions"];

const AUDIT_AGENT_USER_ID = 8733;
const AUDIT_SUBAGENT_USER_ID = 8734;

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Create super_admin audit account
    await client.query(`
      INSERT INTO users (email, password_hash, role, first_name, last_name, is_active, email_verified, created_at, updated_at)
      VALUES ('audit-superadmin@audit.test', $1, 'super_admin', 'Audit', 'SuperAdmin', true, true, NOW(), NOW())
      ON CONFLICT (email) DO NOTHING
    `, [HASH]);
    console.log("[setup] audit-superadmin@audit.test — OK");

    // 2. Create agent record for audit-agent (user_id=8733) if missing
    const agentCheck = await client.query(
      `SELECT id FROM agents WHERE user_id = $1`, [AUDIT_AGENT_USER_ID]
    );
    let agentRecordId: number;
    if (agentCheck.rows.length === 0) {
      const ins = await client.query(`
        INSERT INTO agents (user_id, company_name, first_name, last_name, email, status, created_at, updated_at)
        VALUES ($1, 'Audit Agency', 'Audit', 'Agent', 'audit-agent@audit.test', 'active', NOW(), NOW())
        RETURNING id
      `, [AUDIT_AGENT_USER_ID]);
      agentRecordId = ins.rows[0].id;
      console.log(`[setup] agents record for audit-agent — id=${agentRecordId}`);
    } else {
      agentRecordId = agentCheck.rows[0].id;
      console.log(`[setup] agents record for audit-agent already exists — id=${agentRecordId}`);
    }

    // 3. Create agent record for audit-subagent (user_id=8734, parent=audit-agent)
    const subCheck = await client.query(
      `SELECT id FROM agents WHERE user_id = $1`, [AUDIT_SUBAGENT_USER_ID]
    );
    let subAgentRecordId: number;
    if (subCheck.rows.length === 0) {
      const ins = await client.query(`
        INSERT INTO agents (user_id, company_name, first_name, last_name, email, parent_agent_id, status, created_at, updated_at)
        VALUES ($1, 'Audit SubAgency', 'Audit', 'SubAgent', 'audit-subagent@audit.test', $2, 'active', NOW(), NOW())
        RETURNING id
      `, [AUDIT_SUBAGENT_USER_ID, agentRecordId]);
      subAgentRecordId = ins.rows[0].id;
      console.log(`[setup] agents record for audit-subagent — id=${subAgentRecordId}`);
    } else {
      subAgentRecordId = subCheck.rows[0].id;
      console.log(`[setup] agents record for audit-subagent already exists — id=${subAgentRecordId}`);
    }

    // 4. Create agent_staff audit account (linked to audit-agent via managing_agent_id)
    await client.query(`
      INSERT INTO users (
        email, password_hash, role, first_name, last_name, is_active, email_verified,
        agent_staff_permissions, managing_agent_id, created_at, updated_at
      )
      VALUES ('audit-agentstaff@audit.test', $1, 'agent_staff', 'Audit', 'AgentStaff', true, true, $2, $3, NOW(), NOW())
      ON CONFLICT (email) DO UPDATE
        SET agent_staff_permissions = $2, managing_agent_id = $3
    `, [HASH, ALL_PERMS, agentRecordId]);
    console.log("[setup] audit-agentstaff@audit.test — OK (all 7 permissions)");

    // 5. Clear login rate limits for all audit accounts
    await client.query(`DELETE FROM rate_limits WHERE key LIKE '%login:%'`);
    await client.query(`DELETE FROM pg_rate_limits`);
    console.log("[setup] Rate limits cleared");

    await client.query("COMMIT");
    console.log("[setup] DONE — all audit accounts and agent records ready");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[setup] ERROR:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
