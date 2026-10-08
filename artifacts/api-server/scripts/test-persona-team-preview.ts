import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import express from "express";
import {
  createPersonaTeamPreview,
  isPersonaTeamPreviewEnabled,
  PERSONA_TEAM_PREVIEW_PATH,
} from "../src/routes/persona-team-preview";

const previewEnvironment = {
  NODE_ENV: "production",
  APP_BASE_URL: "https://staging.findandstudy.com",
  ALLOW_LIVE_INTEGRATIONS: "false",
  PERSONA_TEAM_PREVIEW_ENABLED: "true",
};

test("design preview: staging-only shell handoff, fixed synthetic data and legacy editor isolation", async (t) => {
  const previous = Object.fromEntries(
    Object.keys(previewEnvironment).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, previewEnvironment);
  try {
    await t.test(
      "default-off and exact staging environment never imply task authority",
      () => {
        assert.equal(isPersonaTeamPreviewEnabled(), true);
        for (const [key, invalid] of [
          ["NODE_ENV", "test"],
          ["NODE_ENV", "development"],
          ["APP_BASE_URL", "https://apply.findandstudy.com"],
          ["APP_BASE_URL", "https://staging.findandstudy.com/"],
          ["ALLOW_LIVE_INTEGRATIONS", "true"],
          ["PERSONA_TEAM_PREVIEW_ENABLED", "false"],
        ]) {
          process.env[key] = invalid;
          assert.equal(isPersonaTeamPreviewEnabled(), false);
          assert.throws(
            createPersonaTeamPreview,
            /PERSONA_DESIGN_PREVIEW_DISABLED/,
          );
          Object.assign(process.env, previewEnvironment);
        }
        delete process.env.PERSONA_TEAM_PREVIEW_ENABLED;
        assert.throws(
          createPersonaTeamPreview,
          /PERSONA_DESIGN_PREVIEW_DISABLED/,
        );
        Object.assign(process.env, previewEnvironment);
      },
    );

    const app = express();
    const requests: Array<{ method: string; path: string }> = [];
    app.use((req, _res, next) => {
      requests.push({ method: req.method, path: req.path });
      next();
    });
    // Test-only host for retained legacy assets. The application route now opens
    // the React dashboard; this separate fixture is not a product page or route.
    const legacyFixturePath = "/__test-only/legacy-design-preview";
    app.get(legacyFixturePath, (req, res) => {
      if (req.headers["x-preview-test-session"] !== "fixture") {
        res.sendStatus(401);
        return;
      }
      res.type("html").send(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${PERSONA_TEAM_PREVIEW_PATH}/panel.css"><link rel="stylesheet" href="${PERSONA_TEAM_PREVIEW_PATH}/team-tree.css"></head><body data-persona-mode="design-preview"><main></main><script type="module" src="${PERSONA_TEAM_PREVIEW_PATH}/preview.js"></script></body></html>`);
    });
    // Synthetic HTTP fixture only. The app's actual mount must reuse real admin
    // session middleware; this route cannot issue a session or grant a role.
    app.use(
      PERSONA_TEAM_PREVIEW_PATH,
      (req, res, next) =>
        req.headers["x-preview-test-session"] === "fixture"
          ? next()
          : res.sendStatus(401),
      createPersonaTeamPreview(),
    );
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    const url = origin + PERSONA_TEAM_PREVIEW_PATH;
    const get = (path: string, method = "GET") =>
      fetch(url + path, {
        method,
        redirect: "manual",
        headers: { "x-preview-test-session": "fixture" },
      });
    try {
      await t.test(
        "fixed GET assets, runtime disable, no login or business endpoint",
        async () => {
          for (const path of [
            "/",
            "/template.json",
            "/panel.css",
            "/preview.js",
            "/team-tree.js",
            "/team-tree.css",
          ]) {
            assert.equal((await fetch(url + path)).status, 401);
            const response = await get(path);
            assert.equal(response.status, path === "/" ? 302 : 200);
            assert.equal(response.headers.get("location"), path === "/" ? "/?workspace=team-preview" : null);
            assert.equal(
              response.headers.get("cache-control"),
              "private, no-store",
            );
            assert.match(
              response.headers.get("content-security-policy") ?? "",
              /connect-src 'none'/,
            );
            assert.match(
              response.headers.get("content-security-policy") ?? "",
              /script-src 'self';/,
            );
            assert.equal((await get(path, "POST")).status, 405);
          }
          for (const path of [
            "/preview/session",
            "/team-workspace",
            "/team-drafts",
            "/tasks",
            "/team-template",
            "/team-tasks.js",
            "/login",
          ])
            assert.equal((await get(path)).status, 404);
          assert.equal(
            await (
              await get("/?project=secret&user=admin&title=%3Cscript%3E")
            ).text(),
            await (await get("/")).text(),
          );
          assert.equal((await get("/?returnTo=https%3A%2F%2Funtrusted.invalid")).headers.get("location"), "/?workspace=team-preview");
          assert.equal((await get("")).headers.get("location"), "/?workspace=team-preview");
          const response = await get("/template.json");
          assert.match(response.headers.get("content-type") ?? "", /application\/json/);
          const template = await response.json();
          assert.deepEqual(Object.keys(template).sort(), ["members", "name", "schemaVersion"]);
          assert.equal(template.schemaVersion, 1);
          assert.equal(template.members.length, 5);
          for (const member of template.members) {
            assert.equal(member.provider, "mock");
            assert.equal(member.model, "mock-fixture");
            assert.deepEqual(member.tools, ["mock_draft"]);
            assert.deepEqual(member.dataScopes, ["persona_mock_context"]);
            assert.equal(member.humanApproval, true);
            assert.equal(member.purpose, "Örnek talimat — bu önizlemede çalıştırılmaz");
            assert.equal(member.output, "Örnek çıktı tanımı — herhangi bir içerik üretilmez");
          }
          assert.doesNotMatch(JSON.stringify(template), /projectId|principalId|userId|accountId|access_token|apiKey|cookie|https?:\/\//);
          template.members[0].name = "caller-only mutation";
          const stable = await (await get("/template.json?projectId=other&name=override")).json();
          assert.notEqual(stable.members[0].name, "caller-only mutation");
          assert.equal(stable.name, "Örnek sosyal medya takımı — yalnız tasarım");
          for (const method of ["HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
            assert.equal((await get("/template.json", method)).status, 405);
          }
          const bootstrap = await (await get("/preview.js")).text();
          assert.match(
            bootstrap,
            /initializePersonaTeamEditor\(\{designPreviewTemplate:/,
          );
          assert.doesNotMatch(
            bootstrap,
            /fetch\(|api\(|projectId|principalId|cookie|localStorage|sessionStorage/,
          );
          process.env.PERSONA_TEAM_PREVIEW_ENABLED = "false";
          assert.equal((await get("/team-tree.js")).status, 404);
          assert.equal((await get("/template.json")).status, 404);
          assert.equal((await get("/")).status, 404);
          Object.assign(process.env, previewEnvironment);
        },
      );

      await t.test(
        "retained legacy assets edit and reload only in a test fixture without API/storage/export/import/worker use",
        async () => {
          const requireBrowser = createRequire(
            new URL("../../edcons/package.json", import.meta.url),
          );
          const { chromium } = requireBrowser("@playwright/test");
          const browser = await chromium.launch({
            headless: true,
            channel: "msedge",
          });
          try {
            const context = await browser.newContext({
              viewport: { width: 1366, height: 1000 },
              extraHTTPHeaders: { "x-preview-test-session": "fixture" },
            });
            // Raw browser JS avoids transpiler helper closures in the probe.
            await context.addInitScript(`
              const calls = [];
              window.__previewForbiddenCalls = calls;
              function deny(name) { return function() { calls.push(name); throw new Error('DESIGN_PREVIEW_FORBIDDEN_' + name); }; }
              window.fetch = deny('fetch');
              window.api = deny('api');
              XMLHttpRequest.prototype.open = deny('xhr');
              navigator.sendBeacon = deny('beacon');
              for (const name of ['localStorage', 'sessionStorage', 'indexedDB'])
                Object.defineProperty(window, name, { configurable: true, get: deny(name) });
              window.WebSocket = deny('websocket');
              window.Worker = deny('worker');
              URL.createObjectURL = deny('export');
              window.__previewProbesReady = true;
            `);
            const page = await context.newPage();
            const errors: string[] = [];
            page.on("pageerror", (error: Error) => errors.push(error.message));
            const browserRequests: Array<{ method: string; url: string }> = [];
            page.on("request", (request: any) =>
              browserRequests.push({
                method: request.method(),
                url: request.url(),
              }),
            );
            await page.goto(origin + legacyFixturePath);
            await page.locator('.org-card[data-key="research"]').waitFor();
            assert.equal(
              await page.evaluate(() => (window as any).__previewProbesReady),
              true,
            );
            assert.equal(await page.locator(".org-card").count(), 5);
            assert.match(
              await page.locator("#organization-panel").innerText(),
              /yenileyince veya kapatınca kaybolur/,
            );
            for (const selector of [
              "#org-save",
              "#org-workspace-save",
              "#org-workspace-load",
              "#org-import",
              "#org-export",
              "#org-library",
              "#org-member-tasks",
              "#team-tasks-tab",
              "#team-tasks-panel",
              "#operations-tab",
              "#operations-panel",
            ])
              assert.equal(await page.locator(selector).count(), 0, selector);

            const research = page.locator('.org-node[data-key="research"]');
            await research.scrollIntoViewIfNeeded();
            const before = await research.evaluate((node: HTMLElement) => ({
              x: node.style.left,
              y: node.style.top,
            }));
            const box = await page
              .locator('.org-card[data-key="research"]')
              .boundingBox();
            assert.ok(box);
            await page.mouse.move(box.x + 35, box.y + 25);
            await page.mouse.down();
            await page.mouse.move(box.x + 270, box.y - 115, { steps: 12 });
            await page.mouse.up();
            assert.notDeepEqual(
              await research.evaluate((node: HTMLElement) => ({
                x: node.style.left,
                y: node.style.top,
              })),
              before,
            );
            await page
              .locator('.org-node[data-key="research"] .org-connect')
              .dragTo(page.locator('.org-card[data-key="manager"]'));
            await page.locator('.org-card[data-key="research"]').click();
            assert.equal(
              await page.locator("#org-parent").inputValue(),
              "manager",
            );
            await page
              .locator("#org-purpose")
              .fill("Yalnız tarayıcı belleğinde örnek talimat");
            await page.locator("#org-apply").click();
            assert.equal(
              await page.locator("#org-purpose").inputValue(),
              "Yalnız tarayıcı belleğinde örnek talimat",
            );

            await page.locator("#org-new-parent").selectOption("manager");
            await page.locator("#org-add-department").click();
            assert.equal(await page.locator(".org-card").count(), 6);
            await page.locator("#org-add-specialist").click();
            assert.equal(await page.locator(".org-card").count(), 7);
            await page.locator("#org-remove").click();
            await page.locator("#org-delete-yes").click();
            assert.equal(await page.locator(".org-card").count(), 6);
            await page.locator("#org-undo").click();
            assert.equal(await page.locator(".org-card").count(), 7);
            await page.locator("#org-redo").click();
            assert.equal(await page.locator(".org-card").count(), 6);
            await page.locator("#org-zoom-out").click();
            assert.match(
              await page.locator("#org-zoom-label").innerText(),
              /75%/,
            );
            await page.locator("#org-zoom-in").click();
            assert.match(
              await page.locator("#org-zoom-label").innerText(),
              /100%/,
            );
            await page.locator("#org-search").fill("Araştırma");
            await page.locator("#org-search-results button").click();
            assert.equal(
              await page.locator("#org-name").inputValue(),
              "Araştırma uzmanı",
            );
            for (let count = 0; count < 4; count++)
              await page.locator("#org-zoom-in").click();
            await page.locator("#org-canvas").scrollIntoViewIfNeeded();
            const panStart = await page
              .locator("#org-canvas")
              .evaluate((node: HTMLElement) => {
                node.scrollLeft = 180;
                node.scrollTop = 100;
                const rect = node.getBoundingClientRect();
                for (
                  let y = rect.top + 30;
                  y < Math.min(rect.bottom - 60, innerHeight - 60);
                  y += 35
                )
                  for (
                    let x = rect.left + 70;
                    x < Math.min(rect.right - 90, innerWidth - 90);
                    x += 35
                  )
                    if (!document.elementFromPoint(x, y)?.closest(".org-node"))
                      return { x, y, scrollLeft: node.scrollLeft };
                throw new Error("NO_EMPTY_CANVAS_POINT");
              });
            const positionsBeforePan = await page
              .locator(".org-node")
              .evaluateAll((nodes: HTMLElement[]) =>
                nodes.map((node) => [
                  node.dataset.key,
                  node.style.left,
                  node.style.top,
                ]),
              );
            await page.mouse.move(panStart.x, panStart.y);
            await page.mouse.down();
            await page.mouse.move(panStart.x + 55, panStart.y + 35, {
              steps: 8,
            });
            await page.mouse.up();
            assert.ok(
              (await page
                .locator("#org-canvas")
                .evaluate((node: HTMLElement) => node.scrollLeft)) <
                panStart.scrollLeft,
            );
            assert.deepEqual(
              await page
                .locator(".org-node")
                .evaluateAll((nodes: HTMLElement[]) =>
                  nodes.map((node) => [
                    node.dataset.key,
                    node.style.left,
                    node.style.top,
                  ]),
                ),
              positionsBeforePan,
            );
            // More than the ordinary editor debounce; no hidden autosave may fire.
            await page.waitForTimeout(1100);
            assert.deepEqual(
              await page.evaluate(
                () => (window as any).__previewForbiddenCalls,
              ),
              [],
            );
            assert.deepEqual(errors, []);
            await page.reload();
            await page.locator('.org-card[data-key="research"]').click();
            assert.equal(await page.locator(".org-card").count(), 5);
            assert.equal(
              await page.locator("#org-parent").inputValue(),
              "social",
            );
            assert.match(
              await page.locator("#org-purpose").inputValue(),
              /Örnek talimat/,
            );
            assert.deepEqual(
              await research.evaluate((node: HTMLElement) => ({
                x: node.style.left,
                y: node.style.top,
              })),
              before,
            );
            await page.setViewportSize({ width: 390, height: 844 });
            assert.equal(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= window.innerWidth,
              ),
              true,
            );
            await page.locator("#org-zoom-fit").click();
            assert.deepEqual(
              await page.evaluate(
                () => (window as any).__previewForbiddenCalls,
              ),
              [],
            );
            assert.deepEqual(errors, []);
            const fixed = new Set([
              "",
              "/",
              "/panel.css",
              "/preview.js",
              "/team-tree.js",
              "/team-tree.css",
            ]);
            for (const request of browserRequests) {
              const parsed = new URL(request.url);
              assert.equal(request.method, "GET");
              assert.equal(parsed.origin, origin);
              if (parsed.pathname === legacyFixturePath) continue;
              assert.equal(
                fixed.has(
                  parsed.pathname.slice(PERSONA_TEAM_PREVIEW_PATH.length),
                ),
                true,
                request.url,
              );
            }
            assert.equal(
              browserRequests.some((request) =>
                /\/api\/|team-tasks|mock\//.test(request.url),
              ),
              false,
            );
            await context.close();
          } finally {
            await browser.close();
          }
        },
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
