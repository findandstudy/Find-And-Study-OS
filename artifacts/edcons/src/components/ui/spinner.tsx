import { translateUi, useUiLanguage } from "@/lib/ui-localization";
import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const { lang: uiLanguage } = useUiLanguage();
  return (
    <Loader2Icon
      role="status"
      aria-label={translateUi(uiLanguage, "Loading")}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
