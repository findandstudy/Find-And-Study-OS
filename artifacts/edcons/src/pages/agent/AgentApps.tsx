import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useAuth } from "@/hooks/use-auth";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSeason } from "@/contexts/SeasonContext";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { TablePagination } from "@/components/TablePagination";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  FileText, Search, Loader2, Calendar, GraduationCap,
  MapPin, BookOpen, TrendingUp, Filter,
} from "lucide-react";

type Application = {
  id: number; studentId: number; programId: number | null; universityId: number | null;
  agentId: number | null; season: string; stage: string; intake: string | null;
  level: string | null; programName: string | null; universityName: string | null;
  country: string | null; tuitionFee: number | null; scholarship: number | null;
  createdAt: string; studentFirstName?: string; studentLastName?: string;
};

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

export default function AgentApps() {
  const { user } = useAuth(true);
  const { toast } = useToast();
  const { selectedYear } = useSeason();

  const [page, setPage] = useState(1);
  const [stageFilter, setStageFilter] = useState("all");
  const limit = 15;

  const { data, isLoading } = useQuery({
    queryKey: ["agent-apps-list", page, limit, stageFilter, selectedYear],
    enabled: !!user,
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit), season: selectedYear });
      if (stageFilter && stageFilter !== "all") params.set("stage", stageFilter);
      return customFetch<{ data: Application[]; meta: { total: number; page: number; limit: number; totalPages: number } }>(`/api/applications?${params}`);
    },
  });

  const applications = data?.data || [];
  const meta = data?.meta;

  const enrolled = applications.filter(a => a.stage === "enrolled").length;
  const inProgress = applications.filter(a => !["enrolled", "rejected"].includes(a.stage)).length;

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-display font-bold text-foreground">Applications</h1>
          <p className="text-muted-foreground text-sm mt-1">Track your student applications and their progress</p>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <Card className="border shadow-sm p-4 text-center">
            <p className="text-xs text-muted-foreground font-medium">Total</p>
            <p className="text-2xl font-bold text-foreground mt-1">{meta?.total || 0}</p>
          </Card>
          <Card className="border shadow-sm p-4 text-center">
            <p className="text-xs text-muted-foreground font-medium">In Progress</p>
            <p className="text-2xl font-bold text-amber-600 mt-1">{inProgress}</p>
          </Card>
          <Card className="border shadow-sm p-4 text-center">
            <p className="text-xs text-muted-foreground font-medium">Enrolled</p>
            <p className="text-2xl font-bold text-green-600 mt-1">{enrolled}</p>
          </Card>
        </div>

        <Card className="border shadow-sm">
          <div className="p-4 border-b border-border/50 flex items-center gap-3">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <Select value={stageFilter} onValueChange={v => { setStageFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[180px] h-9">
                <SelectValue placeholder="All Stages" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stages</SelectItem>
                {Object.entries(STAGE_CONFIG).map(([key, cfg]) => (
                  <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : applications.length === 0 ? (
            <div className="text-center py-20">
              <FileText className="w-12 h-12 mx-auto mb-3 text-muted-foreground/20" />
              <p className="font-medium text-foreground">No applications yet</p>
              <p className="text-sm text-muted-foreground mt-1">Applications will appear here once your students apply</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 bg-secondary/30">
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">App #</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Student</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">University / Program</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Stage</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Intake</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {applications.map(app => {
                      const stage = STAGE_CONFIG[app.stage] || { label: app.stage, color: "bg-slate-100 text-slate-700 border-slate-200" };
                      return (
                        <tr key={app.id} className="border-b border-border/30 hover:bg-secondary/20 transition-colors">
                          <td className="px-4 py-3">
                            <span className="font-mono text-xs font-medium text-primary">#{app.id}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <GraduationCap className="w-4 h-4 text-muted-foreground" />
                              <span className="font-medium text-foreground">
                                {app.studentFirstName ? `${app.studentFirstName} ${app.studentLastName}` : `Student #${app.studentId}`}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {app.universityName && <p className="text-foreground text-sm">{app.universityName}</p>}
                            {app.programName && <p className="text-xs text-muted-foreground">{app.programName}</p>}
                            {app.country && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                <MapPin className="w-3 h-3" />{app.country}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <Badge className={`text-xs ${stage.color}`}>{stage.label}</Badge>
                          </td>
                          <td className="px-4 py-3 text-sm text-foreground">{app.intake || "—"}</td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">
                            <span className="flex items-center gap-1.5"><Calendar className="w-3 h-3" />{new Date(app.createdAt).toLocaleDateString()}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {meta && meta.totalPages > 1 && (
                <div className="p-4 border-t border-border/50">
                  <TablePagination page={meta.page} totalPages={meta.totalPages} total={meta.total} limit={meta.limit} onPageChange={setPage} />
                </div>
              )}
            </>
          )}
        </Card>

        {meta && <p className="text-xs text-muted-foreground mt-3 text-center">{meta.total} application{meta.total !== 1 ? "s" : ""} total</p>}
      </div>
    </DashboardLayout>
  );
}
