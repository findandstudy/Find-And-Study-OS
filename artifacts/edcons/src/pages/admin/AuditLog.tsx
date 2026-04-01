import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { customFetch } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Activity, Search, User, Clock, Filter } from "lucide-react";
import { TablePagination } from "@/components/TablePagination";

const ACTION_COLORS: Record<string, string> = {
  create_user: "bg-green-100 text-green-700 border-green-200",
  update_user: "bg-blue-100 text-blue-700 border-blue-200",
  delete_user: "bg-rose-100 text-rose-700 border-rose-200",
  create_lead: "bg-green-100 text-green-700 border-green-200",
  update_lead: "bg-blue-100 text-blue-700 border-blue-200",
  delete_lead: "bg-rose-100 text-rose-700 border-rose-200",
  convert_lead: "bg-purple-100 text-purple-700 border-purple-200",
  create_application: "bg-green-100 text-green-700 border-green-200",
  update_application: "bg-blue-100 text-blue-700 border-blue-200",
  delete_application: "bg-rose-100 text-rose-700 border-rose-200",
  create_invoice: "bg-amber-100 text-amber-700 border-amber-200",
  update_invoice: "bg-blue-100 text-blue-700 border-blue-200",
  create_commission: "bg-amber-100 text-amber-700 border-amber-200",
  update_commission: "bg-blue-100 text-blue-700 border-blue-200",
  bulk_import_countries: "bg-indigo-100 text-indigo-700 border-indigo-200",
  bulk_import_cities: "bg-indigo-100 text-indigo-700 border-indigo-200",
  bulk_import_universities: "bg-indigo-100 text-indigo-700 border-indigo-200",
  bulk_import_programs: "bg-indigo-100 text-indigo-700 border-indigo-200",
  create_document: "bg-slate-100 text-slate-700 border-slate-200",
  update_document: "bg-blue-100 text-blue-700 border-blue-200",
  delete_document: "bg-rose-100 text-rose-700 border-rose-200",
};

function getActionColor(action: string) {
  return ACTION_COLORS[action] || "bg-secondary text-muted-foreground border-border";
}

function formatAction(action: string) {
  return action.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function formatChanges(changes: string | null): string {
  if (!changes) return "—";
  try {
    const obj = typeof changes === "string" ? JSON.parse(changes) : changes;
    return Object.entries(obj)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join(", ");
  } catch {
    return String(changes);
  }
}

export default function AdminAuditLog() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const limit = 25;

  const { data, isLoading } = useQuery({
    queryKey: ["audit-logs", page, search],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) params.set("search", search);
      const res: any = await customFetch(`/api/audit?${params.toString()}`);
      return res;
    },
  });

  const logs: any[] = data?.data || data || [];
  const total: number = data?.meta?.total || logs.length;
  const totalPages = Math.ceil(total / limit);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
              <Activity className="w-6 h-6 text-primary" /> Audit Log
            </h1>
            <p className="text-muted-foreground text-sm mt-1">All system actions recorded chronologically</p>
          </div>
          <Badge className="bg-primary/10 text-primary border-primary/20 px-3 py-1.5 text-sm font-semibold self-start sm:self-auto">
            {total.toLocaleString()} entries
          </Badge>
        </div>

        {/* Search */}
        <Card className="border-none shadow-md shadow-black/5 p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by action or resource..."
              className="pl-9 rounded-xl border-border/60"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        </Card>

        {/* Table */}
        <Card className="border-none shadow-lg shadow-black/5 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-secondary/50 text-left">
                  <th className="px-5 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">When</th>
                  <th className="px-5 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">User</th>
                  <th className="px-5 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Action</th>
                  <th className="px-5 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Resource</th>
                  <th className="px-5 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Details</th>
                  <th className="px-5 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {isLoading ? (
                  [...Array(8)].map((_, i) => (
                    <tr key={i}>
                      {[...Array(6)].map((_, j) => (
                        <td key={j} className="px-5 py-4">
                          <div className="h-4 bg-secondary animate-pulse rounded-full" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-16 text-center">
                      <Activity className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
                      <p className="text-muted-foreground font-medium">No audit entries found</p>
                    </td>
                  </tr>
                ) : logs.map((log: any) => (
                  <tr key={log.id} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-5 py-4 text-xs text-muted-foreground whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3 h-3" />
                        {new Date(log.createdAt).toLocaleString("en-US", {
                          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                        })}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                          <User className="w-3.5 h-3.5 text-primary" />
                        </div>
                        <span className="text-sm font-medium text-foreground">
                          {log.userName || (log.userId ? `User #${log.userId}` : "System")}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <Badge className={`text-xs border ${getActionColor(log.action)}`}>
                        {formatAction(log.action)}
                      </Badge>
                    </td>
                    <td className="px-5 py-4 text-sm text-foreground capitalize">
                      {log.resource}
                      {log.resourceId ? <span className="text-muted-foreground ml-1">#{log.resourceId}</span> : null}
                    </td>
                    <td className="px-5 py-4 text-xs text-muted-foreground max-w-[260px] truncate font-mono">
                      {formatChanges(log.changes)}
                    </td>
                    <td className="px-5 py-4 text-xs text-muted-foreground font-mono">
                      {log.ipAddress || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <TablePagination
            currentPage={page}
            totalItems={total}
            pageSize={limit}
            onPageChange={setPage}
          />
        </Card>
      </div>
    </DashboardLayout>
  );
}
