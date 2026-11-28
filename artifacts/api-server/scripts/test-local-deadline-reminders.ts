import assert from 'node:assert/strict';
import {pool} from '@workspace/db';
import {readDeadlinePolicy,saveDeadlinePolicy} from '../src/lib/deadlineReminderPolicyStore';
assert.equal(process.env.ALLOW_LOCAL_DEADLINE_TEST,'true');
const target=new URL(process.env.DATABASE_URL!);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'5433');assert.equal(target.pathname,'/fasos_apply_local');
const ids:number[]=[];let original:any;const actor=(await pool.query("select id from users where email='pipeline.admin@example.invalid'")).rows[0]?.id;assert.ok(actor);
try{
 original=await readDeadlinePolicy();
 for(let i=0;i<2;i++)ids.push((await pool.query("insert into universities(name,country) values($1,'TEST') returning id",['TEST deadline policy '+i])).rows[0].id);
 const periods:number[]=[];
 for(const id of ids)periods.push((await pool.query(`insert into university_application_periods(university_id,term_name,academic_year,source_timezone,source_url,verified_at,applications_open_at,application_deadline_at) values($1,'TEST',2027,'Europe/Warsaw','https://example.invalid',now(),'2026-09-01','2027-03-11') returning id`,[id])).rows[0].id);
 async function save(universityId:number|undefined,mode:string,days:number[]){const before=await readDeadlinePolicy(universityId);return saveDeadlinePolicy({universityId,mode,days,version:before.version,actorId:actor});}
 await save(undefined,'SYSTEM',[45,14,0]);assert.deepEqual((await readDeadlinePolicy(ids[0])).effectiveDays,[45,14,0]);
 await save(ids[1],'CUSTOM',[2]);await save(undefined,'SYSTEM',[10,0]);assert.deepEqual((await readDeadlinePolicy(ids[0])).effectiveDays,[10,0]);assert.deepEqual((await readDeadlinePolicy(ids[1])).effectiveDays,[2]);
 await save(ids[1],'CUSTOM',[]);assert.deepEqual((await readDeadlinePolicy(ids[1])).effectiveDays,[]);await save(ids[1],'INHERIT',[]);assert.deepEqual((await readDeadlinePolicy(ids[1])).effectiveDays,[10,0]);
 const stale=await readDeadlinePolicy(ids[0]);const results=await Promise.allSettled([1,2].map(day=>saveDeadlinePolicy({universityId:ids[0],mode:'CUSTOM',days:[day],version:stale.version,actorId:actor})));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.status===409).length,1);
 const beforeReset=await readDeadlinePolicy(ids[0]);await save(ids[0],'INHERIT',[]);await save(ids[0],'CUSTOM',[8]);await assert.rejects(()=>saveDeadlinePolicy({universityId:ids[0],mode:'CUSTOM',days:[9],version:beforeReset.version,actorId:actor}),/REMINDER_POLICY_CHANGED/);
 const insertIntent=async(period:number,status:string,day:number)=>pool.query(`insert into application_deadline_reminder_intents(university_application_period_id,subject_type,subject_id,channel,days_before,schedule_fingerprint,status,reason_code) values($1,'LEAD',1,'EMAIL',$2,$3,$4,'TEST') returning id`,[period,day,('a'+day).padEnd(64,'0'),status]);
 const inheritedPending=await insertIntent(periods[1],'PENDING',1),customPending=await insertIntent(periods[0],'PENDING',1),sent=await insertIntent(periods[1],'SENT',2);
 await save(undefined,'SYSTEM',[6]);const status=async(id:number)=>(await pool.query('select status from application_deadline_reminder_intents where id=$1',[id])).rows[0].status;
 assert.equal(await status(inheritedPending.rows[0].id),'CANCELLED');assert.equal(await status(customPending.rows[0].id),'PENDING');assert.equal(await status(sent.rows[0].id),'SENT');
 await save(ids[0],'CUSTOM',[5]);assert.equal(await status(customPending.rows[0].id),'CANCELLED');
 const validProgram=(await pool.query("insert into programs(university_id,name,application_deadline_override_at) values($1,'TEST calendar','2027-03-05') returning id",[ids[0]])).rows[0].id;
 await pool.query('delete from programs where id=$1',[validProgram]);
 await assert.rejects(()=>pool.query("insert into programs(university_id,name,application_deadline_override_at) values($1,'TEST bad calendar','2026-01-01')",[ids[0]]),/PROGRAM_CALENDAR_DATE_CONFLICT/);
 await assert.rejects(()=>pool.query("insert into programs(university_id,name,university_application_period_id) values($1,'TEST cross school',$2)",[ids[0],periods[1]]),/INVALID_PROGRAM_CALENDAR_PERIOD/);
 const inactive=await insertIntent(periods[0],'PENDING',77);await pool.query('update university_application_periods set is_active=false where id=$1',[periods[0]]);assert.equal(await status(inactive.rows[0].id),'CANCELLED');
 await assert.rejects(()=>pool.query("insert into application_deadline_reminder_policies(scope_key,university_id,days_before) values($1,$2,'[1.5]'::jsonb)",[`UNIVERSITY:${ids[1]}`,ids[1]]));
 assert.ok((await pool.query("select count(*)::int n from audit_logs where action='update_deadline_reminder_policy' and resource_id=ANY($1::int[])",[ids])).rows[0].n>0);
 const {default:express}=await import('express');const {default:router}=await import('../src/routes/deadlineReminders');
 const app=express();app.use(express.json());app.use((req:any,_res,next)=>{const role=req.headers['x-test-role'];if(role)req.user={id:actor,role,isActive:true};next();});app.use('/api',router);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base='http://127.0.0.1:'+(server.address() as any).port+'/api';
 try{
 const get=async(path:string,role?:string)=>fetch(base+path,{headers:role?{'x-test-role':role}:{}});
 assert.equal((await get('/application-deadline-reminders/settings')).status,401);
 assert.equal((await get('/application-deadline-reminders/settings','agent')).status,403);
 assert.equal((await get('/application-deadline-reminders/settings','admin')).status,200);
 assert.equal((await get('/universities/999999999/deadline-reminder-settings','admin')).status,404);
 const update=await fetch(base+'/application-deadline-reminders/settings',{method:'PUT',headers:{'x-test-role':'admin','content-type':'application/json'},body:JSON.stringify({mode:'SYSTEM',days:[1.2],version:(await readDeadlinePolicy()).version})});assert.equal(update.status,400);
 }finally{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));}
 console.log('PASS: inheritance, override, disable, reset, concurrency, ABA, cancellation, sent immutability, inactive calendar, DB validation, audit');
}finally{
 if(original){const p=await readDeadlinePolicy();await saveDeadlinePolicy({mode:'SYSTEM',days:original.days,version:p.version,actorId:actor});}
 if(ids.length){await pool.query("delete from audit_logs where action='update_deadline_reminder_policy' and resource_id=ANY($1::int[])",[ids]);await pool.query('delete from universities where id=ANY($1::int[])',[ids]);}
 await pool.end();
}
