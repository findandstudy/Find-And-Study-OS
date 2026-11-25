# Acente imza sonrası PDF, teslimat ve hesap durumu düzeltmesi

Tarih: 25 Kasım 2026. Kapsam: Apply'da bildirilen TEST ACENTE 02 sorunları;
aynı kod düzeltmesinin staging'e taşınması. İmzalı acente kayıtları staging'e
kopyalanmayacak. Yalnız şablon/tasarım/logo aktarımı kullanıcı tarafından istendi.

## Gözlenen ile çıkarımın ayrımı

- Kullanıcı ekranlarında public ve admin PDF indirme aynı bekleme mesajını veriyor.
- Yetkili test posta kutusunda hesap kurulum ve sözleşme imzalama daveti var;
  imzalı PDF mesajı/eki aramada yok. Bu, SMTP logu veya tüm posta sisteminin denetimi değildir.
- İmzalamak ve parola kurmak, son yönetici ticari erişim onayının yerine geçmez.
  Son salt-okunur kontrolde TEST02 application 12 için `approved_at` null:
  inceleme/onay beklenmesi bu kayıt için açıklanmıştır; otomatik full yapılmadı.
- Son VPS kontrolünde Apply ve staging runtime'larında Chromium bulunmadığı ve
  Apply logunda tarayıcı executable hataları doğrulandı. Aşağıdaki ek kanıt bu
  PDF önkoşulunu gösterir; production worker/ayar/servis veya eski PDF değiştirilmedi.
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

Şema/migration, kimlik doğrulama, ödeme ve CI/CD değişmedi. Staging'e özel
Chromium/font paketleme önkoşulu ve ağsız logo capture aşağıdaki ek kapsamdadır.
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
Sonraki `8f` adayında Live-first Windows ve iki PostgreSQL işi PASS;
Institution 3/3 ve Portal 3/3 PASS. Live-first Linux, baseline `977868` ile
değişmeyen dosyalardaki yedi mevcut writer-inventory hatasında durdu. Ayrıca
security-hardening grubundaki altı Anthropic assertion hatası başlangıçta da
mevcut; bu yamayla kapatılmış veya PASS olarak sayılmadı. Genel CI bütünü yeşil
değildir. Final `0f79d6de45a322aa1deeb0436a0d55b04c00080e` için
[Institution 45675707194](https://github.com/findandstudy/Find-And-Study-OS/actions/runs/45675707194)
ve [Portal 45675707235](https://github.com/findandstudy/Find-And-Study-OS/actions/runs/45675707235)
3/3 PASS. [Live-first 45675707262](https://github.com/findandstudy/Find-And-Study-OS/actions/runs/45675707262)
üzerinde Windows ve iki PostgreSQL işi PASS; Linux işi testler, typecheck,
build/bundle bütçesi ve çeviri kontrolünden geçip aynı yedi writer hatasında durdu.
Sonraki legacy-role ve live-security adımları CI'da çalışmadı. Frozen manifest
adımı bu feature branch için koşulu gereği uygulanmaz.

Atlanan live-security komutları yerelde ayrıca çalıştırıldı: ana security grubu
120/120, AI delivery 5/5, rate-limit 6/6 PASS. Alt komutlar birbirini gizlemeyecek
şekilde ayrı çalıştırıldı; security-hardening'deki yukarıdaki altı mevcut Anthropic
beklenti uyuşmazlığı dışında tüm alt komutlar başarılı. PM2, runtime-boundary ve
production-attestation gruplarında toplam üç işletim sistemi kaynaklı SKIP var.
Bu yerel sonuçlar CI'nın atlanan adımlarını başarılıya dönüştürmez.

## Apply ve staging'e taşıma sınırları

Yama dalı `codex/agency-contract-delivery-20261125`, mevcut staging'in exact
`977868897cc9301c7eccd47b7d6647f641827cfb` tabanına oturtuldu. İlk çalışma
tabanındaki iki yeni Home düzenlemesi dışarıda bırakıldı. Bu tabanda tam Edcons
build, mevcut frontend testleri (183/183), i18n/sitemap/bundle bütçeleri yeniden PASS.
API build ve API/Edcons TypeScript PASS. SSH erişim engeli daha sonra VPS web
konsoluyla aşıldı; canonical şablon/logo aktarımı ve final staging uygulama
değişimi aşağıda kayıtlıdır. Production'a dağıtım yapılmadı.

- Dağıtım öncesi staging public health: HTTP 200, DB bağlı, release
  `staging-20261125T085440Z-977868897cc9`; final release aşağıda ayrıca doğrulandı.
- Apply health eski `20260911T101300Z-a5f31e065682` kimliğini bildiriyor; çalışan
  kaynak commit'i olarak tek başına kabul edilmedi.
- Güncel DNS her iki alan için `187.126.20.140`. Eski staging host SSH zaman
  aşımına uğruyor; güncel sunucu belgelenmiş anahtarı `Permission denied (publickey)`
  ile reddetti. Bu yalnız ilk SSH denemesinin sonucudur; sonraki web konsolu
  kanıtı ve sınırlı staging aktarımı aşağıdaki bölümde yer alır.
- Staging DB/storage yedeği ve izole restore doğrulandı. Yalnız staging app
  değiştirildi; production'a switch yapılmadı.
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
yok. Application 12 `approved_at` null. Bu nedenle imza kaydı, son yönetici onayı
ve PDF/teslimatın tamamlanması ayrı raporlanır.
Apply'ın bağlı release klasöründe Git metadata yok; health release ID'si gerçek
kaynak commit'ini doğrulamak için yeterli değildir.

Aktarım öncesi staging template/brand/signed contract sayıları 0/0/0. Apply'da 49 template,
18 aktif yayımlanmış template var. En yeni İngilizce şirket v7 taslak ve CSS'siz;
yayımlanmış v6 CSS içeriyor. Aktarım transaction'ı COMMITTED: bu 18 canonical
kaynak staging'de ID 1–18 olarak **pasif DRAFT**, iki branding profile ve üç
content-addressed PNG ile oluşturuldu. Gerçek şirket imza verisi,
signed/session/agency satırları aktarılmadı; kaynak Apply kayıtları değişmedi.

Canonical Apply template 48 EN, 31 TR ve 34 AR ile gerçek, izole `network none`
Chromium render PASS: sırasıyla **7 / 6 / 6 sayfa**, **284.125 / 285.018 / 579.555
byte** sentetik PDF üretildi. Bütün görüntüler gömülü, kırık görüntü sayısı 0.
Bu tasarım/render kanıtıdır; gerçek imza, acente başvurusu veya e-posta gönderimi
değildir. `8f` candidate image runtime probe ayrıca **34.965 byte** PDF ile PASS.
Bu önceki adayın kanıtıdır; final `0f79d6de` image'ı ayrıca yeniden test edilip
aşağıdaki release ile staging'e alındı.

Bu incelemede bulunan iki ek önkoşul giderildi: eski acente oluşturma/import/resend
yolları taslak/silinmiş şablonları artık seçemez (10/10 test); staging Dockerfile
Chromium ve çok dilli fontları içerir. Gerçek image gate dağıtımdan önce zorunludur.
Yerel public branding PNG'leri için exact-origin/exact-allowlist/content-hash bağlı,
256 KiB sınırlı ağsız logo snapshot okuması eklendi. Global entegrasyon sınırı
değişmez. Bu offline yol yalnız Linux `/proc/self/fd` ile açılmış dosya kimliğini
doğrular; diğer OS veya `/proc` eksikliğinde pathname/HTTP fallback yapmadan
fail-closed kalır. Önceki birleşik template-selection/local-logo/assets grubu
34 PASS/1 Windows symlink SKIP idi. Son yarış düzeltmesinin Windows hedef testleri
14 PASS/10 Linux kapsamlı SKIP; API TypeScript PASS. Linux doğrulaması aşağıdaki
final image üzerinde ayrıca yapıldı; Windows SKIP sonuçları Linux kanıtı sayılmadı.

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

### Final staging release ve doğrulanan sınırlar

- Kod: `0f79d6de45a322aa1deeb0436a0d55b04c00080e`.
- Release: `staging-20261125T183354Z-0f79d6de45a3`.
- Image ID: `sha256:57a8fb4c934d45a36a8c20e5175e5c3e6068e1be3b8d847d45e928aae6d31e14`.
- Staging app konteyneri: `f9e951de6c17`.
- Public health HTTP 200, `dbConnected=true` ve release kimliği eşleşti;
  staging noindex koruması doğrulandı. Uygulama healthy, restart sayısı **0**;
  incelenen loglarda bilinen hata örüntüsü eşleşmesi **0**.
- Staging ledger **144**; template **18**, aktif template **0**, yayımlanmış
  template **0**, signed contract **0**. Aktarılan taslaklar kullanıma açılmadı.
- Apply app, Apply DB ve staging DB konteyner kimlikleri/başlama zamanları
  değişmedi. Production mutation, migration veya restore yok.
- Staging ledger'ın yedek öncesi ve dağıtım sonrası aynı formülle hesaplanan
  özeti birebir **`144|f237827b8ad18eb621689c458c0b7f7a`**. Yukarıdaki restore
  doğrulamasının `e1a215c2390356b0452e8c460b15cecc` değeri farklı bir aggregate
  formülünden gelir; iki farklı formülün digest farkı migration drift'i değildir.
- Üç public branding logo URL'si HTTP 200, PNG ve beklenen SHA-256 ile doğrulandı.
  Dış gönderim ve PDF worker kapalı; şablonlar pasif DRAFT kalıyor.

Final Linux adayında üç gate başarılı: offline logo/template güvenlik testleri,
Chromium gerçek PDF runtime probe ve canonical EN/TR/AR render. Test konteyneri
`--init` ile çalıştırıldı. İlk canonical render denemesi, test harness'inin init
kullanmaması ve ikinci tarayıcı açması nedeniyle **128 PID** sınırında takıldı.
Yalnız sınırlı test harness'i düzeltildi; app'in init davranışı veya PID sınırı
gevşetilmedi. Başarılı tekrar önceki takılan çalışmayı gizlemez.

Final canonical sentetik PDF çıktıları: Apply template **48 EN: 284.754 byte,
7 sayfa**; **31 TR: 285.787 byte, 6 sayfa**; **34 AR: 579.346 byte, 6 sayfa**.
Üçünde de logo data URI olarak gömülü. Üç PDF'nin toplam **19 sayfası**, disposable
yardımcı image içindeki Poppler ile rasterize edildi; bütün sayfaların contact
sheet'i görsel olarak incelendi. Belirgin kesilme veya üst üste binme görülmedi;
CSS, başlıklar, logolar ve Arapça RTL görünümü korundu. Bu görsel tarama metnin
hukuki doğruluğunun veya her pikselin ayrı ayrı incelendiğinin kanıtı değildir.
Bunlar TEST-only imza verileriyle, ağsız/izole render kanıtıdır; gerçek kişi imzası
veya staging/production imzalı kaydı oluşturulmadı.

Non-root checkout'u engelleyen tek bir staging Git dosyası için dar kapsamlı
onarım yapıldı: kaynak checkout'undaki `.git/logs/HEAD` sahibi `0:0` →
`10042:10042`; mevcut **0644** modu korundu. Öncesi yedek/işlem kaydı alındı.
Başka dosya/klasör sahipliği değiştirilmedi.

### İzole gerçek HTTP indirme ve yetki testi

Deployed **`0f79d6de` image değiştirilmeden**, test harness
`9baa9878e2e4744b698ada5e2388b117d06e945e` ile gerçek route'lar üzerinden
**12/12 PASS** elde edildi. Fresh PostgreSQL 16 yalnız şema ve açıkça sentetik
fixture verileri içeriyordu; ortam ağsızdı, host portu açılmadı. Principal adapter
sentetik yetkili/yetkisiz kimlikleri sağladı; bu gerçek login/session testi değildir.

- Hazır PDF: admin ilk/tekrar indirme, public indirme ve sahibi acente indirme
  HTTP **200**, aynı **18.746 byte** ve SHA-256
  **`a49f708aa6ec820ff0f2b163c5264354fbee07e11a6fa3245fe89e3723c9e710`**.
- Eksik PDF ve en yeni imzalı kaydın PDF'si beklenirken HTTP **202**,
  `Retry-After: 30`; eski PDF'ye geri düşülmedi. Bu başlık tahmini hazır olma
  süresi veya 30 saniyede başarı garantisi değildir.
- Başka acente **404**, oturumsuz istek **401**, yetkisiz agent erişimi **403**,
  bilinmeyen public kayıt **404**.
- HTTP süresince test DB'nin **277 public tablosu** değişmedi. Test edilen PDF
  artefaktı ve dosya listesi aynı kaldı; bütün storage ağacı denetlenmiş sayılmaz.
  HTTP aşamasında DB salt okunurdu; dış istek, imzalama/gönderim POST'u yoktu.
- Test DB konteyneri durduruldu ve kaldırıldı. Staging/Apply DB'sine fixture
  veya imzalı kayıt yazılmadı.

İlk harness denemeleri adresin CIDR biçimi ve dinamik CJS yüklemesi nedeniyle
fixture insert öncesinde başarısız oldu. Bunlar yalnız test harness'indeki
`f44477e1` ve `9baa9878` commit'leriyle düzeltildi; ürün hatası veya ek uygulama
dağıtımı olarak sayılmadı.

Staging yönetici oturumu hâlâ giriş ekranına yönleniyor; ayrıca staging'de mevcut
signed record yok. Bu nedenle oturumlu tarayıcıda gerçek admin/agency PDF indirme
**doğrulanmadı**. Gerçek e-posta gönderimi, hesap onayı/etkinleştirme veya gerçek
signed-record akışı yapılmadı.
Bu release yalnız staging UAT kapsamındadır; genel CI/güvenlik baseline açıkları
nedeniyle production veya merge hazırlığı ilan edilmez.

### Kalan işler ve ayrı doğrulama kapıları

1. Staging'de normal admin/agency oturumu ve izole TEST kaydıyla tarayıcı üzerinden
   My Account/Agency ve admin indirme UAT'sı. Sentetik principal HTTP kanıtı bunun
   yerine geçmez; parola istenmedi ve mevcut hesap etkinleştirilmedi.
2. Pasif DRAFT şablonların yetkili içerik/marka incelemesi ve ayrı yayın kararı.
   Gerçek şirket imzası aktarılmadı; bu rapor şablonları otomatik yayımlamaz.
3. Gerçek teslimat testi için izole alıcı ve gönderim kapsamı ayrıca belirlenmeli.
   Worker/dış entegrasyonlar kapalı kalır; SMTP teslimi yapılmış sayılmaz.
4. Genel CI'daki yedi writer inventory ve 38 legacy-route baseline açığı ile
   altı Anthropic güvenlik testi/policy uyuşmazlığı ayrı kapsamda çözülmeli.
   Sınıflandırma/karantina gevşetilmedi; CI kontrolleri kapatılmadı veya başarılı
   gösterilmedi. Genel CI yeşil değil.
5. Apply TEST02'nin tarihsel PDF/teslimat kurtarması ve production dağıtımı ayrı
   onaylı operasyon gerektirir. Bu staging çalışması Apply'daki eksik PDF'yi,
   gerçek e-posta gönderimini veya bekleyen ticari onayı tamamlamadı.

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
