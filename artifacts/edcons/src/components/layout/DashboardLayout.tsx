import { ReactNode, useEffect, createContext, useContext } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { useSeo } from "@/hooks/use-seo";
import { useSeason } from "@/contexts/SeasonContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  Heart,
  MessageSquare,
  ArrowLeftCircle,
  Globe,
  Component,
  Menu,
  BookOpen,
  Layers,
  ClipboardList,
  Megaphone,
  Palette,
  Languages,
  History,
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

const DashboardLayoutMountedCtx = createContext(false);

type MenuItem = { title: string; icon: typeof LayoutDashboard; url: string; group?: string; permKey?: string };
type TFunc = (key: string, params?: Record<string, string | number>) => string;

function getMenuForRole(role: string, t: TFunc, agentStaffPerms?: string[]): { groups: { label: string; items: MenuItem[] }[] } {
  const FINANCE_ROLES = ['super_admin', 'admin', 'accountant'];
  const showFinance = FINANCE_ROLES.includes(role);

  if (role === 'super_admin' || role === 'admin' || role === 'manager') {
    const opsItems: MenuItem[] = [
      { title: t("dashboard.leads"), icon: Users, url: '/staff/leads' },
      { title: t("dashboard.students"), icon: GraduationCap, url: '/staff/students' },
      { title: t("dashboard.applications"), icon: FileText, url: '/staff/applications' },
      { title: t("dashboard.documents"), icon: FolderOpen, url: '/staff/documents' },
      { title: t("dashboard.courseFinder"), icon: Search, url: '/staff/course-finder' },
      { title: t("dashboard.messages"), icon: MessageCircle, url: '/staff/messages' },
      { title: t("dashboard.agents"), icon: Handshake, url: '/staff/agents' },
      { title: t("dashboard.tasks"), icon: ClipboardList, url: '/staff/tasks' },
    ];
    if (showFinance) opsItems.push({ title: t("dashboard.finance"), icon: DollarSign, url: '/staff/finance' });
    const groups = [
      {
        label: t("dashboard.overview"),
        items: [
          { title: t("dashboard.dashboard"), icon: LayoutDashboard, url: '/admin' },
        ]
      },
      {
        label: t("dashboard.operations"),
        items: opsItems
      },
      {
        label: t("dashboard.admin"),
        items: [
          { title: t("dashboard.catalog"), icon: Library, url: '/admin/catalog' },
          { title: t("dashboard.campaigns"), icon: Megaphone, url: '/admin/campaigns' },
          { title: t("dashboard.users"), icon: UserCheck, url: '/admin/users' },
          { title: t("dashboard.auditLog"), icon: Activity, url: '/admin/audit' },
          { title: t("dashboard.userActivity"), icon: Activity, url: '/admin/activity' },
          { title: t("dashboard.embeds"), icon: Code2, url: '/admin/embeds' },
          { title: t("dashboard.settings"), icon: Settings, url: '/admin/settings' },
        ]
      },
    ];
    if (role === 'super_admin' || role === 'admin') {
      groups.push({
        label: "Website",
        items: [
          { title: "Pages", icon: FileText, url: '/admin/website/pages' },
          { title: "Global Components", icon: Component, url: '/admin/website/global-components' },
          { title: "Navigation", icon: Menu, url: '/admin/website/navigation' },
          { title: "Blog", icon: BookOpen, url: '/admin/website/blog' },
          { title: "Collections", icon: Layers, url: '/admin/website/collections' },
          { title: "Forms", icon: ClipboardList, url: '/admin/website/forms' },
          { title: "SEO Overrides", icon: Search, url: '/admin/website/seo' },
          { title: "Theme Builder", icon: Palette, url: '/admin/website/theme' },
          { title: "Translations", icon: Languages, url: '/admin/website/translations' },
          { title: "Publish History", icon: History, url: '/admin/website/publish-history' },
        ]
      });
    }
    return { groups };
  }

  if (role === 'staff' || role === 'consultant' || role === 'accountant' || role === 'editor') {
    const workItems: MenuItem[] = [
      { title: t("dashboard.leads"), icon: Users, url: '/staff/leads' },
      { title: t("dashboard.students"), icon: GraduationCap, url: '/staff/students' },
      { title: t("dashboard.applications"), icon: FileText, url: '/staff/applications' },
      { title: t("dashboard.documents"), icon: FolderOpen, url: '/staff/documents' },
      { title: t("dashboard.courseFinder"), icon: Search, url: '/staff/course-finder' },
      { title: t("dashboard.messages"), icon: MessageCircle, url: '/staff/messages' },
      { title: t("dashboard.tasks"), icon: ClipboardList, url: '/staff/tasks' },
    ];
    if (showFinance) workItems.push({ title: t("dashboard.finance"), icon: Briefcase, url: '/staff/finance' });
    return {
      groups: [
        {
          label: t("dashboard.overview"),
          items: [
            { title: t("dashboard.dashboard"), icon: LayoutDashboard, url: '/staff' },
          ]
        },
        {
          label: t("dashboard.work"),
          items: workItems
        },
        {
          label: t("dashboard.system"),
          items: [
            { title: t("dashboard.settings"), icon: Settings, url: '/staff/settings' },
          ]
        }
      ]
    };
  }

  if (role === 'student') {
    return {
      groups: [
        {
          label: t("dashboard.myPortal"),
          items: [
            { title: t("dashboard.dashboard"),       icon: LayoutDashboard, url: '/student' },
            { title: t("dashboard.wishlist"),        icon: Heart,           url: '/student/wishlist' },
            { title: t("dashboard.myApplications"), icon: FileText,        url: '/student/applications' },
            { title: t("dashboard.messages"),        icon: MessageSquare,   url: '/student/messages' },
            { title: t("dashboard.courseFinder"),   icon: Search,          url: '/student/course-finder' },
          ]
        },
        {
          label: t("dashboard.account"),
          items: [
            { title: t("dashboard.myAccount"), icon: UserCircle, url: '/student/account' },
          ]
        }
      ]
    };
  }

  if (role === 'agent' || role === 'sub_agent' || role === 'agent_staff') {
    let agentItems: MenuItem[] = [
      { title: t("dashboard.dashboard"),    icon: LayoutDashboard, url: '/agent' },
      { title: t("dashboard.leads"),        icon: UserCheck,       url: '/agent/leads',         permKey: 'leads' },
      { title: t("dashboard.students"),     icon: GraduationCap,   url: '/agent/students',      permKey: 'students' },
      { title: t("dashboard.applications"), icon: FileText,        url: '/agent/applications',  permKey: 'applications' },
      { title: t("dashboard.courseFinder"), icon: Search,          url: '/staff/course-finder', permKey: 'course_finder' },
      { title: t("dashboard.messages"),     icon: MessageSquare,   url: '/agent/messages',      permKey: 'messages' },
      { title: t("dashboard.commissions"),  icon: TrendingUp,      url: '/agent/commissions',   permKey: 'commissions' },
    ];
    if (role === 'agent_staff' && agentStaffPerms) {
      agentItems = agentItems.filter(item => !item.permKey || agentStaffPerms.includes(item.permKey));
    }
    const accountItems: MenuItem[] = [
      { title: t("dashboard.myAccount"), icon: UserCircle, url: '/agent/account' },
    ];
    if (role === 'agent') {
      accountItems.push({ title: t("dashboard.subAgents"), icon: Users, url: '/agent/sub-agents' });
    }
    if (role === 'agent' || role === 'sub_agent') {
      accountItems.push({ title: t("dashboard.myTeam"), icon: Briefcase, url: '/agent/team' });
    }
    return {
      groups: [
        { label: t("dashboard.agentPortal"), items: agentItems },
        { label: t("dashboard.account"), items: accountItems },
      ]
    };
  }

  return { groups: [] };
}

function getRoleLabel(role: string, t: TFunc): string {
  const roleKeyMap: Record<string, string> = {
    super_admin: "dashboard.superAdmin", admin: "dashboard.admin", manager: "dashboard.manager",
    staff: "dashboard.staff", consultant: "dashboard.consultant", accountant: "dashboard.accountant", editor: "dashboard.editor",
    student: "dashboard.student", agent: "dashboard.agent", sub_agent: "dashboard.subAgent", agent_staff: "dashboard.staff",
  };
  return roleKeyMap[role] ? t(roleKeyMap[role]) : role;
}

const ROLE_COLORS: Record<string, string> = {
  super_admin: "bg-rose-500/10 text-rose-600", admin: "bg-red-500/10 text-red-600",
  manager: "bg-orange-500/10 text-orange-600", staff: "bg-blue-500/10 text-blue-600",
  consultant: "bg-indigo-500/10 text-indigo-600", accountant: "bg-purple-500/10 text-purple-600",
  student: "bg-green-500/10 text-green-600", agent: "bg-amber-500/10 text-amber-600",
  agent_staff: "bg-teal-500/10 text-teal-600",
};

export function DashboardLayout({ children }: { children: ReactNode }) {
  const isAlreadyMounted = useContext(DashboardLayoutMountedCtx);
  const { user, isLoading } = useAuth(true);
  const [location] = useLocation();
  const { t } = useI18n();
  useSeo({ title: "Portal", noindex: true });
  const { season, setSeason, availableYears } = useSeason();
  const { mode, setMode, resolvedTheme, settings: themeSettings } = useTheme();
  const isAgentRole = !!user && (user.role === "agent" || user.role === "sub_agent" || user.role === "agent_staff");

  const { data: agentProfile } = useQuery({
    queryKey: ["agent-me"],
    enabled: isAgentRole,
    queryFn: () => customFetch<any>("/api/agents/me"),
    staleTime: 5 * 60 * 1000,
  });

  const isStaff = ["super_admin","admin","manager","staff","consultant","editor","accountant"].includes(user?.role || "");
  const isStudent = user?.role === "student";
  const queryClient = useQueryClient();

  const { data: unreadMsgData } = useQuery({
    queryKey: ["unread-messages-count"],
    enabled: isStaff,
    queryFn: async () => {
      const res = await customFetch<{ data: any[] }>("/api/conversations");
      const convs = (res as any)?.data || res || [];
      const total = convs.reduce((sum: number, c: any) => sum + (c.unreadCount || 0), 0);
      return total;
    },
    refetchInterval: 15000,
    staleTime: 10000,
  });

  // Subscribe to the same SSE inbox stream that powers /staff/messages so the
  // unread badge in the side-nav reflects new inbound messages and assignments
  // within ~1s, even when staff are on other pages. The EventSource auto-
  // reconnects; we just need to invalidate the cached count on each event so
  // the next render picks up the fresh number from /api/conversations.
  useEffect(() => {
    if (!isStaff) return;
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    const es = new EventSource("/api/inbox/events", { withCredentials: true });
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ["unread-messages-count"] });
      queryClient.invalidateQueries({ queryKey: ["notification-section-counts"] });
    };
    es.addEventListener("inbox_message", refresh);
    es.addEventListener("inbox_assigned", refresh);
    return () => {
      es.removeEventListener("inbox_message", refresh);
      es.removeEventListener("inbox_assigned", refresh);
      es.close();
    };
  }, [isStaff, queryClient]);

  const { data: studentUnreadData } = useQuery({
    queryKey: ["student-unread-messages"],
    enabled: isStudent,
    queryFn: async () => {
      const res = await customFetch<{ data: any[] }>("/api/student/conversations");
      const convs = (res as any)?.data || res || [];
      const total = convs.reduce((sum: number, c: any) => sum + (c.unreadCount || 0), 0);
      return total;
    },
    refetchInterval: 15000,
    staleTime: 10000,
  });

  const totalUnreadMessages = (isStaff ? (unreadMsgData || 0) : 0) + (isStudent ? (studentUnreadData || 0) : 0);

  const { data: sectionCounts } = useQuery<Record<string, number>>({
    queryKey: ["notification-section-counts"],
    enabled: isStaff || isAgentRole,
    queryFn: async () => {
      const res = await customFetch<Record<string, number>>("/api/notifications/section-counts");
      return (res as any) || {};
    },
    refetchInterval: 15000,
    staleTime: 10000,
  });

  if (isAlreadyMounted) return <>{children}</>;

  if (isLoading || !user) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin w-10 h-10 border-4 border-primary border-t-transparent rounded-full" />
          <p className="text-muted-foreground font-medium text-sm">{t("dashboard.loadingPortal")}</p>
        </div>
      </div>
    );
  }

  const staffPerms = (user as unknown as Record<string, unknown>).agentStaffPermissions as string[] | undefined;
  const { groups } = getMenuForRole(user.role, t, staffPerms);
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
    <DashboardLayoutMountedCtx.Provider value={true}>
    <SidebarProvider style={{ "--sidebar-width": "16rem" } as React.CSSProperties}>
      <div className="flex min-h-screen w-full bg-secondary/20">
        <Sidebar className="border-r border-border/60 shadow-sm">
          <SidebarContent className="bg-card">
            {/* Logo */}
            <div className="p-5 pb-4 border-b border-border/40">
               <a href={`${import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}/`} className="flex items-center gap-2.5 group">
                {sidebarLogo ? (
                  <img src={sidebarLogo} alt="Logo" className="h-9 max-w-[120px] object-contain group-hover:scale-105 transition-transform" />
                ) : (
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white shadow-md group-hover:scale-105 transition-transform">
                    <GraduationCap className="w-5 h-5" />
                  </div>
                )}
                <div>
                  {!sidebarLogo && <span className="font-display font-bold text-lg tracking-tight text-foreground leading-none">EduCons</span>}
                </div>
              </a>
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
                                <span className="flex-1">{item.title}</span>
                                {item.url.endsWith("/messages") && totalUnreadMessages > 0 && (
                                  <span className="ml-auto w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center shrink-0">
                                    {totalUnreadMessages > 99 ? "99+" : totalUnreadMessages}
                                  </span>
                                )}
                                {item.url.endsWith("/leads") && (sectionCounts?.leads || 0) > 0 && (
                                  <span className="ml-auto w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center shrink-0">
                                    {(sectionCounts?.leads || 0) > 99 ? "99+" : sectionCounts?.leads}
                                  </span>
                                )}
                                {item.url.endsWith("/students") && (sectionCounts?.students || 0) > 0 && (
                                  <span className="ml-auto w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center shrink-0">
                                    {(sectionCounts?.students || 0) > 99 ? "99+" : sectionCounts?.students}
                                  </span>
                                )}
                                {item.url.endsWith("/applications") && (sectionCounts?.applications || 0) > 0 && (
                                  <span className="ml-auto w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center shrink-0">
                                    {(sectionCounts?.applications || 0) > 99 ? "99+" : sectionCounts?.applications}
                                  </span>
                                )}
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
                      {t("dashboard.profileSettings")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild className="text-destructive focus:text-destructive">
                    <a href="/api/auth/logout">
                      <LogOut className="w-4 h-4 mr-2" />
                      {t("dashboard.signOut")}
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
                {activeItem?.title || t("dashboard.portal")}
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
                      {availableYears.map(y => (
                        <SelectItem key={y} value={y} className="text-sm font-medium">{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <NotificationCenter />
              <Button size="icon" variant="ghost" className="w-8 h-8 rounded-lg"
                onClick={() => setMode(resolvedTheme === "dark" ? "light" : "dark")}
                title={resolvedTheme === "dark" ? t("dashboard.switchToLight") : t("dashboard.switchToDark")}>
                {resolvedTheme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
              <Badge className={`hidden sm:flex text-xs font-semibold border-0 ${roleBadgeColor}`}>
                <Shield className="w-3 h-3 mr-1" />
                {getRoleLabel(user.role, t)}
              </Badge>
            </div>
          </header>

          {(user as any).isImpersonating && (
            <div className="bg-amber-500 text-white px-4 py-2 flex items-center justify-between text-sm font-medium">
              <span>{t("dashboard.impersonating", { name: `${user.firstName} ${user.lastName}`, role: getRoleLabel(user.role, t) })}</span>
              <Button
                size="sm"
                variant="ghost"
                className="text-white hover:bg-amber-600 h-7 gap-1.5"
                onClick={async () => {
                  try {
                    await customFetch("/api/agents/me/return-to-agent", { method: "POST", headers: { "Content-Type": "application/json" } });
                    window.location.href = `${import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}/`;
                  } catch {
                    window.location.href = `${import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}/login`;
                  }
                }}
              >
                <ArrowLeftCircle className="w-4 h-4" />
                {t("dashboard.returnToAgent")}
              </Button>
            </div>
          )}

          <main className="flex-1 overflow-y-auto p-5 lg:p-7">
            <div className="max-w-7xl mx-auto">
              {children}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
    </DashboardLayoutMountedCtx.Provider>
  );
}
