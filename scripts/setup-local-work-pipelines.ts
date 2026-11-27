import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
const require = createRequire(
  new URL("../artifacts/api-server/package.json", import.meta.url),
);
const { Client } = require("pg"),
  bcrypt = require("bcryptjs");
if (process.env.ALLOW_LOCAL_WORK_PIPELINES_SETUP !== "true")
  throw new Error("Explicit local setup required");
const client = new Client({
  connectionString:
    "postgresql://fas_migrator@127.0.0.1:5433/fasos_apply_local",
});
await client.connect();
try {
  const r = await client.query(
    "SELECT current_database() db,inet_server_addr()::text host,inet_server_port() port",
  );
  if (
    r.rows[0].db !== "fasos_apply_local" ||
    (r.rows[0].host !== "127.0.0.1/32" && r.rows[0].host !== "127.0.0.1") ||
    r.rows[0].port !== 5433
  )
    throw new Error("Wrong local DB identity");
  await client.query(
    await readFile(
      new URL(
        "../lib/db/migrations-pending/work_pipeline_local_v1.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await client.query(
    "GRANT USAGE ON SCHEMA public TO fas_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO fas_app; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO fas_app;",
  );
  const password = randomBytes(18).toString("base64url") + "!aA1";
  const hash = await bcrypt.hash(password, 10);
  const people = [];
  for (const [email, role, name] of [
    ["pipeline.admin@example.invalid", "super_admin", "Pipeline Admin"],
    ["pipeline.team@example.invalid", "staff", "Pipeline Team"],
    ["pipeline.outside@example.invalid", "staff", "Outside Team"],
  ]) {
    const row = await client.query(
      "INSERT INTO users(replit_id,email,first_name,last_name,role,password_hash,is_active,email_verified,language) VALUES($1,$2,$3,'TEST',$4,$5,true,true,'tr') ON CONFLICT(email) DO NOTHING RETURNING id",
      [email, email, name, role, hash],
    );
    const id =
      row.rows[0]?.id ||
      (await client.query("SELECT id FROM users WHERE email=$1", [email]))
        .rows[0].id;
    people.push({ id, email, role });
  }
  const channel = await client.query(
    "INSERT INTO channel_accounts(channel,display_name,external_account_id,is_active,metadata) SELECT 'whatsapp','Acente kazanımı — LOCAL TEST','local-work-pipeline-test',true,'{\"synthetic\":true}'::jsonb WHERE NOT EXISTS(SELECT 1 FROM channel_accounts WHERE external_account_id='local-work-pipeline-test') RETURNING id",
  );
  await client.query(
    "INSERT INTO embed_widgets(name,slug,mode,allowed_domains,is_active) VALUES('Acente başvuru formu — LOCAL TEST','local-partner-enquiry','lead_form','[\"127.0.0.1\",\"localhost\"]'::jsonb,true) ON CONFLICT(slug) DO NOTHING",
  );
  await client.query(
    "INSERT INTO agents(first_name,last_name,company_name,status,embed_token) VALUES('Synthetic','Partner','LOCAL TEST web-to-lead','active','local-work-pipeline-agent-form') ON CONFLICT(embed_token) DO NOTHING",
  );
  await writeFile(
    new URL("../.local-work-pipeline-credentials.json", import.meta.url),
    JSON.stringify({ password, people }, null, 2),
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({
      localDatabase: r.rows[0],
      syntheticUsers: people.map((p) => p.id),
      channelId: channel.rows[0]?.id,
      credentialsFile: ".local-work-pipeline-credentials.json",
    }),
  );
} finally {
  await client.end();
}
