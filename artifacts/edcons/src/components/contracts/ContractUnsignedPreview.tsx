import { useEffect, useRef, useState } from "react";
import { Download, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/hooks/use-i18n";
import { apiFetch } from "@/lib/apiFetch";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const COPY = {
  en: { title: "Unsigned test preview", notice: "Saved template with synthetic TEST data. No signature, signing record or email is created. Unsaved edits are not included.", download: "Download unsigned test PDF", close: "Close", retry: "Retry", error: "Preview could not be generated. Please retry shortly.", loading: "Preparing preview…", frame: "Unsigned contract layout preview", busy: "The renderer is busy. Please retry shortly.", ready: "PDF is ready. If the download did not start, save it here.", save: "Save PDF" },
  tr: { title: "İmzasız test önizlemesi", notice: "Kayıtlı şablon, sentetik TEST verileriyle gösterilir. İmza, imza kaydı veya e-posta oluşturulmaz. Kaydedilmemiş değişiklikler dahil değildir.", download: "İmzasız test PDF’ini indir", close: "Kapat", retry: "Yeniden dene", error: "Önizleme oluşturulamadı. Lütfen biraz sonra yeniden deneyin.", loading: "Önizleme hazırlanıyor…", frame: "İmzasız sözleşme tasarım önizlemesi", busy: "PDF oluşturucu meşgul. Lütfen biraz sonra yeniden deneyin.", ready: "PDF hazır. İndirme başlamadıysa buradan kaydedin.", save: "PDF’i kaydet" },
  ar: { title: "معاينة تجريبية غير موقعة", notice: "القالب المحفوظ ببيانات اختبار وهمية. لا يتم إنشاء توقيع أو سجل توقيع أو بريد إلكتروني. التعديلات غير المحفوظة غير مشمولة.", download: "تنزيل ملف PDF تجريبي غير موقع", close: "إغلاق", retry: "إعادة المحاولة", error: "تعذر إنشاء المعاينة. يرجى المحاولة لاحقًا.", loading: "جارٍ إعداد المعاينة…", frame: "معاينة تصميم العقد غير الموقع", busy: "خدمة PDF مشغولة. يرجى المحاولة لاحقًا.", ready: "ملف PDF جاهز. إذا لم يبدأ التنزيل، احفظه من هنا.", save: "حفظ ملف PDF" },
};

export function ContractUnsignedPreview({ template, onClose }: {
  template: { id: number; name: string; version: number } | null;
  onClose: () => void;
}) {
  const { lang } = useI18n();
  const words = COPY[lang as keyof typeof COPY] || COPY.en;
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const downloadAbort = useRef<AbortController | null>(null);
  const [preparedPdf, setPreparedPdf] = useState<{ url: string; filename: string } | null>(null);
  const preparedUrl = useRef<string | null>(null);
  useEffect(() => {
    setPreparedPdf(null);
    return () => {
      if (preparedUrl.current) URL.revokeObjectURL(preparedUrl.current);
      preparedUrl.current = null;
    };
  }, [template?.id]);

  useEffect(() => {
    if (!template) return;
    const controller = new AbortController();
    setHtml(""); setError(""); setLoading(true); setDownloading(false);
    void (async () => {
      try {
        const response = await apiFetch(`${BASE_URL}/api/contract-templates/${template.id}/unsigned-preview`, {
          method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ format: "html" }), signal: controller.signal,
        });
        if (!response.ok) throw new Error(response.status === 429 ? words.busy : words.error);
        const result = await response.json();
        if (result.data?.unsignedTestPreview !== true || typeof result.data?.html !== "string") throw new Error(words.error);
        if (!controller.signal.aborted) setHtml(result.data.html);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : words.error);
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => { controller.abort(); downloadAbort.current?.abort(); };
  }, [template?.id, attempt, words]);

  async function download() {
    if (!template || downloading) return;
    const controller = new AbortController();
    downloadAbort.current = controller;
    setDownloading(true); setError("");
    try {
      const response = await apiFetch(`${BASE_URL}/api/contract-templates/${template.id}/unsigned-preview`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "pdf" }), signal: controller.signal,
      });
      if (!response.ok || !response.headers.get("Content-Type")?.startsWith("application/pdf")) {
        throw new Error(response.status === 429 ? words.busy : words.error);
      }
      const blob = await response.blob();
      if (blob.size > 10 * 1024 * 1024 || await blob.slice(0, 5).text() !== "%PDF-") throw new Error(words.error);
      if (controller.signal.aborted) return;
      const objectUrl = URL.createObjectURL(blob);
      if (preparedUrl.current) URL.revokeObjectURL(preparedUrl.current);
      preparedUrl.current = objectUrl;
      const filename = `UNSIGNED-TEST-template-${template.id}.pdf`;
      setPreparedPdf({ url: objectUrl, filename });
      const link = document.createElement("a");
      link.href = objectUrl; link.download = filename;
      document.body.appendChild(link); link.click(); link.remove();
      // A native Save As prompt or blocked automatic download can outlive this
      // click. The explicit link keeps exactly one PDF until close/template change.
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : words.error);
    } finally { if (!controller.signal.aborted) setDownloading(false); }
  }

  return <Dialog open={Boolean(template)} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-w-5xl h-[92vh] flex flex-col overflow-hidden">
      <DialogHeader className="shrink-0">
        <DialogTitle className="px-5 break-words">{words.title} — {template?.name} · v{template?.version}</DialogTitle>
        <DialogDescription>{words.notice}</DialogDescription>
      </DialogHeader>
      <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900" dir="ltr">UNSIGNED TEST PREVIEW — NOT A SIGNED CONTRACT</div>
      {error && <div role="alert" className="rounded border border-destructive/30 p-3 text-sm text-destructive flex items-center gap-3"><span className="flex-1">{error}</span><Button variant="outline" size="sm" disabled={loading || downloading} onClick={() => setAttempt(value => value + 1)}><RotateCw className="h-4 w-4 me-1" />{words.retry}</Button></div>}
      {loading && <div role="status" className="flex-1 flex items-center justify-center gap-2"><Loader2 className="h-5 w-5 animate-spin" />{words.loading}</div>}
      {!loading && html && <iframe key={`${template?.id}-${attempt}`} title={words.frame} sandbox="" referrerPolicy="no-referrer" src={`${BASE_URL}/api/contract-templates/${template?.id}/unsigned-preview.html`} className="min-h-0 flex-1 w-full rounded border bg-slate-100" />}
      {preparedPdf && <div role="status" aria-live="polite" className="shrink-0 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950 flex flex-wrap items-center gap-2">
        <span className="flex-1 min-w-0">{words.ready}</span>
        <Button asChild variant="outline" size="sm"><a href={preparedPdf.url} download={preparedPdf.filename}>{words.save}</a></Button>
      </div>}
      <DialogFooter className="mt-auto shrink-0">
        <Button variant="outline" onClick={onClose}>{words.close}</Button>
        <Button onClick={download} disabled={!html || loading || downloading}>{downloading ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <Download className="h-4 w-4 me-2" />}{words.download}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
