import { useEffect, useMemo, useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle2, AlertCircle, FileSignature, Eraser } from "lucide-react";
import { getTranslation, isValidLanguage, type Language, RTL_LANGUAGES } from "@/lib/i18n/index";

type SessionView = {
  sessionId: number;
  mode: "admin_driven" | "self_fill";
  status: "intake_pending" | "review_pending" | "signed" | "revoked";
  signerEmail: string;
  signerName: string | null;
  expiresAt: string;
  expired: boolean;
  template: { id: number; name: string; language: string; entityType: string; intakeSchema: any[] | null };
  agent: any;
  intakeData: Record<string, string> | null;
};

type Step = "loading" | "expired" | "revoked" | "intake" | "review" | "sign" | "success" | "error";

// Heuristic: detect intake fields that already capture the signer's full name
// so we don't render two identical "name" inputs (template author may have
// added one explicitly, and we always collect signerName for the signature).
const NAME_FIELD_PATTERNS = [
  /full[\s_-]?name/i,
  /signer[\s_-]?name/i,
  /\bname\b/i,
  /isim|ad\s*soyad|ad\s+soyad/i,
  /الاسم/i,
  /имя/i,
  /nom\s+complet/i,
];
function isNameLikeField(f: { key?: string; label?: string }): boolean {
  const haystack = `${f.key || ""} ${f.label || ""}`;
  return NAME_FIELD_PATTERNS.some(rx => rx.test(haystack));
}

export default function SignFlow({ token }: { token: string }) {
  const [step, setStep] = useState<Step>("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [session, setSession] = useState<SessionView | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [intake, setIntake] = useState<Record<string, string>>({});
  const [signerName, setSignerName] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  // Sign flow language is driven by the contract template's language so the
  // signing experience matches the language the issuer picked when sending
  // the link, regardless of the recipient's browser locale.
  const lang: Language = useMemo(() => {
    const raw = session?.template?.language;
    return raw && isValidLanguage(raw) ? raw : "en";
  }, [session?.template?.language]);
  const t = (key: string, params?: Record<string, string | number>) =>
    getTranslation(lang, `sign.${key}`, params);
  const isRTL = RTL_LANGUAGES.includes(lang);

  useEffect(() => {
    if (!session) return;
    document.documentElement.lang = lang;
    document.documentElement.dir = isRTL ? "rtl" : "ltr";
  }, [lang, isRTL, session]);

  useEffect(() => {
    (async () => {
      try {
        const res: any = await customFetch(`/api/public/sign/${encodeURIComponent(token)}`);
        const data: SessionView = res.data;
        setSession(data);
        setSignerName(data.signerName || "");
        if (Array.isArray(data.template.intakeSchema) && data.intakeData) {
          setIntake(data.intakeData);
        }
        if (data.expired) { setStep("expired"); return; }
        if (data.status === "signed") { setStep("success"); return; }
        if (data.status === "revoked") { setStep("revoked"); return; }
        if (data.mode === "self_fill" && data.status === "intake_pending") { setStep("intake"); return; }
        await loadPreview();
        setStep("review");
      } catch (err: any) {
        const status = err?.status || err?.response?.status;
        const code = err?.body?.code || err?.response?.data?.code || err?.data?.code;
        const langGuess: Language = "en";
        if (status === 410 && code === "revoked") { setStep("revoked"); return; }
        if (status === 410) { setStep("expired"); return; }
        if (status === 404) { setErrorMsg(getTranslation(langGuess, "sign.notFound")); setStep("error"); return; }
        setErrorMsg(err?.message || getTranslation(langGuess, "sign.loadError")); setStep("error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function loadPreview() {
    const r: any = await customFetch(`/api/public/sign/${encodeURIComponent(token)}/preview`);
    setPreviewHtml(r.data?.html || "");
  }

  // If the intake schema already contains a name field, mirror its value into
  // signerName so the signature record stays correct without showing a second
  // input.
  const fields = (session?.template.intakeSchema || []) as { key: string; label: string; type: string; required?: boolean }[];
  const intakeNameField = fields.find(isNameLikeField);

  async function submitIntake() {
    setSubmitting(true);
    try {
      const effectiveName = intakeNameField ? (intake[intakeNameField.key] || "").trim() : signerName;
      if (intakeNameField && effectiveName !== signerName) setSignerName(effectiveName);
      await customFetch(`/api/public/sign/${encodeURIComponent(token)}/intake`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ intake: { ...intake, signerName: effectiveName } }),
      });
      await loadPreview();
      setStep("review");
    } catch (err: any) {
      alert(err?.message || t("saveError"));
    }
    setSubmitting(false);
  }

  async function submitSignature(signaturePngBase64: string) {
    setSubmitting(true);
    try {
      await customFetch(`/api/public/sign/${encodeURIComponent(token)}/sign`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ signatureImagePngBase64: signaturePngBase64, signerName }),
      });
      setStep("success");
    } catch (err: any) {
      alert(err?.message || t("signError"));
    }
    setSubmitting(false);
  }

  if (step === "loading") {
    return <CenterShell><Loader2 className="w-8 h-8 animate-spin text-primary" /></CenterShell>;
  }
  if (step === "expired") {
    return <CenterShell>
      <AlertCircle className="w-12 h-12 text-amber-500 mb-4" />
      <h1 className="text-xl font-semibold mb-2">{t("expired")}</h1>
      <p className="text-muted-foreground text-sm">{t("expiredBody")}</p>
    </CenterShell>;
  }
  if (step === "revoked") {
    return <CenterShell>
      <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
      <h1 className="text-xl font-semibold mb-2">{t("revoked")}</h1>
      <p className="text-muted-foreground text-sm">{t("revokedBody")}</p>
    </CenterShell>;
  }
  if (step === "error") {
    return <CenterShell>
      <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
      <h1 className="text-xl font-semibold mb-2">{t("error")}</h1>
      <p className="text-muted-foreground text-sm">{errorMsg}</p>
    </CenterShell>;
  }
  if (step === "success") {
    const pdfUrl = `/api/public/sign/${encodeURIComponent(token)}/pdf`;
    return <CenterShell>
      <CheckCircle2 className="w-14 h-14 text-emerald-500 mb-4" />
      <h1 className="text-2xl font-semibold mb-2">{t("signed")}</h1>
      <p className="text-muted-foreground text-sm text-center max-w-md mb-6">{t("signedBody")}</p>
      <div className="flex flex-col sm:flex-row gap-2 w-full">
        <Button asChild className="flex-1">
          <a href={pdfUrl} target="_blank" rel="noopener noreferrer" download>
            <FileSignature className="w-4 h-4 mr-2" />
            {t("downloadPdf")}
          </a>
        </Button>
        <Button asChild variant="outline" className="flex-1">
          <a href="/login">{t("openPortal")}</a>
        </Button>
      </div>
    </CenterShell>;
  }

  if (!session) return null;

  if (step === "intake") {
    const canContinue = (intakeNameField
      ? (intake[intakeNameField.key] || "").trim().length > 0
      : signerName.trim().length > 0);
    return (
      <Shell title={t("title")} subtitle={session.template.name}>
        <Stepper step={1} labels={[t("stepIntake"), t("stepReview"), t("stepSign")]} />
        <div className="space-y-4">
          {!intakeNameField && (
            <div>
              <Label>{t("fullName")} *</Label>
              <Input value={signerName} onChange={e => setSignerName(e.target.value)} required />
            </div>
          )}
          {fields.map(f => (
            <div key={f.key}>
              <Label>{f.label}{f.required ? " *" : ""}</Label>
              {f.type === "textarea" ? (
                <Textarea value={intake[f.key] || ""} onChange={e => setIntake(s => ({ ...s, [f.key]: e.target.value }))} rows={3} />
              ) : (
                <Input type={f.type === "email" ? "email" : f.type === "date" ? "date" : "text"} value={intake[f.key] || ""} onChange={e => setIntake(s => ({ ...s, [f.key]: e.target.value }))} />
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-end mt-6">
          <Button onClick={submitIntake} disabled={submitting || !canContinue}>
            {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null} {t("continue")}
          </Button>
        </div>
      </Shell>
    );
  }

  if (step === "review") {
    return (
      <Shell title={t("titleReview")} subtitle={session.template.name}>
        <Stepper step={session.mode === "self_fill" ? 2 : 1} labels={
          session.mode === "self_fill"
            ? [t("stepIntake"), t("stepReview"), t("stepSign")]
            : [t("stepReview"), t("stepSign")]
        } />
        <div
          className="prose prose-sm dark:prose-invert max-w-none border rounded-lg p-6 bg-card max-h-[60vh] overflow-y-auto"
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
        <div className="flex justify-between mt-6">
          {session.mode === "self_fill" ? (
            <Button variant="outline" onClick={() => setStep("intake")}>{t("back")}</Button>
          ) : <span />}
          <Button onClick={() => setStep("sign")}><FileSignature className="w-4 h-4 mr-2" /> {t("sign")}</Button>
        </div>
      </Shell>
    );
  }

  if (step === "sign") {
    return (
      <Shell title={t("titleSign")} subtitle={session.template.name}>
        <Stepper step={session.mode === "self_fill" ? 3 : 2} labels={
          session.mode === "self_fill"
            ? [t("stepIntake"), t("stepReview"), t("stepSign")]
            : [t("stepReview"), t("stepSign")]
        } />
        <SignaturePad
          onSubmit={submitSignature}
          submitting={submitting}
          onCancel={() => setStep("review")}
          signerName={signerName}
          onChangeName={setSignerName}
          t={t}
          showNameInput={!intakeNameField}
        />
      </Shell>
    );
  }

  return null;
}

function CenterShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-secondary/30 flex items-center justify-center p-4">
      <div className="bg-card border rounded-2xl shadow-sm p-10 max-w-md w-full flex flex-col items-center text-center">{children}</div>
    </div>
  );
}

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-secondary/30 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
        </div>
        <div className="bg-card border rounded-2xl shadow-sm p-6">{children}</div>
      </div>
    </div>
  );
}

function Stepper({ step, labels }: { step: number; labels: string[] }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {labels.map((label, i) => {
        const num = i + 1;
        const active = num === step;
        const done = num < step;
        return (
          <div key={label} className="flex items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold ${active ? "bg-primary text-primary-foreground" : done ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"}`}>
              {done ? "✓" : num}
            </div>
            <span className={`ml-2 text-sm ${active ? "font-semibold" : "text-muted-foreground"}`}>{label}</span>
            {i < labels.length - 1 && <div className="w-8 h-px bg-border mx-3" />}
          </div>
        );
      })}
    </div>
  );
}

function SignaturePad({ onSubmit, submitting, onCancel, signerName, onChangeName, t, showNameInput }: {
  onSubmit: (b64: string) => void;
  submitting: boolean;
  onCancel: () => void;
  signerName: string;
  onChangeName: (v: string) => void;
  t: (k: string) => string;
  showNameInput: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

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

  function pointerPos(e: PointerEvent | React.PointerEvent) {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return { x: (e as any).clientX - rect.left, y: (e as any).clientY - rect.top };
  }
  function start(e: React.PointerEvent) {
    const c = canvasRef.current!; const ctx = c.getContext("2d")!;
    setDrawing(true);
    const p = pointerPos(e);
    ctx.beginPath(); ctx.moveTo(p.x, p.y);
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    if (!drawing) return;
    const c = canvasRef.current!; const ctx = c.getContext("2d")!;
    const p = pointerPos(e);
    ctx.lineTo(p.x, p.y); ctx.stroke();
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
    const c = canvasRef.current!;
    const dataUrl = c.toDataURL("image/png");
    onSubmit(dataUrl);
  }

  return (
    <div className="space-y-4">
      {showNameInput && (
        <div>
          <Label>{t("fullName")} *</Label>
          <Input value={signerName} onChange={e => onChangeName(e.target.value)} />
        </div>
      )}
      <div>
        <Label>{t("signature")}</Label>
        <div className="border rounded-lg bg-white relative" style={{ height: 200 }}>
          <canvas
            ref={canvasRef}
            className="w-full h-full touch-none rounded-lg"
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          />
          <button type="button" onClick={clear} className="absolute top-2 right-2 text-xs text-muted-foreground flex items-center gap-1 bg-white/80 px-2 py-1 rounded">
            <Eraser className="w-3 h-3" /> {t("clear")}
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">{t("signatureHint")}</p>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-1" />
        <span>{t("consent")}</span>
      </label>
      <div className="flex justify-between">
        <Button variant="outline" onClick={onCancel}>{t("back")}</Button>
        <Button onClick={submit} disabled={!hasInk || !confirmed || !signerName.trim() || submitting}>
          {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <FileSignature className="w-4 h-4 mr-2" />} {t("signAndSend")}
        </Button>
      </div>
    </div>
  );
}
