import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { useSeo } from "@/hooks/use-seo";
import { useSeason, SEASON_YEARS } from "@/contexts/SeasonContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  SidebarProvider, 
  Sidebar, 
  SidebarContent, 
  SidebarGroup, 
  SidebarGroupContent, 
  SidebarGroupLabel, 
  SidebarMenu, 
  SidebarMenuItem, 
  SidebarMenuButton,
  SidebarTrigger
} from "@/components/ui/sidebar";
import { 
  LayoutDashboard, 
  Users, 
  GraduationCap, 
  FileText, 
  FolderOpen,
  Briefcase, 
  Settings, 
  Shield,
  UserCheck,
  DollarSign,
  Activity,
  Link2,
  TrendingUp,
  Library,
  UserCircle,
  CalendarDays,
  Search,
  Sun,
  Moon,
  Handshake,
  MessageCircle,
  Code2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NotificationCenter } from "@/components/NotificationCenter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, ChevronUp, User } from "lucide-react";

type MenuItem = { title: string; icon: typeof LayoutDashboard; url: string; group?: string };

function getMenuForRole(role: string): { groups: { label: string; items: MenuItem[] }[] } {
  const FINANCE_ROLES = ['super_admin', 'admin', 'accountant'];
  const showFinance = FINANCE_ROLES.includes(role);

  if (role === 'super_admin' || role === 'admin' || role === 'manager') {
    const opsItems: MenuItem[] = [
      { title: "Leads", icon: Users, url: '/staff/leads' },
      { title: "Students", icon: GraduationCap, url: '/staff/students' },
      { title: "Applications", icon: FileText, url: '/staff/applications' },
      { title: "Documents", icon: FolderOpen, url: '/staff/documents' },
      { title: "Course Finder", icon: Search, url: '/staff/course-finder' },
      { title: "Messages", icon: MessageCircle, url: '/staff/messages' },
      { title: "Agents", icon: Handshake, url: '/staff/agents' },
    ];
    if (showFinance) opsItems.push({ title: "Finance", icon: DollarSign, url: '/staff/finance' });
    return {
      groups: [
        {
          label: "Overview",
          items: [
            { title: "Dashboard", icon: LayoutDashboard, url: '/admin' },
          ]
        },
        {
          label: "Operations",
          items: opsItems
        },
        {
          label: "Admin",
          items: [
            { title: "Catalog", icon: Library, url: '/admin/catalog' },
            { title: "Users", icon: UserCheck, url: '/admin/users' },
            { title: "Audit Log", icon: Activity, url: '/admin/audit' },
            { title: "User Activity", icon: Activity, url: '/admin/activity' },
            { title: "Embeds", icon: Code2, url: '/admin/embeds' },
            { title: "Settings", icon: Settings, url: '/admin/settings' },
          ]
        }
      ]
    };
  }

  if (role === 'staff' || role === 'consultant' || role === 'accountant' || role === 'editor') {
    const workItems: MenuItem[] = [
      { title: "Leads", icon: Users, url: '/staff/leads' },
      { title: "Students", icon: GraduationCap, url: '/staff/students' },
      { title: "Applications", icon: FileText, url: '/staff/applications' },
      { title: "Documents", icon: FolderOpen, url: '/staff/documents' },
      { title: "Course Finder", icon: Search, url: '/staff/course-finder' },
      { title: "Messages", icon: MessageCircle, url: '/staff/messages' },
    ];
    if (showFinance) workItems.push({ title: "Finance", icon: Briefcase, url: '/staff/finance' });
    return {
      groups: [
        {
          label: "Overview",
          items: [
            { title: "Dashboard", icon: LayoutDashboard, url: '/staff' },
          ]
        },
        {
          label: "Work",
          items: workItems
        },
        {
          label: "System",
          items: [
            { title: "Settings", icon: Settings, url: '/staff/settings' },
          ]
        }
      ]
    };
  }

  if (role === 'student') {
    return {
      groups: [
        {
          label: "My Portal",
          items: [
            { title: "Dashboard",        icon: LayoutDashboard, url: '/student' },
            { title: "My Applications",  icon: FileText,        url: '/student/applications' },
            { title: "Course Finder",    icon: Search,          url: '/student/course-finder' },
          ]
        },
        {
          label: "Account",
          items: [
            { title: "My Account",  icon: UserCircle, url: '/student/account' },
          ]
        }
      ]
    };
  }

  if (role === 'agent' || role === 'sub_agent') {
    const agentItems: MenuItem[] = [
      { title: "Dashboard",    icon: LayoutDashboard, url: '/agent' },
      { title: "Leads",        icon: UserCheck,       url: '/agent/leads' },
      { title: "Students",     icon: GraduationCap,   url: '/agent/students' },
      { title: "Applications", icon: FileText,        url: '/agent/applications' },
      { title: "Course Finder", icon: Search,         url: '/staff/course-finder' },
      { title: "Commissions",  icon: TrendingUp,      url: '/agent/commissions' },
    ];
    const accountItems: MenuItem[] = [
      { title: "My Account", icon: UserCircle, url: '/agent/account' },
    ];
    if (role === 'agent') {
      accountItems.push({ title: "Sub Agents", icon: Users, url: '/agent/sub-agents' });
    }
    return {
      groups: [
        { label: "Agent Portal", items: agentItems },
        { label: "Account", items: accountItems },
      ]
    };
  }

  return { groups: [] };
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin", admin: "Admin", manager: "Manager",
  staff: "Staff", consultant: "Consultant", accountant: "Accountant", editor: "Editor",
  student: "Student", agent: "Agent", sub_agent: "Sub Agent",
};

const ROLE_COLORS: Record<string, string> = {
  super_admin: "bg-rose-500/10 text-rose-600", admin: "bg-red-500/10 text-red-600",
  manager: "bg-orange-500/10 text-orange-600", staff: "bg-blue-500/10 text-blue-600",
  consultant: "bg-indigo-500/10 text-indigo-600", accountant: "bg-purple-500/10 text-purple-600",
  student: "bg-green-500/10 text-green-600", agent: "bg-amber-500/10 text-amber-600",
};

export function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth(true);
  const [location] = useLocation();
  const { t } = useI18n();
  useSeo({ title: "Portal", noindex: true });
  const { season, setSeason } = useSeason();
  const { mode, setMode, resolvedTheme, settings: themeSettings } = useTheme();
  const isAgentRole = !!user && (user.role === "agent" || user.role === "sub_agent");

  const { data: agentProfile } = useQuery({
    queryKey: ["agent-me"],
    enabled: isAgentRole,
    queryFn: () => customFetch<any>("/api/agents/me"),
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading || !user) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin w-10 h-10 border-4 border-primary border-t-transparent rounded-full" />
          <p className="text-muted-foreground font-medium text-sm">Loading portal...</p>
        </div>
      </div>
    );
  }

  const { groups } = getMenuForRole(user.role);
  const allItems = groups.flatMap(g => g.items);
  const activeItem = allItems.find(i => {
    if (i.url === '/staff' || i.url === '/admin' || i.url === '/student' || i.url === '/agent') {
      return location === i.url;
    }
    return location.startsWith(i.url);
  });
  const roleBadgeColor = ROLE_COLORS[user.role] || "bg-secondary text-muted-foreground";
  const initials = `${user.firstName?.[0] || ''}${user.lastName?.[0] || user.email?.[0] || '?'}`.toUpperCase();
  const isOperationalRole = ["super_admin","admin","manager","staff","consultant","accountant","editor","agent","sub_agent"].includes(user.role);

  const systemLogo = resolvedTheme === "dark" && themeSettings.logoDarkUrl
    ? themeSettings.logoDarkUrl
    : themeSettings.logoUrl || null;

  const sidebarLogo = (isAgentRole && agentProfile?.logoUrl) ? agentProfile.logoUrl : systemLogo;

  return (
    <SidebarProvider style={{ "--sidebar-width": "16rem" } as React.CSSProperties}>
      <div className="flex min-h-screen w-full bg-secondary/20">
        <Sidebar className="border-r border-border/60 shadow-sm">
          <SidebarContent className="bg-card">
            {/* Logo */}
            <div className="p-5 pb-4 border-b border-border/40">
               <Link href="/" className="flex items-center gap-2.5 group">
                {sidebarLogo ? (
                  <img src={sidebarLogo} alt="Logo" className="h-9 max-w-[120px] object-contain group-hover:scale-105 transition-transform" />
                ) : (
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white shadow-md group-hover:scale-105 transition-transform">
                    <GraduationCap className="w-5 h-5" />
                  </div>
                )}
                <div>
                  {!sidebarLogo && <span className="font-display font-bold text-lg tracking-tight text-foreground leading-none">EduCons</span>}
                  <div className={`text-xs font-semibold px-1.5 py-0.5 rounded-md mt-0.5 inline-block ${roleBadgeColor}`}>
                    {ROLE_LABELS[user.role] || user.role}
                  </div>
                </div>
              </Link>
            </div>

            {/* Navigation */}
            <div className="px-3 pt-4 pb-4 flex-1 overflow-y-auto space-y-4">
              {groups.map(group => (
                <SidebarGroup key={group.label} className="p-0">
                  <SidebarGroupLabel className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1 px-3">
                    {group.label}
                  </SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu className="space-y-0.5">
                      {group.items.map(item => {
                        const isActive = item.url === location || 
                          (item.url !== '/staff' && item.url !== '/admin' && item.url !== '/student' && item.url !== '/agent' && location.startsWith(item.url));
                        return (
                          <SidebarMenuItem key={item.title}>
                            <SidebarMenuButton
                              asChild
                              data-active={isActive}
                              className="w-full justify-start gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 hover:bg-primary/5 data-[active=true]:bg-primary/10 data-[active=true]:text-primary font-medium text-muted-foreground hover:text-foreground data-[active=true]:font-semibold text-sm"
                            >
                              <Link href={item.url}>
                                <item.icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-primary' : ''}`} />
                                <span>{item.title}</span>
                              </Link>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              ))}
            </div>

            {/* User Bottom */}
            <div className="p-3 border-t border-border/40">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-secondary/50 transition-colors cursor-pointer text-left">
                    {user.avatarUrl ? (
                      <img src={user.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover ring-2 ring-primary/20" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-primary/30 to-accent/30 flex items-center justify-center font-bold text-sm text-primary ring-2 ring-primary/20">
                        {initials}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{user.firstName} {user.lastName}</p>
                      <p className="text-xs text-muted-foreground truncate">{user.email || `ID #${user.id}`}</p>
                    </div>
                    <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-56 mb-1">
                  <DropdownMenuItem asChild>
                    <Link href={['super_admin','admin','manager'].includes(user.role) ? '/admin/settings' : ['agent','sub_agent'].includes(user.role) ? '/agent/account' : user.role === 'student' ? '/student/account' : '/staff/settings'}>
                      <User className="w-4 h-4 mr-2" />
                      Profile & Settings
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild className="text-destructive focus:text-destructive">
                    <a href="/api/auth/logout">
                      <LogOut className="w-4 h-4 mr-2" />
                      Sign Out
                    </a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </SidebarContent>
        </Sidebar>

        {/* Main Content */}
        <div className="flex flex-col flex-1 overflow-hidden min-w-0">
          <header className="h-14 flex items-center justify-between px-5 bg-card/80 backdrop-blur-sm border-b border-border/50 sticky top-0 z-30">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="text-muted-foreground hover:text-foreground transition-colors" />
              <div className="h-5 w-px bg-border" />
              <h1 className="font-display font-bold text-base text-foreground hidden sm:block">
                {activeItem?.title || 'Portal'}
              </h1>
            </div>
            <div className="flex items-center gap-3">
              {isOperationalRole && (
                <div className="flex items-center gap-1.5 bg-primary/8 border border-primary/20 rounded-lg px-2 py-1">
                  <CalendarDays className="w-3.5 h-3.5 text-primary shrink-0" />
                  <Select value={season} onValueChange={setSeason}>
                    <SelectTrigger className="h-6 border-0 bg-transparent p-0 text-xs font-bold text-primary shadow-none focus:ring-0 w-[52px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end">
                      {SEASON_YEARS.map(y => (
                        <SelectItem key={y} value={y} className="text-sm font-medium">{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <NotificationCenter />
              <Button size="icon" variant="ghost" className="w-8 h-8 rounded-lg"
                onClick={() => setMode(resolvedTheme === "dark" ? "light" : "dark")}
                title={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
                {resolvedTheme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
              <Badge className={`hidden sm:flex text-xs font-semibold border-0 ${roleBadgeColor}`}>
                <Shield className="w-3 h-3 mr-1" />
                {ROLE_LABELS[user.role] || user.role}
              </Badge>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto p-5 lg:p-7">
            <div className="max-w-7xl mx-auto">
              {children}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
