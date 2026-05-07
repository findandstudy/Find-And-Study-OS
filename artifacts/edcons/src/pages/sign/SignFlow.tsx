import { useEffect, useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle2, AlertCircle, FileSignature, Eraser } from "lucide-react";

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

type Step = "loading" | "expired" | "intake" | "review" | "sign" | "success" | "error";

export default function SignFlow({ token }: { token: string }) {
  const [step, setStep] = useState<Step>("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [session, setSession] = useState<SessionView | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [intake, setIntake] = useState<Record<string, string>>({});
  const [signerName, setSignerName] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

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
        if (data.status === "revoked") { setErrorMsg("Bu bağlantı iptal edilmiştir."); setStep("error"); return; }
        if (data.mode === "self_fill" && data.status === "intake_pending") { setStep("intake"); return; }
        // Admin-driven OR self-fill after intake -> go straight to review.
        await loadPreview();
        setStep("review");
      } catch (err: any) {
        const status = err?.status || err?.response?.status;
        if (status === 410) { setStep("expired"); return; }
        if (status === 404) { setErrorMsg("Bağlantı bulunamadı."); setStep("error"); return; }
        setErrorMsg(err?.message || "Bağlantı çözülemedi"); setStep("error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function loadPreview() {
    const r: any = await customFetch(`/api/public/sign/${encodeURIComponent(token)}/preview`);
    setPreviewHtml(r.data?.html || "");
  }

  async function submitIntake() {
    setSubmitting(true);
    try {
      await customFetch(`/api/public/sign/${encodeURIComponent(token)}/intake`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ intake: { ...intake, signerName } }),
      });
      await loadPreview();
      setStep("review");
    } catch (err: any) {
      alert(err?.message || "Bilgileri kaydetme başarısız");
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
      alert(err?.message || "İmza gönderilemedi");
    }
    setSubmitting(false);
  }

  if (step === "loading") {
    return <CenterShell><Loader2 className="w-8 h-8 animate-spin text-primary" /></CenterShell>;
  }
  if (step === "expired") {
    return <CenterShell>
      <AlertCircle className="w-12 h-12 text-amber-500 mb-4" />
      <h1 className="text-xl font-semibold mb-2">Bağlantı süresi doldu</h1>
      <p className="text-muted-foreground text-sm">Bu imza bağlantısının süresi dolmuş. Lütfen yeni bir bağlantı talep edin.</p>
    </CenterShell>;
  }
  if (step === "error") {
    return <CenterShell>
      <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
      <h1 className="text-xl font-semibold mb-2">Hata</h1>
      <p className="text-muted-foreground text-sm">{errorMsg}</p>
    </CenterShell>;
  }
  if (step === "success") {
    return <CenterShell>
      <CheckCircle2 className="w-14 h-14 text-emerald-500 mb-4" />
      <h1 className="text-2xl font-semibold mb-2">İmzalandı</h1>
      <p className="text-muted-foreground text-sm text-center max-w-md">İmzalı PDF kopyası e-posta adresinize gönderildi. Bu pencereyi kapatabilirsiniz.</p>
    </CenterShell>;
  }

  if (!session) return null;

  if (step === "intake") {
    const fields = (session.template.intakeSchema || []) as { key: string; label: string; type: string; required?: boolean }[];
    return (
      <Shell title="Bilgilerinizi girin" subtitle={session.template.name}>
        <Stepper step={1} />
        <div className="space-y-4">
          <div>
            <Label>İsim Soyisim *</Label>
            <Input value={signerName} onChange={e => setSignerName(e.target.value)} required />
          </div>
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
          <Button onClick={submitIntake} disabled={submitting || !signerName.trim()}>
            {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null} Devam et
          </Button>
        </div>
      </Shell>
    );
  }

  if (step === "review") {
    return (
      <Shell title="Sözleşmeyi inceleyin" subtitle={session.template.name}>
        <Stepper step={session.mode === "self_fill" ? 2 : 1} hideIntake={session.mode !== "self_fill"} />
        <div
          className="prose prose-sm dark:prose-invert max-w-none border rounded-lg p-6 bg-card max-h-[60vh] overflow-y-auto"
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
        <div className="flex justify-between mt-6">
          {session.mode === "self_fill" ? (
            <Button variant="outline" onClick={() => setStep("intake")}>Geri</Button>
          ) : <span />}
          <Button onClick={() => setStep("sign")}><FileSignature className="w-4 h-4 mr-2" /> İmzala</Button>
        </div>
      </Shell>
    );
  }

  if (step === "sign") {
    return (
      <Shell title="İmzanızı çizin" subtitle={session.template.name}>
        <Stepper step={session.mode === "self_fill" ? 3 : 2} hideIntake={session.mode !== "self_fill"} />
        <SignaturePad
          onSubmit={submitSignature}
          submitting={submitting}
          onCancel={() => setStep("review")}
          signerName={signerName}
          onChangeName={setSignerName}
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

function Stepper({ step, hideIntake }: { step: number; hideIntake?: boolean }) {
  const steps = hideIntake ? ["İncele", "İmzala"] : ["Bilgiler", "İncele", "İmzala"];
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {steps.map((label, i) => {
        const num = i + 1;
        const active = num === step;
        const done = num < step;
        return (
          <div key={label} className="flex items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold ${active ? "bg-primary text-primary-foreground" : done ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"}`}>
              {done ? "✓" : num}
            </div>
            <span className={`ml-2 text-sm ${active ? "font-semibold" : "text-muted-foreground"}`}>{label}</span>
            {i < steps.length - 1 && <div className="w-8 h-px bg-border mx-3" />}
          </div>
        );
      })}
    </div>
  );
}

function SignaturePad({ onSubmit, submitting, onCancel, signerName, onChangeName }: {
  onSubmit: (b64: string) => void;
  submitting: boolean;
  onCancel: () => void;
  signerName: string;
  onChangeName: (v: string) => void;
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
      <div>
        <Label>İsim Soyisim *</Label>
        <Input value={signerName} onChange={e => onChangeName(e.target.value)} />
      </div>
      <div>
        <Label>İmzanız</Label>
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
            <Eraser className="w-3 h-3" /> Temizle
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">Fareyle ya da parmağınızla imzanızı çizin.</p>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-1" />
        <span>Bu sözleşmeyi okuduğumu, anladığımı ve elektronik imzamın geçerli kabul edileceğini onaylıyorum.</span>
      </label>
      <div className="flex justify-between">
        <Button variant="outline" onClick={onCancel}>Geri</Button>
        <Button onClick={submit} disabled={!hasInk || !confirmed || !signerName.trim() || submitting}>
          {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <FileSignature className="w-4 h-4 mr-2" />} İmzala ve gönder
        </Button>
      </div>
    </div>
  );
}
