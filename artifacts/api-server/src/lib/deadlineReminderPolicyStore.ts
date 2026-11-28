import { pool } from "@workspace/db";
import type { PoolClient } from "pg";
import { normalizeReminderDays, policyVersion } from "./deadlineReminderPolicy";

export async function readDeadlinePolicy(universityId?:number, client:Pick<PoolClient,"query">=pool) {
  if(universityId!=null&&!(await client.query('SELECT id FROM universities WHERE id=$1',[universityId])).rowCount)throw new DeadlinePolicyError(404,'UNIVERSITY_NOT_FOUND');
  const key=universityId==null?'SYSTEM':`UNIVERSITY:${universityId}`;
  const {rows}=await client.query('SELECT scope_key, days_before, revision FROM application_deadline_reminder_policies WHERE scope_key = ANY($1::text[])',['SYSTEM'===key?['SYSTEM']:['SYSTEM',key]]);
  const global=rows.find(r=>r.scope_key==='SYSTEM');
  if(!global)throw new Error('DEADLINE_POLICY_NOT_INITIALIZED');
  const own=universityId==null?global:rows.find(r=>r.scope_key===key);
  const globalDays=normalizeReminderDays(global.days_before);
  const effectiveDays=own?normalizeReminderDays(own.days_before):globalDays;
  return {mode:universityId==null?'SYSTEM':own?'CUSTOM':'INHERIT',days:own?effectiveDays:[],globalDays,effectiveDays,version:policyVersion(global.revision,universityId==null?0:own?.revision??0),deliveryEnabled:false};
}
export class DeadlinePolicyError extends Error {constructor(public status:number,message:string){super(message);}}
export async function saveDeadlinePolicy(input:{universityId?:number;mode:unknown;days:unknown;version:unknown;actorId:number}) {
  const {universityId,actorId}=input;
  const global=universityId==null;
  if(!(global?input.mode==='SYSTEM':input.mode==='CUSTOM'||input.mode==='INHERIT'))throw new DeadlinePolicyError(400,'INVALID_REMINDER_MODE');
  const days=input.mode==='INHERIT'?[]:normalizeReminderDays(input.days);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('LOCK TABLE application_deadline_reminder_policies IN SHARE ROW EXCLUSIVE MODE');
    if(!global && !(await client.query('SELECT id FROM universities WHERE id=$1',[universityId])).rowCount)throw new DeadlinePolicyError(404,'UNIVERSITY_NOT_FOUND');
    const before=await readDeadlinePolicy(universityId,client);
    if(typeof input.version!=='string'||input.version!==before.version)throw new DeadlinePolicyError(409,'REMINDER_POLICY_CHANGED');
    if(before.mode===input.mode && JSON.stringify(before.days)===JSON.stringify(days)){await client.query('COMMIT');return before;}
    const key=global?'SYSTEM':`UNIVERSITY:${universityId}`;
    if(input.mode==='INHERIT')await client.query('DELETE FROM application_deadline_reminder_policies WHERE scope_key=$1',[key]);
    else await client.query(`INSERT INTO application_deadline_reminder_policies(scope_key,university_id,days_before,updated_by_id) VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(scope_key) DO UPDATE SET days_before=excluded.days_before,revision=nextval('application_deadline_policy_revision_seq'),updated_by_id=excluded.updated_by_id,updated_at=now()`,[key,universityId??null,JSON.stringify(days),actorId]);
    const cancelled=await client.query(`UPDATE application_deadline_reminder_intents i SET status='CANCELLED',cancelled_at=now(),cancel_reason='REMINDER_POLICY_CHANGED',updated_at=now() FROM university_application_periods p WHERE p.id=i.university_application_period_id AND i.status IN ('PREVIEW_ONLY','PENDING') AND ${global?"NOT EXISTS(SELECT 1 FROM application_deadline_reminder_policies s WHERE s.university_id=p.university_id)":"p.university_id=$1"}`,global?[]:[universityId]);
    const after=await readDeadlinePolicy(universityId,client);
    await client.query('INSERT INTO audit_logs(user_id,action,resource,resource_id,changes) VALUES($1,$2,$3,$4,$5)',[actorId,'update_deadline_reminder_policy',global?'system':'university',universityId??null,JSON.stringify({before:{mode:before.mode,days:before.days},after:{mode:after.mode,days:after.days},cancelled:cancelled.rowCount})]);
    await client.query('COMMIT'); return after;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
