# TEST02 / sözleşme47 teslimat hazırlığı

Bu araç yalnız contract47 / session165 / template48 / application12 ve `en+agency-uat-20261125-02@findandstudy.com` TEST adresi içindir. Genel tarihsel kayıt taşıması değildir. Çalıştırılması mevcut signed PDF, imza, başvuru onayı veya hesap yetkisini değiştirmez; e-posta göndermez ve worker başlatmaz.

## Hazırlık kapıları

- Önce `CONTRACT47_CONTROLLED_RECOVERY.md` içindeki ayrı PDF onarımı uygulanmış ve özel dosya/depolama kanıtları doğrulanmış olmalıdır. PDF yoksa bu araç üretmez.
- Manifest tam kaynak dosya SHA-256 listesini, gerçek PostgreSQL database/address/port/role kimliğini, storage kökünü, önceki recovery manifest byte hash'ini, tam onarım sonrası snapshot hash'ini, final PDF key/byte hash/evidence hash'ini ve sabit message ID'yi bağlar.
- Yalnız orijinal PDF/key alanları null'a çevrilerek önceki recovery snapshot hash'i yeniden doğrulanır. Onay durumu, ilişki, metin, tarih, imza veya intake alanındaki başka değişiklik resetlenmez; işlemi engeller.
- Mevcut delivery satırı (durumu ne olursa olsun), session/message ID çakışması, `emailed_at` veya aktif legacy claim işlemi engeller. Otomatik yeniden deneme yoktur.
- Kaynak CLI/helper gerçekten incelenmiş source-root içinden çalışmalıdır. Ana uygulamanın DB pool'u, sağlayıcı veya e-posta modülü yüklenmez.
- CLI yalnız Linux'ta mevcut pinned private-file okuyucusuyla çalışır: symlink/hardlink, yanlış uid/mode/path ve değişen byte/hash reddedilir. PDF ve `.ct` MIME dosyası depodan okunur. Recovery asset sidecar, ayrı onay ve provenance dosyaları kendi hash'leriyle eşleşmelidir.
- Reconstructed branding için e-posta başlığı ve hem HTML hem metin gövdesi tarihsel logo byte'larının kanıtlanmadığını açıklar. İçerik sabit kaynak metniyle birebir eşleşmek ve manifest email hash'ini geçirmek zorundadır. Hash'i yeniden hesaplanmış farklı/açıklamasız içerik kabul edilmez.
- CLI ortamında `SIGNED_CONTRACT_DURABLE_DELIVERY_MODE=prepare`, `SIGNED_CONTRACT_DELIVERY_ENABLED=false`, `SIGNED_CONTRACT_PDF_WORKER_ENABLED=false`, **`SIGNED_CONTRACT_SMTP_ENABLED=false`** açıkça bulunmalıdır. Module SMTP bayrağının mevcut serviste hiç tanımlı olmaması bu CLI için yeterli değildir; yalnız CLI yürütme ortamına açık false verilir.
- Ayrı, en fazla bir saatlik operator receipt tüm gerçek runtime instance'larını ve başlangıç zamanlarını listeler; durable mode prepare/off, iki legacy worker false, SMTP false, in-flight job sıfır ve kullanıcı karar kanıt hash'i gerektirir. Bu bir operator attestasyonudur; CLI diğer process'leri kendisi gözlemlediğini veya durdurduğunu iddia etmez.

## İşlem sözleşmesi

Varsayılan çalışma `BEGIN READ ONLY` ile bütün kontrolleri yapar ve rollback eder. `--apply` açıkça verilirse contract/session/application aynı transaction içinde `FOR UPDATE` kilitlenir. Tek delivery `waiting_pdf → preparing → ready` olarak aynı transaction içinde hazırlanır. Ara durumlar diğer worker'a görünmez; genel hazırlayıcı açıklamasız bir e-posta üretemez. PDF/evidence/recipient/message ID ve açıklama metni ready satırında dondurulur. Son kontrolde kaynak ve dosyalar tekrar okunur. Önceki migration'ın gerçek state/immutability trigger'ları aynen kullanılır; şema değişikliği yoktur.

Başarı durumu **ONE_TEST_DELIVERY_READY_NOT_SENT**'tir. Gönderilmiş veya SMTP tarafından kabul edilmiş demek değildir. Gönderim daha sonra ayrı exact47 canary kapsamı ve kullanıcı onayıyla yapılmalıdır. Future-only scope, eski imza tarihi nedeniyle47'yi kapsamaz.

CLI: `artifacts/api-server/scripts/enroll-contract47-delivery.ts`.
Gerekli argümanlar: `--manifest`, `--manifest-sha256`, `--source-root`, `--recovery-manifest`, `--operator-receipt`; isteğe bağlı `--apply`.
Bağlantı yalnız `CONTRACT_ENROLLMENT_DATABASE_URL` üzerinden gelir ve manifest kimliğine birebir uymalıdır. Normal `DATABASE_URL` fallback'i yoktur. Loglarda yalnız sabit sonuç/error kodu ve hash'ler bulunur; gizli manifest, imza veya signer bilgisi yazdırılmaz.

## Test ve geri dönüş

`test-contract47-enrollment.ts`: exact kimlik, source attestation, prepare-only, full snapshot, PDF/sidecar/provenance/onay değişikliği, operator zamanı/kapsamı, disclosure bypass ve eski başvuru durumunu gizlice sıfırlama regresyonları.

`test-contract47-enrollment-pg.ts`: yalnız `127.0.0.1/fas_contract47_enroll_test_*` adlı boş disposable PostgreSQL kabul eder. Gerçek0067 queue SQL ve trigger'larla read-only no-write, bir READY kayıt, source/evidence değişmezliği, replay deny, başka session/delivery çakışması, iki bağlantı yarışı, ara durum görünmezliği, crash rollback, dosya/veri değişikliği ve DB identity deny doğrulanır. Gerçek SMTP veya üretim verisi kullanılmaz.

26 Kasım yerel kanıt: pure suite **9 PASS**. Ayrı boş `fas_contract47_enroll_test_20261126b` PostgreSQL16 veritabanında **17 PASS / 0 FAIL / 0 SKIP** (9 pure test,7 işlem alt testi ve üst suite). API TypeScript kontrolü PASS. İki bağımsız kaynak incelemesinde somut bloklayıcı bulunmadı. Bu sonuçlar gerçek kullanıcıya gönderim veya production CLI yürütmesi kanıtı değildir.

COMMIT cevabı kaybolursa sonuç belirsizdir: aracı tekrar çalıştırmak yerine exact47 delivery durumu salt okunur incelenir. Başarılı hazır kayıt otomatik silinmez/yeniden kuyruğa alınmaz; SMTP kapalı tutulur ve ayrı inceleme gerekir. İmzalı kaynak/PDF restore veya overwrite yoktur. Pozitif Linux private-file CLI çalıştırması ve gerçek operator receipt doğrulaması deployment kapısıdır; yerel Windows testleri bunların yerine geçmez.
