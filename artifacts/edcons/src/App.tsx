import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
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

// Admin
import AdminDashboard from "@/pages/admin/Dashboard";
import AdminUsers from "@/pages/admin/Users";

// Student
import StudentDashboard from "@/pages/student/Dashboard";

// Agent
import AgentDashboard from "@/pages/agent/Dashboard";

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
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/admin/users" component={AdminUsers} />
      <Route path="/admin/settings" component={StaffSettings} />
      <Route path="/admin/audit" component={AdminDashboard} />

      {/* Staff / Consultant Portal */}
      <Route path="/staff" component={StaffDashboard} />
      <Route path="/staff/leads" component={StaffLeads} />
      <Route path="/staff/students" component={StaffStudents} />
      <Route path="/staff/applications" component={StaffApplications} />
      <Route path="/staff/finance" component={StaffFinance} />
      <Route path="/staff/settings" component={StaffSettings} />

      {/* Student Portal */}
      <Route path="/student" component={StudentDashboard} />
      <Route path="/student/applications" component={StaffApplications} />

      {/* Agent Portal */}
      <Route path="/agent" component={AgentDashboard} />

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
