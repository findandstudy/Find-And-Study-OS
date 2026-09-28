# Eksik işler güvenlik ve bütünlük dilimi — 28 Eylül 2026

## Kapsam

23 Eylül 2026 incelemesindeki hâlâ açık ve bu repo içinde güvenle uygulanabilir
dört boşluk kapatıldı. Production, staging, VPS, provider ayarı, gerçek kullanıcı
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

4. **Kalıcı upload grant ve finalizasyon temeli**
   - Generic storage ve social upload URL'leri, authenticated owner, beklenen boyut,
     MIME ve 15 dakikalık süreyle kalıcı granta bağlanıyor.
   - Finalizasyon provider'dan okunan gerçek byte, MIME ve SHA-256 ile yapılıyor;
     metadata farkı, expiry ve başka kullanıcı fail-closed reddediliyor.
   - Claim tek atomic conditional UPDATE ile yapıldığından eşzamanlı talepler
     aynı grantı iki kez kazanamıyor; exact retry güvenli replay oluyor.
   - Local immutable PUT aynı authenticated akışta otomatik finalize ediliyor;
     generic URL kullanan 18 frontend akışı ile social istemcisi provider upload
     sonrası aynı finalize endpoint'ini çağırıyor. Ayrı ticket tabanlı public
     agency upload kendi tek-kullanımlı immutable sözleşmesini koruyor.
   - Canonical öğrenci/application belge kaydı ile lead belge kaydı da grantı
     `FINALIZED → CONSUMED` olarak eski kaydı pasife alma ve yeni belgeyi ekleme
     işlemleriyle aynı transaction'da claim ediyor. Kullanılmış/finalize edilmemiş
     object hiçbir belge referansı üretemiyor.
   - Daha seyrek legacy attachment consumer'ları henüz global zorunlu consume
     kuralına alınmadı; external pilot izni açılmadı ve writer quarantine'da kaldı.
   - Social media asset kaydı, grantı `FINALIZED → CONSUMED` olarak asset
     insert ve immutable operation receipt ile aynı transaction'da claim ediyor;
     aynı staging object ikinci bir asset kaydında kullanılamıyor.

5. **Legacy audit await sınırı**
   - `logAudit` artık `setImmediate` arkasında sahte bir `await` sınırı sunmuyor;
     gerçek insert promise'ini döndürüyor.
   - API token create/revoke/rotate, e-posta sender/template approval, legacy
     impersonation start/end ve Academy access değişiklikleri request bitmeden audit
     denemesinin tamamlanmasını bekliyor.
   - Legacy helper uyumluluk için insert hatasını hâlâ diagnostic olarak yakalıyor.
     Bu iyileştirme, ayrı transaction-bound attempt/result receipt programının
     yerine geçmez ve o işi tamamlanmış saymaz.

6. **Public katalog iki-process cache invalidasyonu**
   - Mevcut PostgreSQL altyapısı üzerinde bounded/allowlist payload'lı
     `LISTEN/NOTIFY` invalidation bus eklendi; Redis veya paralel cache servisi yok.
   - Local mutation aynı process cache'ini hemen temizliyor, ardından diğer API
     process'lerine invalidation yayıyor. Kaynak process kendi event'ini tekrar
     uygulamıyor.
   - Public detail read-model generation'ı ve generation-key kullanan Course
     Finder cache'leri diğer process'te de ilerliyor.
   - Notification bus için bootstrap seviyesinde global abone eklendi; başka API
     process'inde oluşan bildirim ilgili kullanıcının process-local sayaç cache'ini
     anında düşürüyor, mevcut SSE aboneliği aynen korunuyor.
   - Import bağlantı açmıyor; listener yalnız explicit bootstrap'ta başlıyor ve
     SIGTERM/SIGINT shutdown sınırında kapanıyor.

## Doğrulama

- Security regression: **115/115 PASS**.
- Security hardening/native bağımlılık: **116 PASS, 1 Windows symlink SKIP**.
- Web-form replay: **9/9 PASS**.
- Application concurrency: **5/5 PASS**.
- Import lifecycle (catalog bus dahil): **17/17 PASS**.
- İki bağımsız process + PostgreSQL katalog invalidasyonu: **4/4 PASS**.
- İki bağımsız process + PostgreSQL bildirim sayacı invalidasyonu: **3/3 PASS**.
- Upload grant contract: **18/18 PASS**.
- Frontend upload finalization inventory: **18/18 PASS**.
- Upload grant PostgreSQL 16.15: **17/17 PASS**.
- Document/lead ownership + finalized-grant route corridor: **14/14 PASS**.
- Audit durability contract: **13/13 PASS**.
- Disposable authenticated HTTP corridor: **PASS**; real login/session, CSRF,
  owner-bound grant, initial upload, exact replay, immutable conflict,
  cross-user/anonymous deny, logout, zero external delivery ve tam DB/storage cleanup.
- API build/typecheck: **PASS**.
- Edcons i18n + 114 contract testi + production build + sitemap + bundle budget:
  **PASS**.
- Migration authority/validation: **129/129 PASS**.
- Disposable PostgreSQL 16.15: fresh `0→129`, upload grant migration, route E2E,
  DB helper fixture cleanup: **PASS**; cluster durduruldu.
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
- Kalan seyrek legacy attachment rotalarında `FINALIZED → CONSUMED` zorunluluğu:
  generic producer'lar, social asset ve canonical document/lead consumer'ları
  hazır; kalan her consumer kendi kayıt transaction'ına taşınmadan global
  enforcement açılmaz.
- Application kaydıyla finance/portal/genel notification intent'lerinin tümünü
  aynı transaction outbox'ına almak: stage email bunu yapıyor; kalan devam işleri
  dar command/worker dönüşümü ister.
- High-impact legacy audit'lerin tamamını aynı transaction'da durable
  attempt/result receipt'e taşımak: kritik mevcut çağrılarda gerçek await sınırı
  kuruldu; failure durumunda business mutation'la atomik receipt için dar command
  migration'ları hâlâ gerekir.
- 80 legacy route'un tenant/capability koridoru: kademeli migration programıdır,
  tek global refactor değildir.
- Facet gibi kullanıcı-scope process-local cache'lerin kalan çoklu-process
  invalidasyonları ayrı dar fazlardır; public katalog/Course Finder ve notification
  count iki-process koridorları tamamlandı.
- Academy/provider sandbox E2E, offsite restore/DR ve gerçek yüksek-hacim/CWV
  ölçümü harici ortam/credential veya operasyon penceresi gerektirir; production
  üzerinde otomatik çalıştırılmaz.
