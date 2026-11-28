import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {db,pool,usersTable,agentsTable} from '@workspace/db';
import {eq} from 'drizzle-orm';
import {syncAgentAcademyPermission} from '../src/lib/agentAcademyAccess';
import {getEffectivePermissionSet} from '../src/lib/permissions';
assert.equal(process.env.ALLOW_LOCAL_ACADEMY_TEST,'true');
const target=new URL(process.env.DATABASE_URL!);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'5433');assert.equal(target.pathname,'/fasos_apply_local');
const users:number[]=[],agents:number[]=[];let cases=0;
async function fixture(role='agent',permissionOverrides:Record<string,boolean>={}){const [u]=await db.insert(usersTable).values({email:`academy-${randomUUID()}@example.invalid`,firstName:'TEST',lastName:'Academy',role,isActive:true,emailVerified:true,permissionOverrides}).returning();users.push(u.id);const[a]=await db.insert(agentsTable).values({userId:u.id,firstName:'TEST',lastName:'Academy',status:'active',accessTier:'full',planTier:'standard'}).returning();agents.push(a.id);return a;}
const raw=async(id:number)=>(await db.select().from(usersTable).where(eq(usersTable.id,id)))[0].permissionOverrides as Record<string,boolean>;
try{
 for(const role of ['agent','sub_agent']){const a=await fixture(role);await db.transaction(tx=>syncAgentAcademyPermission(tx,a));assert.equal((await raw(a.userId!))['academy.access'],true);assert.ok((await getEffectivePermissionSet({id:a.userId!,role})).has('academy.access'));cases++;}
 const provisional=await fixture();await db.update(agentsTable).set({status:'provisional',accessTier:'provisional'}).where(eq(agentsTable.id,provisional.id));await db.transaction(tx=>syncAgentAcademyPermission(tx,{...provisional,status:'provisional',accessTier:'provisional'}));assert.equal((await raw(provisional.userId!))['academy.access'],undefined);await db.transaction(async tx=>{const[a]=await tx.update(agentsTable).set({status:'active',accessTier:'full'}).where(eq(agentsTable.id,provisional.id)).returning();await syncAgentAcademyPermission(tx,a);});assert.equal((await raw(provisional.userId!))['academy.access'],true);cases++;
 const denied=await fixture('agent',{'academy.access':false,'students.view':false});await db.transaction(tx=>syncAgentAcademyPermission(tx,denied));assert.deepEqual(await raw(denied.userId!),{'academy.access':false,'students.view':false});cases++;
 const disabled=await fixture();await db.transaction(tx=>syncAgentAcademyPermission(tx,{...disabled,featureOverrides:{academy:false}}));assert.equal((await raw(disabled.userId!))['academy.access'],false);cases++;
 const staff=await fixture('agent_staff');await db.transaction(tx=>syncAgentAcademyPermission(tx,staff));assert.equal((await raw(staff.userId!))['academy.access'],undefined);cases++;
 await db.transaction(tx=>syncAgentAcademyPermission(tx,{...denied,featureOverrides:{academy:true}},'replace'));assert.equal((await raw(denied.userId!))['academy.access'],true);assert.equal((await raw(denied.userId!))['students.view'],false);cases++;
 const rollback=await fixture();await assert.rejects(()=>db.transaction(async tx=>{await syncAgentAcademyPermission(tx,rollback);throw Error('INJECTED_ROLLBACK');}),/INJECTED_ROLLBACK/);assert.equal((await raw(rollback.userId!))['academy.access'],undefined);cases++;
 await db.transaction(tx=>syncAgentAcademyPermission(tx,provisional));assert.equal((await raw(provisional.userId!))['academy.access'],true);cases++;
 const noLogin={...provisional,userId:null};await db.transaction(tx=>syncAgentAcademyPermission(tx,noLogin));cases++;
 process.env.ALLOW_LIVE_INTEGRATIONS='false';process.env.EMAIL_DELIVERY_DISABLED='true';
 const {default:express}=await import('express');const{default:auth}=await import('../src/routes/auth');const{default:bcrypt}=await import('bcryptjs');
 const password='Synthetic-Academy-Only!2026';await db.update(usersTable).set({passwordHash:await bcrypt.hash(password,4)}).where(eq(usersTable.id,users[0]));
 const app=express();app.use(express.json());app.use((req:any,_res,next)=>{req.cookies={};next();});app.use('/api',auth);const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 try{const [loginUser]=await db.select().from(usersTable).where(eq(usersTable.id,users[0]));const response=await fetch('http://127.0.0.1:'+(server.address() as any).port+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:loginUser.email,password})});assert.equal(response.status,200);const data=await response.json();assert.ok(data.user.permissions.includes('academy.access'));cases++;}finally{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));}
 console.log(`PASS ${cases}: first agent/sub-agent access, activation, explicit denial, disabled plan, staff isolation, explicit admin edit, rollback, idempotency, no-login skip`);
}finally{for(const id of agents)await db.delete(agentsTable).where(eq(agentsTable.id,id));for(const id of users)await db.delete(usersTable).where(eq(usersTable.id,id));await pool.end();}
