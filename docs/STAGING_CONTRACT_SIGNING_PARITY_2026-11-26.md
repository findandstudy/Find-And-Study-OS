# Staging sözleşme alanları ve imza öncesi doğrulama eşliği — 26 Kasım 2026

Durum: yerel uygulama ve testler PASS; bu kayıt staging deploy/gerçek imza/e-posta kanıtı değildir.

## Kaynak ve sınır

- Çalışma tabanı `6de3a6823a2a83e5f105543fd5b4608cd756664d`; önceki staging `8b7e865d` üstündeki fark yalnız UAT belgesiydi.
- Referans: Apply `c0a02d8c99f4baf98bc6d52e74813dfc36b7a3fb` içindeki tamamlanmış alan/preflight/UI düzeltmeleri.
- Staging’in mevcut `email_queue`, teslimat makbuzu, SMTP sınırları, oturum/yetki kontrolleri ve imzasız önizleme/PDF uçları korundu.
- Apply `signed_contract_deliveries` tablosu, worker’ı, migration veya ortam değişkeni aktarılmadı. Veritabanına, harici servislere ve mevcut imzalı kayıtlara yazılmadı.

## Bağlanan davranış

1. Sözleşmenin gerçek görünür alanları ve zorunlu form şeması birlikte kontrol edilir. HTML/CSS yorumlarındaki örnek değişkenler zorunlu alan sayılmaz; görünür CSS metni ve öznitelikler sayılır.
2. Firma/kişi/e-posta/WhatsApp alanlarının açıkça girilen camelCase değerleri kanonik alanlara eşlenir. Açık boş veya farklı kanonik değer önceliklidir. Genel telefon hiçbir zaman WhatsApp cevabı sayılmaz.
3. Self-fill formu eksik zorunlu alanlarda yeniden açılır; kayıt hatası satır içinde gösterilir. Sunucunun yeni alan istemesi formu yeniler, girilen cevapları korur. İmzalı oturum tekrar form aşamasına dönmez.
4. Intake güncellemesi sunucuya ait başvuru ilişki hash’ini korur. Satır kilidi ve içerik kimliği karşılaştırması, eşzamanlı imza veya şablon değişikliğinin eski form verisiyle üzerine yazılmasını engeller. Admin-driven intake düzenleme yasağı korunur.
5. Gerçek `finalizeSign` yolu imza kaydından önce yalnız dondurulmuş içerik, alan, doğrulama delili ve resim girdilerini kontrol eder. Eksik alan, dış resim veya geçersiz snapshot 422 üretir; imza kaydedilmez. Admin-driven eksik bilgi, yetki genişletmeden personel düzeltmesi ister. Zorunlu alanı olmayan statik sözleşmede null intake kabul edilir.
6. Preflight sonrası transaction içinde oturum yeniden kilitlenir ve imzayı yetkilendiren içerikle eşleştirilir. Bu kontrol posta worker’ı kapalıyken de çalışır.

Yeni `contractSigningPreflight.ts` yalnız içerik hazırlama/doğrulama yapar; DB, Chromium, storage, posta kuyruğu veya sağlayıcı çağrısı içermez. Mevcut render ve branding bileşenleri kullanılır.

## Doğrulamalar

| Doğrulama | Sonuç |
| --- | --- |
| `test-contract-future-signing.ts` | 10 PASS |
| `test-contract-public-intake.ts` — gerçek router handler, DB test doubles | 6 PASS |
| `test-contract-signing-preflight.ts` — gerçek finalizer; reddetme, transaction rollback, içerik yarışı, imzalı kayıt koruması | 9 PASS |
| `test-contract-inline-logo-render.ts` — sanitize/frozen HTML, güvenlik reddi, gerçek Chromium/PDF | 3 PASS |
| Mevcut sign/shell/delivery-status/signed-delivery/agent-lifecycle regresyonları | 64 PASS |
| `test-contract-required-intake-browser.mjs` — build edilmiş gerçek SignFlow; EN masaüstü, TR/AR mobil | 3 PASS |
| API ve web TypeScript | PASS |
| API build | PASS |
| Web tam build — 183 önkontrol, 23 dil i18n eşliği, Vite, critical sözlük, sitemap/bundle bütçesi | PASS |
| `git diff --check` | PASS |
| Bağımsız kaynak incelemesi — account/delivery ajanı | Somut yeni blocker yok; queue/SMTP/yetki sınırı korunuyor |

Backend toplamı 92 PASS; tarayıcı senaryoları ayrıca 3 PASS. Tarayıcı testi yalnız loopback HTTP + sentetik API cevapları kullandı; diğer ağ istekleri engellendi. Gerçek Chromium testi yalnız sentetik resim ve metin kullandı. Kalıcı DB testi veya gerçek imza/e-posta gönderimi yapılmadı. Transaction yarış/rollback kanıtı DB test doubles üzerindedir; PostgreSQL eşzamanlılık kanıtı olarak sunulmaz.

## Değişen dosyalar

- `artifacts/api-server/src/lib/contractSigningFields.ts`: alan bulma, açık alias eşleme ve server-owned ilişkiyi koruma.
- `artifacts/api-server/src/lib/contractSigningPreflight.ts`: yan etkisiz frozen-input doğrulama ve karşılaştırma kimliği.
- `artifacts/api-server/src/lib/signContract.ts`: gerçek imza yoluna preflight ve kilitli içerik kontrolü.
- `artifacts/api-server/src/routes/publicSigning.ts`: zorunlu alan projection, güvenli intake kaydı ve yapılandırılmış hata.
- `artifacts/edcons/src/pages/sign/SignFlow.tsx`: eksik alan/kayıt hatası/yenilenen form akışı.
- Yukarıdaki dört API test dosyası, bir tarayıcı test dosyası ve bu belge.

## Operasyon sınırı ve geri dönüş

Bu patch yalnız yeni imza öncesi kontrolleri eşler; eski imzalı sözleşmelerin snapshot/PDF/hash/teslimat kayıtlarını dönüştürmez. Tarihsel PDF yeniden oluşturma veya posta worker’ını açma yetkisi/kanıtı değildir. Mevcut worker flag’leri kapalı tutulmalıdır. Staging’de yalnız açıkça TEST belgeleri ve test kimlikleriyle ayrıca UAT yapılmalıdır; gerçek Apply kaşesi/imzası/başvuru kayıtları staging’e taşınmaz.

Migration yoktur. Sorunda bu küçük feature commit geri alınabilir; mevcut DB/immutable belge verileri geri yüklenmez veya değiştirilmez. Remote push/deploy, runtime flag ve gerçek gönderim bu yerel görevde yapılmadı.

Eski, henüz imzalanmamış admin-driven bağlantıda zorunlu snapshot/resim girdisi eksikse yeni kontrol 422 döndürür ve personel düzeltmesi gerekir; otomatik doldurma veya eski imzalı girdiyi değiştirme yapılmaz.
