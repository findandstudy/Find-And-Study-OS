import { createContext } from "react";

export const DashboardDialogContext = createContext<{
  dir: "ltr" | "rtl";
  closeLabel: string;
} | null>(null);

export const dashboardDialogContent =
  "w-[calc(100%_-_2rem)] max-h-[calc(100dvh_-_2rem)] grid-cols-[minmax(0,1fr)] overflow-y-auto rounded-xl p-4 duration-150 sm:p-6 motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none";

export const dashboardDialogFooter = "gap-2 sm:flex-wrap sm:space-x-0";
