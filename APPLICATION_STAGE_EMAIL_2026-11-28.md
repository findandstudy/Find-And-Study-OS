# Başvuru aşamasına göre e-posta — 28 Kasım 2026

## Doğrulanan başlangıç durumu

Staging release `staging-20261128T090314Z-59a28b040637` üzerinde salt okunur kontroller:

- 8 başvuru aşaması; e-postası etkin aşama 0.
- E-posta şablon sürümü/onaylı sürüm 0/0.
- Yönetilen SMTP göndericisi/doğrulanmış aktif gönderici 0/0.
- Aşama gönderim kaydı 0.
- `PIPELINE_EMAIL_AUTOMATION_ENABLED` ve `PIPELINE_EMAIL_AUTOMATION_SINCE` tanımsız.
- `EMAIL_DELIVERY_DISABLED=true`, `BACKGROUND_JOBS_ENABLED=false`, `ALLOW_LIVE_INTEGRATIONS=false`.

Kodda mevcut olanlar: aşama editörü, ayrı WhatsApp/e-posta ayarı, sürümlü şablon,
ayrı insan onayı, şifreli SMTP hesapları, DB transaction içinde intent, idempotent
kuyruk, son anda tekrar doğrulama, yeniden deneme ve redakte gönderim geçmişi.
Eski 21 Eylül belgesinin “yalnız öğrenci alıcısı” kuralı bu görevle değiştirilmiştir.

## Kullanıcının onayladığı alıcı modeli

Her Application aşamasında **ayrı ayrı** etkinleştirme, tam şablon/dil sürümü,
gönderici e-posta hesabı ve Direct/Agent/Sub-agent kaynakları seçilir.

| Seçilen başvuru kaynağı | Tek alıcı |
| --- | --- |
| Direct | Öğrencinin doğrulanmış aktif öğrenci hesabı |
| Agent | Öğrencinin bağlı olduğu acentenin doğrulanmış aktif acente hesabı |
| Sub-agent | Öğrencinin bağlı olduğu alt acentenin doğrulanmış aktif hesabı |

Kaynak seçimleri alıcı eşlemesini belirler; rastgele adres veya bütün rollere
yayın yapılmaz. Alt acenteden üst acenteye, acenteden öğrenciye veya personele
fallback yoktur. Katalog/CRM e-posta adresi ilgili kullanıcı hesabının adresiyle
eşleşmelidir. Alıcı bulunamazsa gerekçe ile atlanır. Gönderici de her aşamada
doğrulanmış SMTP hesabından seçilir; genel SMTP'ye sessiz fallback yapılmaz.

## Değişiklikler

- Kaynağa göre öğrenci/acente/alt acente alıcısı, kuyruk oluşturma ve SMTP öncesinde
  tekrar çözülür. Hesap/aidiyet/aşama/adres/şablon/gönderici değişikliği gönderimi durdurur.
- Genel aşama bildirimi yalnız özel aşama e-postasının gerçek alıcısı için
  bastırılır; personel ve diğer alıcıların bildirimleri korunur.
- Salt okunur `/api/notification-email/readiness`: üç çalışma anahtarı,
  uyumlu onaylı sürüm, doğrulanmış gönderici ve yapılandırılmış/hazır aşama sayıları.
  Mevcut aktif insan admin oturumu ve `private,no-store` sınırı korunur.
- Bildirimler ekranında hazırlık kontrolü ve aşama ayarlarına bağlantı.
- Gönderim geçmişinde yalnız ilk 100 yerine ileri/geri sayfalama; kaynak
  değiştirilince cursor sıfırlanır. SMTP/kuyruk hata kodu da görünür.
- Yeni açıklama ve kontroller tüm 23 dilde tamamlandı. Geçersiz eski “diğer diller
  İngilizce olabilir” uyarısı kaldırıldı.
- Migration, eski başvuruların taranması veya geriye dönük gönderim yoktur.

## Doğrulama ve sınırlar

- İzole `127.0.0.1:5433/fasos_apply_local` üzerinde gerçek PostgreSQL trigger →
  intent → kuyruk → bellek içi sahte SMTP kabulü → kalıcı sent receipt: 8/8.
  İki bağımsız sahte acente/alt acente alıcısı; öğrenciye/üst acenteye yanlış
  gönderim yok; doğrulama/adres değişimi engeli, dedup, rollback, eşzamanlı sweep,
  onay geri çekme ve tarih sınırı doğrulandı. Gerçek SMTP bağlantısı kurulmadı.
- E-posta policy/transport/template testleri 56/56; frontend e-posta testleri 15/15.
- i18n: 23 dil, 11.011 anahtar, key/placeholder parity PASS.
- API ve frontend TypeScript kontrolleri PASS.

Gerçek gönderimin açılması için gerçek gönderici hesabının kullanıcı tarafından
girilmesi, farklı insan adminin doğrulaması, şablon sürümünün insan onayı ve
istenen aşamalarda kaynağın seçilerek kaydedilmesi gerekir. Güvenlik anahtarları
bu görevde açılmadı. Gönderim için yeni aktivasyon zamanı tanımlanmalı; geçmiş
başvurular yeniden oynatılmamalı. `sent` yalnız SMTP kabulü, inbox teslimi değildir.

Production Apply'a, gerçek öğrenci/acente verisine ve gerçek iletişime dokunulmadı.
Önceki Academy düzeltmesi ve başvuru son tarihi işi aynı staging hattında korunur;
bu değişiklik bunların çalışma ayarlarını değiştirmez.

## Staging yayın kanıtı

- Son staging source: `18ff24bbbf141980d4451412491577680c8c66ad`.
- Release: `staging-20261128T095508Z-18ff24bbbf14`.
- `/api/health`: HTTP 200, `status=ok`, `dbConnected=true`; Docker `healthy`.
- Network kapalı build konteynerinde API/ön yüz typecheck, 56 e-posta testi,
  normal build'in 190 kontrolü ve asset/i18n bütçeleri PASS.
- Tarayıcıda İngilizce/Türkçe hazırlık kontrolü, kaynak ve gönderici seçicileri,
  gönderim geçmişi ve sayfalama doğrulandı. Aşama ayarlarına URL ile geçişte
  bulunan profil-sekmesi fallback'i düzeltildi; reload sonrası Pipeline Stages
  başlığı doğrudan geldi.
- Son salt okunur kontrol: migration ledger 146; etkin e-posta aşaması 0;
  aşama gönderim kaydı 0. Hiçbir gerçek kayıt için gönderim oluşturulmadı.
- Yönetim ekranı: `/admin/settings?tab=notifications#notification-email`.
- Yerel test ekinde öğrencinin portal hesabı olmadan acente alıcısının çalışması
  ve acente hesabının staff rolüne dönmesi halinde gönderimin engellenmesi de PASS.
