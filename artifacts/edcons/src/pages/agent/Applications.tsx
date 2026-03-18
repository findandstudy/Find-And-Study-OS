import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useListApplications } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, GraduationCap, Calendar, Clock, CheckCircle, XCircle, AlertCircle, TrendingUp } from "lucide-react";
import { TablePagination, useTablePagination } from "@/components/TablePagination";

const STAGE_CONFIG: Record<string, { label: string; color: string }> = {
  inquiry:              { label: "Inquiry",           color: "bg-slate-100 text-slate-700 border-slate-200" },
  documents_collected:  { label: "Docs Collected",    color: "bg-blue-100 text-blue-700 border-blue-200" },
  submitted:            { label: "Submitted",         color: "bg-violet-100 text-violet-700 border-violet-200" },
  offer_received:       { label: "Offer Received",    color: "bg-amber-100 text-amber-700 border-amber-200" },
  visa_applied:         { label: "Visa Applied",      color: "bg-orange-100 text-orange-700 border-orange-200" },
  visa_approved:        { label: "Visa Approved",     color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  enrolled:             { label: "Enrolled",          color: "bg-green-100 text-green-700 border-green-200" },
  rejected:             { label: "Rejected",          color: "bg-rose-100 text-rose-700 border-rose-200" },
};

export default function AgentApplications() {
  const pg = useTablePagination(25);
  const { data: resp, isLoading } = useListApplications({ query: { queryKey: ["agent-applications"] } });
  const applications: any[] = (resp as any)?.data || resp || [];
  const { paged: pagedApps, total: totalApps } = pg.paginate(applications);

  const enrolled = applications.filter(a => a.stage === "enrolled").length;
  const inProgress = applications.filter(a => !["enrolled","rejected"].includes(a.stage)).length;
  const rejected = applications.filter(a => a.stage === "rejected").length;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <FileText className="w-6 h-6 text-primary" /> My Referrals
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Applications from students you referred</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Total Applications", value: applications.length, icon: FileText, color: "text-blue-500 bg-blue-500/10" },
            { label: "In Progress", value: inProgress, icon: Clock, color: "text-amber-500 bg-amber-500/10" },
            { label: "Enrolled", value: enrolled, icon: CheckCircle, color: "text-green-500 bg-green-500/10" },
            { label: "Rejected", value: rejected, icon: XCircle, color: "text-rose-500 bg-rose-500/10" },
          ].map((s, i) => (
            <Card key={i} className="p-5 border-none shadow-md shadow-black/5">
              <div className={`w-10 h-10 rounded-xl ${s.color} flex items-center justify-center mb-3`}>
                <s.icon className="w-5 h-5" />
              </div>
              <p className="text-xs text-muted-foreground font-medium">{s.label}</p>
              <p className="text-2xl font-display font-bold text-foreground mt-1">{s.value}</p>
            </Card>
          ))}
        </div>

        {/* Table */}
        <Card className="border-none shadow-lg shadow-black/5 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-secondary/50 text-left">
                  <th className="px-5 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">App #</th>
                  <th className="px-5 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Student</th>
                  <th className="px-5 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Stage</th>
                  <th className="px-5 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Intake</th>
                  <th className="px-5 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Started</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {isLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i}>
                      {[...Array(5)].map((_, j) => (
                        <td key={j} className="px-5 py-4">
                          <div className="h-4 bg-secondary animate-pulse rounded-full" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : pagedApps.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-16 text-center">
                      <GraduationCap className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
                      <p className="text-muted-foreground font-medium">No referral applications yet</p>
                      <p className="text-muted-foreground text-sm mt-1">Share your referral link to get started</p>
                    </td>
                  </tr>
                ) : pagedApps.map((app: any) => {
                  const stageCfg = STAGE_CONFIG[app.stage] || STAGE_CONFIG.inquiry;
                  return (
                    <tr key={app.id} className="hover:bg-secondary/30 transition-colors">
                      <td className="px-5 py-4 text-sm font-mono font-bold text-primary">#{app.id}</td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                            {String(app.studentId)[0]}
                          </div>
                          <span className="text-sm font-medium text-foreground">Student #{app.studentId}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <Badge className={`text-xs border ${stageCfg.color}`}>{stageCfg.label}</Badge>
                      </td>
                      <td className="px-5 py-4 text-sm text-muted-foreground">
                        {app.intakeDate
                          ? new Date(app.intakeDate).toLocaleDateString("en-US", { month: "short", year: "numeric" })
                          : "—"}
                      </td>
                      <td className="px-5 py-4 text-sm text-muted-foreground">
                        {new Date(app.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <TablePagination
            currentPage={pg.page}
            totalItems={totalApps}
            pageSize={pg.pageSize}
            onPageChange={pg.setPage}
            onPageSizeChange={pg.setPageSize}
          />
        </Card>
      </div>
    </DashboardLayout>
  );
}
