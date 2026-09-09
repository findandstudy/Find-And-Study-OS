# ADR — Public Web Content ve Ölçekli Yayın Foundation

Tarih: 8 Eylül 2026
Durum: Foundation ve varsayılan-kapalı SSR/ISR pilotu yerelde uygulandı; deploy kapalı
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

Bu foundation diliminde toplu backfill, provider çağrısı, role grant'i, staging
veya production deploy'u yoktur. Sonraki yerel dilimlerde command/store adapter,
Publication Center ve bounded public read modelleri eklendi.

## Yerel SSR/ISR pilotu

Yeni bir framework veya ikinci runtime eklenmeden mevcut modüler monolit üzerinde,
program liste, program detay, üniversite detay, destinasyon detay, rehber/makale
ve genel CMS page
detay rotaları için on-demand semantic HTML pilotu
uygulandı. Pilot aşağıdaki güvenlik ve ölçek sınırlarını taşır:

- `PUBLIC_WEB_RENDER_MODE=off|allowlist|all`; eksik veya hatalı ayar `off` olur;
- allowlist yalnız tam eşleşen, tanınan localized program/üniversite/destinasyon/rehber/CMS page rotalarını kabul eder;
- ilk liste en fazla 12 kayıt okur; cache en fazla 500 anahtar tutar;
- 5 dakika fresh, 1 saat stale-while-revalidate penceresi ve aynı anahtar için
  in-flight sorgu birleştirmesi kullanılır;
- slug drift'i kanonik adrese `308` ile yönlendirilir;
- HTML ve JSON-LD değerleri escape edilir, bütün script'ler istek-bazlı CSP nonce
  taşır;
- semantic shell'in navigasyon ve fact etiketleri 23 locale için sunucu tarafında
  yerelleştirilir; hydration öncesinde İngilizce etiket sızıntısı olmaz;
- cevap `X-Public-Render`, `X-Public-Render-Cache` ve `Server-Timing` ile
  ölçülebilir; render hatasında mevcut SPA güvenli fallback olarak kalır;
- tenant-bound publication/index projection bağlanana kadar program, üniversite ve destinasyon
  detayları bilinçli olarak `noindex` kalır.

Saf sözleşme testleri destinasyon dilimiyle `6/6`, eşzamanlı cold-read coalescing ve sonraki cache-hit'i
gerçek disposable PostgreSQL üzerinde doğrulayan entegrasyon testi `1/1` geçmiştir.
API/Edcons typecheck ve production build yeşildir. Pilot hiçbir staging veya
production runtime'ında etkinleştirilmemiştir.

## Dinamik keşif ve metadata dilimi

Sitemap ile render rollout'u birbirinden ayrıldı. `PUBLIC_WEB_SITEMAP_MODE`
varsayılan olarak `off` çalışır; `static` yalnız altı editoryal statik sayfa
kümesini, `published` ise ek olarak exact tenant+organization kapsamındaki
`PUBLISHED + INDEX` kayıtlarını açar. Hatalı site URL'si, eksik UUID kapsamı veya
bilinmeyen mode fail-closed olarak `off` olur.

- public template'i mevcut olan program, üniversite ve destinasyon kayıtlarını
  locale başına 5.000 URL'lik shard'lara böler; özel CMS sayfası ve makale
  shard'ları kendi gerçek public route/read modeli tamamlanmadan açılmaz;
- 23 dildeki alt sayfalar yalnız gerçekten yayınlanmış/indexlenmiş kardeş
  kayıtlar için karşılıklı hreflang üretir; bulunmayan çeviri uydurulmaz;
- İngilizce varyant varsa `x-default` olur;
- sitemap DB sorguları `BEGIN READ ONLY`, 8 saniye statement timeout ve request
  scope'a bağlı RLS ayarlarıyla çalışır;
- ayrıntı API'si ve SSR shell aynı publication projection'ından canonical,
  index ve alternate path bilgisini alır;
- programlarda İngilizce dışı URL, ayrıca ilgili `program_translations` kaydı
  gerçekten `published` değilse; üniversitelerde ise localized delivery read
  modeli hazır değilse indexlenmez;
- destinasyonlar yeni `/{locale}/destinations/{slug}` kanoniğini kullanır;
  eski `/{locale}/countries/{slug}` ayrıntı yolu SSR açıkken `308` ile kanoniğe
  gider. Localized destinasyon revision delivery modeli hazır olana kadar yalnız
  İngilizce yayın/index projection'ı sitemap ve hreflang'e alınır;
- rehberler `/{locale}/guides/{slug}-{id}` kanoniğini kullanır. Public blog
  listesi legacy `blog_posts` yerine admin Website Blog'un yönettiği
  `website_blog_posts` kaynağını okur; yalnız `published`, zamanı gelmiş ve
  istenen dilde eksiksiz title+body taşıyan kayıtları bounded keyset listesine
  alır. Rehber body istemcide izinli HTML listesiyle sanitize edilir, SSR ise
  markup'ı güvenli metne dönüştürür;
- genel CMS sayfaları `/{locale}/{slug}` kanoniğini kullanır. `login`, `admin`,
  `programs`, `guides` ve diğer sistem namespace'leri merkezi reserved-route
  registry ile CMS tarafından gölgelenemez. Public okuma yalnız son yayımlanmış
  `website_page_versions` snapshot'ını kullanır; draft blok/meta/çeviri değişikliği
  sayfayı tekrar draft durumuna alır. En fazla 64 blok ve 1 MiB snapshot kabul
  edilir; bilinmeyen/global referans blokları public projection'a alınmaz ve zengin
  metin istemcide allowlist sanitizer, SSR'da güvenli düz metin olarak işlenir;
- internal-link graph program detayında önce aynı üniversite, alan, derece ve ülke sinyalleriyle
  en fazla 32 bounded aday üretir; yalnız governed publication state'i gerçekten
  `PUBLISHED + INDEX` olan ve istenen dilde teslim edilebilen ilk 8 program API
  ve SSR linkine dönüşür. `PUBLIC_WEB_INTERNAL_LINK_MODE` bilinmeyen değerlerde
  `off` olur: mevcut SPA'nın legacy related davranışı korunur, yeni SSR graph
  üretilmez. `published` modunda discovery scope geçersizse graph fail-closed
  olarak boş kalır;
- üniversite detayındaki program kartları ile destinasyon detayındaki üniversite
  ve program kartları aynı kapıda toplu, en fazla 64 ID'lik RLS-scope sorgularıyla
  doğrulanır; N+1 publication sorgusu üretilmez;
- entity SEO projection'ı 5 dakika ve en fazla 5.000 anahtarla cache edilir;
  aynı cold key sorguları birleştirilir ve hedefli invalidation yüzeyi sağlanır;
- migration `0119_public_web_discovery_indexes` yalnız partial lookup indeksi
  ekler; içerik veya rollout state'i değiştirmez.

Saf keşif sözleşmesi `5/5`, gerçek disposable PostgreSQL RLS/NOINDEX testi
`1/1` geçmiştir. Yerel ledger `120/120`, API ve Edcons production build'i
yeşildir. Staging/production config ve veri state'i değiştirilmemiştir.

## Yerel ölçek ve HTTP ölçümü

Hedef katalog kardinalitesi 200.000 program ve 2.000 üniversitenin 23 locale
varyantı olarak simüle edildi. Sitemap index 4.646.000 olası URL'yi tek build
artifact'ına dökmeden 944 shard'a böldü. En ağır 5.000 URL / 23 hreflang shard'ı
yerel testte 134 ms'de üretildi ve 50 MiB açılmış XML sınırının altında kaldı.

Disposable PostgreSQL 16 ve yerel production build ile yapılan HTTP pilotunda:

- 23 cold locale render örneği: origin p95 `25,3 ms`;
- 100 istek / concurrency 10: cache-hit p95 `25,2 ms`;
- 40 public course-finder isteği / concurrency 5: API p95 `18,2 ms`;
- dinamik statik sitemap: HTTP 200, `application/xml`, `nosniff`, 138 localized
  URL ve karşılıklı hreflang.

Bu değerler yerel sentetik gate kanıtıdır; gerçek kullanıcı Core Web Vitals,
edge-cache, bot crawl ve staging yük sonucu değildir. Staging rollout veya
production kapasite iddiası oluşturmaz.

## Sonraki dilimlerin sırası

1. Active-context ve capability kontrollü command/store adapter. **Yerelde tamamlandı.**
2. Admin Publication Center: source coverage, review, stale ve index queue. **Yerelde tamamlandı.**
3. Program ve üniversite için bounded read model + cursor pagination. **Yerelde tamamlandı.**
4. SSR/ISR pilotu ve ölçüm raporu. **Varsayılan-kapalı pilot yerelde tamamlandı; gerçek trafik ölçümü bekliyor.**
5. Dinamik, shard edilmiş sitemap index ve hreflang/canonical doğrulaması. **Yerelde tamamlandı.**
6. Destinasyon canonical API/SSR/discovery katmanı. **İngilizce kaynak içerik için yerelde tamamlandı; localized delivery bekliyor.**
7. Website Blog rehber listesi, detay API/SSR, canonical/hreflang ve sitemap. **Yerelde tamamlandı.**
8. Genel CMS page delivery ve reserved-route registry. **Yerelde tamamlandı.**
9. Prototiplerin mevcut tasarım sistemiyle program/üniversite template'lerine dönüştürülmesi.
10. Related entity ve internal-link graph; kalite eşiği geçmeyen sayfalara link/index üretmeme. **Program, üniversite ve destinasyon graph dilimleri yerelde tamamlandı; rehber graph'ı bekliyor.**

## NO-GO sınırları

- Kaynaksız toplu AI publish yok.
- Program/üniversite tablolarına migration içinde sınırsız backfill yok.
- Production veya staging migration/deploy bu ADR'nin onayıyla yetkilendirilmiş sayılmaz.
- SSR/ISR framework seçimi performans kanıtından önce yapılmaz.
- Harici domain ağı karşılıklı yapay link şeması olarak kullanılmaz; bağlantı ancak editoryal ilişki ve kullanıcı değeriyle verilir.
