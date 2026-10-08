import { Router } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { socialMockTeamTemplate } from "../lib/personaTeamDraft";

export const PERSONA_TEAM_PREVIEW_PATH = "/admin/agent-team-preview";

/** Synthetic design data only. No project, persona, account or task lookup is
 * performed, and no request input can alter this read-only fixture. */
function previewTemplate() {
  return {
    ...socialMockTeamTemplate,
    name: "Örnek sosyal medya takımı — yalnız tasarım",
    members: socialMockTeamTemplate.members.map((member) => ({
      ...member,
      purpose: "Örnek talimat — bu önizlemede çalıştırılmaz",
      output: "Örnek çıktı tanımı — herhangi bir içerik üretilmez",
    })),
  };
}

/** Static design surface only. This is not a PersonaRuntimeBoundary and cannot
 * authorize data access, a write, approval or execution. */
export function isPersonaTeamPreviewEnabled() {
  return (
    process.env.NODE_ENV === "production" &&
    process.env.APP_BASE_URL === "https://staging.findandstudy.com" &&
    process.env.ALLOW_LIVE_INTEGRATIONS === "false" &&
    process.env.PERSONA_TEAM_PREVIEW_ENABLED === "true"
  );
}

function previewAsset(
  file: "persona-team-tree.client.js" | "persona-team-tree.css",
) {
  const directory =
    typeof __dirname === "string"
      ? join(__dirname, "assets", "persona-workspace")
      : fileURLToPath(new URL("../lib/", import.meta.url));
  return readFileSync(join(directory, file), "utf8");
}

/** Mount behind the existing normal OS admin session middleware. This router
 * has only fixed GET resources: no scope/user input, DB, login or API adapter. */
export function createPersonaTeamPreview() {
  if (!isPersonaTeamPreviewEnabled())
    throw new Error("PERSONA_DESIGN_PREVIEW_DISABLED");
  const router = Router();
  router.use((req, res, next) => {
    res.set({
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      // The existing editor positions cards via element.style. This permits
      // style attributes only, never inline scripts or outbound requests.
      "Content-Security-Policy":
        "default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; worker-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    });
    if (!isPersonaTeamPreviewEnabled()) {
      res.status(404).send("PERSONA_DESIGN_PREVIEW_DISABLED");
      return;
    }
    if (req.method !== "GET") {
      res
        .set("Allow", "GET")
        .status(405)
        .send("PERSONA_DESIGN_PREVIEW_READ_ONLY");
      return;
    }
    next();
  });
  // The surrounding access middleware authenticates this deep link before the
  // normal React dashboard is opened. Never forward a caller-supplied target.
  router.get("/", (_req, res) => res.redirect(302, "/?workspace=team-preview"));
  router.get("/template.json", (_req, res) => res.json(previewTemplate()));
  router.get("/panel.css", (_req, res) =>
    res
      .type("css")
      .send(
        `body{font:16px system-ui;margin:0;background:#f5f7fb;color:#17233a}main{max-width:1440px;margin:auto;padding:24px}label{display:block;margin:12px 0 6px}input,textarea,select{box-sizing:border-box;width:100%;padding:12px;font:inherit}button{padding:12px;margin:10px 8px 0 0;min-height:44px;cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere}*:focus-visible{outline:3px solid #235fce;outline-offset:3px}@media(max-width:600px){main{padding:12px}}`,
      ),
  );
  router.get("/preview.js", (_req, res) => {
    const safeLiteral = JSON.stringify(previewTemplate()).replace(
      /</g,
      "\\u003c",
    );
    res
      .type("js")
      .send(
        `import { initializePersonaTeamEditor } from '${PERSONA_TEAM_PREVIEW_PATH}/team-tree.js';\ninitializePersonaTeamEditor({designPreviewTemplate:${safeLiteral}});`,
      );
  });
  router.get("/team-tree.js", (_req, res) =>
    res.type("js").send(previewAsset("persona-team-tree.client.js")),
  );
  router.get("/team-tree.css", (_req, res) =>
    res.type("css").send(previewAsset("persona-team-tree.css")),
  );
  return router;
}
