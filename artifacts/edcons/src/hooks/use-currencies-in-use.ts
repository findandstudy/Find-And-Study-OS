import { useQuery } from "@tanstack/react-query";
import { SUPPORTED_CURRENCIES, isSupportedCurrency, type CurrencyCode } from "@/lib/currency";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

export function useCurrenciesInUse(): { list: CurrencyCode[]; isReady: boolean } {
  const { data, isFetched } = useQuery<{ currencies: string[] }>({
    queryKey: ["currencies-in-use"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/currencies-in-use`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    staleTime: 60_000,
  });
  if (!isFetched) {
    return { list: [...SUPPORTED_CURRENCIES] as CurrencyCode[], isReady: false };
  }
  const raw = (data?.currencies || []).filter(isSupportedCurrency) as CurrencyCode[];
  const ordered = (SUPPORTED_CURRENCIES as readonly CurrencyCode[]).filter(c => raw.includes(c));
  return { list: ordered.length > 0 ? ordered : (["USD"] as CurrencyCode[]), isReady: true };
}
