#!/usr/bin/env node
import { fileURLToPath } from "node:url";

const EXACT_STAGING_ORIGIN = "https://staging.findandstudy.com";
const EMAILS = {
  superAdmin: "audit-superadmin@audit.test",
  staff: "audit-staff@audit.test",
  agent: "audit-agent@audit.test",
  student: "audit-student@audit.test",
};

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function fail(message) {
  throw new Error(`[staging-workflow-uat] BLOCKED: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function parseSetCookies(headers) {
  const values =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => value.split(";", 1)[0]);
}

function mergeCookies(cookieJar, response) {
  for (const cookie of parseSetCookies(response.headers)) {
    const separator = cookie.indexOf("=");
    if (separator <= 0) continue;
    const name = cookie.slice(0, separator);
    const value = cookie.slice(separator + 1);
    if (value) cookieJar.set(name, value);
    else cookieJar.delete(name);
  }
}

function cookieHeader(cookieJar) {
  return [...cookieJar.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

async function responseBody(response, context) {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    fail(`${context} did not return application/json`);
  }
  try {
    return JSON.parse(text);
  } catch {
    fail(`${context} returned malformed JSON`);
  }
}

class Session {
  constructor(origin) {
    this.origin = origin;
    this.cookies = new Map();
    this.csrf = "";
    this.identity = null;
  }

  async request(path, options = {}) {
    const url = new URL(path, this.origin);
    if (url.origin !== this.origin) {
      fail(`request target escaped the fixed staging origin: ${url.origin}`);
    }
    const headers = new Headers(options.headers ?? {});
    const cookies = cookieHeader(this.cookies);
    if (cookies) headers.set("cookie", cookies);
    const method = String(options.method ?? "GET").toUpperCase();
    if (!["GET", "HEAD", "OPTIONS"].includes(method) && this.csrf) {
      headers.set("x-csrf-token", this.csrf);
    }
    const response = await fetch(url, {
      ...options,
      method,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    mergeCookies(this.cookies, response);
    if (this.cookies.get("csrf_token")) {
      this.csrf = this.cookies.get("csrf_token");
    }
    return response;
  }

  async call(path, options = {}, expectedStatuses = [200]) {
    const response = await this.request(path, options);
    const body = await responseBody(response, `${options.method ?? "GET"} ${path}`);
    if (!expectedStatuses.includes(response.status)) {
      const code = body && typeof body === "object" ? body.code ?? body.error : null;
      fail(
        `${options.method ?? "GET"} ${path} expected ${expectedStatuses.join(" or ")}, received ${response.status}${code ? ` (${String(code)})` : ""}`,
      );
    }
    return { response, body };
  }

  async login(email, password, expectedRole) {
    const initial = await this.request("/api/auth/me");
    assert(
      initial.status === 401 && this.cookies.has("csrf_token"),
      `${expectedRole} CSRF preflight failed`,
    );
    const { body } = await this.call(
      "/api/auth/login",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      },
      [200],
    );
    assert(
      body?.user?.email === email && body?.user?.role === expectedRole,
      `${expectedRole} login identity mismatch`,
    );
    assert(this.cookies.has("sid"), `${expectedRole} login did not issue a session`);
    this.identity = { email, role: expectedRole };
  }

  async logout() {
    if (!this.cookies.has("sid")) return;
    await this.call("/api/auth/logout", { method: "POST" }, [204]);
    assert(!this.cookies.has("sid"), `${this.identity?.role ?? "unknown"} logout retained sid`);
  }
}

function listRows(body) {
  if (Array.isArray(body)) return body;
  for (const key of ["data", "items", "students", "applications", "leads"]) {
    if (Array.isArray(body?.[key])) return body[key];
  }
  return [];
}

function jsonRequest(method, body) {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function bestEffort(cleanupErrors, label, action) {
  try {
    await action();
  } catch (error) {
    cleanupErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function run() {
  if (process.env.ALLOW_STAGING_WORKFLOW_UAT !== "true") {
    fail("ALLOW_STAGING_WORKFLOW_UAT=true is required");
  }
  if (process.env.ALLOW_LIVE_INTEGRATIONS !== "false") {
    fail("ALLOW_LIVE_INTEGRATIONS=false is required");
  }
  const origin = (process.env.STAGING_BASE_URL ?? "").replace(/\/$/, "");
  if (origin !== EXACT_STAGING_ORIGIN) {
    fail(`STAGING_BASE_URL must be exact ${EXACT_STAGING_ORIGIN}`);
  }
  const password = process.env.RBAC_E2E_PASSWORD ?? "";
  if (password.length < 20 || password.length > 128) {
    fail("RBAC_E2E_PASSWORD must contain 20-128 characters");
  }
  const expectedCommit = process.env.STAGING_EXPECTED_SOURCE_COMMIT ?? "";
  if (!/^[0-9a-f]{40}$/.test(expectedCommit)) {
    fail("STAGING_EXPECTED_SOURCE_COMMIT must be an exact lowercase commit");
  }
  const expectedReleaseId = process.env.STAGING_EXPECTED_RELEASE_ID ?? "";
  if (
    !/^staging-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$/.test(expectedReleaseId) ||
    !expectedReleaseId.endsWith(expectedCommit.slice(0, 12))
  ) {
    fail("STAGING_EXPECTED_RELEASE_ID must bind the exact deployed commit");
  }

  const health = await fetch(`${origin}/api/health`, {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const healthBody = await responseBody(health, "health");
  assert(
    health.status === 200 &&
      healthBody?.dbConnected === true &&
      healthBody?.releaseId === expectedReleaseId,
    "health release or database identity mismatch",
  );

  const runStamp = Date.now().toString(36);
  const runId = `stg-workflow-${runStamp}`;
  const runDigits = String(Date.now()).slice(-4);
  const leadEmail = `workflow-${runStamp}@audit.test`;
  const leadPassport = `ZX${runStamp.slice(-8).toUpperCase()}`;
  const portalPassport = `ZY${runStamp.slice(-8).toUpperCase()}`;
  const superAdmin = new Session(origin);
  const staff = new Session(origin);
  const agent = new Session(origin);
  const student = new Session(origin);
  const sessions = [superAdmin, staff, agent, student];
  const cleanupErrors = [];
  const state = {
    leadId: null,
    leadStudentId: null,
    leadApplicationId: null,
    studentApplicationId: null,
    requestId: null,
    responseDocumentId: null,
    responseObjectPath: null,
    unexpectedEmptyDocumentId: null,
    auditStudentId: null,
    auditStudentOriginal: null,
    auditStudentChanged: false,
  };
  let checks = 1;
  let primaryError = null;

  try {
    await superAdmin.login(EMAILS.superAdmin, password, "super_admin");
    await staff.login(EMAILS.staff, password, "staff");
    await agent.login(EMAILS.agent, password, "agent");
    await student.login(EMAILS.student, password, "student");
    checks += 8;

    const { body: agentMe } = await agent.call("/api/agents/me");
    assert(Number.isInteger(agentMe?.id), "agent profile was not resolved");
    checks += 1;

    const { body: lead } = await agent.call(
      "/api/leads",
      jsonRequest("POST", {
        firstName: "Workflow",
        lastName: "Audit",
        email: leadEmail,
        phone: `+90555000${runDigits}`,
        nationality: "Turkey",
        source: "staging_workflow_uat",
        notes: runId,
      }),
      [201],
    );
    assert(Number.isInteger(lead?.id), "agent lead creation did not return an id");
    assert(lead.agentId === agentMe.id, "agent lead was not bound to the signed-in agency");
    state.leadId = lead.id;
    checks += 2;

    const { body: agentLead } = await agent.call(`/api/leads/${lead.id}`);
    assert(agentLead?.id === lead.id, "agent could not read its own lead");
    await staff.call(`/api/leads/${lead.id}`, {}, [404]);
    checks += 2;

    const { body: conversion } = await agent.call(
      `/api/leads/${lead.id}/convert`,
      jsonRequest("POST", {}),
    );
    assert(
      Number.isInteger(conversion?.student?.id) && conversion?.alreadyConverted === false,
      "lead conversion did not create one student",
    );
    state.leadStudentId = conversion.student.id;
    checks += 1;

    const { body: agentStudent } = await agent.call(
      `/api/students/${state.leadStudentId}`,
    );
    assert(
      agentStudent?.id === state.leadStudentId && agentStudent?.agentId === agentMe.id,
      "converted student escaped agent ownership",
    );
    await superAdmin.call(
      `/api/students/${state.leadStudentId}`,
      jsonRequest("PATCH", { passportNumber: leadPassport }),
    );
    checks += 2;

    const { body: leadApplication } = await agent.call(
      "/api/applications",
      jsonRequest("POST", {
        studentId: state.leadStudentId,
        stage: "inquiry",
        universityName: "Synthetic Workflow University",
        programName: "Synthetic Workflow Programme",
        country: "Turkey",
        notes: runId,
      }),
      [201],
    );
    assert(
      Number.isInteger(leadApplication?.id) &&
        leadApplication?.studentId === state.leadStudentId &&
        leadApplication?.agentId === agentMe.id,
      "agent application ownership mismatch",
    );
    state.leadApplicationId = leadApplication.id;
    await agent.call(`/api/applications/${leadApplication.id}`);
    checks += 2;

    const { body: studentList } = await superAdmin.call(
      `/api/students?search=${encodeURIComponent(EMAILS.student)}&limit=5`,
    );
    const auditStudent = listRows(studentList).find(
      (row) => row?.email === EMAILS.student,
    );
    assert(Number.isInteger(auditStudent?.id), "fixed synthetic student profile missing");
    state.auditStudentId = auditStudent.id;
    const { body: auditStudentFull } = await superAdmin.call(
      `/api/students/${auditStudent.id}`,
    );
    state.auditStudentOriginal = {
      phone: auditStudentFull?.phone ?? null,
      nationality: auditStudentFull?.nationality ?? null,
      passportNumber: auditStudentFull?.passportNumber ?? null,
      address: auditStudentFull?.address ?? null,
      addressCity: auditStudentFull?.addressCity ?? null,
      postalCode: auditStudentFull?.postalCode ?? null,
    };
    await superAdmin.call(
      `/api/students/${auditStudent.id}`,
      jsonRequest("PATCH", {
        phone: `+90555100${runDigits}`,
        nationality: "Turkey",
        passportNumber: portalPassport,
      }),
    );
    state.auditStudentChanged = true;
    checks += 3;

    const emptyResponse = await student.request(
      "/api/documents",
      jsonRequest("POST", {
        name: `${runId}-empty.png`,
        type: "other",
        studentId: auditStudent.id,
        notes: `${runId}:empty-content-negative-control`,
      }),
    );
    const emptyBody = await responseBody(emptyResponse, "metadata-only document guard");
    if (emptyResponse.status === 201 && Number.isInteger(emptyBody?.id)) {
      state.unexpectedEmptyDocumentId = emptyBody.id;
    }
    assert(
      emptyResponse.status === 400 && emptyBody?.code === "DOCUMENT_CONTENT_REQUIRED",
      `metadata-only document was not rejected safely (HTTP ${emptyResponse.status})`,
    );
    checks += 1;

    const { body: studentApplication } = await superAdmin.call(
      "/api/applications",
      jsonRequest("POST", {
        studentId: auditStudent.id,
        stage: "inquiry",
        universityName: "Synthetic Student University",
        programName: "Synthetic Evidence Programme",
        country: "Turkey",
        notes: runId,
      }),
      [201],
    );
    assert(Number.isInteger(studentApplication?.id), "student application creation failed");
    state.studentApplicationId = studentApplication.id;
    checks += 1;

    const customTitle = `Synthetic evidence ${runStamp}`;
    const { body: requests } = await superAdmin.call(
      `/api/applications/${studentApplication.id}/missing-doc-notes`,
      jsonRequest("POST", {
        stage: "inquiry",
        items: [{ customTitle, note: runId }],
      }),
    );
    const requestRow = listRows(requests).find(
      (row) => row?.isCustom === true && row?.fileName === customTitle,
    );
    assert(Number.isInteger(requestRow?.id), "custom document request was not persisted");
    state.requestId = requestRow.id;
    checks += 1;

    const { body: openRequests } = await student.call("/api/students/me/missing-docs");
    const studentRequest = listRows(openRequests).find(
      (row) => row?.id === requestRow.id && row?.applicationId === studentApplication.id,
    );
    assert(
      studentRequest?.fulfilledAt == null && studentRequest?.respondedAt == null,
      "student did not receive the exact open document request",
    );
    await student.call(
      `/api/applications/${studentApplication.id}/missing-doc-notes`,
      jsonRequest("POST", { items: [{ customTitle: "Forbidden" }] }),
      [403],
    );
    await student.call(
      `/api/applications/${studentApplication.id}/missing-doc-notes/${requestRow.id}`,
      jsonRequest("PATCH", { fulfilled: true }),
      [403],
    );
    checks += 3;

    const { body: uploadGrant } = await student.call(
      "/api/storage/uploads/request-url",
      jsonRequest("POST", {
        name: `${runId}.png`,
        size: PNG_BYTES.length,
        contentType: "image/png",
        prefix: "student-documents/staging-workflow-uat",
      }),
    );
    assert(
      typeof uploadGrant?.uploadURL === "string" &&
        uploadGrant.uploadURL.startsWith("/api/storage/local-upload/") &&
        typeof uploadGrant?.objectPath === "string" &&
        uploadGrant.objectPath.startsWith("/objects/student-documents/staging-workflow-uat/"),
      "upload grant escaped the fixed local synthetic prefix",
    );
    state.responseObjectPath = uploadGrant.objectPath;
    await student.call(
      uploadGrant.uploadURL,
      {
        method: "PUT",
        headers: {
          "content-type": "image/png",
          "content-length": String(PNG_BYTES.length),
        },
        body: PNG_BYTES,
      },
    );
    checks += 2;

    const { body: responseDocument } = await student.call(
      "/api/documents",
      jsonRequest("POST", {
        name: `${runId}.png`,
        type: "other",
        studentId: auditStudent.id,
        applicationId: studentApplication.id,
        fileKey: uploadGrant.objectPath,
        mimeType: "image/png",
        sizeBytes: PNG_BYTES.length,
        originalFileName: `${runId}.png`,
        respondingToNoteId: requestRow.id,
        notes: runId,
      }),
      [201],
    );
    assert(Number.isInteger(responseDocument?.id), "student response document was not persisted");
    state.responseDocumentId = responseDocument.id;
    checks += 1;

    let respondedRequest = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const { body: latestRequests } = await student.call("/api/students/me/missing-docs");
      respondedRequest = listRows(latestRequests).find((row) => row?.id === requestRow.id);
      if (respondedRequest?.respondedAt) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(
      respondedRequest?.respondedAt && respondedRequest?.fulfilledAt == null,
      "student response did not remain OPEN and awaiting staff verification",
    );
    checks += 1;

    await superAdmin.call(
      `/api/applications/${studentApplication.id}/missing-doc-notes/${requestRow.id}`,
      jsonRequest("PATCH", { fulfilled: true }),
    );
    const { body: afterFulfilment } = await student.call("/api/students/me/missing-docs");
    assert(
      !listRows(afterFulfilment).some((row) => row?.id === requestRow.id),
      "fulfilled request remained in the student's open queue",
    );
    checks += 2;

    const { body: studentApplications } = await student.call("/api/applications?limit=200");
    const visibleApplicationIds = new Set(
      listRows(studentApplications).map((row) => row?.id).filter(Number.isInteger),
    );
    assert(
      visibleApplicationIds.has(studentApplication.id) &&
        !visibleApplicationIds.has(leadApplication.id),
      "student application projection crossed ownership boundaries",
    );
    await agent.call("/api/finance/university-receivables", {}, [403]);
    await agent.call("/api/conversations", {}, [403]);
    await student.call("/api/finance/university-receivables", {}, [403]);
    await student.call("/api/conversations", {}, [403]);
    checks += 5;
  } catch (error) {
    primaryError = error;
  } finally {
    if (state.unexpectedEmptyDocumentId) {
      await bestEffort(cleanupErrors, "empty document cleanup", async () => {
        await superAdmin.call(
          `/api/documents/${state.unexpectedEmptyDocumentId}`,
          { method: "DELETE" },
          [204, 404],
        );
      });
    }
    if (state.responseDocumentId) {
      await bestEffort(cleanupErrors, "response document cleanup", async () => {
        await superAdmin.call(
          `/api/documents/${state.responseDocumentId}`,
          { method: "DELETE" },
          [204, 404],
        );
      });
    }
    if (state.studentApplicationId) {
      await bestEffort(cleanupErrors, "student application purge", async () => {
        await superAdmin.call(
          `/api/applications/${state.studentApplicationId}/purge`,
          { method: "POST" },
          [200],
        );
      });
    }
    if (state.auditStudentChanged && state.auditStudentId && state.auditStudentOriginal) {
      await bestEffort(cleanupErrors, "student fixture restore", async () => {
        await superAdmin.call(
          `/api/students/${state.auditStudentId}`,
          jsonRequest("PATCH", state.auditStudentOriginal),
          [200],
        );
      });
    }
    if (state.leadApplicationId) {
      await bestEffort(cleanupErrors, "agent application purge", async () => {
        await superAdmin.call(
          `/api/applications/${state.leadApplicationId}/purge`,
          { method: "POST" },
          [200],
        );
      });
    }
    if (state.leadStudentId) {
      await bestEffort(cleanupErrors, "converted student archive", async () => {
        await superAdmin.call(
          `/api/students/${state.leadStudentId}`,
          { method: "DELETE" },
          [204, 404],
        );
      });
      await bestEffort(cleanupErrors, "converted student purge", async () => {
        await superAdmin.call(
          `/api/students/${state.leadStudentId}/purge`,
          { method: "POST" },
          [200, 404],
        );
      });
    }
    if (state.leadId) {
      await bestEffort(cleanupErrors, "agent lead purge", async () => {
        await superAdmin.call(
          `/api/leads/${state.leadId}/purge`,
          { method: "POST" },
          [200, 404],
        );
      });
    }
    for (const session of sessions) {
      await bestEffort(cleanupErrors, `${session.identity?.role ?? "unknown"} logout`, () =>
        session.logout(),
      );
    }
  }

  if (primaryError) throw primaryError;
  if (cleanupErrors.length > 0) {
    fail(`cleanup did not reconcile: ${cleanupErrors.join(" | ")}`);
  }

  console.log(
    `[staging-workflow-uat] PASS: run=${runId} checks=${checks} release=${expectedReleaseId} externalWrites=0 cleanup=API_COMPLETE objectPath=${state.responseObjectPath ?? "none"}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

export {
  EMAILS,
  EXACT_STAGING_ORIGIN,
  Session,
  listRows,
  parseSetCookies,
  run,
};
