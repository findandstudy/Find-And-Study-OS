# Page Builder düzeltme raporu — 18 Eylül 2026

## Durum

**PARTIALLY READY — yerel uygulama tamamlandı; staging dağıtımı ve tam kabul kapısı açık.**

Kaynak brief: `Page Builder Fix Brief.docx`. Çalışma branch'i: `codex/public-web-foundation-20260908`; başlangıç commit'i: `938bb85b5900c29fec2342d04b320cfd8ee51eea`.

Bu görevde staging veya production dağıtımı, uzak veritabanı yazısı, içerik yayını, migration ekleme veya mevcut kullanıcı içeriğinin değiştirilmesi yapılmadı. Değişiklikler yerel çalışma ağacındadır. Brief'in “tüm regresyonlar yeşil” kapısı henüz geçilmediği için dağıtım yapılmadı.

## Uygulananlar

1. Public slug okuması sayısal admin CRUD'dan ayrıldı. `/api/website/pages/about` artık `about` değerini sayıya dönüştürmez; mevcut yayınlanmış sürüm okuyucusunu kullanır. Anonim çağrılar taslak veya sürümsüz sayfaları okuyamaz. Sayısal admin kayıt okumaları yetki kontrolünde kalır. İç hata ayrıntıları public yanıta sızmaz.
2. Home/About, mevcut blok renderer'ını kullanarak yayınlanmış blokları yükler. Boş, yayından kaldırılmış veya başarısız API cevabında önceki statik sayfa korunur. Yeniden yükleme güncel yayın sürümünü okur. Ana sayfanın “hakkımızda” içeriği Home sayfasına eklenen bloktur; zorunlu ortak Global Component yapılmadı.
3. Legacy `/about` slug'ı desteklenir; `/about` ziyaretçisi `/en/about` adresine gider. Çakışan `about` ve `/about` kayıtlarından rastgele seçim yapılmaz.
4. Katalog filtre tanımları ve seçenekleri mevcut katalogdan okunur. Programs: ülke/şehir/üniversite/seviye/dil; Universities: ülke/şehir/kurum türü; Cities: ülke. Destinations modelinde bölge taksonomisi olmadığı için hayalî seçenek eklenmez. Public görünürlük politikası korunur.
5. Ülke, şehir ve üniversite seçimleri ID ile saklanır. Modelde zaten metin enum olan seviye/dil/kurum türü mevcut kanonik değerlerini kullanır; yeni taksonomi üretilmez. Ülke etiketleri locale'e göre görüntülenir. Eski isim/kod eşleşmeleri normalize edilir; tekil eşleşmeyen legacy değer editörde uyarılır ve public filtreye uygulanmaz. Geçersiz açık ID ise sonuç döndürmez. Şehir ID'si ülkesine de bağlanır.
6. Grid 2/3/4 kolon, tek kolon list ve klavyeyle kaydırılabilen carousel önizleme/public renderer'a bağlandı. Mobilde yatay sayfa taşması test edildi.
7. Eski `limit=66` API/public okumasında güvenli biçimde 12'ye sınırlandırılır; editör 1–12 kullanır. API doğrulama mesajları önizlemede gösterilir.
8. Bağlanmamış veya pasif Global Block atlanır; boş section üretmez. Bağlanmamış blok varsa Publish öncesinde uyarı gösterilir.
9. Yayın sürümündeki SEO/OG/Twitter/robots alanları Home/About head'ine uygulanır. Eksik çeviri fallback'i noindex kalır. About team-members isteği ve statik fallback gövdesi korunur.

## Brief'ten farklı doğrulanan nedenler

- `about` endpoint hatasının nedeni eksik sütun değil, slug'ın sayısal CRUD ID'si gibi kullanılmasıdır. Bu nedenle migration eklenmedi.
- Staging'de salt okunur kontrolde destinations toplam/aktif kayıt sayısı `0/0` idi. Ülke kayıtları destinasyonmuş gibi yayınlanmadı. Bu alan içerik gerektirir; sorgu değişikliği olmayan veriyi oluşturamaz.
- Genel test paketi izole boş DB'de ek fixture/izin önkoşulları bekliyor. Ayrıca bazı kaynak-kod beklentileri mevcut kodla uyuşmuyor. Bu hataların Page Builder öncesi baseline üzerinde tümü yeniden çalıştırılmadı; dolayısıyla hepsinin önceden var olduğu iddia edilmez.

## Testler

| Doğrulama | Sonuç |
|---|---|
| API ve ön yüz TypeScript | PASS |
| API production build | PASS |
| Ön yüz production build, 23 locale parity, sitemap ve bundle budget | PASS |
| Page authoring + PostgreSQL authoring + SSR contract + PostgreSQL render | **24/24 PASS** |
| Yeni ön yüz Page Builder kontrolleri + mevcut public detail testleri | **15/15 PASS** |
| Derlenmiş uygulama, gerçek başsız Chrome, sentetik API cevapları | **14 senaryo PASS** |
| Mevcut geniş API/ön yüz regresyon paketi | **102 grup çalıştırıldı: 87 PASS, 15 FAIL** |
| Staging üzerinde yeni sürümle uçtan uca kabul | **Çalıştırılmadı — dağıtım kapısı açık** |

PostgreSQL testleri yalnız bu görev için oluşturulan boş PostgreSQL 16.15 kümesinde, `127.0.0.1:5433/fasos_apply_local` üzerinde koştu. Mevcut 124 migration uygulandı; yeni migration yok. Gerçek veri veya production dump kullanılmadı. Dış entegrasyonlar kapalıydı.

PostgreSQL senaryoları: anonim taslak 404, sayısal admin okuması 401, yayınlanmış `/about` 200, yayın sürümünün taslak düzenlemeden etkilenmemesi, tekrar yayın ve yayından kaldırma, eksik çeviri/noindex, bağlı olmayan/pasif global blok, filtre yetkileri/ID doğrulaması, canlı seçenekler ve eski limit. Mevcut ortak detay şablonunun kaydetme/yayınlama ve onay sınırları da bu testte geçti.

Tarayıcı senaryoları: EN 1440px, TR/AR 390px grid/list/carousel (9); yayınlanmış Home EN/TR/AR (3); 404 ve 503 durumunda statik Home/About ve `/about` yönlendirmesi (2). Head, noindex, hreflang yokluğu, RTL, klavye odağı ve viewport taşması doğrulandı. Bunlar **staging UAT değildir**; yerel derleme ve sentetik API kullanır.

### Yeşil olmayan 15 grup

- `test:inbox-ai-actions`: detail 500/200 uyuşmazlığı.
- `test:webhook-dedup`: fixture sonrasında uygun bildirim alıcısı yok.
- `test:inbox-lead-capture`: AI intake kapalı; test beklentisi uyuşmazlığı.
- `test:inbox-create-student-add-doc`: beklenen 200 yerine 500.
- `test:multi-account`: fixture audit FK ve simulated-mode beklentisi.
- `test:assignment-cascade`: fixture'da beklenen lost aşaması yok.
- `test:object-authz-signed-contract`: ayrı disposable mutation opt-in kapısı.
- `test:apikey-query`: `req.query` kaynak-kod assertion'ı.
- `test:staff-commission-payment`: fixture finans kaydı yazımında 500.
- `test:portal-automation`, `test:portal-auto-trigger`, `test:portal-manual-submit`, `test:portal`: ayrı disposable portal verification opt-in kapısı.
- `test:portal-trigger`: fixture audit FK / beklenti hataları.
- `test:portal-run-ownership`: mevcut kaynak-kod assertion'ı uyuşmuyor.

Sonuç listesi: `outputs/page-builder-regression-results.json`; tekil loglar: `outputs/page-builder-*.log`. Hataları gizlemek için testler devre dışı bırakılmadı, assertion'lar ilgisiz modüllerde gevşetilmedi. Tam yeşil test iddiası yoktur.

## Değişen tüm ürün/test dosyaları

| Dosya | Gerekçe |
|---|---|
| `artifacts/api-server/package.json` | Authoring test komutları |
| `artifacts/api-server/scripts/test-postgres-website-page-authoring.ts` | Gerçek HTTP/DB yayın, filtre, izin ve global blok testleri |
| `artifacts/api-server/scripts/test-public-catalog-render-contract.ts` | ID tabanlı filtre sözleşmesine güncellenen test |
| `artifacts/api-server/scripts/test-website-page-authoring.ts` | Legacy limit ve ID validasyonu |
| `artifacts/api-server/src/lib/publicCatalogRenderContract.ts` | SSR katalog layout seçenekleri |
| `artifacts/api-server/src/lib/publicCatalogRenderReadModel.ts` | Yayın okuyucusunun yeniden kullanımı, slug, filtre, global ve SEO projection |
| `artifacts/api-server/src/lib/websitePageAuthoring.ts` | Güvenli limit ve ID filtre parse |
| `artifacts/api-server/src/lib/websiteCatalogFilters.ts` | Yeni module-local canlı filtre tanımları ve eşleme |
| `artifacts/api-server/src/lib/websitePublishedPage.ts` | Yeni public yayınlanmış slug handler |
| `artifacts/api-server/src/routes/website.ts` | Public okuma ve admin filtre endpoint bağlantısı |
| `artifacts/edcons/package.json` | Yeni testleri build/test komutlarına bağlama |
| `artifacts/edcons/scripts/test-public-detail-templates.ts` | Ortak layout yardımcısını doğrulama |
| `artifacts/edcons/scripts/test-page-builder-templates.ts` | Yeni frontend sözleşme testleri |
| `artifacts/edcons/scripts/test-page-builder-browser.mjs` | Yeni derlenmiş uygulama tarayıcı testi |
| `artifacts/edcons/src/App.tsx` | Yalnız `/about` legacy yönlendirmesi |
| `artifacts/edcons/src/lib/website/catalogPresentation.ts` | Yeni local limit/parametre/layout yardımcıları |
| `artifacts/edcons/src/pages/admin/website/CatalogBlockFields.tsx` | Yeni canlı aramalı seçim alanları |
| `artifacts/edcons/src/pages/admin/website/CatalogBlockPreview.tsx` | Layout ve API hata mesajı |
| `artifacts/edcons/src/pages/admin/website/PageEditor.tsx` | Kaynağa bağlı filtreler ve Global Block publish uyarısı |
| `artifacts/edcons/src/pages/public/About.tsx` | Yayınlanmış bloklar ve statik fallback |
| `artifacts/edcons/src/pages/public/Home.tsx` | Yayınlanmış bloklar ve statik fallback |
| `artifacts/edcons/src/pages/public/PublicPage.tsx` | Mevcut renderer'ın yeniden kullanımı ve layout |
| `artifacts/edcons/src/pages/public/useTemplatePage.ts` | Yeni local yayın/SEO hook'u |
| `PAGE_BUILDER_FIX_REPORT_2026-09-18.md` | Bu teslim ve test raporu |
| `security/legacy-role-gate-registry.json` | İncelenen iki website route eklemesi için hash ve sayım yenilemesi; yetki sınıflandırması değişmedi |

Yerel yardımcı çıktı: `outputs/page-builder-regressions.mjs` tüm mevcut test gruplarını ilk hatada durmadan çalıştırdı. `outputs/` içindeki önceki çıktı/patch dosyalarına dokunulmadı.

## Korunan kapsam

CRM, öğrenci, ödeme/finans, mesajlaşma, auth, Course Finder iş mantığı, AI Content Assistant, diğer editör blokları, CI/CD, production konfigürasyonu ve database modelleri değiştirilmedi. Mevcut public katalog politikası, sayfa sürümleri, detay şablonu onay akışı, canonical read-model ve renderer yeniden kullanıldı. Yeni paralel CMS veya taksonomi kurulmadı.

## Açık kalanlar / backlog

1. Geniş test paketinin fixture/opt-in gereksinimlerini tamamlamak ve kalan modül testlerini ayrıca incelemek; brief'in tüm-regresyonlar-yeşil kapısı kapanmadı.
2. Sonrasında staging dağıtımı ve gerçek About id=2 / Home id=1 ile yayın, sürüm geri yükleme, admin navigasyon/console ve gerçek katalog üzerinden UAT. Kullanıcı sayfaları bu görevde yayınlanmadı.
3. Destinations ve gerekiyorsa team-members için onaylı gerçek içerik girişi.
4. Brief'teki **önerilen** ek program filtreleri tuition range ve intake bu dilime eklenmedi. Ücret aralığında para birimi ve doğrulanmış ücret kaynağı; intake'te aktif/yayınlanabilir dönem seçimi açıkça tanımlanarak genişletilmeli. Mevcut ücret/intake gerçeği değiştirilmedi.

Migration: **0 yeni**. Production: **dokunulmadı**. Staging: **önceki sürümde, bu değişiklikler dağıtılmadı**.

## Sonraki staging dağıtım onayı — 18 Eylül 2026

Kullanıcı test gruplarındaki açık bulgular anlatıldıktan sonra staging dağıtımını ayrıca onayladı. Bu onay production dağıtımı veya 15 başarısız grubun kapandığı anlamına gelmez. Dağıtım öncesi bağımsız dar kapsamlı incelemede kritik auth, taslak sızıntısı veya render engeli bulunmadı. Eşleşmeyen legacy metin filtrelerini yok sayma davranışı kaynak brief'in açık talebidir ve korundu.

Staging preflight: kaynak `938bb85b5900c29fec2342d04b320cfd8ee51eea`, temiz tracked çalışma ağacı; release `staging-20260918T084658Z-938bb85b5900`; healthy, restart 0; yaklaşık 55 GB boş disk. Yeni release için checksum'lı backup/izole restore, exact-source build ve kod rollback kontrolü uygulanacak. Gerçek dağıtım ve smoke sonuçları ayrı release kaydında tutulacak; bu paragraf dağıtımın tamamlandığı iddiası değildir.
