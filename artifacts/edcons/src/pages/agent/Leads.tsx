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
  UserCheck, Plus, Search, Loader2, Mail, Phone, Calendar, Globe, BookOpen,
} from "lucide-react";

type Lead = {
  id: number; firstName: string; lastName: string; email: string | null;
  phone: string | null; nationality: string | null; source: string | null;
  status: string; season: string; interestedProgram: string | null;
  interestedCountry: string | null; createdAt: string; agentId: number | null;
};

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-500/10 text-blue-600 border-blue-200",
  contacted: "bg-amber-500/10 text-amber-600 border-amber-200",
  qualified: "bg-purple-500/10 text-purple-600 border-purple-200",
  converted: "bg-green-500/10 text-green-600 border-green-200",
  lost: "bg-red-500/10 text-red-500 border-red-200",
};

export default function AgentLeads() {
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
    interestedProgram: "", interestedCountry: "", notes: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["agent-leads", page, limit, search, selectedYear],
    enabled: !!user,
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit), season: selectedYear });
      if (search) params.set("search", search);
      return customFetch<{ data: Lead[]; meta: { total: number; page: number; limit: number; totalPages: number } }>(`/api/leads?${params}`);
    },
  });

  const leads = data?.data || [];
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
      await customFetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email || undefined,
          phone: form.phone || undefined,
          nationality: form.nationality || undefined,
          interestedProgram: form.interestedProgram || undefined,
          interestedCountry: form.interestedCountry || undefined,
          notes: form.notes || undefined,
          source: "agent",
          season: selectedYear,
        }),
      });
      await qc.invalidateQueries({ queryKey: ["agent-leads"] });
      setShowCreate(false);
      setForm({ firstName: "", lastName: "", email: "", phone: "", nationality: "", interestedProgram: "", interestedCountry: "", notes: "" });
      toast({ title: "Lead created", description: `${form.firstName} ${form.lastName} has been added.` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">Leads</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage your prospective student leads</p>
          </div>
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus className="w-4 h-4" /> Add Lead
          </Button>
        </div>

        <Card className="border shadow-sm">
          <div className="p-4 border-b border-border/50">
            <form onSubmit={handleSearch} className="flex gap-2">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Search leads..." className="pl-9 h-9" />
              </div>
              <Button type="submit" variant="outline" size="sm" className="h-9">Search</Button>
              {search && <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => { setSearch(""); setSearchInput(""); setPage(1); }}>Clear</Button>}
            </form>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : leads.length === 0 ? (
            <div className="text-center py-20">
              <UserCheck className="w-12 h-12 mx-auto mb-3 text-muted-foreground/20" />
              <p className="font-medium text-foreground">No leads yet</p>
              <p className="text-sm text-muted-foreground mt-1">Add your first lead to get started</p>
              <Button onClick={() => setShowCreate(true)} variant="outline" className="mt-4 gap-2">
                <Plus className="w-4 h-4" /> Add Lead
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
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Interest</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map(lead => (
                      <tr key={lead.id} className="border-b border-border/30 hover:bg-secondary/20 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center text-xs font-bold text-primary">
                              {lead.firstName?.[0]}{lead.lastName?.[0]}
                            </div>
                            <div>
                              <p className="font-medium text-foreground">{lead.firstName} {lead.lastName}</p>
                              {lead.nationality && <p className="text-xs text-muted-foreground">{lead.nationality}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {lead.email && <p className="text-muted-foreground flex items-center gap-1.5 text-xs"><Mail className="w-3 h-3" />{lead.email}</p>}
                          {lead.phone && <p className="text-muted-foreground flex items-center gap-1.5 text-xs mt-0.5"><Phone className="w-3 h-3" />{lead.phone}</p>}
                        </td>
                        <td className="px-4 py-3">
                          {lead.interestedCountry && <p className="text-xs flex items-center gap-1.5 text-foreground"><Globe className="w-3 h-3 text-muted-foreground" />{lead.interestedCountry}</p>}
                          {lead.interestedProgram && <p className="text-xs flex items-center gap-1.5 text-muted-foreground mt-0.5"><BookOpen className="w-3 h-3" />{lead.interestedProgram}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={`text-xs ${STATUS_COLORS[lead.status] || STATUS_COLORS.new}`}>{lead.status}</Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">
                          <span className="flex items-center gap-1.5"><Calendar className="w-3 h-3" />{new Date(lead.createdAt).toLocaleDateString()}</span>
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

        {meta && <p className="text-xs text-muted-foreground mt-3 text-center">{meta.total} lead{meta.total !== 1 ? "s" : ""} total</p>}
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Lead</DialogTitle>
            <DialogDescription>Add a new prospective student lead</DialogDescription>
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
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Nationality</Label>
              <Input value={form.nationality} onChange={e => setForm(f => ({ ...f, nationality: e.target.value }))} className="h-9" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Interested Country</Label>
                <Input value={form.interestedCountry} onChange={e => setForm(f => ({ ...f, interestedCountry: e.target.value }))} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Interested Program</Label>
                <Input value={form.interestedProgram} onChange={e => setForm(f => ({ ...f, interestedProgram: e.target.value }))} className="h-9" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Notes</Label>
              <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="h-9" />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t">
              <Button variant="outline" onClick={() => setShowCreate(false)} size="sm">Cancel</Button>
              <Button onClick={handleCreate} disabled={saving || !form.firstName || !form.lastName} size="sm" className="gap-2 px-5">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Add Lead
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
