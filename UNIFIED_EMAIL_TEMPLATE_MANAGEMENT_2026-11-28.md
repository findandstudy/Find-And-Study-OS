# Ortak e-posta yönetimi — 28 Kasım 2026

## Yetkili kapsam

Şablonlar Mesajlar → Şablonlar'da; bağlantılar Entegrasyonlar'da; aşamalar ve
bildirim kuralları yalnız şablon/gönderici seçer. Production Apply ve gerçek
iletişim kapsam dışıdır. Kullanıcı yeni bir şablon hazırlama modülü istemedi.

## Uygulama

- Mevcut sürümlü e-posta editörü `Messages/TemplatesTab` içinde yeniden kullanılır.
  Şablon/dil sürümü, önizleme, insan onayı ve emekliye ayırma aynı API/veride kalır.
- Eski sistem bildirim metinlerinin dil editörü de aynı sayfaya taşınır; eski
  gövde ve çeviriler korunur. Bildirimler ekranında gövde yazılmaz. Buradan yalnız
  ortak şablon/gönderici bağlanır; mevcut gövde alanları yeniden normalize edilmez.
- Bildirimler'de hazırlık kontrolü ve gönderim geçmişi kalır; gönderici editörü yoktur.
- Entegrasyonlar → Email (SMTP) → Accounts mevcut gönderici editörünü kullanır.
  Burada “Mevcut SMTP entegrasyonunu kullan” bağlantısı vardır. Yeni parola kopyası
  oluşturulmaz: `configEncrypted=null`, metadata'da `sourceIntegrationKey=smtp` ve
  kaynak konfigürasyonunun SHA-256 fingerprint'i tutulur.
- Referans oluşturma transaction/advisory lock ile idempotenttir. Kaynak değişince
  yeniden bağlama revision artırır ve doğrulamayı kaldırır. Referansa bağımsız
  SMTP ayarı yazılamaz; yalnız asıl entegrasyon düzenlenir.
- Genel e-posta ile aşama gönderimi aynı SMTP kaynak çözümleyicisini kullanır.
  Kaynak devre dışı, yok veya fingerprint değişmişse referans gönderimi engellenir.
  Kuyruk öncesi/SMTP öncesi ve bildirim kuralı bağlamada tekrar kontrol edilir.
- Kaynak değişikliği onayı otomatik taşımaz; mevcut farklı insan doğrulayıcı kuralı
  korunur. Aktarım SMTP bağlantısı açmaz veya e-posta göndermez.
- Eski Mesajlar editöründe sürümlü e-posta ikinci kez düzenlenmez. Şablon listesine
  `isVersionedEmail` bilgisi eklenmiştir; eski çok kanallı şablonlar silinmez.
- Yeni metinler 23 dilde tamamlandı. Şablon ve entegrasyon deep link'leri güncellendi.
- Migration ve mevcut bağlantı/veri üzerinde otomatik toplu dönüşüm yoktur.

## Doğrulama

- 18 gerçek kuyruk fonksiyonu/mocked SMTP regresyonu PASS.
- 40 policy/template/source-reference kontrolü PASS.
- Gerçek izole PostgreSQL stage intent/recipient/dedup/rollback/mock receipt: 8/8 PASS.
- E-posta UI ve integration account kontrolleri: 23/23 PASS.
- API/frontend TypeScript PASS; 23 dil key/placeholder parity PASS (11.014 anahtar).
- Kaynak referansında parola tutulmaması, güvenli projeksiyonda secret/hash olmaması,
  kaynak kapanması/değişimi/yokluğu ve ayrı insan onay sınırı ayrıca test edildi.

## Mevcut yapılandırma sınırı

Önceki staging salt okunur incelemesinde `integrations.key=smtp` kaydı,
SMTP channel-account ve message-template kaydı yoktu. Bu değişiklik gerçek bir
SMTP adresi/parolası uydurmaz veya production'dan secret taşımaz. Kaynak girilene
ve gerekli insan doğrulamaları tamamlanana kadar gerçek gönderim kapalı kalır.

## Staging yayın ve arayüz kanıtı

- Source `d7544f2997e7f67f89d6cfa5bc3a6e0b7cf4ce5c`;
  release `staging-20261128T101656Z-d7544f2997e7`.
- API health HTTP 200, `dbConnected=true`; Docker `healthy`; source worktree temiz.
- Network kapalı Linux build: API/ön yüz typecheck, 58 e-posta kontrolü,
  normal frontend build'in 190 kontrolü, i18n/sitemap/bundle bütçeleri PASS.
- Messages → Templates'ta merkezi sürüm editörü ve açılır eski sistem şablonları
  doğrulandı. Eski editörde 23 dil metni alanları aynı merkezde açılıyor.
- Notifications'ta yeni şablon/gönderici oluşturma düğmesi yok. Kural modalında
  Email Subject/Email Body alanlarının bulunmadığı UI'da doğrulandı; seçim ve
  Mesajlar bağlantısı mevcut.
- Integrations → Email (SMTP) → Accounts'ta mevcut entegrasyon kullanımı ve
  asıl bağlantı düzenleme linki doğrulandı. Kaynak kaydı olmadığından reuse düğmesi
  doğru şekilde devre dışı; sahte credential veya bağlantı oluşturulmadı.
- Kullanıcı arayüzünden tek `Application stage update` şablonu oluşturuldu:
  v1 EN ve v2 TR, ikisi de `review`. Dinamik öğrenci/üniversite/program/aşama/
  başvuru referansı içerir; öğrenci ve acente alıcısına uygun nötr hitap kullanır.
  Türkçe önizleme kontrol edildi. Farklı insan yönetici onayı aşılmadı.
- Son salt okunur kontrol: EN review 1, TR review 1; SMTP integration 0;
  stage dispatch 0; migration ledger 146. Gerçek mesaj veya e-posta gönderilmedi.
- Merkezi ekran: `/staff/messages?tab=templates#email-templates`.

Aşama bağlama ve aktivasyonu; onaylı sürüm, gerçek SMTP kaydı ve doğrulanmış
gönderici beklediği için henüz etkin değildir. İşlevin hazır olması ile gerçek
gönderimin başlaması ayrı durumlar olarak raporlanır.
