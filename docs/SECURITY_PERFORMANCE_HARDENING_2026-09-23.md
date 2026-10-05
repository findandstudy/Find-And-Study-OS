# Güvenlik ve performans iyileştirmesi — 23 Eylül 2026

## Kapsam ve durum

Kullanıcının “işleri yapmaya devam et” onayıyla, önceki salt-okunur denetimdeki
yüksek öncelikli bulguların küçük, geri alınabilir yerel dilimleri uygulandı.
Taban `c2b872abe22848a50e61f12d73ff6b5b11591379`, branch
`codex/public-detail-staging-20260919`. Kanıtlar bu taban üzerindeki **commit
edilmemiş çalışma ağacı** içindir; dağıtılmış release kanıtı değildir.

Staging/production/VPS/config/DB/provider değiştirilmedi. Migration, merge,
commit, push, deploy, gerçek e-posta/WhatsApp/Academy geçişi veya veri temizliği
yapılmadı. Testler sentetik veri/geçici dizin/mock taşıyıcı kullanır. Paket
kayıt servisine yalnız bağımlılık çözümleme ve güvenlik sorguları yapıldı.

## Uygulanan dilimler

1. **Bağımlılıklar:** API ve portal-runner `sharp` 0.35.4'e, API `nodemailer`
   9.1.1'e sabitlendi; pnpm 10.33.2 lock yeniden üretildi. Gerçek runtime
   libheif 1.23.2. Registry audit önce 2 pakette 5 advisory iken şimdi 641
   production dependency üzerinde 0 bilinen advisory. Bu sonuç uygulama pentest'i
   veya çalışan Linux image/SBOM doğrulaması değildir.
2. **Dış gönderim kapatma politikası:** explicit `ALLOW_LIVE_INTEGRATIONS`
   yalnız tam `true` değerinde izin verir. False/boş/geçersiz değerler production
   dahil engellenir. Değişken yoksa eski production varsayılanı korunur. Bağlantı
   testleri SMTP/Anthropic dahil credential açma/DNS/provider öncesi durur;
   simülasyon sağlıklı bağlantı kanıtı göstermez. Karma harfli toggle atlatması
   kapandı. Academy kapatma kontrolü PII/JWT/redirect öncesindedir; no-store ve
   no-referrer eklenmiştir. Inbound webhook davranışı değiştirilmedi.
3. **Yerel upload değişmezliği:** auth+ownership korunarak complete temporary
   file → fsync → exclusive hard-link publish; MIME önce, body son yayınlanır.
   Farklı içerik/MIME aynı key'e yazılamaz (409). Aynı *işlenmiş* bytes+MIME
   no-op 200; eşzamanlı yayın 503/Retry-After. Mevcut eksik çift, symlink,
   hard-link ve sahipliği belirsiz cleanup fail-closed. Local URL issuance da
   yayıncının reddedeceği alias/reserved prefix'leri grant öncesi reddeder.
4. **Course Finder tekrar/süre bütçesi:** mevcut CSRF, credentials, route,
   filtre ve başvuru mantığı korunur. GET/HEAD tek transport owner tarafından
   en fazla 4 kez ve toplam 30 saniye bütçeyle denenir; TanStack outer retry
   kapalıdır. Backoff iptal edilebilir; response body'de zaman aşımı doğru
   transient hata sınıfını korur. Mutation otomatik tekrarlanmaz. Sürekli
   geçici hatada teorik 16 yerine en fazla 4 HTTP girişimi vardır; normal
   başarılı isteğin hızlandığı veya DB sorununun çözüldüğü iddia edilmez.
5. **Öğrenci fotoğrafı önizleme:** indirme/decode öncesi 2 aktif, 8 bekleyen,
   5 saniye kuyruk sınırı; 25 MiB/source, 50 MiB source reservation. Local
   stream okuması 10 saniye, decode 16 MP/tek frame ve sharp 5 saniye;
   PDF ilk sayfa 512px, okunan render çıktısı 1 MiB. Source kapanışı bitmeden
   rezervasyon serbest bırakılmaz. Geçici fallback cachelenmez; HTTP no-store,
   ETag yok. Başarılı içerik hash'li v2 ETag alır; 304 ancak yetki kontrolü ve
   başarılı representation sonrası verilir. Eski placeholder ETag'leri bir 200
   ile yenilenir. Gerçek GCS SDK pre-header iptal açığı nedeniyle bounded GCS
   thumbnail okuması ağ başlamadan fail-closed; normal GCS belge indirme
   çağrıları değişmez. Cancellable GCS adapter ayrı backlog'dur.
6. **Güvensiz yazmalı UAT aracına emniyet:** mevcut workflow script'i hem run
   girişinde hem exported Session taşıyıcı sınırında koşulsuz karantinada.
   Env opt-in ile açılamaz; credential/health/login/merge/upload/purge öncesi
   sıfır ağ çağrısıyla durur. Ayrı RBAC runner değiştirilmedi. Bu düzeltme tam
   E2E'nin geçtiği anlamına gelmez; güvenli run-owned lifecycle henüz yoktur.

## Yeniden kullanılan yapılar

- Mevcut canlı entegrasyon helper'ı, transporter'lar ve admin role guard'ları.
- Mevcut upload owner kaydı, MIME/boyut doğrulama ve processing zinciri.
- Mevcut object-storage driver'ları; bounded okuma yalnız opt-in genişletme.
- Mevcut thumbnail cache/coalescing, yetkili öğrenci fotoğrafı route'u.
- Mevcut Course Finder query/cache/CSRF ve başvuru/form akışı.
- Mevcut package test zincirleri, legacy route ve tenant writer envanterleri.

Paralel CMS/CRM/notification/storage sistemi veya global refactor eklenmedi.
Yeni parçalar module-local retry client, immutable local publisher,
thumbnail admission/byte limit helper'ları ve ilgili regresyon testleridir.

## Test kanıtı

Windows x64 / Node 24.19.0 / pnpm 10.33.2. Son birleşik gruplar:

| Kontrol | Sonuç |
| --- | --- |
| Mevcut API security/system-health/email zinciri (7 dosya) | 115 PASS, 0 FAIL |
| `test:security-hardening` (8 dosya; aşağıdaki ayrım) | 84 PASS, 1 SKIP, 0 FAIL |
| Frontend build test grubu, Course Finder dahil (10 dosya) | 114 PASS, 0 FAIL |
| UAT quarantine + package-manager + public-web CI wiring | 25 PASS, 0 FAIL |
| Toplam; tekrar çalıştırmalar eklenmeden | **338 PASS, 1 SKIP, 0 FAIL** |
| Workspace library `tsc --build`, API ve Edcons noEmit | PASS |
| Yeni Course Finder/dependency testlerinin ayrıca TypeScript denetimi | PASS |
| API `build.ts`, Edcons Vite production-mode build (yalnız yerel çıktı) | PASS |
| i18n, 23 locale key/placeholder eşliği | PASS; 5021 kullanılan / 6444 EN anahtarı |
| Yerel sitemap generation ve public bundle budget | PASS |
| pnpm offline frozen-lockfile consistency | PASS |
| `pnpm audit --prod --json` | PASS; 641 dependency, 0 advisory |
| Normal writer/route drift, diff whitespace | PASS |

Yeni güvenlik grubunun dağılımı: live-policy 8, connection safety 10, Academy 8,
dependency runtime 4, upload 23 PASS + 1 SKIP, thumbnail+limits 20, bounded
document source 11. SKIP, Windows file-symlink oluşturma ayrıcalığının yokluğudur;
gerçek junction/root/path-replacement, hard-link, dört-process race ve
partial-write/cleanup testleri çalıştı. Linux file-symlink/fsync release kanıtı
olduğu iddia edilmez. PDF fixture bu makinede renderer ile çalıştı, skip olmadı.

Frontend build üretimi 3614 module ile başarılıdır. Mevcut bundle gate çıktısı:
initial JS gzip 280325 byte, CSS 41159 byte, bootstrap 1299 byte, 23 locale ve
max locale gzip 103241 byte. Bu sadece mevcut build bütçesidir; locale zinciri
dahil tam ilk yük, wire size, Lighthouse veya gerçek-user CWV ölçümü değildir.

Yerel Windows sandbox `tsx` başlatmada `os.userInfo/ENOMEM` verdi; aynı saf
testler izinli runner'da `node --import tsx --test ...` ile çalıştırıldı. Bunun
için sandbox/güvenlik veya uygulama ayarı değiştirilmedi. İlk regresyon turlarında
bir test assertion'ı ve bağımsız review'da body timeout/placeholder cache/source
close sorunları bulundu, düzeltildi ve son gruplar yeniden çalıştırıldı.

Normal inventory 201 writer dosyası/2610 surface ve 80 route dosyası/881
registration ile PASS; external pilot allowlist **0**. Quarantine sınıfları
gevşetilmedi. Strict tenant-adoption NO-GO sınırı bu yamayla kapanmaz.

Tekrarlanabilir package komutları: API `test:security-regressions` (artık yeni
hardening grubunu da çağırır), Edcons `test:course-finder-api` ve `build`, root
`test:staging-workflow-uat`, `test:package-manager`, `test:public-web-ci-wiring`.
Full API `test` zincirindeki DB/provider isteyen diğer suite'ler körlemesine
çalıştırılmadı. Önceki audit/başka turlardaki testler bu sayılara eklenmedi;
bu tur gerçek tarayıcı/staging/database tam iş-akışı E2E yapılmadı.

Karşılıklı kaynak incelemesi yapıldı. GCS stream iptalinin returned stream close
ile kanıtlanmadığı, kurulu gerçek SDK + sahte upstream transport probe'unda
gösterildi; güvensiz aday çıkarılıp no-network fail-closed sınırı test edildi.
Bu iç inceleme bağımsız release reviewer onayının yerine geçmez.

## Dosya envanteri

| Dosya/grup | Gerekçe |
| --- | --- |
| `artifacts/api-server/package.json`, `lib/portal-runner/package.json`, `pnpm-lock.yaml` | Exact güvenlik sürümleri ve API regresyon wiring |
| `artifacts/edcons/package.json` | Retry regresyonunu frontend build kapısına bağlama |
| `artifacts/api-server/src/lib/inbox/liveMode.ts` | Explicit-off önceliği |
| `artifacts/api-server/src/routes/integrations.ts` | Test ve toggle güvenlik sınırı |
| `artifacts/api-server/src/routes/academySso.ts` | Ortam kapatma politikası ve hassas response başlıkları |
| `artifacts/api-server/src/lib/localUploadPublication.ts` (yeni), `src/routes/storage.ts` | Exclusive/immutable yerel yayın ve prefix uyumu |
| `artifacts/api-server/src/lib/studentPhotoThumbnail.ts`, `src/routes/students.ts` | Bütçeli preview ve başarıya bağlı HTTP cache |
| `artifacts/api-server/src/lib/studentPhotoThumbnailAdmission.ts`, `src/lib/documentByteLimits.ts` (yeni) | İş/byte/queue/read sınırları |
| `artifacts/api-server/src/lib/documentBytes.ts`, `src/lib/objectStorage.ts` | Geriye uyumlu, sadece bounded okuyucuların kullandığı güvenli source sınırı |
| `artifacts/edcons/src/components/course-finder/api.ts` (yeni), `src/pages/staff/CourseFinder.tsx` | Tek retry owner ve read deadline |
| API `scripts/test-live-integration-policy.ts`, `test-integration-connection-safety.ts`, `test-academy-sso-delivery-safety.ts` (yeni) | Ortam/transport/SSO negatifleri |
| API `scripts/test-security-dependency-runtime.ts` (yeni) | Gerçek sharp ve ağsız mail compilation regresyonu |
| API `scripts/test-local-upload-publication.ts` (yeni) | Dosya/race/crash/failure/route sınırları |
| API `scripts/test-student-photo-thumbnail.ts`, `test-student-photo-thumbnail-limits.ts` (yeni), `test-document-bytes-bounded-source.ts` (yeni) | Render, cache, admission ve source regressions |
| Edcons `scripts/test-course-finder-api.ts` (yeni) | Gerçek QueryClient dahil retry/cancel/timeout testleri |
| `deploy/staging/run-staging-workflow-uat.mjs`, `test-staging-workflow-uat.mjs` | Güvensiz helper için bypass edilemeyen yerel execution fence |
| `security/tenant-writer-registry.json`, `security/legacy-role-gate-registry.json` | Yeni publisher karantina sınıflandırması ve dört değişen route hash'i; izin genişletme yok |
| `AGENTS.md`, bu rapor ve `docs/security-hardening-20260923-dependency-audit.json` | Kalıcı kapsam, kanıt ve kalan risk kaydı |

`src/...` kısaltmaları ilgili satırdaki API/Edcons package köküne göredir.

## Uyumluluk ve kalan riskler

- Public/detail routes, factual/SEO/CMS verileri, Auth modeli, payment,
  application stage business rules, schema/migration ve üretim ayarları değişmedi.
- Local PUT için eski byte overwrite davranışı **bilerek kaldırıldı**. Yeni
  belge/replacement yeni upload URL/key almalıdır. Mevcut server-managed
  overwrite/recompression writer'ları bu dilimde değiştirilmedi.
- Upload grant expiry/consume/finalization receipt henüz yok. Aynı ham PDF'nin
  nondeterministik processing sonucu değişirse retry 409 verebilir; HTTP
  pipeline-level PDF lost-response retry kanıtı eksiktir. Crash sonrası stale
  lock otomatik çalınmaz; yeni URL veya separately authorized operator recovery
  gerekir. Root app-owned, mevcut/absolute/non-symlink ve filesystem hard-link
  destekli olmalıdır. Linux gerçek fsync/symlink testi ayrıca gereklidir.
- 50 MiB **source reservation** sınırıdır, process RSS garantisi değildir.
  Legacy base64 satırları route DB okumasında önceden belleğe gelebilir;
  native PDF parser RSS/CPU için OS/container bütçesi ayrı operasyon işidir.
  Yerel filesystem metadata beklemeleri portable Node ile sert iptal edilemez.
- **GCS thumbnail:** bu patch'in bounded yolunda desteklenmiyor; güvenli
  placeholder verir. Uygulamanın diğer GCS download çağrıları eski davranışı
  korur. Gerçek SDK request lifecycle + auth + cancellation kanıtlı, kamuya
  açık desteklenen adapter olmadan bulut preview desteği açılmamalıdır.
- Production modunda bayrak **yoksa** eski live varsayılanı sürer. Staging'de
  explicit false ve bağımsız egress fence doğrulanmalıdır. Academy ortam hedefi,
  issuer/audience ve replay/code-exchange alıcı koordinasyonu hâlâ eksiktir.
- Web-form timestamp/nonce ve kalıcı dedup; bir kritik application corridor'unda
  optimistic concurrency + transaction/outbox + durable audit; tenant/branch
  kapsam matrisi ve processler arası cache tutarlılığı bu dilimde çözülmedi.
- Güvenli disposable E2E lifecycle, büyük sentetik DB query-plan/load/soak,
  gerçek mobile CWV/a11y, offsite restore/DR ve Linux exact-source CI/bağımsız
  release review tamamlanmadı. Paket audit sıfır olması bu kapıları açmaz.
- Vite build mevcut sourcemap-location, static/dynamic import ve >500 kB locale
  chunk uyarıları üretir. Bundle gate bütün runtime locale yükünü veya CWV'yi
  ölçmez. Başlangıç çeviri namespace/bütçe iyileştirmesi ayrı backlog'dur.

## Güvenli sonraki sıra

1. Bu yerel patch'in Linux/native upload/thumbnail kontrolü ve exact-source review.
2. Gerçek kayıt/credential içermeyen disposable, run-owned E2E lifecycle.
3. Web-form replay geçiş sözleşmesi ve Academy alıcı koordinasyonu.
4. Tek application corridor'unda version/receipt/outbox negatif concurrency testleri.
5. Temsilci sentetik katalogda DB planı, cold/warm/burst/soak ve mobile CWV;
   mevcut Operations/Data Quality modüllerinde read-only problem/etki kartları.

## Release status

**PARTIALLY READY — yerel güvenlik/performance dilimleri; deploy edilmedi.**
Local-driver staging adayı için dahi Linux dosya sistemi ve gerçek güvenli UAT
kontrolleri açık. GCS preview ve tam yazmalı E2E açıkça BLOCKED/BACKLOG.
Production/dış-tenant GO veya kapasite sertifikası verilmez.
