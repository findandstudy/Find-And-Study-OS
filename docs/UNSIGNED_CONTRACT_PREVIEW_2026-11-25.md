# İmzasız sözleşme önizlemesi

Kapsam: staging yönetici panelinde kayıtlı sözleşme şablonunun tasarımını ve PDF çıktısını, imza veya başvuru oluşturmadan kontrol etmek.

## Kullanım

`/admin/contract-templates` listesindeki göz düğmesi kayıtlı sürümü açar. Taslak/inaktif şablonlar da önizlenebilir. Pencere açıkça imzasız TEST önizlemesi olarak etiketlenir. PDF düğmesi `UNSIGNED-TEST-template-<id>.pdf` indirir. Kaydedilmemiş düzenlemeler önizlemeye dahil değildir.

Yeni `POST /api/contract-templates/:id/unsigned-preview` yalnız aktif `admin`/`super_admin` ve mevcut `contract_templates.view` yetkisiyle çalışır. Gövde yalnız `format: html|pdf` kabul eder; kişi, acente, imza veya serbest veri kabul etmez. Modal, bu ön kontrolden sonra aynı yetkileri tekrar doğrulayan `GET /api/contract-templates/:id/unsigned-preview.html` belgesini gösterir. Eski `/preview` sözleşmesi değiştirilmedi.

## Sınırlar

- Kayıtlı şablon ve gerekiyorsa marka profili yalnız okunur. Agent/signing-session/signed-contract kaydı, audit delili, dosya veya e-posta oluşturulmaz.
- Tüm değişkenler sentetik TEST değerleriyle doldurulur. Şirket imzası dahil gerçek imza verisi çıktıya konmaz. Şablondaki sabit resimler de yalnız kesin eşleşen, önceden izin verilmiş ve yerel public depodan doğrulanmış logo dışında kaldırılır. Profil ve gövde logoları farklı olabilir. Gövdeye gömülü PNG yalnız kendi byte SHA-256 değeri exact allowlist'teki aynı-origin public logo anahtarıyla eşleşip o nesne ayrıca depodan doğrulanırsa kabul edilir; salt data URL veya benzer dosya adı yeterli değildir.
- Logo için mevcut content-addressed public storage yolu kullanılır. `localOnly` seçeneği açık entegrasyon ayarında bile uzak URL isteğini engeller. Linux descriptor-path, hash, MIME ve byte sınırları korunur.
- En fazla dört farklı doğrulanmış logo kaynağı tek sefer okunur; tekrarlı görseller aynı yakalamayı kullanır. Data URL büyümesi her eklemede 2 MiB sınırına karşı kontrol edilir, büyük belge önce oluşturulup sonra reddedilmez.
- HTML, mevcut sanitizer/renderTemplate/branding/documentShell üzerinden geçer; iframe scripts/same-origin izni içermez. HTML belgesi kendi dar CSP yanıtını taşır; global yönetici CSP'si değiştirilmez. CSP ve bağlantı temizliği dış istekleri engeller.
- PDF mevcut Chromium ayarlarını ve ağ engelini kullanır; delil sayfası eklemez. Her sayfaya HTML/CSS'in gizleyemeyeceği imzasız TEST filigranı sonradan çizilir.
- Şablon 512 KiB, HTML 2 MiB, PDF 10 MiB/30 sayfa ile sınırlı; Chromium başlatma/render süresi 30 saniye bütçelidir ve hata/zaman aşımında kapatılır.
- Süreç başına 10/dakika önizleme isteği sınırı vardır. Modal açılışı ön kontrol ve iframe belgesi için iki HTML okuması tüketir; PDF isteği ayrıca sayılır. Mevcut ortak render kilidi doluyken istek kuyruğa alınmaz; 429 döner. Önizleme imza PDF'siyle aynı süreçte eşzamanlı Chromium açmaz.
- Veritabanı okuma beklemeleri mevcut pool bağlantı/query/statement sürelerine bağlıdır: varsayılan 10/30/30 saniye. Ortam değişkenleri bunları değiştirebilir; staging dağıtımı bu değerleri ayrıca doğrulamalıdır. 30 saniye sınırı tüm HTTP isteğinin değil Chromium aşamasının bütçesidir.
- Başarısız/JSON yanıt PDF diye indirilmez; kullanıcı yeniden deneyebilir. Blob URL'si Safari'nin indirmeyi başlatmasına zaman tanımak için 60 saniye sonra temizlenir.

## Doğrulama

- `test-contract-unsigned-preview.ts`: gerçek HTTP router ve CSRF middleware ile 12 PASS. Sentetik veritabanı ve Chromium test çiftleri; tüm DB yazıları, gerçek DB bağlantıları ve dış ağ kapalı. Admin/izin, CSRF, girdi, draft/deleted/size, busy429, hata/timeout/kilit, rate, RTL, PDF yanıtı ve GET belge yetki/CSP sınırı doğrulandı. Bu test gerçek login/oturum açılışının kanıtı değildir.
- `test-contract-local-logo.ts`, `test-contract-pdf-assets.ts`, `test-contract-pdf-render-boundary.ts` ve yukarıdaki suite sonuçları toplamı: Windows'ta 34 PASS, 11 Linux-only SKIP, 0 FAIL. Linux dosya kimliği ve yeni önizleme logo testleri staging geçişinden önce Linux'ta koşulmalıdır.
- `test-contract-unsigned-preview-browser.ts`: gerçek Chromium ile EN/TR/AR tasarımı, RTL, sıfır dış istek, tek sayfa imzasız PDF ve çıktı dosyaları PASS. Screen uyarısı print'te marka başlığını kapatmaz; PDF filigranı ayrı çizilir.
- `artifacts/edcons/scripts/test-contract-unsigned-preview-browser.mjs`: gerçek derlenmiş panel, sentetik API; EN masaüstü, TR/AR 390px modal, CSRF cookie/header adapter bağlantısı, busy hata/yeniden deneme, sandbox, PDF hatası/başarılı indirme ve business mutation yokluğu PASS. Güncel test gerçek uygulamayla aynı `style-src 'self'` içeren üst belge CSP'sini kullanır; negatif kontrolde srcDoc stil kaybını yeniden üretir ve GET belgesinde hem style bloğu hem inline CSS'in çalıştığını doğrular.
- API ve frontend TypeScript kontrolleri PASS. Vite production bundle PASS (mevcut sourcemap/chunk uyarıları sürüyor).
- Sadece `contractTemplates.ts` legacy registry SHA ve ilgili route/guard sayaçları güncellendi. Genel legacy inventory, kapsam dışı mevcut drift nedeniyle FAIL; bütün depo güvenlik kapısının geçtiği iddia edilmez.

Sentetik görsel/PDF kanıtları yerel `uat-evidence/2026-11-25/unsigned-preview` klasöründedir; binary kanıtlar commit'e dahil edilmez. Gerçek staging oturumu ve aktarılan şablonlarla panel UAT'si ayrı yürütülür.

### Staging UAT ile bulunan CSP hatası

İlk sentetik panel testi üst sayfanın production CSP başlığını taşımadığı için `srcDoc` stil engelini yakalamadı. `3b06bf8f` staging UAT'sinde şablon CSS'inin engellendiği görüldü. Mevcut acente formu önizlemesindeki çözüm yeniden kullanılarak iframe gerçek, yetkili GET belgesine geçirildi. Yalnız bu belgenin CSP'si inline CSS'e izin verir; scripts, dış resim/ağ, formlar ve base-uri kapalıdır. İmza, yayın, kayıt oluşturma veya global güvenlik politikası değişikliği yoktur. Düzeltilmiş sentetik CSP testleri geçmiştir; bu düzeltmenin gerçek staging UAT'si ayrıca doğrulanmalıdır.

### Kısıtlı Linux konteyneri için test düzeltmesi

`3b06bf8f` ürün adayı Linux'ta gerçek PDF üretimini geçerken, ayrı screenshot test tarayıcısının varsayılan çok süreçli açılışı konteynerin 128 PID sınırına takıldı. Yalnız `test-contract-unsigned-preview-browser.ts` içindeki bu tarayıcı, üretim render yolundaki `--single-process`, `--no-zygote`, `--disable-gpu` bayraklarını kullanacak şekilde düzeltildi. Ürün kodu ve konteyner kaynak sınırları değiştirilmedi. Güncel test Windows/Chrome'da EN/TR/AR için PASS; aynı üç bayrağı ekleyen ayrı bağlanmış Linux betiği de aynı ürün imajında PASS oldu. Linux kanıtı dağıtım kaydındaki imaj ve gerçekten çalıştırılan betik SHA-256 çiftiyle değerlendirilmelidir; yerel betikle byte eşliği iddia edilmez.

### UAT ile bulunan gömülü logo eksikliği

`99928f64` staging UAT'sinde CSS çalıştı; EN v6 şablonunun gövdesine gömülü public logo ise profil logosuyla aynı mekanizmadan gelmediği için kaldırılıyordu. Salt-okunur incelemede bu PNG'nin hash'i zaten izin verilmiş managed-public nesnesiyle eşleşti. Yukarıdaki exact hash + mevcut yerel nesne doğrulaması eklendi; taslak HTML veya imzalı kayıt değiştirilmedi. `test-contract-local-logo.ts` içine inline-only/embedded-hash/iki logo/dedup/diğer origin/özel görsel/sınır testleri eklendi. Linux descriptor doğrulaması Windows'ta atlanır; Linux pozitif testleri ve gerçek staging logo/PDF görünümü ayrı geçiş kanıtıdır.

## Geri dönüş

Bu ek commit geri alındığında yalnız önizleme düğmesi/endpoint ve yardımcıları kaldırılır. Migration, template publication, imza/evidence veya storage yazısı olmadığı için DB geri yükleme gerektirmez. Önceden imzalanmış sözleşmeler bu akıştan etkilenmez.
