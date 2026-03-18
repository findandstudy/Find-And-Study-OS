import { useState, useEffect, useCallback } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useListUsers } from "@workspace/api-client-react";
import { customFetch } from "@workspace/api-client-react";
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
  Search, Users, UserPlus, Shield, MoreHorizontal, Mail, Edit2,
  Plus, Trash2, ChevronDown, ChevronRight, Check, X, Eye, Lock,
  Settings2, ShieldCheck
} from "lucide-react";

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

function UsersTab() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const { data: usersResp, isLoading, refetch } = useListUsers({ query: { queryKey: ['admin-users'] } });
  const users: any[] = (usersResp as any)?.data || usersResp || [];
  const [roles, setRoles] = useState<RoleData[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ firstName: "", lastName: "", email: "", role: "staff", phone: "", language: "en" });
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    customFetch("/api/roles").then((res: any) => {
      setRoles(res?.data || res || []);
    }).catch(() => {});
  }, []);

  const filtered = users.filter((u: any) => {
    const matchSearch = !search ||
      (u.firstName || "").toLowerCase().includes(search.toLowerCase()) ||
      (u.email || "").toLowerCase().includes(search.toLowerCase());
    const matchRole = roleFilter === "all" || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  const handleCreate = async () => {
    if (!createForm.email || !createForm.firstName || !createForm.lastName) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      await customFetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createForm),
      });
      toast({ title: "User created successfully" });
      setCreateOpen(false);
      setCreateForm({ firstName: "", lastName: "", email: "", role: "staff", phone: "", language: "en" });
      refetch();
    } catch (err: any) {
      toast({ title: "Failed to create user", description: err.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const availableRoles = roles.length > 0
    ? roles.map(r => ({ value: r.name, label: r.displayName }))
    : Object.entries(roleBadge).map(([k, v]) => ({ value: k, label: v.label }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">All Users</h2>
          <p className="text-muted-foreground text-sm mt-0.5">{users?.length || 0} users in the system</p>
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
          {["staff", "student", "agent", "admin"].map(r => (
            <button key={r} onClick={() => setRoleFilter(r)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all capitalize ${roleFilter === r ? "bg-primary text-white shadow-sm" : "bg-secondary hover:bg-secondary/80"}`}>
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Users", value: users.length || 0, icon: Users, color: "text-blue-500 bg-blue-50" },
          { label: "Staff", value: users.filter((u: any) => ['staff', 'consultant', 'accountant'].includes(u.role)).length, icon: Shield, color: "text-purple-500 bg-purple-50" },
          { label: "Students", value: users.filter((u: any) => u.role === 'student').length, icon: Users, color: "text-green-500 bg-green-50" },
          { label: "Agents", value: users.filter((u: any) => ['agent', 'sub_agent'].includes(u.role)).length, icon: Users, color: "text-amber-500 bg-amber-50" },
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
                <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">User</th>
                <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Email</th>
                <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Role</th>
                <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">Status</th>
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
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-16 text-center text-muted-foreground">No users found</td></tr>
              ) : filtered.map(user => {
                const badge = roleBadge[user.role] || { color: "bg-secondary text-foreground border-border", label: user.role };
                const initials = `${user.firstName?.[0] || ''}${user.lastName?.[0] || user.email?.[0] || '?'}`.toUpperCase();
                return (
                  <tr key={user.id} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {user.avatarUrl ? (
                          <img src={user.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
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
                      <div className="flex items-center gap-2">
                        <Button size="icon" variant="ghost" className="w-8 h-8 rounded-lg hover:bg-primary/10 hover:text-primary">
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="w-8 h-8 rounded-lg">
                          <MoreHorizontal className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
              <Input value={createForm.phone} onChange={e => setCreateForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="+1 234 567 890" />
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
    <DashboardLayout>
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
    </DashboardLayout>
  );
}
