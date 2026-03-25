import { lazy, Suspense, useEffect, Component, type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter, useLocation, useRoute } from "wouter";
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

import Home from "@/pages/public/Home";
import Login from "@/pages/auth/Login";

class LazyErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4">
          <p className="text-lg font-semibold">Something went wrong loading this page.</p>
          <button
            className="px-6 py-2 bg-primary text-white rounded-xl hover:opacity-90"
            onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const About = lazy(() => import("@/pages/public/About"));
const Countries = lazy(() => import("@/pages/public/Countries"));
const CountryDetail = lazy(() => import("@/pages/public/CountryDetail"));
const Programs = lazy(() => import("@/pages/public/Programs"));
const Blog = lazy(() => import("@/pages/public/Blog"));
const Contact = lazy(() => import("@/pages/public/Contact"));

const StaffDashboard = lazy(() => import("@/pages/staff/Dashboard"));
const StaffLeads = lazy(() => import("@/pages/staff/Leads"));
const StaffStudents = lazy(() => import("@/pages/staff/Students"));
const StaffApplications = lazy(() => import("@/pages/staff/Applications"));
const StaffFinance = lazy(() => import("@/pages/staff/Finance"));
const StaffSettings = lazy(() => import("@/pages/staff/Settings"));
const LeadDetail = lazy(() => import("@/pages/staff/LeadDetail"));
const StudentDetail = lazy(() => import("@/pages/staff/StudentDetail"));
const ApplicationDetail = lazy(() => import("@/pages/staff/ApplicationDetail"));
const StaffDocuments = lazy(() => import("@/pages/staff/Documents"));
const StaffCourseFinder = lazy(() => import("@/pages/staff/CourseFinder"));
const StaffAgents = lazy(() => import("@/pages/staff/Agents"));
const StaffMessages = lazy(() => import("@/pages/staff/Messages"));

const AdminDashboard = lazy(() => import("@/pages/admin/Dashboard"));
const AdminUsers = lazy(() => import("@/pages/admin/Users"));
const AdminCatalog = lazy(() => import("@/pages/admin/Catalog"));
const AdminAuditLog = lazy(() => import("@/pages/admin/AuditLog"));
const AdminActivity = lazy(() => import("@/pages/admin/Activity"));
const AdminEmbeds = lazy(() => import("@/pages/admin/Embeds"));

const StudentDashboard = lazy(() => import("@/pages/student/Dashboard"));
const StudentApplications = lazy(() => import("@/pages/student/Applications"));
const StudentWishlist = lazy(() => import("@/pages/student/Wishlist"));
const StudentMessages = lazy(() => import("@/pages/student/Messages"));
const StudentAccount = lazy(() => import("@/pages/student/Account"));

const AgentDashboard = lazy(() => import("@/pages/agent/Dashboard"));
const AgentApps = lazy(() => import("@/pages/agent/AgentApps"));
const AgentLeads = lazy(() => import("@/pages/agent/Leads"));
const AgentStudents = lazy(() => import("@/pages/agent/Students"));
const AgentCommissions = lazy(() => import("@/pages/agent/Commissions"));
const AgentAccount = lazy(() => import("@/pages/agent/Account"));
const AgentSubAgents = lazy(() => import("@/pages/agent/SubAgents"));
const AgentMessages = lazy(() => import("@/pages/agent/Messages"));
const AgentTeam = lazy(() => import("@/pages/agent/Team"));

const STAFF_ROLES = ["super_admin", "admin", "manager", "staff", "consultant", "editor", "accountant"];
const ADMIN_ROLES = ["super_admin", "admin", "manager"];
const STUDENT_ROLES = ["student"];
const AGENT_ROLES = ["agent", "sub_agent", "agent_staff"];

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2,
      retry: 1,
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

function LanguageSync({ lang }: { lang: string }) {
  const { setLang } = useI18nContext();
  useEffect(() => {
    if (isValidLanguage(lang)) {
      setLang(lang as Language);
    }
  }, [lang, setLang]);
  return null;
}

function PublicRoutes({ lang }: { lang: string }) {
  return (
    <>
      <LanguageSync lang={lang} />
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
        <Route path={`/${lang}/login`} component={Login} />
        <Route component={NotFound} />
      </Switch>
    </>
  );
}

function Router() {
  return (
    <LazyErrorBoundary>
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/">
          <LanguageRedirect />
        </Route>
        <Route path="/login">
          <LoginRedirect />
        </Route>

        {/* Admin Portal - no language prefix */}
        <Route path="/admin">
          <ProtectedRoute allowedRoles={ADMIN_ROLES}><AdminDashboard /></ProtectedRoute>
        </Route>
        <Route path="/admin/users">
          <ProtectedRoute allowedRoles={ADMIN_ROLES}><AdminUsers /></ProtectedRoute>
        </Route>
        <Route path="/admin/catalog">
          <ProtectedRoute allowedRoles={ADMIN_ROLES}><AdminCatalog /></ProtectedRoute>
        </Route>
        <Route path="/admin/audit">
          <ProtectedRoute allowedRoles={ADMIN_ROLES}><AdminAuditLog /></ProtectedRoute>
        </Route>
        <Route path="/admin/settings">
          <ProtectedRoute allowedRoles={ADMIN_ROLES}><StaffSettings /></ProtectedRoute>
        </Route>
        <Route path="/admin/activity">
          <ProtectedRoute allowedRoles={ADMIN_ROLES}><AdminActivity /></ProtectedRoute>
        </Route>
        <Route path="/admin/activity/:userId">
          {(params) => <ProtectedRoute allowedRoles={ADMIN_ROLES}><AdminActivity userId={Number(params.userId)} /></ProtectedRoute>}
        </Route>
        <Route path="/admin/embeds">
          <ProtectedRoute allowedRoles={ADMIN_ROLES}><AdminEmbeds /></ProtectedRoute>
        </Route>

        {/* Staff / Consultant Portal */}
        <Route path="/staff">
          <ProtectedRoute allowedRoles={STAFF_ROLES}><StaffDashboard /></ProtectedRoute>
        </Route>
        <Route path="/staff/leads">
          <ProtectedRoute allowedRoles={STAFF_ROLES}><StaffLeads /></ProtectedRoute>
        </Route>
        <Route path="/staff/leads/:id">
          {(params) => <ProtectedRoute allowedRoles={STAFF_ROLES}><LeadDetail id={Number(params.id)} /></ProtectedRoute>}
        </Route>
        <Route path="/staff/students">
          <ProtectedRoute allowedRoles={STAFF_ROLES}><StaffStudents /></ProtectedRoute>
        </Route>
        <Route path="/staff/students/:id">
          {(params) => <ProtectedRoute allowedRoles={STAFF_ROLES}><StudentDetail id={Number(params.id)} /></ProtectedRoute>}
        </Route>
        <Route path="/staff/applications">
          <ProtectedRoute allowedRoles={STAFF_ROLES}><StaffApplications /></ProtectedRoute>
        </Route>
        <Route path="/staff/applications/:id">
          {(params) => <ProtectedRoute allowedRoles={STAFF_ROLES}><ApplicationDetail id={Number(params.id)} /></ProtectedRoute>}
        </Route>
        <Route path="/staff/documents">
          <ProtectedRoute allowedRoles={STAFF_ROLES}><StaffDocuments /></ProtectedRoute>
        </Route>
        <Route path="/staff/course-finder">
          <ProtectedRoute allowedRoles={[...STAFF_ROLES, ...AGENT_ROLES]}><StaffCourseFinder /></ProtectedRoute>
        </Route>
        <Route path="/staff/agents">
          <ProtectedRoute allowedRoles={["super_admin", "admin", "manager"]}><StaffAgents /></ProtectedRoute>
        </Route>
        <Route path="/staff/messages">
          <ProtectedRoute allowedRoles={STAFF_ROLES}><StaffMessages /></ProtectedRoute>
        </Route>
        <Route path="/staff/finance">
          <ProtectedRoute allowedRoles={["super_admin", "admin", "accountant"]}><StaffFinance /></ProtectedRoute>
        </Route>
        <Route path="/staff/settings">
          <ProtectedRoute allowedRoles={STAFF_ROLES}><StaffSettings /></ProtectedRoute>
        </Route>

        {/* Student Portal */}
        <Route path="/student">
          <ProtectedRoute allowedRoles={STUDENT_ROLES}><EmailVerificationGuard><StudentDashboard /></EmailVerificationGuard></ProtectedRoute>
        </Route>
        <Route path="/student/wishlist">
          <ProtectedRoute allowedRoles={STUDENT_ROLES}><EmailVerificationGuard><StudentWishlist /></EmailVerificationGuard></ProtectedRoute>
        </Route>
        <Route path="/student/messages">
          <ProtectedRoute allowedRoles={STUDENT_ROLES}><EmailVerificationGuard><StudentMessages /></EmailVerificationGuard></ProtectedRoute>
        </Route>
        <Route path="/student/applications">
          <ProtectedRoute allowedRoles={STUDENT_ROLES}><EmailVerificationGuard><StudentApplications /></EmailVerificationGuard></ProtectedRoute>
        </Route>
        <Route path="/student/course-finder">
          <ProtectedRoute allowedRoles={STUDENT_ROLES}><EmailVerificationGuard><StaffCourseFinder /></EmailVerificationGuard></ProtectedRoute>
        </Route>
        <Route path="/student/account">
          <ProtectedRoute allowedRoles={STUDENT_ROLES}><EmailVerificationGuard><StudentAccount /></EmailVerificationGuard></ProtectedRoute>
        </Route>

        {/* Agent Portal */}
        <Route path="/agent">
          <ProtectedRoute allowedRoles={AGENT_ROLES}><AgentDashboard /></ProtectedRoute>
        </Route>
        <Route path="/agent/leads">
          <ProtectedRoute allowedRoles={AGENT_ROLES}><AgentLeads /></ProtectedRoute>
        </Route>
        <Route path="/agent/leads/:id">
          {(params) => <ProtectedRoute allowedRoles={AGENT_ROLES}><LeadDetail id={Number(params.id)} basePath="/agent" /></ProtectedRoute>}
        </Route>
        <Route path="/agent/students">
          <ProtectedRoute allowedRoles={AGENT_ROLES}><AgentStudents /></ProtectedRoute>
        </Route>
        <Route path="/agent/students/:id">
          {(params) => <ProtectedRoute allowedRoles={AGENT_ROLES}><StudentDetail id={Number(params.id)} basePath="/agent" /></ProtectedRoute>}
        </Route>
        <Route path="/agent/applications">
          <ProtectedRoute allowedRoles={AGENT_ROLES}><AgentApps /></ProtectedRoute>
        </Route>
        <Route path="/agent/applications/:id">
          {(params) => <ProtectedRoute allowedRoles={AGENT_ROLES}><ApplicationDetail id={Number(params.id)} basePath="/agent" /></ProtectedRoute>}
        </Route>
        <Route path="/agent/messages">
          <ProtectedRoute allowedRoles={AGENT_ROLES}><AgentMessages /></ProtectedRoute>
        </Route>
        <Route path="/agent/commissions">
          <ProtectedRoute allowedRoles={AGENT_ROLES}><AgentCommissions /></ProtectedRoute>
        </Route>
        <Route path="/agent/account">
          <ProtectedRoute allowedRoles={AGENT_ROLES}><AgentAccount /></ProtectedRoute>
        </Route>
        <Route path="/agent/sub-agents">
          <ProtectedRoute allowedRoles={["agent"]}><AgentSubAgents /></ProtectedRoute>
        </Route>
        <Route path="/agent/team">
          <ProtectedRoute allowedRoles={["agent"]}><AgentTeam /></ProtectedRoute>
        </Route>

        {/* Language-prefixed public routes */}
        <Route path="/:lang">
          {(params) => {
            if (isValidLanguage(params.lang)) {
              return <PublicRoutes lang={params.lang} />;
            }
            return <NotFound />;
          }}
        </Route>
        <Route path="/:lang/:rest*">
          {(params) => {
            if (isValidLanguage(params.lang)) {
              return <PublicRoutes lang={params.lang} />;
            }
            return <NotFound />;
          }}
        </Route>

        <Route component={NotFound} />
      </Switch>
    </Suspense>
    </LazyErrorBoundary>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SeasonProvider>
          <I18nProvider>
            <TooltipProvider>
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
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
