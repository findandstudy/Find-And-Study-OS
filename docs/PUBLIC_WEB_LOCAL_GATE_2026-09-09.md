# Public Web Foundation — Yerel Gate Kanıtı

Tarih: 9 Eylül 2026
Durum: **Yerel staging adayı yeşil; staging/production aktivasyonu NO-GO**
Branch: `codex/public-web-foundation-20260908`
Code/config-bearing head: `3b93dee1cebf0fbce984d22916186e682e6a68f4`
Karşılaştırma tabanı: `e6edad6a` (`origin/codex/operations-social-staging-20260905`)

## Teslim edilen dilim

- Tenant ve organization sınırlarına bağlı public web content foundation.
- Active-context ve capability doğrulamalı, idempotent publication command/store.
- Admin Publication Center read model, API ve UI.
- Ölçeklenebilir public program/university API'leri ve detay sayfaları.
- University, destination ve city içeriklerinin exact `PUBLISHED` çok dilli revizyondan API + SSR teslimatı.
- Çevirisi olmayan İngilizce dışı university/destination/city rotalarının İngilizce metne düşmeden fail-closed kapanması.
- `/{locale}/cities/{slug}-{id}` şehir sayfası, ülke→şehir ve şehir→üniversite/program bağlantı grafiği; yalnız `PUBLISHED + INDEX` hedeflere link üretimi.
- Yeni şehir rotasının publication modu kapalıyken İngilizce legacy kaynağa düşmeden 404/noindex kapanması.
- Çevrilmiş destination canonical slug çözümleme, locale-aware destination listesi ve toplu/N+1'siz related university yerelleştirmesi.
- Aktif route-alias ledger'ından yalnız yayındaki hedefe 301/308 ve kaldırılan içeriğe 410 teslimatı; hedef/path doğrulaması ve bounded cache.
- Default-off, allowlist/all kontrollü semantic SSR/ISR render pilotu.
- Canonical URL, doğrulanmış hreflang, JSON-LD ve dinamik sitemap üretimi.
- Yalnız gerçekten `PUBLISHED + INDEX` olan ve ilgili dilde teslim edilebilen kayıtların discovery katmanına alınması.
- 200.000 program, 2.000 üniversite ve 23 dil hedefi için bounded sitemap/HTML ölçek kapısı.
- Publication Center için selection-bound active-context ve
  `public_web.content.write` capability doğrulamalı, idempotent içerik kabul
  katmanı. Bu katman yalnız immutable revision + `DRAFT + NOINDEX` oluşturur;
  yayınlama, index açma, role grant veya HTTP/UI wiring yapmaz.
- İstemci tenant/organization, canonical path, source hash veya internal record/
  revision kimliği seçemez; bunlar server-side scope, doğrulanmış kaynak binding'i
  ve server-generated UUIDv7 kimliklerinden oluşturulur.
- Kaynak resolver yalnız aktif legacy program/üniversite/destinasyon/şehir ve
  uygun CMS page/article kayıtlarını bounded, salt-okunur ve kolon-allowlist'li
  sorguyla çözer; service fee, komisyon, kurum iletişim kişisi ve staff ataması
  kaynak yüzeyine girmez.
- Toplu draft planlayıcısı en fazla 100 kayıt ve 8 MiB canonical giriş kabul
  eder; en fazla 4 kaynak okumasını eşzamanlı yürütür. Yinelenen hedef ve
  idempotency anahtarlarını kaynak/DB çağrısından önce reddeder; eksik, bozuk
  veya geçici olarak çözülemeyen bir kayıt diğer geçerli kayıtları düşürmez.
  Plan yalnız doğrulanmış request/source binding ve kararlı SHA-256 üretir;
  command çalıştırmaz, veritabanına yazmaz ve yayın/index kararı vermez.
- Batch executor yalnız önceden görülen plan SHA-256 güncel kaynaklarla yeniden
  üretilebiliyorsa ilerler. Her accepted kayıt için selection-bound active-context
  ve `public_web.content.write` yetkisini execution anında tekrar değerlendirir;
  impersonation'ı reddeder ve en fazla 2 store yazısını eşzamanlı yürütür.
  Store cevabı exact kimlik/shape ile doğrulanır; satır hataları güvenli kodlarla
  izole edilir ve başarılı sonuç yine yalnız `DRAFT + NOINDEX` olabilir.
- AI/import aracı çıktısı çalıştırılabilir kod olarak kabul edilmez. Sadece exact
  şemalı `FAS_PUBLIC_WEB_DRAFT_IMPORT` JSON manifesti alınır: client scope/rol
  alanı yoktur, adapter mapping SHA-256 ve en fazla 7 günlük süre penceresi
  zorunludur; 100 satır, 8 MiB, 32 derinlik ve 200.000 JSON node tavanlarıyla
  prototype-pollution ve executable değerler reddedilir. Canonical snapshot ve
  manifest SHA-256 mevcut batch planner'a veri olarak aktarılır.
- Import preview/preflight katmanı adapter approval, maker-checker, server-resolved
  runtime identity ve kısa ömürlü Ed25519 preview receipt'ini birbirine bağlar.
  Redacted preview dışına ham içerik/secret çıkmaz; server plan yalnız accepted item
  metadata'sı taşır ve job contract receipt/plan/release drift'ini fail-closed
  reddeder. Bu katman da runtime route/UI veya publish/index activation açmaz.

## Exact-head doğrulama özeti

| Kapı | Sonuç |
|---|---:|
| Full workspace TypeScript typecheck | PASS |
| API production build | PASS |
| Edcons TypeScript typecheck | PASS |
| Edcons i18n parity | PASS — 23 dil |
| Edcons production build | PASS |
| Migration ledger | PASS — 124 dosya / 124 journal |
| Public web foundation PostgreSQL | PASS — 1/1 |
| Catalog entity graph PostgreSQL | PASS — 1/1 |
| Publication store | PASS — 4/4 |
| Public localized entity contract | PASS — 5/5 |
| Public catalog route contract | PASS — 4/4 |
| Public catalog render contract | PASS — 10/10 |
| Public web discovery contract | PASS — 6/6 |
| Public web discovery PostgreSQL | PASS — 1/1 |
| Public web scale gate | PASS — 3/3 |
| Draft intake builder/command/store | PASS — builder 4/4 + command 6/6 + store 9/9 |
| Draft intake PostgreSQL | PASS — 1/1 |
| Draft source resolver | PASS — saf 12/12 + PostgreSQL 1/1 |
| Draft batch planner | PASS — 20/20 |
| Draft batch executor | PASS — 6/6 |
| Draft import manifest | PASS — 5/5 |
| Adapter approval contract | PASS — 20/20 |
| Draft import preview | PASS — 14/14 |
| Preview receipt | PASS — 8/8 |
| Publication runtime boundary | PASS — 8/8 |
| Draft import preflight | PASS — 19/19 |
| Draft import server plan | PASS — 9/9 |
| Draft import job contract | PASS — 14/14 |
| Migration authority | PASS — 31/31 + 1 ortam SKIP |
| Security regressions | PASS — 37/37 |
| Rate-limit/IP security | PASS — 6/6 |
| Public web CI wiring contract | PASS — 4/4 |

Derlemedeki mevcut source-map lookup ve 500 kB üzeri chunk mesajları uyarıdır; build'i başarısız kılmamıştır. Bundle ayrıştırma performans işi ayrı bir kapı olarak korunur.

## Yerel performans kanıtı

Araç yalnız açık opt-in ile, `fas_migrator@127.0.0.1:5433/fasos_apply_local` disposable veritabanına karşı çalıştırıldı. Production credential veya veri kullanılmadı.

| Ölçüm | Örnek | p95 |
|---|---:|---:|
| SSR origin | 23 | 20,6 ms |
| SSR cache hit | 100 | 24,4 ms |
| Public API | 40 | 18,3 ms |

Bu sayılar yerel sentetik ölçümdür; gerçek edge-cache, ağ, CDN, bot trafiği veya kullanıcı Core Web Vitals kanıtı değildir.

## Ölçek sözleşmesi

- 200.000 program + 2.000 üniversite × 23 locale = 4.646.000 olası URL, önceden render edilmez.
- Sitemap'ler en fazla 5.000 URL'lik bounded shard'lara ayrılır; 200.000 program + 2.000 üniversite tabanı 944 shard üretir, şehir shard'ları yalnız gerçekten yayınlanan kayıt sayısından eklenir.
- En kötü 5.000 URL / 23 hreflang shard sentetik testte yaklaşık 134–155 ms aralığında ve 50 MiB heap tavanının altında kaldı.
- SSR cache 5 dakika fresh, 1 saat stale, en fazla 500 entry ve in-flight coalescing kullanır.
- Discovery projection cache 5 dakika, en fazla 5.000 entry ve hedefli invalidation kullanır.

## Varsayılan-kapalı aktivasyon sınırı

Staging ve production ortamları bu çalışma tarafından değiştirilmedi. Aşağıdaki değişkenler opt-in yapılmadıkça yeni runtime davranışı açılmaz:

```text
PUBLIC_WEB_RENDER_MODE=off
PUBLIC_WEB_RENDER_ALLOWLIST=
PUBLIC_WEB_INTERNAL_LINK_MODE=off
PUBLIC_WEB_SITEMAP_MODE=off
PUBLIC_WEB_TENANT_ID=
PUBLIC_WEB_ORGANIZATION_ID=
PUBLIC_WEB_DRAFT_INTAKE_MODE=off
PUBLIC_WEB_DRAFT_INTAKE_TENANT_ALLOWLIST=
```

`PUBLIC_WEB_SITEMAP_MODE=published` yalnız sitemap üretimini açmaz. Aynı
tenant/organization scope'unda university, destination ve city detayları için exact
`PUBLISHED` revizyonu teslimat kaynağı yapar. İngilizce dışındaki bir locale'de
uygun `translation_status=PUBLISHED` revizyonu yoksa sayfa İngilizce metne
düşmez; API `404` ve SSR noindex/not-found üretir. `NOINDEX` durumundaki
yayınlanmış revizyon okunabilir, fakat discovery ve hreflang grafiğine girmez.
City yeni bir public yüzey olduğu için `PUBLIC_WEB_SITEMAP_MODE=off` iken
İngilizce kaynağa da düşmez; yayın revizyonu olmadan görünür olmaz.

Geçersiz rollout modu veya geçersiz tenant/organization UUID'si fail-closed davranır.

## Bilinen sınırlar ve sonraki kapılar

1. Staging smoke/UAT, gerçek crawler davranışı, Lighthouse/Core Web Vitals, CDN cache ve invalidation kanıtı alınmamıştır. Yerel tarayıcıda masaüstü ve 390 px mobil ana sayfa/navigation kontrolü yatay taşma ve console error üretmedi; gerçek city içeriği henüz staging UAT görmedi.
2. Bulk content import/backfill ve AI translation publication otomatik olarak açılmamıştır. Manifest parser, draft intake adapter'ı, bounded batch planlayıcısı ve executor runtime route'una veya admin formuna bağlanmamıştır; mevcut CMS/website CRUD yüzeyi bu governed command yoluna taşınmamıştır.
3. Frontend build başarılıdır; bazı dil paketleri 500 kB uyarı eşiğini aşmaktadır ve gerçek trafik ölçümüyle ayrı bundle bütçesi uygulanmalıdır.
4. Public-web saf ve PostgreSQL testleri convergence CI'a, saf testler staging
   adoption CI'a bağlanmıştır. GitHub push/PR, remote exact-head CI,
   bağımsız review ve deployment bu yerel gate'in dışında kalır.
5. Production wiring, veri backfill veya public index açma için ayrı açık onay ve rollback planı gerekir.

Edcons build bütçesi: başlangıç JavaScript `264.500` byte gzip, CSS `41.019`
byte gzip, bootstrap `1.266` byte ve en büyük locale chunk `102.406` byte gzip;
23 locale chunk'ı ölçülmüştür. `CityDetail` ayrı lazy chunk olarak yaklaşık
`1,85 kB` gzip'tir. İlk exact-head benchmark denemesi örnek toplamadan önce
20 saniyelik yerel readiness bütçesine takılmış, boş bir porttaki temiz tekrar
yukarıdaki eşikleri geçmiştir; staging cold-start ölçümü bu nedenle zorunlu
kapı olarak korunur.

Static frontend bootstrap hata ekranı kullanıcı kontrollü hata/stack metnini
`innerHTML` ile göstermeyi bırakmıştır; güvenli DOM `textContent` düğümleriyle
genel hata mesajı verir ve bu sınır security regression suite'inde korunur.
CMS ve rehber zengin metni tek bir allowlist sanitizer kullanır; executable
SVG/MathML/handler/style yüzeyi ve yazar-kontrollü yeni-sekme opener davranışı
kaldırılmıştır.

Bu belge staging veya production deploy yetkisi değildir. Projenin `AGENTS.md` içindeki daha geniş NO-GO, review ve production güvenlik kapıları aynen geçerlidir.
