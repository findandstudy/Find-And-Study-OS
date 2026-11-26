import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contractTemplateVariables, normalizeContractSigningIntake, contractSigningIntakeRequirements,
  missingContractTemplateFields, mergeContractSigningIntake } from '../src/lib/contractSigningFields';

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
