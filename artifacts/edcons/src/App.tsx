import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useCustomBrowserLocation } from "@/lib/navigation";
import { getAuthCache, setAuthCache, clearAuthCache, getStickyUser, setStickyUser } from "@/lib/auth-cache";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { EmailVerificationGuard } from "@/components/auth/EmailVerificationGuard";
import { SeasonProvider } from "@/contexts/SeasonContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ActivityTrackerProvider } from "@/components/ActivityTrackerProvider";
import { PageLoader } from "@/components/ui/page-loader";
import { I18nProvider, useI18nContext } from "@/lib/i18n/context";
import { isValidLanguage, DEFAULT_LANGUAGE, type Language } from "@/lib/i18n/index";
import NotFound from "@/pages/not-found";
import { useGetMe } from "@workspace/api-client-react";

import Home from "@/pages/public/Home";
import Login from "@/pages/auth/Login";

function lazyRetry<T extends { default: React.ComponentType<any> }>(
  factory: () => Promise<T>,
  retries = 4
): React.LazyExoticComponent<T["default"]> {
  return lazy(() => {
    const attempt = (remaining: number): Promise<T> =>
      factory().catch((err: Error) => {
        if (remaining <= 0) {
          const reloaded = sessionStorage.getItem("chunk_reload");
          if (!reloaded) {
            sessionStorage.setItem("chunk_reload", "1");
            window.location.reload();
          }
          throw err;
        }
        return new Promise<T>((resolve) =>
          setTimeout(() => resolve(attempt(remaining - 1)), 800)
        );
      });
    return attempt(retries);
  });
}

const About = lazyRetry(() => import("@/pages/public/About"));
const Countries = lazyRetry(() => import("@/pages/public/Countries"));
const CountryDetail = lazyRetry(() => import("@/pages/public/CountryDetail"));
const Programs = lazyRetry(() => import("@/pages/public/Programs"));
const Blog = lazyRetry(() => import("@/pages/public/Blog"));
const Contact = lazyRetry(() => import("@/pages/public/Contact"));

const StaffDashboard = lazyRetry(() => import("@/pages/staff/Dashboard"));
const StaffLeads = lazyRetry(() => import("@/pages/staff/Leads"));
const StaffStudents = lazyRetry(() => import("@/pages/staff/Students"));
const StaffApplications = lazyRetry(() => import("@/pages/staff/Applications"));
const StaffFinance = lazyRetry(() => import("@/pages/staff/Finance"));
const StaffSettings = lazyRetry(() => import("@/pages/staff/Settings"));
const LeadDetail = lazyRetry(() => import("@/pages/staff/LeadDetail"));
const StudentDetail = lazyRetry(() => import("@/pages/staff/StudentDetail"));
const ApplicationDetail = lazyRetry(() => import("@/pages/staff/ApplicationDetail"));
const StaffDocuments = lazyRetry(() => import("@/pages/staff/Documents"));
const StaffCourseFinder = lazyRetry(() => import("@/pages/staff/CourseFinder"));
const StaffAgents = lazyRetry(() => import("@/pages/staff/Agents"));
const StaffAgentDetail = lazyRetry(() => import("@/pages/staff/AgentDetail"));
const StaffMessages = lazyRetry(() => import("@/pages/staff/Messages"));
const StaffTasks = lazyRetry(() => import("@/pages/staff/Tasks"));

const AdminDashboard = lazyRetry(() => import("@/pages/admin/Dashboard"));
const AdminUsers = lazyRetry(() => import("@/pages/admin/Users"));
const AdminCatalog = lazyRetry(() => import("@/pages/admin/Catalog"));
const AdminCampaigns = lazyRetry(() => import("@/pages/admin/Campaigns"));
const AdminAuditLog = lazyRetry(() => import("@/pages/admin/AuditLog"));
const AdminActivity = lazyRetry(() => import("@/pages/admin/Activity"));
const AdminEmbeds = lazyRetry(() => import("@/pages/admin/Embeds"));

const WebsitePages = lazyRetry(() => import("@/pages/admin/website/Pages"));
const WebsiteGlobalComponents = lazyRetry(() => import("@/pages/admin/website/GlobalComponents"));
const WebsiteNavigation = lazyRetry(() => import("@/pages/admin/website/Navigation"));
const WebsiteBlog = lazyRetry(() => import("@/pages/admin/website/Blog"));
const WebsiteCollections = lazyRetry(() => import("@/pages/admin/website/Collections"));
const WebsiteForms = lazyRetry(() => import("@/pages/admin/website/Forms"));
const WebsiteSeoOverrides = lazyRetry(() => import("@/pages/admin/website/SeoOverrides"));
const WebsiteThemeBuilder = lazyRetry(() => import("@/pages/admin/website/ThemeBuilder"));
const WebsiteTranslations = lazyRetry(() => import("@/pages/admin/website/Translations"));
const WebsitePublishHistory = lazyRetry(() => import("@/pages/admin/website/PublishHistory"));
const WebsitePageEditor = lazyRetry(() => import("@/pages/admin/website/PageEditor"));

const StudentDashboard = lazyRetry(() => import("@/pages/student/Dashboard"));
const StudentApplications = lazyRetry(() => import("@/pages/student/Applications"));
const StudentWishlist = lazyRetry(() => import("@/pages/student/Wishlist"));
const StudentMessages = lazyRetry(() => import("@/pages/student/Messages"));
const StudentAccount = lazyRetry(() => import("@/pages/student/Account"));

const AgentDashboard = lazyRetry(() => import("@/pages/agent/Dashboard"));
const AgentApps = lazyRetry(() => import("@/pages/agent/AgentApps"));
const AgentLeads = lazyRetry(() => import("@/pages/agent/Leads"));
const AgentStudents = lazyRetry(() => import("@/pages/agent/Students"));
const AgentCommissions = lazyRetry(() => import("@/pages/agent/Commissions"));
const AgentAccount = lazyRetry(() => import("@/pages/agent/Account"));
const AgentSubAgents = lazyRetry(() => import("@/pages/agent/SubAgents"));
const AgentMessages = lazyRetry(() => import("@/pages/agent/Messages"));
const AgentTeam = lazyRetry(() => import("@/pages/agent/Team"));

const STAFF_ROLES = ["super_admin", "admin", "manager", "staff", "consultant", "editor", "accountant"];
const ADMIN_ROLES = ["super_admin", "admin", "manager"];
const WEBSITE_ADMIN_ROLES = ["super_admin", "admin"];
const STUDENT_ROLES = ["student"];
const AGENT_ROLES = ["agent", "sub_agent", "agent_staff"];

function ShellLoader() {
  return <div className="flex-1 min-h-0 bg-secondary/20" />;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 15,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function LanguageRedirect() {
  const [, setLocation] = useLocation();
  const { lang } = useI18nContext();
  useEffect(() => {
    setLocation(`/${lang}`, { replace: true });
  }, [lang, setLocation]);
  return <PageLoader />;
}

function LoginRedirect() {
  const [, setLocation] = useLocation();
  const { lang } = useI18nContext();
  useEffect(() => {
    const search = window.location.search;
    setLocation(`/${lang}/login${search}`, { replace: true });
  }, [lang, setLocation]);
  return <PageLoader />;
}

function InvalidLangRedirect({ segment, rest }: { segment: string; rest: string }) {
  const [, setLocation] = useLocation();
  useEffect(() => {
    const path = rest ? `/en/${rest}` : `/en`;
    setLocation(path, { replace: true });
  }, [segment, rest, setLocation]);
  return <PageLoader />;
}

function LanguageSync({ lang }: { lang: string }) {
  const { setLang } = useI18nContext();
  useEffect(() => {
    if (isValidLanguage(lang)) {
      setLang(lang as Language);
    }
  }, [lang, setLang]);
  return null;
}

/**
 * Catch-all for unrecognised public paths (e.g. /en/dashboard when the canvas
 * loads at that URL).  Checks the React Query cache (already populated by
 * AuthPrefetch) and redirects logged-in users to their portal immediately.
 * Falls back to the real 404 page only when we're certain the user is not
 * authenticated.
 */
function AuthFallback() {
  const [, setLocation] = useLocation();
  const { data: me, isLoading } = useGetMe();

  useEffect(() => {
    if (isLoading || !me) return;
    const role = (me as { role?: string }).role;
    if (!role || role === "pending") return;
    if (STAFF_ROLES.includes(role)) { setLocation("/admin"); return; }
    if (STUDENT_ROLES.includes(role)) { setLocation("/student"); return; }
    if (AGENT_ROLES.includes(role)) { setLocation("/agent"); return; }
  }, [me, isLoading, setLocation]);

  // Use cached auth (localStorage) for a synchronous signal while the API
  // call is in-flight — avoids flashing the 404 page for logged-in users.
  const cached = getStickyUser() ?? getAuthCache();
  const cachedRole = cached ? (cached as { role?: string }).role : undefined;
  const hasPortalRole =
    cachedRole &&
    cachedRole !== "pending" &&
    (STAFF_ROLES.includes(cachedRole) ||
      STUDENT_ROLES.includes(cachedRole) ||
      AGENT_ROLES.includes(cachedRole));

  if (hasPortalRole || isLoading) return <PageLoader />;
  return <NotFound />;
}

function PublicRoutes({ lang }: { lang: string }) {
  const [location] = useLocation();
  const isLoginPage = location === `/${lang}/login`;
  return (
    <>
      <LanguageSync lang={lang} />
      {isLoginPage ? (
        <Login />
      ) : (
        <PublicLayout>
          <Switch>
            <Route path={`/${lang}`} component={Home} />
            <Route path={`/${lang}/about`} component={About} />
            <Route path={`/${lang}/countries`} component={Countries} />
            <Route path={`/${lang}/countries/:slug`}>
              {(params) => <CountryDetail slug={params.slug} />}
            </Route>
            <Route path={`/${lang}/programs`} component={Programs} />
            <Route path={`/${lang}/blog`} component={Blog} />
            <Route path={`/${lang}/contact`} component={Contact} />
            <Route component={AuthFallback} />
          </Switch>
        </PublicLayout>
      )}
    </>
  );
}

function StaffAdminShell() {
  useEffect(() => {
    console.log("[StaffAdminShell] MOUNTED");
    return () => console.log("[StaffAdminShell] UNMOUNTED");
  }, []);
  return (
    <ProtectedRoute allowedRoles={STAFF_ROLES}>
      <DashboardLayout>
        <Suspense fallback={<ShellLoader />}>
        <Switch>
          {/* Admin routes */}
          <Route path="/admin" component={AdminDashboard} />
          <Route path="/admin/users">
            <ProtectedRoute allowedRoles={ADMIN_ROLES}><AdminUsers /></ProtectedRoute>
          </Route>
          <Route path="/admin/catalog">
            <ProtectedRoute allowedRoles={ADMIN_ROLES}><AdminCatalog /></ProtectedRoute>
          </Route>
          <Route path="/admin/campaigns">
            <ProtectedRoute allowedRoles={ADMIN_ROLES}><AdminCampaigns /></ProtectedRoute>
          </Route>
          <Route path="/admin/audit">
            <ProtectedRoute allowedRoles={ADMIN_ROLES}><AdminAuditLog /></ProtectedRoute>
          </Route>
          <Route path="/admin/settings" component={StaffSettings} />
          <Route path="/admin/activity/:userId">
            {(params) => <ProtectedRoute allowedRoles={ADMIN_ROLES}><AdminActivity userId={Number(params.userId)} /></ProtectedRoute>}
          </Route>
          <Route path="/admin/activity">
            <ProtectedRoute allowedRoles={ADMIN_ROLES}><AdminActivity /></ProtectedRoute>
          </Route>
          <Route path="/admin/embeds">
            <ProtectedRoute allowedRoles={ADMIN_ROLES}><AdminEmbeds /></ProtectedRoute>
          </Route>
          <Route path="/admin/website/pages/:id/edit">
            {(params) => <ProtectedRoute allowedRoles={WEBSITE_ADMIN_ROLES}><WebsitePageEditor id={Number(params.id)} /></ProtectedRoute>}
          </Route>
          <Route path="/admin/website/pages">
            <ProtectedRoute allowedRoles={WEBSITE_ADMIN_ROLES}><WebsitePages /></ProtectedRoute>
          </Route>
          <Route path="/admin/website/global-components">
            <ProtectedRoute allowedRoles={WEBSITE_ADMIN_ROLES}><WebsiteGlobalComponents /></ProtectedRoute>
          </Route>
          <Route path="/admin/website/navigation">
            <ProtectedRoute allowedRoles={WEBSITE_ADMIN_ROLES}><WebsiteNavigation /></ProtectedRoute>
          </Route>
          <Route path="/admin/website/blog">
            <ProtectedRoute allowedRoles={WEBSITE_ADMIN_ROLES}><WebsiteBlog /></ProtectedRoute>
          </Route>
          <Route path="/admin/website/collections">
            <ProtectedRoute allowedRoles={WEBSITE_ADMIN_ROLES}><WebsiteCollections /></ProtectedRoute>
          </Route>
          <Route path="/admin/website/forms">
            <ProtectedRoute allowedRoles={WEBSITE_ADMIN_ROLES}><WebsiteForms /></ProtectedRoute>
          </Route>
          <Route path="/admin/website/seo">
            <ProtectedRoute allowedRoles={WEBSITE_ADMIN_ROLES}><WebsiteSeoOverrides /></ProtectedRoute>
          </Route>
          <Route path="/admin/website/theme">
            <ProtectedRoute allowedRoles={WEBSITE_ADMIN_ROLES}><WebsiteThemeBuilder /></ProtectedRoute>
          </Route>
          <Route path="/admin/website/translations">
            <ProtectedRoute allowedRoles={WEBSITE_ADMIN_ROLES}><WebsiteTranslations /></ProtectedRoute>
          </Route>
          <Route path="/admin/website/publish-history">
            <ProtectedRoute allowedRoles={WEBSITE_ADMIN_ROLES}><WebsitePublishHistory /></ProtectedRoute>
          </Route>
          {/* Staff routes */}
          <Route path="/staff" component={StaffDashboard} />
          <Route path="/staff/leads/:id">
            {(params) => <LeadDetail id={Number(params.id)} />}
          </Route>
          <Route path="/staff/leads" component={StaffLeads} />
          <Route path="/staff/students/:id">
            {(params) => <StudentDetail id={Number(params.id)} />}
          </Route>
          <Route path="/staff/students" component={StaffStudents} />
          <Route path="/staff/applications/:id">
            {(params) => <ApplicationDetail id={Number(params.id)} />}
          </Route>
          <Route path="/staff/applications" component={StaffApplications} />
          <Route path="/staff/documents" component={StaffDocuments} />
          <Route path="/staff/course-finder" component={StaffCourseFinder} />
          <Route path="/staff/agents/:id" component={StaffAgentDetail} />
          <Route path="/staff/agents">
            <ProtectedRoute allowedRoles={["super_admin", "admin", "manager"]}><StaffAgents /></ProtectedRoute>
          </Route>
          <Route path="/staff/messages" component={StaffMessages} />
          <Route path="/staff/finance">
            <ProtectedRoute allowedRoles={["super_admin", "admin", "accountant"]}><StaffFinance /></ProtectedRoute>
          </Route>
          <Route path="/staff/settings" component={StaffSettings} />
          <Route path="/staff/tasks" component={StaffTasks} />
          <Route component={NotFound} />
        </Switch>
        </Suspense>
      </DashboardLayout>
    </ProtectedRoute>
  );
}

function StudentShell() {
  return (
    <ProtectedRoute allowedRoles={STUDENT_ROLES}>
      <EmailVerificationGuard>
        <DashboardLayout>
          <Suspense fallback={<ShellLoader />}>
          <Switch>
            <Route path="/student" component={StudentDashboard} />
            <Route path="/student/wishlist" component={StudentWishlist} />
            <Route path="/student/messages" component={StudentMessages} />
            <Route path="/student/applications" component={StudentApplications} />
            <Route path="/student/course-finder" component={StaffCourseFinder} />
            <Route path="/student/account" component={StudentAccount} />
            <Route component={NotFound} />
          </Switch>
          </Suspense>
        </DashboardLayout>
      </EmailVerificationGuard>
    </ProtectedRoute>
  );
}

function AgentShell() {
  return (
    <ProtectedRoute allowedRoles={AGENT_ROLES}>
      <DashboardLayout>
        <Suspense fallback={<ShellLoader />}>
        <Switch>
          <Route path="/agent" component={AgentDashboard} />
          <Route path="/agent/leads/:id">
            {(params) => <ProtectedRoute allowedRoles={AGENT_ROLES} requiredPermission="leads"><LeadDetail id={Number(params.id)} basePath="/agent" /></ProtectedRoute>}
          </Route>
          <Route path="/agent/leads">
            <ProtectedRoute allowedRoles={AGENT_ROLES} requiredPermission="leads"><AgentLeads /></ProtectedRoute>
          </Route>
          <Route path="/agent/students/:id">
            {(params) => <ProtectedRoute allowedRoles={AGENT_ROLES} requiredPermission="students"><StudentDetail id={Number(params.id)} basePath="/agent" /></ProtectedRoute>}
          </Route>
          <Route path="/agent/students">
            <ProtectedRoute allowedRoles={AGENT_ROLES} requiredPermission="students"><AgentStudents /></ProtectedRoute>
          </Route>
          <Route path="/agent/applications/:id">
            {(params) => <ProtectedRoute allowedRoles={AGENT_ROLES} requiredPermission="applications"><ApplicationDetail id={Number(params.id)} basePath="/agent" /></ProtectedRoute>}
          </Route>
          <Route path="/agent/applications">
            <ProtectedRoute allowedRoles={AGENT_ROLES} requiredPermission="applications"><AgentApps /></ProtectedRoute>
          </Route>
          <Route path="/agent/messages">
            <ProtectedRoute allowedRoles={AGENT_ROLES} requiredPermission="messages"><AgentMessages /></ProtectedRoute>
          </Route>
          <Route path="/agent/commissions">
            <ProtectedRoute allowedRoles={AGENT_ROLES} requiredPermission="commissions"><AgentCommissions /></ProtectedRoute>
          </Route>
          <Route path="/agent/course-finder">
            <ProtectedRoute allowedRoles={AGENT_ROLES} requiredPermission="course_finder"><StaffCourseFinder /></ProtectedRoute>
          </Route>
          <Route path="/agent/account" component={AgentAccount} />
          <Route path="/agent/sub-agents">
            <ProtectedRoute allowedRoles={["agent"]}><AgentSubAgents /></ProtectedRoute>
          </Route>
          <Route path="/agent/team">
            <ProtectedRoute allowedRoles={["agent", "sub_agent"]}><AgentTeam /></ProtectedRoute>
          </Route>
          <Route component={NotFound} />
        </Switch>
        </Suspense>
      </DashboardLayout>
    </ProtectedRoute>
  );
}

function Router() {
  const [location] = useLocation();

  const isStaffAdminPath = location === "/admin" || location.startsWith("/admin/") ||
                            location === "/staff" || location.startsWith("/staff/");
  const isStudentPath = location === "/student" || location.startsWith("/student/");
  const isAgentPath = location === "/agent" || location.startsWith("/agent/");

  const prevBranch = useRef<string | null>(null);
  const branch = isStaffAdminPath ? "staff" : isStudentPath ? "student" : isAgentPath ? "agent" : "public";
  if (prevBranch.current !== branch) {
    console.log("[Router] branch change:", prevBranch.current, "→", branch, "location=", location);
    prevBranch.current = branch;
  } else {
    console.log("[Router] re-render, branch=", branch, "location=", location);
  }

  if (isStaffAdminPath) {
    return <ErrorBoundary><StaffAdminShell /></ErrorBoundary>;
  }

  if (isStudentPath) {
    return <ErrorBoundary><StudentShell /></ErrorBoundary>;
  }

  if (isAgentPath) {
    return <ErrorBoundary><AgentShell /></ErrorBoundary>;
  }

  // ── Public branch ────────────────────────────────────────────────────────────
  // We intentionally do NOT use Wouter <Switch>/<Route> here.  The old approach
  // had two separate Route entries — `/:lang` (matches `/en`) and `/:lang/:rest*`
  // (matches `/en/about`).  When navigating between different path depths, Wouter
  // would match a DIFFERENT Route element each time, so React would unmount and
  // remount PublicRoutes (and everything inside it — PublicLayout, header, footer)
  // on every nav.  That was the "reload on every route change" the user saw.
  //
  // Fix: inspect the path directly and render from a SINGLE stable JSX position
  // so React reconciles without remounting, regardless of path depth.

  if (location === "/" || location === "") {
    return (
      <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          <LanguageRedirect />
        </Suspense>
      </ErrorBoundary>
    );
  }

  if (location === "/login") {
    return (
      <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          <LoginRedirect />
        </Suspense>
      </ErrorBoundary>
    );
  }

  // Extract first path segment (language code or unrecognised slug)
  const firstSegment = location.split("/").filter(Boolean)[0] ?? "";
  const rest = location.split("/").filter(Boolean).slice(1).join("/");

  if (isValidLanguage(firstSegment)) {
    // Stable branch: always renders PublicRoutes at the same tree position,
    // regardless of whether location is `/en`, `/en/about`, or `/en/countries/uk`.
    return (
      <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          <PublicRoutes lang={firstSegment} />
        </Suspense>
      </ErrorBoundary>
    );
  }

  if (firstSegment) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          <InvalidLangRedirect segment={firstSegment} rest={rest} />
        </Suspense>
      </ErrorBoundary>
    );
  }

  return <ErrorBoundary><NotFound /></ErrorBoundary>;
}

function AuthPrefetch() {
  const [initialUser] = useState(() => getStickyUser() ?? getAuthCache());
  const result = useGetMe({
    query: {
      retry: false,
      staleTime: 30_000,
      ...(initialUser !== undefined
        ? {
            initialData: initialUser as any,
            // Mark initial data as fresh so TanStack Query doesn't
            // immediately schedule a background refetch on mount.
            initialDataUpdatedAt: Date.now(),
          }
        : {}),
    } as any,
  });
  useEffect(() => {
    if (result.data) {
      setAuthCache(result.data);
      setStickyUser(result.data);
    } else if (result.error) {
      // Only clear the auth cache (and sticky user) on confirmed auth errors.
      // Do NOT clear on transient network errors — that would wipe the
      // sticky user and cause white flashes on the next navigation.
      const status = (result.error as any)?.status as number | undefined;
      if (status === 401 || status === 403) {
        clearAuthCache();
      }
    }
  }, [result.data, result.error]);

  useEffect(() => {
    if (!result.data) return;
    Promise.allSettled([
      // Staff
      import("@/pages/staff/Dashboard"),
      import("@/pages/staff/Leads"),
      import("@/pages/staff/Students"),
      import("@/pages/staff/Applications"),
      import("@/pages/staff/Finance"),
      import("@/pages/staff/Settings"),
      import("@/pages/staff/LeadDetail"),
      import("@/pages/staff/StudentDetail"),
      import("@/pages/staff/ApplicationDetail"),
      import("@/pages/staff/Documents"),
      import("@/pages/staff/CourseFinder"),
      import("@/pages/staff/Agents"),
      import("@/pages/staff/AgentDetail"),
      import("@/pages/staff/Messages"),
      import("@/pages/staff/Tasks"),
      // Admin
      import("@/pages/admin/Dashboard"),
      import("@/pages/admin/Users"),
      import("@/pages/admin/Catalog"),
      import("@/pages/admin/Campaigns"),
      import("@/pages/admin/AuditLog"),
      import("@/pages/admin/Activity"),
      import("@/pages/admin/Embeds"),
      // Website admin
      import("@/pages/admin/website/Pages"),
      import("@/pages/admin/website/GlobalComponents"),
      import("@/pages/admin/website/Navigation"),
      import("@/pages/admin/website/Blog"),
      import("@/pages/admin/website/Collections"),
      import("@/pages/admin/website/Forms"),
      import("@/pages/admin/website/SeoOverrides"),
      import("@/pages/admin/website/ThemeBuilder"),
      import("@/pages/admin/website/Translations"),
      import("@/pages/admin/website/PublishHistory"),
      import("@/pages/admin/website/PageEditor"),
      // Student
      import("@/pages/student/Dashboard"),
      import("@/pages/student/Applications"),
      import("@/pages/student/Wishlist"),
      import("@/pages/student/Messages"),
      import("@/pages/student/Account"),
      // Agent
      import("@/pages/agent/Dashboard"),
      import("@/pages/agent/AgentApps"),
      import("@/pages/agent/Leads"),
      import("@/pages/agent/Students"),
      import("@/pages/agent/Commissions"),
      import("@/pages/agent/Account"),
      import("@/pages/agent/SubAgents"),
      import("@/pages/agent/Messages"),
      import("@/pages/agent/Team"),
    ]);
  }, [!!result.data]);

  return null;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthPrefetch />
      <ThemeProvider>
        <SeasonProvider>
          <I18nProvider>
            <TooltipProvider>
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")} hook={useCustomBrowserLocation as any}>
                <ActivityTrackerProvider>
                  <Router />
                </ActivityTrackerProvider>
              </WouterRouter>
              <Toaster />
            </TooltipProvider>
          </I18nProvider>
        </SeasonProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
