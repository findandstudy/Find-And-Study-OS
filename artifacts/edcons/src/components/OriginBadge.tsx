import { Home, Briefcase, Users } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface OriginBadgeProps {
  originType?: string | null;
  originDisplayName?: string | null;
  className?: string;
}

const config: Record<string, { icon: typeof Home; label: string; bg: string; text: string; border: string }> = {
  direct: { icon: Home, label: "Direct", bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  agent: { icon: Briefcase, label: "Agent", bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200" },
  sub_agent: { icon: Users, label: "Sub-Agent", bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
};

export default function OriginBadge({ originType, originDisplayName, className = "" }: OriginBadgeProps) {
  if (!originType) return null;
  const c = config[originType] || config.direct;
  const Icon = c.icon;
  const displayText = originType === "direct"
    ? c.label
    : originDisplayName
    ? `${c.label} · ${originDisplayName}`
    : c.label;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border max-w-[160px] ${c.bg} ${c.text} ${c.border} ${className}`}>
            <Icon className="w-2.5 h-2.5 flex-shrink-0" />
            <span className="truncate">{displayText}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {displayText}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
