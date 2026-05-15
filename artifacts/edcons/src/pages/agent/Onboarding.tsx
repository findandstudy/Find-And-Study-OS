import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, AlertCircle, KeyRound, Mail } from "lucide-react";

function goToAgentDashboard() {
  // Full reload so the new session cookie + cleared query cache result in
  // useGetMe re-fetching the now-authenticated user.
  if (typeof window !== "undefined") {
    window.location.href = "/agent";
  }
}

type Step = "verifying" | "verify_failed" | "set_password" | "done";

function readQueryParams(): { email: string; code: string } {
  if (typeof window === "undefined") return { email: "", code: "" };
  const sp = new URLSearchParams(window.location.search);
  return {
    email: (sp.get("email") || "").trim(),
    code: (sp.get("code") || "").trim(),
  };
}

export default function AgentOnboardingPage() {
  const [, setLocation] = useLocation();
  const params = readQueryParams();
  const [email] = useState(params.email);
  const [code] = useState(params.code);

  const [step, setStep] = useState<Step>(email && code ? "verifying" : "verify_failed");
  const [errorMessage, setErrorMessage] = useState("");
  const ranVerify = useRef(false);

  // Password form
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pwError, setPwError] = useState("");

  useEffect(() => {
    if (ranVerify.current) return;
    if (!email || !code) return;
    ranVerify.current = true;
    (async () => {
      try {
        const res: any = await customFetch("/api/agents/onboarding/verify-with-link", {
          method: "POST",
          body: JSON.stringify({ email, code }),
        });
        if (res?.passwordSet) {
          setStep("done");
          setTimeout(goToAgentDashboard, 800);
        } else {
          setStep("set_password");
        }
      } catch (err: any) {
        setErrorMessage(err?.body?.error || err?.message || "Doğrulama başarısız oldu.");
        setStep("verify_failed");
      }
    })();
  }, [email, code]);

  function validateClient(): string {
    if (password.length < 8) return "Şifre en az 8 karakter olmalı. / Password must be at least 8 characters.";
    if (!/[A-Z]/.test(password)) return "Şifre en az bir büyük harf içermeli. / Password must contain an uppercase letter.";
    if (!/[0-9]/.test(password)) return "Şifre en az bir rakam içermeli. / Password must contain a number.";
    if (password !== confirm) return "Şifreler eşleşmiyor. / Passwords do not match.";
    return "";
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError("");
    const local = validateClient();
    if (local) { setPwError(local); return; }
    setSubmitting(true);
    try {
      await customFetch("/api/agents/me/set-password", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setStep("done");
      setTimeout(goToAgentDashboard, 600);
    } catch (err: any) {
      setPwError(err?.body?.error || err?.message || "Şifre belirlenemedi.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-950 p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="bg-primary px-8 py-6 text-primary-foreground">
          <h1 className="text-xl font-semibold">Acente Hesap Doğrulama</h1>
          <p className="text-sm opacity-90 mt-1">Agent Account Verification</p>
        </div>

        <div className="p-8">
          {step === "verifying" && (
            <div className="flex flex-col items-center text-center py-6">
              <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
              <p className="text-slate-700 dark:text-slate-300">E-postanız doğrulanıyor...</p>
              <p className="text-xs text-slate-500 mt-1">Verifying your email…</p>
            </div>
          )}

          {step === "verify_failed" && (
            <div className="flex flex-col items-center text-center py-4">
              <AlertCircle className="w-10 h-10 text-destructive mb-4" />
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
                Doğrulama Başarısız
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">
                {errorMessage || "Geçersiz veya süresi dolmuş bağlantı."}
              </p>
              <p className="text-xs text-slate-500 mb-6">
                Invalid or expired link. Log in and request a new code.
              </p>
              <Button onClick={() => setLocation("/login")} className="w-full">
                <Mail className="w-4 h-4 mr-2" />
                Giriş Yap / Go to Login
              </Button>
            </div>
          )}

          {step === "set_password" && (
            <form onSubmit={handleSetPassword} className="space-y-4">
              <div className="flex items-start gap-3 p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded-lg">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-emerald-900 dark:text-emerald-200">E-posta doğrulandı</p>
                  <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
                    Şimdi şifrenizi belirleyin, ardından sözleşmenizi imzalayacaksınız.
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Yeni Şifre / New Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm">Şifre Tekrarı / Confirm Password</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={submitting}
                />
              </div>

              <ul className="text-xs text-slate-500 dark:text-slate-400 space-y-0.5 pl-1">
                <li>• En az 8 karakter / At least 8 characters</li>
                <li>• En az bir büyük harf / One uppercase letter</li>
                <li>• En az bir rakam / One number</li>
              </ul>

              {pwError && (
                <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3">
                  {pwError}
                </div>
              )}

              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Kaydediliyor...</>
                ) : (
                  <><KeyRound className="w-4 h-4 mr-2" />Şifreyi Belirle / Set Password</>
                )}
              </Button>
            </form>
          )}

          {step === "done" && (
            <div className="flex flex-col items-center text-center py-6">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mb-4" />
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1">
                Hazır!
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Sözleşme imzalama adımına yönlendiriliyorsunuz...
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Redirecting to contract signing…
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
