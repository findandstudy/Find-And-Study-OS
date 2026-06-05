import { useEffect, useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { PhoneInput } from "@/components/ui/phone-input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useI18n } from "@/hooks/use-i18n";
import { Loader2, FileSignature, Eraser, AlertCircle, LogOut, Upload, X, Lock } from "lucide-react";

const BASE_URL = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const CURRENT_YEAR = String(new Date().getFullYear());

interface IntakeField {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  options?: string[];
}

interface SessionData {
  sessionId: number;
  status: string;
  expiresAt: string;
  signerEmail: string;
  signerName: string | null;
  mode?: string;
  intakeData?: Record<string, string> | null;
  template: {
    id: number;
    name: string;
    language: string;
    entityType: string;
    intakeSchema?: IntakeField[] | null;
  } | null;
  previewHtml: string | null;
}

interface Props {
  onSigned: () => void;
  /** When true, renders the signing flow inside a non-dismissible modal dialog
   *  overlaid on top of the dashboard instead of as a full-screen lock. */
  asModal?: boolean;
  /** When set, signs this specific (admin-sent, non-onboarding) session via the
   *  agent-scoped /api/contracts/me/session/:id endpoints. When omitted, falls
   *  back to the primary onboarding session (/api/contracts/me). */
  sessionId?: number;
  /** When provided, the flow becomes dismissible (admin-sent contracts are
   *  non-blocking): a close handler is wired and a "Later" action is shown
   *  instead of the onboarding "Sign out" action. */
  onClose?: () => void;
}

// ── Field-detection heuristics (mirror the public self-fill flow) ──
const NAME_FIELD_PATTERNS = [
  /full[\s_-]?name/i, /signer[\s_-]?name/i, /contact[\s_-]?(person|name)/i,
  /\bname\b/i, /isim|ad\s*soyad|ad\s+soyad/i, /الاسم/i, /имя/i, /nom\s+complet/i,
];
function isNameLikeField(f: IntakeField): boolean {
  const haystack = `${f.key || ""} ${f.label || ""}`;
  return NAME_FIELD_PATTERNS.some(rx => rx.test(haystack));
}
const EMAIL_FIELD_PATTERNS = [
  /e-?mail/i, /eposta|e-posta/i, /البريد/i, /почт|эл\.?\s*адрес/i, /courriel|correo/i,
];
function isEmailLikeField(f: IntakeField): boolean {
  if (f.type === "email") return true;
  const haystack = `${f.key || ""} ${f.label || ""}`;
  return EMAIL_FIELD_PATTERNS.some(rx => rx.test(haystack));
}
function isYearLikeField(f: IntakeField): boolean {
  const haystack = `${f.key || ""} ${f.label || ""}`;
  return /year|yıl|yil|سنة|год|année|año/i.test(haystack) || f.type === "number";
}
function isFileLikeField(f: IntakeField): boolean {
  if (f.type === "file") return true;
  const haystack = `${f.key || ""} ${f.label || ""}`;
  return /logo|görsel|gorsel|image|upload|dosya|file/i.test(haystack);
}

async function uploadFileToStorage(file: File): Promise<string> {
  const urlRes = await customFetch<any>(`/api/storage/uploads/request-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
  });
  if (!urlRes.uploadURL || !urlRes.objectPath) throw new Error("Failed to get upload URL");
  const putRes = await fetch(urlRes.uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
  if (!putRes.ok) throw new Error("Upload failed");
  const strippedPath = urlRes.objectPath.replace(/^\/objects/, "");
  return `${BASE_URL}/api/storage/objects${strippedPath}`;
}

/**
 * Authenticated agent signing flow. By default it signs the primary onboarding
 * contract (session resolved from /api/contracts/me). When `sessionId` is given
 * it signs that specific admin-sent contract via the agent-scoped session
 * endpoints, and `onClose` makes the modal dismissible (non-blocking).
 *
 * For the primary onboarding contract, when the template defines an intake
 * schema the flow opens with a "Your Details" (Agency Information) step before
 * Review → Sign. The agent's email is pre-filled and locked (no verification).
 */
export default function SignContract({ onSigned, asModal = false, sessionId, onClose }: Props) {
  const { t } = useI18n();
  const dismissible = !!onClose;
  // Intake is only collected for the primary onboarding session.
  const isOnboarding = !sessionId;
  const loadUrl = sessionId ? `/api/contracts/me/session/${sessionId}` : "/api/contracts/me";
  const signUrl = sessionId ? `/api/contracts/me/session/${sessionId}/sign` : "/api/contracts/me/sign";
  const [data, setData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<"details" | "review" | "sign">("review");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [signerName, setSignerName] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  // Intake ("Your Details") state.
  const [intake, setIntake] = useState<Record<string, string>>({});

  function loadData(initial: boolean) {
    return (async () => {
      try {
        const r: any = await customFetch(loadUrl);
        if (!r.data) { setError(t("agentOnboarding.sign.notFound") || "No onboarding contract found. Contact your administrator."); return; }
        const d: SessionData = r.data;
        setData(d);
        setSignerName(d.signerName || "");
        if (initial) {
          const schema = (isOnboarding && d.template?.intakeSchema) || [];
          // Seed intake answers: existing data, then locked email + year defaults.
          const seed: Record<string, string> = { ...(d.intakeData || {}) };
          for (const f of schema) {
            if (isEmailLikeField(f)) seed[f.key] = d.signerEmail || seed[f.key] || "";
            else if (isYearLikeField(f) && !seed[f.key]) seed[f.key] = CURRENT_YEAR;
          }
          setIntake(seed);
          const needsIntake = isOnboarding && d.status === "intake_pending" && schema.length > 0;
          setStep(needsIntake ? "details" : "review");
        }
      } catch (err: any) {
        setError(err?.body?.error || err?.message || "Failed to load contract.");
      }
      if (initial) setLoading(false);
    })();
  }

  useEffect(() => {
    loadData(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadUrl]);

  const intakeFields: IntakeField[] = (isOnboarding && data?.template?.intakeSchema) || [];

  async function submitIntake() {
    setSubmitting(true); setError("");
    try {
      await customFetch("/api/contracts/me/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intake }),
      });
      // Reload so the preview HTML reflects the entered information.
      await loadData(false);
      setStep("review");
    } catch (err: any) {
      setError(err?.body?.error || err?.message || t("agentOnboarding.sign.failed") || "Failed to save your details.");
    }
    setSubmitting(false);
  }

  async function submitSignature(b64: string) {
    if (!data) return;
    setSubmitting(true); setError("");
    try {
      await customFetch(signUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureImagePngBase64: b64, signerName }),
      });
      onSigned();
    } catch (err: any) {
      setError(err?.body?.error || err?.message || t("agentOnboarding.sign.failed") || "Signing failed.");
    }
    setSubmitting(false);
  }

  // Required non-email fields must be filled before continuing.
  const canContinueIntake = intakeFields.every(f => {
    if (!f.required) return true;
    if (isEmailLikeField(f)) return true; // auto-filled + locked
    return (intake[f.key] || "").trim().length > 0;
  });

  const loadingNode = (
    <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
  );
  const errorNode = (
    <div className="flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-3">
        <AlertCircle className="w-12 h-12 text-amber-500 mx-auto" />
        <h1 className="text-xl font-semibold">{t("agentOnboarding.sign.unavailable") || "Contract unavailable"}</h1>
        <p className="text-sm text-muted-foreground">{error}</p>
        {dismissible ? (
          <Button variant="outline" onClick={onClose}>{t("common.close") || "Close"}</Button>
        ) : (
          <Button variant="outline" asChild><a href="/api/auth/logout"><LogOut className="w-4 h-4 mr-2" /> {t("common.signOut") || "Sign out"}</a></Button>
        )}
      </div>
    </div>
  );

  const exitButton = dismissible ? (
    <Button variant="ghost" onClick={onClose}>{t("common.later") || "Later"}</Button>
  ) : (
    <Button variant="ghost" asChild><a href="/api/auth/logout"><LogOut className="w-4 h-4 mr-2" /> {t("common.signOut") || "Sign out"}</a></Button>
  );

  const innerContent = data ? (
    <>
      <div className="text-center mb-6">
        <h1 className="text-2xl font-semibold">{t("agentOnboarding.sign.title") || "Sign your agency contract"}</h1>
        <p className="text-sm text-muted-foreground mt-1">{data.template?.name}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {t("agentOnboarding.sign.deadline") || "Deadline"}: <strong>{new Date(data.expiresAt).toLocaleString()}</strong>
        </p>
      </div>
      <div className="bg-card border rounded-2xl shadow-sm p-6">
        {step === "details" ? (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold">{t("agentOnboarding.intake.title") || "Agency Information"}</h2>
              <p className="text-sm text-muted-foreground">{t("agentOnboarding.intake.subtitle") || "Fill in your agency details before reviewing the contract."}</p>
            </div>
            <div className="space-y-4">
              {intakeFields.map(f => (
                <div key={f.key}>
                  <Label className="flex items-center gap-1.5">
                    {f.label}{f.required ? <span className="text-destructive">*</span> : null}
                    {isEmailLikeField(f) ? <Lock className="w-3 h-3 text-muted-foreground" /> : null}
                  </Label>
                  <div className="mt-1.5">
                    {isEmailLikeField(f) ? (
                      <Input type="email" value={data.signerEmail || ""} readOnly disabled className="bg-muted text-muted-foreground cursor-not-allowed" />
                    ) : f.type === "textarea" ? (
                      <Textarea placeholder={f.placeholder} value={intake[f.key] || ""} onChange={e => setIntake(s => ({ ...s, [f.key]: e.target.value }))} rows={3} />
                    ) : f.type === "select" ? (
                      <SearchableSelect
                        value={intake[f.key] || ""}
                        onValueChange={v => setIntake(s => ({ ...s, [f.key]: v }))}
                        options={(f.options || []).map(o => ({ value: o, label: o }))}
                        placeholder={f.placeholder || (t("common.select") || "Select...")}
                      />
                    ) : isYearLikeField(f) ? (
                      <Input type="text" value={intake[f.key] || CURRENT_YEAR} readOnly disabled className="bg-muted text-muted-foreground cursor-not-allowed" aria-readonly="true" />
                    ) : f.type === "tel" ? (
                      <PhoneInput value={intake[f.key] || ""} onChange={v => setIntake(s => ({ ...s, [f.key]: v }))} />
                    ) : isFileLikeField(f) ? (
                      <LogoUpload value={intake[f.key] || ""} onChange={v => setIntake(s => ({ ...s, [f.key]: v }))} onError={setError} />
                    ) : (
                      <Input
                        placeholder={f.placeholder}
                        type={f.type === "date" ? "date" : "text"}
                        value={intake[f.key] || ""}
                        onChange={e => setIntake(s => ({ ...s, [f.key]: e.target.value }))}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{error}</span>
              </div>
            )}
            <div className="flex justify-between pt-2">
              {exitButton}
              <Button onClick={submitIntake} disabled={!canContinueIntake || submitting}>
                {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                {t("common.continue") || "Continue"}
              </Button>
            </div>
          </div>
        ) : step === "review" ? (
          <>
            <div className="prose prose-sm dark:prose-invert max-w-none border rounded-lg p-6 bg-card max-h-[60vh] overflow-y-auto"
              dangerouslySetInnerHTML={{ __html: data.previewHtml || "" }} />
            <div className="flex justify-between mt-6">
              {intakeFields.length > 0 && isOnboarding ? (
                <Button variant="outline" onClick={() => { setError(""); setStep("details"); }}>{t("common.back") || "Back"}</Button>
              ) : (
                exitButton
              )}
              <Button onClick={() => setStep("sign")}>
                <FileSignature className="w-4 h-4 mr-2" /> {t("agentOnboarding.sign.proceed") || "Proceed to sign"}
              </Button>
            </div>
          </>
        ) : (
          <SignaturePad
            onSubmit={submitSignature}
            submitting={submitting}
            onCancel={() => setStep("review")}
            signerName={signerName}
            onChangeName={setSignerName}
            confirmed={confirmed}
            setConfirmed={setConfirmed}
            error={error}
          />
        )}
      </div>
    </>
  ) : null;

  if (asModal) {
    return (
      <Dialog open={true} onOpenChange={(open) => { if (!open && dismissible) onClose?.(); }}>
        <DialogContent
          className={`max-w-3xl max-h-[90vh] overflow-y-auto p-6 ${dismissible ? "" : "[&>button]:hidden"}`}
          onPointerDownOutside={e => { if (!dismissible) e.preventDefault(); }}
          onEscapeKeyDown={e => { if (!dismissible) e.preventDefault(); }}
          onInteractOutside={e => { if (!dismissible) e.preventDefault(); }}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>{t("agentOnboarding.sign.title") || "Sign your agency contract"}</DialogTitle>
            <DialogDescription>{data?.template?.name || ""}</DialogDescription>
          </DialogHeader>
          {loading ? loadingNode : (error && !data) ? errorNode : innerContent}
        </DialogContent>
      </Dialog>
    );
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }
  if (error && !data) {
    return <div className="min-h-screen flex items-center justify-center bg-background">{errorNode}</div>;
  }

  return (
    <div className="min-h-screen bg-secondary/30 py-8 px-4">
      <div className="max-w-3xl mx-auto">{innerContent}</div>
    </div>
  );
}

function LogoUpload({ value, onChange, onError }: { value: string; onChange: (v: string) => void; onError: (m: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { onError("Please upload an image file."); return; }
    setUploading(true);
    try {
      const url = await uploadFileToStorage(file);
      onChange(url);
    } catch (err: any) {
      onError(err?.message || "Upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-3">
      {value ? (
        <div className="relative">
          <img src={value} alt="" className="w-16 h-16 rounded-lg object-cover border" />
          <button type="button" onClick={() => onChange("")} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-white flex items-center justify-center shadow">
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : null}
      <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => inputRef.current?.click()} className="gap-2">
        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        {value ? "Change" : "Upload"}
      </Button>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={e => handleFile(e.target.files?.[0])} />
    </div>
  );
}

function SignaturePad({ onSubmit, submitting, onCancel, signerName, onChangeName, confirmed, setConfirmed, error }: {
  onSubmit: (b64: string) => void;
  submitting: boolean;
  onCancel: () => void;
  signerName: string;
  onChangeName: (v: string) => void;
  confirmed: boolean;
  setConfirmed: (b: boolean) => void;
  error: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * ratio;
    c.height = rect.height * ratio;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#0f172a";
  }, []);

  function pos(e: React.PointerEvent) {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function start(e: React.PointerEvent) {
    const ctx = canvasRef.current!.getContext("2d")!;
    setDrawing(true);
    const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y);
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    if (!drawing) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke();
    setHasInk(true);
  }
  function end() { setDrawing(false); }
  function clear() {
    const c = canvasRef.current!; const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  }
  function submit() {
    if (!hasInk) return;
    onSubmit(canvasRef.current!.toDataURL("image/png"));
  }

  return (
    <div className="space-y-4">
      <div>
        <Label>İsim Soyisim *</Label>
        <Input value={signerName} onChange={e => onChangeName(e.target.value)} />
      </div>
      <div>
        <Label>İmzanız *</Label>
        <div className="border rounded-lg bg-white relative" style={{ height: 200 }}>
          <canvas ref={canvasRef} className="w-full h-full touch-none rounded-lg"
            onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
          <button type="button" onClick={clear} className="absolute top-2 right-2 text-xs text-muted-foreground flex items-center gap-1 bg-white/80 px-2 py-1 rounded">
            <Eraser className="w-3 h-3" /> Temizle
          </button>
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-1" />
        <span>Bu sözleşmeyi okuduğumu, anladığımı ve elektronik imzamın geçerli kabul edileceğini onaylıyorum.</span>
      </label>
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}
      <div className="flex justify-between">
        <Button variant="outline" onClick={onCancel}>Geri</Button>
        <Button onClick={submit} disabled={!hasInk || !confirmed || !signerName.trim() || submitting}>
          {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <FileSignature className="w-4 h-4 mr-2" />}
          İmzala ve gönder
        </Button>
      </div>
    </div>
  );
}
