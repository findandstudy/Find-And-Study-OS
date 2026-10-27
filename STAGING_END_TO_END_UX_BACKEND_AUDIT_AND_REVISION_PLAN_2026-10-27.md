# Staging Uçtan Uca UI/UX ve Önyüz–Arka Yüz Revizyon Planı

Tarih: 27 Ekim 2026  
Ortam: `https://staging.findandstudy.com`  
Kapsam: Public web, staff/admin kabuğu, öğrenci/başvuru, partner/sözleşme, katalog, finans, içerik/web, analiz/kalite, otomasyon/AI ve sistem yönetimi.  
Sınır: Production, production verisi, production migration ledger'ı ve canlı feature state'i değiştirilmez.

## 1. İnceleme yöntemi

- Staging oturumunda 48 ana yetkili rota gerçek UI üzerinden açıldı; başlık, yükleme, boş, hata ve uyarı durumları tarandı.
- Public About sayfası ile managed-page editörü aynı yayınlanmış içerik üzerinden karşılaştırıldı.
- Dashboard, Pages, AI Persona, AI Action Queue, katalog ve sistem sağlığı ekranlarının frontend sorguları ile backend route/state sözleşmeleri kod seviyesinde eşleştirildi.
- Edcons'in mevcut public/CMS/course-finder/upload/system-health test paketi genişletilerek çalıştırıldı: **153/153 PASS**.
- Testlerin kapsamadığı “başarısız backend cevabının boş veri gibi gösterilmesi”, “aynı ekranda farklı veri kapsamı”, “özellik karantinası UI'da görünmüyor” ve “editör/canlı render farkı” ayrıca incelendi.

## 2. Doğrulanmış bulgular

### S1 — Kritik / yanlış karar üretebilir

1. **Dashboard aynı ekranda farklı sezon kapsamları kullanıyor.** Üst metrikler seçili sezona göre hesaplanırken “Son Öğrenciler”, takipler ve bazı destek panelleri sezonsuz okunuyor. Sonuç: üstte `0`, altta gerçek kayıtlar görülebiliyor; kullanıcı bunu veri kaybı veya bozuk sayaç olarak yorumluyor.
2. **Dashboard destek sorguları backend/HTTP hatalarını boş listeye çeviriyor.** `catch(() => [])` ve `catch(() => ({data: []}))` kalıbı; arka uç arızasını “kayıt yok” durumuna dönüştürüyor. Bu, frontend–backend sözleşmesini görünmez şekilde kırıyor.
3. **AI Persona yüzeyi backend tarafından bilinçli olarak karantinada, UI ise aktif ürün gibi davranıyor.** `/api/ai-personas` güvenlik nedeniyle `409 PERSONA_OWNERSHIP_ADOPTION_REQUIRED` döndürüyor; Persona ekranı hata toast'ı verip create/toggle/delete kontrollerini göstermeye devam ediyor.
4. **AI Action Queue backend karantinasını boş kuyruk gibi gösteriyor.** Aynı `409` cevabı yakalanmadığı için “0 bekleyen / geçmiş yok” görünümü oluşuyor. Bu gerçek bir empty state değil; capability unavailable state olmalı.

### S2 — Yüksek / editör ve canlı yüzey uyumsuzluğu

5. **Managed-page editöründeki “Görünür” etiketi render edilebilirliği garanti etmiyor.** `team_grid`, `office_list`, `logo_marquee` gibi veri-bağımlı bloklar görünür işaretlenebiliyor; fakat öğe yoksa public renderer `null` döndürüyor. Editör önizlemesi de bölümü sessizce atlıyor. About örneğinde editörde 10 görünür bölüm varken public sayfada Team, Partner Universities ve Offices bölümleri görünmüyor.
6. **Preview, veri-bağımlı blokların neden görünmediğini açıklamıyor.** Admin; bölüm gizli mi, koleksiyon boş mu, filtre mi eşleşmedi ayırt edemiyor.
7. **Website alt modüllerinde dil tutarlılığı eksik.** Türkçe shell içinde `Global Components`, `Navigation`, `Collections`, `SEO Overrides`, `Theme Builder`, `Data Quality` gibi İngilizce ana başlıklar bulunuyor.
8. **Başvuru pipeline'ında shell Türkçe iken aksiyonlar ve stage yardımcı metinleri kısmen İngilizce.** `New Application`, `Drop here`, stage adları ve bazı view etiketleri yerel UI diliyle tutarlı değil.

### S3 — Orta / sürdürülebilirlik ve iyileştirme

9. Frontend kaynaklarında **115 adet** hata yutma/fallback kalıbı var. Bunların bir kısmı bilinçli best-effort davranış olsa da liste/özet ekranlarında empty state ile system error ayrımı için merkezi sınıflandırma yok.
10. Sayfa envanteri çok büyük veri setinde işlevsel fakat uzun program adları aksiyon hücrelerini bastırıyor; yoğun tablo mobil/orta genişlikte kontrollü card/priority görünümüne dönmeli.
11. Sistem Sağlığı doğru biçimde “İnceleme gerekli” gösteriyor; ancak backup, worker heartbeat ve performans ölçümü eksikliği operasyonel backlog olarak kalıyor. Bu UI hatası değil, bilinmeyeni yeşile boyamayan doğru fail-closed davranıştır.
12. 48 ana rota crash olmadan açılıyor; bu smoke sonucu detail modal, mutation ve maker-checker akışlarının tamamının doğru olduğu anlamına gelmez. Her kritik mutation için ayrı receipt/rollback senaryosu korunmalıdır.

## 3. Revizyon sırası

### Faz A — Bu paket

1. Dashboard veri kapsamını seçili sezonla hizala; destek panellerinde loading/empty/error ayrımını açık göster.
2. AI Persona ve AI Action Queue için backend capability/status kontratı ekle; karantina aktifken mutation kontrollerini kaldır ve açıklayıcı unavailable state göster.
3. Managed-page editöründe veri-bağımlı boş blokları “görünür ama veri bekliyor” olarak işaretle; önizlemede neden render edilmeyeceğini göster.
4. Yukarıdaki sözleşmeler için kaynak/test guard'ları ekle.

### Faz B — Sonraki güvenli paket

1. Silent fallback envanterini ekran önemine göre temizle: Dashboard → Applications/Students/Leads → Contracts/Finance → Website tools → yardımcı aramalar.
2. Website ve Applications alt modüllerindeki sabit İngilizce UI metinlerini i18n anahtarlarına taşı.
3. Pages/Website yoğun tablolarına orta ekran priority görünümü ve erişilebilir aksiyon adı ekle.
4. Public–editor karşılaştırmasını Home/About/Countries/Programs/Blog/Contact ve tüm 23 dil için otomatik snapshot/semantic test haline getir.

### Faz C — Operasyonel kanıt

1. Backup/restore, portal worker heartbeat ve API performance ölçüm kaynaklarını staging runtime'a bağla; UI yalnız gerçek kanıtı sunsun.
2. Kritik mutasyonlarda `loading → server receipt → success`, conflict ve retry/recovery senaryolarını staging UAT matrisine ekle.
3. Role × route × mutation negatif yetki testlerini genişlet; görünen kontrol ile backend yetkisi arasında drift bırakma.

## 4. Kabul kriterleri

- Backend hatası hiçbir ana listede “kayıt yok” olarak gösterilmez.
- Aynı paneldeki sayı ve liste aynı season/tenant/role kapsamını kullanır; farklıysa kapsam etiketi açıkça gösterilir.
- Backend capability kapalıysa UI create/edit/approve kontrolü render etmez.
- Editörde “Görünür” olan ama bağımlı verisi olmayan blok için admin açık uyarı görür; public render sonucu sürpriz olmaz.
- 48 ana rota smoke taraması ve mevcut 153 test yeşil kalır.
- TypeScript, i18n ve production build geçer.
- Deployment yalnız staging release zincirinde yapılır; health ve migration ledger deploy öncesi/sonrası aynı kalır.

## 5. Kapsam dışı / ayrıca onay gerektirenler

- Production deploy veya production veri değişikliği.
- Karantinadaki legacy AI Persona kayıtlarını sahiplik bağlamı olmadan yeniden açmak.
- Maker-checker, step-up veya güvenlik kontrolünü UI kolaylığı için bypass etmek.
- Sistem Sağlığı ekranındaki bilinmeyen kanıtları sahte “sağlıklı” değerlerle doldurmak.
