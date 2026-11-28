import { Router } from "express";
import { requireAuth, requireRole } from "../lib/auth";
import { MANAGER_ROLES } from "../lib/roles";
import { readDeadlinePolicy,saveDeadlinePolicy,DeadlinePolicyError } from "../lib/deadlineReminderPolicyStore";
const router=Router();
for(const path of ['/application-deadline-reminders/settings','/universities/:id/deadline-reminder-settings']) {
  const scope=(req:any)=>{if(req.params.id===undefined)return undefined;const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)throw new DeadlinePolicyError(400,'INVALID_UNIVERSITY_ID');return id;};
  router.get(path,requireAuth,requireRole(...MANAGER_ROLES),async(req,res)=>{try{res.json(await readDeadlinePolicy(scope(req)));}catch(e){const error=e as Error;res.status(e instanceof DeadlinePolicyError?e.status:500).json({code:e instanceof DeadlinePolicyError||error.message==='INVALID_REMINDER_DAYS'?error.message:'REMINDER_SETTINGS_UNAVAILABLE'});}});
  router.put(path,requireAuth,requireRole(...MANAGER_ROLES),async(req,res)=>{try{res.json(await saveDeadlinePolicy({...req.body,universityId:scope(req),actorId:req.user!.id}));}catch(e){const error=e as Error;res.status(e instanceof DeadlinePolicyError?e.status:error.message==='INVALID_REMINDER_DAYS'?400:500).json({code:error.message});}});
}
export default router;
