import test from "node:test";
import assert from "node:assert/strict";
import { parseStageAutomaticEmail, stageEmailConfigsEqual, stageEmailOrigin, stageEmailRecipient, stageEmailRuntime } from "../src/lib/notifications/stageEmailPolicy";

test("automation is off unless both the explicit switch and activation time exist", () => {
  assert.equal(stageEmailRuntime({}).enabled, false);
  assert.equal(stageEmailRuntime({ PIPELINE_EMAIL_AUTOMATION_ENABLED: "true" }).enabled, false);
  assert.equal(stageEmailRuntime({ PIPELINE_EMAIL_AUTOMATION_ENABLED: "true", PIPELINE_EMAIL_AUTOMATION_SINCE: "not a date" }).enabled, false);
  assert.equal(stageEmailRuntime({ PIPELINE_EMAIL_AUTOMATION_ENABLED: "true", PIPELINE_EMAIL_AUTOMATION_SINCE: "2026-09-21T00:00:00Z" }).enabled, true);
});
test("stage config requires exact approved references and explicit valid origins", () => {
  assert.equal(parseStageAutomaticEmail(null), null);
  assert.equal(parseStageAutomaticEmail({enabled:false}), null);
  const config = parseStageAutomaticEmail({enabled:true,templateVersionId:1,senderAccountId:2});
  assert.deepEqual(config?.originTypes,["direct"]);
  for (const raw of [true,[],{enabled:"true"},{enabled:true,templateVersionId:"1",senderAccountId:2},
    {enabled:true,templateVersionId:1,senderAccountId:2,originTypes:[]},
    {enabled:true,templateVersionId:1,senderAccountId:2,originTypes:["all"]}]) assert.throws(() => parseStageAutomaticEmail(raw));
});
test("source audience never changes the student recipient into an agency mailbox", () => {
  assert.equal(stageEmailOrigin(null,null),"direct");
  assert.equal(stageEmailOrigin(2,null),"agent");
  assert.equal(stageEmailOrigin(3,2),"sub_agent");
  const good = {studentEmail:"Student@EXAMPLE.test",userEmail:"student@example.test",verified:true,active:true};
  assert.equal(stageEmailRecipient(good),"student@example.test");
  for (const patch of [{verified:false},{active:false},{userEmail:"agency@example.test"},{studentEmail:null},{studentEmail:"a@example.test\r\nBcc: b@example.test"}]) {
    assert.equal(stageEmailRecipient({...good,...patch}),null);
  }
});

test("semantic equality survives JSONB key and origin order without allowing policy changes", () => {
  const config = { enabled: true, templateVersionId: 1, senderAccountId: 2, originTypes: ["direct", "agent"] };
  assert.equal(stageEmailConfigsEqual(config, { originTypes: ["agent", "direct"], senderAccountId: 2, templateVersionId: 1, enabled: true }), true);
  assert.equal(stageEmailConfigsEqual(undefined, null), true);
  assert.equal(stageEmailConfigsEqual({ enabled: false }, null), true);
  assert.equal(stageEmailConfigsEqual(config, { ...config, senderAccountId: 3 }), false);
  assert.equal(stageEmailConfigsEqual(config, { ...config, templateVersionId: 3 }), false);
  assert.equal(stageEmailConfigsEqual(config, { ...config, originTypes: ["direct"] }), false);
  assert.equal(stageEmailConfigsEqual(config, { enabled: false }), false);
  assert.equal(stageEmailConfigsEqual({ enabled: "true" }, { enabled: "true" }), false);
});
