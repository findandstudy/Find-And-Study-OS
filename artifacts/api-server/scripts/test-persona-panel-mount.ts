import assert from "node:assert/strict";
import test from "node:test";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { build } from "esbuild";
import { createPersonaLocalPanel } from "../src/routes/persona-local-panel";
import { createPersonaRuntimeBoundary } from "../src/lib/personaRuntimeBoundary";

const projectId = "018f6000-0000-7000-8000-000000000100";
const mountPath = "/admin/agent-team-workspace";
const apiBase = "/api/persona-workspace";
const assetFiles = [
  ["team-tree.js", "persona-team-tree.client.js"],
  ["team-tree.css", "persona-team-tree.css"],
  ["team-tasks.js", "persona-team-tasks.client.js"],
  ["team-tasks.css", "persona-team-tasks.css"],
] as const;
const config = {
  mode: "staging-mock" as const,
  publicOrigin: "https://staging.findandstudy.com" as const,
  database: {
    name: "fasos_staging" as const,
    host: "127.0.0.1",
    port: 5432 as const,
    role: "fas_persona_staging_executor" as const,
  },
};

test("staging mock panel mounts without root-path escapes or test-login routes", async (t) => {
  const previous = Object.fromEntries(
    [
      "NODE_ENV",
      "ALLOW_LIVE_INTEGRATIONS",
      "PERSONA_RUNTIME_MODE",
      "APP_BASE_URL",
    ].map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, {
    NODE_ENV: "production",
    ALLOW_LIVE_INTEGRATIONS: "false",
    PERSONA_RUNTIME_MODE: "staging-mock",
    APP_BASE_URL: "https://staging.findandstudy.com",
  });
  const apiRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  let temporaryBuild: string | undefined;
  try {
    const runtime = createPersonaRuntimeBoundary(config);
    await t.test(
      "configuration rejects implicit mounting and unsafe interpolation",
      () => {
        assert.throws(
          () => createPersonaLocalPanel(projectId),
          /PERSONA_MOCK_ONLY/,
        );
        assert.throws(
          () => createPersonaLocalPanel(projectId, { runtime }),
          /PERSONA_PANEL_PATH_INVALID/,
        );
        for (const unsafe of [
          "//evil.invalid",
          "/../escape",
          "/x?escape",
          '/x"onclick="x',
          "/x/%2e%2e",
          "/x/",
        ])
          assert.throws(
            () =>
              createPersonaLocalPanel(projectId, {
                runtime,
                mountPath: unsafe,
                apiBase,
              }),
            /PERSONA_PANEL_PATH_INVALID/,
          );
        assert.throws(
          () =>
            createPersonaLocalPanel(projectId, {
              runtime,
              mountPath,
              apiBase: "/mock",
            }),
          /PERSONA_PANEL_PATH_INVALID/,
        );
      },
    );

    async function checkRoutes(
      panel: ReturnType<typeof createPersonaLocalPanel>,
      packaged = false,
    ) {
      const app = express();
      // Synthetic boundary for this panel contract only. Real normal-OS auth is
      // tested in the application/session corridor; no fixture-login endpoint.
      app.use(
        mountPath,
        (req, res, next) =>
          req.headers["x-panel-test-session"] === "fixture"
            ? next()
            : res.sendStatus(401),
        panel,
      );
      const server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const origin = `http://127.0.0.1:${address.port}`;
      const get = (suffix: string) =>
        fetch(origin + mountPath + suffix, {
          headers: { "x-panel-test-session": "fixture" },
        });
      try {
        for (const path of [
          "/",
          "/panel.js",
          "/team-template",
          ...assetFiles.map(([route]) => "/" + route),
        ]) {
          assert.equal((await fetch(origin + mountPath + path)).status, 401);
          const response = await get(path);
          assert.equal(
            response.status,
            200,
            (packaged ? "packaged " : "source ") + path,
          );
          assert.equal(
            response.headers.get("cache-control"),
            "private, no-store",
          );
          assert.equal(
            response.headers.get("x-content-type-options"),
            "nosniff",
          );
          assert.match(
            response.headers.get("content-security-policy") ?? "",
            /frame-ancestors 'none'/,
          );
        }
        const html = await (await get("/?view=team-workspace")).text();
        assert.ok(html.includes(`data-panel-base="${mountPath}"`));
        assert.ok(html.includes(`data-api-base="${apiBase}"`));
        assert.ok(html.includes('data-persona-mode="staging-mock"'));
        assert.ok(html.includes(`src="${mountPath}/panel.js"`));
        assert.ok(html.includes(`href="${mountPath}/panel.css"`));
        assert.match(html, /kalıcı olarak saklanır/);
        assert.doesNotMatch(html, /iki ayrı test oturumu/);
        const javascript = await (await get("/panel.js")).text();
        assert.ok(javascript.includes("import(panelBase+'/team-tree.js')"));
        assert.ok(
          javascript.includes(
            "base=document.body.dataset.apiBase+'/'+document.body.dataset.project",
          ),
        );
        assert.ok(javascript.includes("fetch(panelBase+'/team-template')"));
        assert.doesNotMatch(
          javascript,
          /fetch\('\/(?:mock|team-template)|import\('\//,
        );
        for (const [route, source] of assetFiles) {
          const actual = await (await get("/" + route)).text();
          assert.equal(
            actual,
            await readFile(join(apiRoot, "src/lib", source), "utf8"),
          );
        }
        for (const path of [
          "/preview",
          "/preview/session",
          "/session",
          "/login",
          "/../src/index.ts",
        ])
          assert.equal((await get(path)).status, 404);
        for (const path of [
          "/team-template",
          "/panel.js",
          "/team-tree.js",
          "/mock/" + projectId + "/personas",
        ])
          assert.equal((await fetch(origin + path)).status, 404);
        process.env.ALLOW_LIVE_INTEGRATIONS = "true";
        try {
          for (const path of [
            "/",
            "/panel.js",
            "/team-template",
            "/team-tree.js",
          ])
            assert.equal((await get(path)).status, 403);
        } finally {
          process.env.ALLOW_LIVE_INTEGRATIONS = "false";
        }
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }

    await t.test(
      "source assets and runtime kill switch use the prefixed mount",
      async () => {
        await checkRoutes(
          createPersonaLocalPanel(projectId, { runtime, mountPath, apiBase }),
        );
      },
    );
    await t.test(
      "bundled CJS serves packaged assets without source-tree or cwd fallback",
      async () => {
        temporaryBuild = await mkdtemp(
          join(apiRoot, ".persona-panel-contract-"),
        );
        const output = join(temporaryBuild, "index.cjs");
        await build({
          stdin: {
            contents:
              'export { createPersonaLocalPanel } from "./src/routes/persona-local-panel"; export { createPersonaRuntimeBoundary } from "./src/lib/personaRuntimeBoundary";',
            resolveDir: apiRoot,
            loader: "ts",
          },
          bundle: true,
          platform: "node",
          format: "cjs",
          packages: "external",
          outfile: output,
          logLevel: "silent",
        });
        await mkdir(join(temporaryBuild, "assets/persona-workspace"), {
          recursive: true,
        });
        for (const [, source] of assetFiles)
          await copyFile(
            join(apiRoot, "src/lib", source),
            join(temporaryBuild, "assets/persona-workspace", source),
          );
        const require = createRequire(import.meta.url);
        const bundled = require(output) as {
          createPersonaLocalPanel: typeof createPersonaLocalPanel;
          createPersonaRuntimeBoundary: typeof createPersonaRuntimeBoundary;
        };
        await checkRoutes(
          bundled.createPersonaLocalPanel(projectId, {
            runtime: bundled.createPersonaRuntimeBoundary(config),
            mountPath,
            apiBase,
          }),
          true,
        );
        delete require.cache[require.resolve(output)];
      },
    );
  } finally {
    if (temporaryBuild)
      await rm(temporaryBuild, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
