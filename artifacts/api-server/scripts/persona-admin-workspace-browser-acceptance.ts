import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Options = {
  origin: string; projectId: string; makerSid: string; reviewerSid: string;
  makerUserId: number; reviewerUserId: number; csrfToken: string;
};

/** Built normal OS, actual auth/session endpoints and disposable PostgreSQL.
 * No fulfilled browser requests, account cache seed, provider calls or UI bypass. */
export async function assertPersonaAdminWorkspaceBrowser(options: Options) {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.ALLOW_DISPOSABLE_PERSONA_DB, "true");
  assert.equal(process.env.ALLOW_LIVE_INTEGRATIONS, "false");
  assert.match(options.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  const requireBrowser = createRequire(new URL("../../edcons/package.json", import.meta.url));
  const { chromium } = requireBrowser("@playwright/test");
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const errors: string[] = [];
  const api = `${options.origin}/api/persona-workspace/${options.projectId}`;
  const route = `/admin/agent-team-workspace/${options.projectId}`;
  async function actor(sid: string, userId: number) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route("**/*", async (request: any) => {
      const target = new URL(request.request().url());
      if (target.origin === options.origin || ["data:", "blob:"].includes(target.protocol)) await request.continue();
      else await request.abort("blockedbyclient");
    });
    await context.addCookies([
      { name: "sid", value: sid, url: options.origin, httpOnly: true, sameSite: "Strict" },
      { name: "csrf_token", value: options.csrfToken, url: options.origin, sameSite: "Strict" },
    ]);
    const page = await context.newPage();
    page.on("pageerror", (error: Error) => errors.push(error.message));
    const auth = page.waitForResponse((response: any) => response.url() === `${options.origin}/api/auth/me` && response.status() === 200);
    await page.goto(`${options.origin}/admin/agent-team-workspace`);
    assert.equal((await (await auth).json()).id, userId);
    assert.equal(await page.locator("#persona-local-project").count(), 0, "discovery must not ask an admin to enter a UUID");
    await page.locator(`a[href="${route}"]`).click();
    await page.getByTestId("workspace-first-team-help").waitFor();
    await panelReady(page);
    return { page, context };
  }
  async function panelReady(page: any) {
    await page.locator("#tasks-status").filter({ hasText: "Kayıtlar yenilendi" }).waitFor();
    await page.waitForFunction(() => document.querySelector(".team-workspace-tasks")?.getAttribute("aria-busy") === "false");
  }
  async function refresh(page: any) {
    const response = page.waitForResponse((value: any) => value.url() === `${api}/team-drafts` && value.request().method() === "GET");
    await page.locator("#tasks-refresh").click();
    assert.equal((await response).status(), 200);
    await panelReady(page);
  }
  async function mutate(page: any, selector: string, suffix: string, expected = 200) {
    const pending = page.waitForResponse((response: any) => response.url() === `${api}${suffix}` && response.request().method() === "POST");
    await page.locator(selector).click();
    const response = await pending;
    assert.equal(response.status(), expected, suffix);
    const body = await response.json();
    await page.waitForFunction(() => document.querySelector(".team-workspace-tasks")?.getAttribute("aria-busy") === "false");
    return body;
  }
  async function inspectTeam(page: any, id: number) {
    await page.locator("#tasks-versions").selectOption(String(id));
    await page.locator("#tasks-version-review").click();
    await page.locator("#tasks-status").filter({ hasText: "Talimatlar açıldı" }).waitFor();
    await page.locator("#tasks-version-confirm").check();
  }
  async function inspectTask(page: any, id: number) {
    await page.locator(`#tasks-proposals [data-action-id="${id}"] [data-operation="review"]`).click();
    await page.locator("#tasks-review-confirm").waitFor();
    await page.locator("#tasks-review-confirm").check();
  }
  try {
    const maker = await actor(options.makerSid, options.makerUserId);
    const page = maker.page;
    assert.match(await page.locator("#tasks-version-preview").textContent(), /İncelenecek takım sürümü yok/);
    assert.equal(await page.locator("#tasks-team option").count(), 1);
    assert.equal(await page.getByTestId("workspace-submit-team").isDisabled(), true);
    await page.getByTestId("workspace-command").fill("Sosyal medya birimi kur");
    await page.getByTestId("workspace-command-preview").click();
    await page.getByTestId("workspace-command-apply").click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid^="team-node-"]').length === 5);
    const save = page.waitForResponse((response: any) => response.url() === `${api}/team-workspace` && response.request().method() === "PUT");
    await page.getByTestId("workspace-save").click();
    assert.equal((await save).status(), 200);
    await panelReady(page);
    assert.equal(await page.locator("#tasks-versions option").count(), 0, "saving a workspace must not implicitly propose or install a team");

    const submission = page.waitForResponse((response: any) => response.url() === `${api}/team-drafts` && response.request().method() === "POST");
    await page.getByTestId("workspace-submit-team").click();
    const submissionResponse = await submission;
    assert.equal(submissionResponse.status(), 200);
    assert.deepEqual(Object.keys(submissionResponse.request().postDataJSON()), ["document"]);
    const draft = await submissionResponse.json();
    assert.equal(draft.activated, false);
    await panelReady(page);
    await inspectTeam(page, draft.actionId);
    const self = await mutate(page, "#tasks-version-approve", `/team-drafts/${draft.actionId}/approve`, 409);
    assert.equal(self.error, "PERSONA_SELF_APPROVAL_DENIED");

    const reviewer = await actor(options.reviewerSid, options.reviewerUserId);
    await inspectTeam(reviewer.page, draft.actionId);
    assert.equal((await mutate(reviewer.page, "#tasks-version-approve", `/team-drafts/${draft.actionId}/approve`)).approved, true);
    await inspectTeam(reviewer.page, draft.actionId);
    const team = await mutate(reviewer.page, "#tasks-version-install", `/team-drafts/${draft.actionId}/install`);
    assert.equal(team.status, "PAUSED");
    assert.equal(team.grantsCreated, 0);

    await refresh(page);
    await page.locator("#tasks-team").selectOption(team.id);
    assert.equal(await page.locator("#tasks-propose").isDisabled(), true);
    const opened = await mutate(page, "#tasks-team-pause", `/teams/${team.id}/pause`);
    assert.equal(opened.status, "MOCK_READY");
    const specialist = await page.locator("#tasks-member option").evaluateAll((items: any[]) => items.find((item) => item.textContent?.includes("Araştırma uzmanı"))?.value);
    assert.ok(specialist);
    await page.locator("#tasks-member").selectOption(specialist);
    const content = "Sentetik ilk takım tarayıcı kabul görevi";
    await page.locator("#tasks-brief").fill(content);
    const task = await mutate(page, "#tasks-propose", "/proposals");
    assert.equal(task.status, "pending_approval");
    await refresh(reviewer.page);
    await inspectTask(reviewer.page, task.actionId);
    assert.match(await reviewer.page.locator("#tasks-review").textContent(), new RegExp(content));
    await mutate(reviewer.page, "#tasks-review-approve", `/approvals/${task.actionId}`);
    await refresh(page);
    await inspectTask(page, task.actionId);
    const executed = await mutate(page, "#tasks-review-execute", `/executions/${task.actionId}`);
    assert.ok(executed);
    await page.locator("#tasks-history article").filter({ hasText: "Tamamlandı" }).waitFor();
    assert.match(await page.locator("#tasks-history").textContent(), /Sahte çıktı/);
    await page.reload();
    await panelReady(page);
    assert.match(await page.locator("#tasks-history").textContent(), /Tamamlandı/);
    assert.equal(await page.getByTestId(/^team-node-/).count(), 5, "saved team hierarchy must survive reopening");
    const output = fileURLToPath(new URL("../../../../.staging-tools/persona-admin-workspace-20261026/", import.meta.url));
    mkdirSync(output, { recursive: true });
    await page.screenshot({ path: `${output}/workspace-admin-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId("workspace-tasks").scrollIntoViewIfNeeded();
    assert.equal(await page.locator("#tasks-refresh").isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "mobile workspace must not overflow horizontally");
    await page.screenshot({ path: `${output}/workspace-admin-mobile.png`, fullPage: true });
    assert.deepEqual(errors, []);
    console.info("Normal OS + real sessions + disposable PG: first team from empty project; persisted draft; explicit submission; self-approval denied; separate admin review/install; paused/resume; task proposal/approval/mock execution/result/reopen and mobile PASS");
  } finally {
    await browser.close();
  }
}
