import assert from 'node:assert/strict';
import { after, mock, test } from 'node:test';
import net from 'node:net';
import { contractTemplateVariables, normalizeContractSigningIntake, contractSigningIntakeRequirements,
  missingContractTemplateFields, mergeContractSigningIntake } from '../src/lib/contractSigningFields';
process.env.DATABASE_URL='postgres://fixture:fixture@127.0.0.1:1/fas_contract_mail_test_none';
process.env.NODE_ENV='test';process.env.EMAIL_DELIVERY_DISABLED='true';process.env.ALLOW_LIVE_INTEGRATIONS='false';
mock.method(net.Socket.prototype,'connect',()=>{throw new Error('NETWORK_FORBIDDEN');});
mock.method(globalThis,'fetch',()=>{throw new Error('NETWORK_FORBIDDEN');});
const {prepareFrozenContractPdf}=await import('../src/lib/contractSigningPreflight');
const {pool}=await import('@workspace/db');
after(async()=>{await pool.end();mock.restoreAll();});

test('only HTML/CSS comments are ignored; visible content, quoted CSS and attribute variables remain required',()=>{
  const html='<!-- {{html_comment}} --><style>/* {{css_comment}} */ .a{content:"/* {{visible_css}} */"}</style><p style="color:red;/*{{inline_comment}}*/">/* {{visible_body}} */</p><img alt="{{visible_attribute}}">';
  assert.deepEqual(contractTemplateVariables(html),['visible_css','visible_body','visible_attribute']);
  assert.deepEqual(missingContractTemplateFields(html,{}),['visible_css','visible_body','visible_attribute']);
});
test('WhatsApp canonicalization accepts only the explicitly entered WhatsApp answer',()=>{
  const original={phone:'+12025550111',agencyPhone:'+12025550112'};
  assert.equal(normalizeContractSigningIntake(original).whatsapp_phone,undefined);
  assert.equal(normalizeContractSigningIntake({...original,whatsappPhone:' +12025550147 '}).whatsapp_phone,'+12025550147');
  assert.equal(normalizeContractSigningIntake({whatsapp_phone:'',whatsappPhone:'+12025550147'}).whatsapp_phone,'');
  assert.deepEqual(original,{phone:'+12025550111',agencyPhone:'+12025550112'});
});
test('review-pending agency session gets one required WhatsApp input even if its stored schema omitted it',()=>{
  const source={bodyHtml:'<p>{{whatsapp_phone}}</p>',intakeSchema:[],intakeData:{phone:'+12025550111'},language:'tr'};
  const result=contractSigningIntakeRequirements(source);
  assert.deepEqual(result.missingFields,['whatsapp_phone']);assert.equal(result.fields[0].label,'WhatsApp numarası');
  assert.equal(result.fields[0].type,'tel');assert.equal(result.fields[0].required,true);
  assert.deepEqual(source.intakeSchema,[]);
});
test('existing WhatsApp field and other required template fields are reused and enforced',()=>{
  const input={bodyHtml:'<p>{{whatsapp_phone}}</p>',intakeSchema:[{key:'whatsappPhone',label:'WhatsApp',type:'tel'},{key:'taxNumber',label:'Tax',type:'text',required:true}],intakeData:{}};
  assert.deepEqual(contractSigningIntakeRequirements(input).missingFields,['whatsapp_phone','taxNumber']);
  const complete=contractSigningIntakeRequirements({...input,intakeData:{whatsappPhone:'+12025550147',taxNumber:'TEST TAX'}});
  assert.equal(complete.fields.length,2);assert.deepEqual(complete.missingFields,[]);
  assert.equal(complete.intake.whatsapp_phone,'+12025550147');
});
test('canonical blank and conflicting aliases have the same precedence in form projection and PDF context',()=>{
  const source={bodyHtml:'<p>{{whatsapp_phone}}</p>',intakeSchema:[{key:'whatsappPhone',label:'WhatsApp',type:'tel'}]};
  const blank=contractSigningIntakeRequirements({...source,intakeData:{whatsapp_phone:'',whatsappPhone:'+12025550147'}});
  assert.deepEqual(blank.missingFields,['whatsapp_phone']);assert.equal(blank.fields[0].key,'whatsapp_phone');
  assert.deepEqual(missingContractTemplateFields(source.bodyHtml,blank.intake),['whatsapp_phone']);
  const conflict=contractSigningIntakeRequirements({...source,intakeData:{whatsapp_phone:'+12025550148',whatsappPhone:'+12025550147'}});
  assert.equal(conflict.intake[conflict.fields[0].key],'+12025550148');assert.deepEqual(conflict.missingFields,[]);
  assert.deepEqual(missingContractTemplateFields(source.bodyHtml,conflict.intake),[]);
});
test('intake save preserves server application hash against omission or substitution',()=>{
  for(const submitted of [{whatsappPhone:'+12025550147'},{whatsappPhone:'+12025550147',agentApplicationContractHash:'ATTACK'}]){
    const result=mergeContractSigningIntake({agentApplicationContractHash:'SERVER HASH'},submitted);
    assert.equal(result.agentApplicationContractHash,'SERVER HASH');assert.equal(result.whatsapp_phone,'+12025550147');
  }
  assert.equal(mergeContractSigningIntake({}, {agentApplicationContractHash:'ATTACK'}).agentApplicationContractHash,undefined);
});
test('missing frozen fields and prototype paths remain denied',()=>{
  assert.deepEqual(missingContractTemplateFields('<p>{{whatsapp_phone}} {{agent.taxNumber}} {{constructor}}</p>',{phone:'TEST'}),['whatsapp_phone','agent.taxNumber','constructor']);
});

const companyFields=[
  {key:'agencyName',label:'Agency name',type:'text',required:true},
  {key:'contactPersonName',label:'Contact person name',type:'text',required:true},
  {key:'agencyEmail',label:'Agency email',type:'email',required:true},
  {key:'whatsappPhone',label:'WhatsApp',type:'text',required:true},
  {key:'country',label:'Country',type:'text',required:true},
  {key:'year',label:'Year',type:'text',required:true},
];
const companyBody='<style>/* PDF renderer supports {{...}} and {{comment_only}} */.card{color:#123456}</style>'
  +'<section class="card"><p>{{agency_name}}</p><p>{{contact_person_name}}</p><p>{{agency_email}}</p><p>{{whatsapp_phone}}</p>'
  +'<p>{{country}} {{year}} {{contract_number}} {{sign_date}}</p><img src="{{main_agency_signature}}"><img src="{{signature}}"></section>';
function companyPdf(intake:Record<string,unknown>){
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  return prepareFrozenContractPdf({contract:{id:1,signing_session_id:2,template_id:3,pdf_object_key:null,evidence_hash:null,
    signature_image_base64:png,signed_at:'2026-11-26T12:00:00Z',email_verified_at:'2026-11-26T11:00:00Z',email_verification_required:true,
    email_verification_method:'one_time_code',signer_email:'test@example.invalid',signer_name:'TEST'},session:{id:2,template_id:3,status:'signed',revoked_at:null,
    signed_at:'2026-11-26T12:00:00Z',template_version_snapshot:7,template_name_snapshot:'TEST Full Company',template_language_snapshot:'en',
    template_body_html_snapshot:companyBody,template_intake_schema_snapshot:companyFields,intake_data:intake,
    template_signing_page_config_snapshot:{companySignatureDataUrl:`data:image/png;base64,${png}`}}});
}
test('complete six-field company schema renders every canonical field from explicit form answers',()=>{
  const answers={agencyName:'TEST NEW AGENCY',contactPersonName:'TEST NEW CONTACT',agencyEmail:'new@example.invalid',whatsappPhone:'+12025550147',country:'TEST COUNTRY',year:'2026'};
  const projection=contractSigningIntakeRequirements({bodyHtml:companyBody,intakeSchema:companyFields,intakeData:answers});
  assert.deepEqual(projection.fields.map(field=>field.key),['agency_name','contact_person_name','agency_email','whatsapp_phone','country','year']);
  assert.deepEqual(projection.missingFields,[]);
  const rendered=companyPdf(answers).bodyHtml;
  for(const value of Object.values(answers))assert.ok(rendered.includes(value));
  assert.ok(rendered.includes('FAS-2026-00002'));assert.ok(rendered.includes('2026-11-26'));assert.match(rendered,/#123456/);
});
test('all four canonical values have consistent blank/conflicting alias precedence in form and PDF',()=>{
  const aliases=[['agencyName','agency_name'],['contactPersonName','contact_person_name'],['agencyEmail','agency_email'],['whatsappPhone','whatsapp_phone']] as const;
  const base={agencyName:'TEST AGENCY',contactPersonName:'TEST CONTACT',agencyEmail:'test@example.invalid',whatsappPhone:'+12025550147',country:'TEST COUNTRY',year:'2026'};
  for(const [alias,canonical] of aliases){
    const blank={...base,[canonical]:''};
    const projection=contractSigningIntakeRequirements({bodyHtml:companyBody,intakeSchema:companyFields,intakeData:blank});
    assert.ok(projection.missingFields.includes(canonical));assert.equal(projection.intake[canonical],'');
    assert.throws(()=>companyPdf(blank),/CONTRACT_FROZEN_FIELD_MISSING/);
    const edited={...base,[alias]:'STALE ALIAS VALUE',[canonical]:'EXPLICIT NEW CANONICAL'};
    const corrected=contractSigningIntakeRequirements({bodyHtml:companyBody,intakeSchema:companyFields,intakeData:edited});
    assert.deepEqual(corrected.missingFields,[]);
    const rendered=companyPdf(edited).bodyHtml;assert.match(rendered,/EXPLICIT NEW CANONICAL/);assert.doesNotMatch(rendered,/STALE ALIAS VALUE/);
  }
});
test('editing the projected canonical fields is the value saved and rendered, with original relation hash retained',()=>{
  const answers={agencyName:'OLD AGENCY',contactPersonName:'OLD CONTACT',agencyEmail:'old@example.invalid',whatsappPhone:'+12025550111',country:'TEST COUNTRY',year:'2026'};
  const projection=contractSigningIntakeRequirements({bodyHtml:companyBody,intakeSchema:companyFields,intakeData:answers});
  const submitted={...projection.intake,agency_name:'EDITED AGENCY',contact_person_name:'EDITED CONTACT',agency_email:'edited@example.invalid',whatsapp_phone:'+12025550147'} as Record<string,string>;
  const saved=mergeContractSigningIntake({agentApplicationContractHash:'SERVER HASH'},submitted);
  const rendered=companyPdf(saved).bodyHtml;
  for(const value of ['EDITED AGENCY','EDITED CONTACT','edited@example.invalid','+12025550147'])assert.ok(rendered.includes(value));
  for(const value of ['OLD AGENCY','OLD CONTACT','old@example.invalid','+12025550111'])assert.ok(!rendered.includes(value));
  assert.equal(saved.agentApplicationContractHash,'SERVER HASH');
});
