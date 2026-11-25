# İmzasız sözleşme önizlemesi

Kapsam: staging yönetici panelinde kayıtlı sözleşme şablonunun tasarımını ve PDF çıktısını, imza veya başvuru oluşturmadan kontrol etmek.

## Kullanım

`/admin/contract-templates` listesindeki göz düğmesi kayıtlı sürümü açar. Taslak/inaktif şablonlar da önizlenebilir. Pencere açıkça imzasız TEST önizlemesi olarak etiketlenir. PDF düğmesi `UNSIGNED-TEST-template-<id>.pdf` indirir. Kaydedilmemiş düzenlemeler önizlemeye dahil değildir.

Yeni `POST /api/contract-templates/:id/unsigned-preview` yalnız aktif `admin`/`super_admin` ve mevcut `contract_templates.view` yetkisiyle çalışır. Gövde yalnız `format: html|pdf` kabul eder; kişi, acente, imza veya serbest veri kabul etmez. Eski `/preview` sözleşmesi değiştirilmedi.

## Sınırlar

- Kayıtlı şablon ve gerekiyorsa marka profili yalnız okunur. Agent/signing-session/signed-contract kaydı, audit delili, dosya veya e-posta oluşturulmaz.
- Tüm değişkenler sentetik TEST değerleriyle doldurulur. Şirket imzası dahil gerçek imza verisi çıktıya konmaz. Şablondaki sabit resimler de yalnız kesin eşleşen, önceden izin verilmiş ve yerel public depodan doğrulanmış logo dışında kaldırılır.
- Logo için mevcut content-addressed public storage yolu kullanılır. `localOnly` seçeneği açık entegrasyon ayarında bile uzak URL isteğini engeller. Linux descriptor-path, hash, MIME ve byte sınırları korunur.
- HTML, mevcut sanitizer/renderTemplate/branding/documentShell üzerinden geçer; iframe scripts/same-origin izni içermez. CSP ve bağlantı temizliği dış istekleri engeller.
- PDF mevcut Chromium ayarlarını ve ağ engelini kullanır; delil sayfası eklemez. Her sayfaya HTML/CSS'in gizleyemeyeceği imzasız TEST filigranı sonradan çizilir.
- Şablon 512 KiB, HTML 2 MiB, PDF 10 MiB/30 sayfa ile sınırlı; Chromium başlatma/render süresi 30 saniye bütçelidir ve hata/zaman aşımında kapatılır.
- Süreç başına 10/dakika önizleme sınırı vardır. Mevcut ortak render kilidi doluyken istek kuyruğa alınmaz; 429 döner. Önizleme imza PDF'siyle aynı süreçte eşzamanlı Chromium açmaz.
- Veritabanı okuma beklemeleri mevcut pool bağlantı/query/statement sürelerine bağlıdır: varsayılan 10/30/30 saniye. Ortam değişkenleri bunları değiştirebilir; staging dağıtımı bu değerleri ayrıca doğrulamalıdır. 30 saniye sınırı tüm HTTP isteğinin değil Chromium aşamasının bütçesidir.
- Başarısız/JSON yanıt PDF diye indirilmez; kullanıcı yeniden deneyebilir. Blob URL'si Safari'nin indirmeyi başlatmasına zaman tanımak için 60 saniye sonra temizlenir.

## Doğrulama

- `test-contract-unsigned-preview.ts`: gerçek HTTP router ve CSRF middleware ile 11 PASS. Sentetik veritabanı ve Chromium test çiftleri; tüm DB yazıları, gerçek DB bağlantıları ve dış ağ kapalı. Admin/izin, CSRF, girdi, draft/deleted/size, busy429, hata/timeout/kilit, rate, RTL ve PDF yanıtı doğrulandı. Bu test gerçek login/oturum açılışının kanıtı değildir.
- `test-contract-local-logo.ts`, `test-contract-pdf-assets.ts`, `test-contract-pdf-render-boundary.ts` ve yukarıdaki suite sonuçları toplamı: Windows'ta 34 PASS, 11 Linux-only SKIP, 0 FAIL. Linux dosya kimliği ve yeni önizleme logo testleri staging geçişinden önce Linux'ta koşulmalıdır.
- `test-contract-unsigned-preview-browser.ts`: gerçek Chromium ile EN/TR/AR tasarımı, RTL, sıfır dış istek, tek sayfa imzasız PDF ve çıktı dosyaları PASS. Screen uyarısı print'te marka başlığını kapatmaz; PDF filigranı ayrı çizilir.
- `artifacts/edcons/scripts/test-contract-unsigned-preview-browser.mjs`: gerçek derlenmiş panel, sentetik API; EN masaüstü, TR/AR 390px modal, CSRF cookie/header adapter bağlantısı, busy hata/yeniden deneme, sandbox, PDF hatası/başarılı indirme ve business mutation yokluğu PASS.
- API ve frontend TypeScript kontrolleri PASS. Vite production bundle PASS (mevcut sourcemap/chunk uyarıları sürüyor).
- Sadece `contractTemplates.ts` legacy registry SHA ve ilgili route/guard sayaçları güncellendi. Genel legacy inventory, kapsam dışı mevcut drift nedeniyle FAIL; bütün depo güvenlik kapısının geçtiği iddia edilmez.

Sentetik görsel/PDF kanıtları yerel `uat-evidence/2026-11-25/unsigned-preview` klasöründedir; binary kanıtlar commit'e dahil edilmez. Gerçek staging oturumu ve aktarılan şablonlarla panel UAT'si ayrı yürütülür.

## Geri dönüş

Bu ek commit geri alındığında yalnız önizleme düğmesi/endpoint ve yardımcıları kaldırılır. Migration, template publication, imza/evidence veya storage yazısı olmadığı için DB geri yükleme gerektirmez. Önceden imzalanmış sözleşmeler bu akıştan etkilenmez.
