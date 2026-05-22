import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { formatDate } from "@workspace/i18n";
import { usePipelineStages } from "@/hooks/use-pipeline-stages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Upload, FileText, Trash2, Download, Plus, X,
  AlertTriangle, ChevronDown, ChevronRight, Save, Calendar, Pencil,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { validateFileObj as validateFile, sanitizeFileName, ACCEPT_ATTRIBUTE, FILE_UPLOAD_HELP_TEXT } from "@/lib/fileUploadValidation";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

import { ADMIN_ROLES as _A, STAFF_ROLES as _S, AGENT_ROLES as _AG } from "@workspace/roles";
const ADMIN_ROLES = _A;
const STAFF_ROLES = _S;
const AGENT_ROLES = _AG;

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

interface StageDocumentsPanelProps {
  applicationId: number;
  currentStage: string;
  userRole: string;
  userId?: number;
  excludeStages?: string[];
}

export function StageDocumentsPanel({ applicationId, currentStage, userRole, userId, excludeStages }: StageDocumentsPanelProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: allDocs = [] } = useQuery({
    queryKey: [`app-stage-docs-${applicationId}`],
    queryFn: () => customFetch(`${BASE_URL}/api/applications/${applicationId}/stage-documents`),
    staleTime: 15_000,
  });

  const { data: missingNotes = [] } = useQuery({
    queryKey: [`app-missing-notes-${applicationId}`],
    queryFn: () => customFetch(`${BASE_URL}/api/applications/${applicationId}/missing-doc-notes`),
    staleTime: 15_000,
  });

  const isAdmin = ADMIN_ROLES.includes(userRole);
  const isStaff = STAFF_ROLES.includes(userRole);
  const isAgent = AGENT_ROLES.includes(userRole);
  // Students and agents must NOT see future-stage upload zones.
  // Existing uploaded docs (or notes) for any stage stay visible.
  const restrictFuture = !isStaff;

  const { stages: pipelineStages } = usePipelineStages("application");
  const stageOrder = new Map<string, number>();
  pipelineStages.forEach((s, i) => stageOrder.set(s.key, s.sortOrder ?? i));
  const stageByKey = new Map(pipelineStages.map(s => [s.key, s]));
  const currentOrder = stageOrder.has(currentStage)
    ? (stageOrder.get(currentStage) as number)
    : Number.POSITIVE_INFINITY;
  function isFutureStage(stage: string): boolean {
    if (!stageOrder.has(stage)) return false;
    return (stageOrder.get(stage) as number) > currentOrder;
  }

  const docStages = pipelineStages
    .filter(s => (s.uploadPermissionLevel ?? "none") !== "none")
    .map(s => s.key);

  // Task #187 — notes can now live on any stage (the stage from which the
  // staff requested missing docs), so group them by stage instead of
  // hardcoding to "missing_docs".
  const notesByStage = new Map<string, any[]>();
  for (const n of (missingNotes as any[])) {
    const s = (n.stage as string) || "missing_docs";
    if (!notesByStage.has(s)) notesByStage.set(s, []);
    notesByStage.get(s)!.push(n);
  }

  const relevantStages = docStages.filter(stage => {
    if (excludeStages?.includes(stage)) return false;
    const docs = (allDocs as any[]).filter((d: any) => d.stage === stage && !d.isMissingDocNote);
    const notes = notesByStage.get(stage) ?? [];
    if (restrictFuture && isFutureStage(stage) && docs.length === 0 && notes.length === 0) {
      return false;
    }
    return docs.length > 0 || notes.length > 0 || stage === currentStage;
  });

  if (relevantStages.length === 0) return null;

  return (
    <div className="bg-card rounded-2xl border shadow-sm p-6 space-y-4">
      <h2 className="font-semibold text-foreground flex items-center gap-2">
        <FileText className="w-4 h-4 text-muted-foreground" />
        Stage Documents
      </h2>

      <div className="space-y-3">
        {relevantStages.map(stage => {
          const stageMeta = stageByKey.get(stage);
          return (
            <StageSection
              isAgent={isAgent}
              key={stage}
              applicationId={applicationId}
              stage={stage}
              stageLabel={stageMeta?.label || stage}
              uploadPermissionLevel={(stageMeta?.uploadPermissionLevel ?? "everyone") as string}
              tracksOfferExpiry={stageMeta?.tracksOfferExpiry === true}
              requiresValidUntilFlag={stageMeta?.requiresValidUntil === true}
              docs={(allDocs as any[]).filter((d: any) => d.stage === stage && !d.isMissingDocNote)}
              missingNotes={notesByStage.get(stage) ?? []}
              userRole={userRole}
              userId={userId}
              isAdmin={isAdmin}
              isStaff={isStaff}
              isCurrent={stage === currentStage}
              hideUpload={restrictFuture && isFutureStage(stage)}
            />
          );
        })}
      </div>
    </div>
  );
}

function StageSection({
  applicationId, stage, stageLabel, uploadPermissionLevel, tracksOfferExpiry, requiresValidUntilFlag,
  docs, missingNotes, userRole, userId, isAdmin, isStaff, isAgent, isCurrent, hideUpload,
}: {
  applicationId: number;
  stage: string;
  stageLabel: string;
  uploadPermissionLevel: string;
  tracksOfferExpiry: boolean;
  requiresValidUntilFlag: boolean;
  docs: any[];
  missingNotes: any[];
  userRole: string;
  userId?: number;
  isAdmin: boolean;
  isStaff: boolean;
  isAgent: boolean;
  isCurrent: boolean;
  hideUpload?: boolean;
}) {
  const [expanded, setExpanded] = useState(isCurrent || docs.length > 0 || missingNotes.length > 0);
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [pendingValidUntil, setPendingValidUntil] = useState<string>("");
  const [editingDocId, setEditingDocId] = useState<number | null>(null);
  const [editValidUntil, setEditValidUntil] = useState<string>("");

  const requiresValidUntil = requiresValidUntilFlag;
  const supportsValidUntil = tracksOfferExpiry;

  // Permission matrix (Task #134):
  //   admin_only         → admin / manager only (legacy default for offer stages)
  //   staff_only         → all staff (admin + staff/consultant/editor/...)
  //   staff_and_agent    → staff + agents (no students)
  //   everyone           → staff + agents + students
  const canUpload = (() => {
    if (hideUpload) return false;
    if (uploadPermissionLevel === "none") return false;
    if (uploadPermissionLevel === "admin_only") return isAdmin;
    if (uploadPermissionLevel === "staff_only") return isStaff;
    if (uploadPermissionLevel === "staff_and_agent") return isStaff || isAgent;
    if (uploadPermissionLevel === "everyone") return true;
    return false;
  })();

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const base64 = await fileToBase64(file);
      const body: any = {
        stage,
        fileName: file.name,
        fileData: base64,
        mimeType: file.type,
        sizeBytes: file.size,
      };
      if (supportsValidUntil && pendingValidUntil) body.validUntil = pendingValidUntil;
      return customFetch(`${BASE_URL}/api/applications/${applicationId}/stage-documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`app-stage-docs-${applicationId}`] });
      setPendingValidUntil("");
      toast({ title: "Document uploaded" });
    },
    onError: (err: any) => {
      toast({ title: "Upload failed", description: err?.message || "An error occurred", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ docId, validUntil }: { docId: number; validUntil: string | null }) =>
      customFetch(`${BASE_URL}/api/applications/${applicationId}/stage-documents/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ validUntil }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`app-stage-docs-${applicationId}`] });
      setEditingDocId(null);
      setEditValidUntil("");
      toast({ title: "Geçerlilik tarihi güncellendi" });
    },
    onError: (err: any) => {
      toast({ title: "Güncelleme başarısız", description: err?.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (docId: number) =>
      customFetch(`${BASE_URL}/api/applications/${applicationId}/stage-documents/${docId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`app-stage-docs-${applicationId}`] });
      toast({ title: "Document deleted" });
    },
  });

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (requiresValidUntil && !pendingValidUntil) {
      toast({ title: "Geçerlilik tarihi gerekli", description: "Lütfen önce kabul mektubunun son geçerlilik tarihini girin.", variant: "destructive" });
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    const validation = validateFile(file);
    if (!validation.valid) {
      toast({ title: "Dosya hatas\u0131", description: validation.message, variant: "destructive" });
      return;
    }
    setUploading(true);
    const safeFile = new File([file], sanitizeFileName(file.name), { type: file.type });
    await uploadMutation.mutateAsync(safeFile);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleDownload(doc: any) {
    const downloadUrl = `${BASE_URL}/api/applications/${applicationId}/stage-documents/${doc.id}/download`;
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = doc.fileName;
    a.target = "_blank";
    a.click();
  }

  const isAdminOnlyStage = uploadPermissionLevel === "admin_only";
  const isStaffOnlyStage = uploadPermissionLevel === "staff_only";

  return (
    <div className="border rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-secondary/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          <span className="text-sm font-medium">{stageLabel}</span>
          {docs.length > 0 && (
            <Badge variant="secondary" className="text-xs px-1.5 py-0">{docs.length}</Badge>
          )}
          {isCurrent && (
            <Badge className="text-xs px-1.5 py-0 bg-primary/10 text-primary border-0">Current</Badge>
          )}
          {isAdminOnlyStage && (
            <Badge variant="outline" className="text-xs px-1.5 py-0 text-rose-600 border-rose-300">Admin Upload</Badge>
          )}
          {isStaffOnlyStage && (
            <Badge variant="outline" className="text-xs px-1.5 py-0 text-amber-600 border-amber-300">Staff Upload</Badge>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {missingNotes.length > 0 && (
            <MissingDocsSection
              applicationId={applicationId}
              notes={missingNotes}
              isAdmin={isAdmin}
            />
          )}

          {docs.length > 0 ? (
            <div className="space-y-1.5">
              {docs.map((doc: any) => {
                const validUntil = doc.validUntil ? new Date(doc.validUntil) : null;
                const daysLeft = validUntil
                  ? Math.ceil((validUntil.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                  : null;
                const isEditingThis = editingDocId === doc.id;
                return (
                <div key={doc.id} className="flex items-center gap-2 p-2 rounded-lg bg-secondary/30 text-sm group">
                  <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium text-foreground">{doc.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {doc.uploadedByName || "Unknown"} · {new Date(doc.createdAt).toLocaleDateString()}
                      {doc.sizeBytes && ` · ${(doc.sizeBytes / 1024).toFixed(0)}KB`}
                    </p>
                    {validUntil && (
                      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1">
                          <Calendar className="w-3 h-3" />
                          Son geçerlilik: {formatDate(validUntil, "tr", "dateShort")}
                        </Badge>
                        {daysLeft !== null && (
                          <Badge
                            className={`text-[10px] px-1.5 py-0 border-0 ${
                              daysLeft <= 0 ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                                : daysLeft <= 7 ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                                : daysLeft <= 14 ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                                : daysLeft <= 30 ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300"
                                : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                            }`}
                          >
                            {daysLeft <= 0 ? "Süresi doldu" : `${daysLeft} gün kaldı`}
                          </Badge>
                        )}
                      </div>
                    )}
                    {isEditingThis && (
                      <div className="mt-2 flex items-center gap-1.5">
                        <Input
                          type="date"
                          value={editValidUntil}
                          onChange={e => setEditValidUntil(e.target.value)}
                          className="h-7 text-xs w-40"
                        />
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => updateMutation.mutate({ docId: doc.id, validUntil: editValidUntil || null })}
                          disabled={updateMutation.isPending}
                        >
                          Kaydet
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => { setEditingDocId(null); setEditValidUntil(""); }}
                        >
                          İptal
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {supportsValidUntil && isAdmin && !isEditingThis && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => {
                          setEditingDocId(doc.id);
                          setEditValidUntil(validUntil ? validUntil.toISOString().slice(0, 10) : "");
                        }}
                        title="Geçerlilik tarihini düzenle"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleDownload(doc)}
                      title="Download"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </Button>
                    {(isAdmin || (userId && doc.uploadedBy === userId)) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => deleteMutation.mutate(doc.id)}
                        disabled={deleteMutation.isPending}
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              );})}
            </div>
          ) : (
            stage !== "missing_docs" && (
              <p className="text-xs text-muted-foreground py-1">No documents uploaded for this stage yet.</p>
            )
          )}

          {canUpload && (
            <div className="pt-1 space-y-1">
              {supportsValidUntil && (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    Son geçerlilik tarihi{requiresValidUntil ? " *" : ""}:
                  </label>
                  <Input
                    type="date"
                    value={pendingValidUntil}
                    onChange={e => setPendingValidUntil(e.target.value)}
                    className="h-7 text-xs flex-1"
                  />
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={handleFileSelect}
                accept={ACCEPT_ATTRIBUTE}
              />
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs w-full"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                <Upload className="w-3.5 h-3.5" />
                {uploading ? "Uploading..." : "Upload Document"}
              </Button>
              <p className="text-[10px] text-muted-foreground text-center">{FILE_UPLOAD_HELP_TEXT}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MissingDocsSection({
  applicationId, notes, isAdmin,
}: {
  applicationId: number;
  notes: any[];
  isAdmin: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  function humanize(s: string) {
    return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  async function toggleFulfilled(noteId: number, fulfilled: boolean) {
    try {
      await customFetch(`${BASE_URL}/api/applications/${applicationId}/missing-doc-notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fulfilled }),
      });
      qc.invalidateQueries({ queryKey: [`app-missing-notes-${applicationId}`] });
      toast({ title: fulfilled ? "Talep kapatıldı" : "Talep tekrar açıldı" });
    } catch (err: any) {
      toast({ title: "Hata", description: err?.message, variant: "destructive" });
    }
  }

  async function removeNote(noteId: number) {
    if (!window.confirm("Bu belge talebini silmek istediğinize emin misiniz?")) return;
    try {
      await customFetch(`${BASE_URL}/api/applications/${applicationId}/missing-doc-notes/${noteId}`, {
        method: "DELETE",
      });
      qc.invalidateQueries({ queryKey: [`app-missing-notes-${applicationId}`] });
    } catch (err: any) {
      toast({ title: "Silme başarısız", description: err?.message, variant: "destructive" });
    }
  }

  if (notes.length === 0) {
    return (
      <div className="border rounded-lg p-2.5 bg-amber-50/50 dark:bg-amber-950/20">
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
          <span className="text-xs font-medium text-amber-700 dark:text-amber-400">Eksik Belgeler</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">Açık eksik belge talebi yok.</p>
      </div>
    );
  }

  return (
    <div className="border rounded-lg p-2.5 bg-amber-50/50 dark:bg-amber-950/20 space-y-2">
      <div className="flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
        <span className="text-xs font-medium text-amber-700 dark:text-amber-400">Eksik Belgeler</span>
      </div>
      <ul className="space-y-1.5">
        {notes.map((note: any) => {
          const fulfilled = !!note.fulfilledAt;
          return (
            <li key={note.id} className="rounded-md border bg-background/60 px-2 py-1.5 text-xs">
              <div className="flex items-start gap-2">
                <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${fulfilled ? "bg-emerald-500" : "bg-amber-500"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`font-medium ${fulfilled ? "line-through text-muted-foreground" : ""}`}>
                      {note.isCustom ? note.fileName : humanize(note.fileName)}
                    </span>
                    <Badge variant={note.isCustom ? "secondary" : "outline"} className="text-[9px] h-4 px-1">
                      {note.isCustom ? "Özel" : "Katalog"}
                    </Badge>
                    {fulfilled && (
                      <Badge variant="outline" className="text-[9px] h-4 px-1 border-emerald-400 text-emerald-700">
                        Tamamlandı
                      </Badge>
                    )}
                  </div>
                  {note.note && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">{note.note}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Talep tarihi: {note.createdAt ? new Date(note.createdAt).toLocaleDateString() : "—"}
                    {note.uploadedByName ? ` · Talep eden: ${note.uploadedByName}` : ""}
                    {fulfilled && note.fulfilledAt
                      ? ` · Tamamlandı: ${new Date(note.fulfilledAt).toLocaleDateString()}`
                      : ""}
                  </p>
                </div>
                {isAdmin && (
                  <div className="flex gap-0.5 shrink-0">
                    <Button
                      variant="ghost" size="icon" className="h-6 w-6"
                      title={fulfilled ? "Tekrar aç" : "Tamamlandı işaretle"}
                      onClick={() => toggleFulfilled(note.id, !fulfilled)}
                    >
                      <Save className={`w-3 h-3 ${fulfilled ? "text-emerald-600" : ""}`} />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6" title="Sil" onClick={() => removeNote(note.id)}>
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </Button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
