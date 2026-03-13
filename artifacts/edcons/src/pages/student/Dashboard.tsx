import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useAuth } from "@/hooks/use-auth";
import { useListApplications, useListDocuments } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, GraduationCap, Upload, CheckCircle, Clock, AlertCircle, MapPin, MessageSquare } from "lucide-react";

const STAGE_LABELS: Record<string, { label: string; color: string; step: number }> = {
  inquiry: { label: "Inquiry Received", color: "bg-slate-400", step: 1 },
  documents_collected: { label: "Documents Collected", color: "bg-blue-500", step: 2 },
  submitted: { label: "Submitted", color: "bg-violet-500", step: 3 },
  offer_received: { label: "Offer Received", color: "bg-amber-500", step: 4 },
  visa_applied: { label: "Visa Applied", color: "bg-orange-500", step: 5 },
  visa_approved: { label: "Visa Approved", color: "bg-emerald-500", step: 6 },
  enrolled: { label: "Enrolled", color: "bg-green-600", step: 7 },
  rejected: { label: "Rejected", color: "bg-rose-500", step: 0 },
};

const STEPS = ["inquiry", "documents_collected", "submitted", "offer_received", "visa_applied", "visa_approved", "enrolled"];

export default function StudentDashboard() {
  const { user } = useAuth(true);
  const { data: applicationsResp, isLoading: appsLoading } = useListApplications({ query: { queryKey: ['student-applications'] } });
  const { data: documentsResp } = useListDocuments({ query: { queryKey: ['student-docs'] } });
  const applications: any[] = (applicationsResp as any)?.data || applicationsResp || [];
  const documents: any[] = (documentsResp as any)?.data || documentsResp || [];

  const latestApp = applications?.[0];
  const stageInfo = latestApp ? STAGE_LABELS[latestApp.stage] : null;
  const currentStep = stageInfo?.step || 0;
  const pendingDocs = (documents || []).filter(d => d.status === 'pending' || d.status === 'requested').length;

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {/* Welcome */}
        <div className="bg-gradient-to-r from-primary to-accent rounded-2xl p-8 text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-white/10 -translate-y-16 translate-x-16" />
          <div className="relative z-10">
            <GraduationCap className="w-10 h-10 mb-4 text-white/80" />
            <h1 className="text-3xl font-display font-bold mb-2">
              Welcome back, {user?.firstName || "Student"}!
            </h1>
            <p className="text-white/80 text-lg">
              {latestApp ? "Your application is progressing well." : "Let's start your global education journey."}
            </p>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Applications", value: applications?.length || 0, icon: FileText, color: "text-blue-500 bg-blue-500/10" },
            { label: "Documents", value: documents?.length || 0, icon: Upload, color: "text-purple-500 bg-purple-500/10" },
            { label: "Pending Docs", value: pendingDocs, icon: AlertCircle, color: "text-amber-500 bg-amber-500/10" },
            { label: "Enrolled", value: (applications || []).filter(a => a.stage === 'enrolled').length, icon: CheckCircle, color: "text-green-500 bg-green-500/10" },
          ].map((s, i) => (
            <Card key={i} className="p-5 border-none shadow-md shadow-black/5">
              <div className={`w-10 h-10 rounded-xl ${s.color} flex items-center justify-center mb-3`}>
                <s.icon className="w-5 h-5" />
              </div>
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-2xl font-display font-bold text-foreground mt-1">{s.value}</p>
            </Card>
          ))}
        </div>

        {/* Application Progress */}
        {latestApp ? (
          <Card className="p-6 border-none shadow-lg shadow-black/5">
            <div className="flex items-start justify-between mb-8">
              <div>
                <h2 className="font-display font-bold text-xl text-foreground">Application Progress</h2>
                <p className="text-muted-foreground text-sm mt-1 flex items-center gap-1">
                  <MapPin className="w-4 h-4" /> Application #{latestApp.id}
                </p>
              </div>
              {stageInfo && (
                <Badge className={`${stageInfo.color} text-white text-sm px-4 py-1.5`}>
                  {stageInfo.label}
                </Badge>
              )}
            </div>
            <div className="relative">
              <div className="absolute top-5 left-5 right-5 h-0.5 bg-border" />
              <div className="relative flex justify-between">
                {STEPS.map((step, i) => {
                  const info = STAGE_LABELS[step];
                  const isDone = currentStep > i + 1;
                  const isCurrent = currentStep === i + 1;
                  return (
                    <div key={step} className="flex flex-col items-center gap-3 relative z-10">
                      <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-all
                        ${isDone ? 'bg-primary border-primary text-white shadow-md shadow-primary/25' :
                          isCurrent ? 'bg-white border-primary text-primary shadow-md shadow-primary/25' :
                          'bg-background border-border text-muted-foreground'}`}>
                        {isDone ? <CheckCircle className="w-5 h-5" /> : i + 1}
                      </div>
                      <p className={`text-xs font-medium text-center max-w-[70px] leading-tight hidden sm:block
                        ${isCurrent ? 'text-primary font-bold' : isDone ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {info.label}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>
        ) : (
          <Card className="p-12 border-none shadow-lg shadow-black/5 text-center border-2 border-dashed border-primary/20">
            <GraduationCap className="w-16 h-16 text-primary/30 mx-auto mb-4" />
            <h3 className="text-xl font-display font-bold text-foreground mb-2">Start Your Application</h3>
            <p className="text-muted-foreground mb-6">Browse programs and submit your first university application.</p>
            <Button className="rounded-xl gap-2 px-8">
              <FileText className="w-4 h-4" /> Browse Programs
            </Button>
          </Card>
        )}

        {/* Documents + Advisor */}
        <div className="grid lg:grid-cols-2 gap-6">
          <Card className="border-none shadow-lg shadow-black/5">
            <div className="p-5 border-b border-border/50 flex items-center justify-between">
              <h3 className="font-display font-bold text-lg">My Documents</h3>
              <Badge variant="secondary">{documents?.length || 0}</Badge>
            </div>
            <div className="divide-y divide-border/50">
              {appsLoading ? (
                [...Array(3)].map((_, i) => <div key={i} className="p-4"><div className="h-10 bg-secondary animate-pulse rounded-xl" /></div>)
              ) : (documents || []).length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  <Upload className="w-10 h-10 mx-auto mb-2 text-muted-foreground/30" />
                  <p className="font-medium">No documents uploaded yet</p>
                </div>
              ) : (documents || []).slice(0, 5).map(doc => (
                <div key={doc.id} className="flex items-center justify-between px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                      <FileText className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm text-foreground">{doc.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{doc.type}</p>
                    </div>
                  </div>
                  <Badge className={
                    doc.status === 'approved' ? 'bg-green-500/10 text-green-600 border-green-200' :
                    doc.status === 'rejected' ? 'bg-rose-500/10 text-rose-600 border-rose-200' :
                    'bg-amber-500/10 text-amber-600 border-amber-200'
                  }>
                    {doc.status}
                  </Badge>
                </div>
              ))}
            </div>
            <div className="p-4">
              <Button variant="outline" className="w-full rounded-xl gap-2">
                <Upload className="w-4 h-4" /> Upload Document
              </Button>
            </div>
          </Card>

          <Card className="border-none shadow-lg shadow-black/5 p-6">
            <h3 className="font-display font-bold text-lg mb-5">Your Advisor</h3>
            <div className="flex items-center gap-4 p-5 rounded-2xl bg-primary/5 border border-primary/20 mb-5">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-primary to-accent flex items-center justify-center text-white font-display font-bold text-xl shadow-md">
                EC
              </div>
              <div>
                <p className="font-display font-bold text-foreground">EduCons Advisor</p>
                <p className="text-muted-foreground text-sm">Your Dedicated Consultant</p>
                <p className="text-primary text-sm font-semibold mt-1">advisor@educons.com</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 rounded-xl bg-secondary/40 mb-4">
              <Clock className="w-4 h-4 text-primary" />
              <span>Mon–Fri 9am–6pm (GMT+3)</span>
            </div>
            <Button className="w-full rounded-xl gap-2 bg-gradient-to-r from-primary to-accent hover:opacity-90">
              <MessageSquare className="w-4 h-4" /> Message Advisor
            </Button>
            <div className="mt-5 space-y-3">
              <h4 className="font-bold text-sm text-foreground">Upcoming Tasks</h4>
              {[
                { task: "Submit passport copy", due: "Due in 3 days", urgent: true },
                { task: "Complete language test", due: "Due in 2 weeks", urgent: false },
              ].map((t, i) => (
                <div key={i} className={`flex items-start gap-3 p-3 rounded-xl border text-sm ${t.urgent ? 'border-rose-200 bg-rose-50' : 'border-border bg-secondary/30'}`}>
                  {t.urgent ? <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" /> : <Clock className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />}
                  <div>
                    <p className="font-medium text-foreground">{t.task}</p>
                    <p className={`text-xs mt-0.5 ${t.urgent ? 'text-rose-500 font-semibold' : 'text-muted-foreground'}`}>{t.due}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
