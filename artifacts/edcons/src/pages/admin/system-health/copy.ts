import type { CheckKey, DisplayState, HealthIssue } from "./model";

export type HealthCopy = ReturnType<typeof healthCopy>;
export function healthCopy(lang: string) {
  const tr = lang === "tr";
  const text = (en: string, turkish: string) => tr ? turkish : en;
  return {
    text, lang: tr ? "tr" : "en",
    title: text("System Health", "Sistem Sağlığı"),
    subtitle: text("Operational evidence and guided investigation. Checks are read-only; no jobs or external actions are triggered.", "Operasyonel kanıtlar ve yönlendirilmiş inceleme. Kontroller salt okunurdur; iş veya dış işlem tetiklemez."),
    refresh: text("Recheck now", "Şimdi yeniden kontrol et"), auto: text("Auto-refresh (30 seconds)", "Otomatik yenile (30 saniye)"),
    autoNote: text("Refresh pauses while this tab is hidden. This page is not a 24/7 alert service.", "Sekme arka plandayken yenileme durur. Bu ekran 7/24 alarm hizmeti değildir."),
    loading: text("Checking operational signals…", "Operasyonel sinyaller kontrol ediliyor…"),
    error: text("The latest check failed. Previous readings are historical, not current health evidence.", "Son kontrol başarısız oldu. Önceki değerler güncel sağlık kanıtı değil, geçmiş ölçümlerdir."),
    stale: text("This snapshot is out of date. Recheck before making an operational decision.", "Bu ölçüm güncelliğini kaybetti. Operasyonel karar vermeden önce yeniden kontrol edin."),
    fallback: text("This module currently uses English when a local translation is unavailable.", ""),
    checked: text("Last checked", "Son kontrol"), latency: text("Health collection", "Sağlık verisi toplama"), release: text("Release", "Sürüm"),
    unknown: text("Not measured", "Ölçülemedi"), coverage: text("Measured checks", "Ölçülen kontroller"), partial: text("Some checks could not be completed", "Bazı kontroller tamamlanamadı"),
    issues: text("Findings and next steps", "Bulgular ve sonraki adımlar"), noIssues: text("No findings in the measured signals. This does not prove unmeasured services are healthy.", "Ölçülen sinyallerde bulgu yok. Bu, ölçülmeyen servislerin sağlıklı olduğunu kanıtlamaz."),
    impact: text("Possible impact", "Olası etki"), nextAction: text("Recommended investigation", "Önerilen inceleme"), inspect: text("Open related module", "İlgili modülü aç"),
    historical: text("Historical snapshot", "Geçmiş ölçüm"), observations: text("Session history", "Oturum geçmişi"),
    historyNote: text("Last 20 checks in this open page only; cleared on reload. Not durable incident history or an SLA report.", "Yalnızca bu açık sayfadaki son 20 kontrol; sayfa yenilenince silinir. Kalıcı olay geçmişi veya SLA raporu değildir."),
    findings: text("Findings", "Bulgu"), state: text("State", "Durum"), limits: text("Coverage boundaries", "Ölçüm sınırları"),
    limitsNote: text("External uptime alerts, offsite copies, restore drills and browser errors need separate evidence. Portal heartbeats do not cover every background service; an empty queue does not prove a worker is running. This screen cannot restart services, replay submissions, delete data or repair a database.", "Dış erişim alarmları, sunucu dışı kopyalar, geri yükleme tatbikatları ve tarayıcı hataları ayrı kanıt gerektirir. Portal yaşam sinyalleri tüm arka plan servislerini kapsamaz; kuyruğun boş olması çalışanın aktif olduğunu kanıtlamaz. Bu ekran servis başlatamaz, başvuruyu tekrar gönderemez, veri silemez veya veritabanını onaramaz."),
    performance: text("API performance · this process", "API performansı · bu süreç"),
    performanceNote: text("Up to 4,096 observed requests in the last 5 minutes on this API process. Not a load test, Core Web Vitals, or whole-deployment performance.", "Bu API sürecinde son 5 dakikada gözlenen en fazla 4.096 istek. Yük testi, Core Web Vitals veya tüm ortamın performansı değildir."),
    performanceDisabled: text("Request performance collection is disabled or unavailable; no latency claim can be made.", "İstek performansı ölçümü kapalı veya erişilemiyor; gecikme hakkında sonuç çıkarılamaz."),
    performanceEmpty: text("No completed requests have been measured yet.", "Henüz tamamlanmış istek ölçümü yok."),
    truncated: text("Sample capacity reached: older requests within this window were discarded.", "Örnek kapasitesi doldu: bu pencere içindeki eski istekler çıkarıldı."),
    sampleCount: text("Observed requests", "Gözlenen istekler"), errorRate: text("5xx rate", "5xx oranı"), dbWait: text("Per-request total DB wait p95", "İstek başına toplam DB beklemesi p95"),
    states: {
      healthy: text("Measured signals healthy", "Ölçülen sinyaller sağlıklı"), warning: text("Attention required", "İnceleme gerekli"), critical: text("Critical findings", "Kritik bulgular"),
      unknown: text("Unknown / incomplete", "Bilinmiyor / eksik ölçüm"), disabled: text("Intentionally disabled", "Bilerek kapalı"), stale: text("Stale / unverified", "Güncel değil / doğrulanmadı"),
    } satisfies Record<DisplayState, string>,
    titles: {
      database: text("Database · this API connection pool", "Veritabanı · bu API'nin bağlantı havuzu"), apiTokens: text("API token expiry", "API erişim anahtarlarının süresi"),
      aiRuns24h: text("AI run failures · 24h", "AI işlem hataları · 24 saat"), webhook24h: text("Webhook authentication · 24h", "Webhook doğrulaması · 24 saat"),
      portalSubmissions: text("Portal submission queue", "Portal başvuru kuyruğu"), messaging24h: text("Message delivery records · 24h", "Mesaj teslim kayıtları · 24 saat"),
      storage: text("Application filesystem", "Uygulamanın dosya sistemi"), backups: text("Visible backup files", "Görülebilen yedek dosyaları"),
      requestPerformance: text("API request performance", "API istek performansı"), portalWorkers: text("Portal worker heartbeats", "Portal çalışanlarının yaşam sinyalleri"),
    } satisfies Record<CheckKey, string>,
    codes: {
      OK: text("Measured successfully", "Ölçüm başarılı"), ATTENTION_REQUIRED: text("See related findings below", "Aşağıdaki ilgili bulguları inceleyin"),
      CHECK_TIMEOUT: text("Check timed out", "Kontrol zaman aşımına uğradı"), CHECK_UNAVAILABLE: text("Check unavailable", "Kontrol sonucu alınamadı"),
      BACKUP_SCAN_LIMIT: text("Backup inspection limit reached; result incomplete", "Yedek inceleme sınırına ulaşıldı; sonuç eksik"),
      BACKUP_NOT_CONFIGURED: text("Backup location not configured or visible to this runtime", "Yedek konumu bu çalışma ortamına tanımlı değil veya görünmüyor"),
      BACKUP_EMPTY: text("No backup files found at the configured location", "Tanımlı konumda yedek dosyası bulunamadı"),
      TELEMETRY_DISABLED: text("Telemetry disabled by configuration", "Ölçüm ayar gereği kapalı"), NO_SAMPLES: text("No request samples yet", "Henüz istek örneği yok"),
      INSUFFICIENT_SAMPLES: text("Fewer than 20 samples; insufficient evidence", "20'den az örnek; kanıt yetersiz"),
      NO_HEARTBEATS: text("No heartbeat records; worker liveness is unknown", "Yaşam sinyali kaydı yok; çalışanın durumu bilinmiyor"),
      NO_WORKER_OBSERVATIONS: text("No heartbeat records; worker liveness is unknown", "Yaşam sinyali kaydı yok; çalışanın durumu bilinmiyor"),
      STALE_WORKER_OBSERVATIONS: text("Old heartbeat records need investigation", "Eski yaşam sinyali kayıtları incelenmeli"),
      FUTURE_WORKER_OBSERVATIONS: text("Heartbeat timestamps are in the future; check clock consistency", "Yaşam sinyali zamanları gelecekte; saat tutarlılığını kontrol edin"),
    } as Record<string, string>,
    limitations: {
      snapshot_only: text("Point-in-time evidence only", "Yalnızca ölçüm anının kanıtı"),
      not_end_to_end_delivery: text("Not proof of end-to-end delivery", "Uçtan uca teslim kanıtı değil"),
      provider_receipts_only: text("Stored delivery receipts; not proof that every expected message arrived", "Kaydedilmiş teslim sonuçları; beklenen her mesajın geldiğinin kanıtı değil"),
      no_worker_heartbeat: text("Worker liveness is not measured", "Arka plan çalışanının yaşam sinyali ölçülmüyor"),
      filesystem_only: text("Application filesystem only, not all host volumes", "Yalnızca uygulamanın dosya sistemi; tüm sunucu diskleri değil"),
      no_restore_proof: text("File presence is not restore verification", "Dosyanın varlığı geri yükleme doğrulaması değildir"),
      no_offsite_proof: text("Offsite copy is not verified", "Sunucu dışı kopya doğrulanmıyor"),
      no_latency_percentiles: text("Probe time is not application p95/p99", "Kontrol süresi uygulamanın p95/p99 değeri değildir"),
      token_metadata_only: text("Expiry metadata only; provider token validity is not checked", "Yalnızca süre bilgisi; sağlayıcı anahtarının geçerliliği sınanmıyor"),
      read_only_no_execution: text("Read-only; no execution or automatic repair", "Salt okunur; çalıştırma veya otomatik onarım yok"),
      performance_process_only: text("Only this API process, not all replicas", "Yalnızca bu API süreci; tüm kopyalar değil"),
      performance_sampled: text("Bounded request samples; reset on process restart", "Sınırlı istek örnekleri; süreç yeniden başladığında sıfırlanır"),
      heartbeat_not_execution_proof: text("A heartbeat is not proof that a job completed; long jobs may delay heartbeats", "Yaşam sinyali işin tamamlandığını kanıtlamaz; uzun işler sinyali geciktirebilir"),
      worker_heartbeat_only: text("Recorded portal heartbeat only; long jobs can delay it", "Yalnızca kayıtlı portal yaşam sinyali; uzun işler sinyali geciktirebilir"),
      worker_modes_not_readiness: text("A recent worker does not prove partner readiness or permission to execute", "Güncel çalışan kaydı, partnerin hazır olduğunu veya işlem iznini kanıtlamaz"),
    } as Record<string, string>,
  };
}

export function issueCopy(issue: HealthIssue, copy: HealthCopy) {
  const titles: Record<string, [string, string]> = {
    "tokens.no_expiry": ["API tokens without expiry", "Süresiz API erişim anahtarları"], "tokens.expired": ["Expired API tokens", "Süresi dolmuş API erişim anahtarları"],
    "tokens.expiring_soon": ["API tokens expire within seven days", "Yedi gün içinde süresi dolacak API erişim anahtarları"],
    "ai.failed": ["AI runs failed", "AI işlemleri başarısız oldu"], "ai.rate_limited": ["AI runs hit a rate limit", "AI işlemleri hız sınırına takıldı"],
    "webhooks.delivery_auth_failed": ["Webhook authentication was rejected", "Webhook doğrulaması reddedildi"], "webhooks.verification_probes": ["High volume of rejected verification probes", "Çok sayıda reddedilmiş doğrulama isteği"],
    "portal.stale_running": ["Portal submissions may be stuck", "Portal başvuruları takılmış olabilir"], "portal.failed": ["Portal submissions failed", "Portal başvuruları başarısız oldu"],
    "portal.queue_age": ["Old queued portal submissions", "Uzun süredir bekleyen portal başvuruları"], "storage.disk_free": ["Low filesystem free space", "Dosya sisteminde boş alan az"],
    "storage.unavailable": ["Storage measurement unavailable", "Disk ölçümü alınamadı"], "backups.unavailable": ["Backup inspection unavailable", "Yedek incelemesi yapılamadı"],
    "backups.stale": ["Latest visible backup is old", "Görülebilen son yedek eski"], "backups.empty": ["No backup files found", "Yedek dosyası bulunamadı"],
    "messaging.failed": ["Message delivery failures recorded", "Mesaj teslim hataları kaydedildi"], "database.pool_waiting": ["Requests waiting for database connections", "Veritabanı bağlantısı bekleyen istekler"],
    "performance.degraded": ["Observed API performance needs attention", "Gözlenen API performansının incelenmesi gerekiyor"],
    "backups.empty_file": ["Latest visible backup file is empty", "Görülebilen son yedek dosyası boş"],
    "portalWorkers.stale": ["Old portal worker heartbeats", "Portal çalışanlarının eski yaşam sinyalleri"], "portalWorkers.future": ["Portal worker clock mismatch", "Portal çalışanlarında saat uyuşmazlığı"],
  };
  const group = issue.checkKey || ({ tokens: "apiTokens", ai: "aiRuns24h", webhooks: "webhook24h", portal: "portalSubmissions", messaging: "messaging24h" } as Record<string, string>)[issue.key.split(".")[0]] || issue.key.split(".")[0];
  const guidance: Record<string, [string, string, string, string]> = {
    database: ["Requests may slow down or fail.", "İstekler yavaşlayabilir veya başarısız olabilir.", "Check connection pressure and recent errors; do not terminate queries without investigation.", "Bağlantı yoğunluğunu ve son hataları inceleyin; araştırmadan sorgu sonlandırmayın."],
    apiTokens: ["Integrations may lose access or use credentials without a bounded lifetime.", "Entegrasyonlar erişimini kaybedebilir veya süresiz erişim kullanabilir.", "Identify dependent integrations before planning a controlled token rotation.", "Kontrollü anahtar değişiminden önce bağlı entegrasyonları belirleyin."],
    aiRuns24h: ["Some automated assistance may be delayed.", "Bazı otomatik yardımcı işlemler gecikebilir.", "Inspect failed runs, provider limits and configuration; do not replay external messages blindly.", "Hatalı işlemleri, sağlayıcı sınırlarını ve ayarları inceleyin; dış mesajları kontrolsüz tekrar göndermeyin."],
    webhook24h: ["Legitimate events could be rejected; unsolicited probes may also cause this signal.", "Geçerli olaylar reddedilmiş olabilir; izinsiz denemeler de bu sinyali üretebilir.", "Compare provider webhook logs with the audit records and verify signing configuration securely.", "Sağlayıcı webhook kayıtlarıyla denetim kayıtlarını karşılaştırın; imza ayarını güvenli şekilde doğrulayın."],
    portalSubmissions: ["University submissions may be delayed or require manual review.", "Üniversite başvuruları gecikebilir veya manuel inceleme gerektirebilir.", "Inspect queue age, worker state and the original submission receipt before any retry.", "Tekrar denemeden önce kuyruk yaşını, çalışan durumunu ve ilk başvurunun sonucunu inceleyin."],
    messaging24h: ["Some outgoing messages may not have reached their recipient.", "Bazı giden mesajlar alıcısına ulaşmamış olabilir.", "Inspect message delivery status and provider receipts in the messages module.", "Mesajlar alanında teslim durumunu ve sağlayıcı sonuçlarını inceleyin."],
    storage: ["Low capacity can prevent uploads, logs or database writes on affected volumes.", "Düşük kapasite, etkilenen disklerde yüklemeleri, günlükleri veya veritabanı yazılarını engelleyebilir.", "Ask the server operator to inspect volume usage and approved retention; do not delete files blindly.", "Sunucu sorumlusundan disk kullanımını ve onaylı saklama süresini incelemesini isteyin; kontrolsüz dosya silmeyin."],
    backups: ["Recovery readiness cannot be inferred from these files alone.", "Kurtarmaya hazır olunduğu yalnızca bu dosyalardan anlaşılamaz.", "Verify backup configuration, checksums, offsite transfer and an isolated restore drill with the operator.", "Sorumluyla yedek ayarını, sağlama toplamını, sunucu dışı aktarımı ve izole geri yükleme tatbikatını doğrulayın."],
    requestPerformance: ["Requests may be slow or fail on this API process.", "Bu API sürecindeki istekler yavaş veya başarısız olabilir.", "Compare repeated samples, database wait and recent releases; this is not a load-test result.", "Tekrarlanan ölçümleri, veritabanı beklemesini ve son sürümleri karşılaştırın; bu bir yük testi sonucu değildir."],
    portalWorkers: ["Portal work may be delayed; absence of a fresh heartbeat is not definitive proof of a stopped process.", "Portal işleri gecikebilir; güncel yaşam sinyali olmaması sürecin durduğunu kesin kanıtlamaz.", "Check intended worker modes and running job durations with the operator before restarting anything.", "Yeniden başlatmadan önce amaçlanan çalışan modlarını ve süren işlerin uzunluğunu sorumluyla kontrol edin."],
  };
  const unavailableTitle = issue.key.endsWith(".unavailable") && Object.hasOwn(copy.titles, group) ? `${copy.titles[group as CheckKey]} · ${copy.codes.CHECK_UNAVAILABLE}` : null;
  const title = Object.hasOwn(titles, issue.key) ? copy.text(...titles[issue.key]) : unavailableTitle || (copy.lang === "en" ? issue.message : copy.text("Operational check needs investigation", "Operasyonel kontrolün incelenmesi gerekiyor"));
  const guide = Object.hasOwn(guidance, group) ? guidance[group] : undefined;
  return { title, impact: guide ? copy.text(guide[0], guide[1]) : copy.text(issue.impact || "Health evidence is incomplete.", "Sağlık kanıtı eksik."), nextAction: guide ? copy.text(guide[2], guide[3]) : copy.text(issue.nextAction || "Recheck and ask the system operator to inspect this check.", "Yeniden kontrol edin ve sistem sorumlusundan bu kontrolü incelemesini isteyin.") };
}
