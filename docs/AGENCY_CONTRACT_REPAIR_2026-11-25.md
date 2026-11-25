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
- Gerçek build üzerinde sentetik UI: EN 1440px, TR 390px, AR 390px **3/3 PASS**.
  İmzalı/bekleyen kart, yenileme, byte-eşit PDF indirme, 202 sonrası tekrar indirme,
  son onay dashboard'u, dürüst imza başarı metni ve final PDF için regeneration
  kontrolünün bulunmaması doğrulandı. Dış istekler engelli, business mutation yok.
- Normal legacy route ve writer denetimleri genel olarak **FAIL**: başlangıçta da
  aynı 38 legacy hata ve aynı 7 sınıflandırılmamış writer var; bu yama yeni hata eklemedi.
  Bunlar yeşil veya production readiness kanıtı olarak sunulmaz.

### Dağıtım öncesi CI düzeltmesi

`cb116bf6` üzerinde Institution ve Portal kapıları 3/3, Live-first Windows ve iki
PostgreSQL işi PASS oldu. Live-first Linux işi, bu yamadan önce de bulunan eski
katalog test beklentisinde durdu. Yalnız ilgili test güncellendi: gerçek üniversite
düzenleme fonksiyonu mock API ile çalıştırılarak detay ve başvuru dönemlerinin
korunması doğrulanıyor; logo kontrolü mevcut revalidation/ETag davranışını bekliyor.
Katalog ürün kodu, bağımlılıklar ve CI yapılandırması değişmedi. Bu test 17/17 PASS.
Yeni head için uzak CI sonucu ayrıca doğrulanmalıdır.

## Apply ve staging'e taşıma sınırları

Yama dalı `codex/agency-contract-delivery-20261125`, mevcut staging'in exact
`977868897cc9301c7eccd47b7d6647f641827cfb` tabanına oturtuldu. İlk çalışma
tabanındaki iki yeni Home düzenlemesi dışarıda bırakıldı. Bu tabanda tam Edcons
build, mevcut frontend testleri (183/183), i18n/sitemap/bundle bütçeleri yeniden PASS.
API build ve API/Edcons TypeScript PASS. Yerel paket hazır; uzak dağıtım ve
canonical şablon/logo aktarımı erişim engeli nedeniyle henüz yapılmadı.

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

### 25 Kasım VPS konsolu ile ek kanıt

Konsol erişimi sağlandı. `srv2107561` üzerinde staging source HEAD'i temiz
`977868897cc9301c7eccd47b7d6647f641827cfb`; çalışan image ID'si
`sha256:965b6ccd77646fd87d65cbeb0ce1732ed6fd0b6ef02ec930f0cf6bbbd9535031`.
Staging global jobs ve PDF worker false, dış entegrasyonlar false, email disabled true.
Hem Apply hem staging konteynerinde sistem Chromium'u ve Playwright tarayıcısı yok.
Apply'ın son 500 log satırında `browserType.launch` / `Executable doesn't exist`
eşleşmesi 30 kez bulundu. Üretim dosyası, ayarı veya servisi değiştirilmedi.

Yalnız TEST02 için salt-okunur sorgu: session 165 signed, template 48/v6, snapshot'ta
bir style bloğu ve şirket imzası alanı var; signed contract 47'de PDF/hash/emailedAt
yok. Bu nedenle imza kaydı ile PDF/teslimatın tamamlanması ayrı raporlanır.
Apply'ın bağlı release klasöründe Git metadata yok; health release ID'si gerçek
kaynak commit'ini doğrulamak için yeterli değildir.

Staging'de template/brand/signed contract sayıları 0/0/0. Apply'da 49 template,
18 aktif yayımlanmış template var. En yeni İngilizce şirket v7 taslak ve CSS'siz;
yayımlanmış v6 CSS içeriyor. Aktarım yalnız yayımlanmış kaynakları pasif taslak
olarak hazırlıyor; imza konfigürasyonu, signed/session/agency satırları hariçtir.

Bu incelemede bulunan iki ek önkoşul giderildi: eski acente oluşturma/import/resend
yolları taslak/silinmiş şablonları artık seçemez (10/10 test); staging Dockerfile
Chromium ve çok dilli fontları içerir. Gerçek image gate dağıtımdan önce zorunludur.
Yerel public branding PNG'leri için exact-origin/exact-allowlist/content-hash bağlı,
256 KiB sınırlı ağsız logo snapshot okuması eklendi. Global entegrasyon sınırı
değişmez. Birleşik template-selection/local-logo/assets testleri 34 PASS/1 Windows
symlink SKIP; API TypeScript PASS.

İki eski katalog testi daha deklarasyon/metin eşliği yerine mevcut gerçek parser,
projeksiyon ve rota invalidation davranışını kontrol edecek şekilde güncellendi.
Ürün katalog kodu değişmedi. İlgili gruplar 5/5, 72/72, 6/6, 3/3, 68/68 PASS.
Önceden bilinen genel writer/legacy audit açıkları bu test düzeltmeleriyle kapanmaz.

Staging yedeği: `/opt/findandstudy-staging/backups/agency-contract-20261125T180600Z`.
DB dump 11.422.455 byte, SHA-256
`95a3a6ec20f67de6194ac59defe555f77ef64550b8652962d40fb4463564973a`.
Storage archive 16.092.083 byte, SHA-256
`5002828f0d9e2cbcc2b72c8d6d706326cde4768921c2697a61f8b66e9cf6ffa2`.
Network-none disposable PostgreSQL restore PASS: ledger 144 ve digest
`e1a215c2390356b0452e8c460b15cecc`, seçilmiş aggregate sayımlar eşleşti.
Test konteyneri kaldırıldı; staging DB'ye restore yapılmadı.

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
