# Staging güvenlik, veri bütünlüğü ve pipeline teslimi

28 Kasım 2026 · İstanbul saatiyle 17.03

Staging sürümü **staging-20261128T140325Z-4f17cb0f9b12**. Uygulama imajı, sağlık yanıtı ve kaynak commit’i 4f17cb0f9b12f46d622bead92c0d6487a22f077e ile eşleşti. Veritabanı sağlıklı ve migration kaydı 149/149. Uygulama 10042:10042 ile salt okunur kök dosya sistemi üzerinde çalışıyor. [Staging sağlık yanıtı](https://staging.findandstudy.com/api/health)

Kod değişiklikleri GitHub’da **codex/staging-system-hardening-20261128** dalında, **b7033100** ucunda bulunuyor. Bunlar mevcut staging commit’leri üzerine alındı. Staging sunucusunun GitHub yazma denemesi başarısız olduğu için birleşik staging ucu sunucudaki commit olarak kayıtlı. [Kaynak dalı](https://github.com/findandstudy/Find-And-Study-OS/tree/codex/staging-system-hardening-20261128)

## Sistem raporundaki işler

| İş | Sonuç ve doğrulama |
|---|---|
| S-01, S-10, S-11 · Hesap güvenliği | Davet ve ilk doğrulama, idari askıdan ayrıldı. Öğrenci aktivasyonu, kodun tüketilmesi ve CRM kaydı aynı işlemde tamamlanıyor. Ağsız PostgreSQL testinde kod bir kez çalıştı, kurtarma denemesi askıyı kaldırmadı ve kapalı e-posta kuyruğuna satır eklenmedi. Kurtarma denetimi kapalı teslimatı ayrı kaydediyor. |
| S-02, S-03 · CRM | Excel, ekranın sunucu tarafı kayıt kapsamını ve filtrelerini kullanıyor. Hassas sütunlar ek yetkiye bağlı. Toplu işlem, kayıt kapsamını ve aşama yarışını denetliyor. Staging testinde üç CRM listesi ve filtreli Excel, kısıtlı rollerin reddi ve yetkili okuma matrisi geçti. |
| S-04, S-05, S-06 · Yönetim ve halka açık veri | Portal yönetim uçlarına rol sınırı eklendi. Anonim program yanıtı güvenli alan seçimini, kayıt ve ülke görünürlüğünü uyguluyor. Eski blog listesinde yayın durumu, duyurularda kitle ve süre sunucuda kontrol ediliyor. Güvenlik ve rol regresyonları geçti. |
| S-07 · Program Excel | Şablon, satır önizlemesi ve kayıt gerçek XLSX hücreleriyle denendi. Aynı önizlemeden açılan iki eşzamanlı istekten biri kaydedildi ve diğeri 409 aldı. 13 sentetik satırda iki kampüs, PLN, sıfır ve boş ücret ayrımı, ayrı başvuru ve adaptasyon ücretleri, iade paragrafı ve belge gereksinimleri korundu. Kısmi dosyanın atladığı sütunlar mevcut programdan silinmiyor. Kamuya açık staging adresindeki yetkili önizleme 12 ekleme, 1 hatalı satır bildirdi ve aktarımı engelledi. |
| S-08 · Finans | İşlem silme, komisyonu yeniden hesaplama ve denetim kaydı aynı veritabanı işlemine alındı. İzole finans kayıt, arama ve komisyon özeti testleri ile staging rol kontrolleri geçti. |
| S-09, S-17 · Dil ve ilk HTML | 23/23 ana sayfa ilk istekte HTTP 200, doğru HTML dili ve H1 verdi. Hakkımızda, İletişim ve Blog’un İngilizce ve Türkçe ilk HTML’inde canonical, H1 ve yapılandırılmış veri var. Hakkımızda ve İletişim formları tarayıcıda açıldı. İletişim formunda Tab ile alanlar arası geçiş doğrulandı. Staging noindex politikasını sürdürüyor. |
| S-12 · Loglar | Açık başvuru, sağlayıcı ve sözleşme PDF loglarından ham alıcı ve sağlayıcı ayrıntıları çıkarıldı. Ağsız PDF testinde sentetik imzacı e-postası render loguna yazılmadı. |
| S-13 · Takvim | Program dönem bağlantısı açıkça temizlenebiliyor. Üniversite takvim düzenlemesi sürüm ve eşzamanlılık kontrolü kullanıyor. Sentetik testler dönem mirasını, program farkını, geçersiz tarih reddini ve okul saat dilimini doğruladı. |
| S-14 · Ücret geçerliliği | Halka açık gösterim başlangıç ve bitiş tarihlerini dikkate alıyor. Excel ve izole katalog testinde fiyatın birimi ve para birimi korundu. Program başına ayrı sürümlü fiyat geçmişi ve yönetim ekranı açık. |
| S-15 · İmzalı PDF | Staging’de yalnız PDF işçisi açıldı. Sentetik oturum kimliğiyle ağsız konteynerde 13 HTTP kontrolü geçti. Yönetici ve acente aynı sağlam belgeyi aldı. Hatalı artefakt onarımında imza ve tarih korundu, delil özeti yenilendi ve denetim kaydı yazıldı. |
| S-16 · Çeviri | Toplu geçişler beklenen durum ve sürümü denetliyor ve değişen satırları sayıyor. Kuyruk yaşı ve işçi ölçümleri operasyon ekranında görülebiliyor. Tarihsel başarısız işler için toplu yeniden çalışma yapılmadı. |
| S-18 · Ekip çalışma alanı | Oturum, erişim ve modül durumu ayrıştırıldı. Eski AI Personas API’sindeki 409, proje sahipliği belirsiz kayıtları koruyan mevcut kapıdır. Geniş rol testinde bu kapı ve yönetici durum yanıtı doğrulandı. |
| S-19 · Sistem sağlığı | Çeviri ve PDF işçisinin son heartbeat’i, bekleyen işler ve bekleme yaşı ekranda doğrulandı. 149 migration ve 151.316 program içeren staging yedeği ayrı ağsız PostgreSQL’e geri yüklendi. Ayrı konuma yedek, otomatik felaket kurtarma ve ön yüz hata izlemesi için kanıt bu turda oluşmadı. |

## Pipeline iş listesi

| İş | Sonuç ve doğrulama |
|---|---|
| BD-01, BD-02 · Ayarlar ve kanal bağımsızlığı | Lead, Student, Application ve bağımsız iş panosu için e-posta ve WhatsApp ayarları destekleniyor. Şablonlar Mesajlar’dan, gönderici hesapları Entegrasyonlar’dan yönetiliyor. İzole staging testinde dört e-posta ve dört WhatsApp teslimatı sahte sağlayıcıyla gerçekleşti. |
| BD-03 · Çakışma | Uygulama içi bildirim ile harici kanal seçimi ayrıldı. Aynı veritabanı işlemi içindeki ilişkili geçişler eşleniyor ve uygun alıcı için özel kural genel gönderimi üstleniyor. Ayrı işlemlerden gelen tüm ilişkili olaylar için tekil teslimat kanıtı henüz yok. |
| BD-04, BD-05 · Alıcı ve sohbet | Geçiş anındaki alıcı ve sahiplik kaydı gönderimden önce tekrar doğrulanıyor. Atama, iletişim bilgisi, sahiplik veya ayar değiştiğinde eski iş engelleniyor. WhatsApp mevcut kanonik kişi ve hat sohbetini kullanıyor ve engelli alıcıyı eliyor. |
| BD-06 · Portal hesabı olmayan alıcı | Açık. Mevcut kanıt aktif, doğrulanmış e-posta hesabına bağlı. Hesapsız Lead veya bağımsız pano kişisi için adres sahipliği, iletişim izni ve geri alma geçmişi ayrıca kurulmalı. |
| BD-07, BD-08 · Tekrar ve zaman aşımı | Kanal işleri ayrıldı. Gönderim öncesi tekrar sınırlandı. Belirsiz sağlayıcı sonucu otomatik ikinci gönderim üretmiyor. Sentetik test aynı aşamaya yapılan güncellemenin yeni iş çıkarmadığını ve gerçek yeniden girişin ayrı geçiş olduğunu doğruladı. |
| BD-09, BD-10, BD-12 · Yetki ve eşzamanlılık | Pano yöneticisi, aktif kural sahibi ve kayıt kapsamı tekrar denetleniyor. Aşama anahtarı sınırı sunucuya taşındı. Eski sürümle aynı aşama ayarını kaydetme 409 alıyor. |
| BD-11 · Geçmiş | Aşama ve pano kayıtlarında kanal, durum, hata kodu ve sağlayıcı referansı var. CRM kayıt bağlantısı üzerinden ilgili kayda dönülebiliyor. Hat ve şablon uyumunun tüm sağlayıcılarda form seçeneğine yansıtılması ve hata nedenlerinin tüm dillerde açıklanması kısmen açık. |

## Kabul ve çalışma sınırları

- Staging sürümü 11 sentetik rolle 129 rol kontrolünü ve 40 hedefli HTTP kontrolünü geçti. Rol grupları yönetim, personel, acente, alt acente, acente personeli ve öğrenciyi kapsadı. Eski genel yazma senaryosu güvenlik karantinasında. İşlem yapan senaryolar staging’in şemasıyla kurulan ağsız veritabanında yürütüldü.
- Staging imajıyla ağsız 13 iş akışı testi ve 13 PDF HTTP kontrolü geçti. Pipeline E2E testi alıcı ve kural değişiklikleri, aynı aşamada tekrar, yeniden giriş, tenant sınırı, e-posta ve WhatsApp sahte teslimatını kapsadı.
- Tarayıcıda sentetik iş kartı oluşturuldu, atandı ve aşaması değiştirildi. Takip kaydı mevcut **Upcoming Follow-ups** listesinde göründü. Bağlantı doğru kartı açtı ve takip tamamlanabildi. Sentetik pano ardından arşivlendi.
- API ve ön yüz TypeScript, derleme ve 23 dil anahtar ve yer tutucu denetimi geçti. Bütün modüllerin her dilde görsel denetimi bu turda yapılmadı.
- Sürüm geçişinde tek bir geçici HTTP 502 görüldü. Uygulama sağlıklı olduktan sonra aynı sayfa ve kabul testleri geçti.
- Gerçek WhatsApp, e-posta, dış kurum entegrasyonu, ödeme ve canlı imza çalıştırılmadı. Merito’nun gerçek okul ve programları staging’e eklenmedi. Gerçek kurum kararı ve öğrenci yolculuğu baştan sona çalıştırılmadı. Apply production bu yayının hedefi değildi.
