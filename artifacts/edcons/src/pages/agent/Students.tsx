import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useAuth } from "@/hooks/use-auth";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSeason } from "@/contexts/SeasonContext";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { TablePagination } from "@/components/TablePagination";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  GraduationCap, Plus, Search, Loader2, Mail, Phone, Calendar, Flag,
} from "lucide-react";

type Student = {
  id: number; firstName: string; lastName: string; email: string | null;
  phone: string | null; nationality: string | null; status: string;
  season: string; agentId: number | null; createdAt: string;
  passportNumber: string | null; dateOfBirth: string | null;
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/10 text-green-600 border-green-200",
  inactive: "bg-red-500/10 text-red-500 border-red-200",
  graduated: "bg-purple-500/10 text-purple-600 border-purple-200",
  suspended: "bg-amber-500/10 text-amber-600 border-amber-200",
};

export default function AgentStudents() {
  const { user } = useAuth(true);
  const { toast } = useToast();
  const qc = useQueryClient();
  const { selectedYear } = useSeason();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const limit = 15;
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", phone: "", nationality: "",
    dateOfBirth: "", passportNumber: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["agent-students", page, limit, search, selectedYear],
    enabled: !!user,
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit), season: selectedYear });
      if (search) params.set("search", search);
      return customFetch<{ data: Student[]; meta: { total: number; page: number; limit: number; totalPages: number } }>(`/api/students?${params}`);
    },
  });

  const students = data?.data || [];
  const meta = data?.meta;

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  }

  async function handleCreate() {
    if (!form.firstName || !form.lastName) {
      toast({ title: "Error", description: "First name and last name are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await customFetch("/api/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email || undefined,
          phone: form.phone || undefined,
          nationality: form.nationality || undefined,
          dateOfBirth: form.dateOfBirth || undefined,
          passportNumber: form.passportNumber || undefined,
          season: selectedYear,
        }),
      });
      await qc.invalidateQueries({ queryKey: ["agent-students"] });
      setShowCreate(false);
      setForm({ firstName: "", lastName: "", email: "", phone: "", nationality: "", dateOfBirth: "", passportNumber: "" });
      toast({ title: "Student created", description: `${form.firstName} ${form.lastName} has been added.` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">Students</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage your referred students</p>
          </div>
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus className="w-4 h-4" /> Add Student
          </Button>
        </div>

        <Card className="border shadow-sm">
          <div className="p-4 border-b border-border/50">
            <form onSubmit={handleSearch} className="flex gap-2">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Search students..." className="pl-9 h-9" />
              </div>
              <Button type="submit" variant="outline" size="sm" className="h-9">Search</Button>
              {search && <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => { setSearch(""); setSearchInput(""); setPage(1); }}>Clear</Button>}
            </form>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : students.length === 0 ? (
            <div className="text-center py-20">
              <GraduationCap className="w-12 h-12 mx-auto mb-3 text-muted-foreground/20" />
              <p className="font-medium text-foreground">No students yet</p>
              <p className="text-sm text-muted-foreground mt-1">Add your first student to get started</p>
              <Button onClick={() => setShowCreate(true)} variant="outline" className="mt-4 gap-2">
                <Plus className="w-4 h-4" /> Add Student
              </Button>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 bg-secondary/30">
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Contact</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Nationality</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Season</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map(s => (
                      <tr key={s.id} className="border-b border-border/30 hover:bg-secondary/20 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center text-xs font-bold text-primary">
                              {s.firstName?.[0]}{s.lastName?.[0]}
                            </div>
                            <div>
                              <p className="font-medium text-foreground">{s.firstName} {s.lastName}</p>
                              {s.passportNumber && <p className="text-xs text-muted-foreground font-mono">{s.passportNumber}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {s.email && <p className="text-muted-foreground flex items-center gap-1.5 text-xs"><Mail className="w-3 h-3" />{s.email}</p>}
                          {s.phone && <p className="text-muted-foreground flex items-center gap-1.5 text-xs mt-0.5"><Phone className="w-3 h-3" />{s.phone}</p>}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          {s.nationality ? <span className="flex items-center gap-1.5"><Flag className="w-3 h-3 text-muted-foreground" />{s.nationality}</span> : <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={`text-xs ${STATUS_COLORS[s.status] || STATUS_COLORS.active}`}>{s.status}</Badge>
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">{s.season}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">
                          <span className="flex items-center gap-1.5"><Calendar className="w-3 h-3" />{new Date(s.createdAt).toLocaleDateString()}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {meta && meta.totalPages > 1 && (
                <div className="p-4 border-t border-border/50">
                  <TablePagination page={meta.page} totalPages={meta.totalPages} total={meta.total} limit={meta.limit} onPageChange={setPage} />
                </div>
              )}
            </>
          )}
        </Card>

        {meta && <p className="text-xs text-muted-foreground mt-3 text-center">{meta.total} student{meta.total !== 1 ? "s" : ""} total</p>}
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Student</DialogTitle>
            <DialogDescription>Register a new student under your agency</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">First Name *</Label>
                <Input value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Last Name *</Label>
                <Input value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} className="h-9" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Email</Label>
                <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Phone</Label>
                <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="h-9" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Nationality</Label>
                <Input value={form.nationality} onChange={e => setForm(f => ({ ...f, nationality: e.target.value }))} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Date of Birth</Label>
                <Input type="date" value={form.dateOfBirth} onChange={e => setForm(f => ({ ...f, dateOfBirth: e.target.value }))} className="h-9" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Passport Number</Label>
              <Input value={form.passportNumber} onChange={e => setForm(f => ({ ...f, passportNumber: e.target.value }))} className="h-9" />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t">
              <Button variant="outline" onClick={() => setShowCreate(false)} size="sm">Cancel</Button>
              <Button onClick={handleCreate} disabled={saving || !form.firstName || !form.lastName} size="sm" className="gap-2 px-5">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Add Student
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
