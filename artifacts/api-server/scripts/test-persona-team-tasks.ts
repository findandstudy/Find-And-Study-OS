import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
// @ts-ignore Browser module exports independently testable projection helpers.
import {
  installedTeamChoices,
  describeTeamChanges,
  mockCostLabel,
  initializeTeamTasks,
} from "../src/lib/persona-team-tasks.client.js";
import { socialMockTeamTemplate } from "../src/lib/personaTeamDraft";

const teamId = "0199ad70-0000-7000-8000-000000000123";
const makeFixtures = () => {
  const document = structuredClone(socialMockTeamTemplate);
  const drafts = [
    {
      action_id: 71,
      document,
      digest: "a".repeat(64),
      maker: "maker",
      reviewer: "reviewer",
    },
  ];
  const teams = document.members.map((member, index) => ({
    id: teamId,
    draft_id: 71,
    status: "MOCK_READY",
    document,
    member_key: member.key,
    parent_key: member.parent,
    persona_id: 100 + index,
  }));
  return { drafts, teams };
};

test("installed members require exact approved source and complete explicit server bindings", () => {
  const { drafts, teams } = makeFixtures();
  const choices = installedTeamChoices(teams, drafts);
  assert.equal(choices.length, 1);
  assert.equal(
    choices[0].members.find((member: any) => member.key === "research")
      .personaId,
    102,
  );
  assert.equal(installedTeamChoices(teams, []).length, 0);
  assert.equal(installedTeamChoices(teams, [...drafts, ...drafts]).length, 0);
  assert.equal(
    installedTeamChoices(teams, [{ ...drafts[0], reviewer: null }]).length,
    0,
  );
  assert.equal(installedTeamChoices(teams.slice(1), drafts).length, 0);
  assert.equal(installedTeamChoices([...teams, teams[0]], drafts).length, 0);
  assert.equal(
    installedTeamChoices(
      teams.map((row, index) =>
        index ? row : { ...row, parent_key: "wrong" },
      ),
      drafts,
    ).length,
    0,
  );
  assert.equal(
    installedTeamChoices(
      teams.map((row, index) =>
        index ? row : { ...row, persona_id: teams[1].persona_id },
      ),
      drafts,
    ).length,
    0,
  );
});

test("same names or member keys cannot connect a different draft to an installed team", () => {
  const { drafts, teams } = makeFixtures();
  const changed = structuredClone(drafts[0]);
  changed.document.members[0].purpose = "Changed instruction";
  assert.equal(installedTeamChoices(teams, [changed]).length, 0);
  assert.equal(
    installedTeamChoices(
      teams.map((row) => ({ ...row, draft_id: 72 })),
      drafts,
    ).length,
    0,
  );
  assert.equal(
    installedTeamChoices(
      teams.map((row) => ({ ...row, status: "LIVE" })),
      drafts,
    ).length,
    0,
  );
});

test("installed teams remain assignable beyond the recent draft window only with exact reviewed server source", () => {
  const { drafts, teams } = makeFixtures();
  const reviewer = "0199ad70-0000-7000-8000-000000000124";
  const source = { ...drafts[0], reviewer };
  const bound = teams.map(row => ({ ...row, source_digest: source.digest, source_reviewer: reviewer }));
  const choices = installedTeamChoices(bound, []);
  assert.equal(choices.length, 1);
  assert.equal(choices[0].draftId, 71);
  assert.equal(choices[0].members.find((member: any) => member.key === "research").personaId, 102);
  assert.equal(installedTeamChoices(bound, [source]).length, 1);

  for (const patch of [
    { source_digest: undefined }, { source_digest: "invalid" },
    { source_digest: "b".repeat(64) }, { source_reviewer: undefined },
    { source_reviewer: null }, { source_reviewer: "invented-reviewer" },
    { source_reviewer: "0199ad70-0000-7000-8000-000000000125" },
  ]) {
    const changed = bound.map((row, index) => index ? row : { ...row, ...patch });
    assert.equal(installedTeamChoices(changed, []).length, 0);
    assert.equal(installedTeamChoices(changed, [source]).length, 0);
  }
  assert.equal(installedTeamChoices(bound, [{ ...source, digest: "b".repeat(64) }]).length, 0);
  assert.equal(installedTeamChoices(bound, [{ ...source, reviewer: null }]).length, 0);
  assert.equal(installedTeamChoices(bound, [{ ...source, document: { ...source.document, name: "Changed" } }]).length, 0);
  assert.equal(installedTeamChoices(bound, [source, source]).length, 0);
  assert.equal(installedTeamChoices(bound.slice(1), []).length, 0);
});

test("version comparison reports instructions, hierarchy, deletion and constraints without mutation", () => {
  const before = structuredClone(socialMockTeamTemplate),
    after = structuredClone(before);
  after.members = after.members.filter((member) => member.key !== "creative");
  after.members[2].purpose = "Yeni talimat";
  after.members[2].capMicros += 1;
  after.members[2].parent = "manager";
  const summary = describeTeamChanges(before, after).join(" ");
  assert.match(summary, /talimatları değişti/);
  assert.match(summary, /yönetici değişti/);
  assert.match(summary, /bütçesi değişti/);
  assert.match(summary, /çıkarıldı/);
  assert.equal(before.members.length, 5);
  assert.deepEqual(describeTeamChanges(before, before), [
    "İki kayıt arasında içerik farkı yok.",
  ]);
});

test("unknown costs are never shown as zero", () => {
  for (const value of [
    null,
    undefined,
    "",
    " ",
    true,
    false,
    "0x0",
    "not-a-cost",
    -1,
    Infinity,
  ])
    assert.equal(mockCostLabel(value), "Henüz doğrulanmadı");
  assert.equal(mockCostLabel(0), "0 sahte mikro birim");
  assert.equal(mockCostLabel("20"), "20 sahte mikro birim");
});

async function settle(container: Element) {
  for (let tries = 0; tries < 30; tries++) {
    await new Promise((resolve) => setTimeout(resolve, 1));
    if (container.getAttribute("aria-busy") !== "true") return;
  }
  throw new Error("PANEL_DID_NOT_SETTLE");
}

test("readable dashboard uses installed picker, renders hostile text inertly, and never auto executes", async () => {
  const dom = new JSDOM(
    "<!doctype html><body><main id='panel'></main></body>",
    { url: "http://localhost/" },
  );
  const panel = dom.window.document.getElementById("panel")!;
  const { drafts, teams } = makeFixtures();
  const proposals: any[] = [],
    calls: Array<{ path: string; body?: any }> = [];
  const api = async (path: string, body?: any) => {
    calls.push({ path, body });
    if (path === "/teams") return teams;
    if (path === "/team-drafts") return drafts;
    if (path === "/history")
      return [
        {
          id: "0199ad70-0000-7000-8000-000000000124",
          persona_id: 102,
          state: "SUCCEEDED",
          reserved_micros: "50",
          actual_micros: null,
          output_payload: { output: "<img src=x onerror=alert(1)>" },
        },
      ];
    if (path === "/workflows") return [];
    if (path === "/proposals" && !body) return proposals;
    if (path === "/proposals") {
      proposals.push({
        actionId: 91,
        personaId: body.personaId,
        status: "pending_approval",
        intent: {
          content: body.content,
          target: body.target,
          amountMicros: 50,
        },
        digest: "b".repeat(64),
        reviewer: null,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      });
      return { actionId: 91 };
    }
    if (path === "/approvals/91" && !body) return { ...proposals[0] };
    if (path === "/approvals/91")
      throw new Error("PERSONA_SELF_APPROVAL_DENIED");
    throw new Error(`unexpected ${path}`);
  };
  const ui = initializeTeamTasks({ container: panel, api });
  await ui.refresh();
  const team = dom.window.document.getElementById(
    "tasks-team",
  ) as HTMLSelectElement;
  team.value = teamId;
  team.dispatchEvent(new dom.window.Event("change"));
  const member = dom.window.document.getElementById(
    "tasks-member",
  ) as HTMLSelectElement;
  member.value = "102";
  member.dispatchEvent(new dom.window.Event("change"));
  dom.window.dispatchEvent(
    new dom.window.CustomEvent("persona-member-selected", {
      detail: { key: "research", name: "Araştırma" },
    }),
  );
  assert.equal(member.value, "");
  assert.match(
    dom.window.document.getElementById("tasks-selection-notice")!.textContent!,
    /İsimden eşleştirme yapılmadı/,
  );
  member.value = "102";
  member.dispatchEvent(new dom.window.Event("change"));
  const brief = dom.window.document.getElementById(
    "tasks-brief",
  ) as HTMLTextAreaElement;
  brief.value = "<script>bad()</script> sentetik görev";
  brief.dispatchEvent(new dom.window.Event("input"));
  (
    dom.window.document.getElementById("tasks-propose") as HTMLButtonElement
  ).click();
  await settle(panel);
  assert.deepEqual(
    calls.find((call) => call.path === "/proposals" && call.body)?.body,
    {
      personaId: 102,
      content: "<script>bad()</script> sentetik görev",
      target: "local-preview",
    },
  );
  assert.equal(panel.querySelectorAll("script,img").length, 0);
  assert.match(
    dom.window.document.getElementById("tasks-history")!.textContent!,
    /Henüz doğrulanmadı/,
  );
  assert.equal(
    calls.filter((call) => call.path.includes("/executions/")).length,
    0,
  );
  (panel.querySelector("[data-operation=review]") as HTMLButtonElement).click();
  await settle(panel);
  const approve = dom.window.document.getElementById(
    "tasks-review-approve",
  ) as HTMLButtonElement;
  assert.equal(approve.disabled, true);
  const confirm = dom.window.document.getElementById(
    "tasks-review-confirm",
  ) as HTMLInputElement;
  confirm.checked = true;
  confirm.dispatchEvent(new dom.window.Event("change"));
  approve.click();
  await settle(panel);
  assert.match(
    dom.window.document.getElementById("tasks-status")!.textContent!,
    /Kendi hazırladığınız işi onaylayamazsınız/,
  );
  assert.equal(
    (dom.window.document.getElementById("tasks-propose") as HTMLButtonElement)
      .disabled,
    true,
  );
  assert.equal(
    calls.filter((call) => call.path === "/approvals/91" && call.body).length,
    1,
  );
  assert.equal(
    calls.filter((call) => call.path.includes("/executions/")).length,
    0,
  );
  ui.destroy();
  dom.window.close();
});

test("failed refresh blocks stale actions without silently retrying", async () => {
  const dom = new JSDOM("<main id='panel'></main>");
  const panel = dom.window.document.getElementById("panel")!;
  let calls = 0;
  const ui = initializeTeamTasks({
    container: panel,
    api: async () => {
      calls++;
      throw Error("OFFLINE");
    },
  });
  await ui.refresh();
  assert.equal(calls, 5);
  assert.match(panel.textContent!, /Otomatik tekrar yapılmadı/);
  assert.equal(
    (dom.window.document.getElementById("tasks-propose") as HTMLButtonElement)
      .disabled,
    true,
  );
  assert.equal(
    (dom.window.document.getElementById("tasks-refresh") as HTMLButtonElement)
      .disabled,
    false,
  );
  ui.destroy();
  dom.window.close();
});
