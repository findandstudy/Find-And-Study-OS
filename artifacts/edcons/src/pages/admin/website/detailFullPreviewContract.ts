import { parseDetailContent, type DetailContent, type DetailContentKind } from "@/lib/website/detailContentContract";
import { parseDetailLayout, type DetailLayout } from "@/lib/website/detailLayoutContract";

export type DetailPreviewTarget = { kind: DetailContentKind; entityId: number; locale: string; canonicalPath?: string | null };
export type DetailPreviewRoute = { canonicalPath: string; routeKey: string; readPath: string };
export const PREVIEW_READ_BYTES = 1024 * 1024;
export const PREVIEW_TIMEOUT_MS = 12000;
const collection = { destination: "countries", city: "cities", university: "universities", program: "programs" } as const;
const apiCollection = { destination: "/api/public/destinations", city: "/api/public/web/cities", university: "/api/public/catalog/universities", program: "/api/public/catalog/programs" } as const;
export const previewRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** An inventory route supplies only a bounded key; never fetch an arbitrary URL. */
export function detailPreviewRoute(target: DetailPreviewTarget, content: DetailContent): DetailPreviewRoute | null {
  if (!parseDetailContent(content) || content.kind !== target.kind || content.entityId !== target.entityId) return null;
  const parts = target.canonicalPath?.split("/");
  if (!parts || parts.length !== 4 || parts[0] !== "" || parts[1] !== target.locale || parts[2] !== collection[target.kind]
    || !/^[a-z0-9][a-z0-9-]{0,299}$/.test(parts[3])) return null;
  return {
    canonicalPath: `/${content.locale}/${parts[2]}/${parts[3]}`,
    routeKey: parts[3],
    readPath: `${apiCollection[target.kind]}/${parts[3]}?locale=${encodeURIComponent(content.locale)}`,
  };
}

/** Current public facts must prove entity, kind and locale before attaching a draft. */
export function bindDetailPreviewPayload(value: unknown, target: DetailPreviewTarget, content: DetailContent): Record<string, unknown> {
  if (!detailPreviewRoute(target, content) || !previewRecord(value) || !previewRecord(value.meta)) throw new Error("Preview binding rejected");
  const entity = target.kind === "destination" ? value.destination : value.data;
  if (!previewRecord(entity) || (target.kind === "destination" ? entity.catalogCountryId : entity.id) !== target.entityId) throw new Error("Preview entity rejected");
  const parts = typeof value.meta.canonicalPath === "string" ? value.meta.canonicalPath.split("/") : [];
  if (parts.length !== 4 || parts[0] !== "" || parts[1] !== content.locale || parts[2] !== collection[target.kind]
    || !/^[a-z0-9][a-z0-9-]{0,299}$/.test(parts[3]) || (value.meta.locale !== undefined && value.meta.locale !== content.locale)) throw new Error("Preview locale rejected");
  if (entity.canonicalPath !== undefined && entity.canonicalPath !== value.meta.canonicalPath) throw new Error("Preview path rejected");
  if (typeof entity.name !== "string" || !entity.name.trim() || typeof value.meta.indexable !== "boolean") throw new Error("Preview facts rejected");
  const arrays = target.kind === "destination" ? [value.universities, value.programs, value.cities]
    : target.kind === "city" ? [entity.universities, entity.programs]
      : target.kind === "university" ? [value.programs] : [value.intakes, value.prices, value.related];
  if (!arrays.every(items => Array.isArray(items) && items.length <= 1000 && items.every(previewRecord))) throw new Error("Preview facts rejected");
  if (target.kind === "destination" && (!previewRecord(value.stats) || !Number.isSafeInteger(value.stats.universityCount) || !Number.isSafeInteger(value.stats.programCount))) throw new Error("Preview counts rejected");
  return { ...value, editorial: parseDetailContent(content)! };
}

export function bindDetailPreviewLayout(value: unknown, kind: DetailContentKind): DetailLayout {
  const layout = parseDetailLayout(value);
  if (!layout || layout.kind !== kind) throw new Error("Preview layout rejected");
  return layout;
}

export function bindPreviewUniversityPrograms(result: unknown, facets: unknown, entityId: number) {
  if (!previewRecord(result) || !Array.isArray(result.data) || result.data.length > 24
    || !result.data.every(row => previewRecord(row) && row.universityId === entityId && Number.isSafeInteger(row.id))
    || !previewRecord(result.meta) || !Number.isSafeInteger(result.meta.total) || Number(result.meta.total) < 0
    || !Number.isSafeInteger(result.meta.totalPages) || Number(result.meta.totalPages) < 0
    || !previewRecord(facets) || !["countries", "cities", "universities", "universityTypes", "degrees", "languages", "fields"].every(key => Array.isArray(facets[key]) && facets[key].length <= 1000)) throw new Error("Preview university scope rejected");
  return { result, facets };
}

/** Public, same-origin, GET-only; bounded streaming read, no cookies or draft body. */
export async function readDetailPreviewJson(path: string, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  if (!/^\/api\/(?:public\/|course-finder(?:\?|\/filters\?))/.test(path) || /[\\\s#]/.test(path)) throw new Error("Preview read rejected");
  const response = await fetch(path, { method: "GET", credentials: "omit", redirect: "error", cache: "no-store", signal, headers: { Accept: "application/json" } });
  if (response.status !== 200 || response.headers.get("content-type")?.split(";")[0].trim() !== "application/json" || !response.body) throw new Error("Preview unavailable");
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > PREVIEW_READ_BYTES)) { await response.body.cancel(); throw new Error("Preview too large"); }
  const reader = response.body.getReader();
  let size = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let body = "";
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > PREVIEW_READ_BYTES) throw new Error("Preview too large");
      body += decoder.decode(next.value, { stream: true });
    }
    signal.throwIfAborted();
    return JSON.parse(body + decoder.decode());
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
