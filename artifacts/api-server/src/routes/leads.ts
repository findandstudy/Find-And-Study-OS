import { Router, type IRouter } from "express";
import { db, leadsTable, studentsTable, notesTable, usersTable, followUpsTable, agentsTable, documentsTable, embedSubmissionsTable, embedWidgetsTable, applicationsTable, programsTable, universitiesTable, pipelineStagesTable, settingsTable, softDelete, externalContactsTable } from "@workspace/db";
import { eq, ilike, or, sql, and, lte, gte, asc, desc, inArray, isNull, isNotNull, ne } from "drizzle-orm";
import { requireAuth, requireRole, requireAgentStaffPermission, logAudit } from "../lib/auth";
import { publicLeadLimiter } from "../lib/limiters";
import { STAFF_ROLES, ADMIN_ROLES, AGENT_ROLES, isAgentRole } from "../lib/roles";
import { getAgentVisibleIds, getAgentRecord } from "../lib/agentVisibility";
import { isAgentSourcedAndBlockedForStaff } from "../lib/rbac/agentSourceScope";
import { assertCanAccessStudent } from "../lib/studentAccess";
import { getEffectivePermissionSet, canAccessAssignedRecord, userHasPermission } from "../lib/permissions";
import { getVisibleBranchIds, resolveCreateBranchId, isInBranchScope } from "../lib/branchScope";
import { normalizeAndValidateNames, normalizePhoneField, toLatinUpper } from "../lib/textNormalize";
import { dispatchNotification } from "../lib/notificationDispatcher";
import { inferOriginFromUser, inferOriginFromAgentId, directOrigin, type OriginMeta } from "../lib/originHelper";
import { toE164 } from "../lib/inbox/phone";
import { getCurrentSeason } from "../lib/season";
import { enqueueOnStageChange } from "../lib/portalAutoTrigger.js";
import { applyLeadAssignmentRules, cascadeLeadAssignment } from "../lib/leadAssignment";
import { findOrUpsertPublicLead } from "../lib/leadDedup";
import { recomputeStudentPhoto } from "../lib/studentPhoto";
import { parsePaginationParams, buildPageMeta } from "@workspace/pagination";
import { validateUploadedFile, validateUploadedFileBuffer, sanitizeFileName, isPdf } from "../lib/fileUploadValidation";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { buildDocNameFromParts } from "../lib/docNaming";
import { callerOwnsObject } from "../lib/objectAuthz";

const router: IRouter = Router();

const leadDocsObjectStorage = new ObjectStorageService();

const LEAD_PATCH_FIELDS = [
  "firstName", "lastName", "email", "phone", "nationality",
  "interestedProgram", "interestedUniversity", "interestedCountry", "source",
  "status", "assignedTo", "notes", "estimatedValue", "season", "agentId",
];

router.get("/leads/distinct-sources", requireAuth, requireRole(...STAFF_ROLES), async (_req, res): Promise<void> => {
  const [leadRows, widgetRows] = await Promise.all([
    db
      .selectDistinct({ source: leadsTable.source })
      .from(leadsTable)
      .where(sql`${leadsTable.source} IS NOT NULL AND ${leadsTable.source} != ''`),
    db
      .select({ slug: embedWidgetsTable.slug, name: embedWidgetsTable.name, mode: embedWidgetsTable.mode })
      .from(embedWidgetsTable),
  ]);
  type SourceItem = { value: string; label: string; kind: "lead_form" | "embed" | "other" };
  const byValue = new Map<string, SourceItem>();
  for (const w of widgetRows) {
    if (!w.slug) continue;
    const value = `embed:${w.slug}`;
    const isLeadForm = w.mode === "lead_form";
    const prefix = isLeadForm ? "Web Form" : "Embed";
    byValue.set(value, {
      value,
      label: `${prefix}: ${w.name || w.slug}`,
      kind: isLeadForm ? "lead_form" : "embed",
    });
  }
  for (const r of leadRows) {
    const v = r.source;
    if (!v || byValue.has(v)) continue;
    byValue.set(v, { value: v, label: v, kind: "other" });
  }
  const order: Record<SourceItem["kind"], number> = { lead_form: 0, embed: 1, other: 2 };
  const data = [...byValue.values()].sort((a, b) => {
    const k = order[a.kind] - order[b.kind];
    return k !== 0 ? k : a.label.localeCompare(b.label, "tr");
  });
  res.json({ data });
});

router.get("/leads/distinct-cities", requireAuth, requireRole(...STAFF_ROLES), async (_req, res): Promise<void> => {
  const ur = await db
    .selectDistinct({ v: universitiesTable.city })
    .from(universitiesTable)
    .where(sql`${universitiesTable.city} IS NOT NULL AND ${universitiesTable.city} != ''`);
  const all = new Set<string>(ur.map(r => r.v!).filter(Boolean));
  res.json({ data: [...all].sort() });
});

router.get("/nationalities", requireAuth, requireRole(...STAFF_ROLES), async (_req, res): Promise<void> => {
  const leadNats = db
    .selectDistinct({ nationality: leadsTable.nationality })
    .from(leadsTable)
    .where(sql`${leadsTable.nationality} IS NOT NULL AND ${leadsTable.nationality} != ''`);
  const studentNats = db
    .selectDistinct({ nationality: studentsTable.nationality })
    .from(studentsTable)
    .where(sql`${studentsTable.nationality} IS NOT NULL AND ${studentsTable.nationality} != ''`);
  const [lr, sr] = await Promise.all([leadNats, studentNats]);
  const all = new Set([...lr.map(r => r.nationality!), ...sr.map(r => r.nationality!)]);
  res.json([...all].sort());
});

router.post("/public/lead", publicLeadLimiter, async (req, res): Promise<void> => {
  const { firstName, lastName, email, phone, nationality, interestedProgram, interestedUniversity, interestedCountry, message, sourcePageUrl, utmSource, utmMedium, utmCampaign, utmTerm, utmContent, source: bodySource } = req.body;
  if (!firstName || !lastName || !email || !phone) {
    res.status(400).json({ error: "firstName, lastName, email, and phone are required" });
    return;
  }
  const { error: nameErr, normalized: normLead } = normalizeAndValidateNames({ firstName, lastName }, ["firstName", "lastName"]);
  if (nameErr) { res.status(400).json({ error: nameErr }); return; }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    res.status(400).json({ error: "Invalid email address" });
    return;
  }
  const origin = directOrigin();
  const phoneStr = phone ? normalizePhoneField(phone).slice(0, 30) : null;
  // Guard against cross-channel lead overwrite via untrusted body.source.
  // /public/lead now dedupes by (lower(email), source); accepting reserved
  // channel strings would let an unauthenticated caller update leads
  // belonging to embed widgets, agent web forms, or website builder forms.
  const rawSource = bodySource ? String(bodySource).slice(0, 100) : "website";
  const lcSource = rawSource.toLowerCase().trim();
  const isReservedSource =
    lcSource === "web_form" ||
    lcSource.startsWith("embed:") ||
    lcSource.startsWith("website-form:");
  const resolvedSource = isReservedSource ? "website" : rawSource;
  const { lead, created } = await findOrUpsertPublicLead({
    source: resolvedSource,
    uniqueKey: { kind: "emailSource" },
    fields: {
      firstName: String(normLead.firstName).slice(0, 100),
      lastName: String(normLead.lastName).slice(0, 100),
      email: String(email).slice(0, 255),
      phone: phoneStr,
      phoneE164: toE164(phoneStr),
      nationality: nationality ? String(nationality).slice(0, 100) : null,
      interestedProgram: interestedProgram ? String(interestedProgram).slice(0, 255) : null,
      interestedUniversity: interestedUniversity ? String(interestedUniversity).slice(0, 255) : null,
      interestedCountry: interestedCountry ? String(interestedCountry).slice(0, 100) : null,
      notes: message ? String(message).replace(/<[^>]*>/g, "").slice(0, 400) : null,
      sourcePageUrl: sourcePageUrl ? String(sourcePageUrl).slice(0, 500) : null,
      utmSource: utmSource ? String(utmSource).slice(0, 100) : null,
      utmMedium: utmMedium ? String(utmMedium).slice(0, 100) : null,
      utmCampaign: utmCampaign ? String(utmCampaign).slice(0, 100) : null,
      utmTerm: utmTerm ? String(utmTerm).slice(0, 100) : null,
      utmContent: utmContent ? String(utmContent).slice(0, 100) : null,
    },
    extras: {
      originType: origin.originType,
      originEntityType: origin.originEntityType,
      originEntityId: origin.originEntityId,
      originDisplayName: origin.originDisplayName,
    },
    ip: req.ip,
  });
  // SECURITY (Public Intake): only disclose the numeric lead ID for a lead
  // this request actually created. Returning the ID of an already-existing
  // (deduped) lead would let an unauthenticated caller recover the lead ID
  // for any known email and target it elsewhere. The apply endpoint no
  // longer trusts a client-supplied lead ID (it re-derives by email+source),
  // so suppressing the existing-lead ID here is safe.
  res.status(201).json({ success: true, message: "Inquiry submitted successfully", leadId: created ? lead.id : null });
});

router.post("/public/lead/:token", publicLeadLimiter, async (req, res): Promise<void> => {
  const token = String(req.params.token);
  const [agent] = await db.select({ id: agentsTable.id, status: agentsTable.status })
    .from(agentsTable).where(eq(agentsTable.embedToken, token));
  if (!agent || agent.status !== "active") {
    res.status(404).json({ error: "Invalid or inactive form" });
    return;
  }

  const { firstName, lastName, email, phone } = req.body;
  if (!firstName || !lastName || !email || !phone) {
    res.status(400).json({ error: "firstName, lastName, email, and phone are required" });
    return;
  }
  const { error: nameErr, normalized: normAgentLead } = normalizeAndValidateNames({ firstName, lastName }, ["firstName", "lastName"]);
  if (nameErr) { res.status(400).json({ error: nameErr }); return; }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    res.status(400).json({ error: "Invalid email address" });
    return;
  }

  const origin = await inferOriginFromAgentId(agent.id);

  const phoneStr2 = normalizePhoneField(phone).slice(0, 30);
  await findOrUpsertPublicLead({
    source: "web_form",
    uniqueKey: { kind: "emailSourceAgent", agentId: agent.id },
    fields: {
      firstName: String(normAgentLead.firstName).slice(0, 100),
      lastName: String(normAgentLead.lastName).slice(0, 100),
      email: String(email).slice(0, 255),
      phone: phoneStr2,
      phoneE164: toE164(phoneStr2),
    },
    extras: {
      agentId: agent.id,
      originType: origin.originType,
      originEntityType: origin.originEntityType,
      originEntityId: origin.originEntityId,
      originDisplayName: origin.originDisplayName,
    },
    ip: req.ip,
  });

  const accept = req.headers.accept || "";
  if (accept.includes("application/json")) {
    res.status(201).json({ success: true, message: "Thank you! Your information has been submitted." });
  } else {
    res.status(200).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9fafb}div{text-align:center;padding:40px;border-radius:12px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.1);max-width:400px}h2{color:#059669;margin:0 0 8px}p{color:#6b7280;margin:0}</style></head><body><div><h2>&#10003; Success!</h2><p>Thank you! Your information has been submitted successfully.</p></div></body></html>`);
  }
});

router.get("/leads", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), requireAgentStaffPermission("leads"), async (req, res): Promise<void> => {
  const user = req.user!;
  const { status, search, season, agentId: agentIdFilter, originType: originFilter } = req.query as Record<string, string>;
  const pageParams = parsePaginationParams(req, { defaultLimit: 20, maxLimit: 100000 });
  const pageNum = pageParams.page;
  const limitNum = pageParams.limit;
  const offset = pageParams.offset;

  const conditions = [isNull(leadsTable.deletedAt)];
  if (season) conditions.push(eq(leadsTable.season, season));
  if (status) conditions.push(eq(leadsTable.status, status));
  if (agentIdFilter) conditions.push(eq(leadsTable.agentId, parseInt(agentIdFilter, 10)));
  if (originFilter && ["direct", "agent", "sub_agent"].includes(originFilter)) {
    conditions.push(eq(leadsTable.originType, originFilter));
  }

  // KURAL 1: non-admin staff cannot see agent-sourced leads
  // unless they have records.view_others (Task #494)
  if (!isAgentRole(user.role) && !(ADMIN_ROLES as readonly string[]).includes(user.role)) {
    const listPerms = await getEffectivePermissionSet({ id: user.id, role: user.role });
    if (!listPerms.has("records.view_others")) {
      conditions.push(isNull(leadsTable.agentId));
    }
  }
  if (isAgentRole(user.role)) {
    const visibleIds = await getAgentVisibleIds(user.id, user.role);
    if (visibleIds.length === 0) {
      res.json({ data: [], meta: { total: 0, page: pageNum, limit: limitNum, totalPages: 0 } });
      return;
    }
    conditions.push(inArray(leadsTable.agentId, visibleIds));
  }
  // Branch scoping (super_admin: null = all). Applies to staff AND agents.
  // We include null-branch records: public-form leads (POST /public/lead,
  // embed widgets, course-finder apply popup step 1) are created without a
  // branch, so excluding nulls would hide every web inbox lead from
  // branch-scoped staff. Treat null-branch as "global / unassigned to a
  // branch — visible to any branch's staff so they can pick it up".
  const visibleBranchIds = await getVisibleBranchIds(user.id, user.role);
  if (visibleBranchIds !== null) {
    if (visibleBranchIds.length === 0) {
      conditions.push(isNull(leadsTable.branchId));
    } else {
      conditions.push(or(inArray(leadsTable.branchId, visibleBranchIds), isNull(leadsTable.branchId))!);
    }
  }
  if (!isAgentRole(user.role) && !(ADMIN_ROLES as readonly string[]).includes(user.role)) {
    // Non-admin staff: visibility is driven by the records.* permission keys.
    // They always see their own records; records.view_unassigned adds the
    // unassigned pool; records.view_others adds records assigned to teammates.
    // Origin (direct vs agent vs sub_agent) is intentionally NOT a filter here.
    const perms = await getEffectivePermissionSet({ id: user.id, role: user.role });
    const orParts: any[] = [eq(leadsTable.assignedToId, user.id)];
    if (perms.has("records.view_unassigned")) {
      orParts.push(isNull(leadsTable.assignedToId));
    }
    if (perms.has("records.view_others")) {
      orParts.push(and(isNotNull(leadsTable.assignedToId), ne(leadsTable.assignedToId, user.id))!);
    }
    conditions.push(or(...orParts)!);
  }

  if (search) {
    const rawTerm = search.trim();
    const translitTerm = toLatinUpper(rawTerm);
    const terms = Array.from(new Set([rawTerm, translitTerm].filter(Boolean)));
    const tokens = translitTerm.split(/\s+/).filter(Boolean);
    const orParts: any[] = [];
    for (const t of terms) {
      orParts.push(
        ilike(leadsTable.firstName, `%${t}%`),
        ilike(leadsTable.lastName, `%${t}%`),
        ilike(leadsTable.email, `%${t}%`),
        ilike(leadsTable.phone, `%${t}%`),
        sql`(coalesce(${leadsTable.firstName},'') || ' ' || coalesce(${leadsTable.lastName},'')) ILIKE ${'%' + t + '%'}`,
        sql`(coalesce(${leadsTable.lastName},'') || ' ' || coalesce(${leadsTable.firstName},'')) ILIKE ${'%' + t + '%'}`,
      );
    }
    if (tokens.length > 1) {
      // Çok-kelimeli aramada her token'ı KELİME SINIRINDA eşleştir.
      // Aksi halde "murat vural" araması "MURATL VURAL"ı da getirir.
      // Postgres `~*` + `\m...\M` word boundary; regex meta karakterleri escape.
      const esc = (s: string) => s.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
      orParts.push(and(
        ...tokens.map((tok: string) => {
          const pat = `\\m${esc(tok)}\\M`;
          return or(
            sql`${leadsTable.firstName} ~* ${pat}`,
            sql`${leadsTable.lastName} ~* ${pat}`,
          )!;
        })
      )!);
    }
    conditions.push(or(...orParts)!);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(leadsTable).where(whereClause);
  const rows = await db
    .select({
      lead: leadsTable,
      agentName: agentsTable.companyName,
      studentHasPhoto: studentsTable.hasPhoto,
    })
    .from(leadsTable)
    .leftJoin(agentsTable, eq(leadsTable.agentId, agentsTable.id))
    .leftJoin(studentsTable, and(
      eq(leadsTable.convertedStudentId, studentsTable.id),
      isNull(studentsTable.deletedAt),
    ))
    .where(whereClause)
    .limit(limitNum)
    .offset(offset)
    .orderBy(desc(leadsTable.updatedAt), desc(leadsTable.createdAt));

  const leadIds = rows.map(r => r.lead.id);
  let nextFollowupMap = new Map<number, string>();
  if (leadIds.length > 0) {
    const fuRows = await db
      .select({
        leadId: followUpsTable.leadId,
        nextDate: sql<string>`min(${followUpsTable.scheduledAt})`,
      })
      .from(followUpsTable)
      .where(and(
        sql`${followUpsTable.leadId} IN (${sql.join(leadIds.map(id => sql`${id}`), sql`, `)})`,
        eq(followUpsTable.completed, false),
      ))
      .groupBy(followUpsTable.leadId);
    fuRows.forEach(r => { if (r.leadId) nextFollowupMap.set(r.leadId, r.nextDate); });
  }

  const data = rows.map(r => ({
    ...r.lead,
    agentName: r.agentName || null,
    nextFollowup: nextFollowupMap.get(r.lead.id) || null,
    convertedStudentHasPhoto: r.studentHasPhoto ?? false,
  }));

  res.json({ data, meta: { total: Number(count), page: pageNum, limit: limitNum, totalPages: Math.ceil(Number(count) / limitNum) } });
});

router.post("/leads", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), requireAgentStaffPermission("leads"), async (req, res): Promise<void> => {
  const user = req.user!;
  const { firstName, lastName, status = "new", email, phone, nationality, interestedProgram, interestedUniversity, interestedCountry, source, notes, assignedTo, season, agentId } = req.body;
  if (!firstName || !lastName || !email || !phone) {
    res.status(400).json({ error: "firstName, lastName, email, and phone are required" });
    return;
  }
  const { error: nameErr, normalized: normBody } = normalizeAndValidateNames(
    { firstName, lastName }, ["firstName", "lastName"]
  );
  if (nameErr) { res.status(400).json({ error: nameErr }); return; }
  const currentYear = await getCurrentSeason();
  let resolvedAgentId = agentId || null;
  if (isAgentRole(user.role)) {
    const agentRec = await getAgentRecord(user.id, user.role);
    resolvedAgentId = agentRec?.id || null;
  }
  const origin = resolvedAgentId
    ? await inferOriginFromAgentId(resolvedAgentId)
    : await inferOriginFromUser(user);
  const inheritedBranchId = await resolveCreateBranchId(user.id, user.role, req.body.branchId ?? null);
  if (inheritedBranchId == null && user.role !== "super_admin" && !isAgentRole(user.role)) {
    res.status(403).json({ error: "No accessible branch — cannot create lead" });
    return;
  }
  const [lead] = await db.insert(leadsTable).values({
    branchId: inheritedBranchId,
    firstName: normBody.firstName as string, lastName: normBody.lastName as string, status, email,
    phone: phone ? normalizePhoneField(phone) : phone, phoneE164: toE164(phone ? normalizePhoneField(phone) : phone),
    nationality: nationality || null,
    interestedProgram: interestedProgram || null,
    interestedUniversity: interestedUniversity || null,
    interestedCountry: interestedCountry || null,
    source: source || null, notes: notes || null,
    assignedToId: assignedTo || null,
    agentId: resolvedAgentId,
    season: season || currentYear,
    ...origin,
  }).returning();
  await applyLeadAssignmentRules(lead, req.ip);
  await logAudit(user.id, "create_lead", "lead", lead.id, {}, req.ip);

  // Sprint B: agent-sourced leads notify only admin roles (parity with Sprint A KURAL 1).
  // Direct leads broadcast to all roles defined in the notification rule (staff + consultant).
  const leadCreatedCtx: Parameters<typeof dispatchNotification>[0] = {
    actorUserId: req.user!.id,
    event: "lead.created",
    title: "New Lead Created",
    body: `${lead.firstName} ${lead.lastName} has been added as a new lead.`,
    actionUrl: `/staff/leads/${lead.id}`,
    icon: "UserPlus",
    templateVars: { firstName: lead.firstName, lastName: lead.lastName, email: lead.email || "", phone: lead.phone || "" },
  };
  if (lead.agentId != null) {
    const adminRows = await db.select({ id: usersTable.id })
      .from(usersTable)
      .where(and(inArray(usersTable.role, ADMIN_ROLES as string[]), eq(usersTable.isActive, true)));
    leadCreatedCtx.recipientUserIds = adminRows.map(u => u.id);
  }
  dispatchNotification(leadCreatedCtx).catch(() => {});

  res.status(201).json(lead);
});

router.post("/leads/bulk", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), requireAgentStaffPermission("leads"), async (req, res): Promise<void> => {
  const user = req.user!;
  const { leads } = req.body as { leads: any[] };
  if (!Array.isArray(leads) || leads.length === 0) {
    res.status(400).json({ error: "leads array is required" });
    return;
  }

  const currentYear = await getCurrentSeason();
  let resolvedAgentId: number | null = null;
  if (isAgentRole(user.role)) {
    const agentRec = await getAgentRecord(user.id, user.role);
    resolvedAgentId = agentRec?.id || null;
  }
  const origin = resolvedAgentId
    ? await inferOriginFromAgentId(resolvedAgentId)
    : await inferOriginFromUser(user);
  const inheritedBranchId = await resolveCreateBranchId(user.id, user.role, null);
  if (inheritedBranchId == null && user.role !== "super_admin" && !isAgentRole(user.role)) {
    res.status(403).json({ error: "No accessible branch — cannot create leads" });
    return;
  }

  const inserted: any[] = [];
  const errors: any[] = [];

  for (let i = 0; i < leads.length; i++) {
    const l = leads[i];
    if (!l.firstName || !l.lastName) {
      errors.push({ index: i, error: "firstName and lastName are required", row: l });
      continue;
    }
    const { error: nameErr, normalized: ns } = normalizeAndValidateNames(
      { firstName: l.firstName, lastName: l.lastName }, ["firstName", "lastName"]
    );
    if (nameErr) {
      errors.push({ index: i, error: nameErr, row: l });
      continue;
    }
    const normPhone = l.phone ? normalizePhoneField(l.phone) : null;
    let estimatedValue: string | null = null;
    if (l.estimatedValue != null && String(l.estimatedValue).trim() !== "") {
      const parsed = parseFloat(String(l.estimatedValue).replace(/[^0-9.\-]/g, ""));
      estimatedValue = Number.isFinite(parsed) ? String(parsed) : null;
    }
    try {
      const [lead] = await db.insert(leadsTable).values({
        branchId: inheritedBranchId,
        firstName: ns.firstName as string,
        lastName: ns.lastName as string,
        status: l.status || "new",
        email: l.email || null,
        phone: normPhone,
        phoneE164: toE164(normPhone),
        nationality: l.nationality || null,
        interestedProgram: l.interestedProgram || null,
        interestedUniversity: l.interestedUniversity || null,
        interestedCountry: l.interestedCountry || null,
        source: l.source || null,
        notes: l.notes || null,
        estimatedValue,
        agentId: resolvedAgentId,
        season: l.season || currentYear,
        ...origin,
      }).returning();
      await applyLeadAssignmentRules(lead, req.ip);
      inserted.push(lead);
    } catch (err: any) {
      errors.push({ index: i, error: err.message, row: l });
    }
  }

  await logAudit(user.id, "bulk_create_leads", "lead", undefined, { count: inserted.length }, req.ip);
  res.status(201).json({ inserted, errors, total: leads.length, success: inserted.length });
});

router.get("/leads/:id", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), requireAgentStaffPermission("leads"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [lead] = await db.select().from(leadsTable).where(and(eq(leadsTable.id, id), isNull(leadsTable.deletedAt)));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  const user = req.user!;
  if (isAgentRole(user.role)) {
    const visibleIds = await getAgentVisibleIds(user.id, user.role);
    if (!lead.agentId || !visibleIds.includes(lead.agentId)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  } else if (!(ADMIN_ROLES as readonly string[]).includes(user.role)) {
    const perms = await getEffectivePermissionSet({ id: user.id, role: user.role });
    const viewOthers = perms.has("records.view_others");
    // KURAL 1: non-admin staff cannot access agent-sourced lead detail
    // unless they have records.view_others (Task #494) — within branch scope only
    if (lead.agentId !== null && !viewOthers) {
      res.status(404).json({ error: "Lead not found" }); return;
    }
    if (viewOthers && !(await isInBranchScope(user.id, user.role, lead.branchId))) {
      res.status(404).json({ error: "Lead not found" }); return;
    }
    if (!viewOthers && lead.assignedToId !== null && lead.assignedToId !== user.id) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  }
  res.json(lead);
});

// GET /api/leads/:id/documents — list documents tied to a lead.
// Reuses lead authz (same rules as GET /leads/:id), then returns every active
// document linked either directly to the lead (documents.leadId), or via the
// converted student (lead.convertedStudentId → students/applications). This
// lets staff see the documents a contact uploaded through public/apply or the
// embed widget even before the lead is converted to a student.
router.get("/leads/:id/documents", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), requireAgentStaffPermission("leads"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [lead] = await db.select().from(leadsTable).where(and(eq(leadsTable.id, id), isNull(leadsTable.deletedAt)));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  const user = req.user!;
  if (isAgentRole(user.role)) {
    const visibleIds = await getAgentVisibleIds(user.id, user.role);
    if (!lead.agentId || !visibleIds.includes(lead.agentId)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  } else if (!(ADMIN_ROLES as readonly string[]).includes(user.role)) {
    const docPerms = await getEffectivePermissionSet({ id: user.id, role: user.role });
    const docViewOthers = docPerms.has("records.view_others");
    // KURAL 1: non-admin staff cannot access documents of agent-sourced leads
    // unless they have records.view_others (Task #494) — within branch scope only
    if (lead.agentId !== null && !docViewOthers) {
      res.status(404).json({ error: "Lead not found" }); return;
    }
    if (docViewOthers && !(await isInBranchScope(user.id, user.role, lead.branchId))) {
      res.status(404).json({ error: "Lead not found" }); return;
    }
    if (!docViewOthers && lead.assignedToId !== null && lead.assignedToId !== user.id) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  }

  const orConds: any[] = [eq(documentsTable.leadId, id)];
  if (lead.convertedStudentId) {
    orConds.push(eq(documentsTable.studentId, lead.convertedStudentId));
  }
  const docs = await db.select({
    id: documentsTable.id,
    name: documentsTable.name,
    type: documentsTable.type,
    status: documentsTable.status,
    mimeType: documentsTable.mimeType,
    sizeBytes: documentsTable.sizeBytes,
    fileUrl: documentsTable.fileUrl,
    fileData: documentsTable.fileData,
    fileKey: documentsTable.fileKey,
    studentId: documentsTable.studentId,
    applicationId: documentsTable.applicationId,
    leadId: documentsTable.leadId,
    createdAt: documentsTable.createdAt,
  })
    .from(documentsTable)
    .where(and(isNull(documentsTable.deletedAt), or(...orConds)!))
    .orderBy(desc(documentsTable.createdAt));
  res.json(docs);
});

// POST /api/leads/:id/documents — staff/agents manually attach a document to a
// lead, choosing a type from the admin-managed document catalog
// (catalog_options category='documents'). The document is linked to the lead
// (documents.leadId) so that, when the lead is converted to a student, it
// carries over (see /leads/:id/convert) and counts toward the program's
// document-requirements checklist. Uses the same fileKey object-storage flow
// and validation as POST /documents.
router.post("/leads/:id/documents", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), requireAgentStaffPermission("leads"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [lead] = await db.select().from(leadsTable).where(and(eq(leadsTable.id, id), isNull(leadsTable.deletedAt)));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  const user = req.user!;
  if (isAgentRole(user.role)) {
    const visibleIds = await getAgentVisibleIds(user.id, user.role);
    if (!lead.agentId || !visibleIds.includes(lead.agentId)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  } else if (!(ADMIN_ROLES as readonly string[]).includes(user.role)) {
    if (lead.assignedToId !== null && lead.assignedToId !== user.id) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  }

  if (req.body.fileData) {
    res.status(400).json({ error: "fileData uploads are no longer accepted. Upload via /storage/uploads/request-url and pass fileKey." });
    return;
  }

  const { type, fileKey, mimeType, sizeBytes, originalFileName } = req.body;
  if (!type || typeof type !== "string") { res.status(400).json({ error: "type is required" }); return; }
  if (!fileKey || typeof fileKey !== "string") { res.status(400).json({ error: "fileKey is required" }); return; }
  if (!mimeType) { res.status(400).json({ error: "mimeType is required for file uploads" }); return; }

  const validationFileName = originalFileName
    ? sanitizeFileName(originalFileName)
    : (() => {
        const syntheticExt = isPdf(mimeType) ? ".pdf" : mimeType === "image/png" ? ".png" : ".jpg";
        return `document${syntheticExt}`;
      })();
  const declaredSize = sizeBytes ? Number(sizeBytes) : 0;
  const validationError = validateUploadedFile(validationFileName, mimeType, declaredSize || 1);
  if (validationError) {
    const httpStatus = validationError.type === "size_exceeded" ? 413 : 400;
    res.status(httpStatus).json({ error: validationError.message });
    return;
  }

  let head: Buffer;
  try {
    const file = await leadDocsObjectStorage.getObjectEntityFile(fileKey);
    const [buf] = await file.download({ start: 0, end: 4099 });
    head = buf;
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(400).json({ error: "Uploaded file could not be located in object storage." });
      return;
    }
    console.error("[LEADS] head-byte fetch failed:", err);
    res.status(502).json({ error: "Failed to verify uploaded file." });
    return;
  }
  const bufferError = await validateUploadedFileBuffer(validationFileName, mimeType, head);
  if (bufferError) {
    try {
      const file = await leadDocsObjectStorage.getObjectEntityFile(fileKey);
      await file.delete({ ignoreNotFound: true });
    } catch (delErr) {
      console.error("[LEADS] failed to clean up rejected upload:", delErr);
    }
    const httpStatus = bufferError.type === "size_exceeded" ? 413 : 400;
    res.status(httpStatus).json({ error: bufferError.message });
    return;
  }

  // Ownership guard: agent callers may only attach storage objects they
  // uploaded themselves. Staff are trusted and bypass this check.
  if (isAgentRole(user.role)) {
    const owned = await callerOwnsObject(user.id, fileKey);
    if (!owned) {
      console.warn(`[LEADS] fileKey ownership violation: userId=${user.id} role=${user.role} key=${fileKey}`);
      res.status(403).json({ error: "You can only attach files that you have uploaded" });
      return;
    }
  }

  const safeName = buildDocNameFromParts(lead.firstName, lead.lastName, type, mimeType);

  const [doc] = await db.insert(documentsTable).values({
    name: safeName,
    type,
    status: "pending",
    leadId: id,
    studentId: lead.convertedStudentId ?? null,
    fileKey,
    mimeType: mimeType || null,
    sizeBytes: sizeBytes ? Number(sizeBytes) : null,
  }).returning();
  await logAudit(user.id, "create_document", "document", doc.id, { name: safeName, type, leadId: id, studentId: lead.convertedStudentId ?? null }, req.ip);
  res.status(201).json(doc);
});

const AGENT_LEAD_PATCH_FIELDS = [
  "firstName", "lastName", "email", "phone", "nationality",
  "interestedProgram", "interestedUniversity", "interestedCountry", "source",
  "notes", "estimatedValue",
];

router.patch("/leads/:id", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), requireAgentStaffPermission("leads"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const user = req.user!;
  const isAgent = isAgentRole(user.role);

  const [existing] = await db.select().from(leadsTable).where(and(eq(leadsTable.id, id), isNull(leadsTable.deletedAt)));
  if (!existing) { res.status(404).json({ error: "Lead not found" }); return; }

  const isAdmin = (ADMIN_ROLES as readonly string[]).includes(user.role);
  const perms = isAgent || isAdmin
    ? new Set<string>()
    : await getEffectivePermissionSet({ id: user.id, role: user.role });

  let agentVisibleIds: number[] = [];
  if (isAgent) {
    agentVisibleIds = await getAgentVisibleIds(user.id, user.role);
    if (!existing.agentId || !agentVisibleIds.includes(existing.agentId)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  } else if (!isAdmin) {
    // KURAL 1: non-admin staff cannot update agent-sourced leads
    // unless they have records.view_others (Task #494) — within branch scope only
    if (existing.agentId !== null && !perms.has("records.view_others")) {
      res.status(404).json({ error: "Lead not found" }); return;
    }
    if (perms.has("records.view_others") && !(await isInBranchScope(user.id, user.role, existing.branchId))) {
      res.status(404).json({ error: "Lead not found" }); return;
    }
    if (!canAccessAssignedRecord(perms, existing.assignedToId, user.id)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  }

  let allowedFields = isAgent ? [...AGENT_LEAD_PATCH_FIELDS] : LEAD_PATCH_FIELDS;
  if (isAgent && req.body.status !== undefined) {
    const [settingsRow] = await db.select({ agentCanChangeLeadStage: settingsTable.agentCanChangeLeadStage }).from(settingsTable);
    if (settingsRow?.agentCanChangeLeadStage === true) {
      allowedFields = [...allowedFields, "status"];
    }
  }
  if (!isAdmin && !isAgent && !perms.has("leads.change_stage")) {
    allowedFields = allowedFields.filter(f => f !== "status");
  }
  // L1: lead assignment scope for agent roles.
  //  - agent / sub_agent: may assign their lead to their own agent_staff
  //    member, claim it for themselves, or unassign it.
  //  - agent_staff: self-claim only (assign to self on a currently-unassigned
  //    lead); may NOT unassign or assign it to anyone else.
  // Targets are validated against the visible agent tree to prevent assigning
  // leads to out-of-scope users (IDOR / horizontal privilege escalation).
  if (isAgent && req.body.assignedTo !== undefined) {
    const isAgentManagerRole = user.role === "agent" || user.role === "sub_agent";
    const target = req.body.assignedTo;
    if (!isAgentManagerRole) {
      // agent_staff: only self-claim of an unassigned lead.
      if (target === null || Number(target) !== user.id || existing.assignedToId !== null) {
        res.status(403).json({ error: "Access denied" }); return;
      }
      allowedFields = [...allowedFields, "assignedTo"];
    } else if (target === null) {
      allowedFields = [...allowedFields, "assignedTo"];
    } else {
      const targetId = Number(target);
      let ok = !Number.isNaN(targetId) && targetId === user.id;
      if (!ok && !Number.isNaN(targetId) && agentVisibleIds.length > 0) {
        const [staffRow] = await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(and(
            eq(usersTable.id, targetId),
            eq(usersTable.role, "agent_staff"),
            inArray(usersTable.managingAgentId, agentVisibleIds),
          ));
        ok = !!staffRow;
      }
      if (!ok) { res.status(403).json({ error: "Access denied" }); return; }
      allowedFields = [...allowedFields, "assignedTo"];
    }
  }
  if (!isAdmin && !isAgent && req.body.assignedTo !== undefined) {
    // Task #494: strict rule — non-admin may only change assignment when they ARE the current assignee.
    // Exception (Task #507): self-claim of an unassigned record is allowed.
    // Exception: users with records.change_assigned permission may reassign any record.
    const isSelfClaim = existing.assignedToId === null && req.body.assignedTo === user.id;
    const canChangeAssigned = perms.has("records.change_assigned");
    if (!isSelfClaim && !canChangeAssigned && existing.assignedToId !== user.id) {
      res.status(403).json({ error: "Only the current assignee or an admin can change assignment" });
      return;
    }
  }
  const updates: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (req.body[key] !== undefined) {
      if (key === "assignedTo") {
        updates["assignedToId"] = req.body[key];
      } else {
        updates[key] = req.body[key];
      }
    }
  }
  if (isAdmin && req.body.originType !== undefined) {
    const validOrigin = ["direct", "agent", "sub_agent"];
    if (validOrigin.includes(req.body.originType)) {
      updates["originType"] = req.body.originType;
      updates["originEntityType"] = req.body.originEntityType ?? null;
      updates["originEntityId"] = req.body.originEntityId ?? null;
      updates["originDisplayName"] = req.body.originDisplayName ?? null;
      updates["originLocked"] = true;
    }
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }
  const { error: nameErr, normalized: normUpdates } = normalizeAndValidateNames(updates, ["firstName", "lastName"]);
  if (nameErr) { res.status(400).json({ error: nameErr }); return; }
  if (Object.prototype.hasOwnProperty.call(normUpdates, "phone")) {
    const rawPhone = (normUpdates as any).phone;
    (normUpdates as any).phone = rawPhone ? normalizePhoneField(rawPhone) : rawPhone;
    (normUpdates as any).phoneE164 = toE164((normUpdates as any).phone);
  }
  const [lead] = await db.update(leadsTable).set(normUpdates).where(eq(leadsTable.id, id)).returning();
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  const diff: Record<string, any> = {};
  for (const k of Object.keys(normUpdates)) {
    if (k === "phoneE164") continue;
    const oldVal = (existing as any)[k];
    const newVal = (normUpdates as any)[k];
    const oldNorm = oldVal instanceof Date ? oldVal.toISOString() : oldVal;
    const newNorm = newVal instanceof Date ? newVal.toISOString() : newVal;
    if (oldNorm !== newNorm) {
      diff[k] = { from: oldVal ?? null, to: newVal ?? null };
    }
  }
  await logAudit(user.id, "update_lead", "lead", id, Object.keys(diff).length ? diff : updates, req.ip);

  // T4: Cross-sync contact info to converted student (best-effort, ignore unique conflicts)
  if (lead.convertedStudentId) {
    const syncFields: Record<string, unknown> = {};
    for (const f of ["firstName", "lastName", "email", "phone", "phoneE164", "nationality"]) {
      if (Object.prototype.hasOwnProperty.call(normUpdates, f)) {
        syncFields[f] = (normUpdates as any)[f];
      }
    }
    if (Object.keys(syncFields).length > 0) {
      try {
        await db.update(studentsTable).set(syncFields).where(eq(studentsTable.id, lead.convertedStudentId));
      } catch (err) {
        console.warn("[lead->student sync] failed:", err);
      }
    }
  }

  // Cascade reassignment down to the converted student and its applications.
  // With `records.cascade_assignment` permission: OVERWRITES all downstream records.
  // Without it: null-fill only — fills unassigned downstream records automatically.
  const assignmentChanged =
    Object.prototype.hasOwnProperty.call(normUpdates, "assignedToId") &&
    existing.assignedToId !== lead.assignedToId;
  if (assignmentChanged && lead.convertedStudentId) {
    const canCascade = await userHasPermission({ id: user.id, role: user.role }, "records.cascade_assignment");
    if (canCascade) {
      await cascadeLeadAssignment({
        leadId: lead.id,
        convertedStudentId: lead.convertedStudentId,
        newAssignedToId: lead.assignedToId,
        actorUserId: user.id,
        ipAddress: req.ip,
      });
    } else if (lead.assignedToId !== null) {
      await cascadeLeadAssignment({
        leadId: lead.id,
        convertedStudentId: lead.convertedStudentId,
        newAssignedToId: lead.assignedToId,
        actorUserId: user.id,
        ipAddress: req.ip,
        nullFillOnly: true,
      });
    }
  }

  if (updates.status && updates.status !== existing.status) {
    // Event-driven portal enqueue: if this lead is already converted to a
    // student, propagate the stage change to their applications immediately.
    if (lead.convertedStudentId) {
      void enqueueOnStageChange({
        studentId:   lead.convertedStudentId,
        newStage:    String(updates.status),
        actorUserId: req.user!.id,
      });
    }

    dispatchNotification({
    actorUserId: req.user!.id,
      event: "lead.stage_changed",
      title: "Lead Stage Changed",
      body: `Lead ${lead.firstName} ${lead.lastName} moved from "${existing.status}" to "${updates.status}".`,
      actionUrl: `/staff/leads/${lead.id}`,
      icon: "ArrowRight",
      recipientUserIds: lead.assignedToId ? [lead.assignedToId] : undefined,
      templateVars: { firstName: lead.firstName, lastName: lead.lastName, oldStage: existing.status || "", newStage: String(updates.status) },
    }).catch(() => {});
  }

  if (updates.assignedToId && updates.assignedToId !== existing.assignedToId) {
    dispatchNotification({
    actorUserId: req.user!.id,
      event: "lead.assigned",
      title: "Lead Assigned to You",
      body: `Lead ${lead.firstName} ${lead.lastName} has been assigned to you.`,
      actionUrl: `/staff/leads/${lead.id}`,
      icon: "UserCheck",
      recipientUserIds: [updates.assignedToId as number],
      templateVars: { firstName: lead.firstName, lastName: lead.lastName },
    }).catch(() => {});
  }

  if (updates.agentId !== undefined && updates.agentId !== existing.agentId) {
    if (updates.agentId) {
      dispatchNotification({
    actorUserId: req.user!.id,
        event: "lead.agent_linked",
        title: "Lead Linked to Agent",
        body: `Lead ${lead.firstName} ${lead.lastName} has been linked to an agent.`,
        actionUrl: `/staff/leads/${lead.id}`,
        icon: "Building2",
        recipientUserIds: lead.assignedToId ? [lead.assignedToId] : undefined,
        templateVars: { firstName: lead.firstName, lastName: lead.lastName },
      }).catch(() => {});
    } else {
      dispatchNotification({
    actorUserId: req.user!.id,
        event: "lead.agent_unlinked",
        title: "Lead Unlinked from Agent",
        body: `Lead ${lead.firstName} ${lead.lastName} has been unlinked from their agent.`,
        actionUrl: `/staff/leads/${lead.id}`,
        icon: "Unlink",
        recipientUserIds: lead.assignedToId ? [lead.assignedToId] : undefined,
        templateVars: { firstName: lead.firstName, lastName: lead.lastName },
      }).catch(() => {});
    }
  }

  res.json(lead);
});

router.delete("/leads/:id", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), requireAgentStaffPermission("leads"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select().from(leadsTable).where(and(eq(leadsTable.id, id), isNull(leadsTable.deletedAt)));
  if (!existing) { res.status(404).json({ error: "Lead not found" }); return; }
  const delUser = req.user!;
  if (isAgentRole(delUser.role)) {
    // Agents may only delete leads within their own visibility tree.
    const visibleIds = await getAgentVisibleIds(delUser.id, delUser.role);
    if (!existing.agentId || !visibleIds.includes(existing.agentId)) {
      res.status(403).json({ error: "Access denied" }); return;
    }
    // A converted lead is linked to a student record; deleting it would orphan
    // that link, so agents cannot delete leads that have been converted.
    if (existing.convertedStudentId !== null) {
      res.status(409).json({ error: "Cannot delete a converted lead", code: "LEAD_CONVERTED" });
      return;
    }
  } else if (!(ADMIN_ROLES as readonly string[]).includes(delUser.role)) {
    // KURAL 1: non-admin staff cannot delete agent-sourced leads
    if (existing.agentId !== null) {
      res.status(404).json({ error: "Lead not found" }); return;
    }
    if (existing.assignedToId !== null && existing.assignedToId !== delUser.id) {
      res.status(403).json({ error: "Access denied" }); return;
    }
  }
  await softDelete(leadsTable, [id], { actorUserId: delUser.id });
  await logAudit(delUser.id, "delete_lead", "lead", id, { soft: true }, req.ip);
  res.sendStatus(204);
});

// Hard-delete (purge) — super_admin only. Permanently removes the row.
router.post("/leads/:id/purge", requireAuth, requireRole("super_admin"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const result = await db.delete(leadsTable).where(eq(leadsTable.id, id));
  await logAudit(req.user!.id, "purge_lead", "lead", id, { hard: true }, req.ip);
  res.json({ success: true, deleted: result.rowCount ?? 0 });
});

router.post("/leads/bulk-action", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const user = req.user!;
  const isAdmin = (ADMIN_ROLES as readonly string[]).includes(user.role);
  const { ids, action, assignedToId, status } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids required" }); return; }
  if (!["delete", "assign", "move"].includes(action)) { res.status(400).json({ error: "Invalid action" }); return; }
  // Task #494: non-admin may only bulk-assign their own records; delete/move remain admin-only
  if (!isAdmin && action !== "assign") {
    res.status(403).json({ error: "Only admins can bulk delete or move leads" }); return;
  }
  const numericIds = ids.map(Number).filter((n: number) => !isNaN(n));
  let updated = 0;
  if (action === "delete") {
    updated = await softDelete(leadsTable, numericIds, { actorUserId: user.id });
    for (const id of numericIds) logAudit(user.id, "delete_lead", "lead", id, { soft: true }, req.ip);
  } else if (action === "assign" && assignedToId !== undefined) {
    const newAssignedToId = assignedToId ? Number(assignedToId) : null;
    // Non-admin: filter to only records they are the current assignee of
    let idsToUpdate = numericIds;
    let skipped = 0;
    if (!isAdmin) {
      const ownedRows = await db.select({ id: leadsTable.id })
        .from(leadsTable)
        .where(and(inArray(leadsTable.id, numericIds), eq(leadsTable.assignedToId, user.id), isNull(leadsTable.deletedAt)));
      idsToUpdate = ownedRows.map(r => r.id);
      skipped = numericIds.length - idsToUpdate.length;
      if (idsToUpdate.length === 0) {
        res.json({ success: true, updated: 0, skipped }); return;
      }
    }
    const affectedLeads = await db.select({ id: leadsTable.id, convertedStudentId: leadsTable.convertedStudentId })
      .from(leadsTable).where(and(inArray(leadsTable.id, idsToUpdate), isNull(leadsTable.deletedAt)));
    const result = await db.update(leadsTable).set({ assignedToId: newAssignedToId }).where(inArray(leadsTable.id, idsToUpdate));
    updated = result.rowCount ?? idsToUpdate.length;
    await logAudit(user.id, "bulk_assign_leads", "lead", undefined, { ids: idsToUpdate, assignedToId }, req.ip);
    const canCascadeLeads = await userHasPermission({ id: user.id, role: user.role }, "records.cascade_assignment");
    for (const l of affectedLeads) {
      if (!l.convertedStudentId) continue;
      await cascadeLeadAssignment({
        leadId: l.id,
        convertedStudentId: l.convertedStudentId,
        newAssignedToId,
        actorUserId: user.id,
        ipAddress: req.ip,
        nullFillOnly: !canCascadeLeads,
      });
    }
    res.json({ success: true, updated, skipped }); return;
  } else if (action === "move" && status) {
    const result = await db.update(leadsTable).set({ status }).where(inArray(leadsTable.id, numericIds));
    updated = result.rowCount ?? numericIds.length;
    await logAudit(user.id, "bulk_move_leads", "lead", undefined, { ids: numericIds, status }, req.ip);
  } else {
    res.status(400).json({ error: "Missing required fields for action" }); return;
  }
  res.json({ success: true, updated });
});

router.post("/leads/:id/convert", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), async (req, res): Promise<void> => {
  const user = req.user!;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [lead] = await db.select().from(leadsTable).where(and(eq(leadsTable.id, id), isNull(leadsTable.deletedAt)));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  if (isAgentRole(user.role)) {
    const visibleIds = await getAgentVisibleIds(user.id, user.role);
    if (!lead.agentId || !visibleIds.includes(lead.agentId)) {
      res.status(403).json({ error: "You do not have access to this lead" });
      return;
    }
  }
  const missingFields: string[] = [];
  if (!lead.firstName?.trim()) missingFields.push("firstName");
  if (!lead.lastName?.trim()) missingFields.push("lastName");
  if (!lead.email?.trim()) missingFields.push("email");
  if (!lead.phone?.trim()) missingFields.push("phone");
  if (missingFields.length > 0) {
    res.status(422).json({
      error: `Cannot convert: missing required fields — ${missingFields.join(", ")}`,
      missingFields,
    });
    return;
  }

  if (lead.convertedStudentId) {
    const [existing] = await db.select().from(studentsTable).where(and(eq(studentsTable.id, lead.convertedStudentId), isNull(studentsTable.deletedAt)));
    if (existing) {
      const wonStages = await db.select().from(pipelineStagesTable)
        .where(and(eq(pipelineStagesTable.entityType, "lead"), eq(pipelineStagesTable.variant, "won")));
      const convertedKey = wonStages.length > 0 ? wonStages[0].key : "converted";
      if (lead.status !== convertedKey) {
        await db.update(leadsTable).set({ status: convertedKey }).where(eq(leadsTable.id, id));
      }
      res.json({ student: existing, merged: false, alreadyConverted: true });
      return;
    }
    await db.update(leadsTable).set({ convertedStudentId: null }).where(eq(leadsTable.id, id));
  }

  const embedSubmissions = await db.select().from(embedSubmissionsTable).where(eq(embedSubmissionsTable.leadId, lead.id));
  const submission = embedSubmissions.length > 0 ? embedSubmissions[0] : null;
  const aiData: Record<string, any> = (submission?.aiExtractedData as Record<string, any>) || {};

  const s = (v: any) => (v && v !== "null" && v !== "N/A") ? String(v) : null;

  const studentValues: any = {
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email || null,
    phone: lead.phone || null,
    nationality: lead.nationality || s(aiData.nationality) || null,
    agentId: (lead as any).agentId || null,
    assignedToId: lead.assignedToId || null,
    status: "active",
    motherName: s(aiData.motherName) || null,
    fatherName: s(aiData.fatherName) || null,
    passportNumber: s(aiData.passportNumber) || null,
    passportIssueDate: s(aiData.passportIssueDate) || null,
    passportExpiry: s(aiData.passportExpiry) || null,
    dateOfBirth: s(aiData.dateOfBirth) || null,
    address: s(aiData.address) || null,
    highSchool: s(aiData.highSchool) || null,
    graduationYear: aiData.graduationYear ? parseInt(String(aiData.graduationYear), 10) || null : null,
    gpa: s(aiData.gpa) || null,
    languageScore: s(aiData.languageScore) || null,
    originType: lead.originType || "direct",
    originEntityType: lead.originEntityType || null,
    originEntityId: lead.originEntityId || null,
    originDisplayName: lead.originDisplayName || "Find And Study",
    originLocked: true,
    originLeadId: lead.id,
  };

  if (lead.email) {
    const [existingByEmail] = await db.select().from(studentsTable).where(and(eq(studentsTable.email, lead.email), isNull(studentsTable.deletedAt)));
    if (existingByEmail) {
      const mergeUpdates: any = {};
      if (!existingByEmail.assignedToId && lead.assignedToId) mergeUpdates.assignedToId = lead.assignedToId;
      if (!existingByEmail.motherName && studentValues.motherName) mergeUpdates.motherName = studentValues.motherName;
      if (!existingByEmail.fatherName && studentValues.fatherName) mergeUpdates.fatherName = studentValues.fatherName;
      if (!existingByEmail.passportNumber && studentValues.passportNumber) mergeUpdates.passportNumber = studentValues.passportNumber;
      if (!existingByEmail.passportIssueDate && studentValues.passportIssueDate) mergeUpdates.passportIssueDate = studentValues.passportIssueDate;
      if (!existingByEmail.passportExpiry && studentValues.passportExpiry) mergeUpdates.passportExpiry = studentValues.passportExpiry;
      if (!existingByEmail.dateOfBirth && studentValues.dateOfBirth) mergeUpdates.dateOfBirth = studentValues.dateOfBirth;
      if (!existingByEmail.address && studentValues.address) mergeUpdates.address = studentValues.address;
      if (!existingByEmail.highSchool && studentValues.highSchool) mergeUpdates.highSchool = studentValues.highSchool;
      if (!existingByEmail.gpa && studentValues.gpa) mergeUpdates.gpa = studentValues.gpa;
      if (!existingByEmail.languageScore && studentValues.languageScore) mergeUpdates.languageScore = studentValues.languageScore;
      if (!existingByEmail.graduationYear && studentValues.graduationYear) mergeUpdates.graduationYear = studentValues.graduationYear;
      if (!existingByEmail.originLeadId) mergeUpdates.originLeadId = lead.id;
      if (existingByEmail.originType === "direct" && lead.originType !== "direct") {
        mergeUpdates.originType = lead.originType;
        mergeUpdates.originEntityType = lead.originEntityType;
        mergeUpdates.originEntityId = lead.originEntityId;
        mergeUpdates.originDisplayName = lead.originDisplayName;
      }

      if (Object.keys(mergeUpdates).length > 0) {
        await db.update(studentsTable).set(mergeUpdates).where(eq(studentsTable.id, existingByEmail.id));
      }

      await db.update(documentsTable).set({ studentId: existingByEmail.id }).where(and(eq(documentsTable.leadId, lead.id), isNull(documentsTable.studentId)));
      // Reassigned lead docs may include a photo/photograph — resync the flag now
      // so the avatar appears immediately, not only after the next boot backfill.
      await recomputeStudentPhoto(existingByEmail.id);

      if (submission?.programId) {
        await createApplicationFromSubmission(existingByEmail.id, submission);
      }

      await db.update(leadsTable).set({ status: "converted", convertedStudentId: existingByEmail.id }).where(eq(leadsTable.id, id));
      // Keep inbox external_contacts in sync so conversation linking resolves to student post-conversion
      await db.update(externalContactsTable).set({ studentId: existingByEmail.id }).where(eq(externalContactsTable.leadId, lead.id));
      await logAudit(req.user!.id, "convert_lead", "lead", id, { studentId: existingByEmail.id, merged: true }, req.ip);

      const [updatedStudent] = await db.select().from(studentsTable).where(eq(studentsTable.id, existingByEmail.id));
      res.json({ student: updatedStudent || existingByEmail, merged: true });
      return;
    }
  }

  const [student] = await db.insert(studentsTable).values(studentValues).returning();

  await db.update(documentsTable).set({ studentId: student.id }).where(and(eq(documentsTable.leadId, lead.id), isNull(documentsTable.studentId)));

  // Now that the lead's photo doc(s) belong to the student, sync has_photo +
  // photo_url. Covers photo/photograph + fileKey/fileData/fileUrl uniformly.
  await recomputeStudentPhoto(student.id);

  if (submission?.programId) {
    await createApplicationFromSubmission(student.id, submission);
  }

  await db.update(leadsTable).set({ status: "converted", convertedStudentId: student.id }).where(eq(leadsTable.id, id));
  // Keep inbox external_contacts in sync so conversation linking resolves to student post-conversion
  await db.update(externalContactsTable).set({ studentId: student.id }).where(eq(externalContactsTable.leadId, lead.id));
  await logAudit(req.user!.id, "convert_lead", "lead", id, { studentId: student.id }, req.ip);
  res.json({ student, merged: false });
});

async function createApplicationFromSubmission(studentId: number, submission: any) {
  try {
    const programId = submission.programId;
    const [program] = await db.select().from(programsTable).where(eq(programsTable.id, programId));
    if (!program) return;

    const [university] = await db.select().from(universitiesTable).where(eq(universitiesTable.id, program.universityId));

    const [existingApp] = await db.select().from(applicationsTable)
      .where(and(eq(applicationsTable.studentId, studentId), eq(applicationsTable.programId, programId)));
    if (existingApp) return;

    const [studentRec] = await db.select({
      assignedToId: studentsTable.assignedToId, agentId: studentsTable.agentId,
      originType: studentsTable.originType, originEntityType: studentsTable.originEntityType,
      originEntityId: studentsTable.originEntityId, originDisplayName: studentsTable.originDisplayName,
    }).from(studentsTable).where(eq(studentsTable.id, studentId));

    await db.insert(applicationsTable).values({
      studentId,
      // Lead submission (public intake form) → student self-service.
      createdSource: "student",
      programId: program.id,
      universityId: program.universityId,
      programName: program.name,
      universityName: university?.name || submission.universityName || null,
      country: university?.country || null,
      level: program.degree || null,
      instructionLanguage: program.language || null,
      tuitionFee: program.tuitionFee || null,
      discountedFee: program.discountedFee || null,
      scholarship: program.scholarship || null,
      stage: "inquiry",
      season: "2026",
      assignedToId: studentRec?.assignedToId || null,
      agentId: studentRec?.agentId || null,
      originType: studentRec?.originType || "direct",
      originEntityType: studentRec?.originEntityType || null,
      originEntityId: studentRec?.originEntityId || null,
      originDisplayName: studentRec?.originDisplayName || "Find And Study",
      originStudentId: studentId,
    });
  } catch (err) {
    console.error("Failed to create application from submission:", err);
  }
}

router.get("/leads/:id/notes", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), requireAgentStaffPermission("leads"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { page = "1", limit = "50", internal } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  // KURAL 1: non-admin staff cannot access notes of agent-sourced leads
  // unless they have records.view_others (Task #494) — within branch scope only
  const [noteLeadRow] = await db.select({ agentId: leadsTable.agentId, branchId: leadsTable.branchId }).from(leadsTable).where(and(eq(leadsTable.id, id), isNull(leadsTable.deletedAt)));
  if (!noteLeadRow) { res.status(404).json({ error: "Lead not found" }); return; }
  if (isAgentSourcedAndBlockedForStaff(req.user!, noteLeadRow.agentId)) {
    const notePerms = await getEffectivePermissionSet({ id: req.user!.id, role: req.user!.role });
    if (!notePerms.has("records.view_others")) {
      res.status(404).json({ error: "Lead not found" }); return;
    }
    if (!(await isInBranchScope(req.user!.id, req.user!.role, noteLeadRow.branchId))) {
      res.status(404).json({ error: "Lead not found" }); return;
    }
  }

  const isStaff = ["super_admin", "admin", "manager", "staff"].includes(req.user!.role);
  const conditions = [eq(notesTable.resourceId, id), eq(notesTable.resourceType, "lead")];

  if (!isStaff || internal !== "true") {
    conditions.push(eq(notesTable.isInternal, false));
  } else {
    conditions.push(eq(notesTable.isInternal, true));
  }

  const notes = await db
    .select({
      id: notesTable.id,
      content: notesTable.content,
      authorId: notesTable.authorId,
      authorName: sql<string | null>`concat(${usersTable.firstName}, ' ', ${usersTable.lastName})`,
      isInternal: notesTable.isInternal,
      createdAt: notesTable.createdAt,
    })
    .from(notesTable)
    .leftJoin(usersTable, eq(notesTable.authorId, usersTable.id))
    .where(and(...conditions))
    .orderBy(notesTable.createdAt)
    .limit(limitNum)
    .offset(offset);
  res.json(notes);
});

router.post("/leads/:id/notes", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), requireAgentStaffPermission("leads"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { content, isInternal } = req.body;
  if (!content?.trim()) { res.status(400).json({ error: "content is required" }); return; }

  const isStaff = ["super_admin", "admin", "manager", "staff"].includes(req.user!.role);

  const [note] = await db.insert(notesTable).values({
    content: String(content).slice(0, 5000),
    authorId: req.user!.id,
    resourceType: "lead",
    resourceId: id,
    isInternal: isStaff && isInternal === true,
  }).returning();

  const [lead] = await db.select({
    assignedToId: leadsTable.assignedToId,
    agentId: leadsTable.agentId,
    firstName: leadsTable.firstName,
    lastName: leadsTable.lastName,
  }).from(leadsTable).where(and(eq(leadsTable.id, id), isNull(leadsTable.deletedAt)));

  if (lead) {
    const recipientIds: number[] = [];
    if (lead.assignedToId && lead.assignedToId !== req.user!.id) {
      recipientIds.push(lead.assignedToId);
    }
    if (lead.agentId) {
      const [agent] = await db.select({ userId: agentsTable.userId }).from(agentsTable)
        .where(eq(agentsTable.id, lead.agentId));
      if (agent?.userId && agent.userId !== req.user!.id && !recipientIds.includes(agent.userId)) {
        recipientIds.push(agent.userId);
      }
    }
    if (recipientIds.length > 0) {
      dispatchNotification({
    actorUserId: req.user!.id,
        event: "note.created",
        title: "New Note Added",
        body: `A note was added to lead ${lead.firstName} ${lead.lastName}`,
        actionUrl: `/staff/leads/${id}`,
        recipientUserIds: recipientIds,
        data: { resourceType: "lead", resourceId: id },
      });
    }
  }

  res.status(201).json({ ...note, authorName: `${req.user!.firstName || ""} ${req.user!.lastName || ""}`.trim() });
});

router.delete("/leads/:id/notes/:noteId", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const noteId = parseInt(String(req.params.noteId), 10);
  if (isNaN(id) || isNaN(noteId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [note] = await db.select({
    id: notesTable.id,
    content: notesTable.content,
    authorId: notesTable.authorId,
    isInternal: notesTable.isInternal,
  }).from(notesTable).where(and(
    eq(notesTable.id, noteId),
    eq(notesTable.resourceId, id),
    eq(notesTable.resourceType, "lead"),
  ));
  if (!note) { res.status(404).json({ error: "Note not found" }); return; }

  await db.delete(notesTable).where(eq(notesTable.id, noteId));

  await logAudit(req.user!.id, "delete_note", "lead", id, {
    noteId,
    isInternal: note.isInternal,
    authorId: note.authorId,
    contentPreview: (note.content || "").slice(0, 200),
  }, req.ip);

  res.status(204).end();
});

router.get("/leads/:id/follow-ups", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), requireAgentStaffPermission("leads"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [lead] = await db.select().from(leadsTable).where(and(eq(leadsTable.id, id), isNull(leadsTable.deletedAt)));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  const user = req.user!;
  if (isAgentRole(user.role)) {
    const visibleIds = await getAgentVisibleIds(user.id, user.role);
    if (!lead.agentId || !visibleIds.includes(lead.agentId)) { res.status(403).json({ error: "Access denied" }); return; }
  } else if (!(ADMIN_ROLES as readonly string[]).includes(user.role)) {
    // KURAL 1: non-admin staff cannot access follow-ups of agent-sourced leads
    if (lead.agentId !== null) { res.status(404).json({ error: "Lead not found" }); return; }
    if (lead.assignedToId !== null && lead.assignedToId !== user.id) { res.status(403).json({ error: "Access denied" }); return; }
  }
  const { page = "1", limit = "50" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const data = await db
    .select({
      id: followUpsTable.id,
      leadId: followUpsTable.leadId,
      title: followUpsTable.title,
      scheduledAt: followUpsTable.scheduledAt,
      completed: followUpsTable.completed,
      completedAt: followUpsTable.completedAt,
      notes: followUpsTable.notes,
      createdById: followUpsTable.createdById,
      createdByName: sql<string | null>`(SELECT NULLIF(CONCAT_WS(' ', cu.first_name, cu.last_name), '') FROM users cu WHERE cu.id = ${followUpsTable.createdById})`,
      updatedById: followUpsTable.updatedById,
      updatedByName: sql<string | null>`(SELECT NULLIF(CONCAT_WS(' ', uu.first_name, uu.last_name), '') FROM users uu WHERE uu.id = ${followUpsTable.updatedById})`,
      createdAt: followUpsTable.createdAt,
      updatedAt: followUpsTable.updatedAt,
    })
    .from(followUpsTable)
    .where(eq(followUpsTable.leadId, id))
    .orderBy(asc(followUpsTable.scheduledAt))
    .limit(limitNum)
    .offset(offset);
  res.json(data);
});

router.post("/leads/:id/follow-ups", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), requireAgentStaffPermission("leads"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [lead] = await db.select().from(leadsTable).where(and(eq(leadsTable.id, id), isNull(leadsTable.deletedAt)));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  const user = req.user!;
  if (isAgentRole(user.role)) {
    const visibleIds = await getAgentVisibleIds(user.id, user.role);
    if (!lead.agentId || !visibleIds.includes(lead.agentId)) { res.status(403).json({ error: "Access denied" }); return; }
  } else if (!(ADMIN_ROLES as readonly string[]).includes(user.role)) {
    if (lead.assignedToId !== null && lead.assignedToId !== user.id) { res.status(403).json({ error: "Access denied" }); return; }
  }
  const { title, scheduledAt, notes } = req.body;
  if (!title?.trim() || !scheduledAt) {
    res.status(400).json({ error: "title and scheduledAt are required" });
    return;
  }
  const scheduledDate = new Date(scheduledAt);
  if (isNaN(scheduledDate.getTime())) {
    res.status(400).json({ error: "Invalid date" });
    return;
  }
  if (scheduledDate < new Date()) {
    res.status(400).json({ error: "Cannot schedule follow-ups in the past" });
    return;
  }
  const [followUp] = await db.insert(followUpsTable).values({
    leadId: id,
    resourceType: "lead",
    title: String(title).slice(0, 500),
    scheduledAt: scheduledDate,
    notes: notes ? String(notes).slice(0, 2000) : null,
    createdById: req.user!.id,
    assignedToId: req.user!.id,
  }).returning();
  await logAudit(req.user!.id, "create_follow_up", "lead", id, {
    followUpId: followUp.id,
    title: followUp.title,
    scheduledAt: followUp.scheduledAt instanceof Date ? followUp.scheduledAt.toISOString() : followUp.scheduledAt,
    notes: followUp.notes ? String(followUp.notes).slice(0, 200) : null,
  }, req.ip);
  res.status(201).json(followUp);
});

router.patch("/follow-ups/:id", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existingFu] = await db.select().from(followUpsTable).where(eq(followUpsTable.id, id));
  if (!existingFu) { res.status(404).json({ error: "Follow-up not found" }); return; }
  const fuUser = req.user!;
  if (existingFu.leadId) {
    const [fuLead] = await db.select().from(leadsTable).where(and(eq(leadsTable.id, existingFu.leadId), isNull(leadsTable.deletedAt)));
    if (!fuLead) { res.status(404).json({ error: "Follow-up not found" }); return; }
    if (isAgentRole(fuUser.role)) {
      const visibleIds = await getAgentVisibleIds(fuUser.id, fuUser.role);
      if (!fuLead.agentId || !visibleIds.includes(fuLead.agentId)) { res.status(403).json({ error: "Access denied" }); return; }
    } else if (!(ADMIN_ROLES as readonly string[]).includes(fuUser.role)) {
      if (fuLead.assignedToId !== null && fuLead.assignedToId !== fuUser.id) { res.status(403).json({ error: "Access denied" }); return; }
    }
  } else if (existingFu.studentId) {
    const access = await assertCanAccessStudent(req, existingFu.studentId);
    if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
  }
  const { completed, title, scheduledAt, notes } = req.body;
  const updates: Record<string, unknown> = {};
  let isContentEdit = false;
  let isCompletionToggle = false;
  if (completed !== undefined) {
    updates.completed = completed;
    updates.completedAt = completed ? new Date() : null;
    isCompletionToggle = true;
  }
  if (title !== undefined) { updates.title = String(title).slice(0, 500); isContentEdit = true; }
  if (scheduledAt !== undefined) {
    const scheduledDate = new Date(scheduledAt);
    if (isNaN(scheduledDate.getTime())) {
      res.status(400).json({ error: "Invalid date" });
      return;
    }
    if (scheduledDate < new Date()) {
      res.status(400).json({ error: "Cannot schedule follow-ups in the past" });
      return;
    }
    updates.scheduledAt = scheduledDate;
    isContentEdit = true;
  }
  if (notes !== undefined) { updates.notes = notes ? String(notes).slice(0, 2000) : null; isContentEdit = true; }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields" });
    return;
  }
  updates.updatedAt = new Date();
  if (isContentEdit) {
    updates.updatedById = req.user!.id;
  }
  const [followUp] = await db.update(followUpsTable).set(updates).where(eq(followUpsTable.id, id)).returning();
  if (!followUp) { res.status(404).json({ error: "Follow-up not found" }); return; }

  const auditResource = existingFu.leadId ? "lead" : existingFu.studentId ? "student" : "follow_up";
  const auditResourceId = existingFu.leadId ?? existingFu.studentId ?? null;
  if (isContentEdit) {
    const fuDiff: Record<string, any> = { followUpId: id, title: followUp.title };
    if (title !== undefined && existingFu.title !== followUp.title) {
      fuDiff.titleChange = { from: existingFu.title, to: followUp.title };
    }
    if (scheduledAt !== undefined) {
      const oldIso = existingFu.scheduledAt instanceof Date ? existingFu.scheduledAt.toISOString() : existingFu.scheduledAt;
      const newIso = followUp.scheduledAt instanceof Date ? followUp.scheduledAt.toISOString() : followUp.scheduledAt;
      if (oldIso !== newIso) {
        fuDiff.scheduledAtChange = { from: oldIso, to: newIso };
      }
    }
    if (notes !== undefined && existingFu.notes !== followUp.notes) {
      fuDiff.notesChange = {
        from: existingFu.notes ? String(existingFu.notes).slice(0, 200) : null,
        to: followUp.notes ? String(followUp.notes).slice(0, 200) : null,
      };
    }
    await logAudit(req.user!.id, "update_follow_up", auditResource, auditResourceId ?? undefined, fuDiff, req.ip);
  }
  if (isCompletionToggle && completed !== existingFu.completed) {
    await logAudit(req.user!.id, completed ? "complete_follow_up" : "reopen_follow_up", auditResource, auditResourceId ?? undefined, {
      followUpId: id,
      title: followUp.title,
    }, req.ip);
  }
  const [enriched] = await db
    .select({
      id: followUpsTable.id,
      leadId: followUpsTable.leadId,
      studentId: followUpsTable.studentId,
      title: followUpsTable.title,
      scheduledAt: followUpsTable.scheduledAt,
      completed: followUpsTable.completed,
      completedAt: followUpsTable.completedAt,
      notes: followUpsTable.notes,
      createdById: followUpsTable.createdById,
      createdByName: sql<string | null>`(SELECT NULLIF(CONCAT_WS(' ', cu.first_name, cu.last_name), '') FROM users cu WHERE cu.id = ${followUpsTable.createdById})`,
      updatedById: followUpsTable.updatedById,
      updatedByName: sql<string | null>`(SELECT NULLIF(CONCAT_WS(' ', uu.first_name, uu.last_name), '') FROM users uu WHERE uu.id = ${followUpsTable.updatedById})`,
      createdAt: followUpsTable.createdAt,
      updatedAt: followUpsTable.updatedAt,
    })
    .from(followUpsTable)
    .where(eq(followUpsTable.id, id));
  res.json(enriched || followUp);
});

router.get("/follow-ups/upcoming", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const userRole = req.user!.role;
  const isAdmin = ADMIN_ROLES.includes(userRole);
  const now = new Date();
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const baseConditions = [
    eq(followUpsTable.completed, false),
    lte(followUpsTable.scheduledAt, nextWeek),
  ];

  if (isAdmin && req.query.createdById) {
    const filterUserId = parseInt(String(req.query.createdById), 10);
    if (!isNaN(filterUserId)) {
      baseConditions.push(eq(followUpsTable.createdById, filterUserId));
    }
  }

  if (!isAdmin) {
    const leadAssignedOrUnassigned = or(
      sql`(SELECT assigned_to_id FROM leads WHERE leads.id = ${followUpsTable.leadId}) = ${userId}`,
      sql`(SELECT assigned_to_id FROM leads WHERE leads.id = ${followUpsTable.leadId}) IS NULL`
    );

    const studentAssignedOrUnassigned = or(
      sql`(SELECT assigned_to_id FROM students WHERE students.id = ${followUpsTable.studentId}) = ${userId}`,
      sql`(SELECT assigned_to_id FROM students WHERE students.id = ${followUpsTable.studentId}) IS NULL`
    );

    baseConditions.push(
      or(
        and(sql`${followUpsTable.leadId} IS NOT NULL`, leadAssignedOrUnassigned),
        and(sql`${followUpsTable.studentId} IS NOT NULL`, studentAssignedOrUnassigned),
        eq(followUpsTable.assignedToId, userId),
        and(isNull(followUpsTable.leadId), isNull(followUpsTable.studentId), isNull(followUpsTable.assignedToId))
      )!
    );
  }

  const data = await db
    .select({
      id: followUpsTable.id,
      leadId: followUpsTable.leadId,
      studentId: followUpsTable.studentId,
      title: followUpsTable.title,
      scheduledAt: followUpsTable.scheduledAt,
      completed: followUpsTable.completed,
      notes: followUpsTable.notes,
      leadName: sql<string | null>`COALESCE(
        (SELECT concat(first_name, ' ', last_name) FROM leads WHERE leads.id = ${followUpsTable.leadId}),
        (SELECT concat(first_name, ' ', last_name) FROM students WHERE students.id = ${followUpsTable.studentId})
      )`,
      createdByName: sql<string | null>`(SELECT NULLIF(CONCAT_WS(' ', cu.first_name, cu.last_name), '') FROM users cu WHERE cu.id = ${followUpsTable.createdById})`,
      updatedByName: sql<string | null>`(SELECT NULLIF(CONCAT_WS(' ', uu.first_name, uu.last_name), '') FROM users uu WHERE uu.id = ${followUpsTable.updatedById})`,
    })
    .from(followUpsTable)
    .where(and(...baseConditions))
    .orderBy(asc(followUpsTable.scheduledAt))
    .limit(20);
  res.json(data);
});

router.patch("/leads/:id/origin", requireAuth, requireRole("super_admin", "admin"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { originType, originEntityType, originEntityId, originDisplayName } = req.body;
  if (!originType || !["direct", "agent", "sub_agent"].includes(originType)) {
    res.status(400).json({ error: "originType must be direct, agent, or sub_agent" });
    return;
  }
  const [existing] = await db.select().from(leadsTable).where(and(eq(leadsTable.id, id), isNull(leadsTable.deletedAt)));
  if (!existing) { res.status(404).json({ error: "Lead not found" }); return; }

  const oldOrigin = { originType: existing.originType, originEntityType: existing.originEntityType, originEntityId: existing.originEntityId, originDisplayName: existing.originDisplayName };

  const [updated] = await db.update(leadsTable).set({
    originType,
    originEntityType: originEntityType || null,
    originEntityId: originEntityId || null,
    originDisplayName: originDisplayName || null,
    originLocked: true,
  }).where(eq(leadsTable.id, id)).returning();

  await logAudit(req.user!.id, "override_origin", "lead", id, { old: oldOrigin, new: { originType, originEntityType, originEntityId, originDisplayName } }, req.ip);
  res.json(updated);
});

export default router;
