# Başvuru aşaması e-posta otomasyonu — yerel uygulama

Tarih: 21 Eylül 2026. Branch: `codex/public-detail-staging-20260919`.
Uygulama tabanı: `1592fb6127ce6d420c46c5ef8708f383aa6505d4`.
Bu kayıt yalnız yerel kod ve sentetik test kanıtıdır; dağıtım veya gerçek gönderim kanıtı değildir.

## Tamamlanan fazlar

1. **Şablon ve gönderici kütüphanesi:** mevcut mesaj şablonu kimliği ve kanal hesabı kullanıldı. E-posta sürümleri, ayrı kişi onayı, emeklilik, güvenli önizleme ve birden çok SMTP hesabı eklendi.
2. **Aşama ayarı:** Application Pipeline içinde WhatsApp'tan bağımsız Automatic Email; onaylı sürüm, gönderici, Direct/Agent/Sub-Agent seçimi. Eski istemci e-posta alanını göndermediğinde kayıt korunur.
3. **Güvenli tetikleme:** başvuru aşaması değişikliği ile gönderim niyeti aynı DB işleminde kaydedilir. Mevcut e-posta kuyruğuna aktarım atomiktir. Gönderim başarısızlığı aşama değişikliğini SMTP'ye bağımlı kılmaz.
4. **Ortak bildirim bağlantısı:** Notifications içinden yeni e-posta şablonu ve mevcut sistem olaylarına onaylı şablon/gönderici bağlama. Yeni şablon oluşturmak yeni olay üreticisi oluşturmaz. WhatsApp editörü Mesajlar'da korunur, iki ekran arasında bağlantı vardır.
5. **Yönetim ekranı:** şablonlar, göndericiler, aşama/sistem gönderim geçmişi; TR/EN metinler, diğer dillerde belirtilen İngilizce fallback. İçerik dili için mevcut 23 locale korunur.
6. **Doğrulama:** gerçek localhost HTTP/oturum/PostgreSQL testleri, sahte SMTP ile gerçek kuyruk kodu, tip/derleme, masaüstü/mobil/RTL sentetik tarayıcı kontrolleri.

## Kullanım ve davranış

- Ayarlar → Bildirimler → E-posta otomasyonu: şablon ekle, Applications veya ilgili sistem kategorisini seç, içerik dilini ve değişkenleri belirle.
- Sürüm akışı: taslak → incelemede → farklı yetkili kişi onayı → gerekirse kullanımdan kaldırma. Onaylı içeriği değiştirmek yerine yeni sürüm oluşturulur. Bağlantılar tam sürüme sabitlenir; son sürüme sessiz geçiş yoktur.
- Gönderici hesabı şifreli saklanır; API şifreyi geri döndürmez. Düzenleme revision'ı artırır ve doğrulamayı kaldırır. Başka bir yetkili yöneticinin bağlantı/kimlik doğrulaması gerekir.
- SMTP doğrulaması e-posta göndermez; DNS alan adı sahipliği, SPF/DKIM/DMARC veya gelen kutusuna teslim kanıtı değildir.
- Ayarlar → Pipeline Stages → Application aşaması → Automatic Email: onaylı sürüm, doğrulanmış aktif gönderici ve kaynakları seç.
- Varsayılan kaynak Direct'tir. Agent/Sub-Agent seçimi **öğrencinin kaynağıdır**, alıcı acente değildir.
- Alıcı, öğrenci kaydındaki e-posta ile eşleşen **aktif, doğrulanmış student hesabı** olmalıdır. Hesabı/e-posta doğrulaması olmayan kayıtlar atlanır ve neden geçmişe yazılır. Bu özellik doğrulama e-postasının yerine geçmez.
- Her başvuru/aşama için yaşam boyu bir gönderim niyeti oluşur. Aynı aşamaya tekrar giriş, ayarı tekrar kaydetme veya worker retry yeni gönderim yaratmaz. İlk başvuru oluşturma da yapılandırılmış başlangıç aşamasına giriş sayılır.
- Ayar kaydetme mevcut başvuruları tarayıp mesaj göndermez. Aktivasyon zamanından önceki veya 24 saatten eski niyetler atlanır. Atlanan kaydın sonradan uygun olması otomatik tekrar gönderim başlatmaz.
- Gönderim öncesi öğrenci, güncel aşama/kaynak, adres, kullanılan bilgiler, şablon onayı ve gönderici revision'ı tekrar denetlenir. Şablon/gönderici değişirse başka hesaba sessiz fallback yoktur.
- Uygun aşama e-postası varsa öğrencinin genel aşama bildirimindeki e-posta tekrarı bastırılır; personel/acentenin bildirimleri ve uygulama içi bildirimler korunur.
- Geçici ve kesin gönderilmemiş hata sınırlı retry alır. SMTP sonucu belirsizse `unknown` olur, otomatik yeniden gönderilmez. `sent` yalnız SMTP kabulüdür; gelen kutusuna teslim veya okunma değildir.
- Gönderim geçmişi gövdeyi, adresi, parolayı veya ham sağlayıcı hatasını döndürmez. İlk arayüz son kayıtları gösterir; daha eski kayıtların UI sayfalaması backlog'dadır.

## Yeniden kullanılan mimari ve yeni yerel parçalar

Kanonik `message_templates`, `channel_accounts`, `email_queue`, notification rules/events, uygulama aşamaları, mevcut worker koordinatörü, şifreleme, SMTP/TLS/SSRF koruması, marka e-posta kabuğu ve HTML temizleme kullanıldı.

Yeni iki tablo: `message_template_email_versions` ve `pipeline_stage_email_dispatches`. WhatsApp kuyruğu ve benzersizlik anahtarı değiştirilmedi. E-posta outbox'ı yalnız başvuruya ait intent/snapshot taşır; paralel bir mesajlaşma servisi değildir. Migration'lar yalnız additive `0124` ve sorgu indeksi `0125`tir; geçmiş şablonlar otomatik onaylanmaz, hesaplar otomatik doğrulanmaz.

Eski doğrudan e-posta gönderimi de mevcut kuyruk üzerinde önce kalıcı kayıt/atomik claim kullanır. Böylece worker ile anlık gönderim yarışında ikinci SMTP çağrısı önlenir. Ekler retry sırasında korunur (en fazla 5 dosya / toplam 10 MiB); eski çağrıların boolean dönüş sözleşmesi korunur. Genel e-posta yolundaki bu güvenlik değişikliği nedeniyle dağıtım ve rollback birlikte değerlendirilmelidir.

Yeni yönetim uçları mevcut insan admin/super-admin oturumu gerektirir. Manager, API token ve impersonation kabul edilmez; eski hesap/şablon düzenleme uçlarından yeni onay kuralları aşılamaz. Bu, legacy platform yönetim sınırıdır; tamamlanmış çok-tenant Control Plane/RLS geçişi iddiası değildir. Güvenlik envanterinde yeni writer'lar karantinada kalır; external pilot allowlist sıfırdır.

## Değişen dosyalar

Repo köküne göre yollar:

- `lib/db/drizzle/0124_pipeline_email_automation.sql`, `0125_pipeline_email_history_lookup.sql`, `meta/_journal.json`: additive schema, atomik intent ve history indeksi.
- `lib/db/src/schema/emailAutomation.ts`, `emailQueue.ts`, `pipeline.ts`, `index.ts`: sürüm/outbox, kuyruk alanları ve aşama ayarının tipleri.
- `artifacts/api-server/src/lib/notifications/{emailAutomationPolicy,emailSenderAccounts,emailTemplateLibrary,emailRuleBinding,stageEmailPolicy,stageEmailAutomation}.ts`: yetki, şablon, sender, bağlama ve runtime politikaları.
- `artifacts/api-server/src/lib/email.ts`, `emailDeliveryPolicy.ts`: dayanıklı claim, ekler, seçilen gönderici, kill switch, sonuç sınıflandırması.
- `artifacts/api-server/src/lib/notificationDispatcher.ts`: onaylı sürüm/gönderici bağlama ve öğrenci tekrarını bastırma.
- `artifacts/api-server/src/routes/{emailAutomation,pipeline,notifications,applications,channelAccounts,messages,index}.ts`: yönetim uçları, ayar doğrulaması, olay applicationId bağlamı ve legacy bypass kapatma.
- `artifacts/api-server/src/index.ts`: yalnız e-posta kuyruğunun açılışta belirsiz claim kurtarma davranışı.
- `artifacts/api-server/scripts/{test-email-delivery-policy,test-email-queue-delivery,test-email-template-library,test-stage-email-policy,test-postgres-stage-email,test-postgres-email-library}.ts`: yeni regresyonlar.
- `artifacts/api-server/package.json`: doğrudan test komutları; saf e-posta testleri mevcut security-regressions zincirine eklendi.
- `artifacts/edcons/src/components/notifications/{EmailAutomationManager,EmailAutomationFields}.tsx`, `{emailAutomationModel,useEmailLibrary}.ts`: yönetim ve seçiciler.
- `artifacts/edcons/src/components/{NotificationRulesManager,EditStagesDialog}.tsx`, `hooks/use-pipeline-stages.ts`: mevcut ekran ve veri akışına ekleme.
- `artifacts/edcons/src/pages/staff/{Settings,Messages}.tsx`: mevcut sekmelere karşılıklı bağlantı.
- `artifacts/edcons/scripts/test-email-automation-ui.ts`, `test-email-automation-browser.mjs`, `artifacts/edcons/package.json`: UI/model ve sentetik browser testleri.
- `security/{legacy-role-gate-registry,tenant-writer-registry}.json`: yeni yüzeylerin sınıflandırılması; izin genişletme değil.
- `AGENTS.md` ve bu belge: yerel kanıt, operasyon sınırları ve sonraki adımlar.

## Test kanıtı

- Son birleşik API çalışması: **130/130 PASS**, skip yok. E-posta politika/queue/library, stage policy, gerçek HTTP/oturum/DB, agency, student verification ve security regresyonları. Gerçek HTTP kütüphane testi 16/16; başarılı pipeline PUT, eski istemcide ayarı koruma, üç kaynak seçimi ve WhatsApp ayarını koruma dahildir. Testin bulduğu JSONB anahtar sırası hatası semantik karşılaştırmayla giderildi.
- Normal security-regressions zincirinin genişletilmiş çalışması ayrıca **115/115 PASS**; önceki testlerle örtüşür, ek benzersiz test sayısı değildir. Ortak pipeline fixture'ları kullanan DB suite'leri `--test-concurrency=1` ile sırayla çalışır ve özgün stage/portal ayarlarını sonunda geri yükler.
- UI model: **15/15 PASS**; System Health regresyonlarıyla toplam **32/32 PASS**. Yerel derlenmiş uygulamada mock API ile EN masaüstü 1440, TR mobil 390, AR RTL 390: **3/3 PASS**. Manager, impersonated admin ve capability isteği reddedilen oturumda legacy bildirim kuralları salt okunurdur; düzenleme/toggle kapalı ve API yazısı sıfırdır. Bu gerçek staging/SMTP UAT değildir.
- Shared TypeScript build, API typecheck/build ve frontend typecheck/Vite build: **PASS**. Vite'ın mevcut chunk-size/sourcemap uyarıları hata sayılmadı.
- Yeni ve boş PostgreSQL 16.15 cluster yalnız `127.0.0.1:5433/fasos_apply_local`: fresh `0→125`, index `125→126`, temiz `126→126` replay: **PASS**. Üretim dump/credential/PII kullanılmadı.
- Role route inventory: 80 dosya, 881 kayıt, hata yok. Writer inventory: 200/200 sınıflı, external allowlist 0. `git diff --check`: **PASS**.
- Bu sayılar tüm monorepo testlerinin veya gerçek sağlayıcı tesliminin geçtiği anlamına gelmez.

Tekrar komutları (pinned pnpm 10.33.2; PostgreSQL testleri yalnız disposable localhost test DB ile):

```text
pnpm --filter @workspace/api-server test:email-automation
pnpm --filter @workspace/api-server test:postgres-email-automation
pnpm --filter @workspace/edcons test:email-automation
pnpm --filter @workspace/edcons test:email-automation-browser
node lib/db/validate-migrations.mjs
```

## Dağıtım/aktivasyon — bu görevde yapılmadı

1. Ayrı staging dağıtım yetkisi, incelenmiş exact commit, veritabanı/ledger kimliği ve rollback planı doğrulanmalı. Gerçek DB satır sayısı, migration lock süresi ve kapasitesi önceden ölçülmeli; eski DB'de indeks oluşturma maliyeti bu küçük fixture testiyle kanıtlanmış değildir.
2. E-posta tüketicilerini durdurup dış gönderimi kapat. `0124` ve `0125` yeni worker/code'dan **önce** uygulanmalı. Eski/yeni e-posta worker'larını eşzamanlı çalıştırma; eski worker yeni revision/claim kurallarını bilmez.
3. Yeni kodu önce `PIPELINE_EMAIL_AUTOMATION_ENABLED=false`, `EMAIL_DELIVERY_DISABLED=true`, `ALLOW_LIVE_INTEGRATIONS=false` ile staging'e al. Migration, ayar roundtrip, WhatsApp, contract/reset/verification ekli e-posta regresyonlarını kontrol et.
4. Gerçek sağlayıcıya bağlanma/gönderim ayrı onaylı test hesabı ve alıcıyla yapılmalı. İki ayrı admin, gönderen kimliği, SPF/DKIM/DMARC, unsubscribe/suppression ve kurumsal iletişim politikası doğrulanmalı. Yeni akış işlemsel aşama bildirimi içindir; pazarlama kampanyası/izin kazanımı sağlamaz.
5. Onaylı pilotta tam UTC ISO aktivasyon zamanı `PIPELINE_EMAIL_AUTOMATION_SINCE` ve explicit `PIPELINE_EMAIL_AUTOMATION_ENABLED=true` gerekir. Ayrıca mevcut dış entegrasyon/delivery/worker kapıları açık olmalıdır. Geçmişi geriye dönük açmak için eski SINCE verilmez.
6. Rollback: önce delivery kapısını kapat, e-posta tüketicilerini durdur ve in-flight işleri incele. `unknown` kayıtları sağlayıcı kanıtı olmadan retry etme. Additive tabloları/sütunları koru. Yeni kuyruk kayıtları varken **yalnız eski kodu geri koymak güvenli rollback değildir**; eski consumer'ın yeni kayıtları göndermesine izin verme. Veri silme veya down migration yok.

## Açık kapılar / backlog

- Gerçek staging UAT, kontrollü SMTP hesabı doğrulaması ve kontrollü alıcıya teslim testi; production/deploy ayrı yetkidir.
- Provider bounce/complaint callback'leri, teslimat makbuzu, domain doğrulaması ve operatörün `unknown` olayını çözme aracı.
- Eski kayıtlar için history UI sayfalaması ve arayüzün TR/EN dışı yerel çevirileri.
- Yeni event producer'ları, Lead/Student aşamalarına e-posta ve Telegram/SMS yeniden tasarımı bu sürümde yoktur.
- Tam Control Plane/tenant-corridor geçişi mevcut ayrı güvenlik programıdır; bu modül onu by-pass etmez veya tamamlandı saymaz.

Yerel aday durumu: **READY FOR STAGING UAT**; **CANLI GÖNDERİM KAPALI**.
