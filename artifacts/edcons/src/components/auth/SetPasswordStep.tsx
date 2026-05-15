import { useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, KeyRound, CheckCircle2 } from "lucide-react";

interface Props {
  onComplete: () => void;
}

/**
 * Full-screen lock shown to authenticated agents who have verified their email
 * but have not yet chosen a password. Posts to /api/agents/me/set-password.
 */
export default function SetPasswordStep({ onComplete }: Props) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function validateLocal(): string {
    if (password.length < 8) return "Şifre en az 8 karakter olmalı. / Password must be at least 8 characters.";
    if (!/[A-Z]/.test(password)) return "Şifre en az bir büyük harf içermeli. / Password must contain an uppercase letter.";
    if (!/[0-9]/.test(password)) return "Şifre en az bir rakam içermeli. / Password must contain a number.";
    if (password !== confirm) return "Şifreler eşleşmiyor. / Passwords do not match.";
    return "";
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const local = validateLocal();
    if (local) { setError(local); return; }
    setSubmitting(true);
    try {
      await customFetch("/api/agents/me/set-password", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      onComplete();
    } catch (err: any) {
      setError(err?.body?.error || err?.message || "Şifre belirlenemedi.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-950 p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="bg-primary px-8 py-6 text-primary-foreground">
          <h1 className="text-xl font-semibold">Şifrenizi Belirleyin</h1>
          <p className="text-sm opacity-90 mt-1">Set Your Password</p>
        </div>
        <form onSubmit={onSubmit} className="p-8 space-y-4">
          <div className="flex items-start gap-3 p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded-lg">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-emerald-900 dark:text-emerald-200">E-posta doğrulandı</p>
              <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
                Devam etmek için bir şifre belirleyin. Sonraki adımda sözleşmenizi imzalayacaksınız.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sps-password">Yeni Şifre / New Password</Label>
            <Input
              id="sps-password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sps-confirm">Şifre Tekrarı / Confirm Password</Label>
            <Input
              id="sps-confirm"
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

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3">
              {error}
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
      </div>
    </div>
  );
}
