import { useState, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSeason } from "@/contexts/SeasonContext";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { customFetch } from "@workspace/api-client-react";
import {
  ArrowLeft, Building2, Mail, Phone, Globe, MapPin, Users, GraduationCap, FileText, ExternalLink, MessageSquare, Settings, Loader2
} from "lucide-react";
import { QuickContactDialog } from "@/components/QuickContact";
import { AllMessagingHistory } from "@/components/inbox/AllMessagingHistory";
import { useI18n } from "@/hooks/use-i18n";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

async function apiFetch(url: string) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

import { STAFF_ROLES as _STAFF_ROLES } from "@workspace/roles";
const STAFF_ROLES = _STAFF_ROLES;

export default function AgentDetailPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, params] = useRoute("/staff/agents/:id");
  const [, setLocation] = useLocation();
  const { season } = useSeason();
  useAuth(true, STAFF_ROLES);
  const agentId = params?.id ? parseInt(params.id, 10) : null;

  const [tab, setTab] = useState("leads");
  const [contactOpen, setContactOpen] = useState(false);
  const [contactChannel, setContactChannel] = useState<"email" | "whatsapp" | "instagram" | "internal">("internal");
  const [academySaving, setAcademySaving] = useState<number | "main" | null>(null);

  const { data: agent, isLoading: agentLoading } = useQuery<any>({
    queryKey: ["agent-detail", agentId],
    queryFn: () => apiFetch(`${BASE_URL}/api/agents/${agentId}`),
    enabled: !!agentId,
  });

  const { data: leadsData } = useQuery<any>({
    queryKey: ["agent-leads", agentId, season],
    queryFn: () => apiFetch(`${BASE_URL}/api/leads?agentId=${agentId}&season=${season}&limit=200`),
    enabled: !!agentId && tab === "leads",
  });

  const { data: studentsData } = useQuery<any>({
    queryKey: ["agent-students", agentId, season],
    queryFn: () => apiFetch(`${BASE_URL}/api/students?agentId=${agentId}&season=${season}&limit=200`),
    enabled: !!agentId && tab === "students",
  });

  const { data: appsData } = useQuery<any>({
    queryKey: ["agent-applications", agentId, season],
    queryFn: () => apiFetch(`${BASE_URL}/api/applications?agentId=${agentId}&season=${season}&limit=200`),
    enabled: !!agentId && tab === "applications",
  });

  const { data: subAgents } = useQuery<any[]>({
    queryKey: ["agent-sub-agents", agentId],
    queryFn: () => apiFetch(`${BASE_URL}/api/agents/${agentId}/sub-agents?limit=200`),
    enabled: !!agentId && tab === "settings",
  });

  const leads = leadsData?.data || leadsData || [];
  const students = studentsData?.data || studentsData || [];
  const apps = appsData?.data || appsData || [];

  const toggleAcademy = useCallback(async (targetAgentId: number, value: boolean, label: number | "main") => {
    setAcademySaving(label);
    try {
      await customFetch(`/api/agents/${targetAgentId}/academy-access`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ academyAccess: value }),
      });
      toast({ title: t("staffAgentDetail.academyAccessSaved") });
      qc.invalidateQueries({ queryKey: ["agent-detail", agentId] });
      qc.invalidateQueries({ queryKey: ["agent-sub-agents", agentId] });
    } catch (e: any) {
      toast({ title: t("staffAgentDetail.academyAccessFailed"), description: e?.message, variant: "destructive" });
    } finally {
      setAcademySaving(null);
    }
  }, [agentId, qc, t, toast]);

  if (!agentId) return null;

  return (
      <div className="max-w-6xl mx-auto space-y-6">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/staff/agents")} className="gap-1.5 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> {t("staffAgentDetail.backToAgents")}
        </Button>

        {agentLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : agent ? (
          <>
            <div className="bg-card border rounded-2xl p-6">
              <div className="flex items-start gap-5">
                <div className="w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Building2 className="w-8 h-8 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <h1 className="text-2xl font-bold">{agent.companyName}</h1>
                    {agent.status && (
                      <Badge variant={agent.status === "active" ? "default" : "secondary"}>
                        {agent.status}
                      </Badge>
                    )}
                  </div>
                  {agent.contactPerson && <p className="text-sm text-muted-foreground">{agent.contactPerson}</p>}
                  <div className="flex flex-wrap gap-4 mt-3 text-sm">
                    {agent.email && (
                      <button onClick={() => { setContactChannel("email"); setContactOpen(true); }} className="flex items-center gap-1.5 text-muted-foreground hover:text-primary transition-colors">
                        <Mail className="w-3.5 h-3.5" /> {agent.email}
                      </button>
                    )}
                    {agent.phone && (
                      <button onClick={() => { setContactChannel("whatsapp"); setContactOpen(true); }} className="flex items-center gap-1.5 text-muted-foreground hover:text-primary transition-colors">
                        <Phone className="w-3.5 h-3.5" /> {agent.phone}
                      </button>
                    )}
                    {agent.country && (
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <MapPin className="w-3.5 h-3.5" /> {agent.city ? `${agent.city}, ` : ""}{agent.country}
                      </span>
                    )}
                    {agent.website && (
                      <a href={agent.website.startsWith("http") ? agent.website : `https://${agent.website}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-muted-foreground hover:text-primary transition-colors">
                        <Globe className="w-3.5 h-3.5" /> {t("staffAgentDetail.websiteLink")} <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {agent && (
              <QuickContactDialog
                open={contactOpen}
                onClose={() => setContactOpen(false)}
                channel={contactChannel}
                setChannel={setContactChannel}
                name={agent.companyName || agent.contactPerson || t("staffAgentDetail.agent")}
                email={agent.email}
                phone={agent.phone}
                entityType="agent"
                entityId={agentId!}
              />
            )}

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="leads" className="gap-1.5">
                  <Users className="w-4 h-4" /> {t("staffAgentDetail.leadsTab")} {Array.isArray(leads) && leads.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{leads.length}</Badge>}
                </TabsTrigger>
                <TabsTrigger value="students" className="gap-1.5">
                  <GraduationCap className="w-4 h-4" /> {t("staffAgentDetail.studentsTab")} {Array.isArray(students) && students.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{students.length}</Badge>}
                </TabsTrigger>
                <TabsTrigger value="applications" className="gap-1.5">
                  <FileText className="w-4 h-4" /> {t("staffAgentDetail.appsTab")} {Array.isArray(apps) && apps.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{apps.length}</Badge>}
                </TabsTrigger>
                <TabsTrigger value="messaging" className="gap-1.5">
                  <MessageSquare className="w-4 h-4" /> {t("staffAgentDetail.messagingTab")}
                </TabsTrigger>
                <TabsTrigger value="settings" className="gap-1.5">
                  <Settings className="w-4 h-4" /> {t("staffAgentDetail.settingsTab")}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="leads" className="mt-4">
                {Array.isArray(leads) && leads.length > 0 ? (
                  <div className="bg-card border rounded-xl overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("staffAgentDetail.colName")}</TableHead>
                          <TableHead>{t("staffAgentDetail.colEmail")}</TableHead>
                          <TableHead>{t("staffAgentDetail.colPhone")}</TableHead>
                          <TableHead>{t("staffAgentDetail.colSource")}</TableHead>
                          <TableHead>{t("staffAgentDetail.colStage")}</TableHead>
                          <TableHead>{t("staffAgentDetail.colProgram")}</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {leads.map((l: any) => (
                          <TableRow key={l.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setLocation(`/staff/leads/${l.id}`)}>
                            <TableCell className="font-medium">{l.firstName} {l.lastName}</TableCell>
                            <TableCell className="text-muted-foreground">{l.email || "-"}</TableCell>
                            <TableCell className="text-muted-foreground">{l.phone || "-"}</TableCell>
                            <TableCell><Badge variant="outline" className="text-xs">{l.source || "-"}</Badge></TableCell>
                            <TableCell><Badge variant="secondary" className="text-xs">{l.stage || "-"}</Badge></TableCell>
                            <TableCell className="max-w-[250px] text-muted-foreground"><span className="line-clamp-2" title={l.interestedProgram || ""}>{l.interestedProgram || "-"}</span></TableCell>
                            <TableCell><Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setLocation(`/staff/leads/${l.id}`); }}>{t("staffAgentDetail.view")}</Button></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    <p>{t("staffAgentDetail.noLeads")}</p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="students" className="mt-4">
                {Array.isArray(students) && students.length > 0 ? (
                  <div className="bg-card border rounded-xl overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("staffAgentDetail.colName")}</TableHead>
                          <TableHead>{t("staffAgentDetail.colEmail")}</TableHead>
                          <TableHead>{t("staffAgentDetail.colPhone")}</TableHead>
                          <TableHead>{t("staffAgentDetail.colNationality")}</TableHead>
                          <TableHead>{t("staffAgentDetail.colStage")}</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {students.map((s: any) => (
                          <TableRow key={s.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setLocation(`/staff/students/${s.id}`)}>
                            <TableCell className="font-medium">{s.firstName} {s.lastName}</TableCell>
                            <TableCell className="text-muted-foreground">{s.email || "-"}</TableCell>
                            <TableCell className="text-muted-foreground">{s.phone || "-"}</TableCell>
                            <TableCell><Badge variant="outline" className="text-xs">{s.nationality || "-"}</Badge></TableCell>
                            <TableCell><Badge variant="secondary" className="text-xs">{s.stage || "-"}</Badge></TableCell>
                            <TableCell><Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setLocation(`/staff/students/${s.id}`); }}>{t("staffAgentDetail.view")}</Button></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <GraduationCap className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    <p>{t("staffAgentDetail.noStudents")}</p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="applications" className="mt-4">
                {Array.isArray(apps) && apps.length > 0 ? (
                  <div className="bg-card border rounded-xl overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("staffAgentDetail.colStudent")}</TableHead>
                          <TableHead>{t("staffAgentDetail.colUniversity")}</TableHead>
                          <TableHead>{t("staffAgentDetail.colProgram")}</TableHead>
                          <TableHead>{t("staffAgentDetail.colStage")}</TableHead>
                          <TableHead>{t("staffAgentDetail.colCountry")}</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {apps.map((a: any) => (
                          <TableRow key={a.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setLocation(`/staff/applications/${a.id}`)}>
                            <TableCell className="font-medium">{a.studentFirstName} {a.studentLastName}</TableCell>
                            <TableCell className="text-muted-foreground max-w-[250px]"><span className="line-clamp-2" title={a.universityName || ""}>{a.universityName || "-"}</span></TableCell>
                            <TableCell className="text-muted-foreground max-w-[250px]"><span className="line-clamp-2" title={a.programName || ""}>{a.programName || "-"}</span></TableCell>
                            <TableCell><Badge variant="secondary" className="text-xs">{a.stage || "-"}</Badge></TableCell>
                            <TableCell>{a.country || "-"}</TableCell>
                            <TableCell><Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setLocation(`/staff/applications/${a.id}`); }}>{t("staffAgentDetail.view")}</Button></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    <p>{t("staffAgentDetail.noApps")}</p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="messaging" className="mt-4">
                <AllMessagingHistory type="agent" id={Number(agentId)} />
              </TabsContent>

              <TabsContent value="settings" className="mt-4 space-y-4">
                {/* Main agent academy toggle */}
                <div className="bg-card border rounded-xl p-5">
                  <h3 className="text-sm font-semibold mb-1">{t("staffAgentDetail.academyAccess")}</h3>
                  <p className="text-xs text-muted-foreground mb-4">{t("staffAgentDetail.academyAccessDesc")}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-foreground">{agent.companyName}</span>
                    <div className="flex items-center gap-2">
                      {academySaving === "main" && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                      <Switch
                        checked={agent.academyAccess === true}
                        disabled={academySaving === "main"}
                        onCheckedChange={(v) => toggleAcademy(agentId!, v, "main")}
                      />
                    </div>
                  </div>
                </div>

                {/* Sub-agents academy toggles */}
                <div className="bg-card border rounded-xl p-5">
                  <h3 className="text-sm font-semibold mb-1">{t("staffAgentDetail.subAgentsSettings")}</h3>
                  <p className="text-xs text-muted-foreground mb-4">{t("staffAgentDetail.academyAccessDesc")}</p>
                  {!subAgents ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : subAgents.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">{t("staffAgentDetail.noSubAgents")}</p>
                  ) : (
                    <div className="divide-y divide-border/50">
                      {subAgents.map((sa: any) => (
                        <div key={sa.id} className="flex items-center justify-between py-3">
                          <div>
                            <p className="text-sm font-medium">{sa.firstName} {sa.lastName}</p>
                            {sa.email && <p className="text-xs text-muted-foreground">{sa.email}</p>}
                          </div>
                          <div className="flex items-center gap-2">
                            {academySaving === sa.id && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                            <Switch
                              checked={sa.academyAccess === true}
                              disabled={academySaving === sa.id}
                              onCheckedChange={(v) => toggleAcademy(sa.id, v, sa.id)}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </>
        ) : (
          <div className="text-center py-20 text-muted-foreground">{t("staffAgentDetail.notFound")}</div>
        )}
      </div>
  );
}
