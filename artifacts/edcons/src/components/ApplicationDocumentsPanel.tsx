import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Upload, FileText, Trash2, Download,
  ChevronDown, ChevronRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/hooks/use-i18n";
import { validateFileObj as validateFile, sanitizeFileName, ACCEPT_ATTRIBUTE, FILE_UPLOAD_HELP_TEXT } from "@/lib/fileUploadValidation";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

const ADMIN_ONLY_UPLOAD_STAGES = [
  "offer_received", "acceptance_letter", "final_acceptance",
];

export const APPLICATION_DOC_STAGES = [
  "app_fee_paid", "deposit_paid", "upload_payment",
  "offer_received", "acceptance_letter", "final_acceptance",
  "student_card", "visa_approved", "visa_reject",
];

const APPLICATION_DOC_CATEGORIES = [
  "app_fee_paid",
  "deposit_paid",
  "offer_received",
  "acceptance_letter",
  "final_acceptance",
  "student_card",
  "visa_approved",
  "visa_reject",
];

const FALLBACK_LABELS: Record<string, string> = {
  app_fee_paid: "Application Fee Receipt",
  deposit_paid: "Deposit Paid Receipt",
  offer_received: "Offer Letter",
  acceptance_letter: "Acceptance Letter",
  final_acceptance: "Final Acceptance Letter",
  student_card: "Student Card Upload",
  visa_approved: "Visa OK",
  visa_reject: "Visa Reject",
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

interface ApplicationDocumentsPanelProps {
  applicationId: number;
  userRole: string;
  userId?: number;
}

export function ApplicationDocumentsPanel({ applicationId, userRole, userId }: ApplicationDocumentsPanelProps) {
  const { t } = useI18n();

  const { data: allDocs = [] } = useQuery({
    queryKey: [`app-stage-docs-${applicationId}`],
    queryFn: () => customFetch(`${BASE_URL}/api/applications/${applicationId}/stage-documents`),
    staleTime: 15_000,
  });

  const isAdmin = ADMIN_ROLES.includes(userRole);

  function getCategoryLabel(category: string): string {
    const translated = t(`documents.appDocLabel_${category}`);
    if (translated !== `documents.appDocLabel_${category}`) return translated;
    return FALLBACK_LABELS[category] || category;
  }

  return (
    <div className="bg-card rounded-2xl border shadow-sm p-6 space-y-4">
      <h2 className="font-semibold text-foreground flex items-center gap-2">
        <FileText className="w-4 h-4 text-muted-foreground" />
        {t("documents.applicationDocuments")}
      </h2>

      <div className="space-y-3">
        {APPLICATION_DOC_CATEGORIES.map(category => {
          const docs = (allDocs as any[]).filter(
            (d: any) => (d.stage === category || (category === "deposit_paid" && d.stage === "upload_payment")) && !d.isMissingDocNote
          );
          return (
            <CategorySection
              key={category}
              applicationId={applicationId}
              category={category}
              label={getCategoryLabel(category)}
              docs={docs}
              userId={userId}
              isAdmin={isAdmin}
            />
          );
        })}
      </div>
    </div>
  );
}

function CategorySection({
  applicationId, category, label, docs, userId, isAdmin,
}: {
  applicationId: number;
  category: string;
  label: string;
  docs: any[];
  userId?: number;
  isAdmin: boolean;
}) {
  const [expanded, setExpanded] = useState(docs.length > 0);
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const isAdminOnly = ADMIN_ONLY_UPLOAD_STAGES.includes(category);
  const canUpload = isAdminOnly ? isAdmin : true;

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const base64 = await fileToBase64(file);
      return customFetch(`${BASE_URL}/api/applications/${applicationId}/stage-documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: category,
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
      toast({ title: "File error", description: validation.message, variant: "destructive" });
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

  return (
    <div className="border rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-secondary/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          <span className="text-sm font-medium">{label}</span>
          {docs.length > 0 && (
            <Badge variant="secondary" className="text-xs px-1.5 py-0">{docs.length}</Badge>
          )}
          {isAdminOnly && (
            <Badge variant="outline" className="text-xs px-1.5 py-0 text-amber-600 border-amber-300">Admin Upload</Badge>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
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
            <p className="text-xs text-muted-foreground py-1">No documents uploaded yet.</p>
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
