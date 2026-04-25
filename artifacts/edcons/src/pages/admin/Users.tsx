import { useState, useEffect, useCallback } from "react";
import { useListUsers } from "@workspace/api-client-react";
import { customFetch } from "@workspace/api-client-react";
import { TablePagination, useTablePagination } from "@/components/TablePagination";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Search, Users, UserPlus, Shield, MoreHorizontal, Mail, Edit2,
  Plus, Trash2, ChevronDown, ChevronRight, Check, X, Eye, Lock,
  Settings2, ShieldCheck, KeyRound, LogIn, ShieldOff, Loader2,
  ArrowUpDown, ArrowUp, ArrowDown, Phone
} from "lucide-react";
import { CountryFlag } from "@/components/CountryFlag";
import { QuickContactButtons } from "@/components/QuickContact";

const PHONE_CODES = [
  { code: "+90", country: "TR" }, { code: "+1", country: "US" }, { code: "+44", country: "GB" },
  { code: "+49", country: "DE" }, { code: "+33", country: "FR" }, { code: "+39", country: "IT" },
  { code: "+34", country: "ES" }, { code: "+31", country: "NL" }, { code: "+46", country: "SE" },
  { code: "+47", country: "NO" }, { code: "+45", country: "DK" }, { code: "+41", country: "CH" },
  { code: "+43", country: "AT" }, { code: "+48", country: "PL" }, { code: "+7", country: "RU" },
  { code: "+380", country: "UA" }, { code: "+86", country: "CN" }, { code: "+81", country: "JP" },
  { code: "+82", country: "KR" }, { code: "+91", country: "IN" }, { code: "+92", country: "PK" },
  { code: "+93", country: "AF" }, { code: "+966", country: "SA" }, { code: "+971", country: "AE" },
  { code: "+964", country: "IQ" }, { code: "+98", country: "IR" }, { code: "+962", country: "JO" },
  { code: "+961", country: "LB" }, { code: "+20", country: "EG" }, { code: "+212", country: "MA" },
  { code: "+234", country: "NG" }, { code: "+254", country: "KE" }, { code: "+55", country: "BR" },
  { code: "+52", country: "MX" }, { code: "+61", country: "AU" }, { code: "+64", country: "NZ" },
  { code: "+60", country: "MY" }, { code: "+65", country: "SG" }, { code: "+66", country: "TH" },
  { code: "+84", country: "VN" }, { code: "+62", country: "ID" }, { code: "+63", country: "PH" },
  { code: "+880", country: "BD" }, { code: "+94", country: "LK" }, { code: "+977", country: "NP" },
  { code: "+251", country: "ET" }, { code: "+255", country: "TZ" }, { code: "+233", country: "GH" },
];

function parsePhoneCode(fullPhone: string): { phoneCode: string; phone: string } {
  if (!fullPhone) return { phoneCode: "+90", phone: "" };
  const sorted = [...PHONE_CODES].sort((a, b) => b.code.length - a.code.length);
  const matched = sorted.find(pc => fullPhone.startsWith(pc.code));
  if (matched) return { phoneCode: matched.code, phone: fullPhone.slice(matched.code.length) };
  return { phoneCode: "+90", phone: fullPhone };
}

const roleBadge: Record<string, { color: string; label: string }> = {
  super_admin: { color: "bg-rose-500/10 text-rose-600 border-rose-200", label: "Super Admin" },
  admin: { color: "bg-red-500/10 text-red-600 border-red-200", label: "Admin" },
  manager: { color: "bg-orange-500/10 text-orange-600 border-orange-200", label: "Manager" },
  staff: { color: "bg-blue-500/10 text-blue-600 border-blue-200", label: "Staff" },
  consultant: { color: "bg-indigo-500/10 text-indigo-600 border-indigo-200", label: "Consultant" },
  accountant: { color: "bg-purple-500/10 text-purple-600 border-purple-200", label: "Accountant" },
  editor: { color: "bg-cyan-500/10 text-cyan-600 border-cyan-200", label: "Editor" },
  student: { color: "bg-green-500/10 text-green-600 border-green-200", label: "Student" },
  agent: { color: "bg-amber-500/10 text-amber-600 border-amber-200", label: "Agent" },
  sub_agent: { color: "bg-yellow-500/10 text-yellow-600 border-yellow-200", label: "Sub Agent" },
};

const roleColors: Record<string, string> = {
  rose: "bg-rose-500/10 text-rose-600 border-rose-200",
  red: "bg-red-500/10 text-red-600 border-red-200",
  orange: "bg-orange-500/10 text-orange-600 border-orange-200",
  blue: "bg-blue-500/10 text-blue-600 border-blue-200",
  indigo: "bg-indigo-500/10 text-indigo-600 border-indigo-200",
  purple: "bg-purple-500/10 text-purple-600 border-purple-200",
  cyan: "bg-cyan-500/10 text-cyan-600 border-cyan-200",
  green: "bg-green-500/10 text-green-600 border-green-200",
  amber: "bg-amber-500/10 text-amber-600 border-amber-200",
  yellow: "bg-yellow-500/10 text-yellow-600 border-yellow-200",
  teal: "bg-teal-500/10 text-teal-600 border-teal-200",
  pink: "bg-pink-500/10 text-pink-600 border-pink-200",
};

interface RoleData {
  id: number;
  name: string;
  displayName: string;
  description: string | null;
  color: string;
  isSystem: boolean;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

interface PermCategory {
  label: string;
  permissions: Record<string, string>;
}

type PermSchema = Record<string, PermCategory>;

type UserSortKey = "user" | "email" | "role" | "status";
type SortDir = "asc" | "desc";

function UserSortHeader({ label, sortKey, currentSort, onSort }: {
  label: string; sortKey: UserSortKey; currentSort: { key: UserSortKey; dir: SortDir }; onSort: (k: UserSortKey) => void;
}) {
  const active = currentSort.key === sortKey;
  return (
    <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider cursor-pointer select-none hover:bg-muted/50 transition-colors"
      onClick={() => onSort(sortKey)}>
      <div className="flex items-center gap-1.5">
        {label}
        {active ? (currentSort.dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 text-muted-foreground/50" />}
      </div>
    </th>
  );
}

function UsersTab() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [sort, setSort] = useState<{ key: UserSortKey; dir: SortDir }>({ key: "user", dir: "asc" });
  const { data: usersResp, isLoading, refetch } = useListUsers(undefined, { query: { queryKey: ['admin-users'] } as any });
  const users: any[] = (usersResp as any)?.data || usersResp || [];
  const [roles, setRoles] = useState<RoleData[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ firstName: "", lastName: "", email: "", role: "staff", phoneCode: "+90", phone: "", language: "en", password: "" });
  const [creating, setCreating] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editUser, setEditUser] = useState<any>(null);
  const [editForm, setEditForm] = useState({ firstName: "", lastName: "", email: "", role: "staff", phoneCode: "+90", phone: "", language: "en", isActive: true });
  const [saving, setSaving] = useState(false);
  const [passwordDialog, setPasswordDialog] = useState<{ userId: number; userName: string } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const { toast } = useToast();
  const pg = useTablePagination(25);

  useEffect(() => {
    customFetch("/api/roles").then((res: any) => {
      setRoles(res?.data || res || []);
    }).catch(() => {});
  }, []);

  function handleSort(key: UserSortKey) {
    setSort(prev => prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
  }

  const nonStudentUsers = users.filter((u: any) => u.role !== "student");
  const filtered = nonStudentUsers.filter((u: any) => {
    const matchSearch = !search ||
      (u.firstName || "").toLowerCase().includes(search.toLowerCase()) ||
      (u.email || "").toLowerCase().includes(search.toLowerCase());
    const matchRole = roleFilter === "all" || u.role === roleFilter;
    return matchSearch && matchRole;
  }).sort((a: any, b: any) => {
    const dir = sort.dir === "asc" ? 1 : -1;
    switch (sort.key) {
      case "user": { const nameA = `${a.firstName || ""} ${a.lastName || ""}`.trim(); const nameB = `${b.firstName || ""} ${b.lastName || ""}`.trim(); return dir * nameA.localeCompare(nameB); }
      case "email": return dir * ((a.email || "").localeCompare(b.email || ""));
      case "role": return dir * ((a.role || "").localeCompare(b.role || ""));
      case "status": return dir * (Number(b.isActive ?? true) - Number(a.isActive ?? true));
      default: return 0;
    }
  });
  const { paged: pagedUsers, total: totalFilteredUsers } = pg.paginate(filtered);

  const handleCreate = async () => {
    if (!createForm.email || !createForm.firstName || !createForm.lastName) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const { phoneCode, phone, password, ...rest } = createForm;
      const payload: Record<string, string> = { ...rest, phone: phone ? `${phoneCode}${phone}` : "" };
      if (password) payload.password = password;
      await customFetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      toast({ title: "User created successfully" });
      setCreateOpen(false);
      setCreateForm({ firstName: "", lastName: "", email: "", role: "staff", phoneCode: "+90", phone: "", language: "en", password: "" });
      refetch();
    } catch (err: any) {
      toast({ title: "Failed to create user", description: err.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  async function handleDelete(id: number) {
    if (!confirm("Are you sure you want to delete this user? This action cannot be undone.")) return;
    try {
      await customFetch(`/api/users/${id}`, { method: "DELETE" });
      toast({ title: "User deleted" });
      refetch();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }

  async function handleToggleStatus(user: any) {
    const newActive = !user.isActive;
    try {
      await customFetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: newActive }),
      });
      toast({ title: `User ${newActive ? "activated" : "deactivated"}` });
      refetch();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }

  async function handleSetPassword() {
    if (!passwordDialog) return;
    if (!newPassword || newPassword.length < 6) {
      toast({ title: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    setPasswordSaving(true);
    try {
      await customFetch(`/api/users/${passwordDialog.userId}/set-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });
      toast({ title: "Password updated" });
      setPasswordDialog(null);
      setNewPassword("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setPasswordSaving(false);
    }
  }

  async function handleImpersonate(user: any) {
    if (!confirm(`Login as ${user.firstName} ${user.lastName}? You will be logged out of your current session.`)) return;
    try {
      const res = await customFetch(`/api/users/${user.id}/impersonate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if ((res as any).redirectTo) {
        const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
        window.location.href = `${base}${(res as any).redirectTo}`;
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }

  function openEditDialog(user: any) {
    setEditUser(user);
    const parsed = parsePhoneCode(user.phone || "");
    setEditForm({
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      email: user.email || "",
      role: user.role || "staff",
      phoneCode: parsed.phoneCode,
      phone: parsed.phone,
      language: user.language || "en",
      isActive: user.isActive ?? true,
    });
    setEditOpen(true);
  }

  async function handleEditSave() {
    if (!editUser) return;
    if (!editForm.email || !editForm.firstName || !editForm.lastName) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { phoneCode, phone, ...rest } = editForm;
      await customFetch(`/api/users/${editUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...rest, phone: phone ? `${phoneCode}${phone}` : "" }),
      });
      toast({ title: "User updated successfully" });
      setEditOpen(false);
      setEditUser(null);
      refetch();
    } catch (err: any) {
      toast({ title: "Failed to update user", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const availableRoles = (roles.length > 0
    ? roles.map(r => ({ value: r.name, label: r.displayName }))
    : Object.entries(roleBadge).map(([k, v]) => ({ value: k, label: v.label }))
  ).filter(r => r.value !== "student");

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">All Users</h2>
          <p className="text-muted-foreground text-sm mt-0.5">{nonStudentUsers?.length || 0} users in the system</p>
        </div>
        <Button className="rounded-xl gap-2" onClick={() => setCreateOpen(true)}>
          <UserPlus className="w-4 h-4" /> Create User
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email..." className="pl-10 rounded-xl" />
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setRoleFilter("all")}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${roleFilter === "all" ? "bg-primary text-white shadow-sm" : "bg-secondary hover:bg-secondary/80"}`}>
            All
          </button>
          {["staff", "agent", "admin"].map(r => (
            <button key={r} onClick={() => setRoleFilter(r)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all capitalize ${roleFilter === r ? "bg-primary text-white shadow-sm" : "bg-secondary hover:bg-secondary/80"}`}>
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Users", value: nonStudentUsers.length || 0, icon: Users, color: "text-blue-500 bg-blue-50" },
          { label: "Staff", value: nonStudentUsers.filter((u: any) => ['staff', 'consultant', 'accountant'].includes(u.role)).length, icon: Shield, color: "text-purple-500 bg-purple-50" },
          { label: "Admins", value: nonStudentUsers.filter((u: any) => ['super_admin', 'admin', 'manager'].includes(u.role)).length, icon: Shield, color: "text-green-500 bg-green-50" },
          { label: "Agents", value: nonStudentUsers.filter((u: any) => ['agent', 'sub_agent'].includes(u.role)).length, icon: Users, color: "text-amber-500 bg-amber-50" },
        ].map((s, i) => (
          <Card key={i} className="p-4 border-none shadow-md shadow-black/5 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-xl ${s.color} flex items-center justify-center shrink-0`}>
              <s.icon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-xl font-display font-bold">{isLoading ? "..." : s.value}</p>
            </div>
          </Card>
        ))}
      </div>

      <Card className="border-none shadow-lg shadow-black/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-secondary/50 text-left">
                <UserSortHeader label="User" sortKey="user" currentSort={sort} onSort={handleSort} />
                <UserSortHeader label="Email" sortKey="email" currentSort={sort} onSort={handleSort} />
                <UserSortHeader label="Role" sortKey="role" currentSort={sort} onSort={handleSort} />
                <UserSortHeader label="Status" sortKey="status" currentSort={sort} onSort={handleSort} />
                <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i}>
                    {[...Array(5)].map((_, j) => (
                      <td key={j} className="px-6 py-4">
                        <div className="h-4 bg-secondary animate-pulse rounded-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : pagedUsers.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-16 text-center text-muted-foreground">No users found</td></tr>
              ) : pagedUsers.map(user => {
                const badge = roleBadge[user.role] || { color: "bg-secondary text-foreground border-border", label: user.role };
                const initials = `${user.firstName?.[0] || ''}${user.lastName?.[0] || user.email?.[0] || '?'}`.toUpperCase();
                return (
                  <tr key={user.id} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {user.avatarUrl ? (
                          <img src={user.avatarUrl} alt={`${user.firstName || ''} ${user.lastName || ''}`.trim() || 'User avatar'} width={40} height={40} loading="lazy" className="w-10 h-10 rounded-full object-cover" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-primary/30 to-accent/30 flex items-center justify-center font-bold text-sm text-foreground">
                            {initials}
                          </div>
                        )}
                        <div>
                          <p className="font-semibold text-foreground text-sm">{user.firstName} {user.lastName}</p>
                          <p className="text-xs text-muted-foreground">ID #{user.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Mail className="w-4 h-4 shrink-0" />
                        {user.email || "—"}
                      </div>
                      <div className="mt-1">
                        <QuickContactButtons
                          name={`${user.firstName || ''} ${user.lastName || ''}`.trim()}
                          email={user.email}
                          phone={user.phone}
                          entityType="agent"
                          entityId={user.id}
                        />
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Badge className={`text-xs border ${badge.color}`}>{badge.label}</Badge>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant={user.isActive ? "default" : "secondary"}
                        className={user.isActive ? "bg-green-500/10 text-green-600 border-green-200" : "bg-secondary text-muted-foreground"}>
                        {user.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" className="w-8 h-8 rounded-lg hover:bg-primary/10 hover:text-primary"
                          onClick={() => openEditDialog(user)}>
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost" className="w-8 h-8 rounded-lg">
                              <MoreHorizontal className="w-3.5 h-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem onClick={() => { setPasswordDialog({ userId: user.id, userName: `${user.firstName} ${user.lastName}` }); setNewPassword(""); }}>
                              <KeyRound className="w-4 h-4 mr-2" /> Set Password
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleImpersonate(user)}>
                              <LogIn className="w-4 h-4 mr-2" /> Login as {user.firstName}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleToggleStatus(user)}>
                              {user.isActive ? (
                                <><ShieldOff className="w-4 h-4 mr-2" /> Deactivate</>
                              ) : (
                                <><ShieldCheck className="w-4 h-4 mr-2" /> Activate</>
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDelete(user.id)}>
                              <Trash2 className="w-4 h-4 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <TablePagination
          currentPage={pg.page}
          totalItems={totalFilteredUsers}
          pageSize={pg.pageSize}
          onPageChange={pg.setPage}
          onPageSizeChange={pg.setPageSize}
        />
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5" /> Create New User
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>First Name *</Label>
                <Input value={createForm.firstName} onChange={e => setCreateForm(f => ({ ...f, firstName: e.target.value }))}
                  placeholder="John" />
              </div>
              <div className="space-y-2">
                <Label>Last Name *</Label>
                <Input value={createForm.lastName} onChange={e => setCreateForm(f => ({ ...f, lastName: e.target.value }))}
                  placeholder="Doe" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Email *</Label>
              <Input type="email" value={createForm.email} onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))}
                placeholder="john@example.com" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={createForm.role} onValueChange={v => setCreateForm(f => ({ ...f, role: v }))}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableRoles.map(r => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Language</Label>
                <Select value={createForm.language} onValueChange={v => setCreateForm(f => ({ ...f, language: v }))}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="tr">Turkish</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <div className="flex gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="h-10 gap-1.5 px-2.5 min-w-[100px] shrink-0">
                      <CountryFlag code={PHONE_CODES.find(p => p.code === createForm.phoneCode)?.country || "TR"} size="sm" />
                      <span className="text-xs">{createForm.phoneCode}</span>
                      <ChevronDown className="w-3 h-3 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="max-h-60 overflow-y-auto w-36">
                    {PHONE_CODES.map(pc => (
                      <DropdownMenuItem key={pc.code} onClick={() => setCreateForm(f => ({ ...f, phoneCode: pc.code }))} className="gap-2 text-xs">
                        <CountryFlag code={pc.country} size="sm" /> {pc.code}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Input value={createForm.phone} onChange={e => setCreateForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="555 123 4567" className="flex-1" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Password</Label>
              <Input type="password" value={createForm.password} onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))}
                placeholder="Min. 6 characters" />
              <p className="text-[11px] text-muted-foreground">Leave empty to create without password (user can set via forgot password)</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? "Creating..." : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={o => { if (!o) { setEditOpen(false); setEditUser(null); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit2 className="w-5 h-5" /> Edit User
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>First Name *</Label>
                <Input value={editForm.firstName} onChange={e => setEditForm(f => ({ ...f, firstName: e.target.value }))}
                  placeholder="John" />
              </div>
              <div className="space-y-2">
                <Label>Last Name *</Label>
                <Input value={editForm.lastName} onChange={e => setEditForm(f => ({ ...f, lastName: e.target.value }))}
                  placeholder="Doe" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Email *</Label>
              <Input type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                placeholder="john@example.com" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={editForm.role} onValueChange={v => setEditForm(f => ({ ...f, role: v }))}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableRoles.map(r => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Language</Label>
                <Select value={editForm.language} onValueChange={v => setEditForm(f => ({ ...f, language: v }))}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="tr">Turkish</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <div className="flex gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="h-10 gap-1.5 px-2.5 min-w-[100px] shrink-0">
                      <CountryFlag code={PHONE_CODES.find(p => p.code === editForm.phoneCode)?.country || "TR"} size="sm" />
                      <span className="text-xs">{editForm.phoneCode}</span>
                      <ChevronDown className="w-3 h-3 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="max-h-60 overflow-y-auto w-36">
                    {PHONE_CODES.map(pc => (
                      <DropdownMenuItem key={pc.code} onClick={() => setEditForm(f => ({ ...f, phoneCode: pc.code }))} className="gap-2 text-xs">
                        <CountryFlag code={pc.country} size="sm" /> {pc.code}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Input value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="555 123 4567" className="flex-1" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label>Status</Label>
              <div className="flex items-center gap-2">
                <span className={`text-sm ${editForm.isActive ? "text-green-600" : "text-muted-foreground"}`}>
                  {editForm.isActive ? "Active" : "Inactive"}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={editForm.isActive}
                  onClick={() => setEditForm(f => ({ ...f, isActive: !f.isActive }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${editForm.isActive ? "bg-green-500" : "bg-gray-300"}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${editForm.isActive ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditOpen(false); setEditUser(null); }}>Cancel</Button>
            <Button onClick={handleEditSave} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!passwordDialog} onOpenChange={o => { if (!o) { setPasswordDialog(null); setNewPassword(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-5 h-5" /> Set Password
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Set a new password for <strong>{passwordDialog?.userName}</strong>
          </p>
          <div className="space-y-2">
            <Label>New Password</Label>
            <Input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="Minimum 6 characters"
              onKeyDown={e => { if (e.key === "Enter") handleSetPassword(); }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPasswordDialog(null); setNewPassword(""); }}>Cancel</Button>
            <Button onClick={handleSetPassword} disabled={passwordSaving || newPassword.length < 6}>
              {passwordSaving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</> : "Set Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RolesTab() {
  const [roles, setRoles] = useState<RoleData[]>([]);
  const [permSchema, setPermSchema] = useState<PermSchema>({});
  const [loading, setLoading] = useState(true);
  const [selectedRole, setSelectedRole] = useState<RoleData | null>(null);
  const [editPerms, setEditPerms] = useState<string[]>([]);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editColor, setEditColor] = useState("blue");
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleDisplay, setNewRoleDisplay] = useState("");
  const [newRoleDesc, setNewRoleDesc] = useState("");
  const [newRoleColor, setNewRoleColor] = useState("blue");
  const { toast } = useToast();

  const fetchRoles = useCallback(async () => {
    try {
      const [rolesRes, schemaRes] = await Promise.all([
        customFetch("/api/roles"),
        customFetch("/api/roles/permissions-schema"),
      ]);
      setRoles((rolesRes as any)?.data || rolesRes || []);
      setPermSchema((schemaRes as any)?.data || schemaRes || {});
    } catch {
      toast({ title: "Failed to load roles", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchRoles(); }, [fetchRoles]);

  const selectRole = (role: RoleData) => {
    setSelectedRole(role);
    setEditPerms([...(role.permissions || [])]);
    setEditDisplayName(role.displayName);
    setEditDescription(role.description || "");
    setEditColor(role.color);
    setExpandedCats(new Set(Object.keys(permSchema)));
  };

  const toggleCat = (cat: string) => {
    setExpandedCats(prev => {
      const n = new Set(prev);
      n.has(cat) ? n.delete(cat) : n.add(cat);
      return n;
    });
  };

  const togglePerm = (perm: string) => {
    setEditPerms(prev => prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm]);
  };

  const toggleAllInCat = (cat: string) => {
    const catPerms = Object.keys(permSchema[cat]?.permissions || {});
    const allChecked = catPerms.every(p => editPerms.includes(p));
    if (allChecked) {
      setEditPerms(prev => prev.filter(p => !catPerms.includes(p)));
    } else {
      setEditPerms(prev => [...new Set([...prev, ...catPerms])]);
    }
  };

  const selectAll = () => {
    const allPerms: string[] = [];
    Object.values(permSchema).forEach(cat => {
      allPerms.push(...Object.keys(cat.permissions));
    });
    setEditPerms(allPerms);
  };

  const deselectAll = () => setEditPerms([]);

  const saveRole = async () => {
    if (!selectedRole) return;
    setSaving(true);
    try {
      await customFetch(`/api/roles/${selectedRole.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: editDisplayName,
          description: editDescription,
          color: editColor,
          permissions: editPerms,
        }),
      });
      toast({ title: "Role updated successfully" });
      fetchRoles();
    } catch (err: any) {
      toast({ title: "Failed to update role", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const createRole = async () => {
    if (!newRoleName.trim() || !newRoleDisplay.trim()) {
      toast({ title: "Name and display name are required", variant: "destructive" });
      return;
    }
    try {
      await customFetch("/api/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newRoleName,
          displayName: newRoleDisplay,
          description: newRoleDesc,
          color: newRoleColor,
          permissions: [],
        }),
      });
      toast({ title: "Role created successfully" });
      setCreateOpen(false);
      setNewRoleName("");
      setNewRoleDisplay("");
      setNewRoleDesc("");
      setNewRoleColor("blue");
      fetchRoles();
    } catch (err: any) {
      toast({ title: "Failed to create role", description: err.message, variant: "destructive" });
    }
  };

  const deleteRole = async (role: RoleData) => {
    if (role.isSystem) {
      toast({ title: "System roles cannot be deleted", variant: "destructive" });
      return;
    }
    if (!window.confirm(`Delete role "${role.displayName}"? Users with this role will need to be reassigned.`)) return;
    try {
      await customFetch(`/api/roles/${role.id}`, { method: "DELETE" });
      toast({ title: "Role deleted" });
      if (selectedRole?.id === role.id) setSelectedRole(null);
      fetchRoles();
    } catch (err: any) {
      toast({ title: "Failed to delete role", description: err.message, variant: "destructive" });
    }
  };

  const totalPerms = Object.values(permSchema).reduce((sum, cat) => sum + Object.keys(cat.permissions).length, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Roles & Permissions</h2>
          <p className="text-muted-foreground text-sm mt-0.5">{roles.length} roles configured — {totalPerms} available permissions</p>
        </div>
        <Button className="rounded-xl gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" /> Create Role
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 space-y-3">
          {roles.map(role => {
            const colorCls = roleColors[role.color] || roleColors.blue;
            const isActive = selectedRole?.id === role.id;
            return (
              <Card
                key={role.id}
                onClick={() => selectRole(role)}
                className={`p-4 cursor-pointer transition-all border-2 ${isActive ? "border-primary shadow-md" : "border-transparent hover:border-border shadow-sm"}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${colorCls}`}>
                      {role.isSystem ? <ShieldCheck className="w-5 h-5" /> : <Shield className="w-5 h-5" />}
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-foreground">{role.displayName}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{role.name}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {role.isSystem && (
                      <Badge variant="outline" className="text-[10px] h-5">System</Badge>
                    )}
                    {!role.isSystem && (
                      <Button size="icon" variant="ghost" className="w-7 h-7 text-muted-foreground hover:text-destructive"
                        onClick={(e) => { e.stopPropagation(); deleteRole(role); }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
                {role.description && (
                  <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{role.description}</p>
                )}
                <div className="flex items-center gap-2 mt-3">
                  <Badge variant="secondary" className="text-[10px] h-5">
                    {(role.permissions as string[])?.length || 0} / {totalPerms} permissions
                  </Badge>
                </div>
              </Card>
            );
          })}
        </div>

        <div className="lg:col-span-8">
          {!selectedRole ? (
            <Card className="border-none shadow-lg shadow-black/5 flex flex-col items-center justify-center py-24">
              <Settings2 className="w-12 h-12 text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground font-medium">Select a role to manage permissions</p>
              <p className="text-sm text-muted-foreground/60 mt-1">Click on a role from the left panel</p>
            </Card>
          ) : (
            <Card className="border-none shadow-lg shadow-black/5 overflow-hidden">
              <div className="p-6 border-b border-border/50">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <Lock className="w-5 h-5 text-primary" />
                    Edit: {editDisplayName}
                  </h3>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={selectAll} className="text-xs h-8">Select All</Button>
                    <Button variant="outline" size="sm" onClick={deselectAll} className="text-xs h-8">Deselect All</Button>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs">Display Name</Label>
                    <Input value={editDisplayName} onChange={e => setEditDisplayName(e.target.value)}
                      className="h-9 rounded-lg" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Color</Label>
                    <Select value={editColor} onValueChange={setEditColor}>
                      <SelectTrigger className="h-9 rounded-lg">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.keys(roleColors).map(c => (
                          <SelectItem key={c} value={c}>
                            <div className="flex items-center gap-2">
                              <div className={`w-3 h-3 rounded-full bg-${c}-500`} />
                              <span className="capitalize">{c}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="sm:col-span-2 space-y-2">
                    <Label className="text-xs">Description</Label>
                    <Input value={editDescription} onChange={e => setEditDescription(e.target.value)}
                      className="h-9 rounded-lg" placeholder="Role description..." />
                  </div>
                </div>
              </div>

              <div className="p-4 max-h-[500px] overflow-y-auto">
                <div className="space-y-1">
                  {Object.entries(permSchema).map(([catKey, cat]) => {
                    const catPerms = Object.keys(cat.permissions);
                    const checkedCount = catPerms.filter(p => editPerms.includes(p)).length;
                    const allChecked = checkedCount === catPerms.length;
                    const someChecked = checkedCount > 0 && !allChecked;
                    const isExpanded = expandedCats.has(catKey);

                    return (
                      <div key={catKey} className="rounded-xl overflow-hidden">
                        <button
                          onClick={() => toggleCat(catKey)}
                          className="w-full flex items-center justify-between px-4 py-3 hover:bg-secondary/50 transition-colors rounded-xl"
                        >
                          <div className="flex items-center gap-3">
                            {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                            <span className="font-medium text-sm">{cat.label}</span>
                            <Badge variant="secondary" className="text-[10px] h-5 px-2">
                              {checkedCount}/{catPerms.length}
                            </Badge>
                          </div>
                          <div
                            onClick={(e) => { e.stopPropagation(); toggleAllInCat(catKey); }}
                            className={`w-5 h-5 rounded border-2 flex items-center justify-center cursor-pointer transition-colors ${allChecked ? "bg-primary border-primary" : someChecked ? "border-primary bg-primary/20" : "border-muted-foreground/30"}`}
                          >
                            {allChecked && <Check className="w-3 h-3 text-white" />}
                            {someChecked && !allChecked && <div className="w-2 h-0.5 bg-primary rounded" />}
                          </div>
                        </button>
                        {isExpanded && (
                          <div className="pl-11 pr-4 pb-3 space-y-1">
                            {Object.entries(cat.permissions).map(([permKey, permLabel]) => {
                              const checked = editPerms.includes(permKey);
                              return (
                                <div
                                  key={permKey}
                                  onClick={() => togglePerm(permKey)}
                                  className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-secondary/40 cursor-pointer transition-colors"
                                >
                                  <div>
                                    <p className="text-sm text-foreground">{permLabel}</p>
                                    <p className="text-[11px] text-muted-foreground/60 font-mono">{permKey}</p>
                                  </div>
                                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${checked ? "bg-primary border-primary" : "border-muted-foreground/30"}`}>
                                    {checked && <Check className="w-3 h-3 text-white" />}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="p-4 border-t border-border/50 flex items-center justify-between bg-secondary/20">
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">{editPerms.length}</span> of {totalPerms} permissions enabled
                </p>
                <Button onClick={saveRole} disabled={saving} className="rounded-xl gap-2">
                  {saving ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5" /> Create New Role
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Role Name (slug) *</Label>
              <Input value={newRoleName} onChange={e => setNewRoleName(e.target.value)}
                placeholder="e.g. marketing_manager" />
              <p className="text-xs text-muted-foreground">Lowercase letters, numbers, underscores only</p>
            </div>
            <div className="space-y-2">
              <Label>Display Name *</Label>
              <Input value={newRoleDisplay} onChange={e => setNewRoleDisplay(e.target.value)}
                placeholder="e.g. Marketing Manager" />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={newRoleDesc} onChange={e => setNewRoleDesc(e.target.value)}
                placeholder="What this role is for..." />
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {Object.keys(roleColors).map(c => (
                  <button key={c} onClick={() => setNewRoleColor(c)}
                    className={`w-8 h-8 rounded-lg border-2 transition-all flex items-center justify-center ${newRoleColor === c ? "border-primary scale-110" : "border-transparent"}`}
                    style={{ backgroundColor: `var(--${c}-100, #e5e7eb)` }}
                  >
                    <div className={`w-4 h-4 rounded-full bg-${c}-500`} />
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createRole}>Create Role</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AdminUsers() {
  return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-display font-bold text-foreground">User Management</h1>
        </div>

        <Tabs defaultValue="users" className="space-y-6">
          <TabsList className="h-10">
            <TabsTrigger value="users" className="gap-2 px-4">
              <Users className="w-4 h-4" />
              Users
            </TabsTrigger>
            <TabsTrigger value="roles" className="gap-2 px-4">
              <Shield className="w-4 h-4" />
              Roles & Permissions
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users">
            <UsersTab />
          </TabsContent>
          <TabsContent value="roles">
            <RolesTab />
          </TabsContent>
        </Tabs>
      </div>
  );
}
