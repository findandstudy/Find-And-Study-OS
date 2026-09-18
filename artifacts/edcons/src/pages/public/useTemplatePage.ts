import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { PageResponse } from "./PublicPage";
import { useEffect } from "react";
export function useTemplatePage(slug: "home" | "about", locale: string) {
  const query = useQuery<PageResponse>({
    queryKey: ["published-template-page", slug, locale],
    queryFn: ({ signal }) => customFetch(`/api/website/pages/${slug}?locale=${encodeURIComponent(locale)}`, { signal }),
    retry: false, staleTime: 0, refetchOnMount: "always",
  });
  return !query.isError && Array.isArray(query.data?.data?.blocks) && query.data.data.blocks.length ? query.data : null;
}
export function useTemplatePageSeo(page: PageResponse | null) {
  useEffect(() => {
    if (!page) return;
    const seo = page.data.seo || {};
    const originals: { el: Element; value: string | null; attribute: string; created: boolean }[] = [];
    const set = (selector: string, attribute: string, value: string, name?: string, property = false) => {
      let el = document.head.querySelector(selector);
      const created = !el;
      if (!el) { el = document.createElement("meta"); el.setAttribute(property ? "property" : "name", name!); document.head.appendChild(el); }
      originals.push({ el, value: el.getAttribute(attribute), attribute, created }); el.setAttribute(attribute, value);
    };
    for (const [key, name, property] of [["ogTitle", "og:title", true], ["ogDescription", "og:description", true], ["ogImageUrl", "og:image", true], ["twitterTitle", "twitter:title", false], ["twitterDescription", "twitter:description", false], ["twitterImageUrl", "twitter:image", false]] as const) {
      if (typeof seo[key] === "string" && seo[key]) set(`meta[${property ? "property" : "name"}="${name}"]`, "content", String(seo[key]), name, property);
    }
    if (seo.robotsFollow === false) set('meta[name="robots"]', "content", `${page.meta.indexable ? "index" : "noindex"}, nofollow`, "robots");
    return () => { for (const { el, value, attribute, created } of originals) { if (created) el.remove(); else if (value === null) el.removeAttribute(attribute); else el.setAttribute(attribute, value); } };
  }, [page]);
}
