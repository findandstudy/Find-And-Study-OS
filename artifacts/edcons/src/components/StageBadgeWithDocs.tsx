import { useState } from "react";
import { Paperclip, Download, Loader2 } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

interface StageDoc {
  id: number;
  fileName: string;
  isMissingDocNote: boolean;
}

interface StageBadgeWithDocsProps {
  app: { id: number; stage: string; currentStageDocCount?: number | null };
  stageLabel: string;
  stageColor: string;
  baseUrl: string;
}

function triggerDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function StageBadgeWithDocs({
  app,
  stageLabel,
  stageColor,
  baseUrl,
}: StageBadgeWithDocsProps) {
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<StageDoc[] | null>(null);
  const [loading, setLoading] = useState(false);

  const hasDocIndicator = (app.currentStageDocCount ?? 0) > 0;

  const downloadUrl = (docId: number) =>
    `${baseUrl}/api/applications/${app.id}/stage-documents/${docId}/download`;

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!hasDocIndicator) return;

    if (open) {
      setOpen(false);
      return;
    }

    let realDocs = docs;
    if (realDocs === null) {
      setLoading(true);
      try {
        const r = await fetch(
          `${baseUrl}/api/applications/${app.id}/stage-documents?stage=${encodeURIComponent(app.stage)}`,
          { credentials: "include" },
        );
        const result = r.ok ? await r.json() : [];
        realDocs = (Array.isArray(result) ? result : []).filter(
          (d: any) => !d.isMissingDocNote,
        );
        setDocs(realDocs);
      } catch {
        realDocs = [];
        setDocs([]);
      } finally {
        setLoading(false);
      }
    }

    if (!realDocs || realDocs.length === 0) return;
    if (realDocs.length === 1) {
      triggerDownload(downloadUrl(realDocs[0].id));
    } else {
      setOpen(true);
    }
  }

  if (!hasDocIndicator) {
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${stageColor}`}>
        {stageLabel}
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium transition-opacity hover:opacity-80 cursor-pointer ${stageColor}`}
          onClick={handleClick}
        >
          {stageLabel}
          {loading ? (
            <Loader2 className="w-3 h-3 opacity-70 animate-spin shrink-0" />
          ) : (
            <Paperclip className="w-3 h-3 opacity-70 shrink-0" />
          )}
        </button>
      </PopoverAnchor>
      <PopoverContent className="w-60 p-2" align="start">
        {docs && docs.length > 0 ? (
          <>
            {docs.map((doc) => (
              <a
                key={doc.id}
                href={downloadUrl(doc.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted text-xs transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <Download className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="truncate min-w-0">{doc.fileName}</span>
              </a>
            ))}
          </>
        ) : (
          <p className="text-xs text-muted-foreground px-2 py-1">No documents</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
