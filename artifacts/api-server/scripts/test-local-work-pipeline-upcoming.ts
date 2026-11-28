import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { workTx, workPipelineTenant } from "../src/lib/workPipelines";
import { mergeUpcomingFollowUps, upcomingWorkFollowUps } from "../src/lib/workPipelineUpcoming";

assert.equal(process.env.WORK_PIPELINES_ENV, undefined);
assert.equal(new URL(process.env.DATABASE_URL!).pathname, "/fasos_apply_local");
assert.ok(workPipelineTenant());
const credentials = JSON.parse(await readFile(new URL("../../../.local-work-pipeline-credentials.json", import.meta.url), "utf8"));
const base = "http://127.0.0.1:8080/api";
async function login(email: string) {
  const init = await fetch(base+"/auth/me");
  const csrf = init.headers.getSetCookie().find(x=>x.startsWith("csrf_token="))!.split(";")[0];
  const response = await fetch(base+"/auth/login", {method:"POST",headers:{"content-type":"application/json",Cookie:csrf,"x-csrf-token":csrf.split("=")[1]},body:JSON.stringify({email,password:credentials.password})});
  assert.equal(response.status,200);
  const sid=response.headers.getSetCookie().find(x=>x.startsWith("sid="))!.split(";")[0];
  return async (url:string,method="GET",body?:unknown,status=200) => {
    const r=await fetch(base+url,{method,headers:{"content-type":"application/json",Cookie:csrf+"; "+sid,"x-csrf-token":csrf.split("=")[1]},...(body?{body:JSON.stringify(body)}:{})});
    assert.equal(r.status,status,url+" HTTP "+r.status);return r.json();
  };
}
const fixtureBoards:string[]=[];
const before=(await pool.query("SELECT count(*)::int AS count, coalesce(sum(id),0)::text AS ids FROM follow_ups")).rows[0];
try {
  const admin=await login("pipeline.admin@example.invalid"),team=await login("pipeline.team@example.invalid"),outside=await login("pipeline.outside@example.invalid");
  const stage={id:randomUUID(),name:"TEST upcoming",color:"#2563eb",result:"open"};
  async function board(memberIds:number[]) {
    const b=await admin("/work-pipelines","POST",{data:{name:"TEST unified upcoming "+randomUUID(),stages:[stage],memberIds,sources:[]}},201);fixtureBoards.push(b.document.id);return b;
  }
  const b=await board([2]);
  const card=await admin(`/work-pipelines/${b.document.id}/cards`,"POST",{data:{title:"TEST dashboard contact",stageId:stage.id,assigneeId:2}},201);
  const path=`/work-pipelines/${b.document.id}/cards/${card.document.id}`;
  let row=card;
  const ids:Record<string,string>={};
  for(const [label,actor,date,assignee] of [
    ["staff-created",team,"2020-01-01T09:00:00Z",2],
    ["admin-created",admin,"2020-01-02T09:00:00Z",2],
    ["not-mine",admin,"2020-01-03T09:00:00Z",1],
    ["future",admin,"2099-01-01T09:00:00Z",2],
    ["completed",admin,"2020-01-04T09:00:00Z",2],
  ] as const) {
    row=await actor(path+"/activity","POST",{revision:row.revision,activity:{action:"followup",title:"TEST "+label,notes:"Synthetic",scheduledAt:date,assigneeId:assignee}});
    ids[label]=row.document.followUps.at(-1).id;
  }
  row=await admin(path+"/activity","POST",{revision:row.revision,activity:{action:"complete",id:ids.completed,completed:true}});
  const all=await admin("/follow-ups/upcoming");
  const contains=(rows:any[],id:string)=>rows.some(x=>x.id==="pipeline:"+id);
  assert.ok(contains(all,ids["staff-created"])&&contains(all,ids["admin-created"])&&contains(all,ids["not-mine"]));
  assert.ok(!contains(all,ids.future)&&!contains(all,ids.completed));
  const filtered=await admin("/follow-ups/upcoming?createdById=2");
  assert.ok(contains(filtered,ids["staff-created"])&&!contains(filtered,ids["admin-created"]));
  const mine=await team("/follow-ups/upcoming");
  assert.ok(contains(mine,ids["staff-created"])&&contains(mine,ids["admin-created"])&&!contains(mine,ids["not-mine"]));
  const denied=await outside("/follow-ups/upcoming");
  assert.ok(!denied.some((x:any)=>x.boardId===b.document.id));
  const projected=all.find((x:any)=>x.id==="pipeline:"+ids["staff-created"]);
  assert.equal(projected.resourceType,"work_pipeline");assert.equal(projected.boardId,b.document.id);assert.equal(projected.cardId,card.document.id);
  assert.equal(projected.createdByName,"Pipeline Team TEST");
  await workTx(async(c,t)=>{await c.query("UPDATE local_work_pipelines.boards SET document=jsonb_set(document,'{archived}','true'::jsonb),revision=revision+1 WHERE tenant_id=$1 AND id=$2",[t,b.document.id]);});
  assert.ok(!(await admin("/follow-ups/upcoming")).some((x:any)=>x.boardId===b.document.id));
  assert.deepEqual(await upcomingWorkFollowUps({id:1,role:"agent"},new Date()),[]);
  assert.deepEqual(mergeUpcomingFollowUps([{id:1,scheduledAt:"2026-02-01"},{id:"pipeline:a",scheduledAt:"2026-01-01"}],1).map(x=>x.id),["pipeline:a"]);
  assert.deepEqual((await pool.query("SELECT count(*)::int AS count, coalesce(sum(id),0)::text AS ids FROM follow_ups")).rows[0],before);
  console.log("PASS: unified upcoming HTTP feed; date/completed/archive, creator filter, staff ownership, board privacy, agent exclusion, links, global sort/limit and no CRM shadow rows");
} finally {
  await workTx(async(c,t)=>{await c.query("UPDATE local_work_pipelines.boards SET document=jsonb_set(document,'{archived}','true'::jsonb),revision=revision+1 WHERE tenant_id=$1 AND id=ANY($2::uuid[])",[t,fixtureBoards]);});
  await pool.end();
}
