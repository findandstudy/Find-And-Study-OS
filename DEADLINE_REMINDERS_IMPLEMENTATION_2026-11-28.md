# Başvuru son tarihi hatırlatmaları — 28 Kasım 2026

## Uygulama sırası
1. Mevcut okul takvimi, program bağlantısı/özel tarihleri, Bilgi ekranları ve 30/7 kısıtlarını doğrula.
2. Günleri 0–3650 aralığında seçilebilir çoklu liste yap. Genel ayar; üniversite için genel ayarı devral / özel liste / boş listeyle kapat modeli. Mevcut 30 ve 7 varsayılanları korunur, zorunlu seçenek olmaktan çıkar.
3. Sunucuda doğrulama, revision çakışması, aynı transaction'da audit ve değişen ayara bağlı eski bekleyen intent iptali. Tarih/pasife alma değişimlerinde de eski intent iptal edilir.
4. Önizleme kaydedilmiş tarihten ve etkin ayardan hesaplanır; okulun saat diliminde kalan gün ve hedef gün gösterilir. Sentetik kişi önizlemesi ve kapalı gerçek gönderim sınırı korunur.
5. Program takvimi tek doğrulanmış aktif okul dönemi varsa varsayılanı kullanır; birden fazla dönemde tahmin etmez. Program Bilgi penceresi aynı API takvimini gösterir.
6. Yeni metinler 23 dilde; dar API/DB/arayüz testleri, typecheck/build. Staging DB kimliği/yedek/ledger doğrulanmadan migration uygulanmaz. Production yok.

## Başlangıç bulguları
- 0143 migration'ında gerçek DATE alanları, ayrı ders tarihleri, saat dilimi, kaynak ve doğrulama tarihi mevcut.
- UI tarih girişi mevcut; program özel tarih alanları da mevcut.
- 30/7 kısıtı UI, API, TypeScript ve DB CHECK içinde tekrar ediyor.
- Mevcut reminder-preview gerçek kişi listesini değil sentetik fixture'ı döndürüyor.
- Program GET takvimi yalnız açık period ID bağı varsa döndürüyor; Course Finder Bilgi pencerelerinde bu takvim gösterilmiyor.

## Teslim ve doğrulama

- Yerel code commit: `f647bb40`; branch `codex/configurable-deadline-reminders-20261128`.
- Staging integration source: `1402358d36fe`; release `staging-20261128T083905Z-1402358d36fe` (28 Kasım, 11:39:05 Türkiye saati).
- Runtime image: `findandstudy-staging-app:deadline-reminders`. App health `healthy`, public health HTTP 200 / dbConnected=true / exact release PASS.
- Resmî `run-staging-migrations.mjs` exact-source, clean-worktree, least-privilege fas_migrator, DB adı/IP/port ve prefix doğrulamasıyla **145 → 146** PASS.
- Öncesindeki `staging-backup-20261128T083534Z-1402358d36fe` yedeği checksum ile saklandı; aynı PostgreSQL image'ında dış ağa kapalı tmpfs veritabanına gerçek restore yapıldı. Restore sayımları **145 migrations / 151.316 programs / 0 calendar periods** eşleşti. Geçici restore container'ı kaldırıldı.
- İlk container bağımlılık mount denemesi salt-okunur bağlama nedeniyle, ilk migration denemesi Git repository sahipliği nedeniyle kapıda reddedildi; ikisi DB değiştirmedi. Son yürütmede yalnız exact read-only `/source` bağlamı için ephemeral safe.directory tanımlandı; kaynak SHA/clean-worktree kontrolleri kaldırılmadı. Migration gizli env dosyası işlem sonunda silindi.

### Asıl veri bulgusu

Staging'de tarih girişi yeteneği ve gerçek DATE kolonları vardır. Buna karşılık denetim anında `university_application_periods` **0 satır**, 151.316 program içinde `university_application_period_id` **0 dolu**, `application_deadline_override_at` **0 dolu** çıktı. Gerçek takvim/dönem verisi doldurulmamıştır. Legacy `intakes` metinleri doğrulanmış deadline değildir ve takvim tarihine dönüştürülmedi. Bilinmeyen tarihler için tahmin üretilmedi.

### Kullanım

1. **Settings → Notifications → Application deadline reminders:** sistem geneli günler.
2. **Catalog → Universities → Edit → Application deadline reminders:** genel ayarı devral, özel liste veya boş özel listeyle yalnız bu üniversitede kapat.
3. Aynı okul formunun **Application calendar** bölümünde doğrulanmış dönem, açılış/son başvuru, okul saat dilimi, kaynak ve doğrulama tarihi. Ders başlangıç/bitişi ayrı alanlardır.
4. **Catalog → Programs → Edit:** okul dönemi seçimi ve programın özel tarihleri. Tek aktif doğrulanmış dönem otomatik devralınır; çoklu dönemde seçim gerekir. Çelişen override veya başka okulun dönemi API ve DB'de reddedilir.
5. Program ve üniversite Bilgi pencereleri aynı takvim API'sini kullanır. Program takvimi yoksa açıkça doğrulanmış takvim olmadığı belirtilir.

Günler 0–3650 arasında tam sayıdır; en fazla 20 farklı eşik saklanır. 0 son başvuru günüdür. Tekrarlanan günler normalize edilir. Boş liste kapalı anlamına gelir. Varsayılan mevcut 30/7 korunmuştur; kullanıcı istediği günleri kaydedebilir. Genel ayarı değiştirmek üniversitelerin özel listelerini ezmez.

### Test kanıtı

- 10 saf tarih/policy/preview testi PASS: özel günler, sıfır, geçersiz girdi, timezone/gece yarısı, DST/leap day, tek dönem mirası, çoklu dönem, program override ve tarih çelişkisi.
- Gerçek local PostgreSQL üzerinde policy store/HTTP testleri PASS: genel/özel/devral/kapalı, stale revision, eşzamanlı yazma, reset sonrası ABA koruması, audit, bekleyen intent iptali, SENT korunması, takvimi pasife alma, DB gün kısıtı, program/okul dönem eşliği, çelişen program tarihi, anonim 401/agent 403/admin 200/geçersiz üniversite 404/geçersiz gün 400. Sentetik kayıtlar temizlendi; genel local ayar geri alındı. Sequence ve audit geçmişi sıfırlanmadı.
- Frontend, API ve DB TypeScript PASS. Önceden var olan embed form message-map `ur` tip hatası yalnız tip tanımı düzeltilerek giderildi; desteklenen bot dilleri veya runtime davranışı genişletilmedi.
- 23 dilde 18 yeni alan/metin tamamlandı; 11.003 anahtar eşliği ve placeholder kontrolü PASS.
- Staging build: API + frontend production build, 190 mevcut frontend test, kritik sözlük üretimi ve mevcut bundle bütçeleri PASS.
- Gerçek staging UI: genel **45,14,3,0** kaydet/yenile/yeniden aç PASS. Acıbadem özel **21,5** ayarı genel ayar **30,7** yapılınca korundu; tekrar genel ayarı devralma PASS. Test sonunda yalnız SYSTEM `[30,7]` kaldı; üniversite override'ı kaldırıldı, okulun normal katalog alanları değiştirilmedi.
- Üniversite ekleme formunda Add admission period ile tüm tarih/saat dilimi/kaynak alanları doğrulandı; bu testte okul/takvim kaydedilmedi. Program kartının Details penceresinde yeni Application calendar ve doğru “No verified application calendar is available” durumu doğrulandı.
- Türkçe ve Arapça/RTL kartı kontrol edildi; 1.5 gün girilince Kaydet kapalı. Dil tercihi EN'e geri alındı.

### Sınırlar ve geri dönüş

Bu teslim gerçek kitle çözümlemesi veya gönderim worker'ı açmaz. Preview hâlâ sentetik ve `deliveryEnabled=false` döner. Gerçek son tarih bildirimlerini çalıştırmak için doğrulanmış okul takvimleri, açık ilgi/consent eşleşmesi ve ayrı gönderim aktivasyonu gerekir. Production Apply değişmedi; gerçek mesaj/imza/ödeme yoktur.

Kod geri dönüşü önceki `ui-localization-complete` image ve before-deadline env kopyalarıyla yapılabilir; additive tablolar ve migration ledger korunur. Migration yeni program takvim bütünlüğü trigger'ı ekler; hatalı eski girdileri sessizce kabul ettirmek için trigger kaldırılmaz. Veri restore'u otomatik rollback değildir.
