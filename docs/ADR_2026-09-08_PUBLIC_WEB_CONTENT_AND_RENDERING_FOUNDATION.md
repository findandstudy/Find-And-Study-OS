# ADR — Public Web Content ve Ölçekli Yayın Foundation

Tarih: 8 Eylül 2026
Durum: Yerel uygulama kabul edildi; runtime wiring ve deploy kapalı
Kapsam: Program, üniversite, destinasyon, CMS sayfası ve rehber içeriği

## Bağlam

Hedef; yaklaşık 2.000 üniversite, 200.000 program, 30 ülke/şehir ağı ve 23 dilde sürdürülebilir bir public web yüzeyi kurmaktır. Mevcut sistemde:

- `programs`, `universities`, `destinations` ve Website CMS üretim bilgisini taşır;
- program içeriklerinin İngilizce kanonik kaynağı ve 22 hedef dil için dayanıklı çeviri kuyruğu vardır;
- mevcut public web Vite SPA'dır, metadata istemci tarafında güncellenir ve sitemap yalnız sabit sayfaları kapsar;
- iki HTML prototip, hedef sayfa bileşenleri için görsel/UX referansıdır; toplu statik dosya üretim modeli değildir.

200.000 programı 23 dil ile çarparak her deploy sırasında milyonlarca sayfayı yeniden üretmek; build süresi, storage, cache invalidation ve crawl budget bakımından güvenilir değildir. Kaynak doğrulaması olmadan AI ile toplu yayın yapmak da scaled-content, yanlış bilgi ve marka güveni riski oluşturur.

## Karar

### 1. Rewrite ve ikinci bir CMS yok

Mevcut katalog ve Website CMS korunur. Yeni yapı bunları kopyalayan ayrı bir truth store değil, üstlerinde çalışan tenant-sınırlı bir yayın kontrol katmanıdır.

### 2. Kayıt, immutable revision ve yayın state'i ayrıdır

Her public entity+locale kombinasyonu bir `public_web_content_record` ile temsil edilir. İçerik değişiklikleri immutable revision olarak kaydedilir. Hangi revision'ın review/publish/index durumunda olduğu ayrı state'te tutulur; geçişler append-only receipt ile kanıtlanır.

### 3. Kaynak ve kritik gerçekler publish önkoşuludur

Program ücreti, para birimi, süre, intake ve requirement gibi kritik alanlar doğrulanmış ve süresi geçmemiş evidence olmadan publish edilemez. Kaynak kapsamı `COMPLETE`, kalite sonucu `PASS` ve maker-checker review zorunludur. AI-assisted revision, üretim receipt'i ve bağımsız insan review'u olmadan publish edilemez.

### 4. Publish ve index iki ayrı karardır

Bir içerik kontrollü önizleme amacıyla publish edilebilir fakat `noindex` kalabilir. Index için ayrıca:

- exact canonical path;
- locale için kullanılabilir source/published translation;
- SEO kontrolü;
- structured data kontrolü;
- güncel kritik fact evidence;
- açık index talebi

birlikte geçmelidir. Sistem varsayılan olarak `NOINDEX` ve rollout `off` çalışır.

### 5. URL kimliği ve redirect geçmişi korunur

- Program: `/{locale}/programs/{slug}-{id}`
- Üniversite: `/{locale}/universities/{slug}-{id}`
- Destinasyon: `/{locale}/destinations/{slug}`
- Rehber: `/{locale}/guides/{slug}-{id}`

Program ve üniversite URL'lerinde ID kalıcı kimliği korur. Slug değişiklikleri kaybolmaz; route alias ledger üzerinden 301/308 veya 410 kararı verilir. Aynı scope'ta aynı aktif path ve aynı kayda iki aktif canonical yol yasaktır.

### 6. 23 dil için eager çoğaltma yok

Kaynak dil İngilizcedir. Hedef dil kaydı yalnız çeviri hazır ve yayın adayı olduğunda oluşturulur. Boş veya stale çeviri locale'i indexlenmez; canonical İngilizce içerik veri katmanında korunur, fakat yanlış dilde sayfa yayınlanmış gibi gösterilmez.

### 7. Rendering kararı ölçümlü pilot sonrası

İlk foundation yeni framework seçmez. Sonraki pilotta bir program detay ve bir liste rotası için SSR/ISR/streaming alternatifleri aynı veri sözleşmesiyle ölçülür. Kabul edilmesi gereken minimum hedefler:

- cache-hit p95 TTFB ≤ 250 ms;
- origin p95 TTFB ≤ 800 ms;
- public API p95 ≤ 300 ms;
- LCP p75 ≤ 2,5 s, INP p75 ≤ 200 ms, CLS p75 ≤ 0,1;
- sitemap shard başına en fazla 50.000 URL;
- deploy sırasında tam katalog pre-render zorunluluğu olmaması;
- stale-while-revalidate ve hedefli entity+locale invalidation;
- rollback'in eski revision pointer'ına kontrollü dönüşle yapılabilmesi.

Framework veya hosting değişikliği ancak pilot ölçümü, operasyon maliyeti, rollback ve mevcut CMS uyumu birlikte onaylanırsa ayrı ADR ile yapılır.

## İlk uygulama dilimi

Migration `0109_public_web_content_foundation` şunları ekler:

- tenant+organization RLS sınırındaki public content kayıtları;
- immutable revision'lar ve boyut/hash kontrolleri;
- field-level kaynak evidence bağları ve freshness aralığı;
- fail-closed publication state machine;
- append-only publication receipt'leri;
- canonical/redirect/gone route alias geçmişi.

Migration `0110_catalog_entity_graph_foundation`, mevcut requirement tablolarını
yeniden üretmeden hedef domain sözleşmesindeki eksikleri tamamlar:

- lisans, kaynak türü, authority rank, hash ve freshness taşıyan katalog kaynakları;
- append-only provider/source kayıtları;
- kurum-campus ve program-intake kimliği;
- float yerine `amount_minor bigint + currency_code` kullanan kaynak-bağlı fiyat bileşenleri;
- canonical akademik gerçeği değiştirmeyen tenant+organization sınırlı ticari listing overlay'i.

Additive `0111–0113` hardening migrations şunları güvenceye alır:

- gelecekte yürürlüğe girecek kaynak kayıtlarının doğrulanabilmesi ve kaynak
  timestamp'lerinin entity üzerinde elle değiştirilememesi;
- mevcut tenant service-fee modelinin global katalog fiyatına kopyalanmaması;
- tenant listing'lerinin yalnız `DRAFT → IN_REVIEW → APPROVED → PUBLISHED`
  maker-checker koridorundan geçmesi ve doğrudan publish insert/update yapılamaması;
- public içerikte entity tipine göre tüm kritik fact key'lerinin güncel,
  doğrulanmış evidence ile kapsanması;
- İngilizce source / hedef dil published çeviri ayrımı;
- `INDEX` için hem SEO hem structured-data sonucunun `PASS` olması;
- review/publish kanıtının onay sonrasında değiştirilememesi.

0112'nin ilk yerel PostgreSQL çalıştırmasında, `NOINDEX` geçişinde henüz
doldurulmamış PL/pgSQL `record` alanına erişim testi fail-closed yakaladı. Daha
önce uygulanmış migration değiştirilmedi; 0113 scalar-variable trigger
düzeltmesiyle ledger ileri taşındı ve aynı gerçek PostgreSQL testi yeşile döndü.

Saf TypeScript sözleşmesi şunları ekler:

- 23 locale için deterministic slug ve canonical path;
- kritik fact evidence kapsamı;
- AI receipt, maker-checker, kalite, çeviri, SEO ve structured-data kapıları;
- `off | allowlist | all` fail-closed rollout kararı.

Bu dilimde public HTTP route, sitemap üretimi, admin UI, toplu backfill, provider çağrısı, role grant'i, staging veya production deploy'u yoktur.

## Sonraki dilimlerin sırası

1. Active-context ve capability kontrollü command/store adapter.
2. Admin Publication Center: source coverage, review, stale ve index queue.
3. Program ve üniversite için bounded read model + cursor pagination.
4. SSR/ISR pilotu ve ölçüm raporu.
5. Dinamik, shard edilmiş sitemap index ve hreflang/canonical doğrulaması.
6. Prototiplerin mevcut tasarım sistemiyle program/üniversite template'lerine dönüştürülmesi.
7. Related entity ve internal-link graph; kalite eşiği geçmeyen sayfalara link/index üretmeme.

## NO-GO sınırları

- Kaynaksız toplu AI publish yok.
- Program/üniversite tablolarına migration içinde sınırsız backfill yok.
- Production veya staging migration/deploy bu ADR'nin onayıyla yetkilendirilmiş sayılmaz.
- SSR/ISR framework seçimi performans kanıtından önce yapılmaz.
- Harici domain ağı karşılıklı yapay link şeması olarak kullanılmaz; bağlantı ancak editoryal ilişki ve kullanıcı değeriyle verilir.
