# Pipeline ortak çeviri kapsamı — yalnız local

Pipeline için 130 anahtar, sistemin mevcut lazy-loaded `workPipelines` namespace'i
olarak 23 dil dosyasına eklendi: en, tr, ar, fr, ru, fa, zh, hi, es, id, ur,
tk, ky, kk, uz, tg, bn, pt, ne, vi, ko, uk, it.

Türkçe/İngilizceye özel sözlük ve koşullar kaldırıldı. Ana ekran, pano/tablo,
manuel ekleme/düzenleme, varsayılan yeni aşamalar, ekip erişimi, kaynak seçimi,
favoriler, Excel önizleme ve kılavuz, not/takip/geçmiş, dashboard widget ve
Mesajlar pipeline paneli ortak `useI18n().t` kullanır. Bildirimler de aktif dilin
sözlüğünden okunur. Telefon için iki ortak anahtar da 23 dilde eklendi ve
public critical dictionary üretimine dahil edildi; ilk yüklemede ham anahtar
gösterilmez. Ortak telefon ve kişi atama bileşenlerindeki sabit İngilizce
metinler çevrildi; Urduca dahil RTL ortak `isRTL` üzerinden uygulanır. Telefon
ülke adları desteklenen Intl locale karşılıklarıyla gösterilir ve katalogdaki
aynı aktif satırların yerelleştirilmiş adları da aranabilir.

Kullanıcıların yazdığı pipeline/aşama adları, kişi adları, açıklamalar, not ve takip
başlıkları çevrilmez veya değiştirilmez. Yeni pipeline'ın varsayılan aşamaları
oluşturma anındaki dili kullanır. Excel'in makineye yönelik sütun/sayfa adları,
ID'leri, enum değerleri ve YYYY-MM-DD sözleşmesi import/export uyumluluğu için
sabit kalır; açıklamalar ve uygulama içi kontroller yerelleştirilir.

API doğrulama/erişim/revision kuralları korunur; arayüz ham sunucu hatası yerine
çevrilmiş alan kontrolü veya yeniden yükleme yönlendirmesi gösterir. Diğer
modüllerin iş akışları, API, DB, provider, e-posta/WhatsApp ve staging/Apply
değiştirilmedi. Paylaşılan DialogContent'a opsiyonel closeLabel eklendi; mevcut
çağrılar varsayılan davranışını korur.

Doğrulama:

- Ortak i18n anahtar/placeholder denetimi: 23 dil PASS.
- 24 hedefli test: her dilde runtime sözlük seçimi, atama/validation geri
  bildirimi, bildirim başlık/gövdesi, kullanıcı metninin korunması ve dil/RTL
  source guard PASS.
- Gerçek React render testi: seçici, Excel kontrolleri, not/takip, Mesajlar paneli,
  kişi atama ve telefon 23 dilde render edildi; RTL ve sabit kullanıcı adları PASS.
- Mevcut bildirim testleri 3/3 PASS. Ön yüz TypeScript kontrolü PASS.
- Canlı iç tarayıcıda Settings dil ekranına geçiş, iki sekmede CDP navigation/focus
  timeout nedeniyle doğrulanamadı; görsel tarayıcı PASS iddiası yoktur. Local Vite
  HTTP 200 ve API health/dbConnected başarılıydı.

Tekrar çalıştırılabilir komut: edcons paketinde `test:work-pipeline-i18n`.
Deploy veya remote push yapılmadı.
