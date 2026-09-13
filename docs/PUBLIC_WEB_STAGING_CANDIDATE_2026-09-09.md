# Public Web — Staging Aday ve Review Paketi

Tarih: 9 Eylül 2026
Durum: **Yerel aday hazır; remote review, staging ve production NO-GO**
Branch: `codex/public-web-foundation-20260908`

## Dondurulmuş kimlik

| Alan | Değer |
|---|---|
| Karşılaştırma tabanı | `e6edad6a3de34f1c597687753a8c18d0f8248bcb` |
| Code/config-bearing head | `3b93dee1cebf0fbce984d22916186e682e6a68f4` |
| Tree | `f057384d8a11cf304889b26c9a91cd3bb3f69e46` |
| Base→head binary patch SHA-256 | `6b8b72dd3d4d73755d31ed4893aafe4cb2066f88a10cb29cf2aa7725355c0a8d` |
| Değişim | 52 commit, 144 dosya, +35.493 / -247 |
| Migration ledger | 124 SQL / 124 journal |

Bu belge code/config hash'inin parçası değildir. Aday kimliği yukarıdaki exact
head'dir; review veya staging öncesi head değişirse tree, patch hash ve bütün
kanıtlar yeniden üretilir.

## Adayın kapsamı

- Tenant/organization ve FORCE RLS sınırlarında versioned public content,
  evidence, review, approval, publish/unpublish ve receipt omurgası.
- Mevcut `website_pages`, `website_blog_posts`, program, university ve
  destination kaynaklarını ikinci bir hakikat deposu yaratmadan governed
  publication projection'ına bağlayan API ve SSR teslimatı.
- Program, university, destination, city, guide ve genel CMS sayfalarında canonical,
  hreflang, JSON-LD, noindex ve fail-closed çeviri davranışı.
- 23 locale, 200.000 program ve 2.000 üniversite hedefi için on-demand render,
  bounded cache, in-flight coalescing ve en fazla 5.000 URL'lik sitemap shard'ları.
- Yayındaki hedeflerle sınırlı related/internal-link graph, güvenli canonical
  redirect ve kaldırılmış içerik için `410 Gone` route-alias ledger'ı.
- Admin Publication Center read model/API/UI ve verilen program/university HTML
  prototiplerinin mevcut React + SSR bileşen sistemine data-bound uyarlaması.
- Yeni public-web saf testlerinin convergence ve staging workflow'larına; gerçek
  PostgreSQL kapılarının convergence workflow'una bağlanması.
- Static frontend bootstrap hata yolunda HTML injection ve kullanıcıya stack/source
  sızıntısının kaldırılması; yalnız güvenli DOM düğümleriyle genel hata gösterimi.
- CMS sayfası ve rehber zengin metninde ortak allowlist sanitizer; script,
  handler, SVG/MathML ve reverse-tabnabbing yüzeylerinin kapatılması.
- Şehir kayıtları için additive FK/exclusive binding, ayrı immutable migration'da
  `name + country + body` evidence guard'ı, on-demand API/SSR, City JSON-LD ve
  published/indexable ülke→şehir→üniversite/program link grafiği.
- Yetki ve tenant/organization kapsamını execution anında tekrar doğrulayan,
  aynı idempotency anahtarında advisory-lock kullanan governed draft intake.
  Sonuç yalnız `DRAFT + NOINDEX`; receipt append-only, rollout varsayılan `off`
  ve bu adayda HTTP route, UI mutation, executor grant veya publish geçişi yoktur.
- İstemci tarafından tenant/organization, canonical path, source/content hash ve
  internal UUID seçilmesini reddeden server-bound intake builder; scope ve source
  binding'i server girdisinden, record/revision UUIDv7'lerini server tarafında üretir.
- Source resolver yalnız kolon-allowlist'li, boyut-kapılı ve `BEGIN READ ONLY`
  sorgular kullanır; executor kimliğini privilege/membership seviyesinde doğrular.
  Service fee, komisyon, kurum iletişim kişisi ve staff assignment alanları bu
  kaynak hash yüzeyine dahil değildir.
- Bounded batch planlayıcısı 100 kayıt/8 MiB/4 eşzamanlı source-read tavanıyla
  duplicate hedef ve idempotency anahtarlarını DB çağrısından önce ayırır; satır
  hatalarını izole eder ve kararlı plan hash'i üretir. Bu katman command execute
  etmez, veritabanına yazmaz ve publish/index yetkisi taşımaz.
- Batch executor reviewed plan hash'ini güncel kaynaklarla yeniden üretmeden
  hiçbir yazı başlatmaz; her satırda güncel selection-bound authority/capability
  kararı alır, impersonation'ı reddeder ve store concurrency'sini 2 ile sınırlar.
  Satır hatalarını izole eder, altyapı detaylarını döndürmez ve yalnız exact
  kimlikleri doğrulanmış `DRAFT + NOINDEX` store sonucunu başarı sayar.
- AI/mapping aracı çıktıları için çalıştırılabilir kod upload'u yerine exact şemalı,
  süreli ve mapping SHA-256 bağlı deklaratif JSON manifest kabul sözleşmesi vardır.
  Manifest client tenant/organization/rol seçemez; 100 satır, 8 MiB, 32 derinlik,
  200.000 node ve 7 günlük ömür tavanlarıyla canonical snapshot olarak planner'a
  girer. Parser herhangi bir adapter kodu çalıştırmaz veya dış bağlantı kurmaz.
- Import preview/preflight ve job contract katmanları adapter approval, maker-checker,
  server-resolved runtime kimliği, kısa ömürlü Ed25519 preview receipt'i ve exact
  plan/release drift bağını birlikte doğrular. Public preview redacted kalır; private
  command payload'u yalnız enqueue sınırında tutulur. Bu katmanlar runtime route/UI,
  executor grant veya publish/index activation açmaz.

## Exact-head yerel kanıt

| Kapı | Sonuç |
|---|---:|
| Full workspace typecheck | PASS |
| API production build | PASS |
| Edcons i18n | PASS — 5.027 kullanılan anahtar, 23 dil parity |
| Edcons public template tests | PASS — 5/5 |
| Edcons production build + static sitemap | PASS |
| Migration ledger | PASS — 124/124 |
| Public pure contract suites | PASS — 160/160 (yeni hardening paket testleri) |
| Public PostgreSQL suites | PASS — 6/6 |
| Migration authority | PASS — 31/31 + 1 ortam SKIP |
| Security regressions | PASS — 37/37 |
| Rate-limit/IP security | PASS — 6/6 |
| Package-manager guard | PASS — 6/6 |
| CI wiring contract | PASS — 4/4 |

Public pure toplamı: foundation 8, command 4, store adapter 4, publication read
model 2, localized entity 5, list/scale 13, route 4, render 10, discovery 6 ve
scale 3 teste ek olarak draft intake builder 4, bounded batch planner 20, batch
executor 6, source resolver 12, command 6 ve store 9 testtir.
Deklaratif draft import manifesti 5/5; adapter approval 20/20; preview 14/14;
preview receipt 8/8; runtime boundary 8/8; preflight 19/19; server plan 9/9 ve
job contract 14/14 testtir.

Yerel disposable PostgreSQL 16 üzerindeki beş suite public foundation,
catalog graph, public render ve discovery/localization/route-alias davranışını
ve draft intake için create/replay/idempotency/append-only/revoked-authority/
tenant-isolation davranışını kanıtladı. Altıncı gerçek PostgreSQL testi geçici,
kolon-kısıtlı executor ile kaynak çözümleme, inactive kayıt reddi ve temiz role
cleanup davranışını doğruladı. Production credential veya production verisi
kullanılmadı.

## Yerel performans eşiği

| Ölçüm | Örnek | p95 | Kapı |
|---|---:|---:|---:|
| SSR origin | 23 | 20,6 ms | `< 800 ms` |
| SSR cache hit | 100 | 24,4 ms | `< 250 ms` |
| Public API | 40 | 18,3 ms | `< 300 ms` |

Bu ölçüm sentetiktir; staging ağ/CDN/browser Core Web Vitals kanıtı değildir.

## Staging'e geçmeden zorunlu sıra

1. Exact code/config head'i doğru remote branch'e fast-forward push et.
2. Taslak PR aç veya mevcut doğru PR'ı bu exact head'e bağla; bağımsız reviewer
   authorization, tenant/RLS, XSS/SSR, sitemap ve cache invalidation sınırlarını
   incelesin.
3. Remote convergence CI'ın aynı exact head üzerinde Linux/static, Windows ve
   disposable PostgreSQL job'larını yeşil tamamladığını doğrula.
4. Staging deploy manifestini reviewed head, beklenen migration prefix ve
   rollback release'iyle bağla; staging veritabanında yalnız reviewed `0109–0123`
   additive migrations'ını çalıştır. `0123` replay-hardening migration'ı da
   aynı reviewed tail'in parçasıdır; migration aralığı elle kısaltılamaz.
5. `0120` içindeki NOT VALID city FK/entity check'leri için bounded orphan/shape
   audit'i çalıştır; temiz sonuçtan sonra constraint validation'ı ayrı reviewed
   staging adımı olarak kaydet.
6. İlk rollout'u `PUBLIC_WEB_RENDER_MODE=allowlist`, sitemap/internal-link
   modlarını `off` tutarak az sayıda program/university/destination/city rotasında yap.
7. Login/admin/student/staff/institution yüzeyleri için regresyon smoke; public
   rotalar için 200/308/404/410, canonical/hreflang/JSON-LD, cache ve XSS UAT yap.
8. Lighthouse mobile/desktop, gerçek CDN cache HIT/MISS, origin p95/p99, DB pool,
   error rate ve bot crawl ölçümünü kaydet.
9. Yalnız kanıt başarılıysa `PUBLIC_WEB_SITEMAP_MODE=published` ve
   `PUBLIC_WEB_INTERNAL_LINK_MODE=published` için ayrı approval ver.

## Rollback

- Feature değişkenlerini tekrar `off` yap; bu yeni public davranışı fail-closed
  kapatır ve eski SPA yüzeyini korur.
- Uygulama release symlink'ini doğrulanmış önceki staging release'ine döndür.
- Additive migration tablolarını acil rollback sırasında silme; writer'lar ve
  publication rollout kapalı tutulur. Schema cleanup ayrı reviewed ChangeSet'tir.
- Sitemap/CDN cache'lerini yeni index üretmeden purge et; yanlış URL'ler için
  alias/410 kaydı ancak maker-checker yayın akışıyla değiştirilir.

## Açık kalan NO-GO'lar

- Remote push/PR/exact-head Actions kanıtı yoktur.
- Bağımsız security/architecture review yoktur.
- Staging deploy ve gerçek browser/crawler/CDN UAT yapılmamıştır.
- Toplu içerik backfill, AI çeviri yayınlama ve public indexing aktive değildir.
- Manifest parser, draft intake, batch planlayıcısı ve executor runtime/UI'a
  bağlanmamış, executor role/grant verilmemiştir; mevcut CMS CRUD yazıları
  governed command yoluna geçirilmemiştir.
- Production deploy, public index açma ve `Find-And-Study-OS-Next` sync bu paketin
  yetkisi dışındadır.

Bu paket deploy yetkisi değildir; `AGENTS.md` içindeki daha geniş güvenlik,
review ve production NO-GO sınırlarını gevşetmez.
