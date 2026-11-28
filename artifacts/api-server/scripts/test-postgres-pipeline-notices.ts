import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import {
  executeClaimedEmail,
  classifyEmailTransportReceipt,
} from "../src/lib/emailDeliveryPolicy";
import {
  pipelineNoticePolicy,
  canonicalNotice,
  preferenceAllows,
} from "../src/lib/notifications/pipelineNoticePolicy";
import { noticeContext } from "../src/lib/notifications/pipelineNoticeContext";
import {
  processPipelineNotices,
  validatePipelineNoticeQueueItem,
} from "../src/lib/notifications/pipelineNotices";
const u = new URL(process.env.DATABASE_URL!);
if (
  u.hostname !== "127.0.0.1" ||
  u.port !== "5433" ||
  !["/fasos_apply_local", "/fas_dev_pipeline_hardening"].includes(u.pathname) ||
  u.username !== "postgres" ||
  u.password ||
  process.env.NODE_ENV !== "test" ||
  process.env.ALLOW_LIVE_INTEGRATIONS !== "false" ||
  process.env.EMAIL_DELIVERY_DISABLED !== "true"
)
  throw Error("Local synthetic/no-outbound DB required");
after(() => pool.end());
test("v2 config/recipient validation and preferences", () => {
  assert.throws(() => pipelineNoticePolicy({ enabled: true }, "email"));
  assert.equal(
    preferenceAllows("application.stage_changed", {
      applicationUpdates: false,
    }),
    false,
  );
  assert.equal(
    preferenceAllows("lead.stage_changed", { applicationUpdates: false }),
    true,
  );
  assert.equal(
    canonicalNotice({ a: 1, b: 2 }),
    canonicalNotice({ b: 2, a: 1 }),
  );
});
test("all four kinds: durable intents, template rendering, mock WA, last-mile checks", async (t) => {
  const identity = (
    await pool.query(
      "SELECT current_database() name,inet_server_addr()::text host,inet_server_port() port",
    )
  ).rows[0];
  assert.deepEqual(identity, {
    name: u.pathname.slice(1),
    host: "127.0.0.1/32",
    port: 5433,
  });
  const installed = (
    await pool.query(
      "SELECT to_regclass('public.pipeline_notice_dispatches') installed",
    )
  ).rows[0].installed;
  if (!installed) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      for (const sql of readFileSync(
        "lib/db/drizzle/0146_all_pipeline_notifications.sql",
        "utf8",
      ).split("--> statement-breakpoint"))
        if (sql.trim()) await c.query(sql);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  process.env.WORK_PIPELINES_ENABLED = "true";
  process.env.WORK_PIPELINES_TENANT_ID = randomUUID();
  process.env.PIPELINE_EMAIL_AUTOMATION_ENABLED = "true";
  process.env.PIPELINE_EMAIL_AUTOMATION_SINCE = new Date(
    Date.now() - 1000,
  ).toISOString();
  const key = "notice_" + Date.now();
  const userRows = (
    await pool.query(
      `INSERT INTO users(first_name,last_name,role,email,email_verified) VALUES ('Notice','Maker','admin',$1,true),('Notice','Checker','admin',$2,true),('Notice','Contact','student',$3,true) RETURNING *`,
      [key + "m@example.test", key + "c@example.test", key + "s@example.test"],
    )
  ).rows;
  const [maker, checker, contact] = userRows;
  const template = (
    await pool.query(
      "INSERT INTO message_templates(name,category,channel,language,content,created_by_id) VALUES($1,'general','email','en','Notice',$2) RETURNING id",
      [key, maker.id],
    )
  ).rows[0];
  const version = (
    await pool.query(
      `INSERT INTO message_template_email_versions(template_id,version,subject,content,language,variables,created_by_id) VALUES($1,1,'{{recordName}}: {{newStage}}','<p>{{recipientName}} - {{pipelineName}}</p>','en','["recordName","newStage","recipientName","pipelineName"]',$2) RETURNING id`,
      [template.id, maker.id],
    )
  ).rows[0];
  await pool.query(
    "UPDATE message_template_email_versions SET status='review' WHERE id=$1",
    [version.id],
  );
  await pool.query(
    "UPDATE message_template_email_versions SET status='approved',approved_by_id=$2,approved_at=now() WHERE id=$1",
    [version.id, checker.id],
  );
  const metadata = {
    emailSender: {
      revision: 1,
      fromEmail: "sender@example.test",
      fromName: "Synthetic",
      replyTo: "",
      verified: true,
      createdById: maker.id,
      lastChangedById: maker.id,
      approvedById: checker.id,
    },
  };
  const sender = (
    await pool.query(
      "INSERT INTO channel_accounts(channel,provider,display_name,config_encrypted,metadata) VALUES('email','smtp',$1,$2,$3) RETURNING id",
      [
        key,
        JSON.stringify({
          host: "smtp.example.invalid",
          port: 587,
          username: "test",
          password: "synthetic-not-a-credential",
        }),
        metadata,
      ],
    )
  ).rows[0];
  const wa = (
    await pool.query(
      `INSERT INTO message_templates(name,category,channel,language,content,external_template_name,approval_status,variables,created_by_id) VALUES($1,'general','whatsapp','en','{{recordName}}: {{newStage}}',$1,'approved','["recordName","newStage"]',$2) RETURNING id`,
      [key + "wa", maker.id],
    )
  ).rows[0];
  const line = (
    await pool.query(
      "INSERT INTO channel_accounts(channel,provider,display_name,external_account_id) VALUES('whatsapp','zernio',$1,$1) RETURNING id",
      [key + "line"],
    )
  ).rows[0];
  const base = {
    enabled: true,
    policyVersion: 2,
    recipientType: "contact",
    configuredById: maker.id,
    originTypes: ["direct"],
  };
  const email = {
      ...base,
      templateVersionId: version.id,
      senderAccountId: sender.id,
    },
    whatsapp = { ...base, templateId: wa.id, channelAccountId: line.id };
  for (const kind of ["lead", "student", "application"])
    await pool.query(
      "INSERT INTO pipeline_stages(entity_type,key,label,automatic_email,automatic_message) VALUES($1,$2,'Notice stage',$3,$4)",
      [kind, key, email, whatsapp],
    );
  const lead = (
    await pool.query(
      "INSERT INTO leads(first_name,last_name,email,phone_e164,status) VALUES('Notice','Contact',$1,'+905550000001',$2) RETURNING id",
      [contact.email, key],
    )
  ).rows[0];
  const student = (
    await pool.query(
      "INSERT INTO students(first_name,last_name,email,phone_e164,user_id,status) VALUES('Notice','Contact',$1,'+905550000001',$2,$3) RETURNING id",
      [contact.email, contact.id, key],
    )
  ).rows[0];
  const app = (
    await pool.query(
      "INSERT INTO applications(student_id,stage,program_name,university_name) VALUES($1,$2,'Synthetic program','Synthetic school') RETURNING id",
      [student.id, key],
    )
  ).rows[0];
  const tenant = process.env.WORK_PIPELINES_TENANT_ID,
    boardId = randomUUID(),
    stageId = randomUUID(),
    cardId = randomUUID();
  await pool.query(
    "INSERT INTO local_work_pipelines.boards(tenant_id,id,document) VALUES($1,$2,$3)",
    [
      tenant,
      boardId,
      {
        name: "Synthetic board",
        createdBy: maker.id,
        memberIds: [],
        archived: false,
        stages: [
          {
            id: stageId,
            name: "Notice stage",
            automaticEmail: email,
            automaticMessage: whatsapp,
          },
        ],
      },
    ],
  );
  await pool.query(
    "INSERT INTO local_work_pipelines.cards(tenant_id,board_id,id,document) VALUES($1,$2,$3,$4)",
    [
      tenant,
      boardId,
      cardId,
      {
        stageId,
        title: "Synthetic card",
        contactName: "Notice Contact",
        email: contact.email,
        phone: "+905550000001",
        status: "active",
      },
    ],
  );
  const ids = [String(lead.id), String(student.id), String(app.id), cardId];
  const intents = async () =>
    (
      await pool.query(
        "SELECT * FROM pipeline_notice_dispatches WHERE entity_id=ANY($1::text[]) AND stage_key=ANY($2::text[]) ORDER BY id",
        [ids, [key, stageId]],
      )
    ).rows;
  await t.test("eight intents and no legacy dispatch overlap", async () => {
    assert.equal((await intents()).length, 8);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM pipeline_stage_message_dispatches WHERE stage_key=$1",
          [key],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM pipeline_stage_email_dispatches WHERE stage_key=$1",
          [key],
        )
      ).rows[0].n,
      0,
    );
  });
  const deliveries: any[] = [];
  const mock: any = async (p: any) => {
    await p.beforeSend();
    deliveries.push({
      noticeId: p.noticeId,
      phone: p.phone,
      context: p.context,
    });
    return { externalMessageId: "mock:" + p.noticeId };
  };
  await Promise.all([
    processPipelineNotices(mock),
    processPipelineNotices(mock),
  ]);
  await t.test(
    "four mock WA deliveries and four rendered email queue rows, no provider calls",
    async () => {
      assert.equal(deliveries.length, 4);
      const list = await intents();
      assert.equal(list.filter((n) => n.status === "sent").length, 4);
      assert.equal(list.filter((n) => n.status === "enqueued").length, 4);
      for (const n of list.filter((n) => n.channel === "email"))
        assert.equal(
          await validatePipelineNoticeQueueItem(n.email_queue_id),
          true,
        );
    },
  );
  await t.test(
    "four mock SMTP accepts use the existing claimed mail execution boundary",
    async () => {
      for (const n of (await intents()).filter((n) => n.channel === "email")) {
        const token = randomUUID();
        const q = (
          await pool.query(
            "UPDATE email_queue SET status='processing',claim_token=$2,claimed_at=now() WHERE id=$1 RETURNING *",
            [n.email_queue_id, token],
          )
        ).rows[0];
        let calls = 0;
        assert.equal(
          await executeClaimedEmail(q, {
            allowed: () => true,
            send: async (row) => {
              assert.equal(await validatePipelineNoticeQueueItem(row.id), true);
              calls++;
              return classifyEmailTransportReceipt(
                {
                  accepted: [row.to_email],
                  rejected: [],
                  messageId: "mock:" + row.id,
                  response: "250 mock",
                },
                row.to_email,
                "mock:" + row.id,
              );
            },
            save: async (row, result) => {
              await pool.query(
                "UPDATE email_queue SET status=$3,provider_message_id=$4,claim_token=null WHERE id=$1 AND claim_token=$2",
                [row.id, row.claim_token, result.status, result.messageId],
              );
            },
            onSaveFailure: () => assert.fail("Mock receipt must persist"),
          }),
          true,
        );
        assert.equal(calls, 1);
      }
    },
  );
  await t.test(
    "agent/contact/assignee recipient selection and no invalid-agent fallback",
    async () => {
      const user = (
        await pool.query(
          "INSERT INTO users(first_name,last_name,role,email,email_verified) VALUES('Notice','Agent','agent',$1,true) RETURNING *",
          [key + "a@example.test"],
        )
      ).rows[0];
      const agent = (
        await pool.query(
          "INSERT INTO agents(first_name,last_name,email,user_id,phone_e164) VALUES('Notice','Agent',$1,$2,'+905550000002') RETURNING id",
          [user.email, user.id],
        )
      ).rows[0];
      const n = (await intents()).find(
        (n) => n.entity_kind === "application" && n.channel === "email",
      );
      const c = await pool.connect();
      const config = {
        ...email,
        originTypes: ["agent"],
        recipientType: "auto",
      };
      try {
        await pool.query("UPDATE students SET agent_id=$2 WHERE id=$1", [
          student.id,
          agent.id,
        ]);
        await pool.query(
          "UPDATE pipeline_stages SET automatic_email=$2 WHERE entity_type='application' AND key=$1",
          [key, config],
        );
        const b = await noticeContext(c, { ...n, policy: config });
        assert.ok(!("code" in b));
        if ("code" in b) throw Error(b.code);
        assert.equal(b.email, user.email);
        assert.equal(b.phone, "+905550000002");
        await pool.query("UPDATE users SET email_verified=false WHERE id=$1", [
          user.id,
        ]);
        assert.deepEqual(await noticeContext(c, { ...n, policy: config }), {
          code: "NOTICE_EMAIL_UNVERIFIED",
        });
        await pool.query("UPDATE users SET email_verified=true WHERE id=$1", [
          user.id,
        ]);
        const direct = { ...config, recipientType: "contact" };
        await pool.query(
          "UPDATE pipeline_stages SET automatic_email=$2 WHERE entity_type='application' AND key=$1",
          [key, direct],
        );
        const d = await noticeContext(c, { ...n, policy: direct });
        assert.ok(!("code" in d));
        if (!("code" in d)) assert.equal(d.email, contact.email);
        const assigned = { ...config, recipientType: "assignee" };
        await pool.query(
          "UPDATE applications SET assigned_to_id=$2 WHERE id=$1",
          [app.id, checker.id],
        );
        await pool.query(
          "UPDATE pipeline_stages SET automatic_email=$2 WHERE entity_type='application' AND key=$1",
          [key, assigned],
        );
        const a = await noticeContext(c, { ...n, policy: assigned });
        assert.ok(!("code" in a));
        if (!("code" in a)) assert.equal(a.email, checker.email);
      } finally {
        c.release();
        await pool.query("UPDATE students SET agent_id=null WHERE id=$1", [
          student.id,
        ]);
        await pool.query(
          "UPDATE pipeline_stages SET automatic_email=$2 WHERE entity_type='application' AND key=$1",
          [key, email],
        );
      }
    },
  );
  await t.test(
    "work RLS denies another tenant for the nonprivileged application role",
    async () => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("SET LOCAL ROLE fas_app");
        await c.query("SELECT set_config('app.work_pipeline_tenant',$1,true)", [
          randomUUID(),
        ]);
        assert.equal(
          (
            await c.query(
              "SELECT id FROM pipeline_notice_dispatches WHERE board_id=$1",
              [boardId],
            )
          ).rows.length,
          0,
        );
        await c.query("SELECT set_config('app.work_pipeline_tenant',$1,true)", [
          tenant,
        ]);
        assert.equal(
          (
            await c.query(
              "SELECT id FROM pipeline_notice_dispatches WHERE board_id=$1",
              [boardId],
            )
          ).rows.length,
          2,
        );
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    },
  );
  await t.test("same-stage updates enqueue nothing and a genuine re-entry has its own transition", async () => {
    await pool.query("UPDATE leads SET status=$2 WHERE id=$1", [lead.id, key]);
    assert.equal((await intents()).length, 8);
    await pool.query("UPDATE leads SET status='new' WHERE id=$1", [lead.id]);
    await pool.query("UPDATE leads SET status=$2 WHERE id=$1", [lead.id, key]);
    const list = await intents();
    assert.equal(list.length, 10);
    const leadNotices = list.filter(row => row.entity_kind === "lead");
    assert.equal(new Set(leadNotices.map(row => row.transition_id)).size, 2);
  });
  await t.test("an event-time recipient cannot silently change before the worker claims it", async () => {
    await pool.query("UPDATE leads SET email=$2, phone=$3, phone_e164=$3 WHERE id=$1", [
      lead.id, key + "-changed@example.test", "+12025550123",
    ]);
    await processPipelineNotices(mock);
    const list = (await intents()).filter(row => row.entity_kind === "lead" && row.status === "skipped");
    assert.equal(list.length, 2);
    assert.ok(list.every(row => row.error_code === "NOTICE_RECIPIENT_CHANGED"));
  });
  await t.test(
    "preferences, account revision and stage drift block queued delivery",
    async () => {
      const n = (await intents()).find(
        (n) => n.entity_kind === "application" && n.channel === "email",
      );
      await pool.query(
        "UPDATE users SET notification_preferences='{\"applicationUpdates\":false}' WHERE id=$1",
        [contact.id],
      );
      assert.equal(
        await validatePipelineNoticeQueueItem(n.email_queue_id),
        false,
      );
      await pool.query(
        "UPDATE users SET notification_preferences='{}' WHERE id=$1",
        [contact.id],
      );
      await pool.query(
        "UPDATE channel_accounts SET metadata=jsonb_set(metadata,'{emailSender,revision}','2') WHERE id=$1",
        [sender.id],
      );
      assert.equal(
        await validatePipelineNoticeQueueItem(n.email_queue_id),
        false,
      );
      await pool.query(
        "UPDATE channel_accounts SET metadata=jsonb_set(metadata,'{emailSender,revision}','1') WHERE id=$1",
        [sender.id],
      );
      await pool.query(
        "UPDATE applications SET stage='submitted' WHERE id=$1",
        [app.id],
      );
      assert.equal(
        await validatePipelineNoticeQueueItem(n.email_queue_id),
        false,
      );
    },
  );
  await t.test(
    "other work tenant and disabled configurator are denied",
    async () => {
      const n = (await intents()).find((n) => n.entity_kind === "work");
      const c = await pool.connect();
      try {
        const wrong = await noticeContext(c, { ...n, tenant_id: randomUUID() });
        assert.ok("code" in wrong);
        await pool.query("UPDATE users SET is_active=false WHERE id=$1", [
          maker.id,
        ]);
        assert.ok("code" in (await noticeContext(c, n)));
      } finally {
        c.release();
      }
    },
  );
  await pool.query("UPDATE users SET is_active=true WHERE id=$1", [maker.id]);
});
