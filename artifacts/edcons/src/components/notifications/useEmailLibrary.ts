import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { EmailCapabilities, EmailSender, EmailTemplate } from "./emailAutomationModel";

export const emailLibraryKey = ["notification-email"] as const;
type TemplatesPage = { templates: EmailTemplate[]; nextCursor?: number | null; versionsTruncated?: boolean; truncated?: boolean };
async function loadTemplates(signal: AbortSignal): Promise<TemplatesPage> {
  const templates: EmailTemplate[] = [];
  let cursor: number | undefined, truncated = false;
  const seen = new Set<number>();
  // Bounded catalogue scan; never silently represent a truncated option list as complete.
  for (let page = 0; page < 20; page++) {
    const result = await customFetch(`/api/notification-email/templates${cursor ? `?cursor=${cursor}` : ""}`, { signal, cache: "no-store" }) as TemplatesPage;
    templates.push(...result.templates);
    truncated ||= result.versionsTruncated === true;
    if (!result.nextCursor) return { templates, truncated };
    if (!Number.isSafeInteger(result.nextCursor) || seen.has(result.nextCursor)) return { templates, truncated: true };
    seen.add(result.nextCursor); cursor = result.nextCursor;
  }
  return { templates, truncated: true };
}
export function useEmailLibrary(enabled = true) {
  const options = { enabled, retry: false, staleTime: 0, gcTime: 0 } as const;
  const templates = useQuery({ ...options, queryKey: [...emailLibraryKey, "templates"], queryFn: ({ signal }) => loadTemplates(signal) });
  const senders = useQuery({ ...options, queryKey: [...emailLibraryKey, "senders"], queryFn: ({ signal }) => customFetch("/api/notification-email/senders", { signal, cache: "no-store" }) as Promise<{ senders: EmailSender[]; truncated?: boolean }> });
  const capabilities = useQuery({ ...options, queryKey: [...emailLibraryKey, "capabilities"], queryFn: ({ signal }) => customFetch("/api/notification-email/capabilities", { signal, cache: "no-store" }) as Promise<EmailCapabilities> });
  return { templates, senders, capabilities };
}
