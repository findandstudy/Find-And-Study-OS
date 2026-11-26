# Apply sözleşme PDF hazırlama geçişi — 26 Kasım 2026

Durum: **dar `prepare` production geçişi tamamlandı ve doğrulandı.** Tüm sözleşme/e-posta sorunları çözülmüş sayılmaz; aşağıdaki açık sınırlar sürer.

Kullanıcı, önce sunulan dar production planını onayladı ve staging uçtan uca sınırları açıklandıktan sonra “tamam ozaman önce applyi halledelim” diyerek Apply önceliğini doğruladı. Yetki, `25164abd3616606029584f0c5a60c0a45f4e8aa8` adayını ve yalnız 0067 + `prepare` geçişini kapsar. Sözleşme SMTP gönderimi, geçmiş imza kurtarması ve hesap onayı kapsam dışıdır.

## Geçiş öncesi kanıt

- Gerçek Apply kaynak ağacının 1.803 dosyası yeniden doğrulandı. Mevcut 13 drift ve 4 ek dosya korunur; staging ağacı Apply üzerine kopyalanmaz.
- Yeni özel yedek: `/srv/academy160-preview/backups/contracts-prepare-20261126`. DB custom dump 6.007.824.102 byte, SHA-256 `a78c493f98eaa7e53a9f9c6c669b2fb8ba6dfedd9a99dcfb1d8c0ec430c32a43`; restore-list doğrulandı. Storage arşivi 1.453.574.873 byte, SHA-256 `7ac2dd6e88d8c349c09dc8c873fea2c3bedf315b520dbd7e754a16529a5a4a82`; gzip/tar bütünlüğü doğrulandı. Bu kontroller tam felaket kurtarma tatbikatı iddiası değildir.
- Migration runner gerçek 67-entry prefix + production schema-only kopyasında, ağsız geçici PostgreSQL ile çalıştı. 67→68, iki FK, sıfır delivery satırı PASS. İkinci uygulama reddedildi, ledger değişmedi. DDL süresi 0,062 saniye. Test container'ı kaldırıldı.
- İzole testin ilk denemesi mevcut olmayan PostgreSQL image etiketi nedeniyle container oluşturmadan durdu. Mevcut, kimliği sabit PostgreSQL image kullanılarak tekrar geçti; production DB'ye test yapılmadı.
- Salt okunur geçiş dry-run: yedek checksum, kaynak/build hash, geri dönüş dosyaları ve symlink sınırları, gerçek ledger ve genel mail ayarları PASS.

## Dar logo değişikliği

İki public marka görseli, önceki doğrulanmış Apply→staging aktarım manifestinden hash kontrollü olarak hazırlanır. Yeni sözleşmelerin logo snapshot'ı dış entegrasyon izni açmadan Apply'nin kendi public storage yolundan alınır.

- Find & Study normalize PNG: `a49ea4eb2e76dc9472e4e97db501a55a5fe9ea6160f5b0355d1f202a39f8ab57`, 45.266 byte. Eski `logotest-scaled.png` adresinin yerine önceki aktarımda doğrulanmış canonical `find-and-study.png` kaynağı kullanılır; bunların özgün byte'larının aynı olduğu iddia edilmez.
- Dorm Booking normalize PNG: `f2aacdbe6269676774cf67b72f5decdab9d2f5d09785cebe3c6672777991d933`, 42.177 byte.
- Yalnız brand profile 1/2 ve template 14'ün gelecekte çözümlenecek logo URL'si CAS ile değiştirilir. Session/signed snapshot ve imzalar değiştirilmez. Diğer aktif şablonlar, sonradan eklenen template 49 dahil korunur.

## Güvenli geri dönüş

Eski kodun yeni `SIGNED_CONTRACT_DELIVERY_ENABLED=false` anahtarını tanımadığı doğrulandı. Bu nedenle eski image'i kör biçimde yeniden başlatmak güvenli geri dönüş değildir.

Eski gerçek kaynak ve eski derlenmiş arayüzden ayrı rollback paketi hazırlandı; yalnız sözleşme teslimat dosyasındaki beş girişe açık false kontrolü eklendi. Global mail ve diğer işler korunur. Kaynak, bağımlılıklar, UI ve API artifact hash'leri bağımsız doğrulanır. Yeni container durmadan ve scheduler kilidi serbest kalmadan geri dönüş başlamaz. Durdurma belirsizse otomatik ikinci worker başlatılmaz.

Geri dönüş DB restore etmez; additive tablo, yeni kayıt/PDF ve receipt'ler korunur. Aynı public görselleri gösteren geleceğe dönük logo URL'leri yerinde kalabilir. Eski admin Regenerate davranışı güvenli kabul edilmez ve kullanılmaz.

## Açık sınırlar

- `prepare` yalnız yeni uygun sözleşmelerin PDF'sini hazırlar; sözleşme SMTP gönderimi kapalıdır. OTP/davet/diğer bildirimlerin genel ayarları değişmez.
- Daha önce açılmış signing linklerinde logo snapshot eksikliği sürebilir. Geçmiş kayıtlar otomatik kuyruğa alınmaz.
- TEST02 / signed contract 47'nin özgün frozen logo kanıtı eksiktir; güncel logo geçmiş imzaya yerleştirilmez.
- İmzalama, yönetici onayı değildir. Application 12 için `approved_at=NULL` olduğundan “inceleme altında” doğru kalır; bu dağıtım onay vermez.
- Kullanıcının mevcut Chrome profilinde staging PDF'nin nihai diske kaydı hâlâ ayrıca doğrulanmalıdır. İzole PDF testleri bu boşluğu kapatmış sayılmaz.

## Gerçek dağıtım sonucu

- Başlangıç: 26 Kasım 2026 08:49:16 Türkiye saati (`05:49:16Z`); tamamlanma `08:49:35` (`05:49:35Z`). Bu 19 saniye bütün switch aralığıdır; ölçülmüş kesinti süresi olarak sunulmaz.
- Release: `20261125T212151Z-contracts-25164abd3616`.
- Container: `df6958c7ec341ea4ab63b8ca18dc8ca8e2d4e144ea2443216f6bad7510198206`.
- Runtime image: `sha256:71041ca4caee1362fd07dc9d183a4e90b0b4ef8fbd1825e9c6144a53773c88bd`; Node 22.23.4 + Chromium, kullanıcı `10000:10000`, read-only root + init.
- Yalnız 0067 migration transaction'ı COMMITTED; production ledger **68**, önceki 67 satır/hash aynen korundu. Transaction 0,096 saniye sürdü. Yeni kuyruk boş; geçmiş imzalar taşınmadı.
- İki public logo hash'i Apply HTTP üzerinden doğrulandı; brand profile 1/2 ve template 14 CAS güncellendi. Genel entegrasyon izinleri açılmadı.
- Genel OTP/davet/mail ortam ayarları aynı; sözleşme modu `prepare`, iki eski sözleşme worker anahtarı `false`. Beklenmeyen `sending/accepted` durumu yok.
- Tek scheduler kilidi var. İlk döngü sonrası 55 saniyelik gözlemde sözleşme sweep hatası, eski delivery/PDF worker başlangıcı ve restart sayısı **0**.
- TEST02 / signed contract 47'nin tüm satır hash'i önce/sonra aynı. İmza, PDF, evidence ve e-posta kaydı değiştirilmedi.
- Diğer **48 container** başlangıç ve running durumları değişmedi; portal worker, PostgreSQL ve gateway yeniden başlatılmadı. Ağ adresleri korunarak Nginx reload ihtiyacı oluşmadı.
- Apply ana sayfası tarayıcıdan açıldı. Dış `/api/health`, yeni release + `dbConnected=true` gösterdi; 78 saniye uptime ile tekrar doğrulandı. [Tarayıcı kanıtı](../../uat-evidence/apply-contract-20261126/health.jpg).

Sunucu kanıtları, yukarıdaki özel yedek dizininde: `backup-receipt.json`, `migration-receipt.json`, `deployment-receipt.json`, `postcheck-receipt.json`, `runtime-observation.json`. İçinde secret bulunan `*.private.*` dosyalar Git'e eklenmedi veya sohbete yazılmadı.

Geçiş aracı SHA-256: `162618fa5aade6d281a8337c90c7046aed7632216550fe5eace86a1b032cc7bb`. Migration runner SHA: `fd4f6f23634025a3be943fdf59f187aa8988c428cfeb0675afc095f50dcf99bc`. Prepared araçlar `/opt/findandstudy-staging/backups/apply-contract-candidate-v2-20261125` altında tutulur; bu yol staging DB kullanıldığı anlamına gelmez.

## Geri dönüş tatbikatı sonucu

Guarded eski API ayrı ağsız PostgreSQL namespace'inde gerçekten açıldı. İki HTTP 200 + DB health, `10000:10000`, global jobs açık, sözleşme işleri kapalı, 48,38 saniyelik gözlem, gerçek V8 guarded-entry çağrısı (1), sıfır business row değişikliği ve graceful exit 0 PASS. Scheduler kilidi alındı ve bırakıldı. Yalnız teste ait iki container kaldırıldı. Built rollback API SHA: `3e346bc55b86b40fae718568a842434af0ec2063a821cc43520c4d1e61e994ba`.

Gerçek dağıtımda rollback gerekmedi. Eski container `academy160-apply-before-contracts-20261126` olarak durmuş ve ağdan ayrılmış biçimde korunur; **bu orijinal container doğrudan yeniden başlatılmaz**. Gerekirse ayrı guarded rollback paketi `/opt/findandstudy-staging/backups/apply-contract-rollback-20261126/release` kullanılır. Her durumda önce çalışan yeni API durdurulup scheduler kilidi bırakılmalıdır; DB restore yapılmaz.

## Doğrulanmamış olanlar

Production'da test için imza atılmadı, yeni başvuru/hesap onaylanmadı, sözleşme gönderilmedi. Bu nedenle bu kayıttan yeni bir gerçek imzaya ait uçtan uca PDF/SMTP başarı sonucu çıkarılamaz. PDF üretimi izole testlerde doğrulanmıştır; mevcut TEST02/47 indirmesi hâlâ kurtarma bekler. Staging bu tur değiştirilmedi; Apply'a özgü 0067 ve container konfigürasyonu staging'in farklı migration zincirine aynen kopyalanmaz.
