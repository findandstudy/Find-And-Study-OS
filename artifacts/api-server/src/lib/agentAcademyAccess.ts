import { sql, type SQL } from 'drizzle-orm';
import { resolveAgentFeatures } from './agentFeatures';

type AcademyAgent = {userId:number|null;status:string;accessTier:string;planTier:string;featureOverrides:unknown};
type Executor = {execute:(statement:SQL)=>Promise<unknown>};
/** Called inside the same transaction as provisioning/activation or an explicit
 * administrator entitlement edit. Initial provisioning never overrides a saved
 * per-user grant or denial, never changes role packages and never grants staff. */
export async function syncAgentAcademyPermission(executor:Executor,agent:AcademyAgent,mode:'initialize'|'replace'='initialize') {
 if(!agent.userId)return;
 if(mode==='initialize'&&(agent.status!=='active'||agent.accessTier!=='full'))return;
 const enabled=resolveAgentFeatures(agent.planTier,agent.featureOverrides).academy;
 await executor.execute(sql`UPDATE users SET permission_overrides=coalesce(permission_overrides,'{}'::jsonb) || ${JSON.stringify({'academy.access':enabled})}::jsonb
 WHERE id=${agent.userId} AND role IN ('agent','sub_agent')
 AND jsonb_typeof(coalesce(permission_overrides,'{}'::jsonb))='object'
 AND (${mode==='replace'} OR NOT (coalesce(permission_overrides,'{}'::jsonb) ? 'academy.access'))`);
}
