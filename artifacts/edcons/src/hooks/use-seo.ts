import { useEffect } from "react";

interface SeoOptions {
  title: string;
  description?: string;
  canonical?: string;
  noindex?: boolean;
  ogImage?: string;
  ogType?: "website" | "article";
}

function setMeta(name: string, content: string, isProperty = false) {
  const attr = isProperty ? "property" : "name";
  let el = document.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.content = content;
}

function setLink(rel: string, href: string) {
  let el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.rel = rel;
    document.head.appendChild(el);
  }
  el.href = href;
}

export function useSeo({ title, description, canonical, noindex = false, ogImage, ogType = "website" }: SeoOptions) {
  useEffect(() => {
    const siteName = "EduCons";
    const fullTitle = `${title} | ${siteName}`;

    document.title = fullTitle;

    if (description) setMeta("description", description);
    setMeta("robots", noindex ? "noindex, nofollow" : "index, follow");

    const canonicalHref = canonical ?? window.location.href.split("?")[0].split("#")[0];
    setLink("canonical", canonicalHref);

    setMeta("og:title", fullTitle, true);
    setMeta("og:site_name", siteName, true);
    setMeta("og:type", ogType, true);
    setMeta("og:url", canonicalHref, true);
    if (description) setMeta("og:description", description, true);
    if (ogImage) setMeta("og:image", ogImage, true);

    setMeta("twitter:card", "summary_large_image");
    setMeta("twitter:title", fullTitle);
    if (description) setMeta("twitter:description", description);
    if (ogImage) setMeta("twitter:image", ogImage);
  }, [title, description, canonical, noindex, ogImage, ogType]);
}
