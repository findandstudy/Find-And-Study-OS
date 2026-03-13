import { useEffect } from "react";

interface SeoOptions {
  title: string;
  description?: string;
  canonical?: string;
}

export function useSeo({ title, description, canonical }: SeoOptions) {
  useEffect(() => {
    const siteName = "EduCons";
    document.title = `${title} | ${siteName}`;

    let metaDesc = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement("meta");
      metaDesc.name = "description";
      document.head.appendChild(metaDesc);
    }
    if (description) metaDesc.content = description;

    let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.appendChild(link);
    }
    link.href = canonical ?? window.location.href;
  }, [title, description, canonical]);
}
