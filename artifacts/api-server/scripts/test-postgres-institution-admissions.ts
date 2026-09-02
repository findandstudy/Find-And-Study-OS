import assert from "node:assert/strict";
import test, { after } from "node:test";
import pg from "pg";

const actorUrl = process.env.DATABASE_URL;
const adminUrl = process.env.INSTITUTION_TEST_ADMIN_DATABASE_URL;
if (!actorUrl || !adminUrl) throw new Error("institution_postgres_test_urls_required");

for (const raw of [actorUrl, adminUrl]) {
  const url = new URL(raw);
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname) || !/^fas_(?:dev|it)_[a-z0-9_]+$/.test(url.pathname.slice(1))) {
    throw new Error("institution_postgres_test_requires_disposable_loopback_database");
  }
}

const admin = new pg.Client({ connectionString: adminUrl });
const actor = new pg.Client({ connectionString: actorUrl });
await admin.connect();
await actor.connect();

const tenantId = "018f9100-0000-7000-8000-000000000001";
const relationshipId = "018f9100-0000-7000-8000-000000000002";
const reviewerPrincipalId = "018f9100-0000-7000-8000-000000000003";
const approverPrincipalId = "018f9100-0000-7000-8000-000000000004";
const auditorPrincipalId = "018f9100-0000-7000-8000-000000000005";
const reviewerMembershipId = "018f9100-0000-7000-8000-000000000006";
const approverMembershipId = "018f9100-0000-7000-8000-000000000007";
const auditorMembershipId = "018f9100-0000-7000-8000-000000000008";
const caseId = "018f9100-0000-7000-8000-000000000009";
const assessmentId = "018f9100-0000-7000-8000-00000000000a";
const decisionId = "018f9100-0000-7000-8000-00000000000b";
const offerId = "018f9100-0000-7000-8000-00000000000c";
const universityId = 991001;
const programId = 991001;
const studentId = 991001;
const applicationId = 991001;
const reviewerUserId = 991001;
const approverUserId = 991002;
const auditorUserId = 991003;

await admin.query(`
  INSERT INTO tenants (id,slug,legal_name,display_name,status,home_region)
  VALUES ('${tenantId}','institution-test','Institution Test','Institution Test','ACTIVE','eu-test');
  INSERT INTO users (id,email,first_name,last_name,role,is_active,email_verified) VALUES
    (${reviewerUserId},'reviewer@institution.test','Review','Maker','institution_user',true,true),
    (${approverUserId},'approver@institution.test','Decision','Checker','institution_user',true,true),
    (${auditorUserId},'auditor@institution.test','Read','Only','institution_user',true,true);
  INSERT INTO principals (id,principal_type,issuer,subject,legacy_user_id,status,risk_state) VALUES
    ('${reviewerPrincipalId}','HUMAN','test','reviewer',${reviewerUserId},'ACTIVE','NORMAL'),
    ('${approverPrincipalId}','HUMAN','test','approver',${approverUserId},'ACTIVE','NORMAL'),
    ('${auditorPrincipalId}','HUMAN','test','auditor',${auditorUserId},'ACTIVE','NORMAL');
  INSERT INTO universities (id,name,country,is_active) VALUES (${universityId},'Institution Test University','TR',true);
  INSERT INTO programs (id,university_id,name,is_active,intakes) VALUES (${programId},${universityId},'Institution Test Program',true,'Fall');
  INSERT INTO students (id,first_name,last_name) VALUES (${studentId},'Masked','Applicant');
  INSERT INTO applications (id,student_id,program_id,university_id,intake) VALUES (${applicationId},${studentId},${programId},${universityId},'Fall');
  INSERT INTO institution_relationships (id,tenant_id,institution_id,purpose_code,data_scopes,status)
  VALUES ('${relationshipId}','${tenantId}',${universityId},'admissions.review',ARRAY['application.profile','application.evidence'],'ACTIVE');
  INSERT INTO institution_memberships (id,tenant_id,relationship_id,principal_id,role_package_version_id,legacy_user_id,role_key,status) VALUES
    ('${reviewerMembershipId}','${tenantId}','${relationshipId}','${reviewerPrincipalId}','018f9000-0000-7000-8000-000000000013',${reviewerUserId},'ADMISSIONS_REVIEWER','ACTIVE'),
    ('${approverMembershipId}','${tenantId}','${relationshipId}','${approverPrincipalId}','018f9000-0000-7000-8000-000000000014',${approverUserId},'DECISION_APPROVER','ACTIVE'),
    ('${auditorMembershipId}','${tenantId}','${relationshipId}','${auditorPrincipalId}','018f9000-0000-7000-8000-000000000016',${auditorUserId},'INSTITUTION_AUDITOR','ACTIVE');
  INSERT INTO institution_application_cases (
    id,tenant_id,relationship_id,legacy_application_id,institution_id,program_id,intake_key,
    masked_student_ref,shared_profile,lifecycle_state,readiness_percent
  ) VALUES ('${caseId}','${tenantId}','${relationshipId}',${applicationId},${universityId},${programId},'Fall',
    'APP-TEST-001','{"givenName":"Masked"}'::jsonb,'DECISION_PENDING_APPROVAL',100);
  INSERT INTO institution_decisions (
    id,tenant_id,relationship_id,application_case_id,version_number,decision_type,state,
    reason_code,rationale,maker_membership_id,content_hash,submitted_at
  ) VALUES ('${decisionId}','${tenantId}','${relationshipId}','${caseId}',1,'CONDITIONAL_OFFER','SUBMITTED',
    'ACADEMIC_REVIEW','Fixture decision','${reviewerMembershipId}',repeat('b',64),now());
  INSERT INTO institution_offers (id,tenant_id,relationship_id,application_case_id,decision_id)
  VALUES ('${offerId}','${tenantId}','${relationshipId}','${caseId}','${decisionId}');
`);

process.env.NODE_ENV = "test";
process.env.INSTITUTION_DATABASE_URL = actorUrl;

async function beginAs(userId: number, role: string) {
  await actor.query("BEGIN");
  await actor.query("SELECT set_config('app.legacy_user_id',$1,true)",[String(userId)]);
  await actor.query("SELECT set_config('app.tenant_id',$1,true)",[tenantId]);
  await actor.query("SELECT set_config('app.institution_relationship_id',$1,true)",[relationshipId]);
  await actor.query("SELECT set_config('app.institution_role',$1,true)",[role]);
}
async function rollback() { try { await actor.query("ROLLBACK"); } catch {} }

after(async () => {
  await rollback();
  // The test target is required to be a disposable loopback database above.
  // TRUNCATE is used because append-only row triggers intentionally reject DELETE.
  await admin.query(`TRUNCATE TABLE
    institution_admission_events,institution_decision_approvals,institution_offers,
    institution_enrolments,institution_evidence_assessments,institution_information_requests,
    institution_decisions,institution_requirements,institution_requirement_sets,
    institution_application_cases,institution_sla_policies,institution_memberships,
    institution_relationships CASCADE;
    DELETE FROM applications WHERE id=${applicationId}; DELETE FROM students WHERE id=${studentId};
    DELETE FROM programs WHERE id=${programId}; DELETE FROM universities WHERE id=${universityId};
    DELETE FROM principals WHERE id IN ('${reviewerPrincipalId}','${approverPrincipalId}','${auditorPrincipalId}');
    DELETE FROM users WHERE id IN (${reviewerUserId},${approverUserId},${auditorUserId});
    DELETE FROM tenants WHERE id='${tenantId}';`);
  await actor.end(); await admin.end();
});

test("all institution tables have FORCE RLS and no DELETE policy", async () => {
  const result=await admin.query(`SELECT c.relname,c.relforcerowsecurity,
    count(p.policyname) FILTER(WHERE p.cmd='DELETE')::integer AS delete_policies
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_policies p ON p.schemaname=n.nspname AND p.tablename=c.relname
    WHERE n.nspname='public' AND c.relname LIKE 'institution_%' AND c.relkind='r'
    GROUP BY c.relname,c.relforcerowsecurity`);
  assert.equal(result.rowCount,13);
  assert.equal(result.rows.every(row=>row.relforcerowsecurity===true&&row.delete_policies===0),true);
});

test("server resolves one authoritative membership and versioned capability package", async () => {
  await actor.query("BEGIN");
  await actor.query("SELECT set_config('app.legacy_user_id',$1,true)",[String(reviewerUserId)]);
  const directlyVisible = await actor.query(`SELECT m.id,rd.key,rpv.status,rpv.effective_at
    FROM institution_memberships m
    JOIN principals p ON p.id=m.principal_id AND p.legacy_user_id=m.legacy_user_id
    JOIN role_package_versions rpv ON rpv.id=m.role_package_version_id
    JOIN role_definitions rd ON rd.id=rpv.role_definition_id
    WHERE m.legacy_user_id=$1 AND p.principal_type='HUMAN' AND p.status='ACTIVE'
      AND p.risk_state='NORMAL' AND m.status='ACTIVE' AND m.valid_from<=now()
      AND (m.valid_until IS NULL OR m.valid_until>now()) AND rpv.status='ACTIVE'
      AND rpv.effective_at<=now() AND (rpv.deprecated_at IS NULL OR rpv.deprecated_at>now())
      AND rd.status='ACTIVE' AND rd.key='institution.admissions_reviewer'`,[reviewerUserId]);
  assert.equal(directlyVisible.rowCount,1);
  await rollback();
  const { withInstitutionContext, toPublicInstitutionContext } = await import("../src/lib/institutionAdmissionsStore");
  const resolved = await withInstitutionContext(reviewerUserId, async (client, context) => ({
    context: toPublicInstitutionContext(context),
    visibleCases: Number((await client.query("SELECT count(*)::integer AS count FROM institution_application_cases")).rows[0].count),
  }));
  assert.equal(resolved.context.role,"ADMISSIONS_REVIEWER");
  assert.equal(resolved.context.capabilities.includes("institution.evidence.assess"),true);
  assert.equal(resolved.context.capabilities.includes("institution.decisions.approve"),false);
  assert.equal(resolved.visibleCases,1);
});

test("reviewer sees scoped case and can append evidence but cannot write approval", async () => {
  await beginAs(reviewerUserId,"ADMISSIONS_REVIEWER");
  const visible=await actor.query("SELECT id FROM institution_application_cases");
  assert.deepEqual(visible.rows.map(row=>row.id),[caseId]);
  await actor.query(`INSERT INTO institution_evidence_assessments (
    id,tenant_id,relationship_id,application_case_id,evidence_ref_hash,result,reason_code,
    reviewer_membership_id,assessment_hash
  ) VALUES ($1,$2,$3,$4,repeat('a',64),'VERIFIED','ACADEMIC_RECORD',$5,repeat('c',64))`,
  [assessmentId,tenantId,relationshipId,caseId,reviewerMembershipId]);
  await assert.rejects(actor.query(`INSERT INTO institution_decision_approvals (
    id,tenant_id,relationship_id,decision_id,checker_membership_id,outcome,reason_code,receipt_hash
  ) VALUES ('018f9100-0000-7000-8000-00000000000d',$1,$2,$3,$4,'APPROVED','INVALID',repeat('d',64))`,
  [tenantId,relationshipId,decisionId,reviewerMembershipId]),/row-level security/i);
  await rollback();
});

test("auditor is read-only and reviewer cannot self-approve", async () => {
  await beginAs(auditorUserId,"INSTITUTION_AUDITOR");
  assert.equal((await actor.query("SELECT count(*)::integer AS count FROM institution_application_cases")).rows[0].count,1);
  await assert.rejects(actor.query(`INSERT INTO institution_evidence_assessments (
    id,tenant_id,relationship_id,application_case_id,evidence_ref_hash,result,reason_code,
    reviewer_membership_id,assessment_hash
  ) VALUES ('018f9100-0000-7000-8000-00000000000e',$1,$2,$3,repeat('a',64),'VERIFIED','INVALID',$4,repeat('e',64))`,
  [tenantId,relationshipId,caseId,auditorMembershipId]),/row-level security/i);
  await rollback();

  await beginAs(reviewerUserId,"ADMISSIONS_REVIEWER");
  await assert.rejects(actor.query(`UPDATE institution_decisions SET state='APPROVED',checker_membership_id=$2,
    decided_at=now(),effective_at=now() WHERE id=$1`,[decisionId,reviewerMembershipId]),/invalid institution decision transition|checker/i);
  await rollback();
});

test("decision approver can approve independently and invalid offer jump is rejected", async () => {
  await beginAs(approverUserId,"DECISION_APPROVER");
  await actor.query(`INSERT INTO institution_decision_approvals (
    id,tenant_id,relationship_id,decision_id,checker_membership_id,outcome,reason_code,receipt_hash
  ) VALUES ('018f9100-0000-7000-8000-00000000000f',$1,$2,$3,$4,'APPROVED','CHECKED',repeat('f',64))`,
  [tenantId,relationshipId,decisionId,approverMembershipId]);
  const approved=await actor.query(`UPDATE institution_decisions SET state='APPROVED',checker_membership_id=$2,
    decided_at=now(),effective_at=now() WHERE id=$1 RETURNING state`,[decisionId,approverMembershipId]);
  assert.equal(approved.rows[0].state,"APPROVED");
  await assert.rejects(actor.query("UPDATE institution_offers SET state='ACCEPTED' WHERE id=$1",[offerId]),/invalid institution offer transition/i);
  await rollback();
});

test("append-only evidence cannot be rewritten", async () => {
  await admin.query(`INSERT INTO institution_evidence_assessments (
    id,tenant_id,relationship_id,application_case_id,evidence_ref_hash,result,reason_code,
    reviewer_membership_id,assessment_hash
  ) VALUES ($1,$2,$3,$4,repeat('a',64),'VERIFIED','ACADEMIC_RECORD',$5,repeat('c',64))`,
  [assessmentId,tenantId,relationshipId,caseId,reviewerMembershipId]);
  await assert.rejects(admin.query("UPDATE institution_evidence_assessments SET notes='tamper' WHERE id=$1",[assessmentId]),/append-only/i);
});
