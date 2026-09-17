# Detay şablonları ve staging UAT — 17 Eylül 2026

Branch: `codex/public-web-foundation-20260908`. Base HEAD: `02f8399375ebdc548acaea5960c43eb9def8c5ec`.
Değişiklikler yereldir; bu çalışmada commit/push/deploy, production değişikliği veya gerçek içerik yayını yapılmadı. Önceki yerel Pages çalışmaları korundu.

## Completed phases

1. **Ortak detay şablonlarının Pages yönetimi — yerel PASS.** Country/Destination, City, University ve Program için bölüm görünürlüğü ve isteğe bağlı bölümlerin sırası yönetilir. Kimlik/hero, navigasyon ve ana bilgiler gizlenemez veya yerinden oynatılamaz. Bu bir serbest HTML/Elementor editörü değildir. Veri alanı, fiyat, tarih, SEO, başvuru kuralı veya URL şablona kopyalanmaz.
2. **Onaylı toplu şablon yayını — yerel PASS.** En fazla dört ortak şablon tek transaction içinde yayınlanır. Onaycı yazar/oluşturucudan farklı bir admin olmalı, doğrudan geçerli oturum kullanmalı; API token ve impersonation reddedilir. Onay tam sayfa ID + güncellenme zamanı + layout SHA-256 özetiyle bağlıdır. Değişmiş taslak, tekrar yayın ve eksik batch üyesi reddedilir. Hata tüm batch'i geri alır. Var olan page version snapshot'ı onaycı/yazar/özet kanıtını tutar. Legacy CRUD ile layout kaydı/bloku/sürümünü değiştirme veya yayınlama engellenir.
3. **Public uygulama ve SSR — yerel PASS.** Dört mevcut React detay bileşeni kullanılır. SSR ve SPA aynı yayınlanmış bölüm politikasını uygular. Gizlenen bölümün anchor linki kaldırılır. SSR ilk görünüm için güvenli layout JSON'u taşır. Taslak son yayınlanmış snapshot'ı değiştirmez. Yayında yalnız etkilenen detay türünün render cache'i temizlenir; sitemap/index/translation kuralları değiştirilmez. Layout kayıtları NOINDEX ve rezerv dahili adrestedir.
4. **Gerçek staging testi — çalıştırıldı, tam kabul FAIL.** Aşağıdaki mevcut staging hataları bulundu ve yerelde düzeltildi. Yeni kod staging'e taşınmadığı için staging yeniden kabulü henüz PASS değildir.

## Staging bulguları

17 Eylül public health: HTTP200, dbConnected=true, release `staging-20260916T075832Z-02f8399375eb`.

- Gerçek program: A-Level145793; gerçek üniversite: Abbey DLD Colleges1563.
- 23 locale program API kontrolü PASS; gerçek fiyat/dönem boşluğu korunuyor, fallback locale indexable=false.
- Olmayan program/üniversite/şehir API'leri404: PASS.
- EN/TR/AR ×390/768/1440 tarayıcı matrisi:9 FAIL. Sebepler: program `#requirements` hedefi eksik;768px menü taşması; RTL skip-to-content bağlantısının ekran dışı konumu yaklaşık10.000px yatay taşma oluşturuyor.
- İki ek tanısal test İngilizce768px ve Arapça1440px'te üniversite sayfasını da kontrol ederek ortak header/skip-link kaynağını doğruladı.
- Program requirements anchor'ı önceki yerel değişiklikte düzeltilmişti; ortak public header breakpoint/marka daralma davranışı ve skip-link bu çalışmada düzeltildi. Global tasarım mimarisi veya dashboard değiştirilmedi.
- `/api/public/destinations` boş liste verdi. Onaylanmış gerçek ülke/şehir örneği olmadan bu kategorilerin gerçek içerikli UAT'si tamamlandı sayılmaz. İçerik veya onay uydurulmadı.

## Tests

| Test | Sonuç |
| --- | --- |
| `test-detail-layout-contract.ts` |4 PASS: dört tür, mandatory/fact injection, bölüm sırası, browser/server sözleşme eşliği, SSR/noindex/RTL |
| `test-public-catalog-render-contract.ts` |15 PASS |
| `test-website-page-authoring.ts` |6 PASS |
| `test-public-detail-templates.ts` |11 PASS |
| `test-postgres-website-page-authoring.ts` |PASS: gerçek HTTP/DB, rol reddi, oturum, impersonation, self-approval, optimistic conflict, legacy bypass, snapshot, replay ve batch rollback |
| `test-postgres-public-catalog-render.ts` |PASS: mevcut projection/coalescing ve yeni tür-bazlı cache invalidation |
| Pages mock-browser suite |5 PASS |
| Gerçek public staging verileriyle YEREL React bileşenleri |12 PASS: program/üniversite ×EN/AR ×390/768/1440; taşma, anchor, skip-link klavye odağı, Apply linki |
| Mevcut staging suite |2 PASS /9 FAIL — yeni yerel kodun kabulüyle karıştırılmamalı |
| API/Edcons TypeScript |PASS |
| API ve Vite production build |PASS; önceden mevcut sourcemap/chunk-size uyarıları sürüyor |
| Bundle budget |PASS: initial JS264624 gzip byte, CSS41372;23 locale chunk |
| i18n key/placeholder parity |PASS:23 locale |
| Tenant writer inventory |PASS:195 dosya/2567 surface; yeni dış allowlist yok |
| Legacy route inventory |PASS:78 dosya/858 registration; sınıflandırmalar değiştirilmedi |
| `git diff --check` |PASS |

Browser testleri: `tests/page-authoring.config.ts`. Gerçek veri replay için `PUBLIC_LAYOUT_REAL_DATA=true`; yalnız public GET kullanır. Uzak staging testi `tests/staging-public.config.ts`. Hiçbir öğrenci, başvuru, mesaj veya form submit edilmez. PostgreSQL testleri yalnız `127.0.0.1:5433/fasos_apply_local`, dış entegrasyonlar kapalı, sentetik fixture temizliğiyle çalışır.

Test sonunda bu tur başlatılan yerel PostgreSQL kümesi durduruldu; dosyaları silinmedi. Son aggregate kontrolünde pages/blocks/sessions/universities/programs sıfırdı, versions tablosunda bir kayıt kaldı. Bu kaydın bu tura ait olduğu doğrulanmadığı için toplu temizlik yapılmadı; tam boş veritabanı iddiası yoktur.

## Changed files — bu tur

- `artifacts/api-server/src/lib/websiteDetailLayoutContract.ts` ve `artifacts/edcons/src/lib/website/detailLayoutContract.ts`: iki ayrı TS rootDir için modül-yerel, byte-eşliği testli presentation sözleşmesi.
- `artifacts/api-server/src/lib/websiteDetailLayouts.ts`: mevcut page/block/version tablolarından taslak ve yayınlanmış şablon okuma; digest.
- `artifacts/api-server/src/routes/website.ts`: admin taslak yönetimi, insan onaylı atomik template batch, legacy bypass koruması; önceki taslak/preview uçları korunur.
- `artifacts/api-server/src/routes/public-web.ts`: facts içermeyen, no-store public layout okuma.
- `artifacts/api-server/src/lib/publicCatalogRenderReadModel.ts`: yayınlanmış layout projection ve hedefli invalidation.
- `artifacts/api-server/src/lib/publicCatalogRenderContract.ts`: dahili adres koruması, SSR sıra/görünürlük ve güvenli initial layout.
- `artifacts/edcons/src/pages/admin/website/DetailTemplates.tsx`, `Pages.tsx`: yönetim, taslak, açık review ve toplu onay UI.
- `artifacts/edcons/src/pages/public/DetailLayout.tsx`: mevcut bölümleri aynı React bileşenleriyle düzenleme; güvenli varsayılan; broken-anchor temizliği.
- `artifacts/edcons/src/pages/public/{CountryDetail,CityDetail,UniversityDetail,ProgramDetail}.tsx`: section referanslarıyla wrapper entegrasyonu; factual ve Apply hesapları korunur.
- `artifacts/edcons/src/components/layout/PublicLayout.tsx`: gerçek UAT ile bulunan tablet header/RTL skip-link düzeltmesi; sadece ortak public kabuk.
- `artifacts/api-server/scripts/test-detail-layout-contract.ts`, `test-public-catalog-render-contract.ts`, `test-postgres-public-catalog-render.ts`, `test-postgres-website-page-authoring.ts`: sözleşme, gerçek DB ve SSR kanıtları.
- `artifacts/edcons/tests/authoring/{pages,public-layout}.spec.ts`, `tests/fixtures/page-authoring.tsx`: yönetim ve gerçek veriyi yerel bileşenlerde test etme.
- `artifacts/edcons/tests/staging-public.config.ts`, `tests/staging-public/detail.spec.ts`: salt-okunur gerçek staging suite.
- `artifacts/api-server/package.json`: yeni pure test mevcut render test komutuna eklendi; CI workflow değişmedi.
- `security/legacy-role-gate-registry.json`: yalnız iki değişen route dosyasının hash/count ve toplamları; guard/classification gevşetilmedi.

Önceki turdan kalan diğer dosyalar `PAGES_AUTHORING_LOCAL_2026-09-16.md` içinde listelidir; kullanıcıya ait patch/output dosyaları korunmuştur.

## Reused architecture / new local additions

Website pages, blocks, immutable versions; mevcut admin rol ve session kontrolü; canonical catalogue/read-model; SSR; React public components; React Query; mevcut SEO/JSON-LD/locale/route sistemleri kullanıldı. Yeni local parçalar yalnız layout contract/reader/wrapper/editor ve testlerdir. Migration, entity model, yeni CMS, AI pipeline, worker veya provider framework yoktur.

## Backward compatibility / scope verification

Program/University/Country/City modelleri, public URL'ler, katalog API payload'ları, Course Finder, Apply ve formlar korunur. Auth kaynak kodu, payment, CRM, CI/CD, deployment ve production config değişmedi. Yeni session kontrolü mevcut auth fonksiyonunu kullanır. Ortak PublicLayout doğrudan detay UAT hatası nedeniyle düzeltildi; global design-system refactor değildir.

## Blocked / deferred

- **Bu batch yalnız ortak layout yayınıdır.** Governed katalog içeriğinin toplu review/publish/index operasyonu, mevcut Publication Center `DEFAULT_UNWIRED` sınırından çıkarılmadı; signed context/executor/capability ve editoryal evidence gerektirir. Bu işlev tamamlandı diye sunulmaz.
- Yeni yerel kodun exact-head CI/review ve staging adoption'u, ardından aynı staging testinin tekrarı gerekir. Bu turda remote push/deploy yapılmadı.
- Gerçek ülke/şehir içeriklerinin yetkili editoryal onayı ve yayını gerekir. Ek metin, çeviri, medya/harici veriler uydurulmaz.
- Tam form submit UAT, Safari/Firefox, assistive-technology denetimi, yüksek hacim ve alan Core Web Vitals bu testlerin kapsamı değildir.
- Daha ayrıntılı iç-section düzenleme/serbest component tasarımı ve admin kopyalarının tüm dillere editoryal çevirisi backlog'dur.

## Remaining risks / release status

Legacy Pages yönetimi global/privileged quarantine sınırındadır; multi-tenant self-service veya governed content approval sertifikası değildir. Taslak geri alma, önceki görünüm ayarlarını yeni taslak olarak kaydedip farklı admin onayıyla yayınlama şeklindedir. Görünüm değişiklikleri ilgili türde bütün sayfalara uygulanır; UI bunu onaydan önce açıkça bildirir.

**PARTIALLY READY**: ortak template yönetimi ve template-only onaylı batch yerel kanıtlı; kapsamlı yeni-release staging UAT, gerçek ülke/şehir ve governed content bulk publication henüz tamamlanmış değildir. Production değişmedi.
