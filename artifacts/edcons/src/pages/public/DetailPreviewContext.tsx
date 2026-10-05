import { createContext } from "react";
import type { DetailLayout } from "@/lib/website/detailLayoutContract";

/** Only the admin's static renderer supplies this snapshot. No public preview route. */
export const DetailPreviewContext = createContext<{
  payload: unknown;
  layout: DetailLayout;
  universityPrograms?: { result: unknown; facets: unknown };
} | null>(null);
