import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useListApplications, useListStudents } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, FileText, GraduationCap, Plus, MoreHorizontal, Calendar, ArrowUpRight } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const STAGE_CONFIG: Record<string, { label: string; color: string }> = {
  inquiry: { label: "Inquiry", color: "bg-slate-100 text-slate-700 border-slate-200" },
  documents_collected: { label: "Documents", color: "bg-blue-100 text-blue-700 border-blue-200" },
  submitted: { label: "Submitted", color: "bg-violet-100 text-violet-700 border-violet-200" },
  offer_received: { label: "Offer Received", color: "bg-amber-100 text-amber-700 border-amber-200" },
  visa_applied: { label: "Visa Applied", color: "bg-orange-100 text-orange-700 border-orange-200" },
  visa_approved: { label: "Visa Approved", color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  enrolled: { label: "Enrolled", color: "bg-green-100 text-green-700 border-green-200" },
  rejected: { label: "Rejected", color: "bg-rose-100 text-rose-700 border-rose-200" },
};

const STAGE_ORDER = ["inquiry", "documents_collected", "submitted", "offer_received", "visa_applied", "visa_approved", "enrolled", "rejected"];

export default function ApplicationsPage() {
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const { data: applicationsResp, isLoading } = useListApplications({ query: { queryKey: ['staff-applications'] } });
  const applications = (applicationsResp as any)?.data || applicationsResp || [];

  const filtered = (Array.isArray(applications) ? applications : []).filter((app: any) => {
    const matchStage = stageFilter === "all" || app.stage === stageFilter;
    return matchStage;
  });

  const stageCounts = STAGE_ORDER.reduce((acc, s) => {
    acc[s] = (Array.isArray(applications) ? applications : []).filter((a: any) => a.stage === s).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">Applications</h1>
            <p className="text-muted-foreground text-sm mt-1">{applications?.length || 0} total applications</p>
          </div>
          <Button className="rounded-xl gap-2">
            <Plus className="w-4 h-4" /> New Application
          </Button>
        </div>

        {/* Stage Summary */}
        <div className="flex gap-3 overflow-x-auto pb-2">
          <button onClick={() => setStageFilter("all")}
            className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all
              ${stageFilter === "all" ? "bg-primary text-white border-primary shadow-sm shadow-primary/25" : "bg-card border-border hover:border-primary/50"}`}>
            All <span className="bg-white/20 px-1.5 py-0.5 rounded-full text-xs">{applications?.length || 0}</span>
          </button>
          {STAGE_ORDER.map(stage => {
            const cfg = STAGE_CONFIG[stage];
            const count = stageCounts[stage] || 0;
            if (count === 0 && stageFilter !== stage) return null;
            return (
              <button key={stage} onClick={() => setStageFilter(stage)}
                className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all
                  ${stageFilter === stage ? "bg-primary text-white border-primary shadow-sm" : "bg-card border-border hover:border-primary/30"}`}>
                {cfg.label} <span className={`px-1.5 py-0.5 rounded-full text-xs ${stageFilter === stage ? "bg-white/20" : "bg-secondary"}`}>{count}</span>
              </button>
            );
          })}
        </div>

        {/* Applications Table */}
        <Card className="border-none shadow-lg shadow-black/5 overflow-hidden">
          <div className="p-5 border-b border-border/50">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search applications..." className="pl-10 rounded-xl" />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-secondary/50 text-left">
                  <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">ID</th>
                  <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Student</th>
                  <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">University</th>
                  <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Program</th>
                  <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Stage</th>
                  <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Intake</th>
                  <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {isLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i}>{[...Array(7)].map((_, j) => (
                      <td key={j} className="px-6 py-4"><div className="h-4 bg-secondary animate-pulse rounded-full" /></td>
                    ))}</tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="px-6 py-16 text-center text-muted-foreground">
                    <FileText className="w-10 h-10 mx-auto mb-2 text-muted-foreground/30" />
                    <p>No applications found</p>
                  </td></tr>
                ) : filtered.map(app => {
                  const stageCfg = STAGE_CONFIG[app.stage] || { label: app.stage, color: "bg-secondary text-foreground border-border" };
                  return (
                    <tr key={app.id} className="hover:bg-secondary/30 transition-colors">
                      <td className="px-6 py-4 text-sm font-mono font-bold text-primary">#{app.id}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary/20 to-accent/20 flex items-center justify-center text-xs font-bold text-primary">
                            {app.studentId}
                          </div>
                          <span className="text-sm font-medium text-foreground">Student #{app.studentId}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-foreground font-medium">
                        {app.universityId ? `University #${app.universityId}` : "—"}
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        {app.programId ? `Program #${app.programId}` : "—"}
                      </td>
                      <td className="px-6 py-4">
                        <Badge className={`text-xs border ${stageCfg.color}`}>{stageCfg.label}</Badge>
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        {app.intakeDate ? (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" />
                            {new Date(app.intakeDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" className="w-8 h-8 rounded-lg hover:bg-primary/10 hover:text-primary">
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon" variant="ghost" className="w-8 h-8 rounded-lg">
                                <MoreHorizontal className="w-3.5 h-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="rounded-xl shadow-lg">
                              <DropdownMenuItem>Update Stage</DropdownMenuItem>
                              <DropdownMenuItem>Add Note</DropdownMenuItem>
                              <DropdownMenuItem>Request Documents</DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive">Archive</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Stage Pipeline Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {STAGE_ORDER.map(stage => {
            const cfg = STAGE_CONFIG[stage];
            const count = stageCounts[stage] || 0;
            return (
              <Card key={stage} className="p-4 text-center border-none shadow-md shadow-black/5 hover:-translate-y-1 transition-transform cursor-pointer"
                onClick={() => setStageFilter(stage)}>
                <p className="text-2xl font-display font-bold text-foreground">{count}</p>
                <p className="text-xs text-muted-foreground mt-1 leading-tight">{cfg.label}</p>
              </Card>
            );
          })}
        </div>
      </div>
    </DashboardLayout>
  );
}
