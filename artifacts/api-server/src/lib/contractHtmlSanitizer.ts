import { JSDOM } from "jsdom";

const DROP_ELEMENTS = new Set([
  "script", "iframe", "frame", "frameset", "object", "embed", "applet",
  "base", "meta", "link", "form", "input", "button", "textarea", "select",
  "option", "template", "noscript", "svg", "math", "audio", "video", "source",
]);

const URL_ATTRIBUTES = new Set(["href", "src", "poster", "background"]);

function sanitizeCss(css: string): string {
  return css
    .replace(/@import\s+[^;]+;?/gi, "")
    .replace(/url\s*\([^)]*\)/gi, "none")
    .replace(/expression\s*\([^)]*\)/gi, "")
    .replace(/(?:behavior|-moz-binding)\s*:[^;]+;?/gi, "");
}

function isSafeUrlAttribute(name: string, rawValue: string): boolean {
  const value = rawValue.trim().replace(/[\u0000-\u001f\u007f\s]+/g, "");
  if (!value) return true;
  // Template URLs are validated again after placeholder rendering.
  if (/^\{\{\{?\s*[\w.]+\s*\}?\}\}$/.test(value)) return true;
  if (value.startsWith("#") || (value.startsWith("/") && !value.startsWith("//"))) return true;
  if (name === "src" && /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=]+$/i.test(value)) {
    return true;
  }
  try {
    const parsed = new URL(value);
    if (name === "href") return ["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Sanitize administrator-authored contract HTML at both storage and render
 * boundaries. Contract layout markup and inline CSS remain available, while
 * executable elements, event handlers, active URLs and external CSS fetches
 * are removed. Running this again after placeholder expansion validates URLs
 * originating from signer-provided intake values as well.
 */
export function sanitizeContractTemplateHtml(rawHtml: string): string {
  const source = String(rawHtml ?? "");
  const fullDocument = /<(?:!doctype|html|head|body)\b/i.test(source);
  const dom = new JSDOM(source);
  const { document } = dom.window;

  for (const element of Array.from(document.querySelectorAll("*"))) {
    const tag = element.tagName.toLowerCase();
    if (DROP_ELEMENTS.has(tag)) {
      element.remove();
      continue;
    }
    if (tag === "style") {
      element.textContent = sanitizeCss(element.textContent || "");
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith("on")
        || ["srcdoc", "srcset", "formaction", "action", "ping", "xlink:href"].includes(name)
      ) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === "style") {
        const cleanStyle = sanitizeCss(attribute.value);
        if (cleanStyle.trim()) element.setAttribute(attribute.name, cleanStyle);
        else element.removeAttribute(attribute.name);
        continue;
      }
      if (URL_ATTRIBUTES.has(name) && !isSafeUrlAttribute(name, attribute.value)) {
        element.removeAttribute(attribute.name);
      }
    }
    if (tag === "a" && element.getAttribute("target") === "_blank") {
      element.setAttribute("rel", "noopener noreferrer");
    }
  }

  if (fullDocument) return `<!doctype html>${document.documentElement.outerHTML}`;
  return document.body.innerHTML;
}
