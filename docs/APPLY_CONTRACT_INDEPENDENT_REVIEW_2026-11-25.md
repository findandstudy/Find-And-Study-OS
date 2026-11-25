# Apply sözleşme düzeltmeleri — bağımsız yerel review

Tarih: 25 Kasım 2026. Reviewer: `contract_html_preservation`. Bu inceleme kod okuması ve aşağıda ayrılan yerel test kanıtlarıdır; production dağıtımı, imza, gönderim veya hesap etkinleştirme onayı değildir.

## İncelenen sürüm

Git HEAD `c9334fae5743087991bb8b1abdd3fd03b056635b`: kaynak portu `1878cb3a`, kontrollü kurtarma `d912370a`, yürütülen kaynak bağı `2e7e8eb4` ve offline overlay hazırlığı. Durable teslimat dosyaları bu rapor hazırlanırken **henüz commit edilmemişti**. Sorumlu ajan son UI/teslimat durumu çalışmasını sürdürüyordu; sonraki değişikliklerin incelendiği veya final candidate'ın bütünüyle onaylandığı iddia edilmez. Aşağıdaki LF-normalize SHA-256 listesi incelenen helper snapshot'ını sabitler. Rapor tek başına docs commit'idir; başka ajanın index'i kullanılmamıştır.

## Bulgular ve düzeltilen sınırlar

- `1878cb3a` sahiplik kontrollerinde yeni IDOR veya imza nedeniyle otomatik ticari hesap onayı veren değişiklik bulunmadı. İmza durumu ve staff'ın nihai onayı ayrı kalıyor.
- Kontrollü TEST02/47 kurtarması yalnız 47/165/48/12 ilişkisini, orijinal imza/frozen HTML/alanları ve reviewed candidate hash'lerini kabul ediyor. Mevcut PDF **veya** evidence hash varsa reddediyor. Güncel acente/şablon/logo verisiyle geçmişi tamamlamıyor; e-posta göndermiyor.
- CLI'nin reviewed `--source-root` ile gerçek yürütülen CLI/helper dosyasını bağlamadığı somut açık bildirildi ve `2e7e8eb4` ile düzeltildi. Bağ kontrolü DB erişiminden önce.
- Yeni teslimat yalnız aynı imza transaction'ında eklenen kayıtları işler. Historical enrollment/startup backfill yok; 47 numaralı kayıt kendiliğinden kuyruğa alınmaz. Legacy delivery ve PDF worker'ın ikisi de açıkça kapalı olmalıdır.
- Frozen PDF hazırlanması güncel template/agent/seal okumaz; tekrar okunan source digest'i ve yalnız PDF+hash birlikte boşken çalışan CAS mevcut delili korur. Canonical numara/tarih/imzalayan alanlarıyla çelişen intake değerleri artık reddedilir; tarihsel içerik yeniden yazılmaz.
- Eksik dosya nedeniyle ilk ready kaydın bütün kuyruğu kilitlemesi bildirildi; ilgili kayıt `failed` yapılarak sonraki kayıtların ilerlemesi sağlandı.
- SMTP öncesi `sending` attempt'i kalıcılaştırılır. Yalnız exact recipient/message-ID/acceptance receipt aynı transaction'da `emailed_at` oluşturur. Timeout/çökme sonrası belirsizlik `ambiguous` kalır; otomatik yeniden gönderim yoktur. SMTP kabulü inbox teslim kanıtı değildir.
- Offline assembler exact 1.803 kaynak üyeliğini, hash/blob kimliklerini ve patch öncesi byte hash'lerini doğrular; 12 korunacak drift dosyası + 4 ek dosyayı/migration prefix'ini değiştirmeyi reddeder. Marka merge'inin semantik kabulü ayrı operatör review belgesine bağlıdır.

## Test kanıtı

Reviewer tarafından bu worktree'de yeniden çalıştırılanlar:

- `scripts/test-contract47-recovery.ts`: **26 PASS, 1 Linux-only SKIP**. Kaynak kimliği, başka kayıt/proje ilişkisi, existing PDF/hash, değişmiş intake/signature digest, frozen alan eksikliği, dış logo, lease ve worker isolation kontrolleri.
- `deploy/prepared-releases/test-assemble-apply-contract-candidate.mjs`: **8 PASS**. Exact üyelik, protected drift/migration, before hash, review şartı ve overwrite reddi.

Sorumlu uygulama ajanının bildirdiği, bu reviewer tarafından ayrıca çalıştırılmayan kanıt: durable delivery testleri **19 PASS**; disposable DB'de gerçek `0000–0065` + hash-exact mevcut `0066` + hazırlanmış `0067`, prefix `67→68`, tekrar çalıştırma ve sıfır historical enrollment **PASS**. Kaynak testleri `test-contract-durable-delivery.ts`, `test-contract-durable-enrollment.ts`, `test-contract-smtp-adapter.ts` içinde; özellikle reserved metadata/changed bytes, eşzamanlı attempt, SMTP sonrası çökme, missing-attachment queue progress ve forged receipt reddi gözden geçirildi. Bu bilgi final UI/build/commit veya gerçek SMTP testi yerine geçmez.

## Açılmadan önce kalan kapılar

İlk dağıtımda yeni mod `off`, eski delivery/PDF worker'lar `false` kalmalı. Exact son candidate için bağımsız review, build/typecheck/Linux runtime ve gerçek panel doğrulaması; canlı 67-entry prefix attestation'ı ve doğrulanmış yedek/geri dönüş; additive migration'ın ayrı onayı; yeni imza girdilerinin tam frozen-data/logo uyumluluğu; yalnız izinli test alıcısıyla izole canary ve ambiguous receipt inceleme prosedürü tamamlanmalıdır. Staging'in farklı migration zincirine Apply `0067` kopyalanmamalıdır.

Geri dönüş: modu kapatıp worker'ı drain et; kodu geri alırken additive tablo/receipt/signature/PDF delilini koru. Canlı DB restore, lease/hash silme, eski worker'ı yeniden açma veya kör yeniden gönderim bu planın parçası değildir. Bu reviewer production veya staging'de işlem yapmadı.

## İncelenen uncommitted helper hash'leri

| Dosya | SHA-256 (LF) |
| --- | --- |
| `artifacts/api-server/src/lib/contractDeliveryPolicy.ts` | `cf0da4ddcad6b063c2daee7460ab8b00fcd45b1bcea7e1293bb2c459b0c890c6` |
| `artifacts/api-server/src/lib/contractDeliveryStore.ts` | `cb6ce61284d4bcacd4a01bccc526e3470c66251f7f2bc65b2e0630c8243b7a4b` |
| `artifacts/api-server/src/lib/contractDeliveryWorker.ts` | `cb5b88a094073adcb1c97e02a9c27b0131b7103a7debfb74e322c82e07cc4c09` |
| `artifacts/api-server/src/lib/contractDeliveryPdf.ts` | `e00a8733163ef54002515819851d512123272448756fa999da2c8d0c30ad9ff3` |
| `artifacts/api-server/src/lib/contractSmtpReceipt.ts` | `b95a0f74f4834e9c2f2b4bc143006ccf1a38083d3b702e377f240431457fa5b6` |
| `artifacts/api-server/src/lib/email.ts` | `b1dc5d8bb2917957794513b5e71c14a02888a40bee372df6a29928d148fa9101` |
| `artifacts/api-server/src/lib/signContract.ts` | `43f478f57a6d16b2281e23d842d87412d9c34042893b563aed1db67d1b9c231f` |
| `artifacts/api-server/src/lib/signedContractDelivery.ts` | `d7b705449866b34209bbddc9723adde4992ad1e451c09f37aaf7e4f06bc46aca` |
| `deploy/prepared-migrations/apply/0067_signed_contract_delivery.sql` | `73c3dc386d18cb7bd37dc9b1b19f7401469f5e7a3063f36f9f08c929082d2666` |
