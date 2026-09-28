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

7. **Run-owned büyük katalog performans kapısı**
   - Yalnız exact disposable `127.0.0.1:5433/fasos_apply_local` üzerinde çalışan,
     1.000 üniversite + 200.000 program kurup sonunda kendi üniversite prefix'i
     üzerinden cascade-cleanup yapan tekrar edilebilir benchmark eklendi.
   - Gerçek Course Finder join + translation fallback + `%term%` search + sort +
     deep offset list/count, yedi facet sorgusu ve 32 eşzamanlı farklı arama ölçülüyor.
   - PostgreSQL 16.15 son yerel kanıtında list planı 110,99 ms, cold list+count
     155,65 ms, yedi facet 238,26 ms; 32-query burst 0 hata, p50 665,62 ms,
     p95 1.034,56 ms, p99 1.043,64 ms oldu. Hard safety ceilings PASS.
   - Plan 200.000 programda parallel sequential scan gösterdi. Ölçüm mevcut
     güvenlik tavanının altında olduğu için kanıtsız geniş GIN/extension migration'ı
     eklenmedi; bu sonuç production kapasite veya uzun soak sertifikası değildir.

8. **Public başlangıç paketi ve yerel CWV laboratuvarı**
   - Public rotalarda portal-only auth prefetch, akademik yıl, activity tracker,
     dashboard guard/provider ve toast başlangıçtan ayrıldı; aktif public rota ile
     yalnız seçili dil paketi paralel yükleniyor.
   - Ana sayfadaki yaklaşık 980 KB dekoratif PNG ve başlangıç animasyonu CSS tabanlı
     sunuma çevrildi. Cookie banner, program kartları ve filtrelerde ilk boya için
     gerekli olmayan animation runtime kaldırıldı.
   - Program başvurusundaki kamera/belge tarayıcı yalnız gerçekten açıldığında
     indirilen ayrı chunk oldu. Başvurunun gerçek belge birleştirme davranışı ve
     mevcut form akışı korunuyor.
   - Başlangıç JavaScript bütçesi 300 KiB'dan 180 KiB gzip'e sıkılaştırıldı;
     portal component ve animation runtime'larının module-preload ile public
     başlangıca geri dönmesi testle engellendi. Güncel kanıt 142.965 byte gzip'tir;
     faz başlangıcındaki 256.002 byte'a göre yaklaşık `%44` azalmadır.
   - Yalnız disposable PostgreSQL, kapalı dış entegrasyonlar, yerel production build,
     390×844 viewport, Fast 4G ve 4× CPU profiliyle çalışan tekrar edilebilir CWV
     laboratuvarı eklendi. Araç sonuçlarını açıkça `LOCAL_LAB_NOT_FIELD_DATA`
     olarak işaretler, LCP/CLS/TBT ölçümü yoksa veya eşik aşılırsa fail eder.
   - İlk ölçümden sonraki en iyi karşılaştırmada ana sayfa LCP `9.156 → 4.176 ms`,
     TBT `641 → 60 ms`; program detay LCP `2.720 → 2.128 ms`; üniversite detay
     LCP `2.660 → 2.148 ms` oldu. CLS tüm rotalarda `0` kaldı.
   - Son doğrulama koşusu ağ/JIT değişkenliğini de görünür tuttu ve eşikleri dürüstçe
     **FAIL** etti: route sonuçları içinde LCP `2.092–4.436 ms`, TBT `161–553 ms`,
     p95 LCP `4.436 ms`, p95 TBT `553 ms`, CLS `0`. Bu nedenle production CWV
     hazır iddiası yoktur. Program liste sonucunun API sonrası yeniden boyanması,
     büyük İngilizce sözlük ve ilk yük ortak vendor maliyeti kalan darboğazlardır.

9. **Bounded PDF önizleme çalışma zamanı**
   - Mesaj PDF kartı ve öğrenci PDF fotoğraf önizlemesi aynı process-local kabul
     sınırını kullanıyor: aynı anda en fazla iki decode/render, en fazla 12 bekleyen
     iş ve toplam 64 MiB rezervasyon.
   - Bilinen veya akış sırasında ölçülen PDF 20 MiB'ı, server thumbnail 2 MiB'ı
     aşarsa tüm gövdeyi belleğe almadan indirme iptal ediliyor. Yanlış/eksik
     `Content-Length` akış sayımıyla fail-closed yakalanıyor.
   - Her iş için 15 saniye timeout var; component unmount olduğunda fetch, pdfjs
     load ve render task iptal ediliyor. Sınır aşımı mevcut güvenli icon/fallback
     görünümüne düşüyor; mesaj veya öğrenci kaydını değiştirmiyor.

10. **API token mutation + audit atomikliği**
   - API token create, revoke ve rotate işlemlerinin audit sonucu artık credential
     mutation'ıyla aynı veritabanı transaction'ında yazılıyor; non-throwing legacy
     audit helper bu üç yüksek etkili komutta kullanılmıyor.
   - Revoke satırı transaction içinde kilitleniyor. Eşzamanlı veya tekrar revoke,
     ikinci bir mutation/audit üretmeden mevcut durumu döndürüyor.
   - Audit insert hatasında create hiçbir credential bırakmıyor; revoke aktif
     tokenı iptal etmiyor; rotate eski tokenı iptal edip replacement bırakmıyor.
     Plain token hiçbir audit payload'una yazılmıyor.

11. **Application destructive command + audit atomikliği**
   - Tekil application soft-delete, bağlı document soft-delete ve
     `delete_application` audit sonucu aynı transaction içinde.
   - Super Admin hard purge; parent satırı transaction içinde `FOR UPDATE` ile
     doğrulayıp notes/documents/stage documents/application ve
     `purge_application` audit sonucunu birlikte commit ediyor.
   - Audit insert hatası transaction'ı rollback ettirir; uygulama veya bağlı
     kayıtlar audit kanıtı olmadan silinemez. Olmayan application purge artık
     sahte başarı yerine `404` döndürüyor.

12. **Çoklu iletişim hesabı mutation + audit atomikliği**
   - WhatsApp/Meta/Zernio/Telegram/SMS hesaplarının create, update, active toggle,
     default seçimi ve delete audit sonuçları mutation'ın kendi transaction'ına
     taşındı; legacy fire-and-forget helper kaldırıldı.
   - Account identity/advisory lock, configuration-only kanal, SMTP ayrımı,
     kullanımda-hesap engeli ve varsayılan hesabı güvenli devretme davranışları
     korunuyor.
   - Audit insert hatası hesap/şifreli config değişikliğini rollback ediyor.
     Audit payload yalnız kanal/provider kimliğini içeriyor; token, bot secret veya
     SMTP credential içermiyor.

13. **Integration config mutation + audit atomikliği**
   - Integration create/update ve enable/disable audit sonuçları artık ayar
     mutation'ıyla aynı transaction içinde yazılıyor; audit yazılamazsa şifreli
     config veya aktiflik durumu da commit edilmiyor.
   - Update ve toggle, okunan `updatedAt` sürümüne bağlandı. Arada başka bir yazı
     olmuşsa eski istek değişikliği ezmek yerine kararlı
     `integration_version_conflict` ile `409` döndürüyor.
   - Cache invalidasyonu yalnız transaction başarıyla commit ettikten sonra
     çalışıyor. Live-integration deployment kapısı ve WhatsApp zorunlu secret
     kontrolleri korunuyor.
   - Audit payload yalnız integration anahtarı ve aktiflik sonucunu içeriyor;
     API key, token, webhook secret ve diğer config değerlerini içermiyor.

14. **Pipeline stage replacement + audit atomikliği**
   - Lead/student/application aşamalarının replace-all kaydı ile genel
     `pipeline_stages.updated` sonucu aynı transaction içinde yazılıyor. Audit
     insert hatasında eski stage seti korunuyor; yarım pipeline commit edilmiyor.
   - Otomatik e-posta ayarı değişmişse mevcut `pipeline_stage_email.configured`
     olayı da aynı transaction içinde üretiliyor. Böylece iletişim politikasının
     değişmesi audit'ten önce görünür hale gelemiyor.
   - Genel audit; entity type, bounded stage anahtarları ve otomatik WhatsApp/e-posta
     etkin stage anahtarlarını içeriyor; template gövdesi veya sender secret'ı
     içermiyor. Girdi ve audit boyutunu sınırlamak için pipeline başına hard 100
     stage tavanı eklendi.

15. **Public katalog policy audit ve processler arası invalidasyon**
   - Course Finder/public görünürlük policy mutation'ı ile audit sonucu aynı
     transaction'a alındı. Audit insert hatasında ülke/tür görünürlük ayarı
     değişmiyor; `updatedAt` drift'i eski yazıyı ezmek yerine `409` döndürüyor.
   - Başarılı commit sonrasında mevcut public katalog invalidation bus'ı
     kullanılıyor; yeni paralel cache altyapısı kurulmadı. Diğer API process'leri
     SSR/Course Finder generation cache'inin yanında process-local policy
     cache'ini de temizliyor.
   - Audit yalnız normalize edilmiş ülke, üniversite türü ve ülke kuralı policy'sini
     içeriyor; credential veya kullanıcı verisi içermiyor.

16. **AI default config transaction, sürüm ve boyut sınırı**
   - Built-in extractor/persona varsayılanlarının save/reset mutation'ı ve audit
     sonucu aynı transaction'a taşındı. Audit insert hatasında prompt/config veya
     reset sonucu commit edilmiyor.
   - Her key için transaction-scoped advisory lock var. Admin arayüzü okuduğu
     `updatedAt` sürümünü save ve reset komutuna bağlıyor; daha yeni değişiklik
     varsa eski editör `ai_default_version_conflict` ile `409` alıyor.
   - JSON config için hard 64 KiB serialized sınır eklendi. Audit prompt, field
     listesi veya guideline içeriğini kopyalamıyor; yalnız key ve önceki/yeni
     sürüm zamanını kaydediyor.

17. **AI extractor CRUD bütünlüğü ve evidence koruması**
   - Extractor create/update/delete, default-scope devri ve audit sonucu tek
     transaction'a alındı. Yönetim işlemleri advisory lock ile serialize ediliyor;
     audit hatasında config veya default değişikliği rollback oluyor.
   - Run geçmişi olan veya embed widget tarafından kullanılan extractor artık
     fiziksel silinemiyor; `409 AI_EXTRACTOR_IN_USE` ile deactivation yoluna
     yönlendiriliyor. Böylece run evidence cascade-delete ve aktif referansın
     sessizce `NULL` olması engellendi.
   - Yönetim request'i 256 KiB parser, 128 KiB serialized config, en fazla 200
     field/rule/document-type ve bounded string limitlerine alındı. Beklenmeyen
     DB/provider mesajları HTTP cevabında dışarı çıkarılmıyor; audit prompt veya
     kural gövdesini kopyalamıyor.

18. **AI persona CRUD bütünlüğü ve evidence koruması**
   - Persona create/update/delete ve audit sonucu tek transaction içinde; yönetim
     komutları advisory lock ile serialize ediliyor. Audit hatası persona
     mutation'ını rollback ediyor.
   - Update guard artık persisted persona type/tool birleşimini transaction içinde
     yeniden değerlendiriyor. Yalnız `personaType` değiştirerek side-effect tool
     taşıyan operator'ü advisor'a dönüştürme bypass'ı kapandı.
   - Run, approval action veya conversation geçmişi olan persona fiziksel
     silinemiyor; `409 AI_PERSONA_IN_USE` ile deactivation yoluna yönlendiriliyor.
     Yönetim body sınırı 256 KiB/serialized config 128 KiB; prompt/list/string
     alanları bounded. Raw DB hatası ve prompt içeriği audit/HTTP cevabına çıkmıyor.
   - Manuel run'ın mevcut audit çağrısı artık request lifecycle içinde gerçekten
     await ediliyor; dış AI veya otomatik çalıştırma feature state'i açılmadı.

19. **Data Quality onaylı düzeltme + audit atomikliği**
   - Legacy application→lead ilişki onayı ile `approve_application_lead_link`
     audit sonucu aynı transaction içinde yazılıyor. Audit insert başarısızsa
     ilişki değişikliği commit edilmiyor.
   - Idempotent tekrar ikinci audit üretmiyor; seçilen lead'in exact student
     lineage kontrolü ve advisory transaction lock korunuyor.

20. **Katalog veri güvenilirliği ve değişiklik etkisi ilk dilimi**
   - Mevcut Data Quality ekranına verified `price_components`, aktif
     `program_intakes` ve kanonik source record'ları yeniden kullanan salt-okunur
     confidence görünümü eklendi; yeni factual tablo veya paralel katalog yok.
   - Program bazında kaynak, son doğrulama, source expiry ve eksik
     tuition/intake/deadline alanları gösteriliyor. Read-only etki önizlemesi aynı
     kaydın kaç public detail sayfasını ve kaç aktif başvuruyu etkilediğini verir.
   - Sorgu repeatable-read/read-only transaction, 8 saniye statement timeout ve
     200 satır hard limit ile çalışır; sonuç private/no-store'dur. Otomatik
     publish, tahmin, AI üretimi veya application mutation yoktur.
   - Kaynak linki yalnız HTTP(S) ise UI'a çıkar; riskli URL şemaları fail-closed
     elenir.

21. **Mesaj eki tek-kullanımlı grant tüketimi**
   - Staff, öğrenci ve acente internal-message ekleri artık metadata'daki boyut ve
     MIME'a güvenmiyor; object storage'daki gerçek metadata ve byte'lar yeniden
     okunup karşılaştırılıyor.
   - `FINALIZED → CONSUMED` geçişi mesaj insert'i ve conversation preview
     güncellemesiyle aynı transaction içinde. Eksik, değiştirilmiş, başka
     kullanıcıya ait veya daha önce tüketilmiş object hiçbir mesaj referansı
     üretemiyor.
   - Metin-only mesaj davranışı ve mevcut bildirim dağıtımı korunuyor; dış provider
     veya feature state'i açılmadı.
   - Inbox Documents yan panelindeki manuel belge yükleme de object storage'daki
     gerçek byte/boyut/MIME'ı yeniden doğruluyor. Grant tüketimi ile document insert
     aynı transaction'da; eksik, değişmiş veya yeniden kullanılmış object belge
     referansı oluşturamıyor.

22. **Public staging CWV ölçüm kapısı ve ilk-boya düzeltmesi**
   - Yalnız exact `https://staging.findandstudy.com` origin'ine, explicit opt-in ile
     çalışan 390px/Fast-4G/4×CPU, üç tekrarlı ve median raporlu salt-okunur ölçüm
     aracı eklendi. Form, auth veya mutation çalıştırmıyor.
   - Mevcut staging baseline dürüstçe FAIL verdi: altı rota medyanında LCP 4.508–
     5.340 ms, TBT 47–398 ms, CLS 0; aggregate median LCP 4.840 ms, TTFB 1.015 ms.
   - SSR shell artık React route'un kendi H1'i hazır olana kadar ilk boyayı koruyor;
     eski anlık shell silme kaynaklı boş ekran kaldırıldı. Tema bootstrap'ında üç
     logonun birden eager indirilmesi kaldırıldı; aktif layout yalnız gereken logo
     varyantını yüklüyor.
   - Bu kod düzeltmeleri staging'e çıkıp aynı üç-tekrar kapısı yeniden koşmadan CWV
     PASS iddiası yoktur.

23. **Registration input maliyet ve sınır koruması**
   - E-posta DB sorgusu, bcrypt ve doğrulama e-postasından önce normalize ve
     validate ediliyor. E-posta, parola, ad ve telefon alanları hard bounded.
   - Geçersiz veya aşırı büyük identity girdileri pahalı iş ya da yan etki
     üretmeden `INVALID_REGISTRATION_IDENTITY` ile reddediliyor.

24. **Staging public ilk-ekran ikinci performans dilimi**
   - Şehir, üniversite ve program detaylarındaki aşağı-kat program tarayıcıları
     dinamik import + viewport yakınlığına kadar erteleme ile ilk hydration yolundan
     ayrıldı. Kart ve filtrelerin mevcut ortak bileşenleri değiştirilmedi.
   - Public logo decode'u async/düşük fetch priority oldu. Countries koleksiyonunun
     salt dekoratif giriş/kart animasyonları animation runtime gerektirmeyen mevcut CSS
     transition davranışına indirildi.
   - Exact code head `18ff6c9288f6d81ecb98a565cf66540107ea09b5`, staging
     release `staging-20260928T171314Z-18ff6c9288f6` olarak yayına alındı;
     health HTTP 200 ve `dbConnected=true` verdi. Production değiştirilmedi.
   - Üç-tekrarlı son staging medyanında üniversite LCP `2.356 ms`, program
     detay LCP `2.288 ms`; aggregate TBT `134 ms`, CLS `0` oldu. Countries
     animation runtime kaldırılınca bu rota `42.274 byte` daha az transfer etti
     ve TBT medyanı `126 → 45 ms` oldu. Ana/liste/şehir LCP `3.572–4.168 ms`
     kaldığı için CWV kapısı dürüstçe **FAIL** kalır.
     Sentetik tekrarların ikincisinden itibaren yaklaşık `1 sn` TTFB görüldü;
     bu, saha p75 kanıtı değil ve rate-limit/edge davranışı ayrı ölçülmelidir.

## Doğrulama

- Security regression: **115/115 PASS**.
- Security hardening/native bağımlılık: **116 PASS, 1 Windows symlink SKIP**.
- Web-form replay: **9/9 PASS**.
- Application concurrency: **5/5 PASS**.
- Import lifecycle (catalog bus dahil): **17/17 PASS**.
- İki bağımsız process + PostgreSQL katalog invalidasyonu: **4/4 PASS**.
- İki bağımsız process + PostgreSQL bildirim sayacı invalidasyonu: **3/3 PASS**.
- Disposable 200.000-program Course Finder plan/cold/facet/burst gate: **PASS**.
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
- Edcons güncel doğrulama: i18n parity + **115/115** contract testi + typecheck +
  production build + sitemap + sıkılaştırılmış 180 KiB başlangıç bütçesi: **PASS**.
- Yerel mobil CWV laboratuvarı: çalıştı, ölçüm üretti, gerçek eşikleri aşınca
  tasarlandığı gibi **FAIL**; bu sonuç release kapısını açık tutar.
- PDF preview runtime: concurrency, known-size admission, dishonest streaming
  overflow ve küçük PDF kabulü **4/4 PASS**; frontend typecheck **PASS**.
- API token transaction-bound audit contract **15/15 PASS**; gerçek Express route
  + in-memory rollback fault injection create/revoke/rotate **4/4 PASS**; API
  typecheck **PASS**.
- Genişletilmiş audit durability contract **21/21 PASS**; application optimistic
  concurrency **5/5 PASS**; API typecheck ve production build **PASS**.
- Genişletilmiş audit durability contract **28/28 PASS**; gerçek Express kanal
  hesabı RBAC/live-off/reference/audit rollback matrisi **7/7 PASS**; API
  typecheck **PASS**.
- Genişletilmiş audit durability contract **33/33 PASS**; gerçek Express
  integration create/update/toggle rollback, stale-write ve live-off matrisi
  **6/6 PASS**; integration bağlantı güvenliği **10/10 PASS**; API typecheck ve
  production build **PASS**.
- Genişletilmiş audit durability contract **37/37 PASS**; gerçek Express pipeline
  audit rollback/bounded-input matrisi **3/3 PASS**; stage completion-target
  **3/3 PASS**, portal trigger policy **4/4 PASS** ve disposable PostgreSQL stage
  behavior regresyonu **PASS**; API typecheck ve production build **PASS**.
- Genişletilmiş audit durability contract **42/42 PASS**; public katalog policy
  rollback/stale-write/success matrisi **3/3 PASS**; import/listener lifecycle
  **19/19 PASS**; API typecheck ve production build **PASS**.
- Genişletilmiş audit durability contract **48/48 PASS**; AI default save/reset
  rollback, stale-editor, payload-ceiling ve bounded-audit matrisi **5/5 PASS**;
  API ve Edcons typecheck **PASS**.
- Genişletilmiş audit durability contract **55/55 PASS**; AI extractor create,
  update, referenced-delete ve audit rollback matrisi **5/5 PASS**; extraction
  compatibility **6/6 PASS**, education mapping/trigger **32/32 PASS**; API
  typecheck ve production build **PASS**.
- Genişletilmiş audit durability contract **63/63 PASS**; AI persona CRUD
  rollback, tool-bypass ve evidence-delete matrisi **6/6 PASS**; AI schedule
  **12/12 PASS**, bounded/fair lane scheduler **5/5 PASS**; API typecheck ve
  production build **PASS**.
- Genişletilmiş audit durability contract **65/65 PASS**; application alan,
  atama ve stage güncellemesi business mutation ile aynı transaction içinde
  audit receipt üretir; application optimistic concurrency **7/7 PASS**; API
  typecheck ve production build **PASS**.
- Application toplu silme, atama ve stage taşıma işlemleri de kendi core
  mutation transaction'larında durable audit üretir. Girdi 500 kayıtla
  sınırlandı; pozitif ID'ler normalize edilip tekrarlar ayıklanır. Genişletilmiş
  audit durability contract **73/73 PASS**; API typecheck ve production build
  **PASS**.
- Lead otomatik atama kuralı create/update/delete işlemleri mutation ile aynı
  transaction içinde bounded audit üretir. Staff ID listeleri strict pozitif
  integer olarak normalize edilir ve tekrarlar ayıklanır; boş ad güncellemesi
  reddedilir. Gerçek Express rollback matrisi **5/5 PASS**, genişletilmiş audit
  durability contract **78/78 PASS**; API typecheck ve production build **PASS**.
- Lead toplu silme, atama ve stage taşıma işlemleri de core mutation ile aynı
  transaction içinde audit üretir. Toplu istekler 500 kayıtla sınırlandı;
  strict pozitif ID normalizasyonu ve tekrar ayıklama eklendi. Genişletilmiş
  audit durability contract **86/86 PASS**; API typecheck ve production build
  **PASS**.
- Tekil lead soft-delete ve Super Admin purge koridorları transaction-bound
  audit'e taşındı. Purge, lead satırını kilitleyip aktif student journey bağını
  aynı transaction içinde yeniden doğrulamadan kalıcı silme yapmaz. Genişletilmiş
  audit durability contract **90/90 PASS**; API typecheck ve production build
  **PASS**.
- Task create/update/archive/bulk-archive/restore işlemleri mutation ile aynı
  transaction içinde bounded audit üretir; audit açıklama veya görev gövdesini
  kopyalamaz. Assignee ID doğrulaması strict pozitif safe-integer oldu. Gerçek
  Express rollback matrisi **6/6 PASS**, genişletilmiş audit durability contract
  **97/97 PASS**; API typecheck ve production build **PASS**.
- Campaign create/update/archive/restore işlemleri transaction-bound audit'e
  taşındı. University ID ve liste boyutları sınırlandı; isim/açıklama girişleri
  bounded, update audit'i yalnız değişen alan adlarını taşır. Gerçek Express
  rollback matrisi **6/6 PASS**, genişletilmiş audit durability contract
  **103/103 PASS**; API typecheck ve production build **PASS**.
- Public CMS team-member ve office create/update/delete işlemleri
  transaction-bound audit'e taşındı. Metin/URL/translation payload'ları bounded;
  audit yalnız değişen alan adlarını içerir. Gerçek Express rollback ve payload
  matrisi **8/8 PASS**, genişletilmiş audit durability contract **111/111 PASS**;
  API typecheck ve production build **PASS**.
- Portal university/nationality exclusion create/update/delete işlemleri
  transaction-bound audit'e taşındı. Case-insensitive rule identity advisory
  transaction lock ile serialize edilir; row update/delete kilitlenir ve içerik
  audit'e kopyalanmaz. Gerçek Express rollback/duplicate matrisi **5/5 PASS**,
  genişletilmiş audit durability contract **117/117 PASS**; API typecheck ve
  production build **PASS**.
- Portal program fallback create/update/delete işlemleri transaction-bound
  audit'e taşındı. Business-key create lock'u ve DB unique guard korunurken
  fallback fan-out 20 ile sınırlandı, ID'ler deduplicate edilir ve doğrudan
  source→source döngüsü reddedilir. Gerçek Express rollback/duplicate matrisi
  **6/6 PASS**, audit durability contract **125/125 PASS**; API typecheck ve
  production build **PASS**.
- Data Quality application→lead repair audit'i mutation transaction'ına alındı;
  geniş audit durability contract **125/125 PASS** olarak kaldı. Katalog
  confidence projection/source URL/read-only sınırı **3/3 PASS**; Operations
  bounded read-model **3/3 PASS**; API/Edcons typecheck, API build ve Edcons
  i18n + **119/119** contract testi + production build + sitemap + bundle budget
  **PASS**.
- Birleşik son security regression: ana grup **115/115 PASS**; native/security
  hardening **118 PASS, 1 Windows symlink privilege SKIP**; web-form,
  application concurrency, lifecycle, upload grant ve bütün route atomicity
  alt grupları **PASS**. Sonrasında yanlış dosya adıyla yapılan ek bir test CLI
  çağrısı ürün testi çalıştırmadan komut seviyesinde reddedildi; doğru birleşik
  güvenlik komutu ve hedefli audit/confidence komutu başarıyla tamamlandı.
- Güncel frontend doğrulaması: i18n + **120/120** contract testi + typecheck +
  production build + sitemap + bundle budget **PASS**.
- Public header, tenant logosunun yaklaşık `150 KB` ağırlığındaki kaynağını ilk
  boya zincirinden çıkarmak için sabit boyutlu markalı fallback ile render edilir;
  gerçek logo yalnız pencere yüklemesi sonrası idle zamanında alınır. Boyut rezervi
  CLS üretmez, başarısız/geciken logoda okunabilir marka kimliği korunur. Hedefli
  public-detail contract **44/44 PASS**; Edcons i18n + **121/121** contract testi +
  typecheck + production build + sitemap + bundle budget **PASS**. Staging CWV
  sonucu exact release dağıtımı sonrasında ayrıca kaydedilecektir.
- Güncel API birleşik security regression: ana grup **118/118 PASS**; native
  hardening **118 PASS, 1 Windows symlink privilege SKIP**; tüm atomicity ve
  audit alt grupları **PASS**.
- Registration identity **3/3 PASS**; internal-message attachment grant contract
  **3/3 PASS**; API typecheck **PASS**.
- Inbox manual-document grant ve stored-byte contract **3/3 PASS**; mesaj ekiyle
  birleşik hedefli suite **6/6 PASS**.
- Acente self-service logo ve işletme belgesi kayıtları artık yalnız object-owner
  eşleşmesine güvenmez: provider'dan gerçek bayt/MIME yeniden okunur, dosya
  imzası ve dar tür/boyut politikası doğrulanır; `FINALIZED → CONSUMED` grant,
  profil referansı ve durable audit aynı DB transaction'ında yazılır. Aynı
  finalized grant'in yeniden kullanımı `409` ile fail-closed'dur. Hedefli
  contract **3/3 PASS**; geniş security-hardening **121 PASS, 1 Windows symlink
  privilege SKIP**; API typecheck ve production build **PASS**.
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
- İncelenen staff/student/agent internal-message attachment consumer'ları artık
  `FINALIZED → CONSUMED` zorunluluğunda. Repo genelindeki başka seyrek legacy
  consumer'lar envanter bazında kendi kayıt transaction'larına alınmadan global
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
- Public web için gerçek HTTP/2 staging ölçümü, en az üç tekrarlı lab medyanı ve
  mümkün olduğunda saha p75/CrUX/RUM kanıtı olmadan CWV release kapısı kapanmaz.
  Mevcut tek-process HTTP/1 yerel laboratuvar regresyon kapısıdır; saha kanıtı
  veya üretim kapasite sertifikası değildir.
