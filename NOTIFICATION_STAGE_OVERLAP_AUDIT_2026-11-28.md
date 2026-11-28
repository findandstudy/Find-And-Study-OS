# Bildirimler, şablonlar ve aşama otomasyonları — çakışma incelemesi

Tarih: 28 Kasım 2026. Kapsam: staging ayarlarının salt okunur kontrolü ve güncel
uygulama kaynakları. Bu incelemede kural, kanal, gönderici veya runtime değişmedi;
gerçek iletişim, production erişimi, migration veya deployment yapılmadı.

## Üç ayrı sorumluluk

| Alan | Gerçekte yaptığı |
| --- | --- |
| Mesajlar → Şablonlar | Ortak içerik/dil sürümlerini hazırlar. Kaydetmek veya incelemeye göndermek olay ya da gönderim oluşturmaz. Hem genel olaylar hem aşamalar kullanabilir. |
| Ayarlar → Bildirimler | Mevcut olayın etkinliğini, kanalını ve alıcı kuralını yönetir; in-app, genel e-posta ve genel WhatsApp akışlarını başlatabilir. |
| Ayarlar → İş Akışı Aşamaları | Belirli aşamaya giriş için özel e-posta / onaylı WhatsApp şablonu ve gönderici seçer. DB trigger özel kuyruk kaydını oluşturur. |

Mesajlar bir ikinci otomasyon motoru değildir. Bununla birlikte genel olay
dispatcher'ı ile özel aşama dispatcher'ı iki ayrı gönderim üreticisi olduğundan
tek şablon merkezi tek başına çakışmayı önlemez.

## Staging'de doğrudan doğrulanan ayarlar

| Olay | Etkin | Kanallar | Alıcı kuralı |
| --- | --- | --- | --- |
| application.created | Evet | in_app | role |
| application.stage_changed | Evet | in_app, email | owner |
| application.offer_received | Evet | in_app, email, whatsapp | owner |
| application.visa_update | Evet | in_app, email, whatsapp | owner |
| application.offer_letter_expiring | Evet | in_app, email | owner |

Application, Lead ve Student aşamalarının her birinde etkin özel e-posta sayısı
0 ve etkin özel WhatsApp sayısı 0. İki özel aşama dispatch tablosu boş.
`PIPELINE_EMAIL_AUTOMATION_ENABLED/SINCE` tanımsız; `EMAIL_DELIVERY_DISABLED=true`,
`BACKGROUND_JOBS_ENABLED=false`, `ALLOW_LIVE_INTEGRATIONS=false`.
Dolayısıyla aşağıdaki riskler, mevcut kapalı staging ayarında fiilî bir çift
gönderimin kanıtı değildir; akışlar etkinleştirilmeden giderilmesi gereken kod
ve yönetim tutarsızlıklarıdır.

## Bulgular

### 1. Özel e-posta önceliği var; karar fazla dar — P1

`notificationDispatcher.ts:366` yalnız `application.stage_changed` ve aynı
user ID için `hasStageEmailForRecipient` kontrolü yapar. Özel intent güncel ve
uygunsa genel e-posta bastırılır; in-app ve diğer kullanıcıların mesajları kalır.
Bu olumlu bir korumadır.

Ancak helper (`stageEmailAutomation.ts:114`) intent'in varlığından sonra yeniden
`currentBinding` uygunluğunu değerlendirir. Öğrenci doğrulanmamışsa, gönderici
değişmişse, şablon onayı geri çekilmişse veya intent 24 saati geçmişse false döner.
Genel dispatcher ise aktif kullanıcı ve e-posta varlığıyla devam edebilir; aynı
özel alıcı/doğrulama sınırlarını zorunlu tutmaz. Böylece özel akışın engellendiği
bir bildirim başka bir genel SMTP/şablon yoluna düşebilir.

Öneri: konu sahipliği ile gönderilebilirlik ayrılmalı. Aşama akışı bu konuya
sahipse, gönderimin engellenmesi genel kanala sessiz fallback yetkisi vermemeli.
Hata gerekçesi ve kurtarma durumu gösterilmeli; belirsiz SMTP sonucu yeniden
gönderimle telafi edilmemeli.

### 2. WhatsApp'ta iki üretici arasında aynı koruma yok — P1

Genel WhatsApp yolu `notificationDispatcher.ts` içindeki `channels.includes("whatsapp")`
dalıdır. Özel aşama yolu `messageCampaignWorker.ts/processStageDispatch` üzerinden
onaylı şablon kampanyası oluşturur. Genel dalda özel stage dispatch'i ile ortak
konu/alıcı/kanal kontrolü bulunmadı. Genel `application.stage_changed` için WhatsApp
da açılırsa, doğrudan öğrenci başvurusunda iki yol aynı telefona gidebilir.
Her kuyruğun kendi dedup anahtarı bu iki farklı yolu birleştirmiyor.

### 3. “Otomasyon başvurularını sustur” kapsamı eşit değil — P1

Genel dispatcher `createdSource=automation` durumunda
`getSuppressAutomationAppNotifications` ayarını kontrol edip döner.
Özel e-posta trigger'ı/currentBinding ve özel WhatsApp aşama işleme yolunda aynı
kontrol bulunmadı. Genel bildirimleri kapalı görünen otomasyon başvurusu özel
aşama yoluyla dış iletişim üretebilir. Aynı ayar tüm ilgili üreticilerde, kuyruk
oluşturma ve gönderim öncesinde ortak biçimde uygulanmalı.

### 4. Kişisel bildirim tercihleri yalnız arayüz state'i — P1

`Settings.tsx` içinde `notifications` başlangıç değerleriyle useState olarak
tutuluyor. `NotificationRulesManager.tsx:517` yalnız setNotifications çağırıyor.
Bu alanlar için kalıcı kayıt/okuma ve dispatcher'da uygulama bağlantısı bulunmadı.
“Application Updates kapalı” seçimi şu anda sunucu tarafında e-posta susturma
kanıtı değildir. Tercihler kalıcılaştırılmalı ve ilgili bildirim politikasında
uygulanmalı; zorunlu güvenlik/sözleşme bildirimleriyle tercihli uyarılar ayrılmalı.

### 5. Özel WhatsApp ve özel e-posta alıcı modeli farklı — P1

Özel e-posta kullanıcının kararıyla Direct → öğrenci, Agent/Sub-agent → ilgili
acente hesabını seçer. Özel WhatsApp `startWhatsAppTemplate.ts` üzerinden
`quickContactTarget.ts/resolveApplicationMessageTarget` çağırır; telefon öğrenci
kaydından gelir. Agent ID bu fonksiyonda erişim/aidiyet kapsamıdır, acentenin
telefonu değildir. Dolayısıyla “aynı kaynak seçimi = aynı alıcı” varsayımı yanlış.
Bu farklılık panelde açıklanmalı veya kullanıcı tarafından kararlaştırılmış tek
alıcı modeli iki kanala birlikte uygulanmalı; kanalı değiştirirken sessiz alıcı
değişimi olmamalı.

### 6. Bazı olaylar tanımlı fakat doğrudan üreticisi bulunamadı — P2

`application.stage_changed` uygulama PATCH yolunda açıkça üretiliyor.
`application.offer_received` ve `application.visa_update` için API kaynaklarında
doğrudan dispatch çağrısı bulunamadı; olay kataloğu, öncelik ve değişken haritaları
mevcut. Panelde etkin olmaları bu olayların gerçekten üretildiğini kanıtlamıyor.
Yeni producer eklenirken aynı aşama geçişinden ikinci dış bildirim yaratmamalı.

### 7. Tekrar giriş ve hata semantiği ortak değil — P2

Özel e-posta `application_id+stage_key`, özel WhatsApp
`entity_type+entity_id+stage_key` ile yaşam boyu bir intent oluşturur. Genel
bildirim yolu aynı kısıtla bağlı değildir. Aşamadan çıkıp geri gelme, 24 saat
sınırı ve failed/skipped/unknown durumlarında iki motor farklı karar verebilir.
Tekrar bildirim kararı açık bir politika olmalı; dedup yalnız konu başlığına
veya metin benzerliğine değil, olay gerçekleşmesine, kayda, alıcıya ve kanala
bağlanmalıdır. Bilinmeyen SMTP sonucu otomatik fallback yaratmamalıdır.

### 8. Ajans kaynağı çözümleme noktaları farklı — P2

Genel PATCH bildirimi uygulamanın `agentId` alanına göre acente/ekip zincirini
çözer. Özel e-posta trigger'ı öğrencinin `agent_id` alanını kullanır ve worker
uygulama/öğrenci ajans çelişkisini engeller. WhatsApp hedefi uygulama agent ID'sini
önceler. Tek kaynak çözümlemesi ve açık çelişki durumu gerekir; çelişkide başka
bir kişiye otomatik yönlendirme yapılmamalı.

### 9. WhatsApp'ta geciken aşama mesajı için son durum denetimi eksik — P1

Stage worker kayıt, şablon ve hesabı çözüyor; `loadWhatsAppEntitySnapshot`
snapshot'ı güncel aşama alanını içermez. İncelenen stage/campaign akışında kuyruktaki
stage_key ile kaydın güncel aşamasını eşleyen son kontrol bulunmadı. Hızlı iki
geçişte eski aşama mesajı sonradan ulaşabilir. E-posta yolu bu aşama kontrolünü
zaten yapıyor; WhatsApp'ta da sender/origin/stage ve policy gönderimden önce
yeniden doğrulanmalı.

## Konu sahipliği için önerilen model

| Konu | Asıl tetikleyici / sahip | Korunacak diğer davranış |
| --- | --- | --- |
| Öğrenci/acente başvuru aşaması bilgisi | Özel aşama otomasyonu | Genel in-app ve sorumlu personele operasyonel uyarı kalır; aynı alıcı/kanala ikinci dış mesaj yok. |
| Yeni başvuru, yeni lead, görev, atama, finans, sözleşme, süre hatırlatması | Genel olay kuralı | Ortak şablon kütüphanesini kullanır; aşama mesajının yerine geçmez. |
| Offer/Visa aşamasına geçiş | Aşama otomasyonu | Genel Offer/Visa olayı aynı geçişin ikinci dış mesajı olmamalı. |
| Yeni offer belgesinin gerçekten hazır olması | Ayrı belge olayı, gerekiyorsa | Yalnız stage adıyla aynı konu sayılmaz; somut farklı içerik/amaç ve politika gerekir. |
| Ekip içi bilgilendirme | Genel in-app / personele kanal | Öğrenci/acente mesajını bastırmak ekip uyarısını kaldırmamalı. |

Kişiye/aşamaya göre gönderici değişse de ortak karar noktası
`olay/konu + kayıt + olay gerçekleşmesi + kanonik alıcı + kanal` üzerinde karar
vermeli. Alıcı/grant, tercih, otomasyon susturma, onay, stage ve gönderici doğrulaması
bu kararın parçaları olmalı. Şablon adı veya serbest başlık eşitliği dedup için
güvenilir değildir.

## Uygulama sırası ve kabul kontrolleri

1. Yukarıdaki konu sahipliğini ortak policy fonksiyonuna al; genel ve özel
   üreticiler aynı kararı kullansın. Otomatik fallback ile engelleri aşma.
2. Aynı olay/alıcı/kanal için kalıcı idempotency ve sahiplik receipt'i ekle;
   personel in-app bildirimlerini koru. Eski kuyruğu geriye dönük oynatma.
3. Kişisel tercihleri kalıcı ve sunucu tarafından uygulanır hale getir;
   automation-suppression ayarını iki üreticiye uygula.
4. WhatsApp alıcı ve güncel-stage doğrulamasını ortak politikaya bağla.
5. Panelde her kural/aşama için sahip, alıcı, seçili kanal ve neden atlandığını
   göster. Şablon oluşturma yine yalnız Mesajlar'da kalsın. UI 23 dili kapsasın.
6. Sentetik test matrisi: yalnız genel, yalnız özel, ikisi açık; Direct/Agent/
   Sub-agent; e-posta/WhatsApp; doğrulanmamış alıcı; emekliye ayrılmış şablon;
   değişen SMTP; kuyruk gecikmesi; aşamaya yeniden giriş; suppression; tercihler;
   kesin hata/belirsiz gönderim; personel uyarısının korunması. Gerçek gönderim yok.

Bu dosya inceleme ve öneri kaydıdır. Bulgular bu turda düzeltilmiş veya staging'e
deploy edilmiş olarak sunulmaz. Mevcut kapalı gönderim ayarları korundu.
