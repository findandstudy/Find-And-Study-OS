# Pipeline staging UI/UX kabul incelemesi — 28 Kasım 2026

Kullanıcının açık admin oturumunda iç tarayıcıyla yapıldı. Production Apply'a dokunulmadı.

## Gözlenen ve düzeltilen
- Admin ve staff dashboard'da bileşen iki kez mount edilmişti. Başlık öncesi kopya kaldırıldı; aktivite varsa başlık altında bir bileşen, veri yoksa boş kutu yok.
- Bazı pipeline kısa çevirileri hatalı ortak sözlüklerden türetilmişti. Pipeline namespace'inde altı dilin 36 etiketi, diğer dillerin ilgili sorumlu etiketleri revize edildi; not ve atama menüsü ortak pipeline çevirisine alındı. CRM ortak copy'si değiştirilmedi.
- RTL'de sabit sol sidebar, sağdaki flex boşluğuyla çelişerek araçları örtüyordu. Ortak layout sidebar side değerini isRTL ile eşliyor. Canlı Arapça görünümde sağ sidebar ve tüm araçlar görünür doğrulandı.
- Telefon/e-posta metni bdi/ltr, toolbar sarma ve daralabilme sınırları düzeltildi.

## Gerçek UI kanıtı
- 23 dilin her birinde pipeline ana ekranı açıldı; sentetik kullanıcı metinleri korundu.
- Yeni TEST pipeline, elle kayıt, +90 telefon kodu ve kaydın yeniden açılması PASS.
- Pano/tablo, favori ekleme/çıkarma, aranabilir pipeline seçimi PASS.
- Kart drag/drop New -> In Progress ve kalıcı sonuç PASS.
- Not kaydı, tarih seçicisiyle takip kaydı, dashboard projection ve in-app notification PASS.
- Takip tamamlandı; ileride deneme hatırlatması üretmeyecek.
- Embed kaynak listesinde mevcut Website contact form görüldü. Hiçbir gerçek kaynak bağlanmadı.
- XLSX indirildi; aynı dosya UI upload önizlemesinde create=0/update=0/unchanged=1/error=0. Bu tur import commit'i yapılmadı.
- Son yayından sonra dashboard bileşen sayısı 1 olarak UI'da doğrulandı.
- Yeni atama menüsü Arapçada doğru arama/ben/ata metinleriyle açıldı; sorumlu ataması kaydedildi.
- Dil tercihi başlangıçtaki EN'e döndürüldü; deneme favorisi kaldırıldı.

## Sınırlar
Aktif mesaj kanalı bulunmadığından Inbox iki yön stage/owner eşliği bu oturumda UI ile test edilmedi (önceki API test kanıtı ayrıdır). Görsel kontroller Super Admin ve mevcut desktop viewport içindir; mobil override gerçek viewport'a uygulanmadığından mobil PASS iddiası yoktur. Yeni TEST pipeline inceleme için korunur. Pipeline/aşama adları kayıt verisidir; dil değişimi bunları yeniden adlandırmaz.

## Yayın ve kontroller
Local commits ef6274aa + ac850912; staging final integration a6ecdc5706c608576e9153a7df701577abf53b27.
Release staging-20261128T053107Z-a6ecdc5706c6; app healthy, health HTTP200/dbConnected=true.
Frontend-only bounded overlay; API bundle aynı, migration yok. Önceki image ve host env kopyaları rollback için korunur.
TypeScript PASS; i18n 23 dil anahtar/placeholder parity PASS; 24 runtime ve 23 dil React render PASS; staging frontend build PASS. Geniş E2E yük testi çalıştırılmadı.
