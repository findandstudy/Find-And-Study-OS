import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { ChevronDown, ChevronUp, History } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  resource: "lead" | "student" | "application";
  resourceId: number;
}

interface AuditLogRow {
  id: number;
  action: string;
  resource: string;
  resourceId: number | null;
  changes: any;
  ipAddress: string | null;
  createdAt: string;
  userName: string | null;
}

function formatChangeValue(v: any): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function renderChanges(changes: any): React.ReactNode {
  if (!changes) return null;
  let parsed: any = changes;
  if (typeof changes === "string") {
    try { parsed = JSON.parse(changes); } catch { return <span className="text-xs text-muted-foreground">{changes}</span>; }
  }
  if (parsed && typeof parsed === "object") {
    const keys = Object.keys(parsed);
    if (keys.length === 0) return null;
    return (
      <div className="mt-1 text-xs space-y-0.5">
        {keys.map(k => (
          <div key={k} className="flex gap-1">
            <span className="font-medium text-muted-foreground">{k}:</span>
            <span className="text-foreground/80 break-all">{formatChangeValue(parsed[k])}</span>
          </div>
        ))}
      </div>
    );
  }
  return <span className="text-xs text-muted-foreground">{String(parsed)}</span>;
}

export function AuditLogSection({ resource, resourceId }: Props) {
  const { user } = useAuth(true);
  const [open, setOpen] = useState(false);
  const isAdminLike = user && ["super_admin", "admin"].includes(user.role);

  const { data, isLoading } = useQuery<{ data: AuditLogRow[]; meta?: any }>({
    queryKey: [`/api/audit`, resource, resourceId],
    queryFn: () => customFetch(`/api/audit?resource=${resource}&resourceId=${resourceId}&limit=100`),
    enabled: !!isAdminLike && open,
    staleTime: 30_000,
  });

  if (!isAdminLike) return null;

  const logs = data?.data ?? [];

  return (
    <div className="bg-card rounded-2xl border shadow-sm">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 hover:bg-secondary/30 rounded-2xl transition-colors"
        data-testid="audit-log-toggle"
      >
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-semibold text-foreground">Activity Log</h2>
          {logs.length > 0 && (
            <span className="text-xs text-muted-foreground">({logs.length})</span>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="border-t px-4 pb-4 pt-2">
          {isLoading ? (
            <div className="space-y-2 py-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : logs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No activity recorded.</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {logs.map((log) => (
                <div key={log.id} className="rounded-xl border bg-secondary/20 p-3" data-testid={`audit-log-row-${log.id}`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-foreground">{log.userName || "System"}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                        {log.action}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(log.createdAt).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" })}
                      {" "}
                      {new Date(log.createdAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  {renderChanges(log.changes)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
