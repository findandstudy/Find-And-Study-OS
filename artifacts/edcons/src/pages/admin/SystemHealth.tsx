import { useEffect, useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Clock3, RefreshCw, ShieldAlert } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/hooks/use-i18n";
import { healthCopy, issueCopy } from "./system-health/copy";
import { appendHealthHistory, createHealthReader, healthHref, healthIsStale, healthNumber, healthRefreshEnabled, healthSummary, type CheckKey, type DisplayState, type HealthHistory, type HealthResponse, type MetricRecord } from "./system-health/model";

export default function SystemHealthPage() {
  const { lang, dir } = useI18n();
  const copy = healthCopy(lang);
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [auto, setAuto] = useState(true);
  const [now, setNow] = useState(Date.now);
  const [receivedAt, setReceivedAt] = useState(0);
  const [history, setHistory] = useState<HealthHistory[]>([]);
  const autoRef = useRef(true);
  const readerRef = useRef<ReturnType<typeof createHealthReader> | null>(null);

  useEffect(() => {
    const reader = createHealthReader({
      read: signal => customFetch<unknown>("/api/admin/system-health", { method: "GET", signal, cache: "no-store" }),
      onStart: () => setLoading(true),
      onSuccess: snapshot => {
        const received = Date.now();
        setData(snapshot); setReceivedAt(received); setNow(received); setFailed(false);
        const stale = healthIsStale(snapshot, received, received, false);
        setHistory(previous => appendHealthHistory(previous, { checkedAt: snapshot.checkedAt, state: healthSummary(snapshot, stale), issueCount: snapshot.issues.length, latencyMs: snapshot.latencyMs }));
      },
      onFailure: () => {
        setFailed(true); setNow(Date.now());
        setHistory(previous => appendHealthHistory(previous, { checkedAt: new Date().toISOString(), state: "unknown", issueCount: null, latencyMs: null }));
      },
      onFinish: () => setLoading(false),
    });
    readerRef.current = reader;
    const refreshVisible = () => { if (healthRefreshEnabled(autoRef.current, document.visibilityState)) void reader.refresh(); };
    void reader.refresh();
    const refreshTimer = setInterval(refreshVisible, 30_000);
    const ageTimer = setInterval(() => setNow(Date.now()), 5_000);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      reader.dispose(); readerRef.current = null;
      clearInterval(refreshTimer); clearInterval(ageTimer);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, []);

  const number = (value: unknown, suffix = "") => {
    const parsed = healthNumber(value);
    return parsed === null ? "—" : `${new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(parsed)}${suffix}`;
  };
  const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(lang, { dateStyle: "short", timeStyle: "medium" }).format(new Date(value)) : copy.unknown;
  const stale = !!data && healthIsStale(data, now, receivedAt, failed);
  const summary: DisplayState = data ? healthSummary(data, stale) : "unknown";
  const badge = (state: DisplayState) => <Badge variant={state === "critical" ? "destructive" : "secondary"} className="whitespace-normal text-start">{copy.states[state]}</Badge>;
  const metricRows = (key: CheckKey): [string, string][] => {
    const m: MetricRecord = data?.metrics[key] || {};
    switch (key) {
      case "database": return [[copy.text("Open / idle connections", "Açık / boşta bağlantı"), `${number(m.totalConnections)} / ${number(m.idleConnections)}`], [copy.text("Waiting requests", "Bekleyen istekler"), number(m.waitingRequests)], [copy.text("Probe time", "Kontrol süresi"), number(m.probeMs, " ms")]];
      case "requestPerformance": return [];
      case "portalWorkers": return [[copy.text("Recent / stale heartbeats", "Güncel / eski yaşam sinyali"), `${number(m.recent)} / ${number(m.stale)}`], [copy.text("Recent submit / dry-run", "Güncel gönderim / deneme"), `${number(m.real)} / ${number(m.dry)}`], [copy.text("Recent status / lifecycle", "Güncel durum / süreç takibi"), `${number(m.status_check)} / ${number(m.lifecycle_execute)}`], [copy.text("Last recorded heartbeat", "Son kayıtlı yaşam sinyali"), date(m.last_observed_at)]];
      case "apiTokens": return [[copy.text("No expiry", "Süresiz"), number(m.no_expiry)], [copy.text("Expired", "Süresi dolmuş"), number(m.expired)], [copy.text("Expiring within 7 days", "7 gün içinde dolacak"), number(m.expiring_soon)]];
      case "aiRuns24h": return [[copy.text("Failed", "Başarısız"), number(m.failed)], [copy.text("Rate limited", "Hız sınırına takılan"), number(m.rate_limited)]];
      case "webhook24h": return [[copy.text("Rejected signed deliveries", "Reddedilen imzalı iletiler"), number(m.delivery_failures)], [copy.text("Rejected verification probes", "Reddedilen doğrulama denemeleri"), number(m.verification_probes)]];
      case "portalSubmissions": return [[copy.text("Queued / running", "Kuyrukta / çalışıyor"), `${number(m.queued)} / ${number(m.running)}`], [copy.text("Stale running / failed (24h)", "Takılmış / başarısız (24 saat)"), `${number(m.stale_running)} / ${number(m.failed_24h)}`], [copy.text("Oldest queue wait", "En eski kuyruk beklemesi"), number(m.oldest_queued_age_seconds, " s")]];
      case "messaging24h": return [[copy.text("Inbound / outbound", "Gelen / giden"), `${number(m.inbound)} / ${number(m.outbound)}`], [copy.text("Failed / delivered", "Başarısız / teslim edilen"), `${number(m.failed)} / ${number(m.delivered)}`], [copy.text("Last recorded inbound", "Son kayıtlı gelen mesaj"), date(m.last_inbound_at)]];
      case "storage": return [[copy.text("Free space", "Boş alan"), number(m.freePercent, "%")], [copy.text("Free / total (GiB)", "Boş / toplam (GiB)"), `${number(healthNumber(m.freeBytes) === null ? null : Number(m.freeBytes) / 1024 ** 3)} / ${number(healthNumber(m.totalBytes) === null ? null : Number(m.totalBytes) / 1024 ** 3)}`]];
      case "backups": return [[copy.text("Visible files", "Görülebilen dosyalar"), number(m.count)], [copy.text("Latest file", "Son dosya"), date(m.latestAt)], [copy.text("Latest file age (hours)", "Son dosyanın yaşı (saat)"), number(m.latestAgeHours)]];
    }
  };
  const performance = data?.metrics.requestPerformance;
  const performanceCheck = data?.checks.find(check => check.key === "requestPerformance");
  const measured = data?.checks.filter(check => check.state !== "unknown" && check.state !== "disabled").length ?? 0;

  return <div className="space-y-6 p-4 md:p-6" dir={dir} data-testid="page-system-health" aria-busy={loading}>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-3xl"><h1 className="text-2xl font-bold">{copy.title}</h1><p className="mt-1 text-sm text-muted-foreground">{copy.subtitle}</p>
        {lang !== "en" && lang !== "tr" && <p className="mt-1 text-xs text-muted-foreground" lang="en">{copy.fallback}</p>}
      </div>
      <div className="flex flex-col items-start gap-2">
        <Button data-testid="health-refresh" variant="outline" onClick={() => void readerRef.current?.refresh()} disabled={loading}><RefreshCw aria-hidden="true" className={`me-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />{copy.refresh}</Button>
        <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={auto} onChange={event => { autoRef.current = event.target.checked; setAuto(event.target.checked); }} />{copy.auto}</label>
      </div>
    </div>
    <p className="text-xs text-muted-foreground">{copy.autoNote}</p>
    <div role="status" aria-live="polite" className="sr-only">{loading ? copy.loading : copy.states[summary]}</div>
    {loading && !data && <p className="text-sm text-muted-foreground">{copy.loading}</p>}
    {failed && <div data-testid="health-error" role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"><ShieldAlert aria-hidden="true" className="h-5 w-5 shrink-0 text-destructive" />{copy.error}</div>}
    {!failed && stale && <div role="status" className="flex items-start gap-2 rounded-lg border border-amber-500/40 p-4 text-sm"><Clock3 aria-hidden="true" className="h-5 w-5 shrink-0" />{copy.stale}</div>}
    {data && <>
      <Card data-testid="health-summary" data-state={summary} className={summary === "critical" ? "border-destructive/50" : summary === "healthy" ? "border-emerald-500/50" : "border-amber-500/50"}>
        <CardContent className="flex flex-wrap items-start justify-between gap-4 pt-6">
          <div className="flex items-start gap-3">{summary === "healthy" ? <CheckCircle2 aria-hidden="true" className="h-7 w-7 shrink-0 text-emerald-600" /> : <AlertTriangle aria-hidden="true" className="h-7 w-7 shrink-0 text-amber-600" />}
            <div className="space-y-1"><div className="font-semibold">{copy.states[summary]}</div><div className="text-sm text-muted-foreground">{copy.checked}: {date(data.checkedAt)} · {copy.latency}: {number(data.latencyMs, " ms")}</div>
              <p className="text-xs text-muted-foreground">{copy.coverage}: {number(measured)} / {number(data.checks.length)}{data.coverage === "partial" ? ` · ${copy.partial}` : ""}</p>
            </div>
          </div>
          <Badge variant="outline" className="max-w-full break-all whitespace-normal"><span dir="ltr">{copy.release}: {data.releaseId || copy.unknown}</span></Badge>
        </CardContent>
      </Card>
      <section aria-labelledby="health-findings"><Card><CardHeader><CardTitle id="health-findings">{copy.issues}{stale ? ` · ${copy.historical}` : ""}</CardTitle></CardHeader>
        <CardContent className="space-y-3">{data.issues.length === 0 ? <p className="text-sm text-muted-foreground">{copy.noIssues}</p> : data.issues.map((issue, index) => {
          const labels = issueCopy(issue, copy);
          const href = healthHref(issue.href);
          return <article key={`${issue.key}-${index}`} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold">{labels.title}</h3><div className="flex items-center gap-2"><span className="text-sm tabular-nums">{number(issue.count)}</span>{badge(stale ? "stale" : issue.severity)}</div></div>
            <p className="mt-1 break-all text-xs text-muted-foreground"><bdi>{issue.key}</bdi>{issue.observedAt ? ` · ${date(issue.observedAt)}` : ""}</p>
            <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2"><div><dt className="font-medium">{copy.impact}</dt><dd className="text-muted-foreground">{labels.impact}</dd></div><div><dt className="font-medium">{copy.nextAction}</dt><dd className="text-muted-foreground">{labels.nextAction}</dd></div></dl>
            {href && <Button variant="outline" size="sm" className="mt-3" asChild><Link href={href}>{copy.inspect}<ArrowUpRight aria-hidden="true" className="ms-1 h-4 w-4" /></Link></Button>}
          </article>;
        })}</CardContent>
      </Card></section>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data.checks.filter(check => check.key !== "requestPerformance").map(check => {
        const checkStale = stale || now - Date.parse(check.checkedAt) > (data.freshnessSeconds ?? 90) * 1000;
        return <Card key={check.key} data-testid={`health-check-${check.key}`}><CardHeader className="space-y-2 pb-3"><CardTitle className="text-base">{copy.titles[check.key]}</CardTitle><div>{badge(checkStale ? "stale" : check.state)}</div></CardHeader>
          <CardContent className="space-y-3"><dl className="space-y-2 text-sm">{metricRows(check.key).map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-x-3 gap-y-1"><dt className="text-muted-foreground">{label}</dt><dd className="break-words font-medium tabular-nums">{value}</dd></div>)}</dl>
            <p className="text-xs text-muted-foreground">{Object.hasOwn(copy.codes, check.code) ? copy.codes[check.code] : copy.unknown} · {date(check.checkedAt)}</p>
            {(check.limitationCodes?.length ?? 0) > 0 && <ul className="list-disc space-y-1 ps-4 text-xs text-muted-foreground">{check.limitationCodes?.map(code => <li key={code}>{Object.hasOwn(copy.limitations, code) ? copy.limitations[code] : copy.text("Additional measurement limitation", "Ek ölçüm sınırı")}</li>)}</ul>}
            {healthHref(check.href) && <Link href={check.href!} className="inline-flex items-center gap-1 text-sm text-primary underline underline-offset-4">{copy.inspect}<ArrowUpRight aria-hidden="true" className="h-4 w-4" /></Link>}
          </CardContent></Card>;
      })}</div>
      <Card data-testid="health-performance"><CardHeader><CardTitle className="text-base">{copy.performance}{stale ? ` · ${copy.historical}` : ""}</CardTitle><div>{badge(stale ? "stale" : performanceCheck?.state ?? "unknown")}</div><p className="text-xs text-muted-foreground">{copy.performanceNote}</p></CardHeader><CardContent>
        {performance?.enabled !== true ? <p className="text-sm text-muted-foreground">{copy.performanceDisabled}</p> : healthNumber(performance.sampleCount) === 0 ? <p className="text-sm text-muted-foreground">{copy.performanceEmpty}</p> : <>
          <dl className="grid grid-cols-2 gap-4 lg:grid-cols-5">{[[copy.sampleCount, number(performance.sampleCount)], ["p95", number(performance.p95Ms, " ms")], ["p99", number(performance.p99Ms, " ms")], [copy.errorRate, number(performance.errorRatePercent, "%")], [copy.dbWait, number(performance.dbAcquireP95Ms, " ms")]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd></div>)}</dl>
          {(healthNumber(performance.sampleCount) ?? 0) < 20 && <p className="mt-3 text-xs text-muted-foreground">{copy.text("Fewer than 20 samples: insufficient evidence to assess performance health.", "20'den az örnek: performans sağlığını değerlendirmek için yeterli kanıt yok.")}</p>}
          {performance.windowTruncated === true && <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">{copy.truncated}</p>}
        </>}
      </CardContent></Card>
    </>}
    {history.length > 0 && <Card data-testid="health-history"><CardHeader><CardTitle className="text-base">{copy.observations}</CardTitle><p className="text-xs text-muted-foreground">{copy.historyNote}</p></CardHeader><CardContent>
      <div className="overflow-x-auto"><table className="w-full text-start text-sm"><caption className="sr-only">{copy.observations}</caption><thead><tr className="border-b"><th scope="col" className="pb-2 pe-4 text-start">{copy.checked}</th><th scope="col" className="pb-2 pe-4 text-start">{copy.state}</th><th scope="col" className="pb-2 pe-4 text-start">{copy.findings}</th><th scope="col" className="pb-2 text-start">{copy.latency}</th></tr></thead><tbody>{[...history].reverse().map((entry, index) => <tr key={`${entry.checkedAt}-${index}`} className="border-b last:border-0"><td className="py-2 pe-4 whitespace-nowrap">{date(entry.checkedAt)}</td><td className="py-2 pe-4">{copy.states[entry.state]}</td><td className="py-2 pe-4">{number(entry.issueCount)}</td><td className="py-2">{number(entry.latencyMs, " ms")}</td></tr>)}</tbody></table></div>
    </CardContent></Card>}
    <Card><CardHeader><CardTitle className="text-base">{copy.limits}</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">{copy.limitsNote}</p></CardContent></Card>
  </div>;
}
