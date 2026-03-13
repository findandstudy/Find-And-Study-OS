import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import NotFound from "@/pages/not-found";

// Public
import Home from "@/pages/public/Home";
import About from "@/pages/public/About";
import Programs from "@/pages/public/Programs";
import Blog from "@/pages/public/Blog";
import Contact from "@/pages/public/Contact";

// Auth
import Login from "@/pages/auth/Login";

// Staff
import StaffDashboard from "@/pages/staff/Dashboard";
import StaffLeads from "@/pages/staff/Leads";
import StaffStudents from "@/pages/staff/Students";
import StaffApplications from "@/pages/staff/Applications";
import StaffFinance from "@/pages/staff/Finance";
import StaffSettings from "@/pages/staff/Settings";
import LeadDetail from "@/pages/staff/LeadDetail";
import StudentDetail from "@/pages/staff/StudentDetail";
import ApplicationDetail from "@/pages/staff/ApplicationDetail";
import StaffDocuments from "@/pages/staff/Documents";

// Admin
import AdminDashboard from "@/pages/admin/Dashboard";
import AdminUsers from "@/pages/admin/Users";
import AdminCatalog from "@/pages/admin/Catalog";

// Student
import StudentDashboard from "@/pages/student/Dashboard";

// Agent
import AgentDashboard from "@/pages/agent/Dashboard";

const STAFF_ROLES = ["super_admin", "admin", "manager", "staff", "consultant", "editor", "accountant"];
const ADMIN_ROLES = ["super_admin", "admin", "manager"];
const STUDENT_ROLES = ["student"];
const AGENT_ROLES = ["agent", "sub_agent"];

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2,
      retry: 1,
    },
  },
});

function Router() {
  return (
    <Switch>
      {/* Public Pages */}
      <Route path="/" component={Home} />
      <Route path="/about" component={About} />
      <Route path="/programs" component={Programs} />
      <Route path="/blog" component={Blog} />
      <Route path="/contact" component={Contact} />

      {/* Auth */}
      <Route path="/login" component={Login} />

      {/* Admin Portal */}
      <Route path="/admin">
        <ProtectedRoute allowedRoles={ADMIN_ROLES}><AdminDashboard /></ProtectedRoute>
      </Route>
      <Route path="/admin/users">
        <ProtectedRoute allowedRoles={ADMIN_ROLES}><AdminUsers /></ProtectedRoute>
      </Route>
      <Route path="/admin/catalog">
        <ProtectedRoute allowedRoles={ADMIN_ROLES}><AdminCatalog /></ProtectedRoute>
      </Route>
      <Route path="/admin/settings">
        <ProtectedRoute allowedRoles={ADMIN_ROLES}><StaffSettings /></ProtectedRoute>
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
      <Route path="/staff/finance">
        <ProtectedRoute allowedRoles={STAFF_ROLES}><StaffFinance /></ProtectedRoute>
      </Route>
      <Route path="/staff/settings">
        <ProtectedRoute allowedRoles={STAFF_ROLES}><StaffSettings /></ProtectedRoute>
      </Route>

      {/* Student Portal */}
      <Route path="/student">
        <ProtectedRoute allowedRoles={STUDENT_ROLES}><StudentDashboard /></ProtectedRoute>
      </Route>

      {/* Agent Portal */}
      <Route path="/agent">
        <ProtectedRoute allowedRoles={AGENT_ROLES}><AgentDashboard /></ProtectedRoute>
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
