import assert from 'node:assert/strict';
import { after, beforeEach, mock, test } from 'node:test';
import net from 'node:net';
process.env.DATABASE_URL='postgres://fixture:fixture@127.0.0.1:1/fas_contract_mail_test_none';
process.env.NODE_ENV='test';process.env.EMAIL_DELIVERY_DISABLED='true';process.env.ALLOW_LIVE_INTEGRATIONS='false';
process.env.SIGNED_CONTRACT_DELIVERY_ENABLED='false';process.env.SIGNED_CONTRACT_PDF_WORKER_ENABLED='false';
mock.method(net.Socket.prototype,'connect',()=>{throw new Error('NETWORK_FORBIDDEN');});
mock.method(globalThis,'fetch',()=>{throw new Error('NETWORK_FORBIDDEN');});
const {db,pool,signingSessionsTable,contractTemplatesTable}=await import('@workspace/db');
mock.method(pool,'connect',()=>{throw new Error('DATABASE_FORBIDDEN');});mock.method(pool,'query',()=>{throw new Error('DATABASE_FORBIDDEN');});
let session:any, writes=0, finalizeDuringSave=false, driftDuringSave=false;
const template={id:50,version:6,name:'TEST',language:'en',entityType:'company',bodyHtml:'<p>{{whatsapp_phone}}</p>',intakeSchema:[],signingPageConfig:{requireEmailVerification:false}};
mock.method(db,'select',()=>({from:(table:any)=>({where:async()=>table===signingSessionsTable?[structuredClone(session)]:table===contractTemplatesTable?[template]:[]})}) as any);
mock.method(db,'transaction',async(run:any)=>run({
  select:()=>({from:()=>({where:()=>({for:async()=>[{...structuredClone(session),...(finalizeDuringSave?{status:'signed'}:{}),...(driftDuringSave?{templateBodyHtmlSnapshot:'CHANGED BY STAFF'}:{})}]})})}),
  update:()=>({set:(value:any)=>({where:async()=>{writes++;session={...session,...value};}})}),
}));
const {default:router}=await import('../src/routes/publicSigning');
async function request(method:'get'|'post',path:string,body?:unknown){
  const route=(router as any).stack.find((layer:any)=>layer.route?.path===path&&layer.route.methods[method]).route;
  const handler=route.stack[route.stack.length-1].handle;
  const response:any={statusCode:200,body:null,headers:{},status(code:number){this.statusCode=code;return this;},json(value:unknown){this.body=value;return this;},setHeader(key:string,value:string){this.headers[key]=value;return this;}};
  await handler({params:{token:'SYNTHETIC_TEST_TOKEN_1234567890'},body,ip:'192.0.2.47',headers:{}},response,()=>{throw new Error('UNEXPECTED_NEXT');});
  return response;
}
beforeEach(()=>{writes=0;finalizeDuringSave=false;driftDuringSave=false;session={id:100,templateId:50,mode:'self_fill',status:'review_pending',expiresAt:new Date(Date.now()+60000),openedAt:new Date(),
  signerEmail:'test@example.invalid',expectedEmail:'test@example.invalid',signerName:'TEST',verifiedEmail:'test@example.invalid',agentId:null,
  templateBodyHtmlSnapshot:template.bodyHtml,templateIntakeSchemaSnapshot:[],templateSigningPageConfigSnapshot:{requireEmailVerification:false},
  intakeData:{companyName:'TEST',phone:'+12025550111',agentApplicationContractHash:'SERVER HASH'}};});
after(async()=>{await pool.end();mock.restoreAll();});
test('actual unsigned session GET exposes missing WhatsApp and required tel input without using phone',async()=>{
  const response=await request('get','/public/sign/:token');assert.equal(response.statusCode,200);
  assert.deepEqual(response.body.data.missingIntakeFields,['whatsapp_phone']);assert.equal(response.body.data.template.intakeSchema[0].type,'tel');
  assert.equal(response.body.data.intakeData.whatsapp_phone,undefined);assert.equal(writes,0);
});
test('actual intake route rejects missing required field with no write',async()=>{
  const response=await request('post','/public/sign/:token/intake',{intake:{signerEmail:'test@example.invalid',phone:'+12025550111'}});
  assert.equal(response.statusCode,422);assert.equal(response.body.code,'CONTRACT_INTAKE_REQUIRED');assert.equal(writes,0);
});
test('actual intake route stores explicit WhatsApp while preserving omitted or spoofed server application hash',async()=>{
  for(const supplied of [undefined,'ATTACK']){
    const response=await request('post','/public/sign/:token/intake',{intake:{signerEmail:'test@example.invalid',whatsappPhone:'+12025550147',...(supplied?{agentApplicationContractHash:supplied}:{})}});
    assert.equal(response.statusCode,200);assert.equal(session.intakeData.whatsapp_phone,'+12025550147');assert.equal(session.intakeData.agentApplicationContractHash,'SERVER HASH');
    assert.equal(response.body.intakeData.agentApplicationContractHash,'SERVER HASH');
  }
});
test('actual intake route never reopens a session finalized concurrently',async()=>{
  finalizeDuringSave=true;const response=await request('post','/public/sign/:token/intake',{intake:{signerEmail:'test@example.invalid',whatsapp_phone:'+12025550147'}});
  assert.equal(response.statusCode,409);assert.equal(writes,0);
});
test('actual intake route retains the admin-driven edit prohibition',async()=>{
  session.mode='admin_driven';const response=await request('post','/public/sign/:token/intake',{intake:{whatsapp_phone:'+12025550147'}});
  assert.equal(response.statusCode,400);assert.equal(writes,0);
});
test('actual intake route rejects concurrent frozen-template changes instead of saving stale form input',async()=>{
  driftDuringSave=true;const response=await request('post','/public/sign/:token/intake',{intake:{signerEmail:'test@example.invalid',whatsapp_phone:'+12025550147'}});
  assert.equal(response.statusCode,409);assert.equal(writes,0);
});
