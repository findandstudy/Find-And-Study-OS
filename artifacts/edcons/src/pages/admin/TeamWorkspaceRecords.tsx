import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/hooks/use-i18n";
import {
  parseWorkspaceRecords,
  workspaceRequest,
} from "@/lib/personaTeamWorkspace";

/** Existing project records only. No approval/install/resume/execute controls. */
export default function TeamWorkspaceRecords({
  path,
  disabled,
}: {
  path: string;
  disabled: boolean;
}) {
  const { lang } = useI18n();
  const copy = (tr: string, en: string) => (lang === "tr" ? tr : en);
  const [records, setRecords] = useState<ReturnType<
    typeof parseWorkspaceRecords
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort("unmount");
    };
  }, []);
  useEffect(() => {
    if (disabled) {
      request.current?.abort("disabled");
      setRecords(null);
    }
  }, [disabled]);
  const load = async () => {
    if (busy || disabled) return;
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort("timeout"), 12000);
    setBusy(true);
    setError(false);
    setRecords(null);
    try {
      const [teams, workflows] = await Promise.all([
        workspaceRequest(path.replace(/team-workspace$/, "teams"), {
          signal: controller.signal,
        }),
        workspaceRequest(path.replace(/team-workspace$/, "workflows"), {
          signal: controller.signal,
        }),
      ]);
      const parsed = parseWorkspaceRecords(teams, workflows);
      if (!controller.signal.aborted) setRecords(parsed);
    } catch {
      if (mounted.current && controller.signal.reason !== "disabled")
        setError(true);
    } finally {
      window.clearTimeout(timeout);
      if (mounted.current) setBusy(false);
      request.current = null;
    }
  };
  return (
    <Card className="p-4 space-y-3" data-testid="workspace-records">
      <h2 className="font-semibold">
        {copy(
          "Kurulmuş takımlar ve görev geçmişi",
          "Installed teams and task history",
        )}
      </h2>
      <p className="text-sm text-muted-foreground">
        {copy(
          "Salt okunur proje kayıtları. Üstteki kişisel taslağı kaydetmek bu takımları değiştirmez. Taslaktan kart kaldırmak geçmiş persona veya görev kayıtlarını silmez. Onay ve kurulum ayrı işlemlerdir.",
          "Read-only project records. Saving your personal draft above does not change these teams. Removing a draft card does not delete historical personas or tasks. Approval and installation are separate operations.",
        )}
      </p>
      <Button
        variant="outline"
        data-testid="workspace-records-load"
        disabled={disabled || busy}
        onClick={() => void load()}
      >
        {busy
          ? copy("Yükleniyor…", "Loading…")
          : copy("Kayıtları göster", "Show records")}
      </Button>
      {error && (
        <p role="alert">
          {copy(
            "Kayıtlar doğrulanamadı. Oturumu ve proje yetkinizi kontrol edin.",
            "Could not verify records. Check your session and project access.",
          )}
        </p>
      )}
      {records && (
        <div className="grid gap-4 md:grid-cols-2">
          <section className="space-y-2">
            <h3 className="font-medium">
              {copy("Kurulmuş takımlar", "Installed teams")}
            </h3>
            {!records.teams.length && (
              <p className="text-sm text-muted-foreground">
                {copy(
                  "Kurulmuş takım yok. Açık taslağınız kurulmuş takım değildir.",
                  "No installed team. Your open draft is not an installed team.",
                )}
              </p>
            )}
            {records.teams.map((team) => (
              <article key={team.id} className="rounded-md border p-3 text-sm">
                <p className="font-medium">{team.name}</p>
                <p>
                  {copy("Onaylı taslak kaydı", "Approved draft record")}{" "}
                  {team.draftId} · {team.members} {copy("üye", "members")}
                </p>
                <p>
                  {team.status === "PAUSED"
                    ? copy("Duraklatılmış", "Paused")
                    : copy("Yalnız mock çalışmaya hazır", "Mock-only ready")}
                </p>
              </article>
            ))}
          </section>
          <section className="space-y-2">
            <h3 className="font-medium">
              {copy("Görev zincirleri", "Task workflows")}
            </h3>
            {!records.workflows.length && (
              <p className="text-sm text-muted-foreground">
                {copy(
                  "Görev zinciri yok. Organizasyon taslağı otomatik görev üretmez.",
                  "No task workflows. An organization draft does not create tasks automatically.",
                )}
              </p>
            )}
            {records.workflows.map((work) => (
              <article
                key={work.actionId}
                className="rounded-md border p-3 text-sm"
              >
                <p className="font-medium">{work.name}</p>
                <p>{work.state}</p>
                <p>
                  {work.reviewed
                    ? copy("Sonuç incelenmiş", "Result reviewed")
                    : copy("Sonuç incelemesi yok", "Result not reviewed")}
                </p>
              </article>
            ))}
          </section>
        </div>
      )}
    </Card>
  );
}
