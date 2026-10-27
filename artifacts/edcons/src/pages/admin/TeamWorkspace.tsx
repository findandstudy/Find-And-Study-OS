import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/hooks/use-i18n";
import TeamDesigner, { type TeamDesignerValue } from "./TeamDesigner";
import TeamWorkspaceTasks from "./TeamWorkspaceTasks";
import {
  applyWorkspaceCommand,
  draftTeamCommand,
  parseWorkspaceContext,
  parseWorkspaceResponse,
  parseTeamSubmission,
  workspaceApiPath,
  workspaceFromTemplate,
  workspaceRequest,
  workspaceSignature,
  workspaceWriteBody,
  workspaceTaskPath,
  WorkspaceRequestError,
  type TeamCommandDraft,
  type WorkspaceValue,
} from "@/lib/personaTeamWorkspace";
import { isPersonaWorkspaceLocation } from "@/lib/personaWorkspaceNavigation";

/** UI discovery is not authority. Every read/write must independently pass the
 * existing server-side project, HUMAN capability and real cookie session gates. */
const availableLocation = () =>
  isPersonaWorkspaceLocation(window.location.protocol, window.location.hostname);

export default function TeamWorkspace({ project }: { project?: string }) {
  const { lang } = useI18n();
  const copy = (tr: string, en: string) => (lang === "tr" ? tr : en);
  let path: string | null = null;
  try {
    if (project) path = workspaceApiPath(project);
  } catch {
    /* no request for invalid identity */
  }
  if (!availableLocation())
    return (
      <Card className="p-6" role="alert">
        {copy(
          "Bu çalışma alanı yalnız deneme ortamında kullanılabilir.",
          "This workspace is available only in the test environment.",
        )}
      </Card>
    );
  if (!path || !project) {
    return (
      <Card className="p-6 space-y-4">
        <h1 className="text-xl font-semibold">
          {copy("Takım çalışma alanı", "Team workspace")}
        </h1>
        <p>
          {copy(
            "Geçerli bir proje seçmek için çalışma alanları listesine dönün.",
            "Return to the workspace list to select an available project.",
          )}
        </p>
        <Button asChild>
          <Link href="/admin/agent-team-workspace">{copy("Projeleri göster", "View projects")}</Link>
        </Button>
      </Card>
    );
  }
  return <LoadedWorkspace key={project} project={project} path={path} />;
}

function LoadedWorkspace({ project, path }: { project: string; path: string }) {
  const { lang } = useI18n();
  const copy = (tr: string, en: string) => (lang === "tr" ? tr : en);
  const [phase, setPhase] = useState<
    "loading" | "ready" | "saving" | "locked" | "error"
  >("loading");
  const [seed, setSeed] = useState<WorkspaceValue | null>(null);
  const [value, setValue] = useState<WorkspaceValue | null>(null);
  const valueRef = useRef<WorkspaceValue | null>(null);
  const [baseline, setBaseline] = useState("");
  const [revision, setRevision] = useState(0);
  const [editorVersion, setEditorVersion] = useState(0);
  const [projectLabel, setProjectLabel] = useState("");
  const [status, setStatus] = useState("");
  const [command, setCommand] = useState("");
  const [proposal, setProposal] = useState<TeamCommandDraft | null>(null);
  const [pendingFields, setPendingFields] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [recordsVersion, setRecordsVersion] = useState(0);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const dirty = Boolean(value && workspaceSignature(value) !== baseline);
  const ready = phase === "ready" && !submitting;

  useEffect(() => {
    if (!dirty && !pendingFields) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, pendingFields]);

  const replaceEditor = (next: WorkspaceValue) => {
    valueRef.current = next;
    setValue(next);
    setSeed(next);
    setEditorVersion((n) => n + 1);
    setPendingFields(false);
    setProposal(null);
  };
  const onChange = useCallback((next: TeamDesignerValue) => {
    valueRef.current = next;
    setValue(next);
  }, []);
  const load = async () => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    setPhase("loading");
    try {
      const [rawContext, rawWorkspace] = await Promise.all([
        workspaceRequest(path.replace(/team-workspace$/, "context"), {
          signal: controller.signal,
        }),
        workspaceRequest(path, { signal: controller.signal }),
      ]);
      const context = parseWorkspaceContext(rawContext, project);
      const workspace = parseWorkspaceResponse(rawWorkspace);
      if (!mounted.current || controller.signal.aborted) return;
      const next = workspace ?? workspaceFromTemplate(context.template);
      replaceEditor({ document: next.document, layout: next.layout });
      setProjectLabel(context.project.label);
      setRevision(workspace?.revision ?? 0);
      setBaseline(workspace ? workspaceSignature(workspace) : "");
      setStatus(
        workspace
          ? copy(
              `Sunucudaki taslak yüklendi · sürüm ${workspace.revision}. Onay veya etkinleştirme değildir.`,
              `Server draft loaded · revision ${workspace.revision}. This is not approval or activation.`,
            )
          : copy(
              "Yeni çalışma taslağı. Henüz sunucuya kaydedilmedi.",
              "New workspace draft. Not yet saved to the server.",
            ),
      );
      setPhase("ready");
    } catch {
      if (!mounted.current) return;
      setPhase("error");
      setStatus(
        copy(
          "Proje veya oturum doğrulanamadı; çalışma alanı açılmadı. Mevcut açık taslak korunuyor. Oturumu ve proje yetkinizi kontrol edip tekrar yükleyin.",
          "The project or session could not be verified; editing is closed. Any open draft is preserved. Check your session and project access, then reload.",
        ),
      );
    } finally {
      window.clearTimeout(timeout);
      active.current = null;
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      active.current?.abort();
      active.current = null;
    };
  }, [path]);
  const reload = () => {
    if (
      (dirty || pendingFields) &&
      !window.confirm(
        copy(
          "Açık değişiklikler sunucudaki kayıtla değiştirilecek. Devam edilsin mi?",
          "Replace your open changes with the server copy?",
        ),
      )
    )
      return;
    void load();
  };
  const save = async () => {
    if (!ready || !valueRef.current || pendingFields || active.current) return;
    let body;
    try {
      body = workspaceWriteBody(revision, valueRef.current);
    } catch {
      setStatus(
        copy(
          "Taslak kaydedilemedi. Alanları ve belge boyutunu kontrol edin.",
          "Could not save the draft. Check its fields and size.",
        ),
      );
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    setPhase("saving");
    try {
      const raw = await workspaceRequest(path, {
        body,
        signal: controller.signal,
      });
      const saved = parseWorkspaceResponse(raw, true)!;
      if (saved.revision !== revision + 1)
        throw Error("PERSONA_WORKSPACE_REVISION_INVALID");
      if (workspaceSignature(saved) !== workspaceSignature(body))
        throw Error("PERSONA_WORKSPACE_WRITE_MISMATCH");
      if (!mounted.current) return;
      setBaseline(workspaceSignature(saved));
      setRevision(saved.revision);
      setPhase("ready");
      setStatus(
        copy(
          `Kaydedildi · sürüm ${saved.revision}. Yalnız taslak ve yerleşim saklandı; onay, kurulum veya çalıştırma yok.`,
          `Saved · revision ${saved.revision}. Only draft and layout were stored; no approval, installation or execution.`,
        ),
      );
    } catch (error) {
      if (!mounted.current) return;
      setPhase("locked");
      setStatus(
        error instanceof WorkspaceRequestError &&
          error.code === "PERSONA_WORKSPACE_CONFLICT"
          ? copy(
              "Başka sekmede daha yeni kayıt var. Üzerine yazılmadı. Açık taslağınız korundu; sunucudaki sürümü yüklemeden yeniden kayıt yapılamaz.",
              "A newer revision exists in another tab. It was not overwritten. Your draft is preserved; reload the server copy before saving again.",
            )
          : copy(
              "Kayıt sonucu doğrulanamadı. İşlem sunucuda tamamlanmış olabilir. Açık taslağınız korundu; otomatik veya kör tekrar yapılmaz. Sunucudaki sürümü yükleyin.",
              "The save result could not be verified; it may have completed on the server. Your draft is preserved. No automatic or blind retry. Reload the server copy.",
            ),
      );
    } finally {
      window.clearTimeout(timeout);
      active.current = null;
    }
  };
  const previewCommand = () => {
    if (!value || !ready || pendingFields) return;
    try {
      setProposal(draftTeamCommand(value.document, command));
      setStatus(
        copy(
          "Öneri hazır. Önce değişiklikleri inceleyin; henüz taslak veya sunucu değişmedi.",
          "Proposal ready. Review the changes first; neither the draft nor the server has changed.",
        ),
      );
    } catch (error) {
      setProposal(null);
      setStatus(
        error instanceof Error &&
          error.message === "PERSONA_COMMAND_DEPARTMENT_EXISTS"
          ? copy(
              "Sosyal medya birimi zaten var. Mevcut kartlardan üyelerini ve talimatlarını düzenleyebilirsiniz.",
              "A social media department already exists. Edit its members and instructions using their cards.",
            )
          : copy(
              "Komut anlaşılamadı veya takım sınırını aşıyor. Desteklenen örnek: Sosyal medya birimi kur. Hiçbir değişiklik yapılmadı.",
              "Command unsupported or team limit exceeded. Supported example: Create social media team. No changes were made.",
            ),
      );
    }
  };
  const submitTeam = async () => {
    if (!ready || !valueRef.current || pendingFields || dirty || revision === 0 || active.current) return;
    const document = valueRef.current.document;
    const controller = new AbortController();
    active.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    setSubmitting(true);
    try {
      parseTeamSubmission(await workspaceRequest(workspaceTaskPath(path, "/team-drafts"), {
        body: { document }, signal: controller.signal,
      }), document);
      if (!mounted.current) return;
      setRecordsVersion((version) => version + 1);
      setStatus(copy(
        "Takım onaya gönderildi. Diğer yönetici aşağıdaki Takım sürümleri bölümünden içeriği inceleyip onaylayabilir. Kurulum ayrıca yapılır; takım duraklatılmış başlar.",
        "Team submitted for approval. Another administrator can review and approve it under Team versions below. Installation is separate and starts paused.",
      ));
    } catch {
      if (!mounted.current) return;
      setPhase("locked");
      setStatus(copy(
        "Onaya gönderim sonucu doğrulanamadı. İşlem tamamlanmış olabilir; tekrar gönderilmedi. Sunucudaki sürümü ve takım sürümleri listesini yenileyerek sonucu kontrol edin.",
        "Could not verify submission; it may have completed. It was not retried. Reload the server copy and team versions to check the outcome.",
      ));
    } finally {
      window.clearTimeout(timeout);
      active.current = null;
      if (mounted.current) setSubmitting(false);
    }
  };
  const applyCommand = () => {
    if (!proposal || !value || !ready || pendingFields) return;
    try {
      replaceEditor(applyWorkspaceCommand(value, proposal));
      setStatus(
        copy(
          "Öneri yalnız açık taslağa uygulandı. Sunucuda saklamak için Kaydet'e basın.",
          "Proposal applied only to the open draft. Press Save to persist it.",
        ),
      );
    } catch {
      setProposal(null);
      setStatus(
        copy(
          "Taslak değişti; komutu yeniden incelemeye hazırlayın.",
          "The draft changed; prepare the command for review again.",
        ),
      );
    }
  };
  const staleProposal =
    proposal &&
    value &&
    JSON.stringify(proposal.before) !== JSON.stringify(value.document);
  return (
    <div data-testid="team-workspace" className="space-y-4 p-3 md:p-6">
      <Card className="p-4 space-y-3">
        <h1 className="text-lg font-semibold">
          {copy("Takım çalışma alanı", "Team workspace")}
          {projectLabel ? ` · ${projectLabel}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">
          {copy(
            "Takım yapısını bu projeye kaydedebilir, görevleri hazırlayıp ayrı bir yöneticinin onayına sunabilirsiniz. Görevler deneme verileriyle çalışır; dışarıya mesaj veya yayın gönderilmez.",
            "Save your team in this project, prepare tasks and submit them for another administrator's approval. Tasks use test data; no external messages or publications are sent.",
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            data-testid="workspace-save"
            onClick={() => void save()}
            disabled={!ready || !dirty || pendingFields}
          >
            {copy(
              phase === "saving" ? "Kaydediliyor…" : "Kaydet",
              phase === "saving" ? "Saving…" : "Save",
            )}
          </Button>
          <Button
            data-testid="workspace-submit-team"
            variant="secondary"
            onClick={() => void submitTeam()}
            disabled={!ready || dirty || pendingFields || revision === 0}
          >
            {submitting ? copy("Gönderiliyor…", "Submitting…") : copy("Takımı onaya gönder", "Submit team for approval")}
          </Button>
          <Button
            data-testid="workspace-reload"
            variant="outline"
            disabled={phase === "loading" || phase === "saving" || submitting}
            onClick={reload}
          >
            {copy("Sunucudaki sürümü yükle", "Reload server copy")}
          </Button>
          <span className="self-center text-xs text-muted-foreground">
            {dirty || pendingFields
              ? copy("Kaydedilmemiş değişiklikler", "Unsaved changes")
              : copy("Kayıtla aynı", "Matches saved copy")}
          </span>
        </div>
        <p className="text-sm text-muted-foreground" data-testid="workspace-first-team-help">
          {copy(
            "İlk takım için şemaya birim ve uzman ekleyin, Kaydet'e basın, ardından Takımı onaya gönder'i seçin. Diğer yönetici aynı projeyi açıp kayıtlı sürümü inceleyebilir, onaylayabilir ve kurabilir. Taslağı kaydetmek tek başına takım kurmaz.",
            "For your first team, add departments and specialists, save, then submit the team for approval. Another administrator can open this project, review the saved version, approve and install it. Saving alone does not install a team.",
          )}
        </p>
        <p
          data-testid="workspace-status"
          role="status"
          aria-live="polite"
          className="text-sm"
        >
          {phase === "loading"
            ? copy(
                "Proje ve oturum doğrulanıyor…",
                "Checking project and session…",
              )
            : status}
        </p>
        {pendingFields && (
          <p className="text-sm">
            {copy(
              "Önce karttaki Uygula düğmesiyle alanları taslağa aktarın.",
              "Use Apply changes in the member card before saving.",
            )}
          </p>
        )}
      </Card>
      {seed && (
        <>
          <fieldset
            disabled={!ready}
            style={
              !ready ? { pointerEvents: "none", opacity: 0.65 } : undefined
            }
          >
            <TeamDesigner
              key={editorVersion}
              initialState={seed}
              disabled={!ready}
              onChange={onChange}
              onPendingChange={setPendingFields}
            />
          </fieldset>
          <Card className="p-4 space-y-3">
            <h2 className="font-semibold">
              {copy("Metinle taslak önerisi", "Text draft proposal")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {copy(
                "Bu bir AI sohbeti değildir. Yalnız tanımlı komutlardan incelenebilir bir taslak önerisi hazırlar. Örnek: Sosyal medya birimi kur. Mevcut birim varsa kopyasını oluşturmaz.",
                "This is not an AI chat. Known commands prepare a reviewable draft proposal. Example: Create social media team. An existing department will not be duplicated.",
              )}
            </p>
            <Label htmlFor="workspace-command">
              {copy("Komut", "Command")}
            </Label>
            <Textarea
              id="workspace-command"
              data-testid="workspace-command"
              value={command}
              onChange={(event) => {
                setCommand(event.target.value);
                setProposal(null);
              }}
              maxLength={500}
              disabled={!ready}
            />
            <Button
              data-testid="workspace-command-preview"
              variant="outline"
              disabled={!ready || !command.trim() || pendingFields}
              onClick={previewCommand}
            >
              {copy("Öneriyi incele", "Review proposal")}
            </Button>
            {proposal && (
              <div
                data-testid="workspace-command-diff"
                className="rounded-md border p-3 space-y-3"
              >
                <p>
                  {copy(
                    `Önce ${proposal.before.members.length} üye → sonra ${proposal.after.members.length} üye. Mevcut üyeler korunur.`,
                    `Before ${proposal.before.members.length} members → after ${proposal.after.members.length} members. Existing members are preserved.`,
                  )}
                </p>
                <ul className="space-y-2">
                  {proposal.changes.map((item) => {
                    const member = proposal.after.members.find(
                      (row) => row.key === item.key,
                    )!;
                    return (
                      <li key={item.key} className="text-sm">
                        <strong>+ {item.name}</strong> · {item.parent}
                        <p>{member.purpose}</p>
                        <p>
                          {copy("Çıktı: ", "Output: ")}
                          {member.output}
                        </p>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-xs text-muted-foreground">
                  {copy(
                    "Bu bir deneme taslağıdır. Takım yapısını uygulamak, görevleri çalıştırmaz.",
                    "This is a test draft. Applying the team structure does not run tasks.",
                  )}
                </p>
                <Button
                  data-testid="workspace-command-apply"
                  disabled={!ready || Boolean(staleProposal) || pendingFields}
                  onClick={applyCommand}
                >
                  {copy("Öneriyi taslağa uygula", "Apply proposal to draft")}
                </Button>
                {staleProposal && (
                  <p>
                    {copy(
                      "Taslak değişti. Öneriyi yeniden hazırlayın.",
                      "The draft changed. Prepare a new proposal.",
                    )}
                  </p>
                )}
              </div>
            )}
          </Card>
          <TeamWorkspaceTasks path={path} disabled={!ready} refreshVersion={recordsVersion} />
        </>
      )}
    </div>
  );
}
