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
