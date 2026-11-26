import { JSDOM } from 'jsdom';

/** Comment text is not a contract field. Quoted CSS content remains visible. */
export function contractTemplateVariables(html: string): string[] {
  const stripCssComments = (css: string) => {
    let out = '', quote = '';
    for (let i = 0; i < css.length; i++) {
      const c = css[i];
      if (quote) {
        out += c;
        if (c === '\\' && i + 1 < css.length) out += css[++i];
        else if (c === quote) quote = '';
      } else if (c === '\\' && i + 1 < css.length) out += c + css[++i];
      else if (c === '"' || c === "'") { quote = c; out += c; }
      else if (c === '/' && css[i + 1] === '*') {
        const end = css.indexOf('*/', i + 2);
        if (end < 0) return out;
        out += ' '; i = end + 1;
      } else out += c;
    }
    return out;
  };
  const dom = new JSDOM(html);
  try {
    const doc = dom.window.document;
    const walker = doc.createTreeWalker(doc, dom.window.NodeFilter.SHOW_COMMENT);
    const comments: Array<typeof walker.currentNode> = [];
    while (walker.nextNode()) comments.push(walker.currentNode);
    for (const comment of comments) comment.parentNode?.removeChild(comment);
    for (const style of doc.querySelectorAll('style')) style.textContent = stripCssComments(style.textContent || '');
    for (const element of doc.querySelectorAll('[style]')) element.setAttribute('style', stripCssComments(element.getAttribute('style') || ''));
    return [...new Set([...doc.documentElement.outerHTML.matchAll(/\{\{\{?\s*([\w.]+)\s*\}\}\}?/g)].map(match => match[1]))];
  } finally { dom.window.close(); }
}

/** Only an explicit WhatsApp answer is an alias. Generic phone is not. */
export function normalizeContractSigningIntake(value: unknown): Record<string, unknown> {
  const intake = value && typeof value === 'object' && !Array.isArray(value) ? { ...value } as Record<string, unknown> : {};
  if (!Object.prototype.hasOwnProperty.call(intake, 'whatsapp_phone') && typeof intake.whatsappPhone === 'string' && intake.whatsappPhone.trim()) {
    intake.whatsapp_phone = intake.whatsappPhone.trim();
  }
  return intake;
}

export type ContractIntakeField = { key: string; label: string; type: string; required?: boolean; [key: string]: unknown };
export function contractSigningIntakeRequirements(input: { bodyHtml: string; intakeSchema: unknown; intakeData: unknown; language?: string }) {
  const fields: ContractIntakeField[] = Array.isArray(input.intakeSchema)
    ? input.intakeSchema.filter((field: any) => field && typeof field.key === 'string').map((field: any) => ({ ...field })) : [];
  const intake = normalizeContractSigningIntake(input.intakeData);
  if (contractTemplateVariables(input.bodyHtml).some(key => key === 'whatsapp_phone' || key === 'intake.whatsapp_phone')) {
    const declared = fields.find(field => field.key === 'whatsapp_phone' || field.key === 'whatsappPhone');
    // The displayed field must be the value the canonical template uses.
    // Otherwise an explicit blank canonical value plus stale camelCase answer
    // can pass the form but fail PDF validation forever.
    if (declared) { declared.key = 'whatsapp_phone'; declared.required = true; }
    else fields.push({ key: 'whatsapp_phone', type: 'tel', required: true,
      label: input.language === 'tr' ? 'WhatsApp numarası' : input.language === 'ar' ? 'رقم واتساب' : 'WhatsApp number' });
  }
  const missingFields = fields.filter(field => field.required && (typeof intake[field.key] !== 'string' || !String(intake[field.key]).trim())).map(field => field.key);
  return { fields, missingFields, intake };
}

export function missingContractTemplateFields(html: string, ctx: Record<string, any>): string[] {
  return contractTemplateVariables(html).filter(key => {
    const parts = key.split('.');
    if (parts.some(part => ['__proto__', 'prototype', 'constructor'].includes(part))) return true;
    const value = parts.reduce((current: any, part) => current && Object.prototype.hasOwnProperty.call(current, part) ? current[part] : undefined, ctx);
    const fallback = parts.length === 1 ? [ctx.intake, ctx.agent, ctx.contract].map(scope => scope?.[parts[0]]).find(v => v !== undefined && v !== '') : undefined;
    const present = (v: unknown) => (typeof v === 'string' && !!v.trim()) || (typeof v === 'number' && Number.isFinite(v));
    return !present(value) && !present(fallback);
  });
}

/** Keep server-owned application association even if an older client omits it. */
export function mergeContractSigningIntake(existing: unknown, submitted: Record<string, string>) {
  const old = normalizeContractSigningIntake(existing);
  const next = { ...submitted } as Record<string, unknown>;
  delete next.agentApplicationContractHash;
  if (Object.prototype.hasOwnProperty.call(old, 'agentApplicationContractHash')) next.agentApplicationContractHash = old.agentApplicationContractHash;
  return normalizeContractSigningIntake(next);
}
