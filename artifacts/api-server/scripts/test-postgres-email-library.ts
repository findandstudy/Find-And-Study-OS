import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import cookieParser from "cookie-parser";
import { once } from "node:events";

const target = new URL(process.env.DATABASE_URL!);
if (target.hostname !== "127.0.0.1" || target.port !== "5433" || target.pathname !== "/fasos_apply_local"
  || target.username !== "postgres" || target.password || target.search || target.hash
  || process.env.ALLOW_LIVE_INTEGRATIONS !== "false" || process.env.EMAIL_DELIVERY_DISABLED !== "true"
  || process.env.NODE_ENV !== "test") throw new Error("Synthetic localhost/no-outbound database required");
process.env.ENCRYPTION_KEY = "synthetic-email-route-test-key";
const { pool } = await import("@workspace/db");
const { authMiddleware } = await import("../src/middlewares/authMiddleware");
const { default: router } = await import("../src/routes/emailAutomation");
const { default: notificationsRouter } = await import("../src/routes/notifications");
const { default: pipelineRouter } = await import("../src/routes/pipeline");
const { bindNotificationEmailTemplate } = await import("../src/lib/notifications/emailRuleBinding");
const { hashToken } = await import("../src/lib/apiToken");
const { renderApprovedEmailVersion } = await import("../src/lib/notifications/emailTemplateLibrary");
const { resolveEmailSenderAccount } = await import("../src/lib/notifications/emailSenderAccounts");

test("email library real HTTP/session/SQL contract on disposable PostgreSQL with no outbound", async t => {
  const identity = (await pool.query("SELECT current_database() AS name, host(inet_server_addr()) AS address,inet_server_port() AS port")).rows[0];
  assert.deepEqual(identity, { name: "fasos_apply_local", address: "127.0.0.1", port: 5433 });
  const key = `email_library_${Date.now()}`;
  const issued = Date.now();
  const users = (await pool.query("INSERT INTO users(first_name,last_name,role,email,email_verified) VALUES('Synthetic','Maker','admin',$1,true),('Synthetic','Checker','super_admin',$2,true),('Synthetic','Manager','manager',$3,true) RETURNING *",
    [`${key}_maker@example.test`, `${key}_checker@example.test`, `${key}_manager@example.test`])).rows;
  const sids = users.map((user, i) => `${key}_session_${i}`);
  for (let i = 0; i < users.length; i++) await pool.query("INSERT INTO sessions(sid,sess,expire,user_id) VALUES($1,$2,now()+interval '1 hour',$3)",
    [sids[i], { user: { id: users[i].id, role: users[i].role }, access_token: "synthetic", issued_at: issued }, users[i].id]);
  const impersonated = `${key}_impersonated`;
  await pool.query("INSERT INTO sessions(sid,sess,expire) VALUES($1,$2,now()+interval '1 hour')", [impersonated,
    { user: { id: users[0].id, role: "admin" }, access_token: "synthetic", issued_at: issued, originalSid: sids[1] }]);
  const token = `fas_live_${key}_synthetic_only`;
  await pool.query("INSERT INTO api_tokens(user_id,name,token_hash,token_prefix,scopes,expires_at) VALUES($1,$2,$3,'fas_live_fixture',ARRAY['applications:write'],now()+interval '1 hour')", [users[0].id, key, hashToken(token)]);
  const app = express(); app.use(express.json({ limit: "128kb" })); app.use(cookieParser()); app.use(authMiddleware);
  app.use("/api", router); app.use("/api", notificationsRouter); app.use("/api", pipelineRouter);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/notification-email`;
  const request = async (path: string, method = "GET", body?: unknown, sid: string | null = sids[0]) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(sid ? { cookie: `sid=${sid}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json() as any;
    return { status: response.status, data, headers: response.headers };
  };
  const apiRequest = async (path: string, method: string, body: unknown, auth: string | null = sids[0]) => {
    const response = await fetch(`${base.replace("/notification-email", "")}${path}`, { method,
      headers: { "Content-Type": "application/json", ...(auth === "token" ? { authorization: `Bearer ${token}` } : auth ? { cookie: `sid=${auth}` } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() as any };
  };
  let templateId = 0, versionId = 0, senderId = 0, ruleId = 0, preservedRuleId = 0;
  const fields = { name: key, category: "applications", language: "en", subject: "Hello {{firstName}}", content: '<p>{{programName}}</p><script>evil()</script>' };
  try {
    await t.test("anonymous, manager and impersonated sessions cannot access administration", async () => {
      for (const sid of [null, sids[2], impersonated]) assert.equal((await request("/capabilities", "GET", undefined, sid)).status, 403);
      const caps = await request("/capabilities"); assert.equal(caps.status, 200); assert.equal(caps.data.verificationAllowed, false);
      assert.equal(caps.headers.get("cache-control"), "private, no-store");
    });
    await t.test("unknown variables are rejected before identity creation", async () => {
      const result = await request("/templates", "POST", { ...fields, content: "{{credential}}" });
      assert.equal(result.status, 400); assert.equal(result.data.error, "EMAIL_TEMPLATE_VARIABLE_INVALID");
      assert.equal((await pool.query("SELECT count(*)::int n FROM message_templates WHERE name=$1", [key])).rows[0].n, 0);
    });
    await t.test("draft-submit-second-reviewer approval persists immutable safe content", async () => {
      const created = await request("/templates", "POST", fields); assert.equal(created.status, 201);
      templateId = created.data.template.id; versionId = created.data.version.id;
      assert.equal(created.data.version.status, "draft"); assert.equal(created.data.version.content, "<p>{{programName}}</p>");
      assert.equal(await renderApprovedEmailVersion(versionId, { firstName: "Synthetic", programName: "Test" }), null);
      assert.equal((await request(`/versions/${versionId}/submit`, "POST")).status, 200);
      const self = await request(`/versions/${versionId}/approve`, "POST"); assert.equal(self.status, 409); assert.equal(self.data.error, "EMAIL_SECOND_REVIEWER_REQUIRED");
      const approved = await request(`/versions/${versionId}/approve`, "POST", undefined, sids[1]); assert.equal(approved.status, 200);
      assert.equal(approved.data.version.approvedById, users[1].id);
    });
    await t.test("actual branded preview escapes values, detects missing variables and sends nothing", async () => {
      assert.equal((await request(`/versions/${versionId}/preview`, "POST", { variables: { firstName: "Synthetic" } })).status, 400);
      const preview = await request(`/versions/${versionId}/preview`, "POST", { variables: { firstName: "Synthetic", programName: '<img src=x onerror="evil()">' } });
      assert.equal(preview.status, 200); assert.match(preview.data.html, /&lt;img/); assert.doesNotMatch(preview.data.html, /<script|<img src="x"/);
      const rendered = await renderApprovedEmailVersion(versionId, { firstName: "Synthetic", programName: "Test", unusedProducerContext: "ignored" });
      assert.equal(rendered?.subject, "Hello Synthetic");
    });
    await t.test("new draft version leaves approved version unchanged", async () => {
      const created = await request(`/templates/${templateId}/versions`, "POST", { ...fields, content: "<p>New {{programName}}</p>" });
      assert.equal(created.status, 201); assert.equal(created.data.version.version, 2); assert.equal(created.data.version.status, "draft");
      const old = (await pool.query("SELECT content,status FROM message_template_email_versions WHERE id=$1", [versionId])).rows[0];
      assert.deepEqual(old, { content: "<p>{{programName}}</p>", status: "approved" });
    });
    await t.test("new SMTP account is inactive, encrypted, masked and unverified", async () => {
      const created = await request("/senders", "POST", { displayName: key, host: "smtp.example.test", port: 587, username: "fixture@example.test", password: "synthetic-only-secret", fromEmail: "sender@example.test", fromName: "Synthetic" });
      assert.equal(created.status, 201); senderId = created.data.sender.id;
      assert.equal(created.data.sender.revision, 1); assert.equal(created.data.sender.isActive, false); assert.equal(created.data.sender.verified, false);
      assert.ok(!JSON.stringify(created.data).includes("synthetic-only-secret"));
      const stored = (await pool.query("SELECT config_encrypted FROM channel_accounts WHERE id=$1", [senderId])).rows[0].config_encrypted;
      assert.ok(stored.includes("enc::v1::")); assert.ok(!stored.includes("synthetic-only-secret"));
      assert.equal(await resolveEmailSenderAccount(senderId, 1), null);
    });
    await t.test("sender optimistic revision prevents stale edits, live kill switch prevents verify", async () => {
      const updated = await request(`/senders/${senderId}`, "PATCH", { expectedRevision: 1, fromName: "Changed" });
      assert.equal(updated.status, 200); assert.equal(updated.data.sender.revision, 2); assert.equal(updated.data.sender.verified, false);
      assert.equal((await request(`/senders/${senderId}`, "PATCH", { expectedRevision: 1, fromName: "Stale" })).status, 409);
      assert.equal((await request(`/senders/${senderId}`, "PATCH", { expectedRevision: 2, isActive: true })).status, 409);
      const verify = await request(`/senders/${senderId}/verify`, "POST", { expectedRevision: 2 }, sids[1]);
      assert.equal(verify.status, 409); assert.equal(verify.data.error, "EMAIL_VERIFICATION_DISABLED");
    });
    await t.test("legacy all-channel identity can gain an immutable email revision without changing identity", async () => {
      const legacy = (await pool.query("INSERT INTO message_templates(name,content,channel,created_by_id) VALUES($1,'Legacy','all',$2) RETURNING id", [`${key}_legacy`, users[0].id])).rows[0];
      const created = await request(`/templates/${legacy.id}/versions`, "POST", fields);
      assert.equal(created.status, 201);
      assert.equal((await pool.query("SELECT channel,content FROM message_templates WHERE id=$1", [legacy.id])).rows[0].content, "Legacy");
      assert.ok((await request("/templates")).data.templates.some((item: { id: number }) => item.id === legacy.id));
    });
    await t.test("system history contains only library-bound queue rows with safe projections", async () => {
      const queued = (await pool.query("INSERT INTO email_queue(to_email,subject,html_body,text_body,template_version_id,sender_account_id,sender_revision) VALUES('fixture@example.test','PRIVATE SUBJECT','PRIVATE BODY','PRIVATE TEXT',$1,$2,2) RETURNING id", [versionId, senderId])).rows[0];
      const old = (await pool.query("INSERT INTO email_queue(to_email,subject,html_body,text_body) VALUES('legacy@example.test','OTP','SECRET','SECRET') RETURNING id")).rows[0];
      const history = await request("/history?source=system"); assert.equal(history.status, 200);
      assert.ok(history.data.items.some((item: { id: number }) => item.id === queued.id));
      assert.ok(!history.data.items.some((item: { id: number }) => item.id === old.id));
      assert.doesNotMatch(JSON.stringify(history.data), /PRIVATE|fixture@example|legacy@example|SECRET/);
      assert.equal((await request("/history?source=invalid")).status, 400);
    });
    await t.test("registered rule POST/PATCH pins approved version and current sender revision without enabling runtime", async () => {
      // Synthetic metadata only: no verification or provider action occurs in this fixture.
      await pool.query("UPDATE channel_accounts SET is_active=true,status='active',metadata=jsonb_set(metadata,'{emailSender}',(metadata->'emailSender') || $2::jsonb) WHERE id=$1",
        [senderId, JSON.stringify({ verified: true, approvedById: users[1].id })]);
      const created = await request("/templates", "POST", { ...fields, name: `${key}_static`, subject: "Synthetic notice", content: "<p>Static fixture</p>" });
      const staticId = created.data.version.id;
      await request(`/versions/${staticId}/submit`, "POST"); await request(`/versions/${staticId}/approve`, "POST", undefined, sids[1]);
      const binding = { emailTemplateVersionId: staticId, emailSenderAccountId: senderId, emailSenderRevision: 99999 };
      // The route module seeds registered events. Preserve the synthetic default row
      // under a temporary key, and restore it in finally (no concurrent DB suite).
      const event = "message.new";
      const preserved = await pool.query("UPDATE notification_rules SET event=$2 WHERE event=$1 RETURNING id", [event, `${key}_preserved_event`]);
      preservedRuleId = preserved.rows[0]?.id ?? 0;
      process.env.PIPELINE_EMAIL_AUTOMATION_ENABLED = "false";
      const result = await apiRequest("/notification-rules", "POST", { event, name: key, channels: ["email"], template: binding });
      assert.equal(result.status, 201); ruleId = result.data.id;
      assert.equal(result.data.template.emailSenderRevision, 2, "client revision is never trusted");
      const updated = await apiRequest(`/notification-rules/${ruleId}`, "PATCH", { template: binding, isActive: false });
      assert.equal(updated.status, 200); assert.equal(updated.data.isActive, false);
      assert.equal((await bindNotificationEmailTemplate(binding, event)).emailSenderRevision, 2);
      const missing = await apiRequest(`/notification-rules/${ruleId}`, "PATCH", { template: { ...binding, emailSenderAccountId: 2147483647 } });
      assert.equal(missing.status, 400); assert.equal(missing.data.error, "EMAIL_APPROVED_TEMPLATE_AND_VERIFIED_SENDER_REQUIRED");
    });
    await t.test("unknown producer and incompatible variables cannot become rule bindings", async () => {
      const unknown = await apiRequest("/notification-rules", "POST", { event: `${key}.invented`, name: key });
      assert.equal(unknown.status, 400); assert.equal(unknown.data.error, "NOTIFICATION_EVENT_NOT_REGISTERED");
      await assert.rejects(bindNotificationEmailTemplate({ emailTemplateVersionId: versionId, emailSenderAccountId: senderId }, "message.new"), /EMAIL_VARIABLES_UNAVAILABLE_FOR_EVENT/);
      const bad = await request("/templates", "POST", { ...fields, name: `${key}_unapproved` });
      const binding = await apiRequest(`/notification-rules/${ruleId}`, "PATCH", { template: { emailTemplateVersionId: bad.data.version.id, emailSenderAccountId: senderId } });
      assert.equal(binding.status, 400); assert.equal(binding.data.error, "EMAIL_APPROVED_TEMPLATE_AND_VERIFIED_SENDER_REQUIRED");
    });
    await t.test("manager, API token and impersonation cannot mutate rules even channels-only", async () => {
      for (const auth of [sids[2], impersonated, "token"]) {
        for (const patch of [{ channels: ["email"] }, { isActive: true }, { template: {} }]) {
          const result = await apiRequest(`/notification-rules/${ruleId}`, "PATCH", patch, auth);
          assert.equal(result.status, 403);
        }
        assert.equal((await apiRequest("/notification-rules", "POST", { event: "message.new", name: key }, auth)).status, 403);
      }
    });
    await t.test("pipeline rejects email changes by manager/token/impersonation and nonapplication entity before writes", async () => {
      const before = (await pool.query("SELECT count(*)::int n FROM pipeline_stages")).rows[0].n;
      const body = { stages: [{ key, label: "Synthetic", automaticEmail: { enabled: true, templateVersionId: versionId, senderAccountId: senderId, originTypes: ["direct"] } }] };
      for (const auth of [sids[2], impersonated, "token"]) assert.equal((await apiRequest("/pipeline-stages/application", "PUT", body, auth)).status, 403);
      assert.equal((await apiRequest("/pipeline-stages/lead", "PUT", body)).status, 400);
      assert.equal((await pool.query("SELECT count(*)::int n FROM pipeline_stages")).rows[0].n, before);
    });
    await t.test("application pipeline PUT persists email origins, preserves omitted email and leaves WhatsApp config intact", async () => {
      // This disposable-cluster-only round trip exercises the real replace-all route.
      // Snapshot every physical field (including original IDs and timestamps) before
      // replacement, then restore the affected rows in a single transaction in finally.
      const stageSnapshot = (await pool.query("SELECT to_jsonb(s) AS row FROM pipeline_stages s ORDER BY id")).rows.map(result => result.row);
      const settingsSnapshot = (await pool.query("SELECT id,trigger_stages,is_enabled,auto_process_enabled,updated_at FROM portal_automation_settings ORDER BY id")).rows;
      const externalStageReferences = (await pool.query("SELECT conrelid::regclass::text AS relation FROM pg_constraint WHERE contype='f' AND confrelid='pipeline_stages'::regclass AND conrelid <> confrelid")).rows;
      assert.deepEqual(externalStageReferences, [], "Do not replace fixture stages when another table has destructive FK side effects");
      const beforeMailIntents = (await pool.query("SELECT count(*)::int n FROM pipeline_stage_email_dispatches")).rows[0].n;
      const waTemplate = (await pool.query("INSERT INTO message_templates(name,content,channel,external_template_name,approval_status,created_by_id) VALUES($1,'Synthetic WhatsApp text','whatsapp',$1,'approved',$2) RETURNING id",
        [`${key}_wa`, users[0].id])).rows[0];
      const waSender = (await pool.query("INSERT INTO channel_accounts(channel,provider,display_name,external_account_id,is_active,status) VALUES('whatsapp','zernio',$1,$1,true,'active') RETURNING id", [`${key}_wa`])).rows[0];
      const waConfig = { enabled: true, templateId: waTemplate.id, channelAccountId: waSender.id, originTypes: ["direct", "agent"] };
      const emailConfig = { enabled: true, templateVersionId: versionId, senderAccountId: senderId, originTypes: ["direct", "agent", "sub_agent"] };
      const stageKey = `${key}_roundtrip`;
      try {
        await pool.query("INSERT INTO pipeline_stages(entity_type,key,label,automatic_message) VALUES('application',$1,'Synthetic existing WhatsApp stage',$2)", [stageKey, waConfig]);
        const saved = await apiRequest("/pipeline-stages/application", "PUT", { stages: [{ key: stageKey, label: "Synthetic email + WhatsApp", automaticMessage: waConfig, automaticEmail: emailConfig }] });
        assert.equal(saved.status, 200, JSON.stringify(saved.data));
        assert.deepEqual(saved.data.stages[0].automaticEmail, emailConfig);
        assert.deepEqual(saved.data.stages[0].automaticMessage, waConfig);
        const persisted = (await pool.query("SELECT automatic_email,automatic_message FROM pipeline_stages WHERE entity_type='application' AND key=$1", [stageKey])).rows[0];
        assert.deepEqual(persisted, { automatic_email: emailConfig, automatic_message: waConfig });

        // An older client knows WhatsApp but has no automaticEmail property. A
        // manager may edit an unrelated label, but must not erase/change the email policy.
        const { automaticEmail: _omitted, ...oldClientStage } = saved.data.stages[0];
        const legacySave = await apiRequest("/pipeline-stages/application", "PUT", {
          stages: [{ ...oldClientStage, label: "Synthetic legacy editor" }],
        }, sids[2]);
        assert.equal(legacySave.status, 200, JSON.stringify(legacySave.data));
        assert.deepEqual(legacySave.data.stages[0].automaticEmail, emailConfig);
        assert.deepEqual(legacySave.data.stages[0].automaticMessage, waConfig);
        const roundtrip = (await pool.query("SELECT label,automatic_email,automatic_message FROM pipeline_stages WHERE entity_type='application' AND key=$1", [stageKey])).rows[0];
        assert.equal(roundtrip.label, "Synthetic legacy editor");
        assert.deepEqual(roundtrip.automatic_email.originTypes, ["direct", "agent", "sub_agent"]);
        assert.deepEqual(roundtrip.automatic_message, waConfig);
        assert.equal((await pool.query("SELECT count(*)::int n FROM pipeline_stage_email_dispatches")).rows[0].n, beforeMailIntents, "Saving a stage config never backfills or dispatches mail");
      } finally {
        const restore = await pool.connect();
        try {
          await restore.query("BEGIN");
          await restore.query("SELECT pg_advisory_xact_lock(hashtext('portal_automation_trigger_stages_v1'))");
          await restore.query("DELETE FROM pipeline_stages WHERE entity_type='application'");
          const applicationRows = stageSnapshot.filter(row => row.entity_type === "application");
          if (applicationRows.length) await restore.query("INSERT INTO pipeline_stages SELECT * FROM jsonb_populate_recordset(NULL::pipeline_stages,$1::jsonb)", [JSON.stringify(applicationRows)]);
          // A self-FK may have cleared a completion target on a nonapplication row.
          await restore.query("UPDATE pipeline_stages s SET missing_docs_fulfilled_target_stage_id=r.missing_docs_fulfilled_target_stage_id,updated_at=r.updated_at FROM jsonb_populate_recordset(NULL::pipeline_stages,$1::jsonb) r WHERE s.id=r.id AND s.entity_type<>'application' AND s.missing_docs_fulfilled_target_stage_id IS DISTINCT FROM r.missing_docs_fulfilled_target_stage_id", [JSON.stringify(stageSnapshot)]);
          for (const settings of settingsSnapshot) await restore.query("UPDATE portal_automation_settings SET trigger_stages=$2,is_enabled=$3,auto_process_enabled=$4,updated_at=$5 WHERE id=$1",
            [settings.id, JSON.stringify(settings.trigger_stages), settings.is_enabled, settings.auto_process_enabled, settings.updated_at]);
          await restore.query("COMMIT");
        } catch (error) { await restore.query("ROLLBACK"); throw error; }
        finally { restore.release(); }
        assert.deepEqual((await pool.query("SELECT to_jsonb(s) AS row FROM pipeline_stages s ORDER BY id")).rows.map(result => result.row), stageSnapshot,
          "Every original stage field, ID and timestamp was restored");
        assert.deepEqual((await pool.query("SELECT id,trigger_stages,is_enabled,auto_process_enabled,updated_at FROM portal_automation_settings ORDER BY id")).rows, settingsSnapshot);
      }
    });
    await t.test("retirement invalidates future pinned rendering and no provider sent fixture mail", async () => {
      assert.equal((await request(`/versions/${versionId}/retire`, "POST", undefined, sids[1])).status, 200);
      assert.equal(await renderApprovedEmailVersion(versionId, { firstName: "Synthetic", programName: "Test" }), null);
      assert.equal((await pool.query("SELECT count(*)::int n FROM email_queue WHERE sender_account_id=$1 AND status='sent'", [senderId])).rows[0].n, 0);
    });
  } finally { server.close(); await once(server, "close"); await new Promise(resolve => setImmediate(resolve));
    if (ruleId) await pool.query("DELETE FROM notification_rules WHERE id=$1 AND name=$2", [ruleId, key]);
    if (preservedRuleId) await pool.query("UPDATE notification_rules SET event='message.new' WHERE id=$1 AND event=$2", [preservedRuleId, `${key}_preserved_event`]);
    await pool.end(); }
});
