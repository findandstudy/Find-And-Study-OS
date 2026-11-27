import { createRequire } from "node:module";
import { workPipelineTenant } from "../src/lib/workPipelines";
if (!workPipelineTenant()) throw Error("Local only");
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const c = new Client({
  connectionString:
    "postgresql://fas_migrator@127.0.0.1:5433/fasos_apply_local",
});
await c.connect();
try {
  const r = await c.query(
    "SELECT current_database() db,inet_server_addr()::text host,inet_server_port() port",
  );
  if (
    r.rows[0].db !== "fasos_apply_local" ||
    r.rows[0].port !== 5433 ||
    !["127.0.0.1", "127.0.0.1/32"].includes(r.rows[0].host)
  )
    throw Error("Wrong target");
  await c.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS conversation_participants_conversation_user_unique ON conversation_participants(conversation_id,user_id)",
  );
  console.log("Local Inbox read-state unique key restored; no rows changed");
} finally {
  await c.end();
}
