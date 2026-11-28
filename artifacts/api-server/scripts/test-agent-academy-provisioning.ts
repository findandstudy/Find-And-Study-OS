import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveAgentFeatures} from '../src/lib/agentFeatures';
test('academy belongs to eligible agent plans and explicit disabling wins',()=>{for(const plan of ['standard','premium','enterprise']){assert.equal(resolveAgentFeatures(plan,{}).academy,true);assert.equal(resolveAgentFeatures(plan,{academy:false}).academy,false);}});
test('all login-provisioning paths initialize Academy in the existing transaction',()=>{const agents=readFileSync(new URL('../src/routes/agents.ts',import.meta.url),'utf8');assert.equal([...agents.matchAll(/await syncAgentAcademyPermission\(tx,created\)/g)].length,2);assert.doesNotMatch(agents,/await syncAgentAcademyPermission\(agent\)/);const applications=readFileSync(new URL('../src/routes/agentApplications.ts',import.meta.url),'utf8');assert.match(applications,/await syncAgentAcademyPermission\(tx,activatedAgent\)/);});
