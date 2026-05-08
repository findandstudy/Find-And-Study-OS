type Ctx = Record<string, any>;

function lookup(ctx: Ctx, path: string): string {
  const parts = path.split(".");
  // For unqualified keys (e.g. {{agency_name}}) fall through into the standard
  // sub-contexts so author-defined intake/agent fields resolve regardless of
  // whether the template uses {{agency_name}} or {{intake.agency_name}}.
  if (parts.length === 1) {
    const key = parts[0];
    for (const scope of [ctx, ctx.intake, ctx.agent, ctx.contract]) {
      if (scope && scope[key] != null && scope[key] !== "") {
        const v = scope[key];
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        return String(v);
      }
    }
    return "";
  }
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

export function buildAgentContext(agent: any | null, intake: Record<string, any> | null, contract: { date?: string; signerEmail?: string; signerName?: string; number?: string } = {}): Ctx {
  const dateStr = contract.date || new Date().toISOString().slice(0, 10);
  return {
    agent: agent || {},
    intake: intake || {},
    contract: {
      date: dateStr,
      number: contract.number || "",
      signerEmail: contract.signerEmail || "",
      signerName: contract.signerName || "",
    },
    // Top-level aliases used directly by author templates such as
    // {{contract_number}} and {{sign_date}}.
    contract_number: contract.number || "",
    sign_date: dateStr,
    // Signature placeholders kept empty so templates can still reference them
    // via {{signature}} / {{main_agency_signature}}; the rendered preview is
    // post-processed by `cleanupSignatureImages` to swap empty <img src="">
    // tags for styled placeholder boxes (avoiding the broken-image icon).
    signature: "",
    main_agency_signature: "",
  };
}

/**
 * Replace `<img>` tags whose `src` is empty (rendered from an unfilled
 * `{{signature}}` placeholder) with a styled placeholder box. Also strips
 * literal `<img src="{{...}}">` placeholders that the renderer left intact
 * because the path didn't match its regex.
 */
export function cleanupSignatureImages(html: string, placeholderText: string): string {
  // Strip the literal `{{...}}` (3-dot) placeholder that the contract author
  // left in the template — it's not a real path, just a visual marker.
  let out = html.replace(/<img[^>]*src=["']\{\{\.\.\.\}\}["'][^>]*>/gi, "");

  out = out.replace(/<img\b([^>]*)>/gi, (full, attrs) => {
    const srcMatch = (attrs as string).match(/\bsrc\s*=\s*(["'])(.*?)\1/i);
    const src = srcMatch ? srcMatch[2].trim() : "";
    if (src && !/^\{\{[\w.]+\}\}$/.test(src)) return full;
    const altMatch = (attrs as string).match(/\balt\s*=\s*(["'])(.*?)\1/i);
    const alt = altMatch ? altMatch[2].trim() : placeholderText;
    const safe = escapeHtml(alt || placeholderText);
    return `<div style="display:flex;align-items:center;justify-content:center;min-height:64px;border:1px dashed #cbd5e1;border-radius:8px;background:#f8fafc;color:#94a3b8;font-size:12px;font-style:italic;padding:16px;margin:4px 0;">${safe}</div>`;
  });

  return out;
}
