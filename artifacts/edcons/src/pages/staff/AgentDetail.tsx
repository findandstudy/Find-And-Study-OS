import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useSeason } from "@/contexts/SeasonContext";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ArrowLeft, Building2, Mail, Phone, Globe, MapPin, Users, GraduationCap, FileText, ExternalLink, MessageSquare, Send
} from "lucide-react";
import { QuickContactDialog } from "@/components/QuickContact";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

async function apiFetch(url: string) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const STAFF_ROLES = ["super_admin", "admin", "manager", "staff", "consultant", "editor", "accountant"];

export default function AgentDetailPage() {
  const [, params] = useRoute("/staff/agents/:id");
  const [, setLocation] = useLocation();
  const { season } = useSeason();
  const { user } = useAuth(true, STAFF_ROLES);
  const agentId = params?.id ? parseInt(params.id, 10) : null;

  const [tab, setTab] = useState("leads");
  const [contactOpen, setContactOpen] = useState(false);
  const [contactChannel, setContactChannel] = useState<"email" | "whatsapp" | "internal">("internal");

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

  const leads = leadsData?.data || leadsData || [];
  const students = studentsData?.data || studentsData || [];
  const apps = appsData?.data || appsData || [];

  if (!agentId) return null;

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/staff/agents")} className="gap-1.5 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back to Agents
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
                        <Globe className="w-3.5 h-3.5" /> Website <ExternalLink className="w-3 h-3" />
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
                name={agent.companyName || agent.contactPerson || "Agent"}
                email={agent.email}
                phone={agent.phone}
                entityType="agent"
                entityId={agentId!}
              />
            )}

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="leads" className="gap-1.5">
                  <Users className="w-4 h-4" /> Leads {Array.isArray(leads) && leads.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{leads.length}</Badge>}
                </TabsTrigger>
                <TabsTrigger value="students" className="gap-1.5">
                  <GraduationCap className="w-4 h-4" /> Students {Array.isArray(students) && students.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{students.length}</Badge>}
                </TabsTrigger>
                <TabsTrigger value="applications" className="gap-1.5">
                  <FileText className="w-4 h-4" /> Applications {Array.isArray(apps) && apps.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{apps.length}</Badge>}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="leads" className="mt-4">
                {Array.isArray(leads) && leads.length > 0 ? (
                  <div className="bg-card border rounded-xl overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Phone</TableHead>
                          <TableHead>Source</TableHead>
                          <TableHead>Stage</TableHead>
                          <TableHead>Program</TableHead>
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
                            <TableCell className="max-w-[200px] truncate text-muted-foreground">{l.interestedProgram || "-"}</TableCell>
                            <TableCell><Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setLocation(`/staff/leads/${l.id}`); }}>View</Button></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    <p>No leads from this agent yet</p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="students" className="mt-4">
                {Array.isArray(students) && students.length > 0 ? (
                  <div className="bg-card border rounded-xl overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Phone</TableHead>
                          <TableHead>Nationality</TableHead>
                          <TableHead>Stage</TableHead>
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
                            <TableCell><Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setLocation(`/staff/students/${s.id}`); }}>View</Button></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <GraduationCap className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    <p>No students from this agent yet</p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="applications" className="mt-4">
                {Array.isArray(apps) && apps.length > 0 ? (
                  <div className="bg-card border rounded-xl overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Student</TableHead>
                          <TableHead>University</TableHead>
                          <TableHead>Program</TableHead>
                          <TableHead>Stage</TableHead>
                          <TableHead>Country</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {apps.map((a: any) => (
                          <TableRow key={a.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setLocation(`/staff/applications/${a.id}`)}>
                            <TableCell className="font-medium">{a.studentFirstName} {a.studentLastName}</TableCell>
                            <TableCell className="text-muted-foreground max-w-[150px] truncate">{a.universityName || "-"}</TableCell>
                            <TableCell className="text-muted-foreground max-w-[200px] truncate">{a.programName || "-"}</TableCell>
                            <TableCell><Badge variant="secondary" className="text-xs">{a.stage || "-"}</Badge></TableCell>
                            <TableCell>{a.country || "-"}</TableCell>
                            <TableCell><Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setLocation(`/staff/applications/${a.id}`); }}>View</Button></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    <p>No applications from this agent yet</p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </>
        ) : (
          <div className="text-center py-20 text-muted-foreground">Agent not found</div>
        )}
      </div>
    </DashboardLayout>
  );
}
