# Eksik işler güvenlik ve bütünlük dilimi — 28 Eylül 2026

## Kapsam

23 Eylül 2026 incelemesindeki hâlâ açık ve bu repo içinde güvenle uygulanabilir
üç boşluk kapatıldı. Production, staging, VPS, provider ayarı, gerçek kullanıcı
verisi ve dış Academy alıcısı değiştirilmedi.

## Tamamlananlar

1. **Web-form replay koruması**
   - İstek zamanı ve kalıcı request ID zorunlu.
   - İmza artık exact raw body ile birlikte `timestamp.requestId` zarfını kapsıyor.
   - Beş dakikalık clock-skew sınırı var.
   - `web_form_ingest_receipts` aynı form/request ID için tek kalıcı claim tutuyor.
   - Aynı tamamlanmış içerik güvenli replay cevabı; aynı ID/farklı içerik conflict;
     devam eden veya başarısız istek yeni yan etki üretmiyor.

2. **Application optimistic concurrency**
   - Stage ve assigned-person değişimleri canonical `expectedUpdatedAt` olmadan
     uygulanmıyor.
   - Eski ekranla yapılan yarış `409 APPLICATION_VERSION_CONFLICT` döndürüyor.
   - Kaybeden istek finance veya notification etkisine ulaşmıyor.
   - Staff list/detail, Agent Apps ve Inbox geçişleri güncel version bilgisini
     taşıyor ve conflict durumunda refresh ediyor.

3. **Import/worker yaşam döngüsü**
   - Feed, Inbox ve Notification bus import sırasında DB LISTEN açmıyor.
   - Notification route import sırasında seed yazmıyor; seed yalnız explicit
     worker-zero bootstrap'ta çalışıyor.
   - Document catalog/label import warm-up sorguları kaldırıldı; ilk gerçek
     kullanıma kadar lazy.
   - Üç bus SIGTERM/SIGINT shutdown sırasında listener ve reconnect timer'larını
     bırakıyor.

## Doğrulama

- Security regression: **115/115 PASS**.
- Security hardening/native bağımlılık: **116 PASS, 1 Windows symlink SKIP**.
- Web-form replay: **9/9 PASS**.
- Application concurrency: **5/5 PASS**.
- Import lifecycle: **12/12 PASS**.
- API build/typecheck: **PASS**.
- Edcons i18n + 114 contract testi + production build + sitemap + bundle budget:
  **PASS**.
- Migration authority/validation: **128/128 PASS**.
- Disposable PostgreSQL 16.15: mevcut disposable `126→128`, receipt table,
  unique replay claim ve fixture cleanup: **PASS**; cluster durduruldu.
- Legacy route ve tenant-writer normal drift kapıları: **PASS**; yeni seed writer
  quarantine altında sınıflandırıldı, hiçbir external-pilot izni açılmadı.

## Uyumluluk ve rollout notu

Web-form üreticileri dağıtımdan önce `X-Webform-Timestamp`,
`X-Webform-Request-Id` ve v1 zarfını imzalayan `X-Webform-Signature` sözleşmesine
geçmelidir. Eski token kullanımı yalnız kimlik doğrulama uyumluluğudur; replay
başlıklarını kaldırmaz. Migration additive'dir. Staging UAT ve deployment bu
dilimde yapılmadı.

## Repo dışı veya ayrı kapı isteyen kalanlar

- Academy receiver tarafında issuer/audience + single-use exchange: receiver bu
  repoda değil; koordineli iki taraflı değişiklik gerekir.
- Genel cloud signed-PUT upload grant consume/finalization: local immutable
  publisher hazır, fakat cloud provider completion receipt'i ve bütün attach
  rotalarının tek sözleşmeye alınması ayrı migration/adapter dilimidir.
- Application kaydıyla finance/portal/genel notification intent'lerinin tümünü
  aynı transaction outbox'ına almak: stage email bunu yapıyor; kalan devam işleri
  dar command/worker dönüşümü ister.
- High-impact legacy audit'lerin tamamını durable attempt/result receipt'e
  taşımak ve 80 legacy route'un tenant/capability koridoru: kademeli migration
  programıdır, tek global refactor değildir.
- Academy/provider sandbox E2E, offsite restore/DR, iki-process cache
  invalidation ve gerçek yüksek-hacim/CWV ölçümü harici ortam/credential veya
  operasyon penceresi gerektirir; production üzerinde otomatik çalıştırılmaz.

