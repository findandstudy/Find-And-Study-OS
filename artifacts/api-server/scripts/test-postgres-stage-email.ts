import test, { after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import { processStageEmailOutbox, validateStageEmailQueueItem, hasStageEmailForStudent } from "../src/lib/notifications/stageEmailAutomation";

const target = new URL(process.env.DATABASE_URL!);
if (target.hostname !== "127.0.0.1" || target.port !== "5433" || target.pathname !== "/fasos_apply_local" ||
  target.username !== "postgres" || target.password || process.env.ALLOW_LIVE_INTEGRATIONS !== "false" ||
  process.env.EMAIL_DELIVERY_DISABLED !== "true" || process.env.NODE_ENV !== "test") throw new Error("Synthetic localhost/no-outbound database required");
after(async () => pool.end());

test("transactional transition intent, origin isolation, immutable approval and mail-queue handoff", async t => {
  const identity = await pool.query("SELECT current_database() AS name,inet_server_addr()::text AS host,inet_server_port() AS port");
  assert.equal(identity.rows[0].name,"fasos_apply_local"); assert.equal(identity.rows[0].host,"127.0.0.1/32"); assert.equal(identity.rows[0].port,5433);
  const key = `email_test_${Date.now()}`;
  process.env.PIPELINE_EMAIL_AUTOMATION_ENABLED="true";
  process.env.PIPELINE_EMAIL_AUTOMATION_SINCE=new Date(Date.now()-1000).toISOString();
  const users = await pool.query(`INSERT INTO users(first_name,last_name,role,email,email_verified) VALUES
    ('Mail','Maker','admin',$1,true),('Mail','Checker','admin',$2,true),('Mail','Student','student',$3,true) RETURNING id,email`,
    [`${key}_maker@example.test`,`${key}_checker@example.test`,`${key}_student@example.test`]);
  const [maker,checker,studentUser]=users.rows;
  const tpl = (await pool.query("INSERT INTO message_templates(name,category,channel,language,subject,content,created_by_id) VALUES($1,'applications','email','en','Stage','Hello',$2) RETURNING id",[key,maker.id])).rows[0];
  const version = (await pool.query(`INSERT INTO message_template_email_versions(template_id,version,subject,content,language,variables,created_by_id)
    VALUES($1,1,'Hello {{firstName}}','<p>{{programName}}: {{newStage}}</p>','en','["firstName","programName","newStage"]',$2) RETURNING id`,[tpl.id,maker.id])).rows[0];
  await t.test("DB forbids bypass, content mutation, self approval and deletion", async () => {
    await assert.rejects(pool.query("UPDATE message_template_email_versions SET status='approved',approved_by_id=$2,approved_at=now() WHERE id=$1",[version.id,checker.id]),/INVALID_TRANSITION/);
    await assert.rejects(pool.query("UPDATE message_template_email_versions SET content='mutated' WHERE id=$1",[version.id]),/IMMUTABLE/);
    await pool.query("UPDATE message_template_email_versions SET status='review' WHERE id=$1",[version.id]);
    await assert.rejects(pool.query("UPDATE message_template_email_versions SET status='approved',approved_by_id=$2,approved_at=now() WHERE id=$1",[version.id,maker.id]),/check constraint/);
    await pool.query("UPDATE message_template_email_versions SET status='approved',approved_by_id=$2,approved_at=now() WHERE id=$1",[version.id,checker.id]);
    await assert.rejects(pool.query("DELETE FROM message_template_email_versions WHERE id=$1",[version.id]),/IMMUTABLE/);
  });
  const meta = {emailSender:{revision:1,fromEmail:"sender@example.test",fromName:"Synthetic",replyTo:"",verified:true,createdById:maker.id,lastChangedById:maker.id,approvedById:checker.id}};
  // No SMTP credentials: this fixture cannot contact a provider even if a bug bypasses a flag.
  const sender=(await pool.query("INSERT INTO channel_accounts(channel,provider,display_name,metadata,is_active) VALUES('email','smtp',$1,$2,true) RETURNING id",[key,meta])).rows[0];
  const config={enabled:true,templateVersionId:version.id,senderAccountId:sender.id,originTypes:["direct"]};
  await pool.query("INSERT INTO pipeline_stages(entity_type,key,label,automatic_email) VALUES('application',$1,'Synthetic stage',$2)",[key,config]);
  const student=(await pool.query("INSERT INTO students(first_name,last_name,email,user_id) VALUES('Mail','Student',$1,$2) RETURNING id",[studentUser.email,studentUser.id])).rows[0];
  const newApp=async (studentId=student.id,stage=key) => (await pool.query("INSERT INTO applications(student_id,stage,program_name,university_name) VALUES($1,$2,'Synthetic programme','Synthetic university') RETURNING id",[studentId,stage])).rows[0].id as number;
  const appId=await newApp();
  await t.test("same stage update and leaving/re-entering produce one intent, no backfill on config save",async()=>{
    await pool.query("UPDATE applications SET stage=stage WHERE id=$1",[appId]);
    await pool.query("UPDATE applications SET stage='unconfigured' WHERE id=$1",[appId]);
    await pool.query("UPDATE applications SET stage=$2 WHERE id=$1",[appId,key]);
    assert.equal((await pool.query("SELECT count(*)::int n FROM pipeline_stage_email_dispatches WHERE application_id=$1",[appId])).rows[0].n,1);
    const existing=await newApp(student.id,`${key}_later`);
    await pool.query("INSERT INTO pipeline_stages(entity_type,key,label,automatic_email) VALUES('application',$1,'Later',$2)",[`${key}_later`,config]);
    assert.equal((await pool.query("SELECT count(*)::int n FROM pipeline_stage_email_dispatches WHERE application_id=$1",[existing])).rows[0].n,0);
  });
  await t.test("transition rollback also removes the dispatch intent",async()=>{
    const client=await pool.connect();
    try{await client.query("BEGIN");const a=(await client.query("INSERT INTO applications(student_id,stage) VALUES($1,$2) RETURNING id",[student.id,key])).rows[0];
      await client.query("ROLLBACK");assert.equal((await pool.query("SELECT count(*)::int n FROM pipeline_stage_email_dispatches WHERE application_id=$1",[a.id])).rows[0].n,0);
    }finally{client.release();}
  });
  await t.test("agent and sub-agent origins are excluded until explicitly selected",async()=>{
    const agent=(await pool.query("INSERT INTO agents(first_name,last_name,status) VALUES('Synthetic','Agency','active') RETURNING id")).rows[0];
    const sub=(await pool.query("INSERT INTO agents(first_name,last_name,status,parent_agent_id) VALUES('Synthetic','SubAgency','active',$1) RETURNING id",[agent.id])).rows[0];
    for(const g of [agent,sub]){
      const s=(await pool.query("INSERT INTO students(first_name,last_name,agent_id) VALUES('Synthetic','Agent student',$1) RETURNING id",[g.id])).rows[0];
      const a=await newApp(s.id);
      assert.equal((await pool.query("SELECT count(*)::int n FROM pipeline_stage_email_dispatches WHERE application_id=$1",[a])).rows[0].n,0);
      await pool.query("UPDATE pipeline_stages SET automatic_email=$2 WHERE key=$1",[key,{...config,originTypes:["direct","agent","sub_agent"]}]);
      const opted=await newApp(s.id);
      assert.equal((await pool.query("SELECT origin FROM pipeline_stage_email_dispatches WHERE application_id=$1",[opted])).rows[0].origin,g.id===agent.id?"agent":"sub_agent");
      await pool.query("UPDATE pipeline_stages SET automatic_email=$2 WHERE key=$1",[key,config]);
    }
  });
  await t.test("concurrent sweeps enqueue once, approved variables render, generic email suppression is student-only",async()=>{
    await Promise.all([processStageEmailOutbox(),processStageEmailOutbox()]);
    const rows=await pool.query("SELECT q.* FROM email_queue q JOIN pipeline_stage_email_dispatches d ON d.email_queue_id=q.id WHERE d.application_id=$1",[appId]);
    assert.equal(rows.rowCount,1);assert.equal(rows.rows[0].status,"pending");assert.match(rows.rows[0].subject,/Hello Mail/);
    assert.match(rows.rows[0].html_body,/Synthetic programme/);
    assert.deepEqual(await validateStageEmailQueueItem(rows.rows[0].id),{allowed:true});
    assert.equal(await hasStageEmailForStudent(appId,key,studentUser.id),true);
    assert.equal(await hasStageEmailForStudent(appId,key,maker.id),false);
    await pool.query("UPDATE students SET email='changed@example.test' WHERE id=$1",[student.id]);
    assert.equal((await validateStageEmailQueueItem(rows.rows[0].id)).allowed,false);
    await pool.query("UPDATE students SET email=$2 WHERE id=$1",[student.id,studentUser.email]);
    await pool.query("UPDATE applications SET program_name='Changed programme' WHERE id=$1",[appId]);
    assert.equal((await validateStageEmailQueueItem(rows.rows[0].id)).code,"STAGE_EMAIL_CONTEXT_CHANGED");
    await pool.query("UPDATE applications SET stage='moved' WHERE id=$1",[appId]);
    assert.equal((await validateStageEmailQueueItem(rows.rows[0].id)).code,"RECORD_SCOPE_OR_STAGE_CHANGED");
  });
  await t.test("retirement, sender change and historical intent never silently send",async()=>{
    const a=await newApp(); await processStageEmailOutbox();
    const q=(await pool.query("SELECT email_queue_id FROM pipeline_stage_email_dispatches WHERE application_id=$1",[a])).rows[0].email_queue_id;
    await pool.query("UPDATE channel_accounts SET metadata=$2 WHERE id=$1",[sender.id,{emailSender:{...meta.emailSender,revision:2}}]);
    assert.equal((await validateStageEmailQueueItem(q)).code,"SENDER_CHANGED_OR_UNVERIFIED");
    await pool.query("UPDATE channel_accounts SET metadata=$2 WHERE id=$1",[sender.id,meta]);
    await pool.query("UPDATE message_template_email_versions SET status='retired' WHERE id=$1",[version.id]);
    assert.equal((await validateStageEmailQueueItem(q)).code,"TEMPLATE_NOT_APPROVED");
    process.env.PIPELINE_EMAIL_AUTOMATION_SINCE=new Date(Date.now()+60_000).toISOString();
    assert.equal((await validateStageEmailQueueItem(q)).code,"AUTOMATION_INACTIVE_OR_HISTORICAL");
    assert.equal((await pool.query("SELECT count(*)::int n FROM email_queue WHERE status='sent'")).rows[0].n,0);
  });
});
