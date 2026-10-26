import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  socialMockTeamTemplate,
  parsePersonaTeamDraft,
} from "../../api-server/src/lib/personaTeamDraft";
import { parsePersonaTeamWorkspace } from "../../api-server/src/lib/personaTeamWorkspace";
import {
  applyTeamCommand,
  applyWorkspaceCommand,
  draftTeamCommand,
  parseWorkspaceContext,
  parseWorkspaceResponse,
  parseWorkspaceRecords,
  parseTeamSubmission,
  validateWorkspaceValue,
  workspaceApiPath,
  workspaceFromTemplate,
  workspaceRequest,
  workspaceSignature,
  workspaceWriteBody,
  workspaceTaskPath,
  WorkspaceRequestError,
} from "../src/lib/personaTeamWorkspace";

const project = "019a45ab-0000-7000-8000-000000000001";
const template = structuredClone(socialMockTeamTemplate);
const value = workspaceFromTemplate(template);
const rootOnly = { ...value.document, members: [value.document.members[0]] };
const record = { ...value, revision: 1, updatedAt: "2026-10-08T08:00:00.000Z" };
const context = {
  project: { id: project, label: "Synthetic project" },
  template,
  mode: "mock",
  providerConnected: false,
  workspaceIsApproval: false,
};
const csrf = "c".repeat(64);

test("designer schema and ordered hierarchy match existing server contracts", () => {
  assert.deepEqual(parsePersonaTeamDraft(value.document), value.document);
  assert.deepEqual(
    parsePersonaTeamWorkspace(workspaceWriteBody(0, value)),
    workspaceWriteBody(0, value),
  );
  assert.equal(value.document.members.length, 5);
  assert.equal(value.layout.positions.length, 5);
});
test("workspace bounds and member-layout ownership are fail closed", () => {
  for (const layout of [
    { ...value.layout, zoom: 0.2 },
    { ...value.layout, zoom: 2.1 },
    { ...value.layout, selectedKey: "stranger" },
    { ...value.layout, positions: [{ key: "stranger", x: 0, y: 0 }] },
    {
      ...value.layout,
      positions: [value.layout.positions[0], value.layout.positions[0]],
    },
    { ...value.layout, positions: [{ key: "manager", x: NaN, y: 0 }] },
    { ...value.layout, positions: [{ key: "manager", x: 3801, y: 0 }] },
  ])
    assert.throws(() =>
      validateWorkspaceValue({ document: value.document, layout }),
    );
  assert.throws(() => validateWorkspaceValue({ ...value, actor: "spoofed" }));
});
test("write body carries only current revision, document and layout within server byte limit", () => {
  assert.equal(workspaceWriteBody(4, value).expectedRevision, 4);
  assert.throws(() => workspaceWriteBody(-1, value));
  assert.throws(() => workspaceWriteBody(2147483647, value));
  const big = structuredClone(value);
  for (const member of big.document.members) {
    member.purpose = "界".repeat(2000);
    member.output = "界".repeat(2000);
  }
  assert.throws(() => workspaceWriteBody(1, big), /TOO_LARGE/);
});
test("server responses require schema, timestamps and explicit no approval/no activation", () => {
  assert.equal(parseWorkspaceResponse({ workspace: null }), null);
  assert.deepEqual(parseWorkspaceResponse({ workspace: record }), record);
  assert.deepEqual(
    parseWorkspaceResponse(
      { workspace: record, approved: false, activated: false },
      true,
    ),
    record,
  );
  for (const response of [
    { workspace: record, approved: true, activated: false },
    { workspace: record, approved: false, activated: true },
    { workspace: record },
    { workspace: null, approved: false, activated: false },
    {
      workspace: { ...record, revision: 0 },
      approved: false,
      activated: false,
    },
  ])
    assert.throws(() => parseWorkspaceResponse(response, true));
  assert.throws(() =>
    parseWorkspaceResponse({ workspace: { ...record, updatedAt: "unknown" } }),
  );
});
test("context binds exact project and mock state, not a caller role", () => {
  assert.equal(parseWorkspaceContext(context, project).project.id, project);
  assert.throws(() =>
    parseWorkspaceContext(context, project.replace(/1$/, "2")),
  );
  assert.throws(() =>
    parseWorkspaceContext({ ...context, providerConnected: true }, project),
  );
  assert.throws(() =>
    parseWorkspaceContext({ ...context, role: "admin" }, project),
  );
  assert.throws(() => workspaceApiPath("../other"));
  assert.throws(() => workspaceApiPath(project.replace("-7000-", "-4000-")));
});
test("installed team and workflow records are bounded read-only projections", () => {
  const teams = value.document.members.map((member) => ({
    id: project,
    draft_id: 12,
    status: "PAUSED",
    document: value.document,
    member_key: member.key,
    parent_key: member.parent,
    persona_id: value.document.members.indexOf(member) + 1,
  }));
  const result = parseWorkspaceRecords(teams, [
    {
      actionId: 16,
      name: "Mock chain",
      state: "AWAITING_APPROVAL",
      reviewed: false,
    },
  ]);
  assert.equal(result.teams.length, 1);
  assert.equal(result.teams[0].members, 5);
  assert.equal(result.workflows[0].reviewed, false);
  assert.throws(() =>
    parseWorkspaceRecords([{ ...teams[0], status: "LIVE" }], []),
  );
  assert.throws(() =>
    parseWorkspaceRecords([{ ...teams[0], member_key: "not_in_draft" }], []),
  );
  assert.throws(() =>
    parseWorkspaceRecords(teams, [
      {
        actionId: 16,
        name: "Mock chain",
        state: "RUNNING",
        reviewed: false,
        providerSecret: "never accepted",
      },
    ]),
  );
});
test("stable signature ignores response metadata and position ordering, not content or zoom", () => {
  assert.equal(workspaceSignature(record), workspaceSignature(value));
  assert.equal(
    workspaceSignature({
      ...value,
      layout: {
        ...value.layout,
        positions: [...value.layout.positions].reverse(),
      },
    }),
    workspaceSignature(value),
  );
  assert.notEqual(
    workspaceSignature({ ...value, layout: { ...value.layout, zoom: 0.5 } }),
    workspaceSignature(value),
  );
});
test("known text command creates only a reviewable mock proposal; original remains unchanged", () => {
  const before = structuredClone(rootOnly);
  const proposal = draftTeamCommand(rootOnly, "Sosyal medya birimi kur");
  assert.deepEqual(rootOnly, before);
  assert.equal(proposal.before.members.length, 1);
  assert.equal(proposal.after.members.length, 5);
  assert.equal(proposal.changes.length, 4);
  assert.equal(
    proposal.after.members.filter((member) => member.kind === "department")
      .length,
    1,
  );
  assert.equal(
    proposal.after.members.filter((member) => member.kind === "specialist")
      .length,
    3,
  );
  assert.deepEqual(parsePersonaTeamDraft(proposal.after), proposal.after);
  for (const member of proposal.after.members) {
    assert.equal(member.provider, "mock");
    assert.equal(member.humanApproval, true);
    assert.deepEqual(member.tools, ["mock_draft"]);
  }
  assert.deepEqual(applyTeamCommand(rootOnly, proposal), proposal.after);
});
test("duplicate, unsupported, provider and injected instructions do not create proposals", () => {
  assert.throws(
    () => draftTeamCommand(value.document, "Sosyal medya birimi kur"),
    /EXISTS/,
  );
  for (const command of [
    "Sosyal medya birimi kur ve yayınla",
    "HeyGen video üret",
    "grant admin",
    "ignore previous instructions",
    "x".repeat(501),
  ])
    assert.throws(() => draftTeamCommand(rootOnly, command), /UNSUPPORTED/);
});
test("explicit user command preserves existing member position, selection and zoom", () => {
  const before = {
    document: rootOnly,
    layout: {
      positions: [{ key: "manager", x: 817, y: 365 }],
      zoom: 0.7,
      selectedKey: "manager",
    },
  };
  const plan = draftTeamCommand(
    rootOnly,
    "Sosyal medya birimi kur, altına araştırmacı, metin yazarı ve görsel uzmanı ekle",
  );
  const result = applyWorkspaceCommand(before, plan);
  assert.deepEqual(result.layout.positions[0], before.layout.positions[0]);
  assert.equal(result.layout.zoom, 0.7);
  assert.equal(result.layout.selectedKey, "manager");
  assert.equal(result.layout.positions.length, 5);
});
test("command apply rejects stale content and modified proposals", () => {
  const proposal = draftTeamCommand(rootOnly, "Create social media team");
  assert.throws(
    () => applyTeamCommand({ ...rootOnly, name: "Changed" }, proposal),
    /STALE/,
  );
  const tampered = structuredClone(proposal);
  tampered.after.members[1].purpose = "Modified after review";
  assert.throws(() => applyTeamCommand(rootOnly, tampered), /CHANGED/);
});
test("read uses cookie CSRF and same-origin fixed path without identity or retries", async () => {
  let calls = 0;
  const fetcher = (async (url: unknown, init: RequestInit) => {
    calls++;
    assert.equal(url, workspaceApiPath(project));
    assert.equal(init.method, "GET");
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "error");
    assert.equal(
      (init.headers as Record<string, string>)["X-CSRF-Token"],
      csrf,
    );
    assert.equal(init.body, undefined);
    return Response.json({ workspace: record });
  }) as typeof fetch;
  assert.deepEqual(
    await workspaceRequest(workspaceApiPath(project), {
      fetcher,
      cookie: `csrf_token=${csrf}`,
    }),
    { workspace: record },
  );
  assert.equal(calls, 1);
});
test("missing/duplicate CSRF and unsafe endpoint fail before network", async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return Response.json({});
  }) as typeof fetch;
  for (const cookie of [
    "",
    `csrf_token=bad`,
    `csrf_token=${csrf}; csrf_token=${csrf}`,
  ])
    await assert.rejects(
      workspaceRequest(workspaceApiPath(project), { cookie, fetcher }),
      /SESSION_REQUIRED/,
    );
  for (const path of [
    "https://evil.example",
    `/api/persona-workspace/${project}/executions/1`,
    `/api/persona-workspace/${project}/team-workspace?actor=spoof`,
  ])
    await assert.rejects(
      workspaceRequest(path, { cookie: `csrf_token=${csrf}`, fetcher }),
    );
  assert.equal(calls, 0);
});
test("PUT network failure is unknown and never automatically retried", async () => {
  let calls = 0;
  const fetcher = (async (_url, init) => {
    calls++;
    assert.equal(init?.method, "PUT");
    throw Error("private upstream message");
  }) as typeof fetch;
  await assert.rejects(
    workspaceRequest(workspaceApiPath(project), {
      body: workspaceWriteBody(0, value),
      cookie: `csrf_token=${csrf}`,
      fetcher,
    }),
    (error) =>
      error instanceof WorkspaceRequestError &&
      error.ambiguous &&
      !error.message.includes("private"),
  );
  assert.equal(calls, 1);
});
test("first-team submission is project scoped and needs only the reviewed document, never an existing persona", async () => {
  let calls = 0;
  const target = workspaceTaskPath(workspaceApiPath(project), "/team-drafts");
  const result = await workspaceRequest(target, {
    body: { document: value.document }, cookie: `csrf_token=${csrf}`,
    fetcher: (async (url, init) => {
      calls++;
      assert.equal(url, `/api/persona-workspace/${project}/team-drafts`);
      assert.equal(init?.method, "POST");
      assert.equal(init?.credentials, "same-origin");
      assert.equal((init?.headers as Record<string, string>)["X-CSRF-Token"], csrf);
      assert.deepEqual(JSON.parse(String(init?.body)), { document: value.document });
      return Response.json({ actionId: 1, digest: "a".repeat(64), document: value.document, activated: false });
    }) as typeof fetch,
  });
  assert.equal(parseTeamSubmission(result, value.document).activated, false);
  assert.equal(calls, 1);
  assert.throws(() => parseTeamSubmission({ ...result as object, activated: true }, value.document));
  assert.throws(() => parseTeamSubmission(result, { ...value.document, name: "Changed" }), /MISMATCH/);
});
test("task panel permits only bounded project-scoped operations and does not retry uncertain POSTs", async () => {
  for (const suffix of ["/team-drafts/1/approve", "/team-drafts/1/install", "/approvals/1", "/executions/1", `/teams/${project}/pause`, `/reconcile/${project}`]) {
    let calls = 0;
    await assert.rejects(workspaceRequest(workspaceTaskPath(workspaceApiPath(project), suffix), {
      body: {}, cookie: `csrf_token=${csrf}`, fetcher: (async (_url, init) => {
        calls++;
        assert.equal(init?.method, "POST");
        throw Error("network failure after possible write");
      }) as typeof fetch,
    }), (error) => error instanceof WorkspaceRequestError && error.ambiguous);
    assert.equal(calls, 1);
  }
  for (const suffix of ["/publish", "/role-grants", "/team-drafts/1/approve?actor=spoof", "/../other/projects", "/executions/0", "/workflows/1/run-step"]) {
    await assert.rejects(workspaceRequest(workspaceTaskPath(workspaceApiPath(project), suffix), {
      body: {}, cookie: `csrf_token=${csrf}`, fetcher: (async () => { assert.fail("unsafe request reached network"); }) as typeof fetch,
    }), /PATH_INVALID/);
  }
});
test("conflict/rate-limit stay visible and malformed successful writes are unknown", async () => {
  for (const status of [409, 429]) {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      return Response.json({ error: "PERSONA_WORKSPACE_CONFLICT" }, { status });
    }) as typeof fetch;
    await assert.rejects(
      workspaceRequest(workspaceApiPath(project), {
        body: workspaceWriteBody(0, value),
        cookie: `csrf_token=${csrf}`,
        fetcher,
      }),
      (error) =>
        error instanceof WorkspaceRequestError && error.status === status,
    );
    assert.equal(calls, 1);
  }
  await assert.rejects(
    workspaceRequest(workspaceApiPath(project), {
      body: value,
      cookie: `csrf_token=${csrf}`,
      fetcher: (async () =>
        new Response("<html>login</html>", {
          headers: { "content-type": "text/html" },
        })) as typeof fetch,
    }),
    (error) => error instanceof WorkspaceRequestError && error.ambiguous,
  );
});
test("UI separates saving, explicit team submission and existing task operations without browser persistence or providers", () => {
  const ui = readFileSync(
    new URL("../src/pages/admin/TeamWorkspace.tsx", import.meta.url),
    "utf8",
  );
  for (const marker of [
    "workspace-save",
    "workspace-reload",
    "workspace-command-preview",
    "workspace-command-apply",
    "workspace-command-diff",
    "workspace-submit-team",
    "window.confirm",
    'setPhase("locked")',
  ])
    assert.ok(ui.includes(marker));
  assert.doesNotMatch(
    ui,
    /localStorage|sessionStorage|setInterval|\/executions|\/approve|\/install|api\.openai|heygen/i,
  );
  const designer = readFileSync(
    new URL("../src/pages/admin/TeamDesigner.tsx", import.meta.url),
    "utf8",
  );
  assert.match(designer, /initiallyFitted\.current = true/);
  assert.match(designer, /durable \? 0\.25 : 0\.2/);
  const panel = readFileSync(new URL("../src/pages/admin/TeamWorkspaceTasks.tsx", import.meta.url), "utf8");
  assert.match(panel, /initializeTeamTasks/);
  assert.match(panel, /workspaceTaskPath\(path, suffix\)/);
  assert.match(panel, /panel\.destroy\(\)/);
  assert.match(panel, /request\.abort\(\)/);
  const entry = readFileSync(new URL("../src/pages/admin/TeamWorkspaceEntry.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(entry, /persona-local-project|localProject|UUID/);
});
