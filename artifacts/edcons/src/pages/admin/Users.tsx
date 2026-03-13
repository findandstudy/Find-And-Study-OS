import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useListUsers } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Users, UserPlus, Shield, MoreHorizontal, Mail, Edit2 } from "lucide-react";

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

export default function AdminUsers() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const { data: usersResp, isLoading } = useListUsers({ query: { queryKey: ['admin-users'] } });
  const users: any[] = (usersResp as any)?.data || usersResp || [];

  const filtered = users.filter((u: any) => {
    const matchSearch = !search || 
      (u.firstName || "").toLowerCase().includes(search.toLowerCase()) ||
      (u.email || "").toLowerCase().includes(search.toLowerCase());
    const matchRole = roleFilter === "all" || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  const roleGroups = Object.keys(roleBadge);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">User Management</h1>
            <p className="text-muted-foreground text-sm mt-1">{users?.length || 0} users in the system</p>
          </div>
          <Button className="rounded-xl gap-2">
            <UserPlus className="w-4 h-4" /> Invite User
          </Button>
        </div>

        {/* Filters */}
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

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Total Users", value: users.length || 0, icon: Users, color: "text-blue-500 bg-blue-50" },
            { label: "Staff", value: users.filter((u: any) => ['staff','consultant','accountant'].includes(u.role)).length, icon: Shield, color: "text-purple-500 bg-purple-50" },
            { label: "Students", value: users.filter((u: any) => u.role === 'student').length, icon: Users, color: "text-green-500 bg-green-50" },
            { label: "Agents", value: users.filter((u: any) => ['agent','sub_agent'].includes(u.role)).length, icon: Users, color: "text-amber-500 bg-amber-50" },
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

        {/* Table */}
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
      </div>
    </DashboardLayout>
  );
}
