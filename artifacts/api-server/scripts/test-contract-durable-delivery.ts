import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { contractDeliveryMode, contractSmtpAllowed } from '../src/lib/contractDeliveryPolicy';
import { contractSmtpOutcome } from '../src/lib/contractSmtpReceipt';
import { ContractDeliveryStore, contractPdfDigest } from '../src/lib/contractDeliveryStore';

const url = new URL(process.env.CONTRACT_DELIVERY_TEST_DATABASE_URL || 'http://invalid');
assert.equal(url.protocol, 'postgres:'); assert.equal(url.hostname,'127.0.0.1');
assert.match(url.pathname,/^\/fas_contract_mail_test_[a-z0-9_]+$/); assert.equal(url.search,'');
process.env.DATABASE_URL = url.toString(); process.env.NODE_ENV='test';
process.env.ALLOW_LIVE_INTEGRATIONS='false'; process.env.EMAIL_DELIVERY_DISABLED='true';
const ownRequire=createRequire(import.meta.url);
const pg=createRequire(ownRequire.resolve('@workspace/db'))('pg');
const pgPool=new pg.Pool({connectionString:url.toString(),max:6,connectionTimeoutMillis:3000});
const { runContractDeliverySweep }=await import('../src/lib/contractDeliveryWorker');
const {pool:appPool}=await import('@workspace/db');
const {prepareEnrolledPdf}=await import('../src/lib/contractDeliveryPdf');
const {readContractDeliveryStatus}=await import('../src/lib/contractDeliveryStatus');
after(async()=>{await pgPool.end();await appPool.end();});

test('default-off policy rejects parallel legacy workers and explicit sending without outbound authorization',()=>{
  const env={SIGNED_CONTRACT_DELIVERY_ENABLED:'false',SIGNED_CONTRACT_PDF_WORKER_ENABLED:'false'};
  assert.equal(contractDeliveryMode(env),'off');
  assert.equal(contractDeliveryMode({...env,SIGNED_CONTRACT_DURABLE_DELIVERY_MODE:'prepare'}),'prepare');
  for(const field of ['SIGNED_CONTRACT_DELIVERY_ENABLED','SIGNED_CONTRACT_PDF_WORKER_ENABLED'])
    assert.equal(contractDeliveryMode({...env,[field]:'true',SIGNED_CONTRACT_DURABLE_DELIVERY_MODE:'send'}),'off');
  assert.equal(contractSmtpAllowed({...env,SIGNED_CONTRACT_DURABLE_DELIVERY_MODE:'send',NODE_ENV:'production'}),false);
  assert.equal(contractSmtpAllowed({...env,SIGNED_CONTRACT_DURABLE_DELIVERY_MODE:'send',NODE_ENV:'test',ALLOW_LIVE_INTEGRATIONS:'true'}),false);
});
test('SMTP receipt requires exact recipient, message ID and positive acceptance',()=>{
  const good={accepted:['test@example.invalid'],rejected:[],messageId:'<test@findandstudy.com>',response:'250 2.0.0 queued'};
  assert.equal(contractSmtpOutcome(good,'test@example.invalid',good.messageId).state,'accepted');
  for(const patch of [{accepted:['other@example.invalid']},{messageId:'wrong'},{response:'451 try later'},{rejected:['another@example.invalid']},{accepted:[]},{accepted:undefined}])
    assert.equal(contractSmtpOutcome({...good,...patch},'test@example.invalid',good.messageId).state,'ambiguous');
  assert.equal(contractSmtpOutcome({...good,accepted:[],rejected:['test@example.invalid']},'test@example.invalid',good.messageId).state,'rejected');
});
test('future enrolled PDF uses frozen data, never mutable agent/template or existing evidence',()=>{
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const snapshot={contract:{id:1,signing_session_id:2,template_id:3,pdf_object_key:null,evidence_hash:null,
    signature_image_base64:png,signed_at:'2026-11-25T12:00:00Z',email_verified_at:'2026-11-25T11:00:00Z',email_verification_required:true,
    email_verification_method:'one_time_code',signer_email:'test@example.invalid',signer_name:'TEST'},session:{id:2,template_id:3,status:'signed',revoked_at:null,
    signed_at:'2026-11-25T12:00:00Z',template_version_snapshot:6,template_name_snapshot:'TEST Frozen',template_language_snapshot:'en',
    template_body_html_snapshot:'<style>.test{color:#123456}</style><p class="test">{{agency_name}} {{contract_number}}</p><img src="{{signature}}"><img src="{{main_agency_signature}}">',
    intake_data:{companyName:'TEST FROZEN COMPANY'},template_signing_page_config_snapshot:{companySignatureDataUrl:`data:image/png;base64,${png}`}}};
  const output=prepareEnrolledPdf(snapshot);assert.match(output.bodyHtml,/TEST FROZEN COMPANY/);assert.match(output.bodyHtml,/#123456/);
  for(const mutate of [
    (s:any)=>{s.contract.evidence_hash='e'.repeat(64);},
    (s:any)=>{s.session.template_signing_page_config_snapshot={};},
    (s:any)=>{s.session.template_body_html_snapshot+='{{agent.taxNumber}}';},
    (s:any)=>{s.session.template_signing_page_config_snapshot.logoUrl='https://example.invalid/current.png';},
    (s:any)=>{s.session.template_body_html_snapshot+=`<img src="https://example.invalid/current.png" data-src="data:image/png;base64,${png}">`;},
    (s:any)=>{s.session.template_body_html_snapshot+='<img src="data:image/png;base64,AAAA">';},
    (s:any)=>{s.session.intake_data.contract_number='OTHER-CONTRACT';},
    (s:any)=>{s.session.intake_data.sign_date='2001-01-01';},
    (s:any)=>{s.session.intake_data.signer_email='wrong@example.invalid';},
    (s:any)=>{s.contract.email_verification_method='not_required';},
  ]){const changed=structuredClone(snapshot);mutate(changed);assert.throws(()=>prepareEnrolledPdf(changed));}
});

test('disposable PostgreSQL + fake SMTP execute durable delivery transitions',async t=>{
  const client=await pgPool.connect();
  const store=new ContractDeliveryStore(pgPool);
  const pdf=Buffer.from(`%PDF-1.7\n${'SYNTHETIC TEST ONLY '.repeat(20)}`);
  const key='/objects/signed-contracts/synthetic-test.pdf',evidence='e'.repeat(64);
  try{
    const identity=(await client.query('SELECT current_database() AS name,host(inet_server_addr()) AS address')).rows[0];
    assert.equal(identity.name,url.pathname.slice(1)); assert.equal(identity.address,'127.0.0.1');
    assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n,0,'fresh disposable DB only');
    assert.equal((await readContractDeliveryStatus(1,9)).state,'unconfirmed','pre-migration status remains truthful');
    await client.query(`CREATE TABLE signing_sessions(id integer PRIMARY KEY,status text NOT NULL,revoked_at timestamptz);
      CREATE TABLE signed_contracts(id integer PRIMARY KEY,signing_session_id integer NOT NULL,signer_email text NOT NULL,pdf_object_key text,evidence_hash text,emailed_at timestamptz,agent_id integer DEFAULT 9);
      CREATE TABLE email_queue(id integer PRIMARY KEY,html_body text);`);
    await client.query(await readFile(new URL('../../../deploy/prepared-migrations/apply/0067_signed_contract_delivery.sql',import.meta.url),'utf8'));
    const reset=async(enroll=true)=>{
      await client.query('TRUNCATE signed_contract_deliveries,signed_contracts,signing_sessions');
      await client.query("INSERT INTO signing_sessions VALUES(1,'signed',NULL),(2,'signed',NULL)");
      await client.query(`INSERT INTO signed_contracts(id,signing_session_id,signer_email,pdf_object_key,evidence_hash,emailed_at) VALUES(1,1,'test@example.invalid',$1,$2,NULL),(2,2,'historical@example.invalid',$1,$2,NULL)`,[key,evidence]);
      if(enroll)await client.query("INSERT INTO signed_contract_deliveries(signed_contract_id,signing_session_id,recipient,message_id) VALUES(1,1,'test@example.invalid','<synthetic@findandstudy.com>')");
    };
    let sends=0;let transportOutcome:any;let afterSend:undefined|(()=>void);
    const deps={store,readPdf:async()=>pdf,maySend:()=>true,
      prepare:async()=>({artifact:{key,evidenceHash:evidence,bytes:pdf},email:{subject:'TEST signed contract',html:'<p>TEST ONLY</p>',text:'TEST ONLY'}}),
      transport:async()=>({close(){},send:async(message:any)=>{sends++;assert.deepEqual(message.pdf,pdf);assert.equal(message.recipient,'test@example.invalid');afterSend?.();return transportOutcome??contractSmtpOutcome({accepted:[message.recipient],rejected:[],messageId:message.messageId,response:'250 2.0.0 test receipt'},message.recipient,message.messageId);}})};
    const state=async()=> (await client.query('SELECT * FROM signed_contract_deliveries WHERE signed_contract_id=1')).rows[0];
    const resetCounts=()=>{sends=0;transportOutcome=undefined;afterSend=undefined;};
    await t.test('successful actual worker path attaches bytes and atomically records acceptance',async()=>{
      await reset();resetCounts();await runContractDeliverySweep(deps);
      const row=await state();assert.equal(row.state,'accepted');assert.equal(row.pdf_sha256,contractPdfDigest(pdf));assert.equal(sends,1);
      assert.ok((await client.query('SELECT emailed_at FROM signed_contracts WHERE id=1')).rows[0].emailed_at);
      assert.equal((await readContractDeliveryStatus(1,9)).state,'sent');
      assert.equal((await readContractDeliveryStatus(1,10)).state,'unconfirmed','another agency cannot see this receipt');
      assert.equal((await readContractDeliveryStatus(2,9)).state,'unconfirmed','legacy timestamp is not SMTP evidence');
      assert.equal((await client.query('SELECT emailed_at FROM signed_contracts WHERE id=2')).rows[0].emailed_at,null);
      await runContractDeliverySweep(deps);assert.equal(sends,1);
      assert.equal((await client.query('SELECT count(*)::int AS n FROM email_queue')).rows[0].n,0);
    });
    await t.test('parallel workers consume only one committed attempt',async()=>{
      await reset();resetCounts();await Promise.all([runContractDeliverySweep(deps),runContractDeliverySweep(deps)]);
      assert.equal(sends,1);assert.equal((await state()).state,'accepted');
    });
    await t.test('prepare-only mode freezes attachment but cannot call SMTP',async()=>{
      await reset();resetCounts();await runContractDeliverySweep({...deps,maySend:()=>false});
      assert.equal((await state()).state,'ready');assert.equal(sends,0);
      assert.equal((await readContractDeliveryStatus(1,9)).state,'pending');
    });
    await t.test('unknown SMTP outcome is permanent ambiguity, never blind retried',async()=>{
      await reset();resetCounts();transportOutcome={state:'ambiguous',code:'SMTP_OUTCOME_UNCONFIRMED'};
      await runContractDeliverySweep(deps);await runContractDeliverySweep(deps);
      assert.equal((await state()).state,'ambiguous');assert.equal(sends,1);
      assert.equal((await readContractDeliveryStatus(1,9)).state,'attention');
      assert.equal((await client.query('SELECT emailed_at FROM signed_contracts WHERE id=1')).rows[0].emailed_at,null);
    });
    await t.test('process/DB failure after SMTP leaves sending and cannot send twice',async()=>{
      await reset();resetCounts();
      const failingStore=new ContractDeliveryStore({connect:async()=>{throw new Error('TEST PROCESS CRASH');}});
      const crashDeps={...deps,store:new Proxy(store,{get(target,prop){if(prop==='finishSending')return failingStore.finishSending.bind(failingStore);const value=(target as any)[prop];return typeof value==='function'?value.bind(target):value;}})};
      await assert.rejects(runContractDeliverySweep(crashDeps),/TEST PROCESS CRASH/);
      assert.equal((await state()).state,'sending');assert.equal(sends,1);
      await client.query("UPDATE signed_contract_deliveries SET sending_at=now()-interval '6 minutes' WHERE signed_contract_id=1");
      await runContractDeliverySweep(deps);assert.equal((await state()).state,'ambiguous');assert.equal(sends,1);
    });
    await t.test('changed bytes, record identity or revoked session never send',async()=>{
      for(const change of ['bytes','recipient','revoked']){
        await reset();resetCounts();await runContractDeliverySweep({...deps,maySend:()=>false});
        if(change==='recipient')await client.query("UPDATE signed_contracts SET signer_email='other@example.invalid' WHERE id=1");
        if(change==='revoked')await client.query("UPDATE signing_sessions SET revoked_at=now() WHERE id=1");
        const changed={...deps,...(change==='bytes'?{readPdf:async()=>Buffer.from(pdf.toString()+'changed')}:{})};
        if(change==='bytes')await assert.rejects(runContractDeliverySweep(changed),/ATTACHMENT_CHANGED/);else await runContractDeliverySweep(changed);
        assert.equal(sends,0);
      }
    });
    await t.test('migration and sweeps never enroll historical signatures',async()=>{
      await reset(false);resetCounts();await runContractDeliverySweep(deps);assert.equal(sends,0);
      assert.equal((await client.query('SELECT count(*)::int AS n FROM signed_contract_deliveries')).rows[0].n,0);
    });
    await t.test('broken first attachment fails closed without starving later valid mail',async()=>{
      await reset();resetCounts();await runContractDeliverySweep({...deps,maySend:()=>false});
      await client.query("INSERT INTO signed_contract_deliveries(signed_contract_id,signing_session_id,recipient,message_id) VALUES(2,2,'historical@example.invalid','<second-synthetic@findandstudy.com>')");
      const second=await store.claimPreparation();assert.equal(second?.signed_contract_id,2);
      await store.bindPrepared(second!,{key,evidenceHash:evidence,bytes:pdf},{subject:'TEST second',html:'TEST',text:'TEST'});
      const progress={...deps,readPdf:async()=>{if((await state()).state==='ready')throw new Error('TEST MISSING FILE');return pdf;},
        transport:async()=>({close(){},send:async(message:any)=>{sends++;assert.equal(message.recipient,'historical@example.invalid');return contractSmtpOutcome({accepted:[message.recipient],rejected:[],messageId:message.messageId,response:'250 TEST'},message.recipient,message.messageId);}})};
      await runContractDeliverySweep(progress);assert.equal((await state()).state,'failed');assert.equal(sends,0);
      await runContractDeliverySweep(progress);assert.equal(sends,1);
      assert.equal((await client.query('SELECT state FROM signed_contract_deliveries WHERE signed_contract_id=2')).rows[0].state,'accepted');
    });
    await t.test('durable identity, attachment and terminal receipt reject mutation/deletion',async()=>{
      await reset();resetCounts();await runContractDeliverySweep(deps);
      for(const sql of ["UPDATE signed_contract_deliveries SET recipient='other@example.invalid'","UPDATE signed_contract_deliveries SET pdf_sha256=repeat('a',64)","UPDATE signed_contract_deliveries SET state='ready'","DELETE FROM signed_contract_deliveries"])
        await assert.rejects(client.query(sql));
    });
    await t.test('forged acceptance receipt cannot mark emailed_at or finish an attempt',async()=>{
      await reset();resetCounts();await runContractDeliverySweep({...deps,maySend:()=>false});
      const row=await store.nextReady();const sending=await store.claimSending(row!,pdf);assert.ok(sending);
      await assert.rejects(store.finishSending(sending!,{state:'accepted',receipt:{recipient:'other@example.invalid',messageId:sending!.message_id,responseSha256:'a'.repeat(64)}}),/RECEIPT_INVALID/);
      await assert.rejects(client.query(`UPDATE signed_contract_deliveries SET state='accepted',accepted_at=now(),receipt=$1::jsonb WHERE signed_contract_id=1`,
        [JSON.stringify({recipient:'other@example.invalid',messageId:sending!.message_id,responseSha256:'a'.repeat(64)})]));
      assert.equal((await state()).state,'sending');assert.equal((await client.query('SELECT emailed_at FROM signed_contracts WHERE id=1')).rows[0].emailed_at,null);
    });
  }finally{client.release();}
});
