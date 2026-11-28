# Sistem arayüzü çeviri düzeltmeleri — 28 Kasım 2026

## Sonuç ve kapsam

Staging arayüzündeki sabit metinler ortak i18n sözlüklerine taşındı. İngilizce menüde Türkçe kalan “Takım çalışma alanı” artık **Team workspace** olarak görünür. Türkçe seçildiğinde Türkçe karşılığı korunur. Çalışma admin/staff, agent/sub-agent, student ve public React ekranlarının kaynak kodunu, ortak bileşenleri, editör etiketlerini, iletişim kutularını, bildirimleri ve erişilebilirlik etiketlerini kapsar.

Bu bir arayüz yerelleştirme çalışmasıdır. Katalogdaki özgün kurum/program adları, kullanıcıların yazdığı notlar, CMS'de kayıtlı editoryal içerikler, tarihsel imzalı sözleşmeler, API yolları, HTTP fiilleri, rol/statü kimlikleri ve çalıştırılabilir kod örnekleri otomatik olarak değiştirilmedi. Marka adları ve teknik kısaltmalar çeviri eksikliği sayılmaz.

## Bulunan ve giderilen sorunlar

- Menüde ve ekranlarda doğrudan yazılmış Türkçe/İngilizce metinler ortak çeviri erişimine alındı; 4.305 farklı UI metni kaydedildi.
- Yedi sözlükte önceki alanları sessizce ezen mükerrer JSON namespace'leri düzeltildi.
- KDE/Qt gibi alakasız yazılımlardan kalmış bozuk tercümeler temizlendi. Özellikle Türkmence, Kırgızca, Kazakça, Özbekçe, Tacikçe ve Urduca CRM terimleri yeniden ele alındı.
- Toplam **137.696 sözlük girdisi** AI çeviri/inceleme hattından geçirildi; **125.852 değer** değişti. Bu sayılar dil başına girdilerin toplamıdır, farklı İngilizce metin sayısı değildir. Ayrıntı: `reports/ui-localization-repair-counts.json`.
- Değişkenler, tekrarlanan yer tutucular, boş metin ve örnek kod koruması düzeltildi. Değerleri değişmeyen teknik ifadeler korundu.
- Dil değişimi sözlük yüklenmeden tamamlanmaz. Başarı bildirimi yeni seçilen dilde üretilir. Eski deployment'ın public sözlüğünün önbellekten gelmesini önlemek için ETag yeniden doğrulaması kullanılır.
- Bildirim kapatma ve ekran okuyucu bildirim etiketleri ortak i18n'e bağlandı.
- Arapça, Farsça ve Urduca RTL yönleri doğrulandı; açıklama metni 23 dilde bu üç dili doğru anlatır.
- Büyük sözlükler başlangıç paketine eklenmedi. Her dilin UI sözlüğü iki ayrı lazy chunk olarak yüklenir; mevcut boyut sınırları artırılmadı.
- Settings içindeki koşullu çağrılan yardımcı fonksiyonlarda hook sırası bozulmadan çeviri bağlamı kullanılır.

## Kalıcı kalite kapıları

`artifacts/edcons/scripts/check-i18n.mjs` artık kullanılan anahtarların varlığını, 23 sözlüğün anahtar eşliğini, yer tutucu eşliğini, mükerrer JSON alanlarını, boş çevirileri ve bilinen bozuk çeviri kalıplarını denetler. Sidebar başlıkları ortak i18n üzerinden gelmek zorundadır.

`test-ui-localization.tsx` tüm dillerde runtime erişimini, ham anahtar göstermeyen fallback'i, boş UI metnini, tekrarlanan değişkenleri, sidebar çevirilerini, public sözlük yeniden doğrulamasını ve yeni dilde başarı bildirimini denetler. Bu kontroller editoryal üslubun insan incelemesinin yerini almaz; teknik gerilemeleri yakalar.

## Doğrulama kanıtı

| Kontrol | Sonuç |
|---|---|
| 10.985 İngilizce anahtar, 23 dilde key/placeholder eşliği | PASS |
| UI yerelleştirme regresyonları | 5/5 PASS |
| Son staging normal frontend build içindeki hedefli testler | 190/190 PASS |
| Ek odaklı dashboard/account testleri | 22/22 PASS |
| Ek editor/template testleri | 86/86 PASS |
| UI/notification/persona testleri | 36/36 PASS |
| Frontend TypeScript, yerel teslim kontrolü | PASS, exit 0 |
| API production build | PASS |
| Frontend production build, sitemap ve public critical sözlük üretimi | PASS |
| Başlangıç JS/CSS ve locale chunk boyut bütçeleri | PASS; limitler değişmedi |
| Gerçek staging tarayıcısında 23 dil geçişi | PASS |
| Arapça/Farsça/Urduca RTL | PASS |
| Yeni dilde başarı bildirimi, TR → AR | PASS; `تم تحديث اللغة` görüldü |

Gerçek tarayıcıda dil matrisi: en, tr, ar, fa, fr, ru, zh, hi, es, id, ur, tk, ky, kk, uz, tg, bn, pt, ne, vi, ko, uk, it. Her geçişte ilgili Settings başlığı, sidebar çalışma alanı başlığı, html.lang/dir ve ham uiText anahtarı çıkmaması kontrol edildi. Bu, tüm olası kayıt/rol/işlem kombinasyonlarının manuel test edildiği anlamına gelmez.

İngilizce açılış kontrolü yapılan 12 modül: Pipelines, Leads, Students, Applications, Messages, Tasks, Contracts, Pages, Blog, Finance, Users, Team workspace. Katalog ayrıca İngilizce ve Türkçe, pipeline ve görev ekranları Türkçe kontrol edildi. Ayarlar/entegrasyonlardaki AI bağlantı etiketleri İngilizce doğrulandı; kayıtlı anahtarlar okunmadı veya değişmedi. Dil tercihi kontrol sonunda İngilizceye geri alındı.

## Yayın ve veri sınırları

Yalnız staging app yeniden oluşturuldu; DB migration yoktur. Production Apply değiştirilmedi. Gerçek e-posta, WhatsApp veya imza işlemi yapılmadı. AI'a yalnız çeviri kaynak metinleri gönderildi; kişi kayıtları, belgeler ve secret değerler gönderilmedi. Geçici sözlük aktarım dosyası final public paketten kaldırıldı, tamamlanan geçici çeviri worker container'ları temizlendi.

Yerel çalışma branch'i: `codex/local-work-pipelines-20261127`. Server integration, staging'in mevcut PublicPage tasarım farklarını koruyan `codex/staging-work-pipelines-20261128` branch'idir; yerel dosyalarla sunucu körlemesine değiştirilmedi. Çeviri JSON'ları yerel branch'e alınmış ve GitHub'a gönderilmiştir.

Final release ve sağlık kanıtı aşağıdaki teslim kaydında tutulur.

### Final teslim kaydı

- Staging source: `faea5ad3953e` (tam kimlik staging Git'inde tutulur).
- Release: `staging-20261128T073747Z-faea5ad3953e` — 28 Kasım 2026, 10:37:47 Türkiye saati.
- Image: `findandstudy-staging-app:ui-localization-complete`.
- Public `/api/health`: HTTP 200, `status=ok`, `dbConnected=true`, exact release eşleşti. Docker health: `healthy`.
- Final source üzerinde Linux frontend typecheck + normal frontend build tekrar PASS; 190 test PASS. Başlangıç JS gzip 155.942 byte, CSS gzip 56.990 byte, en büyük core locale gzip 107.915 byte; bütçeler korunuyor.
- Son yayında İngilizce `Team workspace` görüldü; TR/AR/EN geçişi ve hedef dil bildirimi doğrulandı. Bildirim bölgesinin erişilebilir adı Arapçada `الإشعارات (F8)`, İngilizcede `Notifications (F8)` oldu.
- Geçici deployment sırasında tek app container yeniden başlatılırken bir tarayıcı isteği Bad Gateway aldı; container açıldıktan sonra yeniden yükleme ile düzeldi ve final health/UI kontrolleri PASS oldu. Sürekli runtime hata gözlenmedi.
- Staging Git worktree clean. Yerel code head `e1f40758`; kaynak/deploy kanıtı ve bu rapor ayrıca dokümantasyon commit'inde saklanır.

### Sınırlar

AI ile incelenen tüm cümlelerin her dilde dilbilimci tarafından tek tek onaylandığı veya bütün rol/veri kombinasyonlarının manuel denendiği iddia edilmez. Kontrollerin kapsamı yukarıda açıktır. Kullanıcı içeriği ve editoryal sayfa çevirisi ayrı veri işidir. Bu teslim ortak arayüz sözlüklerini ve bunların kullanımını düzeltir; staging dışındaki Academy/Apply ortamlarını değiştirmez.
