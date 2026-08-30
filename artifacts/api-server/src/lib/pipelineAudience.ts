import { and, eq } from "drizzle-orm";
import { db, DEFAULT_STAGE_AUDIENCE_ROLES, pipelineStagesTable, type StageAudienceRole } from "@workspace/db";

const ALLOWED = new Set<StageAudienceRole>(DEFAULT_STAGE_AUDIENCE_ROLES);

export function audienceRoleForUserRole(role: string): StageAudienceRole | null {
  if (role === "super_admin") return "super_admin";
  if (role === "admin" || role === "manager") return "admin";
  if (["staff", "consultant", "editor", "accountant"].includes(role)) return "staff";
  if (role === "agent") return "agent";
  if (role === "sub_agent") return "sub_agent";
  if (role === "agent_staff") return "agent_staff";
  return null;
}

export function normalizeStageAudienceRoles(value: unknown): StageAudienceRole[] {
  if (!Array.isArray(value)) return [...DEFAULT_STAGE_AUDIENCE_ROLES];
  return Array.from(new Set(value.filter((role): role is StageAudienceRole => (
    typeof role === "string" && ALLOWED.has(role as StageAudienceRole)
  ))));
}

export function stageAudienceAllows(value: unknown, userRole: string): boolean {
  const audienceRole = audienceRoleForUserRole(userRole);
  if (!audienceRole) return false;
  return normalizeStageAudienceRoles(value).includes(audienceRole);
}

export async function canTransitionToPipelineStage(
  entityType: "lead" | "student" | "application",
  stageKey: string,
  userRole: string,
): Promise<boolean> {
  const [stage] = await db.select({ roles: pipelineStagesTable.transitionAllowedRoles })
    .from(pipelineStagesTable)
    .where(and(
      eq(pipelineStagesTable.entityType, entityType),
      eq(pipelineStagesTable.key, stageKey),
    ));
  return !!stage && stageAudienceAllows(stage.roles, userRole);
}
