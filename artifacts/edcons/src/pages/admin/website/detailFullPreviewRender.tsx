import { renderToReadableStream } from "react-dom/server.browser";
import type { ComponentType } from "react";
import { Router } from "wouter";
import { I18nContext } from "@/lib/i18n/use-i18n-context";
import { buildLocalizedPath, getTranslation, LANGUAGE_META, loadLanguage, type Language } from "@/lib/i18n/index";
import { DetailPreviewContext } from "@/pages/public/DetailPreviewContext";
import type { DetailContent } from "@/lib/website/detailContentContract";
import type { DetailLayout } from "@/lib/website/detailLayoutContract";
import { type DetailPreviewRoute } from "./detailFullPreviewContract";

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("Preview cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** No app scripts, network actions, external images, private media or draft URL. */
export function createDetailPreviewDocument(markup: string, locale: Language, sourceDocument: Document = document): string {
  if (markup.length > 2 * 1024 * 1024) throw new Error("Preview too large");
  const previewDocument = sourceDocument.implementation.createHTMLDocument("Detail preview");
  previewDocument.documentElement.lang = locale;
  previewDocument.documentElement.dir = LANGUAGE_META[locale].dir;
  const csp = previewDocument.createElement("meta");
  csp.httpEquiv = "Content-Security-Policy";
  csp.content = `default-src 'none'; script-src 'none'; connect-src 'none'; style-src 'unsafe-inline'; img-src ${sourceDocument.location.origin}/assets/ ${sourceDocument.location.origin}/images/; font-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'`;
  previewDocument.head.prepend(csp);
  const viewport = previewDocument.createElement("meta"); viewport.name = "viewport"; viewport.content = "width=device-width, initial-scale=1"; previewDocument.head.append(viewport);
  const robots = previewDocument.createElement("meta"); robots.name = "robots"; robots.content = "noindex, nofollow"; previewDocument.head.append(robots);
  const referrer = previewDocument.createElement("meta"); referrer.name = "referrer"; referrer.content = "no-referrer"; previewDocument.head.append(referrer);
  // Read CSS already loaded by this app; never fetch stylesheet URLs from content.
  let css = "";
  for (const sheet of Array.from(sourceDocument.styleSheets)) {
    if (sheet.href && new URL(sheet.href, sourceDocument.location.href).origin !== sourceDocument.location.origin) continue;
    try { css += Array.from(sheet.cssRules).map(rule => rule.cssText).join("\n"); } catch { throw new Error("Preview styles unavailable"); }
    if (css.length > 2 * 1024 * 1024) throw new Error("Preview styles too large");
  }
  const style = previewDocument.createElement("style");
  style.textContent = css.replace(/@import\s[^;]+;/gi, "").replace(/url\s*\([^)]*\)/gi, "none")
    + "\nhtml,body{margin:0;background:white;color:#14213a}body{overflow-x:hidden}a[aria-disabled=true]{cursor:default}*{animation:none!important;transition:none!important}";
  previewDocument.head.append(style);
  // Template contents are inert during sanitization: image URLs cannot fire early.
  const template = sourceDocument.createElement("template");
  template.innerHTML = markup;
  template.content.querySelectorAll("script,style,link,meta,base,iframe,frame,object,embed,audio,video,source,form").forEach(node => node.remove());
  for (const element of Array.from(template.content.querySelectorAll("*"))) {
    for (const attr of Array.from(element.attributes)) {
      if (/^on/i.test(attr.name) || /^(?:srcset|poster|ping|action|formaction|srcdoc|background|data|xlink:href|autofocus)$/i.test(attr.name)) element.removeAttribute(attr.name);
      if (attr.name === "style" && /url\s*\(|@import/i.test(attr.value)) element.removeAttribute("style");
    }
    if (element.hasAttribute("href")) {
      const href = element.getAttribute("href")!;
      if (element.tagName !== "A" || !/^#[a-z][a-z0-9-]{0,80}$/.test(href)) {
        element.removeAttribute("href"); element.setAttribute("aria-disabled", "true"); element.setAttribute("tabindex", "-1");
      } else element.setAttribute("href", `about:srcdoc${href}`); // A bare fragment inherits the admin base URL.
    }
    element.removeAttribute("target"); element.removeAttribute("download");
    if (element.hasAttribute("src")) {
      const src = element.getAttribute("src")!;
      let path = "";
      try {
        const url = new URL(src, sourceDocument.location.origin);
        if (url.origin === sourceDocument.location.origin && !url.search && !url.hash) path = url.pathname;
      } catch { /* Unavailable media stays a labelled placeholder. */ }
      if (element.tagName === "IMG" && /^\/(?:assets|images)\/[a-zA-Z0-9_/-]+\.(?:png|jpe?g|webp|gif|avif)$/.test(path)) {
        element.setAttribute("src", `${sourceDocument.location.origin}${path}`); element.setAttribute("referrerpolicy", "no-referrer");
      } else { element.removeAttribute("src"); element.setAttribute("data-preview-media", "blocked"); }
    }
    if (/^(?:BUTTON|INPUT|SELECT|TEXTAREA)$/.test(element.tagName)) {
      element.setAttribute("disabled", ""); element.setAttribute("aria-disabled", "true");
    }
    element.removeAttribute("contenteditable");
  }
  previewDocument.body.append(previewDocument.importNode(template.content, true));
  return `<!doctype html>${previewDocument.documentElement.outerHTML}`;
}

/** Server rendering runs no effects: SEO, routing, analytics and language persistence cannot run. */
export async function renderDetailFullPreview({ content, payload, layout, route, universityPrograms, signal }: {
  content: DetailContent; payload: Record<string, unknown>; layout: DetailLayout; route: DetailPreviewRoute;
  universityPrograms?: { result: unknown; facets: unknown }; signal: AbortSignal;
}) {
  const lang = content.locale as Language;
  const loaded = await abortable(loadLanguage(lang), signal);
  if (!loaded) throw new Error("Preview language unavailable");
  const modules: Record<DetailContent["kind"], () => Promise<{ default: ComponentType<{ slug: string; routeKey: string }> }>> = {
    destination: () => import("@/pages/public/CountryDetail"), city: () => import("@/pages/public/CityDetail"),
    university: () => import("@/pages/public/UniversityDetail"), program: () => import("@/pages/public/ProgramDetail"),
  };
  const { default: Page } = await abortable(modules[content.kind](), signal);
  let renderError = false;
  const dir = LANGUAGE_META[lang].dir;
  const stream = await renderToReadableStream(
    <I18nContext.Provider value={{ lang, dir, isRTL: dir === "rtl", setLang: () => undefined,
      t: (key, params) => getTranslation(lang, key, params), localePath: path => buildLocalizedPath(path, lang) }}>
      <Router ssrPath={route.canonicalPath}>
        <DetailPreviewContext.Provider value={{ payload, layout, universityPrograms }}><Page slug={route.routeKey} routeKey={route.routeKey} /></DetailPreviewContext.Provider>
      </Router>
    </I18nContext.Provider>, { signal, onError: () => { renderError = true; } },
  );
  await abortable(stream.allReady, signal);
  const reader = stream.getReader();
  let bytes = 0, markup = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const next = await abortable(reader.read(), signal);
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 2 * 1024 * 1024) throw new Error("Preview too large");
      markup += decoder.decode(next.value, { stream: true });
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  signal.throwIfAborted();
  if (renderError) throw new Error("Preview render unavailable");
  return createDetailPreviewDocument(markup + decoder.decode(), lang);
}
