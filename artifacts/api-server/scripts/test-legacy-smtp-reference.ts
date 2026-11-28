import assert from "node:assert/strict";
import { test, mock, after } from "node:test";
import { readFile } from "node:fs/promises";
process.env.DATABASE_URL="postgresql://fixture:fixture@127.0.0.1:1/no_database";
process.env.ENCRYPTION_KEY="synthetic-smtp-reference-key";
process.env.ALLOW_LIVE_INTEGRATIONS="false";
process.env.EMAIL_DELIVERY_DISABLED="true";
process.env.NODE_ENV="test";
const {db,integrationsTable,settingsTable}=await import("@workspace/db");
const {encryptConfig}=await import("../src/lib/encryption");
const {legacySmtpSnapshot}=await import("../src/lib/notifications/legacySmtpSender");
const {senderInputForAccount,resolveEmailSenderAccount,projectEmailSender}=await import("../src/lib/notifications/emailSenderAccounts");
let integration:any={id:41,isEnabled:true,config:encryptConfig({host:"smtp.example.test",port:587,username:"smtp@example.invalid",password:"synthetic-password",fromEmail:"smtp@example.invalid"})};
let branding:any={fromEmail:"sender@example.invalid",fromName:"Synthetic brand",replyTo:"reply@example.invalid"};
let account:any;
const select=mock.method(db,"select",()=>({from:(table:unknown)=>{
  const rows=table===integrationsTable?(integration?[integration]:[]):table===settingsTable?[branding]:account?[account]:[];
  return {limit:async()=>rows,where:()=>({limit:async()=>rows})};
}}));
after(()=>select.mock.restore());

test("existing SMTP source is referenced without copying credentials and changes invalidate approval",async()=>{
  const source=(await legacySmtpSnapshot())!;
  account={id:9,channel:"email",provider:"smtp",displayName:"SMTP",status:"active",isActive:true,configEncrypted:null,
    metadata:{emailSender:{revision:1,verified:true,createdById:1,lastChangedById:1,approvedById:2,fromEmail:source.input.fromEmail,
      fromName:source.input.fromName,replyTo:source.input.replyTo,sourceIntegrationKey:"smtp",sourceFingerprint:source.fingerprint}}};
  assert.equal((await senderInputForAccount(account)).password,"synthetic-password");
  assert.equal((await resolveEmailSenderAccount(9,1))?.fromEmail,"sender@example.invalid");
  const safe=await projectEmailSender(account);
  assert.equal(safe.sourceIntegrationKey,"smtp");assert.equal(safe.verified,true);
  assert.ok(!JSON.stringify(safe).includes("synthetic-password"));assert.ok(!JSON.stringify(safe).includes(source.fingerprint));
  assert.equal(account.configEncrypted,null);
  integration.config={...integration.config,host:"new.example.test"};
  assert.equal(await resolveEmailSenderAccount(9,1),null);
  assert.equal((await projectEmailSender(account)).verified,false);
  await assert.rejects(senderInputForAccount(account),/EMAIL_INTEGRATION_CHANGED/);
  integration.isEnabled=false;assert.equal(await resolveEmailSenderAccount(9,1),null);
  integration=null;assert.equal(await resolveEmailSenderAccount(9,1),null);
});

test("integration links require the existing human approval corridor and cannot be edited as copied SMTP",async()=>{
  const route=await readFile(new URL("../src/routes/emailAutomation.ts",import.meta.url),"utf8");
  assert.match(route,/requireEmailAutomationHuman/);assert.match(route,/pg_advisory_xact_lock/);
  assert.match(route,/sourceFingerprint === source.fingerprint/);assert.match(route,/configEncrypted: null/);
  assert.match(route,/EMAIL_SENDER_USE_INTEGRATION/);assert.match(route,/EMAIL_SECOND_REVIEWER_REQUIRED/);
  assert.match(route,/senderInputForAccount\(current\)/);
});
