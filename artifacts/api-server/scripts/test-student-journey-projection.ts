import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildStudentJourneyProjection,
  type JourneyPipelineStageInput,
} from "../src/lib/studentJourneyProjection";

const PIPELINE: JourneyPipelineStageInput[] = [
  { key: "inquiry", label: "Inquiry", sortOrder: 10 },
  { key: "documents_collected", label: "Documents", sortOrder: 20 },
  { key: "submitted", label: "Submitted", sortOrder: 30 },
  { key: "offer_received", label: "Offer", sortOrder: 40 },
  { key: "visa_applied", label: "Visa applied", sortOrder: 50 },
  { key: "visa_approved", label: "Visa approved", sortOrder: 60 },
  { key: "enrolled", label: "Enrolled", sortOrder: 70, variant: "won", isCaseClose: true },
  { key: "rejected", label: "Rejected", sortOrder: 80, variant: "lost", isCaseClose: true },
];

const NOW = new Date("2026-09-01T09:00:00.000Z");

test("journey endpoint remains student-only, self-owned and non-cacheable", () => {
  const routesSource = readFileSync(
    new URL("../src/routes/students.ts", import.meta.url),
    "utf8",
  );
  const routeStart = routesSource.indexOf('router.get("/students/me/journey"');
  const routeEnd = routesSource.indexOf("// Task #187", routeStart);
  assert.notEqual(routeStart, -1);
  assert.notEqual(routeEnd, -1);

  const journeyRoute = routesSource.slice(routeStart, routeEnd);
  assert.match(journeyRoute, /router\.get\("\/students\/me\/journey", requireAuth/);
  assert.match(journeyRoute, /user\.role !== "student"/);
  assert.match(journeyRoute, /eq\(studentsTable\.userId, user\.id\)/);
  assert.match(journeyRoute, /eq\(applicationsTable\.studentId, student\.id\)/);
  assert.match(journeyRoute, /eq\(documentsTable\.studentId, student\.id\)/);
  assert.match(journeyRoute, /Cache-Control", "private, no-store"/);
  assert.doesNotMatch(journeyRoute, /req\.params|req\.query|req\.body/);
});

test("no application produces a deterministic discovery action without false progress", () => {
  const projection = buildStudentJourneyProjection({
    applications: [],
    pipelineStages: PIPELINE,
    documents: [],
    missingRequests: [],
    now: NOW,
  });

  assert.equal(projection.source, "pipeline_projection");
  assert.equal(projection.application, null);
  assert.equal(projection.stage.key, "discover");
  assert.equal(projection.nextAction.code, "explore_programs");
  assert.equal(projection.waitingParty, "student");
  assert.equal(projection.progress.percent, 0);
});

test("an open document request outranks newer passive applications", () => {
  const projection = buildStudentJourneyProjection({
    applications: [
      { id: 10, stage: "submitted", updatedAt: "2026-09-01T08:00:00.000Z" },
      { id: 20, stage: "documents_collected", updatedAt: "2026-08-20T08:00:00.000Z" },
    ],
    pipelineStages: PIPELINE,
    documents: [],
    missingRequests: [{ applicationId: 20, respondedAt: null }],
    now: NOW,
  });

  assert.equal(projection.application?.id, 20);
  assert.equal(projection.nextAction.code, "upload_requested_documents");
  assert.equal(projection.nextAction.priority, "high");
  assert.equal(projection.nextAction.openRequestCount, 1);
  assert.equal(projection.evidence.status, "action_required");
});

test("submitted application reports university as the waiting party", () => {
  const projection = buildStudentJourneyProjection({
    applications: [{ id: 10, stage: "submitted" }],
    pipelineStages: PIPELINE,
    documents: [{ applicationId: 10, status: "approved" }],
    missingRequests: [],
    now: NOW,
  });

  assert.equal(projection.nextAction.code, "await_university_decision");
  assert.equal(projection.nextAction.actionable, false);
  assert.equal(projection.waitingParty, "university");
  assert.equal(projection.progress.known, true);
  assert.equal(projection.progress.percent, 33);
  assert.equal(projection.evidence.status, "verified");
});

test("offer deadline is normalized and overdue state raises priority", () => {
  const projection = buildStudentJourneyProjection({
    applications: [{ id: 10, stage: "offer_received", deadline: "2026-08-31T12:00:00Z" }],
    pipelineStages: PIPELINE,
    documents: [],
    missingRequests: [],
    now: NOW,
  });

  assert.equal(projection.nextAction.code, "review_offer");
  assert.equal(projection.nextAction.dueAt, "2026-08-31T12:00:00.000Z");
  assert.equal(projection.nextAction.overdue, true);
  assert.equal(projection.nextAction.priority, "high");
});

test("unknown pipeline stage never manufactures a progress percentage", () => {
  const projection = buildStudentJourneyProjection({
    applications: [{ id: 10, stage: "custom_partner_review" }],
    pipelineStages: PIPELINE,
    documents: [],
    missingRequests: [],
    now: NOW,
  });

  assert.equal(projection.source, "legacy_fallback");
  assert.equal(projection.fallbackReason, "unknown_stage");
  assert.equal(projection.progress.known, false);
  assert.equal(projection.progress.percent, null);
  assert.equal(projection.waitingParty, "unknown");
  assert.equal(projection.nextAction.code, "contact_advisor");
});

test("a responded custom request no longer tells the student to upload again", () => {
  const projection = buildStudentJourneyProjection({
    applications: [{ id: 10, stage: "documents_collected" }],
    pipelineStages: PIPELINE,
    documents: [{ applicationId: 10, status: "pending" }],
    missingRequests: [{ applicationId: 10, respondedAt: "2026-09-01T08:30:00.000Z" }],
    now: NOW,
  });

  assert.equal(projection.evidence.openRequests, 0);
  assert.equal(projection.nextAction.code, "await_document_review");
  assert.equal(projection.waitingParty, "find_and_study");
});

test("terminal won stage reports completion and no primary mutation", () => {
  const projection = buildStudentJourneyProjection({
    applications: [{ id: 10, stage: "enrolled" }],
    pipelineStages: PIPELINE,
    documents: [],
    missingRequests: [],
    now: NOW,
  });

  assert.equal(projection.progress.percent, 100);
  assert.equal(projection.waitingParty, "completed");
  assert.equal(projection.nextAction.code, "journey_complete");
  assert.equal(projection.nextAction.actionable, false);
});

test("missing pipeline configuration is surfaced as a fallback", () => {
  const projection = buildStudentJourneyProjection({
    applications: [{ id: 10, stage: "submitted" }],
    pipelineStages: [],
    documents: [],
    missingRequests: [],
    now: NOW,
  });

  assert.equal(projection.source, "legacy_fallback");
  assert.equal(projection.fallbackReason, "pipeline_unavailable");
  assert.equal(projection.progress.known, true);
  assert.equal(projection.nextAction.code, "await_university_decision");
});
