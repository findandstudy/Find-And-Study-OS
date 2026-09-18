import type { RequestHandler } from "express";
import { readPageDetail } from "./publicCatalogRenderReadModel";
import { normalizeProgramLocale } from "./programTranslationContract";

/** Public slug lookup is separate from authenticated numeric authoring CRUD. */
export const readWebsitePublishedPage: RequestHandler = async (req, res, next) => {
  const slug = String(req.params.slug ?? req.params.id ?? "").replace(/^\/+|\/+$/g, "");
  if (/^\d+$/.test(slug)) { next(); return; }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) { res.status(404).json({ error: "Page not found" }); return; }
  try {
    const locale = normalizeProgramLocale(req.query.locale ?? req.query.lang);
    const model = await readPageDetail({ kind: "page_detail", locale, slug, path: `/${locale}/${slug}` });
    if (model.kind !== "page_detail") { res.status(404).json({ error: "Page not found" }); return; }
    res.json({ data: model.page, meta: { title: model.title, description: model.description,
      indexable: model.indexable, canonicalPath: model.canonicalPath, alternatePaths: model.alternatePaths } });
  } catch { res.status(503).json({ error: "Published page temporarily unavailable" }); }
};
