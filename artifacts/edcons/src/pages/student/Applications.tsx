import { useListApplications } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, GraduationCap, Calendar, Clock, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { StageDocumentsPanel } from "@/components/StageDocumentsPanel";
import { ApplicationDocumentsPanel, APPLICATION_DOC_STAGES } from "@/components/ApplicationDocumentsPanel";
import { useI18n } from "@/hooks/use-i18n";
import { formatDate } from "@/lib/i18n";

const STAGE_KEYS: Record<string, { key: string; color: string; icon: typeof CheckCircle; step: number }> = {
  inquiry:              { key: "studentDash.stageInquiry",            color: "bg-slate-100 text-slate-700 border-slate-200",    icon: AlertCircle, step: 1 },
  documents_collected:  { key: "studentDash.stageDocumentsCollected", color: "bg-blue-100 text-blue-700 border-blue-200",       icon: FileText,    step: 2 },
  submitted:            { key: "studentDash.stageSubmitted",          color: "bg-violet-100 text-violet-700 border-violet-200", icon: FileText,    step: 3 },
  offer_received:       { key: "studentDash.stageOfferReceived",      color: "bg-amber-100 text-amber-700 border-amber-200",    icon: CheckCircle, step: 4 },
  visa_applied:         { key: "studentDash.stageVisaApplied",        color: "bg-orange-100 text-orange-700 border-orange-200", icon: Clock,       step: 5 },
  visa_approved:        { key: "studentDash.stageVisaApproved",       color: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: CheckCircle, step: 6 },
  enrolled:             { key: "studentDash.stageEnrolled",           color: "bg-green-100 text-green-700 border-green-200",    icon: GraduationCap, step: 7 },
  rejected:             { key: "studentDash.stageRejected",           color: "bg-rose-100 text-rose-700 border-rose-200",       icon: XCircle,     step: 0 },
};

const STEPS = ["inquiry","documents_collected","submitted","offer_received","visa_applied","visa_approved","enrolled"];

export default function StudentApplications() {
  const { t, lang } = useI18n();
  const { data: resp, isLoading } = useListApplications(undefined, { query: { queryKey: ["student-apps-list"] } as any });
  const applications: any[] = (resp as any)?.data || resp || [];

  return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <FileText className="w-6 h-6 text-primary" /> {t("studentApps.title")}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">{t("studentApps.subtitle")}</p>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <Card key={i} className="p-6 border-none shadow-md shadow-black/5">
                <div className="space-y-3">
                  <div className="h-5 bg-secondary animate-pulse rounded-full w-1/3" />
                  <div className="h-4 bg-secondary animate-pulse rounded-full w-1/2" />
                  <div className="h-3 bg-secondary animate-pulse rounded-full w-full" />
                </div>
              </Card>
            ))}
          </div>
        ) : applications.length === 0 ? (
          <Card className="p-16 border-none shadow-lg shadow-black/5 text-center border-2 border-dashed border-primary/20">
            <GraduationCap className="w-16 h-16 text-primary/20 mx-auto mb-4" />
            <h3 className="text-xl font-display font-bold text-foreground mb-2">{t("studentApps.none")}</h3>
            <p className="text-muted-foreground">{t("studentApps.noneDesc")}</p>
          </Card>
        ) : (
          <div className="space-y-5">
            {applications.map((app: any) => {
              const stageCfg = STAGE_KEYS[app.stage] || STAGE_KEYS.inquiry;
              const currentStep = stageCfg.step;

              return (
                <Card key={app.id} className="border-none shadow-lg shadow-black/5 overflow-hidden">
                  {/* Header */}
                  <div className="p-6 border-b border-border/50">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-mono text-muted-foreground">{t("studentApps.appNumber", { id: app.id })}</span>
                          <Badge className={`text-xs border ${stageCfg.color}`}>
                            <stageCfg.icon className="w-3 h-3 mr-1" />
                            {t(stageCfg.key)}
                          </Badge>
                        </div>
                        <h2 className="font-display font-bold text-lg text-foreground">
                          {app.universityName || (app.universityId ? `${t("common.university")} #${app.universityId}` : t("studentApps.universityApp"))}
                        </h2>
                        {app.programName && (
                          <p className="text-sm text-muted-foreground">{app.programName}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-4 mt-1 text-sm text-muted-foreground">
                          {app.intakeDate && (
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3.5 h-3.5" />
                              {t("studentApps.intake", { date: formatDate(lang, app.intakeDate, { month: "long", year: "numeric" }) })}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            {t("studentApps.started", { date: formatDate(lang, app.createdAt, { month: "short", day: "numeric", year: "numeric" }) })}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Progress Tracker — students only see steps up to current */}
                  {app.stage !== "rejected" && (() => {
                    const visibleSteps = currentStep > 0 ? STEPS.slice(0, currentStep) : STEPS;
                    return (
                    <div className="px-6 py-6 bg-secondary/20">
                      <div className="relative">
                        <div className="absolute top-5 left-5 right-5 h-0.5 bg-border" />
                        <div
                          className="absolute top-5 left-5 h-0.5 bg-primary transition-all duration-500"
                          style={{ width: visibleSteps.length > 1 ? `${((visibleSteps.length - 1) / Math.max(1, visibleSteps.length - 1)) * 100}%` : "0%" }}
                        />
                        <div className="relative flex justify-between">
                          {visibleSteps.map((step, i) => {
                            const info = STAGE_KEYS[step];
                            const isDone = currentStep > i + 1;
                            const isCurrent = currentStep === i + 1;
                            return (
                              <div key={step} className="flex flex-col items-center gap-2 relative z-10">
                                <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all
                                  ${isDone ? "bg-primary border-primary text-white shadow-md shadow-primary/30" :
                                    isCurrent ? "bg-white border-primary text-primary shadow-md shadow-primary/30" :
                                    "bg-background border-border text-muted-foreground"}`}>
                                  {isDone ? <CheckCircle className="w-5 h-5" /> : (
                                    <span className="text-xs font-bold">{i + 1}</span>
                                  )}
                                </div>
                                <p className={`text-[10px] font-medium text-center max-w-[60px] leading-tight hidden md:block
                                  ${isCurrent ? "text-primary font-bold" : isDone ? "text-foreground" : "text-muted-foreground"}`}>
                                  {t(info.key)}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    );
                  })()}

                  {app.stage === "rejected" && (
                    <div className="px-6 py-4 bg-rose-50 border-t border-rose-200">
                      <div className="flex items-center gap-2 text-rose-700">
                        <XCircle className="w-4 h-4" />
                        <p className="text-sm font-medium">{t("studentApps.notSuccessful")}</p>
                      </div>
                    </div>
                  )}

                  {/* Notes */}
                  {app.notes && (
                    <div className="px-6 py-4 border-t border-border/50">
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">{t("studentApps.advisorNotes")}</p>
                      <p className="text-sm text-foreground">{app.notes}</p>
                    </div>
                  )}

                  <div className="px-6 py-4 border-t border-border/50 space-y-4">
                    <ApplicationDocumentsPanel
                      applicationId={app.id}
                      userRole="student"
                      currentStage={app.stage}
                    />
                    <StageDocumentsPanel
                      applicationId={app.id}
                      currentStage={app.stage}
                      userRole="student"
                      excludeStages={APPLICATION_DOC_STAGES}
                    />
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
  );
}
