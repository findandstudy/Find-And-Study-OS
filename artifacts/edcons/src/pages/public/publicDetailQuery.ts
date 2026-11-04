import { useQuery, type QueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Language } from "@/lib/i18n";

export type PublicDetailKind = "destination" | "city" | "university" | "program";

const DETAIL_STALE_TIME = 5 * 60 * 1_000;
const DETAIL_GC_TIME = 30 * 60 * 1_000;

function detailUrl(kind: PublicDetailKind, identity: string, locale: Language): string {
  const encodedIdentity = encodeURIComponent(identity);
  const encodedLocale = encodeURIComponent(locale);
  switch (kind) {
    case "destination":
      return `/api/public/destinations/${encodedIdentity}?locale=${encodedLocale}`;
    case "city":
      return `/api/public/web/cities/${encodedIdentity}?locale=${encodedLocale}`;
    case "university":
      return `/api/public/catalog/universities/${encodedIdentity}?locale=${encodedLocale}`;
    case "program":
      return `/api/public/catalog/programs/${encodedIdentity}?locale=${encodedLocale}`;
  }
}

function detailQueryKey(kind: PublicDetailKind, identity: string, locale: Language) {
  return ["public-detail", kind, identity, locale] as const;
}

function detailQueryOptions<T>(kind: PublicDetailKind, identity: string, locale: Language) {
  return {
    queryKey: detailQueryKey(kind, identity, locale),
    queryFn: ({ signal }: { signal: AbortSignal }) => customFetch<T>(
      detailUrl(kind, identity, locale),
      { method: "GET", signal },
    ),
    staleTime: DETAIL_STALE_TIME,
    gcTime: DETAIL_GC_TIME,
  };
}

export function usePublicDetailPayload<T>(input: {
  kind: PublicDetailKind;
  identity: string;
  locale: Language;
  preview: boolean;
  previewPayload?: T | null;
}) {
  const query = useQuery<T>({
    ...detailQueryOptions<T>(input.kind, input.identity, input.locale),
    enabled: !input.preview,
    // A locale switch is prefetched before it is committed. This fallback is
    // still useful for a transient revalidation: keep the complete page on
    // screen instead of replacing it with a full-page skeleton.
    placeholderData: (previous) => previous,
  });

  const payload = input.preview
    ? input.previewPayload ?? null
    : query.data ?? null;

  return {
    payload,
    loading: !input.preview && query.isPending && !query.data,
    refreshing: !input.preview && query.isFetching && Boolean(query.data),
    error: !input.preview && query.isError && !query.data,
    retry: query.refetch,
  };
}

function detailIdentityFromPath(pathname: string): { kind: PublicDetailKind; identity: string } | null {
  const parts = pathname.split("?")[0].split("#")[0].split("/").filter(Boolean);
  if (parts.length < 3) return null;
  const section = parts[1];
  const identity = parts[2];
  if (!identity) return null;
  if (section === "countries" || section === "destinations") return { kind: "destination", identity };
  if (section === "cities") return { kind: "city", identity };
  if (section === "universities") return { kind: "university", identity };
  if (section === "programs") return { kind: "program", identity };
  return null;
}

/**
 * Warm the exact target-locale payload before the visible language changes.
 * Non-detail routes have no record payload to warm and resolve immediately.
 */
export async function prefetchPublicDetailForLanguage(
  queryClient: QueryClient,
  pathname: string,
  locale: Language,
): Promise<void> {
  const detail = detailIdentityFromPath(pathname);
  if (!detail) return;
  await queryClient.fetchQuery(
    detailQueryOptions<unknown>(detail.kind, detail.identity, locale),
  );
}
