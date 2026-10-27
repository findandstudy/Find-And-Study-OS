import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, FolderKanban, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/hooks/use-i18n";
import { workspaceRequest, WorkspaceRequestError } from "@/lib/personaTeamWorkspace";
import {
  parsePersonaWorkspaceProjects,
  personaWorkspacePath,
  type PersonaWorkspaceProject,
} from "@/lib/personaWorkspaceNavigation";

export default function TeamWorkspaceEntry() {
  const { lang } = useI18n();
  const [, setLocation] = useLocation();
  const copy = (tr: string, en: string) => lang === "tr" ? tr : en;
  const [projects, setProjects] = useState<PersonaWorkspaceProject[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "unavailable" | "session" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    let mounted = true;
    setPhase("loading");
    setProjects([]);
    void workspaceRequest("/api/persona-workspace/projects", { signal: controller.signal })
      .then((value) => {
        const available = parsePersonaWorkspaceProjects(value);
        if (!mounted) return;
        if (available.length === 1) {
          setLocation(personaWorkspacePath(available[0].id)!, { replace: true });
          return;
        }
        setProjects(available);
        setPhase("ready");
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        setPhase(error instanceof WorkspaceRequestError && error.status === 503
          ? "unavailable"
          : error instanceof WorkspaceRequestError && (error.status === 401 || error.status === 403)
            ? "session" : "error");
      })
      .finally(() => window.clearTimeout(timeout));
    return () => { mounted = false; controller.abort(); window.clearTimeout(timeout); };
  }, [attempt, setLocation]);

  if (phase === "loading") return <section className="p-3 md:p-6" role="status" aria-live="polite">
    <div className="flex items-center gap-3 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      {copy("Çalışma alanı açılıyor…", "Opening workspace…")}
    </div>
  </section>;

  return <section className="space-y-5 p-3 md:p-6 max-w-4xl">
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">{copy("Takım çalışma alanı", "Team workspace")}</h1>
      {phase === "ready" && projects.length > 1 && <p className="text-muted-foreground">{copy(
        "Takımınızı düzenlemek, görev hazırlamak ve sonuçları takip etmek için projenizi seçin.",
        "Select your project to organize its team, prepare tasks and follow results.",
      )}</p>}
      <p className="text-sm text-muted-foreground">{copy(
        "Deneme ortamı: takım ve görev kayıtları saklanır. Görevler deneme verileriyle çalışır; dışarıya mesaj veya yayın gönderilmez.",
        "Test environment: team and task records are saved. Tasks use test data; no external messages or publications are sent.",
      )}</p>
    </div>
    {phase !== "ready" && <Card className="p-6 space-y-3" role="alert">
      <p>{phase === "unavailable" ? copy(
        "Kalıcı çalışma alanı bu ortamda henüz kullanıma açılmadı. Görsel önizlemenin açık olması, bu alanın hazır olduğu anlamına gelmez.",
        "The persistent workspace is not enabled in this environment yet. An available visual preview does not mean this workspace is ready.",
      ) : phase === "session" ? copy(
        "Projeler için oturum veya erişim doğrulanamadı. Admin ya da Super Admin hesabınızla giriş yaptığınızı kontrol edin.",
        "Your session or project access could not be verified. Check that you are signed in with an Admin or Super Admin account.",
      ) : copy(
        "Projeler yüklenemedi. Bağlantınızı kontrol edip tekrar deneyin.",
        "Projects could not be loaded. Check your connection and try again.",
      )}</p>
      <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>{copy("Tekrar dene", "Try again")}</Button>
    </Card>}
    {phase === "ready" && projects.length === 0 && <Card className="p-6" role="status">
      {copy("Bu hesaba tanımlı bir takım çalışma alanı bulunmuyor.", "No team workspace is assigned to this account.")}
    </Card>}
    {phase === "ready" && projects.length > 1 && <div className="grid gap-4 sm:grid-cols-2">
      {projects.map((project) => <Card key={project.id} className="p-5 space-y-4 min-w-0">
        <div className="flex items-start gap-3">
          <FolderKanban className="h-5 w-5 mt-0.5 text-primary shrink-0" aria-hidden="true" />
          <h2 className="font-semibold break-words">{project.label}</h2>
        </div>
        <Button asChild className="w-full"><Link href={personaWorkspacePath(project.id)!}>
          {copy("Çalışma alanını aç", "Open workspace")}<ArrowRight className="h-4 w-4 ms-2 rtl:rotate-180" aria-hidden="true" />
        </Link></Button>
      </Card>)}
    </div>}
  </section>;
}
