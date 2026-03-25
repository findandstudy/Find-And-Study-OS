import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Upload, FileText, Trash2, Download, Plus, X,
  AlertTriangle, ChevronDown, ChevronRight, Save,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { validateFileObj as validateFile, sanitizeFileName, ACCEPT_ATTRIBUTE, FILE_UPLOAD_HELP_TEXT } from "@/lib/fileUploadValidation";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

const EVERYONE_UPLOAD_STAGES = [
  "app_fee_paid", "missing_docs", "upload_payment",
  "visa_approved", "student_card", "visa_reject",
];

const ADMIN_ONLY_UPLOAD_STAGES = [
  "offer_received", "acceptance_letter", "final_acceptance",
];

const ALL_DOC_STAGES = [...EVERYONE_UPLOAD_STAGES, ...ADMIN_ONLY_UPLOAD_STAGES];

const STAGE_LABELS: Record<string, string> = {
  app_fee_paid: "Application Fee Paid",
  missing_docs: "Missing Documents",
  upload_payment: "Upload Payment",
  visa_approved: "Visa OK",
  student_card: "Student Card Upload",
  visa_reject: "Visa Reject",
  offer_received: "Offer",
  acceptance_letter: "Acceptance Letter",
  final_acceptance: "Final Acceptance Letter",
};

const ADMIN_ROLES = ["super_admin", "admin", "manager"];

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
}

export function StageDocumentsPanel({ applicationId, currentStage, userRole, userId }: StageDocumentsPanelProps) {
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
  const isStaff = ["super_admin", "admin", "manager", "staff", "consultant", "editor", "accountant"].includes(userRole);

  const relevantStages = ALL_DOC_STAGES.filter(stage => {
    const docs = (allDocs as any[]).filter((d: any) => d.stage === stage && !d.isMissingDocNote);
    const notes = stage === "missing_docs" ? (missingNotes as any[]) : [];
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
        {relevantStages.map(stage => (
          <StageSection
            key={stage}
            applicationId={applicationId}
            stage={stage}
            docs={(allDocs as any[]).filter((d: any) => d.stage === stage && !d.isMissingDocNote)}
            missingNotes={stage === "missing_docs" ? (missingNotes as any[]) : []}
            userRole={userRole}
            userId={userId}
            isAdmin={isAdmin}
            isStaff={isStaff}
            isCurrent={stage === currentStage}
          />
        ))}
      </div>
    </div>
  );
}

function StageSection({
  applicationId, stage, docs, missingNotes, userRole, userId, isAdmin, isStaff, isCurrent,
}: {
  applicationId: number;
  stage: string;
  docs: any[];
  missingNotes: any[];
  userRole: string;
  userId?: number;
  isAdmin: boolean;
  isStaff: boolean;
  isCurrent: boolean;
}) {
  const [expanded, setExpanded] = useState(isCurrent || docs.length > 0 || missingNotes.length > 0);
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const canUpload = ADMIN_ONLY_UPLOAD_STAGES.includes(stage)
    ? isAdmin
    : true;

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const base64 = await fileToBase64(file);
      return customFetch(`${BASE_URL}/api/applications/${applicationId}/stage-documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage,
          fileName: file.name,
          fileData: base64,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`app-stage-docs-${applicationId}`] });
      toast({ title: "Document uploaded" });
    },
    onError: (err: any) => {
      toast({ title: "Upload failed", description: err?.message || "An error occurred", variant: "destructive" });
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

  const isAdminOnlyStage = ADMIN_ONLY_UPLOAD_STAGES.includes(stage);
  const stageLabel = STAGE_LABELS[stage] || stage;

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
            <Badge variant="outline" className="text-xs px-1.5 py-0 text-amber-600 border-amber-300">Admin Upload</Badge>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {stage === "missing_docs" && (
            <MissingDocsSection
              applicationId={applicationId}
              notes={missingNotes}
              isAdmin={isAdmin}
            />
          )}

          {docs.length > 0 ? (
            <div className="space-y-1.5">
              {docs.map((doc: any) => (
                <div key={doc.id} className="flex items-center gap-2 p-2 rounded-lg bg-secondary/30 text-sm group">
                  <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium text-foreground">{doc.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {doc.uploadedByName || "Unknown"} · {new Date(doc.createdAt).toLocaleDateString()}
                      {doc.sizeBytes && ` · ${(doc.sizeBytes / 1024).toFixed(0)}KB`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
              ))}
            </div>
          ) : (
            stage !== "missing_docs" && (
              <p className="text-xs text-muted-foreground py-1">No documents uploaded for this stage yet.</p>
            )
          )}

          {canUpload && (
            <div className="pt-1 space-y-1">
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
  const [editing, setEditing] = useState(false);
  const [items, setItems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  function startEdit() {
    setItems(notes.length > 0 ? notes.map((n: any) => n.fileName) : [""]);
    setEditing(true);
  }

  function addItem() {
    setItems([...items, ""]);
  }

  function removeItem(idx: number) {
    setItems(items.filter((_, i) => i !== idx));
  }

  function updateItem(idx: number, val: string) {
    const updated = [...items];
    updated[idx] = val;
    setItems(updated);
  }

  async function handleSave() {
    const filtered = items.filter(i => i.trim());
    if (filtered.length === 0) {
      toast({ title: "Add at least one missing document note", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await customFetch(`${BASE_URL}/api/applications/${applicationId}/missing-doc-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: filtered }),
      });
      qc.invalidateQueries({ queryKey: [`app-missing-notes-${applicationId}`] });
      toast({ title: "Missing documents updated" });
      setEditing(false);
    } catch (err: any) {
      toast({ title: "Failed to save", description: err?.message, variant: "destructive" });
    }
    setSaving(false);
  }

  return (
    <div className="border rounded-lg p-2.5 bg-amber-50/50 dark:bg-amber-950/20 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
          <span className="text-xs font-medium text-amber-700 dark:text-amber-400">Required Documents</span>
        </div>
        {isAdmin && !editing && (
          <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 px-2" onClick={startEdit}>
            <Plus className="w-3 h-3" /> Edit List
          </Button>
        )}
      </div>

      {editing ? (
        <div className="space-y-1.5">
          {items.map((item, idx) => (
            <div key={idx} className="flex gap-1.5">
              <Input
                value={item}
                onChange={e => updateItem(idx, e.target.value)}
                placeholder="Document name..."
                className="h-7 text-xs"
              />
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => removeItem(idx)}>
                <X className="w-3 h-3" />
              </Button>
            </div>
          ))}
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addItem}>
              <Plus className="w-3 h-3" /> Add
            </Button>
            <Button size="sm" className="h-7 text-xs gap-1" onClick={handleSave} disabled={saving}>
              <Save className="w-3 h-3" /> {saving ? "Saving..." : "Save"}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : notes.length > 0 ? (
        <ul className="space-y-0.5">
          {notes.map((note: any) => (
            <li key={note.id} className="text-xs text-foreground flex items-center gap-1.5 py-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
              {note.fileName}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No missing documents specified yet.</p>
      )}
    </div>
  );
}
