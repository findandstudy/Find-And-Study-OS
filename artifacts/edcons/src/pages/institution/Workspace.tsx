import { translateUi, useUiLanguage } from "@/lib/ui-localization";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useSeo } from "@/hooks/use-seo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertCircle, ArrowLeft, CheckCircle2, Clock3, FileCheck2, Inbox, Loader2, School, ShieldCheck } from "lucide-react";

export type InstitutionView =
  | "home" | "review-queue" | "applications" | "application" | "decisions"
  | "offers" | "programs-intakes" | "requirements" | "sla" | "integrations"
  | "analytics" | "team" | "audit";

type Props = { view: InstitutionView; applicationId?: string };
type Context = {
  institutionName: string;
  role: string;
  roleDisplayName: string;
  capabilities: string[];
};

const TITLES: Record<InstitutionView, string> = {
  home: "Admissions workspace", "review-queue": "Review queue", applications: "Applications",
  application: "Application review", decisions: "Decision approvals", offers: "Offers",
  "programs-intakes": "Programs & intakes", requirements: "Requirements & evidence rules",
  sla: "SLA policies", integrations: "Institution integrations", analytics: "Admissions analytics",
  team: "Institution team & roles", audit: "Institution audit",
};

function formatDate(value: unknown): string {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isFinite(date.valueOf()) ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date) : "—";
}

function human(value: unknown): string {
  return String(value ?? "—").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function Status({ value }: { value: unknown }) {
  const text = String(value ?? "UNKNOWN");
  const good = ["ACTIVE", "APPROVED", "VERIFIED", "ISSUED", "CONFIRMED", "ENROLLED", "PUBLISHED"].includes(text);
  const warn = ["PENDING", "SUBMITTED", "IN_REVIEW", "INFORMATION_REQUESTED", "DECISION_PENDING_APPROVAL"].includes(text);
  return <Badge variant={good ? "default" : warn ? "secondary" : "outline"}>{human(text)}</Badge>;
}

function Loading() {
  return <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
}

function ErrorState({ error }: { error: unknown }) {
  const { lang: uiLanguage } = useUiLanguage();
  return <Card className="border-destructive/40"><CardContent className="flex gap-3 py-6 text-sm text-destructive">
    <AlertCircle className="h-5 w-5 shrink-0" /><span>{error instanceof Error ? error.message : translateUi(uiLanguage, "Institution data could not be loaded.")}</span>
  </CardContent></Card>;
}

function Empty({ children = "No records in this scope." }: { children?: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">{children}</div>;
}

function useApiMutation(endpoint: (value: any) => string, method = "POST") {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({ value, body }: { value?: any; body?: unknown }) => customFetch(endpoint(value), {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    onSuccess: () => {
      toast({ title: "Saved", description: "The institution record was updated." });
      void queryClient.invalidateQueries({ queryKey: ["institution"] });
    },
    onError: (error) => toast({ title: "Action blocked", description: error instanceof Error ? error.message : "Request failed", variant: "destructive" }),
  });
}

function CaseTable({ endpoint, canClaim }: { endpoint: string; canClaim: boolean }) {
  const { lang: uiLanguage } = useUiLanguage();
  const [, navigate] = useLocation();
  const query = useQuery<{ data: any[] }>({ queryKey: ["institution", endpoint], queryFn: () => customFetch(endpoint) });
  const claim = useApiMutation((id) => `/api/institution/applications/${id}/claim`);
  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorState error={query.error} />;
  if (!query.data?.data?.length) return <Empty />;
  return <Card><CardContent className="pt-6"><Table>
    <TableHeader><TableRow><TableHead>{translateUi(uiLanguage, "Student ref")}</TableHead><TableHead>{translateUi(uiLanguage, "Program / intake")}</TableHead><TableHead>{translateUi(uiLanguage, "Stage")}</TableHead><TableHead>{translateUi(uiLanguage, "Readiness")}</TableHead><TableHead>{translateUi(uiLanguage, "SLA")}</TableHead><TableHead /></TableRow></TableHeader>
    <TableBody>{query.data.data.map((item) => <TableRow key={item.id}>
      <TableCell className="font-medium">{item.masked_student_ref}</TableCell>
      <TableCell>#{item.program_id ?? "—"}<div className="text-xs text-muted-foreground">{item.intake_key ?? translateUi(uiLanguage, "No intake")}</div></TableCell>
      <TableCell><Status value={item.lifecycle_state} /></TableCell>
      <TableCell className="min-w-32"><div className="flex items-center gap-2"><Progress value={item.readiness_percent} className="h-2" /><span className="text-xs">{item.readiness_percent}%</span></div></TableCell>
      <TableCell>{item.sla_breached ? <Badge variant="destructive">{translateUi(uiLanguage, "Breached")}</Badge> : formatDate(item.review_due_at ?? item.decision_due_at)}</TableCell>
      <TableCell className="text-right"><div className="flex justify-end gap-2">
        {canClaim && ["RECEIVED", "REVIEWING"].includes(item.lifecycle_state) && <Button size="sm" variant="outline" disabled={claim.isPending} onClick={() => claim.mutate({ value: item.id })}>{translateUi(uiLanguage, "Claim")}</Button>}
        <Button size="sm" onClick={() => navigate(`/institution/applications/${item.id}`)}>{translateUi(uiLanguage, "Review")}</Button>
      </div></TableCell>
    </TableRow>)}</TableBody>
  </Table></CardContent></Card>;
}

function Home() {
  const { lang: uiLanguage } = useUiLanguage();
  const query = useQuery<any>({ queryKey: ["institution", "home"], queryFn: () => customFetch("/api/institution/home") });
  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorState error={query.error} />;
  const counts = query.data?.applicationCounts ?? [];
  const total = counts.reduce((sum: number, item: any) => sum + Number(item.count), 0);
  return <div className="space-y-6">
    <div className="grid gap-4 md:grid-cols-4">
      <Metric icon={Inbox} label={translateUi(uiLanguage, "Applications")} value={total} />
      <Metric icon={Clock3} label={translateUi(uiLanguage, "SLA breached")} value={query.data?.overdueCount ?? 0} tone="danger" />
      <Metric icon={ShieldCheck} label={translateUi(uiLanguage, "Pending approval")} value={query.data?.pendingDecisionCount ?? 0} />
      <Metric icon={School} label={translateUi(uiLanguage, "Institution")} value={query.data?.context?.institutionName ?? "—"} />
    </div>
    <Card><CardHeader><CardTitle>{translateUi(uiLanguage, "Admissions pipeline")}</CardTitle><CardDescription>{translateUi(uiLanguage, "Only cases shared with this institution relationship are included.")}</CardDescription></CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{counts.map((item: any) => <div key={item.lifecycle_state} className="rounded-lg border p-4"><div className="text-2xl font-semibold">{item.count}</div><div className="text-sm text-muted-foreground">{human(item.lifecycle_state)}</div></div>)}</CardContent>
    </Card>
    {(query.data?.context?.capabilities ?? []).some((capability: string) => ["institution.applications.review","institution.decisions.approve","institution.audit.read"].includes(capability)) &&
      <CaseTable endpoint="/api/institution/review-queue" canClaim={query.data?.context?.capabilities?.includes("institution.applications.review") ?? false} />}
  </div>;
}

function Metric({ icon: Icon, label, value, tone }: { icon: typeof Inbox; label: string; value: React.ReactNode; tone?: "danger" }) {
  return <Card><CardContent className="flex items-center gap-4 pt-6"><div className={`rounded-lg p-3 ${tone === "danger" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}><Icon className="h-5 w-5" /></div><div><div className="text-2xl font-semibold">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div></CardContent></Card>;
}

function ApplicationReview({ id, context }: { id: string; context?: Context }) {
  const { lang: uiLanguage } = useUiLanguage();
  const [, navigate] = useLocation();
  const query = useQuery<any>({ queryKey: ["institution", "application", id], queryFn: () => customFetch(`/api/institution/applications/${id}`) });
  const [reasonCode, setReasonCode] = useState("ACADEMIC_REVIEW");
  const [rationale, setRationale] = useState("");
  const [decisionType, setDecisionType] = useState("CONDITIONAL_OFFER");
  const [requestMessage, setRequestMessage] = useState("");
  const assess = useApiMutation(() => `/api/institution/applications/${id}/evidence-assessments`);
  const enrol = useApiMutation(() => `/api/institution/applications/${id}/enrolment`);
  const requestInfo = useApiMutation(() => `/api/institution/applications/${id}/information-requests`);
  const decision = useApiMutation(() => `/api/institution/applications/${id}/decisions`);
  const submit = useApiMutation((decisionId) => `/api/institution/decisions/${decisionId}/submit`);
  const ready = useApiMutation(() => `/api/institution/applications/${id}/ready-for-decision`);
  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorState error={query.error} />;
  const data = query.data;
  const app = data.application;
  const caps = new Set(context?.capabilities ?? []);
  return <div className="space-y-6">
    <Button variant="ghost" className="gap-2" onClick={() => navigate("/institution/review-queue")}><ArrowLeft className="h-4 w-4" />{translateUi(uiLanguage, "Review queue")}</Button>
    <Card><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>{app.masked_student_ref}</CardTitle><CardDescription>{translateUi(uiLanguage, "Case")} {app.id} {translateUi(uiLanguage, "· legacy application #")}{app.legacy_application_id}</CardDescription></div><Status value={app.lifecycle_state} /></div></CardHeader>
      <CardContent><div className="grid gap-4 md:grid-cols-4"><Info label={translateUi(uiLanguage, "Program")} value={`#${app.program_id ?? "—"}`} /><Info label={translateUi(uiLanguage, "Intake")} value={app.intake_key} /><Info label={translateUi(uiLanguage, "Priority")} value={human(app.priority)} /><Info label={translateUi(uiLanguage, "Readiness")} value={`${app.readiness_percent}%`} /></div>{["REVIEWING","INFORMATION_REQUESTED"].includes(app.lifecycle_state)&&caps.has("institution.evidence.assess")&&caps.has("institution.applications.review")&&<Button className="mt-5" variant="outline" disabled={ready.isPending} onClick={()=>ready.mutate({})}>{translateUi(uiLanguage, "Validate evidence and mark ready for decision")}</Button>}</CardContent>
    </Card>
    <div className="grid gap-6 xl:grid-cols-2">
      <Card><CardHeader><CardTitle>{translateUi(uiLanguage, "Shared applicant profile")}</CardTitle><CardDescription>{translateUi(uiLanguage, "Purpose-limited projection; internal CRM notes and commercial fields are excluded.")}</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">{Object.entries(app.shared_profile ?? {}).map(([key, value]) => <Info key={key} label={human(key)} value={String(value ?? "—")} />)}</CardContent></Card>
      <Card><CardHeader><CardTitle>{translateUi(uiLanguage, "Evidence assessments")}</CardTitle><CardDescription>{translateUi(uiLanguage, "Only consent-bound, verified evidence manifests shared with this institution can be assessed. Document bytes and private object references stay outside this portal.")}</CardDescription></CardHeader><CardContent className="space-y-3">
        {data.sharedEvidence?.length ? data.sharedEvidence.map((item: any) => <div key={item.id} className="rounded-lg border p-3"><div className="flex items-center justify-between gap-3"><div><div className="font-medium">{human(item.requirement_code)}</div><div className="text-xs text-muted-foreground">{translateUi(uiLanguage, "Shared")} {formatDate(item.created_at)} {translateUi(uiLanguage, "· valid until")} {formatDate(item.valid_until)}</div>{!item.assessment_requirement_id&&<div className="mt-1 text-xs font-medium text-destructive">{translateUi(uiLanguage, "No matching published institution requirement")}</div>}{item.enrolment_eligible&&<div className="mt-1 text-xs font-medium text-primary">{translateUi(uiLanguage, "Eligible enrolment evidence")}</div>}</div><div className="flex flex-wrap justify-end gap-2">{caps.has("institution.evidence.assess")&&item.assessment_requirement_id&&<Button size="sm" variant="outline" disabled={assess.isPending} onClick={()=>assess.mutate({body:{requirementId:item.assessment_requirement_id,evidenceShareReceiptId:item.id,result:"VERIFIED",reasonCode}})}>{translateUi(uiLanguage, "Assess verified evidence")}</Button>}{item.enrolment_eligible&&caps.has("institution.enrolment.confirm")&&["OFFER_ISSUED","ENROLMENT_PENDING"].includes(app.lifecycle_state)&&<Button size="sm" disabled={enrol.isPending} onClick={()=>window.confirm("Confirm enrolment with this exact reviewed evidence receipt?")&&enrol.mutate({body:{state:"CONFIRMED",evidenceShareReceiptId:item.id}})}>{translateUi(uiLanguage, "Confirm enrolment")}</Button>}</div></div></div>) : <Empty>{translateUi(uiLanguage, "No consent-bound evidence has been shared with this institution.")}</Empty>}
        {data.evidenceAssessments?.length ? data.evidenceAssessments.map((item: any) => <div key={item.id} className="flex items-center justify-between rounded-lg border p-3"><div><div className="font-medium">{item.reason_code}</div><div className="text-xs text-muted-foreground">{formatDate(item.assessed_at)}</div></div><Status value={item.result} /></div>) : <Empty />}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>{translateUi(uiLanguage, "Information requests")}</CardTitle><CardDescription>{translateUi(uiLanguage, "Creates an auditable request only; no external message is sent by this module.")}</CardDescription></CardHeader><CardContent className="space-y-3">
        {data.informationRequests?.length ? data.informationRequests.map((item:any)=><div key={item.id} className="rounded-lg border p-3"><div className="flex justify-between"><span className="font-medium">{item.requirement_code}</span><Status value={item.status}/></div><p className="mt-2 text-sm text-muted-foreground">{item.message}</p></div>):<Empty/>}
        {caps.has("institution.information.request") && <form className="space-y-3 border-t pt-4" onSubmit={(event)=>{event.preventDefault();requestInfo.mutate({body:{requirementCode:"GENERAL_DOCUMENT",requestCode:"MISSING_EVIDENCE",message:requestMessage}});}}><Label>{translateUi(uiLanguage, "Request note")}</Label><Textarea value={requestMessage} onChange={(e)=>setRequestMessage(e.target.value)} required/><Button disabled={requestInfo.isPending}>{translateUi(uiLanguage, "Create information request")}</Button></form>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>{translateUi(uiLanguage, "Versioned decisions")}</CardTitle><CardDescription>{translateUi(uiLanguage, "The maker cannot approve their own decision.")}</CardDescription></CardHeader><CardContent className="space-y-3">
        {data.decisions?.length ? data.decisions.map((item:any)=><div key={item.id} className="rounded-lg border p-3"><div className="flex justify-between"><span className="font-medium">v{item.version_number} · {human(item.decision_type)}</span><Status value={item.state}/></div><p className="mt-2 text-sm text-muted-foreground">{item.rationale}</p>{item.state==="DRAFT"&&caps.has("institution.decisions.draft")&&<Button className="mt-3" size="sm" variant="outline" onClick={()=>submit.mutate({value:item.id})}>{translateUi(uiLanguage, "Submit for independent approval")}</Button>}</div>):<Empty/>}
        {app.lifecycle_state==="READY_FOR_DECISION"&&caps.has("institution.decisions.draft")&&<form className="space-y-3 border-t pt-4" onSubmit={(event)=>{event.preventDefault();decision.mutate({body:{decisionType,reasonCode,rationale,conditions:[]}});}}><Label>{translateUi(uiLanguage, "Decision")}</Label><select className="h-10 w-full rounded-md border bg-background px-3" value={decisionType} onChange={(e)=>setDecisionType(e.target.value)}><option value="CONDITIONAL_OFFER">{translateUi(uiLanguage, "Conditional offer")}</option><option value="UNCONDITIONAL_OFFER">{translateUi(uiLanguage, "Unconditional offer")}</option><option value="WAITLISTED">{translateUi(uiLanguage, "Waitlisted")}</option><option value="REJECTED">{translateUi(uiLanguage, "Rejected")}</option></select><Label>{translateUi(uiLanguage, "Reason code")}</Label><Input value={reasonCode} onChange={(e)=>setReasonCode(e.target.value.toUpperCase())}/><Label>{translateUi(uiLanguage, "Rationale")}</Label><Textarea value={rationale} onChange={(e)=>setRationale(e.target.value)} required/><Button disabled={decision.isPending}>{translateUi(uiLanguage, "Create immutable draft")}</Button></form>}
      </CardContent></Card>
    </div>
    <Card><CardHeader><CardTitle>{translateUi(uiLanguage, "Audit timeline")}</CardTitle></CardHeader><CardContent className="space-y-3">{data.events?.map((item:any)=><div key={item.id} className="flex gap-3 border-l-2 border-primary/30 pl-4"><CheckCircle2 className="mt-0.5 h-4 w-4 text-primary"/><div><div className="text-sm font-medium">{human(item.event_type.replace("institution.","").replace(".v1",""))}</div><div className="text-xs text-muted-foreground">{formatDate(item.occurred_at)}</div></div></div>)}</CardContent></Card>
  </div>;
}

function Info({ label, value }: { label: string; value: unknown }) { return <div><div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 text-sm">{String(value ?? "—")}</div></div>; }

function Decisions({ context }: { context?: Context }) {
  const { lang: uiLanguage } = useUiLanguage();
  const query=useQuery<{data:any[]}>({queryKey:["institution","decisions"],queryFn:()=>customFetch("/api/institution/decisions")});
  const approve=useApiMutation((id)=>`/api/institution/decisions/${id}/approve`), returned=useApiMutation((id)=>`/api/institution/decisions/${id}/return`);
  if(query.isLoading)return <Loading/>; if(query.error)return <ErrorState error={query.error}/>;
  return <Card><CardContent className="pt-6">{!query.data?.data?.length?<Empty/>:<Table><TableHeader><TableRow><TableHead>{translateUi(uiLanguage, "Case")}</TableHead><TableHead>{translateUi(uiLanguage, "Decision")}</TableHead><TableHead>{translateUi(uiLanguage, "Maker")}</TableHead><TableHead>{translateUi(uiLanguage, "Status")}</TableHead><TableHead/></TableRow></TableHeader><TableBody>{query.data.data.map((item)=><TableRow key={item.id}><TableCell>{item.masked_student_ref}<div className="text-xs text-muted-foreground">v{item.version_number}</div></TableCell><TableCell>{human(item.decision_type)}</TableCell><TableCell className="font-mono text-xs">{item.maker_membership_id.slice(0,8)}…</TableCell><TableCell><Status value={item.state}/></TableCell><TableCell className="text-right">{item.state==="SUBMITTED"&&context?.capabilities.includes("institution.decisions.approve")&&<div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={()=>returned.mutate({value:item.id,body:{reasonCode:"RETURNED_FOR_REWORK"}})}>{translateUi(uiLanguage, "Return")}</Button><Button size="sm" onClick={()=>window.confirm("Approve this versioned decision as an independent checker?")&&approve.mutate({value:item.id,body:{reasonCode:"APPROVED_BY_CHECKER"}})}>{translateUi(uiLanguage, "Approve")}</Button></div>}</TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card>;
}

function Offers({ context }: { context?: Context }) {
  const { lang: uiLanguage } = useUiLanguage();
  const [,navigate]=useLocation();
  const query=useQuery<{data:any[]}>({queryKey:["institution","offers"],queryFn:()=>customFetch("/api/institution/offers")});
  const issue=useApiMutation((id)=>`/api/institution/offers/${id}/issue`);
  if(query.isLoading)return <Loading/>;if(query.error)return <ErrorState error={query.error}/>;
  return <Card><CardContent className="pt-6">{!query.data?.data?.length?<Empty/>:<Table><TableHeader><TableRow><TableHead>{translateUi(uiLanguage, "Applicant")}</TableHead><TableHead>{translateUi(uiLanguage, "State")}</TableHead><TableHead>{translateUi(uiLanguage, "Deadline")}</TableHead><TableHead>{translateUi(uiLanguage, "Issued")}</TableHead><TableHead/></TableRow></TableHeader><TableBody>{query.data.data.map((item)=><TableRow key={item.id}><TableCell>{item.masked_student_ref}</TableCell><TableCell><Status value={item.state}/></TableCell><TableCell>{formatDate(item.acceptance_deadline)}</TableCell><TableCell>{formatDate(item.issued_at)}</TableCell><TableCell className="text-right"><div className="flex justify-end gap-2">{item.state==="DRAFT"&&context?.capabilities.includes("institution.offers.issue")&&<Button size="sm" onClick={()=>window.confirm("Issue this approved offer? External delivery remains disabled.")&&issue.mutate({value:item.id,body:{}})}>{translateUi(uiLanguage, "Issue offer")}</Button>}{item.state==="ISSUED"&&context?.capabilities.includes("institution.enrolment.confirm")&&<Button size="sm" variant="outline" onClick={()=>navigate(`/institution/applications/${item.application_case_id}`)}>{translateUi(uiLanguage, "Select enrolment evidence")}</Button>}</div></TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card>;
}

function SimpleList({ endpoint, columns }: { endpoint:string; columns:{key:string;label:string;render?:(row:any)=>React.ReactNode}[] }) {
  const query=useQuery<any>({queryKey:["institution",endpoint],queryFn:()=>customFetch(endpoint)});
  if(query.isLoading)return <Loading/>;if(query.error)return <ErrorState error={query.error}/>;
  const data=Array.isArray(query.data?.data)?query.data.data:[];
  return <Card><CardContent className="pt-6">{!data.length?<Empty/>:<Table><TableHeader><TableRow>{columns.map(c=><TableHead key={c.key}>{c.label}</TableHead>)}</TableRow></TableHeader><TableBody>{data.map((row:any,index:number)=><TableRow key={row.id??index}>{columns.map(c=><TableCell key={c.key}>{c.render?c.render(row):String(row[c.key]??"—")}</TableCell>)}</TableRow>)}</TableBody></Table>}</CardContent></Card>;
}

function Requirements() {
  const { lang: uiLanguage } = useUiLanguage();
  const query=useQuery<{data:any[]}>({queryKey:["institution","requirements"],queryFn:()=>customFetch("/api/institution/requirements")});
  const [programId,setProgramId]=useState(""),[intakeKey,setIntakeKey]=useState(""),[title,setTitle]=useState(""),[requirementCode,setRequirementCode]=useState("GENERAL_DOCUMENT"),[evidenceType,setEvidenceType]=useState("DOCUMENT");
  const create=useApiMutation(()=>"/api/institution/requirements"),submit=useApiMutation(id=>`/api/institution/requirements/${id}/submit`),publish=useApiMutation(id=>`/api/institution/requirements/${id}/publish`);
  if(query.isLoading)return <Loading/>;if(query.error)return <ErrorState error={query.error}/>;
  return <div className="grid gap-6 xl:grid-cols-[1fr_360px]"><Card><CardContent className="pt-6">{!query.data?.data?.length?<Empty/>:<Table><TableHeader><TableRow><TableHead>{translateUi(uiLanguage, "Program")}</TableHead><TableHead>{translateUi(uiLanguage, "Intake")}</TableHead><TableHead>{translateUi(uiLanguage, "Version")}</TableHead><TableHead>{translateUi(uiLanguage, "State")}</TableHead><TableHead>{translateUi(uiLanguage, "Rules")}</TableHead><TableHead/></TableRow></TableHeader><TableBody>{query.data.data.map(item=><TableRow key={item.id}><TableCell>{item.program_name}</TableCell><TableCell>{item.intake_key}</TableCell><TableCell>v{item.version_number}</TableCell><TableCell><Status value={item.state}/></TableCell><TableCell>{item.requirements?.length??0}</TableCell><TableCell className="text-right">{item.state==="DRAFT"?<Button size="sm" variant="outline" onClick={()=>submit.mutate({value:item.id})}>{translateUi(uiLanguage, "Submit")}</Button>:item.state==="IN_REVIEW"?<Button size="sm" onClick={()=>window.confirm("Publish with independent maker-checker approval?")&&publish.mutate({value:item.id,body:{effectiveFrom:new Date().toISOString()}})}>{translateUi(uiLanguage, "Publish")}</Button>:null}</TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card><Card><CardHeader><CardTitle>{translateUi(uiLanguage, "New requirement version")}</CardTitle><CardDescription>{translateUi(uiLanguage, "Creates one immutable rule set draft. Enrolment confirmation must use its dedicated evidence type.")}</CardDescription></CardHeader><CardContent><form className="space-y-4" onSubmit={e=>{e.preventDefault();create.mutate({body:{programId:Number(programId),intakeKey,sourceRef:"institution-portal-manual",sourceText:title,requirements:[{code:requirementCode,title,evidenceType,mandatory:true,rule:{}}]}});}}><Label>{translateUi(uiLanguage, "Program ID")}</Label><Input inputMode="numeric" value={programId} onChange={e=>setProgramId(e.target.value)} required/><Label>{translateUi(uiLanguage, "Intake")}</Label><Input value={intakeKey} onChange={e=>setIntakeKey(e.target.value)} required/><Label>{translateUi(uiLanguage, "Requirement code")}</Label><Input value={requirementCode} onChange={e=>setRequirementCode(e.target.value.toUpperCase())} pattern="[A-Z][A-Z0-9_]{1,63}" required/><Label>{translateUi(uiLanguage, "Evidence type")}</Label><select className="h-10 w-full rounded-md border bg-background px-3" value={evidenceType} onChange={e=>setEvidenceType(e.target.value)}><option value="DOCUMENT">{translateUi(uiLanguage, "Document")}</option><option value="ENROLMENT_CONFIRMATION">{translateUi(uiLanguage, "Enrolment confirmation")}</option></select><Label>{translateUi(uiLanguage, "Requirement title")}</Label><Input value={title} onChange={e=>setTitle(e.target.value)} required/><Button className="w-full">{translateUi(uiLanguage, "Create draft")}</Button></form></CardContent></Card></div>;
}

function Programs() {
  const { lang: uiLanguage } = useUiLanguage();
  const query=useQuery<{data:any[]}>({queryKey:["institution","programs"],queryFn:()=>customFetch("/api/institution/programs-intakes")});
  const [programId,setProgramId]=useState(""),[intakes,setIntakes]=useState(""),[quota,setQuota]=useState("");
  const update=useApiMutation(id=>`/api/institution/programs-intakes/${id}/change-requests`);
  if(query.isLoading)return <Loading/>;if(query.error)return <ErrorState error={query.error}/>;
  return <div className="grid gap-6 xl:grid-cols-[1fr_360px]"><Card><CardContent className="pt-6">{!query.data?.data?.length?<Empty/>:<Table><TableHeader><TableRow><TableHead>{translateUi(uiLanguage, "ID")}</TableHead><TableHead>{translateUi(uiLanguage, "Program")}</TableHead><TableHead>{translateUi(uiLanguage, "Degree")}</TableHead><TableHead>{translateUi(uiLanguage, "Intakes")}</TableHead><TableHead>{translateUi(uiLanguage, "Quota")}</TableHead><TableHead>{translateUi(uiLanguage, "Status")}</TableHead></TableRow></TableHeader><TableBody>{query.data.data.map(item=><TableRow key={item.id}><TableCell>#{item.id}</TableCell><TableCell>{item.name}</TableCell><TableCell>{item.degree??"—"}</TableCell><TableCell>{item.intakes??"—"}</TableCell><TableCell>{item.quota??"—"}</TableCell><TableCell><Status value={item.is_active?"ACTIVE":"INACTIVE"}/></TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card><Card><CardHeader><CardTitle>{translateUi(uiLanguage, "Request catalog change")}</CardTitle><CardDescription>{translateUi(uiLanguage, "The shared catalog is never edited directly. This creates an auditable request for the internal ChangeSet approval corridor.")}</CardDescription></CardHeader><CardContent><form className="space-y-4" onSubmit={e=>{e.preventDefault();update.mutate({value:Number(programId),body:{intakes,quota:quota?Number(quota):null}});}}><Label>{translateUi(uiLanguage, "Program ID")}</Label><Input value={programId} onChange={e=>setProgramId(e.target.value)} required/><Label>{translateUi(uiLanguage, "Proposed intakes")}</Label><Input value={intakes} onChange={e=>setIntakes(e.target.value)} placeholder={translateUi(uiLanguage, "Fall, Spring")}/><Label>{translateUi(uiLanguage, "Proposed quota")}</Label><Input value={quota} onChange={e=>setQuota(e.target.value)} inputMode="numeric"/><Button className="w-full">{translateUi(uiLanguage, "Submit change request")}</Button></form></CardContent></Card></div>;
}

function Team() {
  const { lang: uiLanguage } = useUiLanguage();
  const query=useQuery<{data:any[]}>({queryKey:["institution","team"],queryFn:()=>customFetch("/api/institution/team")});
  const [userId,setUserId]=useState(""),[roleKey,setRoleKey]=useState("ADMISSIONS_REVIEWER");
  const add=useApiMutation(()=>"/api/institution/team/memberships");
  if(query.isLoading)return <Loading/>;if(query.error)return <ErrorState error={query.error}/>;
  return <div className="grid gap-6 xl:grid-cols-[1fr_360px]"><Card><CardContent className="pt-6">{!query.data?.data?.length?<Empty/>:<Table><TableHeader><TableRow><TableHead>{translateUi(uiLanguage, "User")}</TableHead><TableHead>{translateUi(uiLanguage, "Role")}</TableHead><TableHead>{translateUi(uiLanguage, "Program scope")}</TableHead><TableHead>{translateUi(uiLanguage, "Status")}</TableHead></TableRow></TableHeader><TableBody>{query.data.data.map(item=><TableRow key={item.id}><TableCell>{item.first_name} {item.last_name}<div className="text-xs text-muted-foreground">{item.email}</div></TableCell><TableCell>{human(item.role_key)}</TableCell><TableCell>{item.program_scope_ids?.length?item.program_scope_ids.join(", "):translateUi(uiLanguage, "All")}</TableCell><TableCell><Status value={item.status}/></TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card><Card><CardHeader><CardTitle>{translateUi(uiLanguage, "Add existing principal")}</CardTitle><CardDescription>{translateUi(uiLanguage, "Local assurance only; production provisioning stays behind Control Plane.")}</CardDescription></CardHeader><CardContent><form className="space-y-4" onSubmit={e=>{e.preventDefault();add.mutate({body:{userId:Number(userId),roleKey,programScopeIds:[],intakeScopes:[]}});}}><Label>{translateUi(uiLanguage, "Existing user ID")}</Label><Input value={userId} onChange={e=>setUserId(e.target.value)} inputMode="numeric" required/><Label>{translateUi(uiLanguage, "Institution role")}</Label><select className="h-10 w-full rounded-md border bg-background px-3" value={roleKey} onChange={e=>setRoleKey(e.target.value)}><option value="INSTITUTION_ADMIN">{translateUi(uiLanguage, "Institution Admin")}</option><option value="PROGRAM_INTAKE_MANAGER">{translateUi(uiLanguage, "Program / Intake Manager")}</option><option value="ADMISSIONS_REVIEWER">{translateUi(uiLanguage, "Admissions Reviewer")}</option><option value="DECISION_APPROVER">{translateUi(uiLanguage, "Decision Approver")}</option><option value="INTEGRATION_ADMIN">{translateUi(uiLanguage, "Integration Admin")}</option><option value="INSTITUTION_AUDITOR">{translateUi(uiLanguage, "Institution Auditor")}</option></select><Button className="w-full">{translateUi(uiLanguage, "Create membership")}</Button></form></CardContent></Card></div>;
}

function Sla() {
  const { lang: uiLanguage } = useUiLanguage();
  const [name,setName]=useState("Standard admissions SLA"),[timezone,setTimezone]=useState("Europe/Istanbul");
  const save=useApiMutation(()=>"/api/institution/sla");
  return <div className="grid gap-6 xl:grid-cols-[1fr_360px]"><SimpleList endpoint="/api/institution/sla" columns={[{key:"name",label:"Policy"},{key:"timezone",label:"Timezone"},{key:"review_target_hours",label:"Review h"},{key:"decision_target_hours",label:"Decision h"},{key:"status",label:"Status",render:r=><Status value={r.status}/>}]} /><Card><CardHeader><CardTitle>{translateUi(uiLanguage, "New SLA version")}</CardTitle><CardDescription>{translateUi(uiLanguage, "Activating a version retires the previous one.")}</CardDescription></CardHeader><CardContent><form className="space-y-4" onSubmit={e=>{e.preventDefault();save.mutate({body:{name,timezone,reviewTargetHours:48,decisionTargetHours:72,informationResponseHours:120}});}}><Label>{translateUi(uiLanguage, "Name")}</Label><Input value={name} onChange={e=>setName(e.target.value)}/><Label>{translateUi(uiLanguage, "IANA timezone")}</Label><Input value={timezone} onChange={e=>setTimezone(e.target.value)}/><Button className="w-full">{translateUi(uiLanguage, "Create active version")}</Button></form></CardContent></Card></div>;
}

function Analytics() {
  const { lang: uiLanguage } = useUiLanguage();
  const query=useQuery<any>({queryKey:["institution","analytics"],queryFn:()=>customFetch("/api/institution/analytics")});
  if(query.isLoading)return <Loading/>;if(query.error)return <ErrorState error={query.error}/>;
  return <div className="space-y-6"><div className="grid gap-4 md:grid-cols-3"><Metric icon={Inbox} label={translateUi(uiLanguage, "Open cases")} value={query.data?.sla?.open??0}/><Metric icon={Clock3} label={translateUi(uiLanguage, "SLA breached")} value={query.data?.sla?.breached??0} tone="danger"/><Metric icon={ShieldCheck} label={translateUi(uiLanguage, "Privacy")} value="Aggregate only"/></div><Card><CardHeader><CardTitle>{translateUi(uiLanguage, "Pipeline distribution")}</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{query.data?.states?.map((item:any)=><div key={item.lifecycle_state} className="rounded-lg border p-4"><div className="text-2xl font-semibold">{item.count}</div><div className="text-xs text-muted-foreground">{human(item.lifecycle_state)}</div></div>)}</CardContent></Card></div>;
}

function Integrations() {
  const { lang: uiLanguage } = useUiLanguage();
  const query=useQuery<any>({queryKey:["institution","integrations"],queryFn:()=>customFetch("/api/institution/integrations")});
  if(query.isLoading)return <Loading/>;if(query.error)return <ErrorState error={query.error}/>;
  return <Card><CardHeader><CardTitle>{translateUi(uiLanguage, "Integration safety boundary")}</CardTitle><CardDescription>{translateUi(uiLanguage, "Credentials are represented only as secret references and never rendered in this portal.")}</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex items-center justify-between rounded-lg border p-4"><div><div className="font-medium">{translateUi(uiLanguage, "External execution")}</div><div className="text-sm text-muted-foreground">{translateUi(uiLanguage, "Submit, portal automation and message delivery")}</div></div><Badge variant="outline">{query.data?.externalExecution}</Badge></div><div className="flex items-center justify-between rounded-lg border p-4"><div><div className="font-medium">{translateUi(uiLanguage, "Credential visibility")}</div><div className="text-sm text-muted-foreground">{translateUi(uiLanguage, "Raw secrets are never exposed")}</div></div><Badge>{query.data?.credentialVisibility}</Badge></div></CardContent></Card>;
}

function Audit() {
  return <SimpleList endpoint="/api/institution/audit" columns={[
    {key:"occurred_at",label:"Observed",render:(row)=>formatDate(row.occurred_at)},
    {key:"event_type",label:"Event",render:(row)=>human(row.event_type.replace("institution.","").replace(".v1",""))},
    {key:"aggregate_type",label:"Aggregate",render:(row)=>human(row.aggregate_type)},
    {key:"aggregate_version",label:"Version"},
    {key:"actor_ref",label:"Actor ref"},
    {key:"event_hash",label:"Receipt",render:(row)=><span className="font-mono text-xs">{String(row.event_hash).slice(0,12)}…</span>},
  ]}/>;
}

export default function InstitutionWorkspace({ view, applicationId }: Props) {
  const { lang: uiLanguage } = useUiLanguage();
  useSeo({title:TITLES[view],noindex:true});
  const contextQuery=useQuery<Context>({queryKey:["institution","context"],queryFn:()=>customFetch("/api/institution/me/context"),staleTime:60_000,retry:false});
  const context=contextQuery.data;
  const content=useMemo(()=>{
    if(view==="home")return <Home/>;
    if(view==="review-queue")return <CaseTable endpoint="/api/institution/review-queue" canClaim={context?.capabilities.includes("institution.applications.review")??false}/>;
    if(view==="applications")return <CaseTable endpoint="/api/institution/applications" canClaim={false}/>;
    if(view==="application"&&applicationId)return <ApplicationReview id={applicationId} context={context}/>;
    if(view==="decisions")return <Decisions context={context}/>;
    if(view==="offers")return <Offers context={context}/>;
    if(view==="programs-intakes")return <Programs/>;
    if(view==="requirements")return <Requirements/>;
    if(view==="sla")return <Sla/>;
    if(view==="integrations")return <Integrations/>;
    if(view==="analytics")return <Analytics/>;
    if(view==="team")return <Team/>;
    if(view==="audit")return <Audit/>;
    return <Empty>{translateUi(uiLanguage, "Unknown institution view.")}</Empty>;
  },[view,applicationId,context]);
  if(contextQuery.isLoading)return <Loading/>;
  if(contextQuery.error)return <ErrorState error={contextQuery.error}/>;
  return <div className="space-y-6 pb-10"><div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">{TITLES[view]}</h1><p className="mt-1 text-sm text-muted-foreground">{context?.institutionName}</p></div><div className="flex items-center gap-2"><Badge variant="outline">{context?.roleDisplayName}</Badge><Badge variant="secondary"><FileCheck2 className="mr-1 h-3 w-3"/>{translateUi(uiLanguage, "Purpose-limited")}</Badge></div></div>{content}</div>;
}
