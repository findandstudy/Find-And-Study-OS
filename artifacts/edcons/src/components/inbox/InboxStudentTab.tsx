import { useState, useEffect, useMemo, useRef } from "react";
import { toLatinUpper, transliterateToLatin } from "@/lib/latin-utils";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useStudyLevels } from "@/hooks/useStudyLevels";
import { useI18n } from "@/hooks/use-i18n";
import { useToast } from "@/hooks/use-toast";
import type { InboxConversationDetailResponse } from "@workspace/api-client-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Loader2,
  FileText,
  GraduationCap,
  ScrollText,
  Shield,
  Camera,
  CheckCircle2,
  Circle,
  Paperclip,
  X as XIcon,
} from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChatAttachment {
  msgId: number;
  attachIdx: number;
  url: string;
  name: string;
  isImage: boolean;
}

interface DocReq {
  documentType: string;
  mandatory: boolean;
  sortOrder: number;
  label?: string;
  source?: string;
}

interface EffectiveDocReqsResponse {
  programId: number | null;
  level: string | null;
  programSpecific: boolean;
  requirements: DocReq[];
}

// ── Icon map ──────────────────────────────────────────────────────────────────

const DOC_ICONS: Record<string, typeof FileText> = {
  diploma: GraduationCap,
  transcript: ScrollText,
  passport: Shield,
  photograph: Camera,
};

function getDocIcon(key: string): typeof FileText {
  return DOC_ICONS[key.toLowerCase()] ?? FileText;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MIME_EXT_MAP: Record<string, string> = {
  "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png",
  "image/webp": "webp", "video/mp4": "mp4", "audio/ogg": "ogg", "audio/mpeg": "mp3",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

// Same attachment name-resolution chain as the chat bubbles in Messages.tsx:
// explicit name/fileName → WhatsApp raw filename → URL basename → localized
// type label + mime extension. Never a bare "file".
function resolveAttachmentName(
  a: any,
  i: number,
  meta: Record<string, any>,
  url: string,
  t: (k: string) => string,
): string {
  const rawMeta = meta?.raw;
  const waRawType = rawMeta?.type;
  const waMedia = waRawType ? (rawMeta[waRawType] as any) : null;
  const waFilename = i === 0 ? (waMedia?.filename ?? waMedia?.file_name ?? null) : null;
  const nameFromUrl = (() => {
    try {
      const seg = new URL(String(url)).pathname.split("/").pop() ?? "";
      return seg.includes(".") ? decodeURIComponent(seg) : null;
    } catch { return null; }
  })();
  const mm = String(a?.mimeType ?? a?.mime_type ?? a?.fileType ?? "").split(";")[0].trim().toLowerCase();
  const mimeExt = MIME_EXT_MAP[mm] ?? null;
  const type = a?.type ?? a?.fileType ?? "file";
  const attTypeLabel = type === "image" ? t("inbox.attachment.photo")
    : type === "video" ? t("inbox.attachment.video")
    : type === "audio" ? t("inbox.attachment.audio")
    : t("inbox.attachment.document");
  const typedName = mimeExt ? `${attTypeLabel}.${mimeExt}` : attTypeLabel;
  const explicitName = [a?.name, a?.fileName, waFilename, nameFromUrl].find(
    (v) => typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "file",
  ) as string | undefined;
  return explicitName ?? typedName;
}

function extractChatAttachments(messages: any[], t: (k: string) => string): ChatAttachment[] {
  const result: ChatAttachment[] = [];
  for (const msg of messages ?? []) {
    const meta = (msg?.metadata ?? {}) as Record<string, any>;
    const atts: any[] = [
      ...(meta.attachment && typeof meta.attachment === "object" ? [meta.attachment] : []),
      ...(Array.isArray(meta.attachments) ? meta.attachments : []),
    ];
    atts.forEach((a, idx) => {
      const url = String(a?.url ?? a?.fileUrl ?? "").trim();
      if (!url) return;
      const name = resolveAttachmentName(a, idx, meta, url, t);
      const mime = String(a?.mimeType ?? a?.mime_type ?? a?.type ?? "").toLowerCase();
      const isImage =
        mime.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
      result.push({ msgId: msg.id, attachIdx: idx, url, name, isImage });
    });
  }
  return result;
}

function isMasterOrHigher(levelKey: string): boolean {
  const k = levelKey.toLowerCase();
  return (
    k.includes("master") ||
    k.includes("phd") ||
    k.includes("doctor") ||
    k.includes("mba")
  );
}

function isDoctorate(levelKey: string): boolean {
  const k = levelKey.toLowerCase();
  return k.includes("phd") || k.includes("doctor");
}

// ── Student form initial state ────────────────────────────────────────────────

const EMPTY_STUDENT_FORM = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  gender: "",
  motherName: "",
  fatherName: "",
  nationality: "",
  dateOfBirth: "",
  address: "",
  passportNumber: "",
  passportIssueDate: "",
  passportExpiry: "",
  school1: "",
  school2: "",
  graduationYear: "",
  gpa: "",
  gradingSystem: "4",
  languageScore: "",
  notes: "",
};

// ── SubmitReadyData ───────────────────────────────────────────────────────────

export interface SubmitReadyData {
  form: typeof EMPTY_STUDENT_FORM;
  staging: Record<string, ChatAttachment>;
  aiFields: Set<string>;
  selectedLevel: string;
}

// ── Main component ────────────────────────────────────────────────────────────

interface InboxStudentTabProps {
  detail: InboxConversationDetailResponse;
  conversationId: number;
  programId?: number | null;
  programName?: string | null;
  onUpdated?: () => void;
  onReadyToSubmit?: (data: SubmitReadyData) => void;
}

export function InboxStudentTab({
  detail,
  conversationId,
  programId,
  programName,
  onUpdated,
  onReadyToSubmit,
}: InboxStudentTabProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const { levels, isLoading: levelsLoading } = useStudyLevels();

  // ── State ──────────────────────────────────────────────────────────────────
  const [selectedLevel, setSelectedLevel] = useState<string>("");
  // staging: docType → ChatAttachment
  const [staging, setStaging] = useState<Record<string, ChatAttachment>>({});
  // dialog: pick doc type for an attachment
  const [addingAtt, setAddingAtt] = useState<ChatAttachment | null>(null);
  // dialog: conflict when slot already filled
  const [conflictState, setConflictState] = useState<{
    docType: string;
    incomingAtt: ChatAttachment;
  } | null>(null);
  // extracting state for analyze button
  const [extracting, setExtracting] = useState(false);

  // ── Backend docs — pre-populate staging for persistence across reloads ───────
  const leadId = (detail as any).lead?.id as number | undefined;
  const studentId = (detail as any).student?.id as number | undefined;
  const ownerKey = leadId ? `lead:${leadId}` : studentId ? `student:${studentId}` : null;
  const docsEndpoint = leadId
    ? `${BASE_URL}/api/leads/${leadId}/documents`
    : studentId
    ? `${BASE_URL}/api/students/${studentId}/documents`
    : null;

  const { data: backendDocs = [] } = useQuery<Array<{ type: string; sourceAttachmentId?: string | null }>>({
    queryKey: ["inbox-staging-docs", ownerKey],
    queryFn: () =>
      fetch(docsEndpoint!, { credentials: "include" }).then((r) =>
        r.ok ? r.json() : []
      ),
    enabled: !!docsEndpoint,
    staleTime: 30_000,
  });

  const initializedOwnerRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ownerKey || backendDocs.length === 0) return;
    if (initializedOwnerRef.current === ownerKey) return;
    initializedOwnerRef.current = ownerKey;

    const allAtts = extractChatAttachments((detail as any).messages ?? [], t);
    const attMap = new Map<string, ChatAttachment>();
    for (const att of allAtts) {
      attMap.set(`${att.msgId}:${att.attachIdx}`, att);
    }

    setStaging((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const doc of backendDocs) {
        if (!doc.sourceAttachmentId || !doc.type) continue;
        if (next[doc.type]) continue;
        const att = attMap.get(doc.sourceAttachmentId);
        if (!att) continue;
        next[doc.type] = att;
        changed = true;
      }
      return changed ? next : prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerKey, backendDocs]);

  // ── Default level to Bachelor when levels load ─────────────────────────────
  useEffect(() => {
    if (levels.length > 0 && !selectedLevel) {
      const bach =
        levels.find((l) => l.key.toLowerCase().includes("bachelor")) ??
        levels[0];
      setSelectedLevel(bach.key);
    }
  }, [levels, selectedLevel]);

  // ── Effective doc requirements (merged program + degree — the SAME set the
  // POST /applications mandatory-doc gate enforces). Falls back to level-only
  // when no program is selected yet.
  const { data: effReqs, isLoading: docReqsLoading } = useQuery<EffectiveDocReqsResponse>({
    queryKey: ["effective-doc-reqs", programId ?? null, selectedLevel],
    queryFn: () => {
      const params = new URLSearchParams();
      if (programId) params.set("programId", String(programId));
      if (selectedLevel) params.set("level", selectedLevel);
      return fetch(`${BASE_URL}/api/document-requirements/effective?${params.toString()}`, {
        credentials: "include",
      }).then((r) =>
        r.ok ? r.json() : { programId: null, level: null, programSpecific: false, requirements: [] }
      );
    },
    enabled: !!selectedLevel || !!programId,
    staleTime: 30_000,
  });
  const docReqs: DocReq[] = effReqs?.requirements ?? [];

  // ── Chat attachments from conversation messages ────────────────────────────
  const attachments = useMemo(
    () => extractChatAttachments((detail as any).messages ?? [], t),
    [detail, t]
  );

  const sortedDocReqs = useMemo(
    () => [...docReqs].sort((a, b) => a.sortOrder - b.sortOrder),
    [docReqs]
  );

  const stagedCount = Object.keys(staging).length;

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleAddClick(att: ChatAttachment) {
    if (!selectedLevel) {
      toast({
        title: t("inbox.studentTab.selectLevelFirst"),
        variant: "destructive",
      });
      return;
    }
    if (sortedDocReqs.length === 0) {
      toast({
        title: t("inbox.studentTab.noDocReqs"),
        variant: "destructive",
      });
      return;
    }
    setAddingAtt(att);
  }

  function handleDocTypePick(docType: string) {
    if (!addingAtt) return;
    const incoming = addingAtt;
    setAddingAtt(null);
    if (staging[docType]) {
      setConflictState({ docType, incomingAtt: incoming });
      return;
    }
    setStaging((prev) => ({ ...prev, [docType]: incoming }));
  }

  function handleConflictReplace() {
    if (!conflictState) return;
    setStaging((prev) => ({
      ...prev,
      [conflictState.docType]: conflictState.incomingAtt,
    }));
    setConflictState(null);
  }

  function handleRemoveStaged(docType: string) {
    setStaging((prev) => {
      const next = { ...prev };
      delete next[docType];
      return next;
    });
  }

  async function handleAnalyzeAndCreate() {
    if (stagedCount === 0) {
      toast({
        title: t("inbox.studentTab.noDocsToAnalyze"),
        variant: "destructive",
      });
      return;
    }
    setExtracting(true);

    const extracted: Record<string, string> = {};
    const extractedFieldsSet = new Set<string>();

    for (const [docType, att] of Object.entries(staging)) {
      try {
        const res = (await customFetch(
          `/api/inbox/conversations/${conversationId}/messages/${att.msgId}/attachments/${att.attachIdx}/extract-for-student`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ docType }),
          }
        )) as any;
        const data = (res?.extracted ?? {}) as Record<string, any>;
        const FIELDS = [
          "firstName",
          "lastName",
          "email",
          "phone",
          "nationality",
          "dateOfBirth",
          "passportNumber",
          "passportExpiry",
          "motherName",
          "fatherName",
          "highSchool",
          "gpa",
        ];
        for (const fk of FIELDS) {
          const val = data[fk];
          if (val !== null && val !== undefined && val !== "") {
            extracted[fk] = String(val);
            extractedFieldsSet.add(fk);
          }
        }
      } catch {
        /* extraction failed for this doc — continue with others */
      }
    }

    const ext = (detail as any).externalContact ?? null;
    const conv = (detail as any).conversation ?? null;
    const displayName = (ext?.displayName || conv?.title || "").trim();
    const parts = displayName.split(/\s+/).filter(Boolean);

    const gpaRaw = extracted.gpa ?? "";
    const gpaMatch = gpaRaw.match(/^([\d.]+)\s*\/\s*\d+$/);
    const gpaNorm = gpaMatch ? gpaMatch[1] : gpaRaw;

    setExtracting(false);
    onReadyToSubmit?.({
      form: {
        firstName: toLatinUpper(extracted.firstName || parts[0] || ""),
        lastName: toLatinUpper(extracted.lastName || parts.slice(1).join(" ") || ""),
        email: extracted.email || String(ext?.email ?? ""),
        phone: extracted.phone || String(ext?.phone ?? ""),
        gender: "",
        motherName: toLatinUpper(extracted.motherName || ""),
        fatherName: toLatinUpper(extracted.fatherName || ""),
        nationality: extracted.nationality || "",
        dateOfBirth: extracted.dateOfBirth || "",
        address: transliterateToLatin(extracted.address || "").toUpperCase(),
        passportNumber: extracted.passportNumber || "",
        passportIssueDate: (extracted as any).passportIssueDate || "",
        passportExpiry: extracted.passportExpiry || "",
        school1: transliterateToLatin(extracted.highSchool || "").toUpperCase(),
        school2: "",
        graduationYear: (extracted as any).graduationYear != null
          ? String((extracted as any).graduationYear)
          : "",
        gpa: gpaNorm,
        gradingSystem: "4",
        languageScore: "",
        notes: "",
      },
      staging,
      aiFields: extractedFieldsSet,
      selectedLevel,
    });
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const isHigherLevel = isMasterOrHigher(selectedLevel);
  const isPhd = isDoctorate(selectedLevel);

  const docLabel = (docType: string) => {
    const fromBackend = docReqs.find(
      (r) => r.documentType.toLowerCase() === docType.toLowerCase()
    )?.label;
    if (fromBackend) return fromBackend;
    const k = `docTypes.${docType.toLowerCase()}`;
    const v = t(k);
    return v !== k ? v : docType;
  };

  const school1Label = isHigherLevel
    ? t("inbox.studentTab.bachelorUni")
    : t("inbox.studentTab.highSchool");
  const school1Placeholder = isHigherLevel
    ? t("inbox.studentTab.bachelorUniPlaceholder")
    : t("inbox.studentTab.highSchoolPlaceholder");

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Level selector */}
      <div className="px-3 pt-3 pb-2.5 border-b shrink-0">
        <div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1.5">
          {t("inbox.studentTab.level")}
        </div>
        {levelsLoading ? (
          <div className="h-8 flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground">…</span>
          </div>
        ) : (
          <Select value={selectedLevel} onValueChange={setSelectedLevel}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder={t("inbox.studentTab.selectLevel")} />
            </SelectTrigger>
            <SelectContent>
              {levels.map((l) => (
                <SelectItem key={l.key} value={l.key}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Scrollable middle */}
      <div className="flex-1 overflow-y-auto">
        {/* Required doc slots */}
        {selectedLevel ? (
          <div className="px-3 pt-3 pb-2 space-y-1">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-2">
              {t("inbox.studentTab.requiredDocs")}
            </div>
            {programId && programName ? (
              <p className="text-[10px] text-primary/80 mb-1.5" data-testid="doc-reqs-program-note">
                {t("inbox.studentTab.programScopedNote", { name: programName })}
              </p>
            ) : (
              <p className="text-[10px] text-muted-foreground mb-1.5" data-testid="doc-reqs-pending-note">
                {t("inbox.studentTab.programPendingNote")}
              </p>
            )}
            {docReqsLoading ? (
              <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>…</span>
              </div>
            ) : sortedDocReqs.length === 0 ? (
              <p className="text-xs text-muted-foreground py-1">
                {t("inbox.studentTab.noDocReqs")}
              </p>
            ) : (
              sortedDocReqs.map((req) => {
                const Icon = getDocIcon(req.documentType);
                const staged = staging[req.documentType];
                return (
                  <div
                    key={req.documentType}
                    className="flex items-center gap-2 py-0.5 group"
                  >
                    <Icon
                      className={`w-3.5 h-3.5 shrink-0 ${
                        staged
                          ? "text-emerald-600"
                          : "text-muted-foreground/50"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <span
                        className={`text-xs ${
                          staged
                            ? "text-foreground font-medium"
                            : req.mandatory
                              ? "text-rose-600 font-medium"
                              : "text-muted-foreground"
                        }`}
                      >
                        {docLabel(req.documentType)}
                      </span>
                      {req.mandatory && !staged && (
                        <span className="ms-1.5 text-[10px] bg-rose-100 text-rose-600 px-1 py-0.5 rounded-full">
                          {t("inbox.studentTab.required")}
                        </span>
                      )}
                      {staged && (
                        <span className="ms-1.5 text-[10px] text-emerald-600 truncate">
                          {staged.name}
                        </span>
                      )}
                    </div>
                    {staged ? (
                      <button
                        type="button"
                        onClick={() => handleRemoveStaged(req.documentType)}
                        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        aria-label="Remove"
                      >
                        <XIcon className="w-3 h-3 text-muted-foreground hover:text-destructive" />
                      </button>
                    ) : null}
                    {staged ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    ) : (
                      <Circle className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                    )}
                  </div>
                );
              })
            )}
          </div>
        ) : (
          !levelsLoading && (
            <div className="px-3 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                {t("inbox.studentTab.selectLevelFirst")}
              </p>
            </div>
          )
        )}

        {/* Chat attachments */}
        <div className="px-3 pt-2 pb-3 border-t space-y-2 mt-1">
          <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
            {t("inbox.studentTab.chatAttachments")}
          </div>
          {attachments.length === 0 ? (
            <p className="text-xs text-muted-foreground py-1">
              {t("inbox.studentTab.noAttachments")}
            </p>
          ) : (
            attachments.map((att) => {
              const alreadyUsedAs = Object.entries(staging).find(
                ([, v]) =>
                  v.msgId === att.msgId && v.attachIdx === att.attachIdx
              )?.[0];
              return (
                <div
                  key={`${att.msgId}-${att.attachIdx}`}
                  className="flex items-center gap-2"
                >
                  <Paperclip className="w-3 h-3 text-muted-foreground shrink-0" />
                  <span
                    className="text-xs flex-1 min-w-0 truncate"
                    title={att.name}
                  >
                    {att.name}
                  </span>
                  {alreadyUsedAs ? (
                    <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full shrink-0 max-w-[80px] truncate">
                      {alreadyUsedAs}
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-5 text-[10px] px-2 shrink-0"
                      onClick={() => handleAddClick(att)}
                    >
                      {t("inbox.studentTab.addBtn")}
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* AI button */}
      <div className="px-3 py-3 border-t shrink-0">
        <Button
          className="w-full h-8 text-xs gap-1.5"
          onClick={() => {
            void handleAnalyzeAndCreate();
          }}
          disabled={stagedCount === 0 || extracting}
        >
          {extracting ? (
            <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
          ) : (
            <FileText className="w-3.5 h-3.5 shrink-0" />
          )}
          {extracting
            ? t("inbox.studentTab.extracting")
            : t("inbox.studentTab.analyzeBtn")}
        </Button>
        {stagedCount === 0 && !extracting && (
          <p className="text-center text-[10px] text-muted-foreground mt-1">
            {t("inbox.studentTab.noDocsToAnalyze")}
          </p>
        )}
      </div>

      {/* ── Doc type picker dialog ──────────────────────────────────────────── */}
      <Dialog
        open={!!addingAtt}
        onOpenChange={(open) => {
          if (!open) setAddingAtt(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {t("inbox.studentTab.selectDocType")}
            </DialogTitle>
          </DialogHeader>
          <div className="py-1 space-y-3">
            {addingAtt && (
              <p className="text-xs text-muted-foreground truncate">
                {addingAtt.name}
              </p>
            )}
            {sortedDocReqs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("inbox.studentTab.noDocReqs")}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {sortedDocReqs.map((req) => {
                  const Icon = getDocIcon(req.documentType);
                  const filled = !!staging[req.documentType];
                  return (
                    <button
                      key={req.documentType}
                      type="button"
                      onClick={() => handleDocTypePick(req.documentType)}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border text-center cursor-pointer transition-colors ${
                        filled
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : "border-border hover:border-primary hover:bg-primary/5"
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                      <span className="text-xs font-medium">
                        {docLabel(req.documentType)}
                      </span>
                      {filled && (
                        <span className="text-[10px] text-emerald-600">
                          {t("inbox.studentTab.filled")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddingAtt(null)}
            >
              {t("inbox.studentTab.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Conflict dialog ─────────────────────────────────────────────────── */}
      <Dialog
        open={!!conflictState}
        onOpenChange={(open) => {
          if (!open) setConflictState(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {t("inbox.studentTab.conflictTitle")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            {t("inbox.studentTab.conflictBody", {
              type: conflictState?.docType ?? "",
            })}
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConflictState(null)}
            >
              {t("inbox.studentTab.keepExisting")}
            </Button>
            <Button size="sm" onClick={handleConflictReplace}>
              {t("inbox.studentTab.replace")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
