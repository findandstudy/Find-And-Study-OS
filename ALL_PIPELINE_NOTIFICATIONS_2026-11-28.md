# Ortak pipeline aşama bildirimleri — 28 Kasım 2026

Kapsam: yalnız staging; Apply/production değişmez. Önceki bağımsız işler bu değişikliğe dahil değildir.

## Model ve uygulama
- Şablonlar Mesajlar içindeki mevcut katalogda, gönderici hesapları Entegrasyonlar içinde kalır.
- Lead, Student, Application ve bağımsız iş pipeline aşamaları aynı alıcı (kaynağa göre/kişi/acente/sorumlu), onaylı şablon ve gönderici seçimini kullanır. İş kartlarında acente seçeneği yoktur.
- Kaynağa göre: acente öğrencisi acenteye, bireysel kayıt ilgili kişiye gider. Origin kapsamı ayrıca seçilir; yalnız direct varsayılandır. Geçersiz acenteden öğrenciye sessiz fallback yoktur.
- Değişen ayarlar aktif ve impersonation olmayan insan admin oturumuyla bağlanır; API client configuredById değerine güvenmez. Şablon/sender onay sözleşmeleri korunur.
- 0146 additive migration: kişisel tercih JSON'u, RLS kapsamlı ortak dispatch outbox ve dört entity için transactional trigger. Eski v1 tetikleyiciler v2 ayarlarında çalışmaz. Kayıt/aşama/kanal başına bir kez; geçmişe backfill ve aşamaya tekrar girişte otomatik tekrar yoktur.
- Şablon bağlamı tür bazlıdır. İş kartına öğrenci/program bilgisi uydurulmaz. E-posta versiyonu ve gönderici revision sabitlenir.
- Gönderim öncesi aşama, güncel ayar, aktör, kişi, şablon/sender ve tercih tekrar kontrol edilir. WhatsApp belirsiz sonucunda kör retry yoktur; crashed claim unknown olur. E-posta mevcut dayanıklı email_queue/SMTP yolunu kullanır.
- Genel stage kurallarından öğrenci/acente dış gönderimleri aşama motoruna aittir; ekip içi in-app korunur. Sorumlu seçiliyse aynı kullanıcı/kanal genel gönderimi de bastırılır. Diğer operasyonel olaylar mevcut sistem kurallarında kalır.
- Kişisel bildirim tercihleri artık sunucuda kaydedilir; yalnız local React state değildir.
- Ortak geçmiş görünümü tüm dört tür ve iki kanalı gösterir; SMTP kabulü inbox teslimi diye sunulmaz.
- Yeni 8 UI anahtarı tüm 23 locale dosyasında vardır; RTL yönlü kontroller ortak form yapısını kullanır.

## Güvenlik ve hazır olma sınırları
- Default-off runtime: mevcut PIPELINE_EMAIL_AUTOMATION_ENABLED + geçerli SINCE gerekir; background worker ve kanal kill switchleri ayrıca geçerlidir. SMTP'nin kapalı olması WhatsApp işleyicisini kapatmaz.
- Staging gerçek gönderimleri kapalı kalır. Şablon veya hesap eksikken otomatik sahte onay/seçim yapılmaz. Mevcut staging'de SMTP hesabı yok; iki e-posta taslağı review durumundadır.
- E-posta alıcısının adresi aktif, doğrulanmış hesapla tam eşleşmelidir. Portal hesabı bulunmayan CRM kişisi için e-posta sahipliği kanıtı henüz yoksa NOTICE_EMAIL_UNVERIFIED ile bloke edilir; bu sınırlama gizlenmez. WhatsApp E.164 ister.
- Bağımsız pipeline runtime'ının mevcut local/staging ve no-outbound sınırı korunur; bu teslim production activation değildir.
- Test transport injection yalnız localhost:5433/fasos_apply_local + NODE_ENV=test + no-outbound altında kabul edilir; HTTP endpoint'i yoktur.

## Yerel kanıt
- Migration journal: 147 dosya / 147 kayıt; 0146 SQL yalnız izole yerel PostgreSQL üzerinde denendi.
- Yeni PostgreSQL/sentetik test: 10 PASS; dört tür, iki kanal, paralel worker, mock SMTP ve WA, dedup, acente/kişi/sorumlu, sender revision, tercihler, stage drift, tenant RLS ve inactive configurator.
- Mevcut backend email/policy/queue + SMTP reference + PostgreSQL regression: 66 PASS.
- Email automation / integration UI: 23 PASS.
- i18n: 23 dil, anahtar/placeholder eşitliği PASS.
- API ve Edcons typecheck: PASS.

## Staging yayın sırası
1. Exact source commit ve temiz staging ağacı doğrula; release d7544f2997e7 baseline korunur.
2. Yeni custom-format DB yedeği + checksum + ayrı disposable PostgreSQL restore testi.
3. Kanonik staging runner ile expected prefix 146 → 147; additive değişiklik, eski veri backfill yok.
4. UID/GID 10042 build/release, yalnız staging app restart; mevcut env/secret ve outbound=false korunur.
5. Health exact release, admin ekranları, dört aşama kontrolü, Mesajlar şablonları/Entegrasyon hesapları/ortak geçmiş ve TR/RTL kontrolü.
6. Kod rollback: önceki image + release; migration additive olarak kalır. Veri geri yüklemesi normal rollback yolu değildir.

## Staging teslim kanıtı
- Kod local/GitHub: `d586f6db95ff77a42f085021fea543f3edd657a5` + `f4be55cb9dce4cde214c30d1b900aa38d59cf8eb`.
- Staging cherry-pick uçları: `f056dc614b3eebd1b90cc2c21c084c4460f52a96` + `74306a420d8e8d198f3a29880d4563fc4a454dda`; kaynak ağacı temiz.
- Final release: `staging-20261128T113646Z-74306a420d8e`, 28 Kasım 2026 14:36:46 Türkiye saati.
- Image: `findandstudy-staging-app:all-pipeline-notices`; healthy; UID/GID `10042:10042`; OCI source etiketi final source ile eşleşiyor.
- Public health: HTTP 200, `dbConnected=true`, exact release eşleşti.
- Taze checksum'lı custom-format staging DB yedeği ayrı network-none/tmpfs PostgreSQL 16 üzerinde restore edildi. Ledger/program/başvuru dönemi aggregate eşliği `146|151316|0` PASS; test container'ı kaldırıldı. Kanıt `/tmp/pipeline-notice-backup.json` ve `/tmp/pipeline-notice-restore.pass`; dump yalnız sunucunun staging backup dizinindedir, Git'e alınmadı.
- Canonical staging migration runner, least-privilege `fas_migrator`, exact source ve exact DB kimliğiyle `147/147` PASS. Yeni outbox boş (0); eski kayıtlar için backfill yapılmadı.
- Linux API/Edcons typecheck, backend seçili regresyonları ve normal frontend yayın kontrolleri/build/bundle budget PASS.
- Staging UI: Lead/Student/Application aşama düzenleyicileri, bağımsız pipeline Stages içindeki iki kanal ve alıcı seçenekleri görüldü. Deneme aç/kapatları kaydedilmeden kapatıldı; mevcut aşama politikaları değiştirilmedi.
- İngilizce + Arapça RTL formu görsel olarak kontrol edildi. Son düzeltme ile iş kartında başvuru ifadesi ve acente/origin seçenekleri kaldırıldı. Yeni toplam 10 UI anahtarı 23 dilde mevcut.
- Yeni genel WhatsApp alan eşlemeleri merkezi şablon oluşturucuya eklendi: recordName, recipientName, newStage, newStageKey, stageName, pipelineName, recordId.
- UI ile `Shared pipeline stage update` adlı ortak e-posta kimliğine EN ve TR sürümleri kaydedilip review'a alındı. Üç değişkeni bütün dört türde kullanılabilir. Aynı aktörün Approve version düğmesi disabled; farklı reviewer şartı korunuyor. Önizleme açıldı, gönderim yapılmadı.
- Settings Notifications ekranındaki ortak geçmiş GET başarılı/boş; readiness endpoint'i başarılı, 0 doğrulanmış sender ve 0 hazır policy. Tarayıcı error log'unda hata yok.
- Son env kontrolü: `PIPELINE_EMAIL_AUTOMATION_ENABLED=unset`, `EMAIL_DELIVERY_DISABLED=true`, `BACKGROUND_JOBS_ENABLED=false`, `ALLOW_LIVE_INTEGRATIONS=false`. SMTP account 0, aktif WhatsApp account 0. Gerçek provider teslimi bu ortamda test edilmedi ve aktif değildir.
- Final local API ve Edcons typecheck PASS; lokal yeni PostgreSQL 10, mevcut backend 66, UI 23 test PASS. E-posta / WhatsApp gerçek gönderimleri için hesap, şablon onayı ve kontrollü rollout ayrıca gerekir. Bu teslim bunları taklit etmez.
- Production Apply, eski sözleşmeler ve önceki bağımsız işler değiştirilmedi. Kod rollback için önceki `unified-email-templates` image ve korunmuş env kopyaları mevcut; additive migration geride bırakılabilir.
