/**
 * RBAC E2E Teardown Script — removes accounts + agent records created by setup.
 * Run: cd artifacts/api-server && pnpm exec tsx scripts/rbac-e2e-teardown.ts
 */
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const CLEANUP_EMAILS = [
  "audit-superadmin@audit.test",
  "audit-agentstaff@audit.test",
];
const AUDIT_AGENT_USER_ID = 8733;
const AUDIT_SUBAGENT_USER_ID = 8734;

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Remove agent records
    await client.query(`DELETE FROM agents WHERE user_id IN ($1, $2)`,
      [AUDIT_AGENT_USER_ID, AUDIT_SUBAGENT_USER_ID]);
    console.log("[teardown] Agent records removed");

    // Remove created users
    for (const email of CLEANUP_EMAILS) {
      await client.query(`DELETE FROM users WHERE email = $1`, [email]);
      console.log(`[teardown] ${email} removed`);
    }

    await client.query("COMMIT");
    console.log("[teardown] DONE");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[teardown] ERROR:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
