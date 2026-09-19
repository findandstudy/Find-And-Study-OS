import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

function v7() { return randomUUID().replace(/^(.{14})./, "$17"); }

test("public tuition reader respects source, dates, intake and batch bounds on PostgreSQL", async () => {
  const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
  assert.equal(process.env.ALLOW_DISPOSABLE_PUBLIC_PAGE_TEST, "true");
  assert.equal(process.env.ALLOW_LIVE_INTEGRATIONS, "false");
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.port, "5433");
  assert.equal(target.pathname, "/fasos_apply_local"); assert.equal(target.search, ""); assert.equal(target.hash, "");
  const { pool } = await import("@workspace/db");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { readPublicCatalogPrices } = await import("../src/lib/publicCatalogPriceReadModel");
  const { projectPublicTuition } = await import("../src/lib/publicCatalogTuition");
  const client = await pool.connect();
  try {
    const identity = (await client.query("SELECT current_database() AS name,host(inet_server_addr()) AS address,inet_server_port() AS port")).rows[0];
    assert.deepEqual(identity, { name: "fasos_apply_local", address: "127.0.0.1", port: 5433 });
    await client.query("BEGIN");
    const executor = drizzle(client);
    const run = `public-price-${Date.now()}`;
    const actor = (await client.query("INSERT INTO users(email,first_name,last_name,role) VALUES ($1,'Synthetic','Price','admin') RETURNING id", [`${run}@example.invalid`])).rows[0].id;
    const uni = (await client.query("INSERT INTO universities(name,country,university_type) VALUES ($1,'Turkey','Private') RETURNING id", [run])).rows[0].id;
    const program = (await client.query("INSERT INTO programs(university_id,name,tuition_fee,currency) VALUES ($1,$2,30000,'GBP') RETURNING id", [uni, run])).rows[0].id;
    const source = v7(), priceRecord = v7(), intakeRecord = v7(), intake = v7();
    await client.query("INSERT INTO catalog_sources(id,source_key,display_name,source_type,created_by_legacy_user_id) VALUES ($1,$2,$2,'MANUAL_REVIEW',$3)", [source, run, actor]);
    for (const [record, type] of [[priceRecord, "PRICE"], [intakeRecord, "INTAKE"]]) {
      await client.query(`INSERT INTO catalog_source_records(id,source_id,entity_type,external_id,raw_object_sha256,status,fetched_at,effective_at,expires_at,verified_by_legacy_user_id,verified_at,verification_evidence_sha256)
        VALUES ($1,$2,$3,$3,$4,'VERIFIED',now()-interval '2 days',now()-interval '3 days',now()+interval '30 days',$5,now()-interval '1 day',$6)`, [record, source, type, "a".repeat(64), actor, "b".repeat(64)]);
    }
    await client.query(`INSERT INTO program_intakes(id,program_id,intake_key,academic_year,starts_on,application_deadline_at,source_timezone,capacity_status,delivery_mode,source_record_id,created_by_legacy_user_id,updated_by_legacy_user_id)
      VALUES($1,$2,'fixture',2027,'2027-09-01',now()+interval '30 days','Europe/London','OPEN','ONLINE',$3,$4,$4)`, [intake, program, intakeRecord, actor]);
    const priceId = v7();
    await client.query(`INSERT INTO price_components(id,program_id,intake_id,component_code,component_type,amount_minor,currency_code,frequency,effective_from,source_record_id,source_verified_at,created_by_legacy_user_id,updated_by_legacy_user_id)
      VALUES($1,$2,$3,'TUITION','TUITION',2200000,'GBP','PER_YEAR',now()-interval '1 hour',$4,now()-interval '1 day',$5,$5)`, [priceId, program, intake, priceRecord, actor]);
    const now = new Date();
    const read = async () => (await readPublicCatalogPrices([program], now, executor)).get(program) ?? [];
    assert.equal(projectPublicTuition({ tuitionFee: 30000, currency: "GBP" }, await read())?.amount, 22000);
    await client.query("UPDATE program_intakes SET application_deadline_at=now()-interval '1 hour' WHERE id=$1", [intake]);
    assert.equal((await read()).length, 0, "expired intake price omitted");
    await client.query("UPDATE program_intakes SET application_deadline_at=now()+interval '10 days' WHERE id=$1", [intake]);
    await client.query("UPDATE price_components SET status='RETIRED' WHERE id=$1", [priceId]);
    assert.equal((await read()).length, 0, "retired prices omitted");
    await client.query("UPDATE price_components SET status='ACTIVE',effective_from=now()+interval '1 day' WHERE id=$1", [priceId]);
    assert.equal((await read()).length, 0, "future price omitted");
    await client.query("UPDATE price_components SET effective_from=now()-interval '1 hour' WHERE id=$1", [priceId]);
    await client.query("UPDATE catalog_sources SET status='SUSPENDED' WHERE id=$1", [source]);
    assert.equal((await read()).length, 0, "suspended source cannot advertise verified prices");
    await client.query("UPDATE catalog_sources SET status='ACTIVE' WHERE id=$1", [source]);
    for (let i = 0; i < 49; i++) {
      await client.query(`INSERT INTO price_components(id,program_id,component_code,component_type,amount_minor,currency_code,frequency,effective_from,source_record_id,source_verified_at,created_by_legacy_user_id,updated_by_legacy_user_id)
        VALUES($1,$2,$3,'TUITION',2300000,'GBP','PER_YEAR',now()-interval '1 hour',$4,now()-interval '1 day',$5,$5)`, [v7(), program, `FIXTURE_${i}`, priceRecord, actor]);
    }
    const overflow = await read();
    assert.equal(overflow.length, 48); assert.equal(overflow.truncated, true);
    assert.equal(projectPublicTuition({ tuitionFee: 30000, currency: "GBP" }, overflow), null);
    assert.equal((await readPublicCatalogPrices([], now, executor)).size, 0);
  } finally { await client.query("ROLLBACK"); client.release(); await pool.end(); }
});
