import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Result = { status: number; data: any };
type Options = {
  origin: string;
  projectId: string;
  foreignProjectId: string;
  makerSid: string;
  makerUserId: number;
  readWorkspace(): Promise<Result>;
  saveWorkspace(body: unknown): Promise<Result>;
};

/** Built normal OS + real HTTP/session/PG integration; no route fulfillment,
 * user response stub, localStorage user seed or authority bypass. */
export async function assertPersonaWorkspaceOsBrowser(options: Options) {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.ALLOW_DISPOSABLE_PERSONA_DB, "true");
  assert.equal(process.env.ALLOW_LIVE_INTEGRATIONS, "false");
  assert.match(options.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  const prior = await options.readWorkspace();
  assert.equal(prior.status, 200);
  const original = prior.data.workspace;
  const root = original.document.members.find((member: any) => member.kind === "manager");
  assert.ok(root);
  // Isolate the command acceptance fixture to the actor's editable workspace.
  // Approved team snapshots, installed personas and execution records are untouched.
  const seed = await options.saveWorkspace({
    expectedRevision: original.revision,
    document: { ...original.document, members: [root] },
    layout: { positions: [{ key: root.key, x: 128, y: 40 }], zoom: 1, selectedKey: root.key },
  });
  assert.equal(seed.status, 200);

  const requireBrowser = createRequire(new URL("../../edcons/package.json", import.meta.url));
  const { chromium } = requireBrowser("@playwright/test");
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const errors: string[] = [];
  const url = `${options.origin}/admin/agent-team-workspace/${options.projectId}`;
  async function newContext() {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route("**/*", async (route: any) => {
      const target = new URL(route.request().url());
      if (target.origin === options.origin || ["data:", "blob:"].includes(target.protocol)) await route.continue();
      else await route.abort("blockedbyclient");
    });
    await context.addCookies([
      { name: "sid", value: options.makerSid, url: options.origin, httpOnly: true, sameSite: "Strict" },
      { name: "csrf_token", value: "c".repeat(64), url: options.origin, sameSite: "Strict" },
    ]);
    return context;
  }
  try {
    const firstContext = await newContext();
    let page = await firstContext.newPage();
    page.on("pageerror", (error: Error) => errors.push(error.message));
    const auth = page.waitForResponse((response: any) => response.url() === `${options.origin}/api/auth/me` && response.status() === 200);
    await page.goto(url);
    assert.equal((await (await auth).json()).id, options.makerUserId);
    await page.getByTestId(`team-node-${root.key}`).waitFor();
    const menuEntry = page.getByRole("link", { name: "Takım çalışma alanı (yerel mock)", exact: true });
    await menuEntry.waitFor();
    assert.equal(await menuEntry.getAttribute("href"), "/admin/agent-team-workspace");
    assert.equal(await page.getByTestId(/^team-node-/).count(), 1);

    await page.getByTestId("workspace-command").fill("Sosyal medya birimi kur");
    await page.getByTestId("workspace-command-preview").click();
    await page.getByTestId("workspace-command-diff").waitFor();
    assert.equal((await options.readWorkspace()).data.workspace.revision, seed.data.workspace.revision,
      "reviewing a command must not persist, approve, install or execute anything");
    await page.getByTestId("workspace-command-apply").click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid^="team-node-"]').length === 5);
    assert.equal(await page.getByTestId(/^team-node-/).count(), 5);
    assert.equal((await options.readWorkspace()).data.workspace.revision, seed.data.workspace.revision,
      "applying the command is still only an editable draft until explicit Save");
    const saved = page.waitForResponse((response: any) => response.url().endsWith("/team-workspace") && response.request().method() === "PUT");
    await page.getByTestId("workspace-save").click();
    assert.equal((await saved).status(), 200);
    await page.waitForFunction(() => /Saved|Kaydedildi/.test(document.querySelector('[data-testid="workspace-status"]')?.textContent ?? ""));
    const created = (await options.readWorkspace()).data.workspace;
    assert.equal(created.document.members.length, 5);
    const researcher = created.document.members.find((member: any) => member.name === "Araştırma uzmanı");
    assert.ok(researcher);
    await page.getByTestId(`team-node-${researcher.key}`).click();
    await page.locator("#team-member-name").fill("Sentetik araştırma düzenlendi");
    await page.getByRole("button", { name: /^(Apply changes|Uygula)$/ }).click();
    const updated = page.waitForResponse((response: any) => response.url().endsWith("/team-workspace") && response.request().method() === "PUT");
    await page.getByTestId("workspace-save").click();
    assert.equal((await updated).status(), 200);
    await page.waitForFunction(() => /Saved|Kaydedildi/.test(document.querySelector('[data-testid="workspace-status"]')?.textContent ?? ""));
    const durable = (await options.readWorkspace()).data.workspace;
    assert.equal(durable.document.members.find((member: any) => member.key === researcher.key).name, "Sentetik araştırma düzenlendi");
    await page.reload();
    await page.getByTestId(`team-node-${researcher.key}`).waitFor();
    assert.match(await page.getByTestId(`team-node-${researcher.key}`).textContent(), /Sentetik araştırma düzenlendi/);

    await firstContext.close();
    const reopenedContext = await newContext();
    page = await reopenedContext.newPage();
    page.on("pageerror", (error: Error) => errors.push(error.message));
    await page.goto(url);
    await page.getByTestId(`team-node-${researcher.key}`).waitFor();
    assert.match(await page.getByTestId(`team-node-${researcher.key}`).textContent(), /Sentetik araştırma düzenlendi/);
    assert.equal((await options.readWorkspace()).data.workspace.revision, durable.revision,
      "closing all browser storage and reopening must read, not duplicate, the saved draft");
    const installedRecords = page.waitForResponse((response: any) => response.url().endsWith("/teams") && response.request().method() === "GET");
    const workflowRecords = page.waitForResponse((response: any) => response.url().endsWith("/workflows") && response.request().method() === "GET");
    await page.getByTestId("workspace-records-load").click();
    const [installedResponse, workflowResponse] = await Promise.all([installedRecords, workflowRecords]);
    assert.equal(installedResponse.status(), 200);
    assert.equal(workflowResponse.status(), 200);
    assert.ok(Array.isArray(await installedResponse.json()));
    assert.ok(Array.isArray(await workflowResponse.json()));
    await page.getByTestId("workspace-records").getByRole("heading", { level: 3 }).first().waitFor();
    assert.equal(await page.getByTestId("workspace-records").getByRole("alert").count(), 0);
    assert.equal((await options.readWorkspace()).data.workspace.revision, durable.revision,
      "viewing installed teams and workflow history must not mutate the editable workspace");
    const screenshotDirectory = fileURLToPath(new URL("../../../../.staging-tools/persona-workspace-local-20261008/", import.meta.url));
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({ path: `${screenshotDirectory}/normal-os-workspace-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.getByTestId("workspace-reload").isVisible());
    assert.ok(await page.getByTestId("workspace-status").isVisible());
    await page.screenshot({ path: `${screenshotDirectory}/normal-os-workspace-mobile.png`, fullPage: true });
    const forbidden = await reopenedContext.newPage();
    await forbidden.goto(`${options.origin}/admin/agent-team-workspace/${options.foreignProjectId}`);
    await forbidden.waitForFunction(() => /could not be verified|doğrulanamadı/.test(document.querySelector('[data-testid="workspace-status"]')?.textContent ?? ""));
    assert.equal(await forbidden.getByTestId(/^team-node-/).count(), 0);
    assert.equal(await forbidden.getByTestId("workspace-save").isDisabled(), true);
    assert.equal(await forbidden.getByTestId("workspace-records-load").count(), 0,
      "foreign-project access must not expose the project record loader");
    assert.deepEqual(errors, []);
    console.info("Built normal OS browser + real auth/PG: explicit command review/apply/save, edited member survives reload and empty-context reopen, mobile controls and foreign-project denial PASS");
  } finally {
    await browser.close();
    const current = await options.readWorkspace();
    assert.equal(current.status, 200);
    const restored = await options.saveWorkspace({
      expectedRevision: current.data.workspace.revision, document: original.document, layout: original.layout,
    });
    assert.equal(restored.status, 200);
  }
}
