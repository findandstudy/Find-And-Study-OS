import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/contexts/ThemeContext";
import { GraduationCap, Globe2, Star, ArrowRight, Loader2, Mail, Lock, User, Phone, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { motion, AnimatePresence } from "framer-motion";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

type Tab = "login" | "register" | "verify" | "set-password";

export default function Login() {
  const { user, isLoading } = useAuth(false);
  const { settings, resolvedTheme } = useTheme();
  const [, setLocation] = useLocation();

  const urlParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const returnTo = useMemo(() => {
    const raw = urlParams.get("returnTo");
    if (!raw) return null;
    const decoded = decodeURIComponent(raw);
    if (decoded.startsWith("/") && !decoded.startsWith("//")) return decoded;
    return null;
  }, [urlParams]);

  const passwordToken = urlParams.get("token");
  const verifiedSuccess = urlParams.get("verified") === "true";
  const verifyError = urlParams.get("verifyError");

  const [tab, setTab] = useState<Tab>(passwordToken ? "set-password" : "login");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState(
    verifiedSuccess ? "Your email has been verified! You can now sign in." :
    verifyError === "invalid" ? "" : ""
  );
  const [setPasswordForm, setSetPasswordForm] = useState({ password: "", confirmPassword: "" });
  const [passwordSet, setPasswordSet] = useState(false);

  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [registerForm, setRegisterForm] = useState({ email: "", password: "", confirmPassword: "", firstName: "", lastName: "", phoneCode: "+90", phone: "" });
  const [verifyEmail, setVerifyEmail] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [resending, setResending] = useState(false);

  const hasLogo = resolvedTheme === "dark" && settings.logoDarkUrl ? settings.logoDarkUrl : settings.logoUrl;
  const logoSrc = hasLogo
    ? `${BASE_URL}/api/settings/branding/logo${resolvedTheme === "dark" && settings.logoDarkUrl ? "?variant=dark" : ""}`
    : null;
  const companyName = settings.companyName || "Find & Study";

  useEffect(() => {
    if (!isLoading && user) {
      if (returnTo) {
        setLocation(returnTo);
      } else if (["super_admin", "admin", "manager"].includes(user.role)) {
        setLocation("/admin");
      } else if (["staff", "consultant", "accountant", "editor"].includes(user.role)) {
        setLocation("/staff");
      } else if (user.role === "student") {
        setLocation("/student");
      } else if (["agent", "sub_agent"].includes(user.role)) {
        setLocation("/agent");
      } else {
        setLocation("/staff");
      }
    }
  }, [user, isLoading, setLocation, returnTo]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginForm.email, password: loginForm.password }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Login failed");
        return;
      }
      window.location.href = returnTo ? decodeURIComponent(returnTo) : "/login";
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (registerForm.password !== registerForm.confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (registerForm.password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: registerForm.email,
          password: registerForm.password,
          firstName: registerForm.firstName,
          lastName: registerForm.lastName,
          phone: `${registerForm.phoneCode}${registerForm.phone}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Registration failed");
        return;
      }
      setVerifyEmail(registerForm.email);
      setTab("verify");
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/auth/verify-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: verifyEmail, code: verifyCode }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Verification failed");
        return;
      }
      window.location.href = "/login";
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResendCode() {
    setResending(true);
    setError("");
    try {
      await fetch(`${BASE_URL}/api/auth/resend-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: verifyEmail }),
      });
      setError("");
    } catch {} finally {
      setResending(false);
    }
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (setPasswordForm.password !== setPasswordForm.confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (setPasswordForm.password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/auth/set-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: passwordToken, password: setPasswordForm.password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to set password");
        return;
      }
      setPasswordSet(true);
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 to-accent/5">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-12 h-12 text-primary animate-spin" />
          <p className="text-muted-foreground font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary to-accent relative overflow-hidden flex-col justify-between p-12">
        <div className="absolute inset-0">
          <div className="absolute top-20 left-20 w-72 h-72 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute bottom-20 right-20 w-96 h-96 rounded-full bg-white/5 blur-3xl" />
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-16">
            {logoSrc ? (
              <img src={logoSrc} alt={companyName} className="h-12 max-w-[220px] object-contain brightness-0 invert" />
            ) : (
              <>
                <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center">
                  <GraduationCap className="w-7 h-7 text-white" />
                </div>
                <span className="font-display font-bold text-3xl text-white">{companyName}</span>
              </>
            )}
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

      <div className="flex-1 flex items-center justify-center bg-background p-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-2 justify-center mb-10">
            {logoSrc ? (
              <img src={logoSrc} alt={companyName} className="h-10 max-w-[180px] object-contain" />
            ) : (
              <>
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                  <GraduationCap className="w-6 h-6 text-white" />
                </div>
                <span className="font-display font-bold text-2xl">{companyName}</span>
              </>
            )}
          </div>

          {successMessage && tab === "login" && (
            <div className="p-3 rounded-xl bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 text-sm mb-4 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              {successMessage}
            </div>
          )}

          {verifyError === "invalid" && tab === "login" && (
            <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm mb-4">
              The verification link is invalid or has already been used. Please request a new one.
            </div>
          )}

          {tab !== "verify" && tab !== "set-password" && (
            <div className="flex rounded-xl bg-secondary/50 p-1 mb-8">
              <button
                onClick={() => { setTab("login"); setError(""); }}
                className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all ${tab === "login" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                Sign In
              </button>
              <button
                onClick={() => { setTab("register"); setError(""); }}
                className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all ${tab === "register" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                Student Registration
              </button>
            </div>
          )}

          <AnimatePresence mode="wait">
            {tab === "login" && (
              <motion.div key="login" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                <h2 className="text-3xl font-display font-bold text-foreground mb-2">Welcome Back</h2>
                <p className="text-muted-foreground mb-8">Sign in to access your portal.</p>

                <form onSubmit={handleLogin} className="space-y-5">
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5 text-sm font-semibold"><Mail className="w-3.5 h-3.5" /> Email</Label>
                    <Input
                      type="email"
                      value={loginForm.email}
                      onChange={e => setLoginForm(f => ({ ...f, email: e.target.value }))}
                      placeholder="you@example.com"
                      className="rounded-xl h-12"
                      required
                      autoComplete="email"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5 text-sm font-semibold"><Lock className="w-3.5 h-3.5" /> Password</Label>
                    <div className="relative">
                      <Input
                        type={showPassword ? "text" : "password"}
                        value={loginForm.password}
                        onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))}
                        placeholder="Enter your password"
                        className="rounded-xl h-12 pr-12"
                        required
                        autoComplete="current-password"
                      />
                      <button type="button" onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>

                  {error && (
                    <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                      {error}
                    </div>
                  )}

                  <Button type="submit" size="lg" disabled={loading}
                    className="w-full rounded-xl py-6 text-base font-semibold shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-all hover:-translate-y-0.5">
                    {loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <ArrowRight className="w-5 h-5 mr-2" />}
                    Sign In
                  </Button>
                </form>
              </motion.div>
            )}

            {tab === "register" && (
              <motion.div key="register" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <h2 className="text-3xl font-display font-bold text-foreground mb-2">Create Account</h2>
                <p className="text-muted-foreground mb-8">Register as a student to get started.</p>

                <form onSubmit={handleRegister} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-sm font-semibold">First Name</Label>
                      <Input
                        value={registerForm.firstName}
                        onChange={e => setRegisterForm(f => ({ ...f, firstName: e.target.value }))}
                        placeholder="John"
                        className="rounded-xl h-11"
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-semibold">Last Name</Label>
                      <Input
                        value={registerForm.lastName}
                        onChange={e => setRegisterForm(f => ({ ...f, lastName: e.target.value }))}
                        placeholder="Doe"
                        className="rounded-xl h-11"
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5 text-sm font-semibold"><Mail className="w-3.5 h-3.5" /> Email</Label>
                    <Input
                      type="email"
                      value={registerForm.email}
                      onChange={e => setRegisterForm(f => ({ ...f, email: e.target.value }))}
                      placeholder="you@example.com"
                      className="rounded-xl h-11"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5 text-sm font-semibold"><Phone className="w-3.5 h-3.5" /> Phone</Label>
                    <div className="flex gap-2">
                      <select
                        value={registerForm.phoneCode}
                        onChange={e => setRegisterForm(f => ({ ...f, phoneCode: e.target.value }))}
                        className="h-11 rounded-xl border border-input bg-background px-2 text-sm font-medium w-[100px] shrink-0 focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        <option value="+90">🇹🇷 +90</option>
                        <option value="+1">🇺🇸 +1</option>
                        <option value="+44">🇬🇧 +44</option>
                        <option value="+49">🇩🇪 +49</option>
                        <option value="+33">🇫🇷 +33</option>
                        <option value="+39">🇮🇹 +39</option>
                        <option value="+34">🇪🇸 +34</option>
                        <option value="+31">🇳🇱 +31</option>
                        <option value="+46">🇸🇪 +46</option>
                        <option value="+47">🇳🇴 +47</option>
                        <option value="+7">🇷🇺 +7</option>
                        <option value="+86">🇨🇳 +86</option>
                        <option value="+81">🇯🇵 +81</option>
                        <option value="+82">🇰🇷 +82</option>
                        <option value="+91">🇮🇳 +91</option>
                        <option value="+92">🇵🇰 +92</option>
                        <option value="+880">🇧🇩 +880</option>
                        <option value="+62">🇮🇩 +62</option>
                        <option value="+60">🇲🇾 +60</option>
                        <option value="+234">🇳🇬 +234</option>
                        <option value="+20">🇪🇬 +20</option>
                        <option value="+212">🇲🇦 +212</option>
                        <option value="+213">🇩🇿 +213</option>
                        <option value="+216">🇹🇳 +216</option>
                        <option value="+964">🇮🇶 +964</option>
                        <option value="+966">🇸🇦 +966</option>
                        <option value="+971">🇦🇪 +971</option>
                        <option value="+974">🇶🇦 +974</option>
                        <option value="+973">🇧🇭 +973</option>
                        <option value="+998">🇺🇿 +998</option>
                        <option value="+993">🇹🇲 +993</option>
                        <option value="+994">🇦🇿 +994</option>
                        <option value="+995">🇬🇪 +995</option>
                        <option value="+380">🇺🇦 +380</option>
                        <option value="+55">🇧🇷 +55</option>
                        <option value="+52">🇲🇽 +52</option>
                        <option value="+61">🇦🇺 +61</option>
                        <option value="+64">🇳🇿 +64</option>
                      </select>
                      <Input
                        value={registerForm.phone}
                        onChange={e => setRegisterForm(f => ({ ...f, phone: e.target.value.replace(/[^\d\s]/g, "") }))}
                        placeholder="555 123 4567"
                        className="rounded-xl h-11 flex-1"
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5 text-sm font-semibold"><Lock className="w-3.5 h-3.5" /> Password</Label>
                    <div className="relative">
                      <Input
                        type={showPassword ? "text" : "password"}
                        value={registerForm.password}
                        onChange={e => setRegisterForm(f => ({ ...f, password: e.target.value }))}
                        placeholder="Min. 8 characters"
                        className="rounded-xl h-11 pr-12"
                        required
                        minLength={8}
                      />
                      <button type="button" onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm font-semibold">Confirm Password</Label>
                    <Input
                      type="password"
                      value={registerForm.confirmPassword}
                      onChange={e => setRegisterForm(f => ({ ...f, confirmPassword: e.target.value }))}
                      placeholder="Re-enter password"
                      className="rounded-xl h-11"
                      required
                    />
                  </div>

                  {error && (
                    <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                      {error}
                    </div>
                  )}

                  <Button type="submit" size="lg" disabled={loading}
                    className="w-full rounded-xl py-5 text-base font-semibold shadow-lg shadow-primary/25 hover:shadow-xl transition-all hover:-translate-y-0.5">
                    {loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <User className="w-5 h-5 mr-2" />}
                    Create Account
                  </Button>

                  <p className="text-xs text-muted-foreground text-center">
                    A verification code will be sent to your email.
                  </p>
                </form>
              </motion.div>
            )}

            {tab === "verify" && (
              <motion.div key="verify" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                <div className="text-center mb-8">
                  <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <ShieldCheck className="w-8 h-8 text-primary" />
                  </div>
                  <h2 className="text-2xl font-display font-bold text-foreground mb-2">Verify Your Email</h2>
                  <p className="text-muted-foreground text-sm">
                    We sent a 6-digit verification code to<br />
                    <span className="font-semibold text-foreground">{verifyEmail}</span>
                  </p>
                </div>

                <form onSubmit={handleVerify} className="space-y-5">
                  <div className="space-y-1.5">
                    <Label className="text-sm font-semibold text-center block">Verification Code</Label>
                    <Input
                      value={verifyCode}
                      onChange={e => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="000000"
                      className="rounded-xl h-14 text-center text-2xl tracking-[0.5em] font-mono"
                      maxLength={6}
                      required
                      autoFocus
                    />
                  </div>

                  {error && (
                    <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                      {error}
                    </div>
                  )}

                  <Button type="submit" size="lg" disabled={loading || verifyCode.length !== 6}
                    className="w-full rounded-xl py-6 text-base font-semibold shadow-lg shadow-primary/25">
                    {loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <ShieldCheck className="w-5 h-5 mr-2" />}
                    Verify & Sign In
                  </Button>

                  <div className="text-center">
                    <button type="button" onClick={handleResendCode} disabled={resending}
                      className="text-sm text-primary font-medium hover:underline disabled:opacity-50">
                      {resending ? "Sending..." : "Resend verification code"}
                    </button>
                  </div>

                  <button type="button" onClick={() => { setTab("login"); setError(""); }}
                    className="w-full text-sm text-muted-foreground hover:text-foreground text-center">
                    Back to Sign In
                  </button>
                </form>
              </motion.div>
            )}

            {tab === "set-password" && (
              <motion.div key="set-password" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                {passwordSet ? (
                  <div className="text-center">
                    <div className="w-16 h-16 rounded-2xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
                      <ShieldCheck className="w-8 h-8 text-green-600 dark:text-green-400" />
                    </div>
                    <h2 className="text-2xl font-display font-bold text-foreground mb-2">Password Set!</h2>
                    <p className="text-muted-foreground text-sm mb-6">
                      Your password has been set successfully. You can now sign in to your account.
                    </p>
                    <Button size="lg" onClick={() => { setTab("login"); setError(""); setSuccessMessage(""); window.history.replaceState({}, "", "/login"); }}
                      className="w-full rounded-xl py-6 text-base font-semibold shadow-lg shadow-primary/25">
                      <ArrowRight className="w-5 h-5 mr-2" />
                      Go to Sign In
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="text-center mb-8">
                      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                        <Lock className="w-8 h-8 text-primary" />
                      </div>
                      <h2 className="text-2xl font-display font-bold text-foreground mb-2">Set Your Password</h2>
                      <p className="text-muted-foreground text-sm">
                        Create a password to access your student portal.
                      </p>
                    </div>

                    <form onSubmit={handleSetPassword} className="space-y-5">
                      <div className="space-y-1.5">
                        <Label className="flex items-center gap-1.5 text-sm font-semibold"><Lock className="w-3.5 h-3.5" /> New Password</Label>
                        <div className="relative">
                          <Input
                            type={showPassword ? "text" : "password"}
                            value={setPasswordForm.password}
                            onChange={e => setSetPasswordForm(f => ({ ...f, password: e.target.value }))}
                            placeholder="Min. 8 characters"
                            className="rounded-xl h-12 pr-12"
                            required
                            minLength={8}
                            autoFocus
                          />
                          <button type="button" onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                            {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                          </button>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-sm font-semibold">Confirm Password</Label>
                        <Input
                          type="password"
                          value={setPasswordForm.confirmPassword}
                          onChange={e => setSetPasswordForm(f => ({ ...f, confirmPassword: e.target.value }))}
                          placeholder="Re-enter password"
                          className="rounded-xl h-12"
                          required
                        />
                      </div>

                      {error && (
                        <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                          {error}
                        </div>
                      )}

                      <Button type="submit" size="lg" disabled={loading}
                        className="w-full rounded-xl py-6 text-base font-semibold shadow-lg shadow-primary/25">
                        {loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <ShieldCheck className="w-5 h-5 mr-2" />}
                        Set Password
                      </Button>

                      <button type="button" onClick={() => { setTab("login"); setError(""); window.history.replaceState({}, "", "/login"); }}
                        className="w-full text-sm text-muted-foreground hover:text-foreground text-center">
                        Back to Sign In
                      </button>
                    </form>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {tab !== "verify" && tab !== "set-password" && (
            <div className="mt-8 p-5 rounded-2xl bg-secondary/50 border border-border/40">
              <p className="text-sm text-muted-foreground text-center">
                By signing in, you agree to our{" "}
                <span className="text-primary font-medium cursor-pointer hover:underline">Terms of Service</span>
                {" "}and{" "}
                <span className="text-primary font-medium cursor-pointer hover:underline">Privacy Policy</span>.
              </p>
            </div>
          )}

          {tab === "login" && (
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
          )}
        </motion.div>
      </div>
    </div>
  );
}
