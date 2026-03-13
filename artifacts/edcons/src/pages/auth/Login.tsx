import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { GraduationCap, Globe2, Star, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

export default function Login() {
  const { user, isLoading } = useAuth(false);
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && user) {
      if (['super_admin', 'admin', 'manager'].includes(user.role)) setLocation('/admin');
      else if (['staff', 'consultant', 'accountant', 'editor'].includes(user.role)) setLocation('/staff');
      else if (user.role === 'student') setLocation('/student');
      else if (['agent', 'sub_agent'].includes(user.role)) setLocation('/agent');
      else setLocation('/staff');
    }
  }, [user, isLoading, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 to-accent/5">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-12 h-12 text-primary animate-spin" />
          <p className="text-muted-foreground font-medium">Authenticating...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary to-accent relative overflow-hidden flex-col justify-between p-12">
        <div className="absolute inset-0">
          <div className="absolute top-20 left-20 w-72 h-72 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute bottom-20 right-20 w-96 h-96 rounded-full bg-white/5 blur-3xl" />
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-16">
            <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center">
              <GraduationCap className="w-7 h-7 text-white" />
            </div>
            <span className="font-display font-bold text-3xl text-white">EduCons</span>
          </div>
          <h1 className="text-4xl font-display font-bold text-white mb-6 leading-tight">
            Your Global Education<br />Journey Starts Here
          </h1>
          <p className="text-white/80 text-lg leading-relaxed max-w-md">
            Access your personalized portal to track applications, manage documents, and connect with advisors.
          </p>
        </div>

        <div className="relative z-10 space-y-4">
          {[
            { icon: Globe2, text: "200+ partner universities worldwide" },
            { icon: Star, text: "95% visa approval success rate" },
            { icon: GraduationCap, text: "10,000+ students successfully placed" },
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-3 text-white/90">
              <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
                <item.icon className="w-4 h-4 text-white" />
              </div>
              <span className="font-medium">{item.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center bg-background p-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2 justify-center mb-10">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <GraduationCap className="w-6 h-6 text-white" />
            </div>
            <span className="font-display font-bold text-2xl">EduCons</span>
          </div>

          <h2 className="text-3xl font-display font-bold text-foreground mb-2">Welcome Back</h2>
          <p className="text-muted-foreground mb-10">Sign in to access your EduCons portal.</p>

          <Button asChild size="lg" className="w-full rounded-xl py-6 text-base font-semibold shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-all hover:-translate-y-0.5">
            <a href="/api/auth/login" className="flex items-center justify-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
                <GraduationCap className="w-5 h-5" />
              </div>
              Sign In
              <ArrowRight className="w-5 h-5 ml-auto" />
            </a>
          </Button>

          <div className="mt-8 p-5 rounded-2xl bg-secondary/50 border border-border/40">
            <p className="text-sm text-muted-foreground text-center">
              By signing in, you agree to our{" "}
              <span className="text-primary font-medium cursor-pointer hover:underline">Terms of Service</span>
              {" "}and{" "}
              <span className="text-primary font-medium cursor-pointer hover:underline">Privacy Policy</span>.
            </p>
          </div>

          <div className="mt-8 grid grid-cols-3 gap-4">
            {[
              { label: "Students", icon: "🎓" },
              { label: "Agents", icon: "🤝" },
              { label: "Staff", icon: "💼" },
            ].map((p, i) => (
              <div key={i} className="text-center p-4 rounded-xl bg-secondary/30 border border-border/30">
                <div className="text-2xl mb-2">{p.icon}</div>
                <p className="text-xs font-medium text-muted-foreground">{p.label} Portal</p>
              </div>
            ))}
          </div>

          <p className="text-center mt-8 text-muted-foreground text-sm">
            New student?{" "}
            <a href="/contact" className="text-primary font-semibold hover:underline">Contact us to get started</a>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
