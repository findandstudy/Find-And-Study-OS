# Acente imza sonrası PDF, teslimat ve hesap durumu düzeltmesi

Tarih: 25 Kasım 2026. Kapsam: Apply'da bildirilen TEST ACENTE 02 sorunları;
aynı kod düzeltmesinin staging'e taşınması. İmzalı acente kayıtları staging'e
kopyalanmayacak. Yalnız şablon/tasarım/logo aktarımı kullanıcı tarafından istendi.

## Gözlenen ile çıkarımın ayrımı

- Kullanıcı ekranlarında public ve admin PDF indirme aynı bekleme mesajını veriyor.
- Yetkili test posta kutusunda hesap kurulum ve sözleşme imzalama daveti var;
  imzalı PDF mesajı/eki aramada yok. Bu, SMTP logu veya tüm posta sisteminin denetimi değildir.
- İmzalamak ve parola kurmak, son yönetici ticari erişim onayının yerine geçmez.
  Canlı kaydın approved durumu, admin oturumu olmadığından bu tur okunamadı.
- PDF oluşmamasının canlı runtime nedeni henüz kanıtlanmadı. Worker kapalı olması,
  Chromium, imza varlığı veya storage hatası birbirinden ayrılmalı; ayar açarak
  ya da geçmiş belgeleri yeniden üreterek varsayımsal onarım yapılmadı.
- Referans PDF farklı şablon adını taşıyor: `Agency Agreement - Turkey - For
  Companies - English`. TEST02 için görülen ad `Find And Study - Agency Agreement
  - 2026` v6. Bu şablon seçimi/sürümü karşılaştırmasını gerektirir; tek başına CSS
  kaybı kanıtı değildir. Referansın imzaları, kişisel verisi ve delil sayfası yeni
  şablona kopyalanmadı. Kaynak PDF değişmedi.

## Yerel düzeltmeler

1. `signedContractDelivery.ts`: okunabilir, sınırları ve PDF başlığı doğrulanan
   zorunlu ek; onaylanmış SMTP/outbox sonucu olmadan `emailedAt` yazılmaz.
   Sözleşme başına kalıcı idempotency anahtarı kullanılır. Önceden oluşturulmuş
   outbox'ın alıcısı, tek PDF eki, checksum'ı ve final dosya byte'ları doğrulanır;
   gönderilmiş receipt tekrar gönderim yapmadan uzlaştırılır. Bekleyen/belirsiz/
   başarısız gönderim yeni mesaj yetkisi değildir. Worker claim tamamlanması ve
   bırakılması aynı lease'e bağlıdır. Tarihsel gönderim penceresi genişletilmedi.
2. `contractPdf.ts`: HTML yüklenememesi/zaman aşımı hata olarak kalır; eksik veya
   boş DOM imzalı PDF olarak finalize edilemez. Dış ağ engeli korunur.
3. `agentApplicationLifecycle.ts` ve `agentOnboarding.ts`: reconciliation ve
   deadline restriction aynı application satırını transaction içinde kilitleyip
   güncel sahiplik/onay/sözleşme verisini okur. Geç kalan sorgu admin onayını
   provisional/restricted durumuna geri çekemez. İmza kendi başına full erişim açmaz.
4. `agentSignedContractSummary.ts`, `agents.ts`: imzalı sözleşmenin varlığı PDF
   üretiminden ayrıdır. Özet yalnız sahibi için döner; newest PDF beklerken eski
   dosya gösterilmez. Mevcut `/api/contracts/me/pdf` sahipliği yeniden doğrular.
5. `Account.tsx`, `Dashboard.tsx`, `agentContractCopy.ts`: imzalı/PDF bekliyor/hazır
   ayrımı, durum yenileme, 202/PDF-dışı yanıtı dosya diye indirmeyen kontrol,
   son admin onayını bekleyen kullanıcı için açık durum metni. EN/TR ek metinler;
   diğer dillerde bu yeni modül metinleri İngilizce fallback kullanır.
6. `contracts.ts`, `signedContractPdfRecovery.ts`, `Contracts.tsx`: var olan
   imzalı PDF veya evidence hash silinemez/yeniden üretilemez. Yalnız eksik
   artefakt için mevcut worker kapsamına uyan, aktif lease'i olmayan kayıt
   değerlendirilebilir. Koşullar update anında da atomik doğrulanır. Worker yoksa
   veya tarihsel kontrollü kurtarma gerekiyorsa queued diye başarı verilmez.
7. `publicSigning.ts` ve 23 locale: imza kaydı, PDF hazırlığı ve e-posta teslimi
   ayrı anlatılır. E-posta gönderildiği veya 30 saniyede hazır olacağı iddia edilmez.
8. `security/legacy-role-gate-registry.json`: yalnız dört değişen route'un içerik
   pinleri güncellendi. Quarantine/sınıflandırma/yetki sayıları korunur.

Şema/migration, kimlik doğrulama, ödeme, CI/CD veya runtime ayarı değişmedi.
Mevcut kirli Public-Detail-Release çalışma ağacına dokunulmadı.

## Test kanıtı

- Gerçek delivery/lifecycle fonksiyonlarını kullanan izole testler: pool ve ağ
  çağrıları yasak; DB double kullanılır. Gerçek PostgreSQL concurrency kanıtı değildir.
- Son birleşik backend grubu: **72/72 PASS** (lifecycle 12, delivery 24, recovery 5,
  PDF yükleme sınırı 3, mevcut e-posta kuyruk/policy 28).
- İmza normalizasyonu/render ve immutable recovery payload regresyonu: **18/18 PASS**;
  recovery/PDF-boundary ile birlikte çalıştırılan grup 26/26'dır, toplamlar örtüşür.
- Tasarım/sanitizer/shell + gerçek Chromium grubu: **19/19 PASS**; iki sentetik PDF,
  dört sayfa görsel kontrol. Başlık/renk/kutu/tablo/RTL ve dış ağın kapalı kalması doğrulandı.
- API/Edcons TypeScript, API build, Vite build, 23 locale parity ve public bundle
  bütçesi PASS. İlk yerel kurulumdaki eksik paket cache'i temiz, lockfile ile doğrulanmış
  ayrı pnpm deposundan giderildi; kaynak/lockfile/dependency sürümü değişmedi.
- UI browser sonucu ve exact release-base build kanıtı aşağıdaki son ekle kaydedilecek.
- Normal legacy route ve writer denetimleri genel olarak **FAIL**: başlangıçta da
  aynı 38 legacy hata ve aynı 7 sınıflandırılmamış writer var; bu yama yeni hata eklemedi.
  Bunlar yeşil veya production readiness kanıtı olarak sunulmaz.

## Apply ve staging'e taşıma sınırları

- Staging public health: HTTP 200, DB bağlı, release
  `staging-20261125T085440Z-977868897cc9`.
- Apply health eski `20260911T101300Z-a5f31e065682` kimliğini bildiriyor; çalışan
  kaynak commit'i olarak tek başına kabul edilmedi.
- Güncel DNS her iki alan için `187.126.20.140`. Eski staging host SSH zaman
  aşımına uğruyor; güncel sunucu belgelenmiş anahtarı `Permission denied (publickey)`
  ile reddetti. Uzak komut, veri aktarımı veya servis değişikliği gerçekleşmedi.
- Dağıtım öncesi gerçek image/source/clean tree, staging DB/storage yedeği ve
  izole restore doğrulanmalı. Yalnız staging app değişmeli; production'a switch yok.
- Şablon aktarımı: Apply'da doğru şablon adı/sürümü, HTML/CSS ve brand profile
  eşleştirilir; yalnız bu kayıtlar ve başvurdukları logo dosyaları checksum ile
  staging'e taşınır. Environment-local ID ve object key eşlenir. Token, oturum,
  signed_contract, gerçek acente, imza/delil veya e-posta kuyruğu kopyalanmaz.
- Referans PDF'den kişisel veri veya gerçek imza çıkartılarak HTML yapılmaz.
  Apply'daki canonical HTML erişilemeden şablonun birebir aktarıldığı söylenmez.
- Staging'de dış gönderim kapalı kalır. Sentetik imza/PDF ve e-posta mock testi
  sonrasında gerçek tasarımla public önizleme, portal hesap ve admin indirme denenir.

## Canlı kurtarma ve geri dönüş

Bu yama, eski `emailedAt` değerlerinin doğruluğunu geriye dönük varsaymaz.
Eski anahtarsız outbox kaydı ile yeni anahtarlı kayıt birlikte mevcut olabileceğinden,
canlı kurtarma öncesi TEST02 için kuyruk/SMTP receipt kontrolü gerekir. Kör resend,
genel worker açma veya bütün eski sözleşmelere regeneration uygulanmaz.

Mevcut imzalı final PDF/hash korunur. Eksik PDF için dondurulmuş HTML/config ve
imza kaynağı doğrulanır; yalnız bu kaynakla kontrollü üretim yapılır. PDF üretilirse
indirme iki rolde doğrulanır; mail ancak mevcut teslimat kaydıyla çakışmayacak şekilde
ayrıca yürütülür. Onay durumu elle full yapılmaz.

Kod geri dönüşü önceki staging image/source'a dönüştür; DB restore gerektiren şema
değişikliği yoktur. Aktarılan template/logo kayıtları ayrı manifest ve öncesi snapshot
ile geri alınır; bu geri dönüş de signed kayıtları veya production'ı değiştirmez.
