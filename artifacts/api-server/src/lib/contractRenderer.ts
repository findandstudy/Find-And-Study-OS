type Ctx = Record<string, any>;

function lookup(ctx: Ctx, path: string): string {
  const parts = path.split(".");
  let cur: any = ctx;
  for (const p of parts) {
    if (cur == null) return "";
    cur = cur[p];
  }
  if (cur == null) return "";
  if (cur instanceof Date) return cur.toISOString().slice(0, 10);
  return String(cur);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Renders a Handlebars-flavored template (no logic, just `{{path.to.value}}`
 * and `{{{path.to.value}}}` for raw HTML). Missing values resolve to "".
 */
export function renderTemplate(body: string, ctx: Ctx): string {
  let out = body.replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_m, path) => lookup(ctx, path));
  out = out.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path) => escapeHtml(lookup(ctx, path)));
  return out;
}

export function buildAgentContext(agent: any | null, intake: Record<string, any> | null, contract: { date?: string; signerEmail?: string; signerName?: string } = {}): Ctx {
  return {
    agent: agent || {},
    intake: intake || {},
    contract: {
      date: contract.date || new Date().toISOString().slice(0, 10),
      signerEmail: contract.signerEmail || "",
      signerName: contract.signerName || "",
    },
  };
}
