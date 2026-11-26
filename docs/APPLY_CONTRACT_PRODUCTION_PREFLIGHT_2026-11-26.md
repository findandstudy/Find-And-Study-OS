# Apply sözleşme düzeltmesi — production ön kontrolü

**26 Kasım güncellemesi: kullanıcı onayı alındı; dar 0067 + `prepare` production geçişi tamamlandı.** Güncel kanıt ve sınırlar [rollout kaydında](APPLY_CONTRACT_ROLLOUT_2026-11-26.md). Aşağıdaki metin geçiş öncesi plan/kanıtın tarihsel kaydıdır. Sözleşme e-postası gönderimi ve TEST02/47 kurtarması bu aşamaya dahil değildir.

## Paket ve korunacak kaynak

- Ürün/build adayı: `25164abd3616606029584f0c5a60c0a45f4e8aa8`; ek prefix test kanıtı: `56f176d04b1c7f4848b87318a7f14968988e6e78` (yalnız test değişikliği).
- Temel: `a5f31e06568229d5f61fa29a1416dd46b83119b0` **ve mevcut Apply'daki13 değişmiş +4 ek dosya**. Mevcut kaynağın12 ilgisiz değişmiş dosyası ve4 ek dosyası aynen korunur; branding dosyasının tanımlı değer koruması kontrollü birleştirilir. Staging kaynak ağacı Apply'ın üzerine kopyalanmaz.
- Dondurulmuş Git farkı **72 dosya**; [tam dosya envanteri](APPLY_CONTRACT_RELEASE_FILES_2026-11-26.md): `git diff --name-status a5f31e06568229d5f61fa29a1416dd46b83119b0 56f176d04b1c7f4848b87318a7f14968988e6e78`. Yeni bu ön kontrol belgesi ürün paketinin parçası olarak sayılmamıştır.
- Gerçek aday, [hash doğrulamalı overlay/build yöntemi](APPLY_CONTRACT_CANDIDATE_RECIPE.md) ve `.apply-candidate-receipt.json` / `.apply-build-evidence.json` ile bağlanmalıdır. Var olan release/storage, builder'a yazılabilir bağlanmaz; production üzerinde dosya düzenlenmez.

## İlk aşamada ne değişecek?

Şablon CSS'i korunur; imzalı sözleşme acentenin hesabında PDF bekleme durumuyla görünür; yönetici onayı ile imzalama ayrı gösterilir. PDF olmadan indirme başarılı veya e-posta gönderilmiş denmez. Yeni uygun imzalarda değişmez veriden PDF hazırlanır; gönderim kaydı oluşur fakat SMTP çağrılmaz. Geçmiş sözleşmeler otomatik işleme alınmaz.

| Ayar | Önerilen değer / davranış |
|---|---|
| `SIGNED_CONTRACT_DURABLE_DELIVERY_MODE` | `prepare` — yalnız yeni kayıt/PDF hazırlığı |
| `SIGNED_CONTRACT_DELIVERY_ENABLED` | `false` — eski toplu sözleşme teslimatı kapalı |
| `SIGNED_CONTRACT_PDF_WORKER_ENABLED` | `false` — eski PDF tarama/backfill yolu kapalı |
| `BACKGROUND_JOBS_ENABLED` | Mevcut `true` korunur; mevcut scheduler lock sahibi yeni worker'ı başlatır |
| `CONTRACT_PDF_TRUSTED_LOGO_URLS` | Yalnız doğrulanmış tam logo adresleri; yeni oturumda byte snapshot başarıyla alınmalı |

Başlatma zinciri doğrulandı: coordinator, sözleşme işini16s offset ile çağırır; eski worker `false` iken `prepare` yeni worker'a yönlendirir; ilk sweep15s sonra, devamı30s aralıkla çalışır. PDF-only `false`, bu yeni yol için ön koşuldur. `prepare` içinde `contractSmtpAllowed` daima false; SMTP transport açılmaz.

**İlgisiz OTP/davet/normal bildirimleri kapatmayın.** `prepare` sözleşme postasını zaten engeller; sırf bunun için global `EMAIL_DELIVERY_DISABLED` veya `ALLOW_LIVE_INTEGRATIONS` değiştirilmez. Gerçek test e-postası, imza veya hesap etkinleştirme bu ön kontrolün parçası değildir.

## Migration ve açılış kapıları

Hazırlanmış dosya: `deploy/prepared-migrations/apply/0067_signed_contract_delivery.sql`; SHA-256 `73c3dc386d18cb7bd37dc9b1b19f7401469f5e7a3063f36f9f08c929082d2666`. Yeni boş tablo, FK/index/trigger ekler; geçmiş kayıtları doldurmaz, global mail kuyruğunu değiştirmez.

1. Gerçek67-entry Apply prefix'i,0066 SQL/snapshot ve ledger tekrar doğrulanmalı. Ayrı migration paketi, mevcut0066'yı aynen koruyarak0067'yi canonical journal'a eklemeli; testteki sabit metadata `{idx:67,version:"7",when:1795564800000,tag:"0067_signed_contract_delivery",breakpoints:true}`. `when` dağıtım anındaki saat değil, dondurulmuş migration kimliğidir. Onaylı runner ledger'a SQL hash + bu değeri yazar. Tek başına raw SQL çalıştırıp ledger/journal'ı geride bırakmak uygun değildir.
2. **Güncel production schema-only uyumluluk testi: PASS.** Root, salt okunur `pg_dump --schema-only --no-owner --no-acl` çıktısını veri/PII taşımadan `--network none` PostgreSQL16.15'e geri yükledi. Dump325361 byte; SHA-256 `ab6dedddd7ef5863536760d1bd356e6255e8860ccb3653bf830b54099d410d57`.0067, `lock_timeout=2s` / `statement_timeout=15s` transaction'ında0,076s içinde uygulandı; yeni tablo boş,2FK mevcut, var olan veri yeniden yazımı yok. Test DB silindi; production container kimlikleri/başlama zamanı değişmedi. Root kanıtı: candidate klasörü `schema-gate/receipt.json`. Bu boş-tabla DDL kanıtıdır; gerçek eşzamanlı yük altında kilit süresi ölçülmedi.2s sınırı aşılırsa kör retry yapılmaz, yeni karar gerekir. Schema-only dump ledger satırlarını içermez; dolu şemada0000'dan migrator çalıştırılmaz. Tam-prefix/replay ayrı PASS kanıtıdır; gerçek transaction rollback tatbikatı bu schema-gate sonucundan çıkarılmaz.
3. Yeni doğrulanmış DB/storage yedeği ve geri yükleme kanıtı; exact image/source/runtime kimliği; yeterli disk; mevcut DB kullanıcı yetkileri; geçerli logo/seal snapshot; Chromium/private-storage/TMP çalışma koşulları doğrulanmalı.
4. Tek migration otoritesi/lock, sınırlı lock ve statement timeout kullanılmalı. FK DDL referans tablolarda kısa kilit alabilir; sonsuz bekleme yapılmaz. Eski iş sahibi düzgün durdurulup drain edilmeli; aynı anda eski/yeni API scheduler sahipliği oluşmamalı. Yeni yetki verilmez.
5. Final plan, image/dosya manifesti, schema test sonucu, kısa kesinti ve rollback kullanıcıya sunulur. **Bundan sonra production onayı alınmadan switch/migration yapılmaz.**

`off` ile migration olmadan açılış teknik olarak güvenlidir: `finalizeSign` yeni tabloya yazmaz; Account/status eksik tabloyu `unconfirmed` gösterir. Ancak PDF üretimi yoktur, manuel retry503 verir ve o sırada imzalananlar daha sonra otomatik kuyruğa alınmaz. Bu nedenle tam kullanıcı ihtiyacı için öneri, kapılar geçince0067+`prepare`dir; yalnız `off` dağıtımına “sorun çözüldü” denmez.

## Kanıt, sınırlar ve geri dönüş

Yerel: durable19, tam-prefix/replay1, regresyon85, tarayıcı3 PASS; API/arayüz typecheck/build PASS. Root'un Node22 Linux aday251 kanıtı: prefix1, mail14, recovery34+1skip, PDF4 PASS. Bunlar sentetik/izole testlerdir; gerçek SMTP teslimatını kanıtlamaz.

- **TEST02/47:** orijinal frozen logo verisi eksik; kurtarma hâlen bloklu. Güncel logo/template ile geçmiş imzalı metin sessizce değiştirilmez;47 otomatik kuyruğa alınmaz.
- **İnceleme altında:** application12 `approved_at=NULL`; son yönetici onayı beklenmesi doğru davranıştır. Bu paket onay vermez.
- **Gelecekte mail:** izole/onaylı alıcı canary, provider receipt ve belirsiz sonuç reconciliation yöntemi doğrulanınca ayrıca `send` onayı gerekir. SMTP kabulü, kesin inbox teslimi anlamına gelmez.
- **Rollback:** önce yeni mod `off`, worker drain; gerekiyorsa önceki kod/image. Ek tablo/receipt/PDF/imzalar korunur; canlı DB restore veya kayıt silme yapılmaz. Eski sözleşme worker'ları yeniden açılmaz. `prepare` döneminde oluşmuş bekleyen kayıtlar için sonraki açık karar ayrıca kaydedilir.

## Tamamlanan son paket ve runtime doğrulaması

Hazırlık kanıtlarının VPS dizini: `/opt/findandstudy-staging/backups/apply-contract-candidate-v2-20261125`. Bu dizin production release'i değildir. Sözleşme veya imzalı production verisi staging veritabanına taşınmadı.

| Kanıt | Kimlik / sonuç |
|---|---|
| Kaynak ağacı | `dee2466993b1fcd69156f4e778489c31580f979945bbbd3ba79ec92a1ed2b077` |
| Kaynak receipt | `d10f94c117f09f36d6a2682d4aa825a71c9dece3d73b81a90539c232a85b789e` |
| Patch manifesti | `3dfb035d303ca7883c7bf52aab5ad9f068d55cbe158522fb31541a74072db451` |
| Production için runtime image | `findandstudy-apply-contract-runtime:25164abd3616`, ID `sha256:71041ca4caee1362fd07dc9d183a4e90b0b4ef8fbd1825e9c6144a53773c88bd` |
| Yalnız builder image | `findandstudy-apply-candidate:25164abd3616`, ID `sha256:0b8a62b798c58836e46d0378dff2ab2075f9ecac75ba71776260eb05d69242f4` — production'a çalıştırılmaz |
| Önerilen yeni container release yolu | `/opt/findandstudy/releases/20261125T212151Z-contracts-25164abd3616` |
| Export denetimi | 1.845 kaynak ve 186 build çıktısının hash'i doğru; 2.626 dependency symlink'i göreli ve release içinde |
| Ayrı runtime smoke | UID 10000, read-only root, init, network none; gerçek release yolunda 17 PASS + 1 platform SKIP; iki gerçek PDF |
| Build edilmiş API + ayrı DB | Aynı runtime image/release yolunda HTTP 200, beklenen test release kimliği ve `dbConnected=true` |
| Migration bundle | 72 dosya; manifest SHA `e6a36003543b7fe0aceca71b97236ac4c3f8c28eac2579f45d306fcc39b6bdb6` |

`runtime-final-path-receipt.json` ve `built-api-database-smoke-receipt.json` son PASS kanıtlarıdır. Geçici test container'ları kaldırıldı. Yeni hazırlık dizininin ilk export'unda sahiplik farkı nedeniyle çalıştırma reddedildi; yalnız bu hazırlık dizini UID/GID 10000'a düzeltildi, hash'ler tekrar doğrulandı ve son smoke geçti. Production sahipliği değiştirilmedi.

Builder içindeki test ortam değişkenleri production config'i değildir; bunları taşımak OTP/davet ve diğer işleri yanlışlıkla kapatabilir. Deployment, runtime image + doğrulanmış yeni release export'u + mevcut production config'inin yalnız yukarıdaki dar değişiklikleriyle yapılmalıdır. Runtime image'in varsayılan eski CMD'si kullanılmaz; yeni release için working directory ve `artifacts/api-server/dist/index.cjs` komutu açıkça bağlanır.

Mevcut production container'ı `academy160-apply`, ID `a07788ecfdbb9792f838ee61e97fbc42edb266b51572c57b6470c8d50a98c7a3`, başlangıç `2026-11-14T07:18:02.261561892Z`; PostgreSQL container ID `e9fff7276ad528e6779453cdf36d24126ee58f7b54b7042907ee697fcdbc5f25`, başlangıç `2026-11-14T07:18:02.26596598Z`. Son kontrol kimlik ve başlangıçları değişmeden buldu. Runtime ağacında `.git` yoktur; bu yüzden “clean production worktree” denmez. Yukarıdaki gerçek kaynak manifesti ve 13+4 fark bu boşluğu açıkça belgeliyor.

## Onay sonrası uygulanacak dar production işlemi

1. Kaynak/container/storage/ledger kimliklerini tekrar karşılaştır. Değişmişse dur, hazırlık receipt'ini sessizce yenileme. Disk rezervi ve yedek boyutu uygun değilse ilerleme.
2. Production'a ait özel yedek alanında yeni `pg_dump --format=custom --no-owner --no-acl` al; exit code, SHA-256 ve `pg_restore --list` doğrula. Recoverable storage yedeği/snapshot'ını ve checksum'ını doğrula. Yedekleri Git'e veya staging uygulama verisine taşıma.
3. Aktif sözleşme işi/scheduler sahipliği için kontrollü drain uygula. Ledger'a bağlı tek migration runner ile yalnız hazırlanmış 0067'yi, 2s lock / 15s statement sınırında ekle. 67→68 ledger ve yeni boş tabloyu doğrula. Geçmiş imzaları kuyruğa alma.
4. Yeni release export'unu ayrı dizine kur; eski release/storage'ı değiştirme. Yalnız Apply API container'ını doğrulanmış runtime image, yeni release komutu ve `prepare` ayarlarıyla değiştir. Kısa API kesintisi mümkündür; başka uygulama/portal worker container'ı yeniden başlatılmaz. Mevcut global OTP/davet/bildirim ayarları korunur.
5. Beklenen release/DB health, runtime UID/read-only, yeni migration, sözleşme logo yapılandırması ve hata loglarını kontrol et. Production testi için gerçek imza, e-posta, hesap onayı veya başvuru gönderme.
6. Başarısızlıkta yeni sözleşme işi durdurulur, eski runtime/kod ve izinli config geri alınır; iki eski sözleşme worker'ı kapalı tutulur. Additive tablo, yeni PDF ve receipt kayıtları korunur. Production DB restore edilmez.

Bu plan **yeni sözleşmeler için PDF hazırlama** aşamasıdır. Gerçek e-posta canary/send açılışı ve orijinal logo kanıtı eksik TEST02/47 kurtarması ayrı kararlardır. Bunlar tamamlanmadan “Apply'daki tüm sözleşme sorunları çözüldü” denemez.

## Staging UAT sınırı

Staging `8b7e865d` ile admin panelindeki gerçek HTML/CSS/logo görünümü doğrulandı. Sentetik PDF üretimi ve bağımsız HTTP/tarayıcı indirme testleri geçti. Ancak kullanıcının mevcut kontrollü Chrome profilinde nihai dosyanın diske kaydı doğrulanamadı; manuel sonuç bekleniyor. Bu boşluk, otomatik testlerin başarısıyla kapatılmış sayılmamıştır. Staging'de gerçek imza, hesap etkinleştirme veya gerçek alıcıya mail gönderimi yapılmadı.
