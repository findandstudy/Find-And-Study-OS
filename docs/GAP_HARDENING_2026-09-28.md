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

25. **Personel maaş/komisyon mutation ve audit atomikliği**
   - Personel maaş kaydı create/bulk-create/update/delete ile komisyon
     create/update/delete sonuçları kendi business mutation transaction'larında
     audit üretir. Audit insert başarısızsa finansal kayıt da commit edilmez.
   - Başarılı update audit'i not veya finansal açıklama içeriğini kopyalamaz;
     yalnız kayıt ID'si ve değişen alan adlarını taşır. Silinmiş/olmayan kaydın
     idempotent tekrarında sahte audit üretilmez.
   - Para birimi üç karakterle sınırlandırılıp normalize edilir; tarih girdileri
     parse öncesi bounded/valid, notlar en fazla 2.000 karakterdir. Bulk maaş
     periyodu mevcut kanonik enum'u kullanır ve 36 kayıt tavanını korur. Route
     kimlikleri partial veya unsafe integer kabul etmez.

26. **Personel belgesi finalized-grant tüketimi**
   - Staff-card belge kaydı artık istemcinin boyut/MIME beyanıyla referans
     oluşturmuyor. Private object authoritative metadata ve byte'larından yeniden
     okunuyor; kanonik path, belge türü MIME allowlist'i, gerçek byte boyutu ve
     imza/magic kontrolü geçmeden kayıt açılamıyor.
   - Uploader'a bağlı `FINALIZED → CONSUMED` grant geçişi, staff document insert
     ve bounded audit ile aynı transaction içinde. Eksik, foreign, değiştirilmiş,
     finalize edilmemiş veya daha önce kullanılmış object `409` ile fail-closed;
     belge referansı ya da audit bırakmıyor.
   - Belge soft-delete ve audit aynı transaction'a alındı. Download audit denemesi
     stream başlamadan request yaşam döngüsünde bekleniyor; object path audit veya
     API cevabına çıkarılmıyor.

27. **Başvuru stage-document ve missing-doc geçiş bütünlüğü**
   - Stage document, öğrenci belge aynası ve bounded upload audit'i tek transaction
     içinde yazılıyor. Mirror veya audit hatası ana belgeyi tek başına bırakmıyor;
     yarım görünürlük commit edilmiyor.
   - Stage-document metadata update ile delete; mirror retirement ve audit
     sonuçlarıyla aynı transaction'a alındı. Update audit'i submitted tarih
     değerini kopyalamadan yalnız değişen alan adlarını taşır.
   - Tüm eksik belgeler tamamlandığında oluşan otomatik application stage advance
     audit'i artık `setImmediate` ile transaction sonrasına bırakılmıyor. Stage
     update ve `auto_stage_advance_missing_docs_fulfilled` sonucu aynı transaction
     içinde; audit hatasında fulfillment/advance rollback olur, belge upload'ı
     mevcut güvenli idempotent hook sınırında korunur.

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
- Kullanıcı oluşturma ve avatar güncelleme de aynı tek-kullanımlık upload sınırına alındı:
  yalnız isteği yapan actor'a bağlı private object kabul edilir; gerçek provider
  baytı/MIME, görsel imzası ve 5 MB sınırı doğrulanır; grant tüketimi ile user
  referansı aynı transaction'dadır. Aynı avatarla idempotent retry yeni grant
  tüketmez. Create sırasında user row ve audit de grant tüketimiyle aynı
  transaction'dadır. Hedefli contract **4/4 PASS**; user-management policy
  **6/6**; güncel geniş security-hardening **133 PASS, 1 Windows symlink
  privilege SKIP**; API typecheck ve production build **PASS**.
- Bu iki yeni upload consumer'ı sonrasında birleşik `test:security-regressions`
  zinciri bütünüyle **PASS** oldu: ana güvenlik grubu, **124 PASS + 1 Windows
  symlink privilege SKIP** hardening grubu, web-form replay `9/9`, application
  concurrency `7/7`, import lifecycle `19/19`, upload grant `18/18`, tüm dar
  mutation atomicity paketleri ve audit durability `125/125` geçti.
- Private-storage şube logoları da uploader ownership + gerçek bayt/MIME +
  görsel imzası + 5 MB sınırıyla doğrulanır. Create/update sırasında grant
  tüketimi, branch mutation ve bounded audit aynı transaction'dadır; aynı URL
  retry'si grant tüketmez. Mevcut HTTPS logo referansları uyumluluk için
  korunur. Hedefli contract **4/4 PASS**; geniş security-hardening **128 PASS,
  1 Windows symlink privilege SKIP**; API typecheck ve production build **PASS**.
- Platform ayarlarındaki 13 marka/SEO/PDF görsel alanı private-storage yolu
  aldığında aynı doğrulama sınırından geçer. Bir object birden fazla alana
  bağlanırsa grant yalnız bir kez tüketilir; settings insert/update ve bounded
  audit aynı transaction'dadır. Değişmeyen alan retry'si grant tüketmez ve
  cache invalidasyonu commit sonrasına taşınmıştır. Hedefli contract **4/4**,
  public-settings atomicity **3/3**, geniş hardening **132 PASS + 1 Windows
  symlink privilege SKIP**, API typecheck ve production build **PASS**.
- Yönetici acente oluşturma/düzenleme akışındaki logo, kimlik belgesi, işletme
  belgesi ve manuel sözleşme yüklemeleri de uploader ownership + gerçek
  bayt/MIME + dosya imzası + dar boyut politikasına bağlandı. Grant tüketimi,
  kullanıcı/acente kaydı veya profil mutation'ı ve bounded audit aynı
  transaction içinde; başarısız ya da yeniden kullanılmış grant kullanıcıyı
  veya acente kaydını yarım bırakmıyor. Hedefli contract **5/5 PASS**; API
  typecheck **PASS**.
- Staff profilindeki avatar, sözleşme ve pasaport dosyaları ortak güvenli
  consumer'a alındı. Private object uploader'a ait olmalı; gerçek bayt/MIME,
  dosya imzası ve alan bazlı 5/10 MB sınırı yeniden doğrulanıyor. Üç alanın
  grant tüketimi, user mutation ve bounded audit aynı transaction'da; aynı
  referansla retry no-op. Hedefli contract **4/4 PASS**, user-management policy
  **6/6 PASS**, API typecheck **PASS**.
- Acente portalındaki alt-acente oluşturma/düzenleme logo akışı da aynı sınıra
  taşındı. Logo ownership/gerçek içerik kontrolünden geçiyor; grant, varsa login
  user'ı, alt-acente profili ve audit tek transaction'da yazılıyor. Böylece
  yarım kullanıcı/profil veya tekrar kullanılan logo grantı kalmıyor. Acente
  upload contract'ı **7/7 PASS**, API typecheck **PASS**.
- Şirket ve üniversite sözleşme dosyaları artık istemcinin dosya adı/MIME/boyut
  beyanına güvenmiyor. Uploader ownership, provider'daki gerçek byte/MIME,
  PDF/DOC/DOCX imzası ve 25 MB sınırı doğrulanıyor; grant tüketimi, sözleşme
  create/update ve bounded audit aynı transaction içinde. Aynı dosya referanslı
  retry grant tüketmiyor. Hedefli contract **3/3 PASS**, API typecheck **PASS**.
- Finansal tahsilat/ödeme kanıtı eki uploader ownership ve object storage'daki
  gerçek byte/MIME üzerinden PDF/JPEG/PNG/WebP + 10 MB sınırında doğrulanıyor.
  Grant tüketimi idempotent finance request claim'inden sonra, transaction insert,
  komisyon yeniden hesaplama ve kalıcı mutation receipt'iyle aynı transaction'da;
  replay ikinci kez grant tüketmiyor. Hedefli contract **2/2 PASS**, API typecheck
  **PASS**.
- Migration authority/validation: **129/129 PASS**.
- Disposable PostgreSQL 16.15: fresh `0→129`, upload grant migration, route E2E,
  DB helper fixture cleanup: **PASS**; cluster durduruldu.
- Legacy route ve tenant-writer normal drift kapıları: **PASS**; yeni seed writer
  quarantine altında sınıflandırıldı, hiçbir external-pilot izni açılmadı.

## 28 Eylül staging doğrulaması ve CWV takip dilimi

- Exact `edfe3f87847191bc4e199b3c198409e9e28f646f` kaynak commit'i checksum'lı
  staging yedeğinden sonra `staging-20260928T190154Z-edfe3f878471` release'i
  olarak dağıtıldı. Uygulama/DB healthy, restart `0`, ledger `129/129`, runtime
  UID/GID `10042:10042`, read-only root filesystem, dropped capabilities ve
  `no-new-privileges` kontrolleri **PASS**. External delivery/background/portal
  worker'ları kapalı kaldı; production değiştirilmedi.
- Canonical staging origininde locale root, program listesi, ülke listesi,
  London şehir, Abbey DLD üniversite ve örnek program sayfaları HTTP 200 +
  `noindex, nofollow`; bilinmeyen program/şehir rotaları 404 fail-closed **PASS**.
- Üç tekrarlı 390×844/Fast-4G/4×CPU staging laboratuvarı dürüstçe **FAIL**:
  medyan LCP `/en` 4.128 sn, program listesi 4.108 sn, ülke listesi 3.644 sn,
  London 4.524 sn; üniversite 2.240 sn ve program detayı 2.212 sn. CLS tümünde
  `0–0.0004`; TBT program listesinde 203 ms ve program detayında 216 ms.
- Waterfall ölçümü aktif locale ve public route chunk'larının ana modül
  çalıştıktan sonra başladığını gösterdi. Module-local takip düzeltmesi Vite
  manifestini üretir; SSR yalnız mevcut modelin locale/route chunk'ını ve güvenli
  importlarını bounded `modulepreload` olarak ekler. Unsafe/missing manifest
  girdileri fail-closed kalır. Hedefli sözleşme **47/47**, iki yeni preload testi
  **2/2**, API/Edcons typecheck ve iki production build **PASS**. Bu takip
  değişikliği yeniden staging'e çıkıp aynı üç-tekrar kapısı ölçülmeden performans
  iyileşmesi iddia edilmez.
- Manifest tabanlı preload dilimi exact `14c431f9ba79231b03437e2fa20ae8f4bb63f668`
  commit'i ve `staging-20260928T191715Z-14c431f9ba79` release'iyle staging'e
  çıkarıldı. HTML kanıtında aktif `en` ve ilgili route chunk'ları bounded
  `modulepreload` olarak yer aldı; health HTTP 200, DB bağlı, ledger `129/129`,
  restart `0`, UID/GID `10042:10042`, read-only rootfs ve `CapDrop=ALL` kaldı.
- Aynı üç-tekrar kapısında preload sonrası üniversite medyan LCP `2.492 ms` oldu;
  ancak aggregate LCP `3.736 ms`, program liste TBT `215 ms` ve program detay
  LCP/TBT `2.652 ms/250 ms` nedeniyle sonuç yine **FAIL** oldu. Bu ölçüm locale
  sözlüğü, ortak React/CSS ve route bağımlılıklarının hâlâ kritik zincirde olduğunu
  doğruladı.
- Yaklaşık `150 KB` tenant logosunun idle callback ile kritik route indirmeleriyle
  yarışabildiği görüldü. Logo, okunabilir ve sabit boyutlu mevcut marka fallback'i
  korunarak pencere load'undan beş saniye sonraya alındı; hedefli contract
  `44/44` ve Edcons typecheck **PASS**. Exact `85ad4d103de1d090320ccfe2bc7d8fe37c6ad893`
  commit'i `staging-20260928T192902Z-85ad4d103de1` release'i olarak dağıtıldı.
- Logo ertelendikten sonra program liste transferi `494.126 → 343.555` byte'a
  düştü. Buna rağmen son medyanlar `/en` `3.936 ms`, program listesi `3.804 ms`,
  ülkeler `3.924 ms`, London `4.044 ms`, üniversite `2.720 ms`, program detayı
  `2.704 ms`; aggregate TBT `172 ms`, CLS `0–0.0004` oldu. Dolayısıyla CWV kapısı
  dürüstçe **FAIL** kalır; sıradaki repo-içi darboğaz public kritik çeviri
  namespace'i/SSR handoff, repo-dışı kapı ise gerçek saha p75 verisidir.
- Public kritik çeviri paketi 23 locale için build sırasında ayrı ve bounded
  üretildi; kritik public rotalar ilk boyada yaklaşık `23 KB` ham İngilizce
  sözlüğü kullanıyor, yaklaşık `258 KB` tam sözlüğü pencere load'undan sonra
  getiriyor. Aynı locale'i tekrar seçen sync etkisinin tam sözlüğü erken
  indirmesi de engellendi. Local EN/TR/AR smoke'ta yalnız kritik sözlük ilk
  render öncesi istendi; TR metin ve AR RTL yönü korundu. API/Edcons typecheck,
  production build, `23/23` sözlük üretimi ve public contract testleri **PASS**.
  Exact `168ba936c35d81b42b5bedbb0d5ab00e690d24a6` commit'i
  `staging-20260928T194633Z-168ba936c35d` olarak dağıtıldı; health HTTP 200,
  DB bağlı, ledger `129/129`, restart `0`, non-root/read-only/CapDrop kontrolleri
  **PASS** ve external delivery/worker flag'leri kapalı kaldı.
- Çeviri ayrımından sonraki üç-tekrar medyanları `/en` `3.140 ms`, program
  listesi `3.372 ms`, ülkeler `3.160 ms`, London `3.692 ms`, üniversite
  `2.592 ms`, program detayı `2.616 ms`; aggregate TBT `164 ms`, CLS
  `0–0.0004` oldu. Önceki aggregate LCP `3.804 → 3.140 ms` düşmesine rağmen
  hedef `≤2.500 ms` olduğu için CWV kapısı **FAIL** kalır.
- Aynı VPS üzerinde doğrudan container yanıtı `2–6 ms`, canonical HTTPS yanıtı
  `24–39 ms` ölçüldü. Laboratuvardaki yaklaşık `1,1 sn` TTFB uygulama render
  gecikmesi değildir; Fast-4G ağ emülasyonu maliyetidir. Optimizasyon kararı
  bu nedenle yapay TTFB metriği yerine gerçek ilk-boyayı hızlandıran SSR/read
  model kapsamına yönlendirildi.

## Uyumluluk ve rollout notu

## 28 Eylül application stage/finance atomiklik dilimi

- Stage veya atama değiştiren PATCH mevcut `expectedUpdatedAt` optimistic
  concurrency sınırını korur; stale istemci `409 APPLICATION_VERSION_CONFLICT`
  alır ve hiçbir finance/notification etkisi başlatamaz.
- Kanonik `syncApplicationFinance` artık isteğe bağlı mevcut transaction
  executor'ını kabul eder. Stage update, durable `update_application` audit
  receipt'i ve commission/service-fee projection aynı DB transaction'ında
  tamamlanır; finance reconciliation başarısızsa stage commit edilmez.
- Eski post-commit reconciliation geçici uyumluluk için idempotent olarak
  tutuldu ancak artık başarılı atomik komutu yanıltıcı bir HTTP hatasına
  çeviremez. Yeni yazı yolu kanonik transaction içi projection'dır.
- Application concurrency contract `9/9`, birleşik security regresyonları
  `37/37`, library/workspace ve API typecheck **PASS**. Bu dilim dış provider
  veya production üzerinde çalıştırılmadı.

## 28 Eylül çoklu-process facet cache tutarlılığı dilimi

- Application, lead ve student facet cache'leri scope/filter fingerprint ve
  mevcut bounded TTL davranışını korur. Yeni `0129` migration'ı bu üç tablodaki
  committed INSERT/UPDATE/DELETE statement'ları için yalnız namespace taşıyan,
  PII-free PostgreSQL notification üretir.
- Her API process'i aynı kanalı dinler ve yalnız ilgili namespace'i temizler.
  Rol/tenant scope cache anahtarları değişmedi; rollback olan transaction için
  PostgreSQL notification teslim edilmediğinden gereksiz veya erken eviction
  olmaz. Listener kesintisinde mevcut TTL güvenli fallback olarak kalır.
- Invalidation davranışı ve migration/wiring sözleşmesi `16/16`, migration
  ledger `132/132`, API typecheck **PASS**. İlk staging adoption'ında `0129`
  ledger'e girmesine rağmen trigger nesneleri gözlenmedi; geçmiş değiştirilmeden
  explicit statement boundary ve DB-side üç-trigger assertion içeren ileri yönlü
  `0130` repair migration'ı eklendi. Staging executor'ının yalnız ilk statement'ı
  ledger'lediği gözlenince üç trigger kurulumu ve DB-side assertion tek atomik
  statement taşıyan ileri yönlü `0131` ile kapatıldı. Gerçek PostgreSQL
  notification teslimatı aşağıdaki staging adoption kapısında ayrıca doğrulandı.
- Exact code-bearing `7384a36bd308fbde38a085fb608ccaec6d33c687` commit'i,
  checksum'ı doğrulanmış ve network'süz PostgreSQL 16.15 restore smoke'u geçmiş
  `staging-predeploy-20260928T204622Z-7384a36bd308.dump` yedeğine bağlanarak
  staging'e alındı. Migration adoption `132/132`; bağımsız DB kontrolü function
  + üç statement trigger'ını doğruladı. Sıfır satır değiştiren güvenli UPDATE ile
  gerçek `LISTEN/NOTIFY` teslimatı `applications` namespace'i için **PASS** oldu.
- Uygulama `staging-20260928T205628Z-7384a36bd308` release'ine geçirildi.
  Health/DB, canonical public ülke-şehir-üniversite-program rotaları, noindex,
  HSTS, non-root `10042:10042`, read-only rootfs, `CapDrop=ALL`,
  `no-new-privileges`, restart `0` kontrolleri **PASS**. DB container yeniden
  başlatılmadı; live integration, email delivery, background job ve tüm social
  provider/worker bayrakları kapalı kaldı. Production değiştirilmedi.
- Aynı final release üzerinde 29 Eylül'de 390×844/Fast-4G/4×CPU profiliyle
  altı rotanın üçer tekrarlı CWV laboratuvarı yeniden koştu. Medyan LCP ana
  sayfa `3.152 ms`, program listesi `3.356 ms`, ülkeler `3.120 ms`, London
  `3.588 ms`, üniversite `2.492 ms`, program detayı `2.552 ms`; aggregate LCP
  `3.120 ms`, TBT `161 ms`, CLS `0` oldu. Üniversite eşiği geçti, program
  detayı yalnız `52 ms` ile kaçırdı; diğer dört rota nedeniyle kapı dürüstçe
  **FAIL** kalır. Bu ölçüm saha p75/RUM veya production kapasite kanıtı değildir.
- Pre-deploy sentetik staging yedeği VPS dışındaki ayrı Windows host'a alındı.
  `6.178.730` byte dosyanın SHA-256 değeri
  `93ce6359272ee29bedf3bdacbdec0dc5ea7a05cb14fdc67a83c3453b037e7ec2`
  olarak sidecar ile birebir eşleşti. PostgreSQL `16.15` üzerinde ayrı
  `fasos_restore_offsite_7384` veritabanına restore; DB adı, ledger `131`,
  `13` sentetik user ve cache invalidation function kanıtı **PASS**. Geçici DB
  silindi ve yerel cluster kapatıldı. Bu staging off-host restore kanıtıdır;
  production offsite DR/RTO/RPO tatbikatı değildir.
- Exact deployed release'e bağlı salt-okunur staging RBAC UAT yeniden koştu:
  `11` sentetik rol, `126` login/GET authorization/logout kontrolü **PASS**.
  Mutating workflow runner karantinası açılmadı. Koşu sonrasında app/DB healthy,
  restart `0`, ledger `132`, fatal/unhandled log `0`; live integration, email,
  background ve social provider/worker kapıları kapalı kaldı.
- Staff salary/commission mutation rollback fault-injection matrisi **6/6 PASS**;
  genişletilmiş audit durability contract **137/137 PASS**, API typecheck ve
  birleşik security regression zinciri **PASS**. Bu dilim henüz staging'e
  dağıtılmadı; production değiştirilmedi.
- Staff document authoritative-byte/finalized-grant/audit sözleşmesi **4/4
  PASS**; API typecheck **PASS**. Bu dilim henüz staging'e dağıtılmadı;
  production değiştirilmedi.
- Stage-document create/update/delete/mirror ve missing-doc auto-advance audit
  sözleşmeleriyle genişletilmiş audit durability contract **152/152 PASS**;
  pipeline completion-target **3/3 PASS**, API typecheck **PASS**. Bu dilim henüz
  staging'e dağıtılmadı; production değiştirilmedi.

## 29 Eylül staff/stage belge paketi staging adoption

- Staff salary/commission audit atomikliği, staff document tek-kullanımlı upload
  grant tüketimi ve application stage-document yaşam döngüsü exact
  `52bf75b6d205db97fbf8d663759e366f0932b290` code commit'inde birleştirildi.
  Birleşik security regression zinciri, audit durability **152/152**, pipeline
  completion-target **3/3**, API typecheck ve production build **PASS** oldu.
- Dağıtım öncesi `fasos_staging` için checksum'lı custom-format yedek alındı:
  `staging-predeploy-20260928T214906Z-52bf75b6d205-fasos_staging.dump`.
  Arşiv okunabilirliği doğrulandı; ayrı, ağsız ve tmpfs tabanlı PostgreSQL 16.15
  restore tatbikatında **256** public tablo, **13** sentetik user ve **132/132**
  migration doğrulandı. Geçici restore container'ı kaldırıldı.
- Uygulama yalnız staging'de
  `staging-20260928T215554Z-52bf75b6d205` release'ine geçirildi. Uygulama ve DB
  healthy, app restart `0`, DB container başlangıç zamanı değişmedi; runtime
  `10042:10042`, read-only rootfs, `CapDrop=ALL` ve `no-new-privileges` kaldı.
  Yedi canonical public rota HTTP 200, ledger **132/132**, son loglarda
  fatal/unhandled `0` ve release-bound salt-okunur RBAC UAT **11 rol / 126
  kontrol PASS** verdi. External delivery, background ve social/portal worker
  kapıları kapalı kaldı; production değiştirilmedi.

## 29 Eylül person feed mutation atomikliği

- Kişi zaman çizelgesindeki note create/delete ve follow-up create/update
  mutation'ları ile bounded audit sonucu aynı DB transaction'ına alındı. Audit
  insert başarısızsa note/follow-up değişikliği rollback oluyor; feed event'i
  yalnız başarılı commit sonrasında yayımlanıyor.
- Follow-up audit'i gönderilen özel not içeriğini kopyalamıyor; yalnız kayıt
  kimliği ve değişen alan adlarını tutuyor. Note audit'i yalnız note kimliği ve
  internal görünürlük sınıfını içeriyor.
- Fault-injection matrisi **3/3**, genişletilmiş audit durability contract
  **159/159**, API typecheck ve birleşik security regression zinciri **PASS**.
  Bu takip dilimi henüz staging'e dağıtılmadı; production değiştirilmedi.

## 29 Eylül message campaign transaction bütünlüğü

- WhatsApp message campaign kaydı, bounded alıcı ledger'i ve create audit sonucu
  tek transaction'a alındı. Audit yazılamazsa kampanya veya kısmi alıcı seti
  commit olmuyor.
- Yalnız açık allowlist'teki kesin pre-send hata kodlarını yeniden kuyruğa alan
  safe retry; alıcı durumları, kampanya sayaçları ve audit sonucunu aynı
  transaction'da tamamlıyor. Ambiguous provider sonuçları retry dışı kalmaya
  devam ediyor; dış gönderim kapıları açılmadı.
- Retry fault-injection **2/2**, mevcut message-campaign contract **7/7**, audit
  durability **164/164** ve API typecheck **PASS**. Bu dilim henüz staging'e
  dağıtılmadı; production değiştirilmedi.

## 29 Eylül application lost-cascade audit bağı

- Application stage değişiminde öğrenci/lead statüsünü LOST'a taşıyan veya eski
  statüye geri alan lifecycle helper'ı artık global non-transactional audit
  helper'ını kullanmıyor. Cascade, restore ve açık skip sonuçlarının yedisi de
  çağıranın verdiği exact transaction executor'ına yazılıyor.
- Böylece cascade audit insert'i başarısızsa application stage, lifecycle marker
  ve student/lead status değişikliği birlikte rollback oluyor. Tekil ve bulk
  stage yollarındaki mevcut `executor: tx` bağı korunuyor.
- Application optimistic-concurrency contract **13/13**, audit durability
  **168/168** ve API typecheck **PASS**. Bu dilim henüz staging'e dağıtılmadı;
  production değiştirilmedi.

## 29 Eylül inbox local block atomikliği

- Inbox local external-contact block/unblock mutation'ı, block sırasında botun
  kapatılması ve bounded audit sonucu tek DB transaction'ına alındı. Audit veya
  bot güncellemesi başarısızsa contact block durumu da rollback oluyor.
- Gerçek WhatsApp provider block koridoru değiştirilmedi; explicit enable/live
  gate, rate-limit ve request/result audit sözleşmesini koruyor. Hiçbir provider
  bağlantısı veya dış gönderim açılmadı.
- Audit durability **172/172**, inbox indicator **3/3** ve API typecheck **PASS**.
  Tam inbox entegrasyon paketi fresh `132/132` şemalı disposable PostgreSQL
  `16.15` üzerinde; WhatsApp/Meta/Web Form signature gate, webhook dedup ve
  identity-resolution kontrolleriyle **PASS**. İlk VPS container denemesi host
  bellek baskısında `137` ile kapandı; aynı exact source yerel portable
  PostgreSQL üzerinde temiz sentetik DB ile tekrar edilerek geçti. Production
  değiştirilmedi.

## 29 Eylül authentication audit ve password-reset yarış koruması

- Login başarı/başarısızlık, e-posta doğrulama, parola sıfırlama isteği ve logout
  audit denemeleri response sonrasına bırakılmıyor; request yaşam döngüsünde
  tamamlanmaları bekleniyor. Legacy non-throwing audit uyumluluğu değişmedi.
- Password-reset token'ı hash üretimi sırasında iki eşzamanlı istek tarafından
  yeniden kullanılamıyor. Exact token + geçerlilik koşullu claim, parola yazımı ve
  tüm mevcut session'ların iptali ve `auth.set_password` +
  `auth.password_reset.complete` audit kayıtları tek DB transaction'ında;
  kaybeden istek `400` alıyor ve hiçbir parola/session/audit mutation'ı üretmiyor.
- Auth güvenlik sözleşmesi `39/39`, API typecheck ve birleşik security regression
  zinciri (hardening, replay, concurrency, cache, upload ve atomicity grupları;
  audit durability `125/125`) **PASS**.
- Exact code-bearing `92f0eb001cadde8476047295b765d308759b4cc6` commit'i
  `staging-20260928T212631Z-92f0eb001cad` release'i olarak staging'e alındı.
  Geçişten önce gerçek `fasos_staging` veritabanının checksum'lı custom-format
  yedeği alındı; network'süz geçici PostgreSQL `16.15` üzerinde `256` public
  tablo ve `13` sentetik user restore edildi, arşiv envanterinde cache
  invalidation function'ı ile üç trigger doğrulandı. DB container kimliği ve
  başlangıç zamanı geçiş boyunca değişmedi.
- Yeni release health/DB, `/healthz`, HSTS/noindex, altı canonical public rota,
  non-root `10042:10042`, read-only rootfs, `CapDrop=ALL`,
  `no-new-privileges`, restart `0`, migration source ledger `132`, üç cache
  trigger'ı/function ve fatal/unhandled log yokluğu kontrollerini geçti. Exact
  release'e bağlı salt-okunur RBAC UAT `11` rol ve `126` kontrolle yeniden
  **PASS** oldu. Live integration, email delivery, background job ve social
  provider/worker kapıları kapalı kaldı; production değiştirilmedi.

## 29 Eylül application bulk-stage finance atomikliği

- Tekil stage komutunda transaction içinde zaten üretilen kanonik finance
  projection'ı commit sonrasında ikinci kez çalıştıran yinelenen çağrı kaldırıldı.
- Bulk stage komutunda application stage, LOST lifecycle etkileri, student status,
  bounded audit sonucu ve kanonik finance projection artık aynı DB transaction'ında.
  Finance reconciliation başarısızsa stage değişimi de rollback oluyor; istemci
  commit edilmiş bir stage için yanıltıcı başarı/başarısızlık sınırında kalmıyor.
- Application concurrency/transaction contract **14/14**, audit durability
  **172/172** ve API typecheck **PASS**. Bu dilim henüz staging'e dağıtılmadı;
  production değiştirilmedi.

Web-form üreticileri dağıtımdan önce `X-Webform-Timestamp`,
`X-Webform-Request-Id` ve v1 zarfını imzalayan `X-Webform-Signature` sözleşmesine
geçmelidir. Eski token kullanımı yalnız kimlik doğrulama uyumluluğudur; replay
başlıklarını kaldırmaz. Migration additive'dir. Staging UAT ve deployment bu
dilimde yapılmadı.

## 29 Eylül final staging adoption

- Code-bearing commit `01d49e8620d96d0f520238aa3511ea08a821ac6e`, immutable
  `findandstudy-staging-app:01d49e8620d9` image'i olarak build edildi. Build;
  23-locale i18n parity, 121 frontend contract, public bundle budget, backend,
  portal-worker typecheck ve migration validation `132/132` kapılarını geçti.
- Geçişten önce doğru explicit `fasos_staging` hedefinden checksum'lı custom
  backup alındı:
  `staging-predeploy-20260928T221958Z-01d49e8620d9-fasos_staging.dump`.
  PostgreSQL `16.15`, `--network none` ve tmpfs kullanan restore drill; 132
  ledger satırı, 256 public tablo ve 13 sentetik user ile **PASS**. Yanlış
  default boş DB'yi hedefleyen ilk deneme kabul edilmedi ve onun iki dosyası
  exact path doğrulamasından sonra kaldırıldı.
- Yalnız staging app containerı `staging-20260928T223811Z-01d49e8620d9`
  release'ine geçirildi; staging DB containerı `2026-09-01T18:14:26Z` başlangıç
  kimliğini ve restart `0` durumunu korudu. App health/DB, healthz, HSTS,
  global noindex, yedi public/admin route, ledger `132/132`, non-root
  `10042:10042`, read-only rootfs, `CapDrop=ALL`, no-new-privileges, restart `0`
  ve fatal/unhandled log `0` kontrolleri **PASS**.
- Exact release'e bağlı salt-okunur RBAC UAT `11` role / `126` check ile
  **PASS**. Live integration, email delivery, background job, AI auto-reply ve
  tüm social provider/worker kapıları kapalı kaldı. Production'a dokunulmadı.

## 29 Eylül staff-card atomikliği ve public preload daraltması

- Staff profile, schedule, language, country, assigned-agent ve
  assigned-student mutation'ları ile bunların bounded audit sonuçları aynı DB
  transaction'ına alındı. Cascade assignment audit'i artık fire-and-forget
  değildir; audit başarısızlığında business mutation da rollback olur.
- Route kimlikleri strict positive integer olarak sınırlandı. Profil metinleri
  bounded, schedule `100`, dil `50`, ülke `100` kayıtla sınırlıdır. Profil audit
  payload'ı PII değeri taşımak yerine yalnız değişen alan adlarını tutar.
- Yeni staff-card fault-injection sözleşmesi **4/4**, API typecheck ve birleşik
  security regression zinciri **PASS**; audit durability paketi **172/172**
  geçti.
- SSR public asset helper'ı, route chunk'ının recursive import ağacını kritik
  preload kuyruğuna taşımayı bıraktı. Base HTML'deki paylaşılan vendor/runtime
  preload'ları korunurken yalnız ilgili route entry'si server tarafından
  ekleniyor. Program rotasındaki module-preload sayısı staging'de `19 → 4`
  oldu; dialog/upload/document gibi etkileşim-sonrası chunk'lar ilk ağ önceliğini
  artık tüketmiyor.
- Focused preload sözleşmesi **2/2**, public catalog SSR render **48/48**, 23
  locale parity, 121 frontend contract, sitemap, API typecheck ve production
  build/bundle budget **PASS**. Başlangıç JS gzip `143.884` byte, CSS gzip
  `41.306` byte olarak ölçüldü.

## 29 Eylül exact `34e1efb9c687` staging release ve CWV yeniden ölçümü

- Code-bearing `34e1efb9c6871b34fbce3acdfc694b8624a9bddf` commit'i immutable
  `findandstudy-staging-app:34e1efb9c687` image'i olarak build edildi. Image
  SHA-256 değeri
  `70f57661c17d17387d235a2d501dd5e7133cb205bec8528b0ed0528c0ec3d698`.
- Geçiş öncesi doğru `fasos_staging` hedefinden
  `staging-predeploy-20260928T230404Z-34e1efb9c687-fasos_staging.dump` yedeği
  alındı ve checksum doğrulandı. PostgreSQL `16.15`, `--network none` ve tmpfs
  kullanan izole restore; `132` ledger satırı, `256` public tablo ve `13`
  sentetik user ile **PASS**.
- Yalnız app containerı
  `staging-20260928T230557Z-34e1efb9c687` release'ine geçirildi. DB containerı
  `2026-09-01T18:14:26Z` başlangıç kimliğini ve restart `0` durumunu korudu.
  Health/DB, HSTS, global noindex, ledger `132/132`, non-root `10042:10042`,
  read-only rootfs, `CapDrop=ALL`, no-new-privileges ve fatal/unhandled log `0`
  kontrolleri **PASS**.
- Exact release'e bağlı salt-okunur RBAC UAT yeniden çalıştırıldı: **11 rol / 126
  kontrol PASS**. Live integration, email delivery, background job, AI
  auto-reply ve bütün social provider/worker kapıları kapalı kaldı. Production'a
  dokunulmadı.
- Aynı 390×844, Fast 4G, 4× CPU ve üç tekrar profiliyle altı public rota tekrar
  ölçüldü. Aggregate medyan LCP `3.176 → 3.060 ms`; program listesi LCP
  `3.556 → 3.356 ms`, şehir `3.580 → 3.380 ms`, ülke `3.256 → 3.060 ms` ve
  program detail `2.516 → 2.400 ms` oldu. Aggregate TBT `187 ms`, CLS `0`.
- CWV kapısı dürüstçe **FAIL** kalır: program listesi TBT `216 ms`, program
  detail TBT `226 ms`; ana sayfa, program listesi, ülke ve şehir LCP değerleri
  `2.500 ms` hedefinin üzerindedir. Yavaş kaynaklar yaklaşık `82,7 KB` React
  vendor, `41,3 KB` main JS, `39,5 KB` main CSS ve detail rotalarında `150 KB`
  tenant logo transferidir. Bu artık deploy doğrulaması değil, ayrı dar bundle,
  media ve gerçek HTTP/2/RUM optimizasyon kapısıdır.

## 29 Eylül notification rule ve portal control-plane atomikliği

- Notification rule create/update ile bounded audit sonucu aynı transaction'a
  alındı. Audit insert başarısızsa kanal, aktiflik veya template binding değişimi
  commit edilmiyor; audit template subject/body içeriğini değil yalnız event ve
  değişen alan adlarını taşıyor.
- Rule update artık arayüzün okuduğu exact `updatedAt` sürümüne bağlıdır. İki
  yönetici aynı eski kaydı düzenlerse ikinci yazı `409
  NOTIFICATION_RULE_VERSION_CONFLICT` alır ve arayüz authoritative listeyi
  yeniden yükler; sessiz last-write-wins yoktur.
- Portal automation global settings save ve portal credential upsert/delete
  audit sonuçları kendi mutation transaction'larına taşındı. Audit yazılamazsa
  automation policy veya credential/safety-reset sonucu görünür hale gelmiyor.
  Credential secret'ları audit payload'una eklenmedi; mevcut in-flight çalışma
  karantinası ve fail-closed sınırlar korundu.
- Notification fault-injection matrisi **4/4**, notification UI contract
  **15/15**, audit durability **178/178**, API ve frontend typecheck ile birleşik
  security regression zinciri **PASS**. Bu dilim henüz staging'e dağıtılmadı;
  production değiştirilmedi.

## 29 Eylül portal partner kararlarının atomik audit sınırı

- Portal partner oluşturma, düzenleme, silme; aktiflik, auto-process ve fan-out
  mode değişimleri ile bunların bulk karşılıkları business mutation ve audit
  sonucunu aynı PostgreSQL transaction'ında yazar. Audit insert başarısızsa
  partner/routing kararı da rollback olur; kayıtsız otomasyon kararı kalmaz.
- Aktivasyon/readiness kontrolleri transaction öncesindeki fail-closed kapılar
  olarak korunur. Deaktivasyon yine `autoProcess=false` ve `fanOutMode=off`
  kill-switch sonucunu aynı transaction'da uygular.
- Audit payload'ları yalnız partner kimliği, bounded ayar alanları ve etkilenen
  ID listelerini içerir; portal credential secret'ları bu koridora dahil değildir.
- Audit durability sözleşmesi bütün tekil ve bulk portal partner kararlarının
  legacy fire-and-forget `logAudit` yoluna geri dönemeyeceğini doğrular. Bu
  dilim staging'e henüz dağıtılmadı; production değiştirilmedi.

## Repo dışı veya ayrı kapı isteyen kalanlar

- Academy receiver tarafında issuer/audience + single-use exchange: receiver bu
  repoda değil; koordineli iki taraflı değişiklik gerekir.
- İncelenen staff-card/student/agent/internal-message attachment consumer'ları artık
  `FINALIZED → CONSUMED` zorunluluğunda. Repo genelindeki başka seyrek legacy
  consumer'lar envanter bazında kendi kayıt transaction'larına alınmadan global
  enforcement açılmaz.
- Application stage/owner komutu optimistic version bağı, durable audit ve finance
  projection'ını aynı transaction'da tamamlar; reconciliation hatası stage yazısını
  geri alır ve kaybeden yarış yan etki üretmez. Notification rule, portal global
  settings/credential ve portal partner control-plane yazıları da bu standarda
  taşındı; kalan düşük etkili portal adapter/test-queue yolları ayrı dar
  command/worker dönüşümleridir.
- High-impact legacy audit'lerin tamamını aynı transaction'da durable
  attempt/result receipt'e taşımak: kritik mevcut çağrılarda gerçek await sınırı
  kuruldu; failure durumunda business mutation'la atomik receipt için dar command
  migration'ları hâlâ gerekir.
- 80 legacy route'un tenant/capability koridoru: kademeli migration programıdır,
  tek global refactor değildir.
- Public katalog/Course Finder, notification count ve application/lead/student
  facet cache'leri committed PostgreSQL notification ile çoklu-process
  invalidasyon koridoruna alındı. Yeni process-local cache eklenirse aynı sözleşme
  veya yalnız kısa TTL ile açıkça sınıflandırılmalıdır.
- Academy/provider sandbox E2E, offsite restore/DR ve gerçek yüksek-hacim/CWV
  ölçümü harici ortam/credential veya operasyon penceresi gerektirir; production
  üzerinde otomatik çalıştırılmaz.
- Public web için gerçek HTTP/2 staging ölçümü, en az üç tekrarlı lab medyanı ve
  mümkün olduğunda saha p75/CrUX/RUM kanıtı olmadan CWV release kapısı kapanmaz.
  Mevcut tek-process HTTP/1 yerel laboratuvar regresyon kapısıdır; saha kanıtı
  veya üretim kapasite sertifikası değildir.
