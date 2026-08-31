import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { DateFormatKey } from "@workspace/i18n";

/**
 * Returns the org-wide date format key from settings (e.g. "DD.MM.YYYY").
 * Falls back to "DD.MM.YYYY" when settings are unavailable or loading.
 * Reads only the deliberately narrow authenticated client-settings DTO.
 */
export function useDateFormat(): DateFormatKey {
  const { data } = useQuery<any>({
    queryKey: ["/api/settings/client"],
    queryFn: () => customFetch("/api/settings/client"),
    staleTime: 5 * 60_000,
  });
  return (data?.dateFormat as DateFormatKey) || "DD.MM.YYYY";
}

/**
 * Returns the org-wide date format from the public branding endpoint.
 * Use this on pages that don't require auth (embed, public apply, etc.).
 */
export function useDateFormatPublic(): DateFormatKey {
  const { data } = useQuery<any>({
    queryKey: ["/api/settings/branding"],
    queryFn: () => customFetch("/api/settings/branding"),
    staleTime: 5 * 60_000,
  });
  return (data?.dateFormat as DateFormatKey) || "DD.MM.YYYY";
}
