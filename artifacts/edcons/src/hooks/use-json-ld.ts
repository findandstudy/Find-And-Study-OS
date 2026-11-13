import { useEffect } from "react";
import {
  buildOrganizationSchema,
  CORPORATE_FACTS,
} from "@workspace/corporate-facts";

export function useJsonLd(schema: object | object[]) {
  useEffect(() => {
    const schemas = (Array.isArray(schema) ? schema : [schema]).filter(Boolean);
    const canonicalHref = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href
      ?? window.location.href.split(/[?#]/, 1)[0];
    const serverSchema = document.querySelector<HTMLScriptElement>('script[type="application/ld+json"][data-public-json-ld="ssr"]');

    // The public renderer is the authoritative structured-data owner on a
    // direct request. Hydration must not append a second WebPage or entity
    // node. On client-side navigation the canonical changes, so the stale SSR
    // graph is removed and replaced by one client-owned graph.
    if (serverSchema?.textContent?.includes(canonicalHref)) {
      document.querySelectorAll('script[type="application/ld+json"][data-public-json-ld="client"]')
        .forEach((element) => element.remove());
      return;
    }
    serverSchema?.remove();
    document.querySelectorAll('script[type="application/ld+json"][data-public-json-ld="client"]')
      .forEach((element) => element.remove());

    if (!schemas.length) return;
    const graph = schemas.length === 1 && "@graph" in schemas[0]
      ? schemas[0]
      : {
          "@context": "https://schema.org",
          "@graph": schemas.map((item) => {
            const { "@context": _context, ...node } = item as Record<string, unknown>;
            return node;
          }),
        };
    const el = document.createElement("script");
    el.type = "application/ld+json";
    el.dataset.publicJsonLd = "client";
    const nonce = document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content;
    if (nonce) el.nonce = nonce;
    el.textContent = JSON.stringify(graph);
    document.head.appendChild(el);

    return () => {
      if (document.head.contains(el)) document.head.removeChild(el);
    };
  }, [JSON.stringify(schema)]);
}

export const SITE_URL = CORPORATE_FACTS.canonicalUrl;
export const SITE_NAME = CORPORATE_FACTS.name;
export const ORG_SCHEMA = buildOrganizationSchema();
