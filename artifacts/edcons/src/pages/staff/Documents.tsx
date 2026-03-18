import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useListDocuments, useCreateDocument, useDeleteDocument } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, Plus, Search, Trash2, ExternalLink, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type DocSortKey = "name" | "type" | "status" | "studentId" | "uploaded";
type SortDir = "asc" | "desc";

function DocSortHeader({ label, sortKey, currentSort, onSort }: {
  label: string; sortKey: DocSortKey; currentSort: { key: DocSortKey; dir: SortDir }; onSort: (k: DocSortKey) => void;
}) {
  const active = currentSort.key === sortKey;
  return (
    <TableHead
      className="font-semibold text-foreground cursor-pointer select-none hover:bg-muted/50 transition-colors"
      onClick={() => onSort(sortKey)}
    >
      <div className="flex items-center gap-1.5">
        {label}
        {active ? (currentSort.dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 text-muted-foreground/50" />}
      </div>
    </TableHead>
  );
}

const DOC_TYPES = [
  "passport",
  "transcript",
  "diploma",
  "language_certificate",
  "bank_statement",
  "visa",
  "offer_letter",
  "other",
];

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  extracted: "bg-blue-100 text-blue-700",
};

export default function DocumentsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", type: "passport", studentId: "" });
  const [sort, setSort] = useState<{ key: DocSortKey; dir: SortDir }>({ key: "uploaded", dir: "desc" });

  const { data: docs, isLoading } = useListDocuments();
  const createDoc = useCreateDocument();
  const deleteDoc = useDeleteDocument();

  function handleSort(key: DocSortKey) {
    setSort(prev => prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
  }

  const allDocs: any[] = Array.isArray(docs) ? docs : (docs as any)?.data || [];
  const filtered = allDocs.filter((d: any) =>
    !search || d.name.toLowerCase().includes(search.toLowerCase())
  ).sort((a: any, b: any) => {
    const dir = sort.dir === "asc" ? 1 : -1;
    switch (sort.key) {
      case "name": return dir * ((a.name || "").localeCompare(b.name || ""));
      case "type": return dir * ((a.type || "").localeCompare(b.type || ""));
      case "status": return dir * ((a.status || "").localeCompare(b.status || ""));
      case "studentId": return dir * ((a.studentId || 0) - (b.studentId || 0));
      case "uploaded": return dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      default: return 0;
    }
  });

  function handleCreate() {
    if (!form.name || !form.type) return;
    createDoc.mutate(
      {
        data: {
          name: form.name,
          type: form.type,
          status: "pending",
          studentId: form.studentId ? parseInt(form.studentId, 10) : undefined,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Document record created" });
          setOpen(false);
          setForm({ name: "", type: "passport", studentId: "" });
          queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
        },
      }
    );
  }

  function handleDelete(id: number) {
    if (!confirm("Delete this document record?")) return;
    deleteDoc.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "Document deleted" });
          queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
        },
      }
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Documents</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage student documents and files.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search documents..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-card"
              />
            </div>
            <Button className="rounded-full shadow-lg shadow-primary/20" onClick={() => setOpen(true)}>
              <Plus className="w-4 h-4 mr-2" /> Add Document
            </Button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-card rounded-2xl border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-secondary/50">
                <TableRow>
                  <DocSortHeader label="Name" sortKey="name" currentSort={sort} onSort={handleSort} />
                  <DocSortHeader label="Type" sortKey="type" currentSort={sort} onSort={handleSort} />
                  <DocSortHeader label="Status" sortKey="status" currentSort={sort} onSort={handleSort} />
                  <DocSortHeader label="Student ID" sortKey="studentId" currentSort={sort} onSort={handleSort} />
                  <DocSortHeader label="Uploaded" sortKey="uploaded" currentSort={sort} onSort={handleSort} />
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <TableCell key={j}>
                          <div className="h-5 w-24 bg-secondary rounded animate-pulse" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <FileText className="w-8 h-8 opacity-30" />
                        <span>No documents found.</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((doc: any) => (
                    <TableRow key={doc.id} className="hover:bg-primary/5 transition-colors">
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                          {doc.name}
                        </div>
                      </TableCell>
                      <TableCell className="capitalize text-muted-foreground">
                        {doc.type?.replace(/_/g, " ")}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={`capitalize text-xs px-2 py-0.5 border-0 rounded-full ${STATUS_COLORS[doc.status] ?? "bg-gray-100 text-gray-600"}`}
                        >
                          {doc.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{doc.studentId ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(doc.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {doc.fileUrl && (
                            <Button variant="ghost" size="icon" asChild>
                              <a href={doc.fileUrl} target="_blank" rel="noreferrer">
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(doc.id)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {/* Create Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Document Record</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Document Name</Label>
              <Input
                placeholder="e.g. Passport Copy"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOC_TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="capitalize">
                      {t.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Student ID (optional)</Label>
              <Input
                placeholder="e.g. 42"
                type="number"
                value={form.studentId}
                onChange={(e) => setForm({ ...form, studentId: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreate}
              disabled={createDoc.isPending || !form.name}
            >
              {createDoc.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
