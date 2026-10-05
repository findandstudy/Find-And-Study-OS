# Pages authoring — local implementation, 16 September 2026

Base: `02f8399375ebdc548acaea5960c43eb9def8c5ec`.
Branch: `codex/public-web-foundation-20260908`.
This is a **partial implementation** of the remaining Pages work, not a complete automated publishing system. No commit, push, staging adoption, production deployment, migration, grant or content publication was performed in this task.

## Completed phases

1. Explicit page-draft creation: blank or one of four live catalogue starters; source locale and country/city filters; atomic page + hero + catalogue block creation. Always DRAFT/NOINDEX, no factual duplication. Existing page CRUD remains compatible through a separate additive `/website/pages/drafts` endpoint.
2. Real catalogue preview: admin-only, no-store, bounded 1–12 cards, same canonical public projection as published CMS blocks. Debounced/cancellable requests, refresh, error/retry/empty states. No preview results are written into block content.
3. Editor usability: source locale replaces hardcoded English; responsive panel navigation, keyboard-accessible block selection, labelled tools, RTL preview. Fixed the ProgramDetail requirements anchor to point to requirements rather than the description.
4. Local verification: pure regressions, browser fixture and real disposable PostgreSQL HTTP tests; frontend/API builds and bundle budget.

## Changed files

- `artifacts/api-server/src/lib/websitePageAuthoring.ts`: strict module-local creation/preview input validation and existing-block starters.
- `artifacts/api-server/src/lib/publicCatalogRenderReadModel.ts`: exports the existing bounded catalogue projection for reuse, without changing public selection policy.
- `artifacts/api-server/src/routes/website.ts`: additive guarded draft/preview routes; transaction, server-derived author, safe conflict/error responses. Existing CRUD and publication operations retained.
- `artifacts/api-server/package.json`: adds pure authoring tests to the existing public-render test command; no workflow modification.
- `artifacts/api-server/scripts/test-website-page-authoring.ts`: input, publication/fact injection, locale, limits, route wiring contracts.
- `artifacts/api-server/scripts/test-postgres-website-page-authoring.ts`: local-only HTTP/DB test for auth denial, duplicate race, draft/noindex, canonical fresh preview and no publication.
- `artifacts/edcons/src/pages/admin/website/Pages.tsx`: explicit creation dialog, source language/starters, recoverable errors; removes implicit write-on-read empty-list seeding.
- `artifacts/edcons/src/pages/admin/website/CatalogBlockPreview.tsx`: live bounded preview, no content mutation.
- `artifacts/edcons/src/pages/admin/website/PageEditor.tsx`: preview wiring, source language and mobile/keyboard/RTL improvements.
- `artifacts/edcons/src/pages/public/ProgramDetail.tsx`: requirements anchor correction; Apply link unchanged.
- `artifacts/edcons/scripts/test-public-detail-templates.ts`: current preview regression assertions.
- `artifacts/edcons/tests/authoring/pages.spec.ts`, `tests/fixtures/page-authoring.html`, `tests/fixtures/page-authoring.tsx`, `tests/page-authoring.config.ts`: isolated real-browser tests with mocked HTTP; never production/staging login or writes.
- `security/legacy-role-gate-registry.json`: only website route hash and two additive registration counts; quarantine and role policy unchanged.

## Reused architecture / new local additions

Reuses website pages, page blocks, existing immutable publication versions, public catalogue query policy and projection, React Query, existing UI controls, 23-locale catalogue, route registry, cache invalidation and admin guards. New local pieces are strict authoring input parsing, a preview component and tests. No parallel CMS, runtime AI, provider abstraction or entity model was added.

## Tests

- Pure public rendering/routes/localization/discovery/detail/authoring: **48 PASS**.
- Disposable PostgreSQL public-render + new authoring HTTP integration: **2 PASS**. Initial authoring fixture lacked the `Private` university type required by the public policy; fixture corrected, policy was not weakened.
- Browser: **4 PASS** — creation, live preview/mobile/RTL, recoverable preview error and duplicate-address input retention.
- API and Edcons TypeScript: **PASS**.
- API production build and Vite production build: **PASS**. Existing sourcemap/chunk-size warnings remain non-fatal.
- Bundle budget: **PASS**, initial JS 264497 gzip bytes, CSS 41199 bytes, 23 locale chunks.
- 23-language key/placeholder parity: **PASS**.
- Tenant writer inventory and legacy role inventory: **PASS**, no new allowlist or guard weakening.
- Public-web CI wiring contracts: **4 PASS**; CI workflows unchanged.
- `git diff --check`: **PASS**.

Browser tests use `tests/page-authoring.config.ts`, a local-only Vite server at `127.0.0.1:25198`, and mocked API responses. They prove UI behaviour, **not** full staging UAT. The PostgreSQL test independently exercises real routes and DB writes at exact `127.0.0.1:5433/fasos_apply_local` with `ALLOW_LIVE_INTEGRATIONS=false`. Post-test pages/blocks/universities/programs/users/applications counts were all zero; the isolated cluster was stopped. No real records were deleted.

## Backward compatibility / scope verification

Existing page CRUD, public routes, catalogue policy, detail factual projections, Apply flow and publication/version routes retained. No changes to auth, CRM, payment, Course Finder logic, other service contracts, migrations, CI/CD or deployment configuration. Registry changes only acknowledge the two guarded routes. This does not certify full Apply workflow UAT.

## Blocked items

- Automated bulk publication must not bypass the existing Publication Center's `DEFAULT_UNWIRED` / `mutationsEnabled=false` boundary, signed context, executor grant and approval requirements. This task did not change authorization or grant activation.
- Approved real-city content, media provenance and editorial/translation review cannot be invented or silently approved by the coding agent. No public content was published.

## Deferred / still incomplete

- Shared, versioned Country/City/University/Program **detail** layout management from Pages. The four new starters are catalogue landing pages; they do not replace the existing detail components or claim this feature is complete.
- Operator-facing governed batch creation/approval/publishing workflow.
- Representative real-content staging UAT, all supported device/browser combinations, Apply/forms, runtime invalidation/SEO rollout and realistic performance measurements for this new version.
- External visa/ranking/housing/cost data remains optional, conditional and source-dependent.

## Remaining risks / release status

Legacy CMS routes retain their existing privileged/global quarantine boundary; this work does not certify tenant-safe external self-service. Admin authoring copy remains in the existing English UI style; full authoring-copy translation is not completed. No new high-volume or field Core Web Vitals claim is made.

**PARTIALLY READY** for the full requested Pages automation scope. The completed draft/preview slice has local evidence; these new changes are not yet on staging. Production remains untouched.

---

## 5 Ekim 2026 — Pages öncelikleri, yerel uygulama eki

Bu ek yalnız bu turdaki değişiklikleri anlatır; yukarıdaki 16 Eylül testleri ve DB kanıtları bu turda yeniden çalıştırılmış sayılmaz.

- Çalışma deposu: `Find-And-Study-OS-Public-Detail-Release`.
- Branch: `codex/public-detail-staging-20260919`.
- Başlangıç commit'i: `d85d75f3fcc8c50d09a24ee348e30fc972d2a933`; başlangıç çalışma ağacı temizdi.
- Yetki: kullanıcının Pages önceliklerini uygulama isteği. Bu turda commit, push, merge, staging/production deploy, gerçek içerik yayını veya canlı veri yazımı yapılmadı.

### Completed phases

1. **Gerçek detay bileşenleriyle taslak önizleme — PASS.** Ülke, şehir, üniversite ve program editöründeki yerel önizleme; mevcut public uçlarından güncel katalog bilgilerini, yayınlanmış ortak düzeni ve yalnız bellekteki editoryal taslağı birleştirir. Ücret/isim/intake/deadline için yeni kaynak veya duplicate kayıt oluşturulmaz. Kayıt, ülke eşlemesi, dil ve kanonik adres uyuşmazsa önizleme açılmaz.
2. **Önizlemenin güvenlik sınırı — PASS.** Yalnız GET, cookie gönderilmeyen ve yönlendirme kabul etmeyen süre/boyut sınırlı okumalar; scriptsiz sandbox; ağ isteği yapan etkileşimlerin kapatılması; dış/özel görsellerin güvenli boş gösterimi; başlık bağlantılarının sadece önizleme içinde kaydırılması. Taslak için erişilebilir bir public URL veya kalıcı tarayıcı kaydı yaratılmaz. Yönetim ekranının dili, SEO başlıkları ve adresi değiştirilmez.
3. **Pages düzenleme ve kayıt güvenliği — PASS, eski tarayıcı geçmiş istisnasıyla.** Sayfa kimliği değişince ayrı editör oturumu; eski kayıt cevabının yeni düzenlemeleri temizlememesi; blok kaydının ayrı SEO değişikliklerini temizlememesi; arka plan okuma hatasında düzenlemelerin ve yeniden deneme olanağının korunması. Ortak şablonlarda başka şablon kaydedilse bile düzenlemenin ilk sürüm bağı korunur. Kayıt sürerken çıkış/yükleme işlemleri engellenir.
4. **Türkçe/İngilizce kullanım ve katalog blokları — PASS.** Pages, sayfa editörü, ortak şablonlar ve katalog bloklarındaki başlıca kontrol/uyarı metinleri yerel TR/EN karşılıklarını kullanır. Bozuk/ölçüsüz katalog yanıtları ekranı çökertmez; güvenli uyarı ve yeniden deneme sunulur. Katalogdaki gerçek adlar, kullanıcı içeriği ve mevcut 23 içerik dili değiştirilmez. Diğer yönetim dillerinde bu yeni yerel metinler İngilizceye döner.
5. **Responsive/RTL, uyumluluk ve performans kontrolü — PASS.** Dört sayfa türü gerçek katalog yanıtlarıyla EN/AR ve 390/768/1440 genişliklerinde yerelde test edildi. Taslak önizleme 1280/768/375 gerçek iç genişliklerini koruyarak mevcut alana ölçeklenir; telefonda mobil görünümle başlar. Son görsel kontrolde bulunan mobil kırpılma giderildi, Arapça ekran görüntüsü yeniden incelendi. Önizleme için gereken render paketi yalnız editörde ihtiyaç olduğunda yüklenir; public ilk yükleme bütçesine eklenmez.

### Changed files

Aşağıdaki yollar depo köküne göredir. Yeni dosyalar ayrıca belirtilmiştir.

| Dosya | Neden |
| --- | --- |
| `artifacts/edcons/src/pages/admin/website/DetailFullPreview.tsx` (yeni) | Dört tür için doğrulanan ve iptal edilebilir tam detay önizlemesi, ekran boyutu seçimi. |
| `artifacts/edcons/src/pages/admin/website/detailFullPreviewContract.ts` (yeni) | Kayıt/dil/kanonik adres bağı ve sınırlı public okuma sözleşmesi. |
| `artifacts/edcons/src/pages/admin/website/detailFullPreviewRender.tsx` (yeni) | Mevcut React detay bileşenlerinin etkisiz statik render'ı ve sandbox belge temizliği. |
| `artifacts/edcons/src/pages/public/DetailPreviewContext.tsx` (yeni) | Yalnız önizlemenin doğrulanmış veri/düzen snapshot'ını public bileşenlere iletme. |
| `artifacts/edcons/src/pages/admin/website/DetailContentEditor.tsx` | Tam önizleme, güncel taslak/sürüm bağı, geçersizleşen yayın incelemesinin sıfırlanması. |
| `artifacts/edcons/src/pages/admin/website/CatalogPagesInventory.tsx` | Var olan kanonik adresin editöre taşınması. |
| `artifacts/edcons/src/pages/public/CountryDetail.tsx`, `CityDetail.tsx`, `UniversityDetail.tsx`, `ProgramDetail.tsx` | Önizlemede snapshot, normal kullanımda mevcut public okuma davranışı. |
| `artifacts/edcons/src/pages/public/DetailLayout.tsx`, `DeferredBelowFold.tsx`, `UniversityProgramBrowser.tsx` | Statik önizlemede yayınlanmış düzen ve ilk program sayfası; normal etkileşim davranışı korunur. |
| `artifacts/edcons/src/pages/admin/website/Pages.tsx` | TR/EN kontroller ve düzenlenen şablondan ayrılma koruması. |
| `artifacts/edcons/src/pages/admin/website/DetailTemplates.tsx` | Sürüm bağı, düzenleme/yükleme/kayıt korumaları ve anlaşılır bölüm adları. |
| `artifacts/edcons/src/pages/admin/website/PageEditor.tsx` | Ayrı sayfa oturumu, asenkron kayıt yarışları, ayrı SEO dirty state, hata sonrası veri koruma ve TR/EN metinler. |
| `artifacts/edcons/src/pages/admin/website/detailTemplateLabels.ts` (yeni), `pageEditorCopy.ts` (yeni) | Modüle yerel bölüm adları ve editör metinleri; global dil mimarisi değişmez. |
| `artifacts/edcons/src/pages/admin/website/pageEditorNavigationGuard.ts` (yeni) | Editör ömrüyle sınırlı düğme/bağlantı/geçmiş/çıkış koruması ve destek tespiti. |
| `artifacts/edcons/src/pages/admin/website/CatalogBlockFields.tsx`, `CatalogBlockPreview.tsx` | Sınırlı iç içe yanıt doğrulaması, güvenli hata metni, retry ve TR/EN kontroller. |
| `artifacts/edcons/vite.config.ts` | Yalnız detay önizleme render paketinin tembel yüklenen ayrı parça olması. |
| `artifacts/edcons/scripts/check-public-bundle-budget.mjs` | Önizleme render paketinin public ilk yüklemeye sızmasını reddeden kontrol. |
| `artifacts/edcons/package.json` | Yeni önizleme sözleşme testinin mevcut `test:detail-content` komutuna eklenmesi; dependency/lock değişikliği yok. |
| `artifacts/edcons/scripts/test-detail-full-preview.ts` (yeni) | Önizleme kimliği, locale, üniversite sınırı, okuma bütçesi ve etkisiz render testleri. |
| `artifacts/edcons/scripts/test-catalog-pages-inventory.ts`, `test-page-builder-templates.ts` | Mevcut bileşen bağlantısı ve güvenli hata gösterimi assertion'larının güncellenmesi. |
| `artifacts/edcons/tests/authoring/detail-full-preview.spec.ts` (yeni) | Dört detay türü, mobil/RTL, mismatch, sandbox, güvenli medya ve bölüm bağlantıları. |
| `artifacts/edcons/tests/authoring/page-editor-safety.spec.ts` (yeni) | Kayıt yarışları, sayfa kimliği, okuma hatası, çeviri, çıkış ve geçmiş koruması. |
| `artifacts/edcons/tests/authoring/pages-copy-guards.spec.ts` (yeni) | TR/EN, mobil, şablon sürüm bağı, başarısız yükleme ve kayıt/çıkış senaryoları. |
| `artifacts/edcons/tests/authoring/catalog-block-safety.spec.ts` (yeni) | Bozuk ve ölçüsüz katalog yanıtı, güvenli hata, tekrar deneme. |
| `artifacts/edcons/tests/authoring/pages.spec.ts`, `public-layout.spec.ts` | Güncel katalog yanıt fixture'ları, anlaşılır bölüm adları ve gerçek verili yerel ekran regresyonları. |
| `artifacts/edcons/tests/fixtures/page-authoring.tsx` | Dört detay türü ve ayrı sayfa kimlikleri için sentetik test girişi. |
| `artifacts/edcons/tests/fixtures/page-editor-safety.html`, `page-editor-safety.tsx` (yeni) | Lazy editörün varsayılan router ile yalıtılmış testi. |
| `artifacts/edcons/tests/fixtures/page-editor-app-router-safety.html`, `page-editor-app-router-safety.tsx` (yeni) | Uygulamanın gerçek özel router hook'u ve import sırası ile aynı editör testleri. |
| `docs/PAGES_AUTHORING_LOCAL_2026-09-16.md`, `AGENTS.md` | Bu turun kapsam, kanıt ve sınırlarının kalıcı kaydı. |

### Reused architecture / New local additions

Mevcut Country/City/University/Program bileşenleri, katalog projection'ları, public uçlar, ortak detay düzeni, editoryal içerik sözleşmesi, kaynak dil davranışı, React Query, yetkili kayıt/yayın ve sürüm kontrolü tekrar kullanıldı. Yeni parçalar yalnız yukarıdaki editör metinleri/korumaları, preview context/render/sınırlı okuma sözleşmesi ve test fixture'larıdır. Yeni CMS, model, route, tablo, AI servisi veya provider adapter'ı yoktur.

### Tests

- Birleşik tarayıcı grubu: **56/56 PASS**; 8 tam detay önizleme, 11 editör güvenliği, 6 Pages/şablon koruması, 2 katalog blok yanıtı, 5 mevcut Pages senaryosu, 24 gerçek verili public yerel ekran senaryosu.
- Son mobil ölçek düzeltmesinden sonra tam detay önizleme grubu tekrar **8/8 PASS**; gerçek iframe genişliği, çerçevenin ekrana sığması ve boş olmayan boyanmış ekran görüntüsü doğrulandı. Son build/typecheck ve 20 detail-content testi de düzeltme sonrası yeniden PASS.
- Uygulamanın gerçek router hook'u ile editör grubu: **11/11 PASS**; yukarıdaki 11 testin farklı router fixture'ıyla tekrarıdır, ayrı 11 özellik değildir.
- `test:detail-content`: **20/20 PASS**; bunun 7'si yeni tam önizleme sözleşme testidir.
- API tarafında mevcut detail-content/page-authoring/catalog-inventory/asset-preloads saf regresyonları: **16/16 PASS**; API dosyası değişmedi.
- Edcons build öncesi sözleşme grubu: **125/125 PASS**. Bu gruplar kısmen örtüşür; benzersiz toplam test sayısı olarak toplanmamalıdır.
- Edcons typecheck, 23 dil anahtar/placeholder eşliği, Vite build, sitemap üretimi ve public bundle budget: **PASS**.
- Son bundle ölçümü: ilk JS **143916 gzip byte**, ilk CSS **41272 gzip byte**, bootstrap **2921 byte**, 23 locale parçası. Bu derleme ölçümüdür; yeni saha CWV sonucu değildir.
- Derleme mevcut sourcemap ve büyük parça uyarılarıyla tamamlandı; sıfır uyarı iddiası yoktur.
- `git diff --check`: **PASS**.

Tarayıcı testleri `127.0.0.1:25198` üzerindeki yerel kodu çalıştırdı. Gerçek veri testindeki staging erişimi yalnız anonim public GET'tir; diğer API işlemleri sentetik yanıtlarla kesildi. Gerçek verili örnekler Birleşik Krallık, Londra, Abbey DLD Colleges ve A-Level kaydıdır. Bu dört örnek bütün kataloğun yeterliliğini kanıtlamaz. Yeni versiyonla canlı giriş, gerçek kayıt/yayın, PostgreSQL entegrasyonu veya başvuru gönderimi yapılmadı. Apply bağlantısı ve mevcut akışa bağlanma kontrol edildi; uçtan uca başvuru tamamlandı iddiası yoktur.

Yerel tarayıcı çıktıları depo dışındaki `../outputs/pages-priorities-verified-browser` ve son ölçek/görsel kontrol için `../outputs/detail-preview-scaled-painted-browser` klasörlerindedir. Son klasördeki `arabic-mobile-preview-body.png` ana ajan tarafından da görsel olarak incelendi.

### Backward compatibility / Scope verification

Mevcut public route/API, CMS kayıt/yayın uçları, katalog seçimi, kanonik/SEO/hreflang/sitemap politikası ve Apply/form akışı korunur. Auth, kullanıcı, payment, CRM, başvuru iş akışı, Course Finder iş mantığı, global router, başka servis contract'ı, DB/migration, global dil/design sistemi, CI/CD veya deployment değişmedi. Vite değişikliği yalnız bu önizlemenin public performans bütçesini koruyan local chunk sınırıdır. Staging'de bu turdaki yeni kodun bulunduğu iddia edilmez.

### Blocked items

- **Navigation API bulunmayan tarayıcılarda geri/ileri ile veri kaybı riski:** Router'ın önceden kaydedilmiş `popstate` dinleyicisi editörü koruma çağrısından önce kaldırabilir. Destekli Chrome'da geri/ileri iptali ve kabulü testlidir; desteklenmeyen tarayıcıda kaydedilmemiş değişiklikler varken açık TR/EN uyarı gösterilir. Düğme/bağlantı/çıkış korumaları ayrı çalışır. Tüm tarayıcılarda garanti için uygulama başlangıcında/router'dan önce bağlanan koruma gerekir; global router değişikliği bu turun scope'u dışındadır.
- Onaylı gerçek editoryal metin, çeviri ve medya kaynağı kodla uydurulamaz. İncelenen dört örnekte editoryal bölüm sayısı sıfır; bazı açıklamalar, A-Level örneğinde doğrulanmış ücret/structured intake verileri eksiktir. Bu tespit yalnız örnekler içindir.
- Toplu/otomatik public yayın mevcut onay ve Publication Center kapılarını geçemez; hiçbir yetki veya yürütücü açılmadı.

### Deferred backlog / Remaining risks

- Preview, **yayınlanmış** ortak düzen + editoryal taslağı gösterir; kaydedilmemiş ortak şablon düzeni, site header/footer/auth shell veya canlı etkileşimlerin birebir önizlemesi değildir. Apply/form ve diğer eylemler güvenlik için kapalıdır; üniversitede ilk 24 program snapshot'ı gösterilir. Dış/özel görsellerin boş görünmesi beklenir.
- Staging'e alınacak exact commit için gerçek oturumla save/conflict/review/publication UAT; yetkili ve izole ortamda form/başvuru ve DB regresyonu; desteklenen tarayıcıların tamamı için test.
- Gerçek içerik/medya/çeviri tamamlama, insan yayın incelemesi ve temsilî katalog hacmiyle operasyon kontrolü.
- Onaylı staging deploy ve ardından runtime cache/SEO/sitemap doğrulaması ayrı iştir. Production izni yoktur.
- Visa, ranking, housing, transport, climate, living-cost/curriculum gibi dış veriler ve ileri otomatik yayın işleri kaynak/onay bağımlı backlog'da kalır. Bu tur yeni CWV/yük/DR sertifikası üretmez.

### Release status

**PARTIALLY READY** — kapsam içindeki yerel Pages öncelikleri test edildi; tam otomasyon, bütün tarayıcı geçmiş koruması ve staging/production kabulü tamamlanmış değildir. Değişiklikler bu branch'in commit edilmemiş çalışma ağacındadır; production ve staging değişmedi.

### 5 Ekim 2026 — Sonraki staging dağıtım yetkisi ve preflight

Kullanıcı sonraki mesajında yalnız staging'e alma işlemini onayladı. Önceki yerel durum kaydı tarihsel olarak korunur. Mevcut staging checkout ve public health, `d85d75f3fcc8c50d09a24ee348e30fc972d2a933` tabanını doğruladı. Eski runtime image `sha256:115c826e2185d2a55979792c266256d274ff91eca6982bb4e9b87b7f405ed3d0`, release `staging-20261004T171252Z-d85d75f3f`, ledger **133**, DB restart sayısı **0**. Yeni migration, seed veya veri kopyalama gerekmiyor ve yapılmayacak.

Baseline'daki üç Linux CI grubu, daha önce eklenmiş `0132_education_country` kaydının migration-authority testindeki sabit listede unutulması nedeniyle kırmızıydı. Dağıtım doğrulaması için yalnız `artifacts/api-server/scripts/test-migration-authority.ts` beklenen listesine bu **mevcut** kayıt eklendi. SQL, journal, validator, backend runtime ve CI workflow değişmedi; assertion gevşetilmedi. Bu test-only ek, yukarıdaki ön yüz uygulama dosyalarına ek dağıtım düzeltmesidir.

Dağıtım koşulları: exact-head dört CI kapısı, mevcut staging'e ait yeni checksum yedeği ve network-none restore tatbikatı, mevcut image/API ve kapalı dış eylem bayraklarının korunması, yalnız staging app değişimi ve code-only rollback. Bu preflight kaydı dağıtımın tamamlandığı anlamına gelmez; sonuç ayrıca exact release ile doğrulanmalıdır. Production, merge ve `Next` yetki dışında kalır.

İlk aday `c4fb5fdf14b671dea1180a75fd5084368df9fb5b` için Staging Adoption, Portal ve Institution kapıları PASS oldu. Convergence kapısının daha ilerideki envanter kontrolü, baseline'daki `1c44c9607` eğitim bilgisi değişikliğinden kalan dört eski route hash'i buldu. Bağımsız salt-okunur incelemede eski hash'lerin o commit'in parent'ıyla birebir eşleştiği, mevcut dört dosyanın adayda değişmediği ve route/yetki/ownership kontrollerinin aynı kaldığı doğrulandı. `security/legacy-role-gate-registry.json` içinde yalnız `ai-extract.ts`, `education-records.ts`, `public-apply.ts`, `students.ts` kayıtlarının dört `sha256` değeri yenilendi; bütün sayımlar, izinler ve `legacy_quarantine` sınıfları korunur. Bu da dağıtım doğrulamasına ait metadata düzeltmesidir, backend runtime veya güvenlik policy değişikliği değildir.
