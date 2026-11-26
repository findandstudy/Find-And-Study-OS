# Apply — sözleşme47 kurtarma ve kontrollü gönderim planı

**Durum: PREPARED / APPROVAL PENDING.** Son aday build/test ve iki PDF görsel kontrolünden geçti. Bu belge dağıtım veya teslim kaydı değildir; aşağıdaki canlı işlemler henüz uygulanmadı. Son salt okunur kontrolde mevcut251 container çalışıyor, sözleşme modu `prepare`, sözleşme SMTP bayrağı UNSET ve iki legacy worker kapalıdır. Sözleşme47'nin PDF/evidence/emailed alanları hâlâ NULL.

## Son aday ve doğrulanan kanıt

- Kaynak: `c0a02d8c99f4baf98bc6d52e74813dfc36b7a3fb`.
- Mevcut Apply source: `25164abd3616606029584f0c5a60c0a45f4e8aa8`; release `20261125T212151Z-contracts-25164abd3616`. [Önceki rollout kaydı](APPLY_CONTRACT_ROLLOUT_2026-11-26.md).
- Production runtime image: `sha256:71041ca4caee1362fd07dc9d183a4e90b0b4ef8fbd1825e9c6144a53773c88bd`. Image kimliği kaynak/bundle kimliğinin yerine geçmez.
- Production ağacında `.git` yoktur; temiz worktree iddiası yoktur. Mevcut13 drift ve4 ek dosya gerçek dosya/hash manifestiyle korunur. Staging ağacı Apply üzerine kopyalanmaz.
- API ve frontend özel hazırlık alanında build edildi;64.749 kaynak/UI/dependency girdisi doğrulandı. Frontend `BASE_URL=https://findandstudy.com`, `BASE_PATH=/` korunur. Eski hashed asset'ler tutulur; aynı adlı asset varsa hash eşliği zorunludur.
- **Migration yok.** Mevcut0067 dahil ledger68 ve önceki hash'ler korunur; tablo, kolon, yetki veya genel mail queue değişmez.

| Son c0a kanıtı | Kimlik / sonuç |
|---|---|
|26 dosyalık overlay SHA-256 |`398a96841dc3e8a5fa8c026793215035524082386254747728cf3818ad419fc7` |
| Build receipt SHA-256 |`31c909e0d99a933adb7c0b29f9e9eb6b76503c331c7b9e70e2797cc0d3903412` |
| API bundle SHA-256 |`951b7f3e7d045bdda3f6aa7634e4531bfd9b81c9e4bc12a3d6493a09bf8aafe1`;5.065.975 byte |
| Linux build |API/arayüz TypeScript, API build, i18n ve Vite PASS |
| Linux test receipt |`candidate-c0a02d8c99f4/fas-contract-send-test-90a288392ab3/receipt.json` |
| Test receipt SHA-256 |`f4395babe40e132677eda760cddba255c53d70d24807a825fc7c799bee15375b` |
| Birleşik Linux testleri |**9 suite:122 PASS +1 beklenen SKIP** |

Yerel backend/HTTP/transaction26 PASS, arayüz3 PASS ve gerçek inline logo/Chromium/PDF3 PASS. Linux suite policy, durable delivery, signing, future alan kontrolü, public intake, recovery, operator enrollment, PDF ve UI kapsamlarını içerir. İzole veritabanı/sentetik sağlayıcı testleri canlı e-posta teslimi kanıtı değildir.

## Kesin dosya kapsamı

`git diff --name-status 25164abd3616606029584f0c5a60c0a45f4e8aa8 c0a02d8c99f4baf98bc6d52e74813dfc36b7a3fb` ile26 kaynak/test/UI ve ayrı7 dokümantasyon dosyası doğrulandı.

| Alan | Dosya |
|---|---|
| Operator |`artifacts/api-server/scripts/enroll-contract47-delivery.ts` |
| Recovery |`artifacts/api-server/scripts/recover-contract47.ts` |
| Migration-prefix testi |`artifacts/api-server/scripts/test-contract-delivery-migration-prefix.ts` |
| Durable test |`artifacts/api-server/scripts/test-contract-durable-delivery.ts` |
| Enrollment/transaction testi |`artifacts/api-server/scripts/test-contract-durable-enrollment.ts` |
| Future alan testi |`artifacts/api-server/scripts/test-contract-future-signing.ts` |
| Gerçek inline logo/PDF testi |`artifacts/api-server/scripts/test-contract-inline-logo-render.ts` |
| Public intake HTTP testi |`artifacts/api-server/scripts/test-contract-public-intake.ts` |
| SMTP adaptör testi |`artifacts/api-server/scripts/test-contract-smtp-adapter.ts` |
| SMTP scope testi |`artifacts/api-server/scripts/test-contract-smtp-scope.ts` |
| Enrollment PostgreSQL testi |`artifacts/api-server/scripts/test-contract47-enrollment-pg.ts` |
| Enrollment saf testi |`artifacts/api-server/scripts/test-contract47-enrollment.ts` |
| Recovery PostgreSQL testi |`artifacts/api-server/scripts/test-contract47-recovery-pg.ts` |
| Recovery saf testi |`artifacts/api-server/scripts/test-contract47-recovery.ts` |
| Exact47 enrollment |`artifacts/api-server/src/lib/contract47DeliveryEnrollment.ts` |
| Exact47 recovery |`artifacts/api-server/src/lib/contract47Recovery.ts` |
| Frozen PDF/pre-sign |`artifacts/api-server/src/lib/contractDeliveryPdf.ts` |
| Gönderim policy |`artifacts/api-server/src/lib/contractDeliveryPolicy.ts` |
| Delivery state/CAS |`artifacts/api-server/src/lib/contractDeliveryStore.ts` |
| Worker scope |`artifacts/api-server/src/lib/contractDeliveryWorker.ts` |
| Gerekli alan/WhatsApp |`artifacts/api-server/src/lib/contractSigningFields.ts` |
| Sözleşmeye özel SMTP |`artifacts/api-server/src/lib/email.ts` |
| İmza/snapshot kilidi |`artifacts/api-server/src/lib/signContract.ts` |
| Public intake/sign |`artifacts/api-server/src/routes/publicSigning.ts` |
| Arayüz testi |`artifacts/edcons/scripts/test-contract-required-intake-browser.mjs` |
| İmza arayüzü |`artifacts/edcons/src/pages/sign/SignFlow.tsx` |

Ayrı dokümantasyon: `docs/APPLY_CONTRACT_DURABLE_MAIL_PREPARATION_2026-11-25.md`, `docs/APPLY_CONTRACT_PRODUCTION_PREFLIGHT_2026-11-26.md`, `docs/APPLY_CONTRACT_RELEASE_FILES_2026-11-26.md`, `docs/APPLY_CONTRACT_ROLLOUT_2026-11-26.md`, `docs/APPLY_CONTRACT_SMTP_CANARY_2026-11-26.md`, `docs/CONTRACT47_CONTROLLED_RECOVERY.md`, `docs/CONTRACT47_DELIVERY_ENROLLMENT.md`. Bu ön kontrol belgesi code commit'i dışındadır.

## Yeni imza akışının davranışı

CSS yorumundaki örnek placeholder gerçek zorunlu alan sayılmaz; görünür alanlar kontrol edilir. Gerçek WhatsApp eksikse imza öncesinde istenir; genel telefon numarası WhatsApp diye tahmin edilmez. Camel/snake alan eşliği ve canonical form doğrulanır. PDF veri/görsel preflight geçmezse imza kaydedilmez; snapshot kimliği transaction kilidi altında yeniden kontrol edilir. İmzalanmış intake değiştirilemez.

`admin_driven` oturumda gerekli veri eksikse personel düzeltmesi gerekir. Yalnız hiçbir gerçek alan gerektirmeyen statik şablonda `null` intake boş `{}` olarak ele alınır. Self-fill dışında yeni alan düzenleme yetkisi açılmaz. PDF üretimi arka plandadır; preflight başarısı SMTP/inbox teslimi sayılmaz.

## Exact TEST02 / sözleşme47 çıktısı

Yalnız signed_contract47 / session165 / template48 / application12 ve `en+agency-uat-20261125-02@findandstudy.com` kapsamındadır. Frozen metin ve mevcut gerçek imzalar korunur. Kayıtta olmayan WhatsApp boş bırakılır. Tarihsel logo byte'larının özgünlüğü kanıtlanamadığından çıktı ve e-posta **reconstructed branding** açıklaması taşır; orijinal tarihsel PDF byte'ları diye sunulmaz.

| V4 çıktı | Kimlik |
|---|---|
| PDF |`45e26ec2214a5a3d432b673d3a94f14c49b1c2eda3cfc358af5aa7ef0dbe9b94`;481.025 byte |
| Audit |`899f845797ff6bd8a8f1475ea968cd011a430acba99233f1aa1056267454cd33` |
| Rendered HTML |`356ed9a0ca907a7d72dc2054b9e4b089888e58d1e130010fee58283c22f00301` |
| Preview manifest |`6afdc70e67b4e74d5c1323bae6fcd6e3b2706d673248d801fa50da4f06fe0a53` |
| Görsel kontrol |7 sayfa PASS; kırpılma yok, renkler ve imza yerleşimi kontrol edildi |

Recovery'ye bağlı15 kaynak pin'i fb7f→c0a değişmedi; bu PDF render kanıtı geçerlidir. Son operator source/DB/PDF/sidecar/approval bağları yine doğrulanır. **Exact PDF/audit için kullanıcı onayı yok; canlı CAS veya enrollment yapılmadı.**

## Profile1 logo ve ayrı template49 işlemi

**Profile1:** Açık zemindeki beyaz dış logo yerine resmi [renkli Find & Study logosu](https://www.findandstudy.com/wp-content/uploads/2026/07/find-and-study-4.png) önerilir. Kaynak SHA-256 `a4447d0f6513be87b37c2230ac89f85ec1701e7e0871c829ccdb01d7dbb93ac5`; normalize PNG `902221ef74cd780adb0ae628638f678c635c3f6fdd1e99758415d37a12068998`,68.701 byte. Yeni content-addressed managed-public nesnesi kullanılır; eski logo silinmez/overwrite edilmez. Yalnız exact yeni URL trusted-logo listesine eklenir; global entegrasyon açılmaz.

Onay/yedek sonrası profile1'in exact eski JSON, `updated_at`, id/aktiflik ve eski `a49ea4eb2e76dc9472e4e97db501a55a5fe9ea6160f5b0355d1f202a39f8ab57` logo adresine bağlı CAS ile **tam1 profil satırında yalnız `config.logoUrl` ve değişiklik zamanı** güncellenir. `companySignatureDataUrl`, `brandName`, `accentColor`, `primaryColor`, `pdfFooterText` korunur. Bu profil işlemi template satırı yazmaz; aşağıdaki template49 yazısı ayrıdır.

Profile1'in aktif/published/silinmemiş inheritor'ları: **31,33,34,35,36,37,38,39,40,41,42,45,46,48**; template-level logo override/snapshot yoktur. Draft47 ve49 da devralır; profil değişikliği bunları yayımlamaz. Template47 draft kalır. **Template14 profile1'e bağlı değildir** (`brand_profile_id=NULL`, version2, published/active); Dorm Booking `f2aacdbe6269676774cf67b72f5decdab9d2f5d09785cebe3c6672777991d933` logosunu kullanır ve değişmez. Profile2/Dorm kapsam dışıdır; envanter/config drift varsa kapsam otomatik genişletilmez.

Mevcut public token ve legacy PDF yolları frozen session config veya template config okur; profile tablosunu yeniden okumaz. Durable PDF yalnız frozen session config kullanır. Profile1 değişikliği mevcut açık/imzalı snapshot'ları değiştirmez ve eski eksik logoları kendiliğinden onarmaz. Yeni session mevcut `captureLogo` yoluyla header'ı dondurur; tarihsel backfill/rerender yoktur.

**Template49:** Published48 gövdesi19.044 byte/tek5.845-byte CSS bloğu, draft49/version7 gövdesi13.181 byte/**sıfır CSS bloğu** içeriyordu. Görünür sözleşme metni aynı9.057 karakterdir: SHA-256 `e57576bdd1252be2158f19eb067978010e2f979d5b170f49a515308135359c0e`.

Yeni49 gövdesi, **48'in tasarımlı HTML'sinde yalnız exact beyaz hero logo adresinin doğrulanmış inline PNG'ye çevrilmesi**, ardından mevcut sanitizer ile canonical hale getirilmesiyle oluşturuldu. Hukuki metin eşliği ve sanitizer idempotence PASS. Yeni metadata yok; inline logo mevcut body snapshot içinde donar, header mevcut logoSnapshot kullanır. Şirket imzası/hüküm/placeholder'lar değiştirilmez.

| Son canonical49 adayı | Kimlik / sonuç |
|---|---|
| Proposal manifest |`70e69e31a2fa9223bea6c07d267d8bc06814257376ca2fd1e940980eb217eeaf` |
| Saklanacak canonical body |`8acd631311960b96440f9389b8d65afb4b90a6d9e29a2b1db206cea50c29605b` |
| Sentetik tam şablon PDF |`9179c56d6fd4c0b8d6a245a81384360ee8eaed24e45a044d2d54869def424fc2`;355.939 byte |
| Son c0a teknik preview |PASS; missing/external image deny, metin eşliği ve sanitizer idempotence |
| Yerel görsel kontrol |**7 A4 sayfa PASS**; CSS/renk/kutular, beyaz hero, renkli header ve girdiler doğru; kırpılma/unresolved placeholder yok |

PDF indirildiğinde byte/hash doğrulandı. Yerel dosya: [sentetik template49 önizlemesi](<C:/Users/Find And Study/.codex/artifacts/TEST02-contract-recovery-20261126/future-template49-test-preview.pdf>); özel çıktı `future49-output-v3`. İmza sayfaları TEST ONLY / NOT SIGNED işaretlidir; gerçek imza veya e-posta gönderimi yapılmadı.

Kaynak48/eski49/logo hash'leri final manifestle bağlıdır. Kullanıcı onayından sonra exact eski49/version7/draft/updated_at/body hash CAS ile **yalnız template49 gövdesi** onaylanan canonical değere alınır ve mevcut yayınlama kontrolleriyle yeni sürüm yayımlanır. Template48 ve diğer template satırları korunur; açık/imzalı oturumlar taşınmaz. Toplam içerik kapsamı profile1 logo CAS **ve ayrı template49 gövde/yayın işlemidir**; genel olarak “hiç template yazılmayacak” iddiası yoktur.

## Son onaydan sonra yürütülecek sıra

1. Canlı release/container, source manifesti, storage kökü, DB kimliği/ledger68, runtime config ve disk rezervi yeniden doğrulanır. Drift varsa durulur.
2. Yeni production custom DB ve storage yedeği alınır; checksum/bütünlük ve `pg_restore --list` doğrulanır. Kimlikler receipt'e yazılır; yedekler Git'e veya staging DB'ye alınmaz.
3. Yalnız Apply API kontrollü drain/durdurulur; in-flight sözleşme işi kalmadığı doğrulanır. Kısa API kesintisi olabilir. Portal worker, PostgreSQL, gateway ve ilgisiz container'lar yeniden başlatılmaz.
4. Onaylanan exact47 PDF yeniden render edilmeden PDF/evidence CAS ve immutable sidecar kurulumu yapılır. Ayrı operator ortamı `prepare`/SMTP kapalıdır. Exact kaynak/DB/recovery/audit/provenance ve fresh worker-isolation receipt doğrulanır. Mevcut delivery veya `emailed_at` varsa tekrar denenmez. Tek transaction'da disclosure'lı e-posta `waiting_pdf → preparing → ready` yapılır; worker ara durumu göremez.
5. Profile1 ve template49 işlemleri yukarıdaki ayrı CAS/manifest sınırlarıyla uygulanır. Başka signed record, frozen snapshot, gerçek imza veya application onayı değişmez.
6. API son exact kodla yalnız **canary47 + exact TEST02 alıcısı** scope'unda açılır. Provider kabul receipt'i kalıcı kaydedilir; ayrıca Gmail mesajı/eki görülür ve ek SHA-256'sı onaylanan/stored PDF ile eşleştirilir. SMTP kabulü inbox teslimi sayılmaz. `sending/ambiguous` sonuçta otomatik retry yoktur; durulup incelenir.
7. **Bu planın aynı onayı kapsamında, yalnız canary geçerse**, ikinci kontrollü API durdurma/başlatma ile scope `future` yapılır; aktivasyon anının sabit UTC zamanı bir kez kaydedilir. Hem gerçek imza hem enrollment zamanı bu kesimden sonraki yeni kayıtlar gönderilebilir. Tarih geriye çekilmez;47 ve diğer geçmiş kayıtlar future kapsamına alınmaz. Canary başarısızsa future kapalı kalır; ikinci ara onay istenmez.

İmza acente onayı değildir. Application12'nin yönetici onayı/hesap aktivasyonu dahil değildir; “inceleme altında” zorla kaldırılmaz. Acente/admin indirme ve hesapta sözleşme görünümü gerçek oturumla ayrıca doğrulanır; oturum yoksa test edilmedi olarak kaydedilir.

## Exact canary config

Ayarlar hazırdır, **henüz uygulanmadı**. Recovery/enrollment operator'ü ayrı `prepare` ve `SIGNED_CONTRACT_SMTP_ENABLED=false` kullanır.

| Ortam değişkeni | Canary |
|---|---|
|`NODE_ENV` |`production` — mevcut değer |
|`SIGNED_CONTRACT_DELIVERY_ENABLED` |`false` |
|`SIGNED_CONTRACT_PDF_WORKER_ENABLED` |`false` |
|`SIGNED_CONTRACT_DURABLE_DELIVERY_MODE` |`send` |
|`SIGNED_CONTRACT_SMTP_ENABLED` |`true` |
|`SIGNED_CONTRACT_SMTP_SCOPE` |`canary` |
|`SIGNED_CONTRACT_SMTP_CANARY_CONTRACT_ID` |`47` |
|`SIGNED_CONTRACT_SMTP_CANARY_RECIPIENT` |`en+agency-uat-20261125-02@findandstudy.com` |
|`SIGNED_CONTRACT_SMTP_FUTURE_FROM` |**UNSET** — başarılı canary sonrasına kadar |
|`EMAIL_DELIVERY_DISABLED` |Mevcut **UNSET** korunur |
|`ALLOW_LIVE_INTEGRATIONS` |Mevcut **UNSET** korunur |

Gönderim anında exact sözleşme/alıcı tekrar doğrulanır. Future geçişinde yalnız sözleşmeye özel scope ve sabit UTC cutover ayarlanır. Genel mail/integration izinleri, SMTP gizli değerleri ve ilgisiz config değiştirilmez/paylaşılmaz.

## Açık kapılar ve geri dönüş

| Kapı | Durum |
|---|---|
| Son c0a build ve122 test |PASS |
| Tarihsel47 exact v4 PDF/görsel |PASS |
| Canonical49 teknik PDF ve7 sayfa görsel |PASS |
| Final plan/PDF/audit/template için kullanıcı onayı |**PENDING** |
| Yeni production DB/storage yedeği |**PENDING — switch öncesi** |
| Production switch/CAS/yayın/enrollment |**NOT APPLIED** |
| Canary provider + Gmail attachment hash |**NOT RUN** |
| Future UTC cutover |**NOT SET; future CLOSED** |

Sorunda sözleşmeye özel SMTP kapatılır ve API/worker drain edilir. Kod geri dönüşü **mevcut güvenli251 prepare release**'ine yapılır; daha eski, kapıları tanımayan kaynak başlatılmaz. Global mail ayarları ve ilgisiz işler korunur.

Ledger68, yeni PDF/sidecar/evidence ve delivery receipt'ler kalır. **Canlı DB restore, imza/PDF overwrite veya kayıt silme yoktur.** `accepted/ambiguous/sending` geri alınmaz; kör yeniden gönderim yapılmaz. COMMIT veya SMTP sonucu belirsizse exact kayıt salt okunur incelenir. Geri dönüş gönderilmiş e-postayı geri çekmez.

Repo [AGENTS.md](../AGENTS.md), **Required production deployment gate** altında “Wait for explicit approval after presenting this preflight report.” der. Final somut plan kullanıcıya sunulduktan sonraki açık onay; Apply switch, exact47 recovery/enrollment, profile1/template49 işlemleri ve canary öncesinde gereklidir. Başarılı canary sonrasındaki sınırlı future açılışı aynı onaydadır. Bu belge kendi başına yetki değildir. Migration, global entegrasyon açılması, canary'de farklı alıcı, geçmiş toplu gönderim ve hesap onayı kapsam dışıdır.

