import assert from 'node:assert/strict';
import { after, beforeEach, mock, test } from 'node:test';
import net from 'node:net';
import { PgDialect } from 'drizzle-orm/pg-core';
process.env.DATABASE_URL='postgres://fixture:fixture@127.0.0.1:1/fas_contract_mail_test_none';
process.env.NODE_ENV='test';process.env.EMAIL_DELIVERY_DISABLED='true';process.env.ALLOW_LIVE_INTEGRATIONS='false';
mock.method(net.Socket.prototype,'connect',()=>{throw new Error('NETWORK_FORBIDDEN');});
mock.method(globalThis,'fetch',()=>{throw new Error('NETWORK_FORBIDDEN');});
const schema=await import('@workspace/db');
const {db,pool,signingSessionsTable,contractTemplatesTable,signedContractsTable,auditLogsTable}=schema;
mock.method(pool,'connect',()=>{throw new Error('DATABASE_FORBIDDEN');});
mock.method(pool,'query',()=>{throw new Error('DATABASE_FORBIDDEN');});
const {finalizeSign}=await import('../src/lib/signContract');
let state='verified', rows:any[]=[], enrollment:any[]=[], failEnrollment=false;
const dialect=new PgDialect();
mock.method(db,'select',()=>({from:(table:any)=>({where:async()=>table===signingSessionsTable
  ?[{id:100,templateId:50,status:state,expiresAt:new Date(Date.now()+60000),signerEmail:'TEST@example.invalid',signerName:'TEST',agentId:9,templateSigningPageConfigSnapshot:{requireEmailVerification:false}}]
  :table===contractTemplatesTable?[{id:50,signingPageConfig:{requireEmailVerification:false}}]:[]})}) as any);
mock.method(db,'insert',(table:any)=>({values:async()=>{assert.equal(table,auditLogsTable);}}) as any);
mock.method(db,'transaction',async(run:any)=>{
  const previous={state,rows:[...rows],enrollment:[...enrollment]};
  try{return await run({
    update:(table:any)=>({set:(value:any)=>({where:()=>({returning:async()=>{assert.equal(table,signingSessionsTable);state=value.status;return[{id:100}];}})})}),
    insert:(table:any)=>({values:(value:any)=>({returning:async()=>{assert.equal(table,signedContractsTable);const row={...value,id:700};rows.push(row);return[row];}})}),
    execute:async(query:any)=>{if(failEnrollment)throw new Error('TEST ENROLLMENT FAILED');enrollment.push(dialect.sqlToQuery(query));},
  });}catch(error){state=previous.state;rows=previous.rows;enrollment=previous.enrollment;throw error;}
});
beforeEach(()=>{state='verified';rows=[];enrollment=[];failEnrollment=false;delete process.env.SIGNED_CONTRACT_DURABLE_DELIVERY_MODE;process.env.SIGNED_CONTRACT_DELIVERY_ENABLED='false';process.env.SIGNED_CONTRACT_PDF_WORKER_ENABLED='false';});
after(async()=>{await pool.end();mock.restoreAll();});
const sign=()=>finalizeSign({sessionId:100,signatureImagePngBase64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',signerName:'TEST',signerIp:null,signerUserAgent:'TEST'});
test('actual signing flow with default off does not require or write new table',async()=>{
  assert.equal((await sign()).ok,true);assert.equal(state,'signed');assert.equal(rows.length,1);assert.equal(enrollment.length,0);
});
test('actual signing flow atomically enrolls exactly its new record with frozen recipient',async()=>{
  process.env.SIGNED_CONTRACT_DURABLE_DELIVERY_MODE='prepare';assert.equal((await sign()).ok,true);
  assert.equal(enrollment.length,1);assert.match(enrollment[0].sql,/INSERT INTO signed_contract_deliveries/);
  assert.deepEqual(enrollment[0].params.slice(0,3),[700,100,'test@example.invalid']);
  assert.match(enrollment[0].params[3],/^<contract-[a-f0-9-]+@findandstudy\.com>$/);
  assert.equal((await sign()).ok,false);assert.equal(enrollment.length,1);
});
test('missing migration or enqueue failure rolls back signature and does not send',async()=>{
  process.env.SIGNED_CONTRACT_DURABLE_DELIVERY_MODE='prepare';failEnrollment=true;
  assert.equal((await sign()).ok,false);assert.equal(state,'verified');assert.equal(rows.length,0);assert.equal(enrollment.length,0);
});
test('legacy worker conflict leaves new path disabled',async()=>{
  process.env.SIGNED_CONTRACT_DURABLE_DELIVERY_MODE='send';process.env.SIGNED_CONTRACT_DELIVERY_ENABLED='true';
  assert.equal((await sign()).ok,true);assert.equal(enrollment.length,0);
});
