import type { ComponentPropsWithoutRef } from "react";
import { TabsList } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export function AdminPageTitle({
  as: Heading = "h1",
  className,
  ...props
}: ComponentPropsWithoutRef<"h1"> & { as?: "h1" | "h2" }) {
  return (
    <Heading
      {...props}
      className={cn(
        "min-w-0 break-words font-display text-2xl font-bold leading-tight tracking-tight text-foreground",
        "[&>svg]:size-5 [&>svg]:shrink-0 [&>svg]:text-primary",
        className,
      )}
    />
  );
}

export function AdminPageDescription({ className, ...props }: ComponentPropsWithoutRef<"p">) {
  return (
    <p
      {...props}
      className={cn("mt-1 max-w-[80ch] break-words text-sm leading-normal text-muted-foreground", className)}
    />
  );
}

export function AdminPageHeader({ className, ...props }: ComponentPropsWithoutRef<"header">) {
  return (
    <header
      {...props}
      className={cn(
        "flex min-w-0 w-full flex-wrap items-start justify-between gap-3 sm:items-center [&>div]:min-w-0",
        "[&>a]:max-w-full [&>a]:whitespace-normal [&>button]:max-w-full [&>button]:whitespace-normal",
        className,
      )}
    />
  );
}

export function AdminPageActions({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      {...props}
      className={cn(
        "flex min-w-0 max-w-full flex-wrap items-center gap-2 empty:hidden",
        "[&>a]:max-w-full [&>a]:whitespace-normal [&>button]:max-w-full [&>button]:whitespace-normal",
        className,
      )}
    />
  );
}

export function AdminTabsList({ className, ...props }: ComponentPropsWithoutRef<typeof TabsList>) {
  return (
    <TabsList
      {...props}
      className={cn(
        "h-auto min-h-9 max-w-full flex-wrap justify-start gap-1",
        "[&>[role=tab]]:max-w-full [&>[role=tab]]:whitespace-normal",
        className,
      )}
    />
  );
}
