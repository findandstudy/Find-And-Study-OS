# Acente Academy ilk erişim düzeltmesi — 28 Kasım 2026

## Neden
Academy görünürlüğü iki kontrol ister: acentenin paket/özellik haritasındaki `academy` ve kullanıcıdaki `academy.access` yetkisi. Başvurudan aktivasyona geçiş ve acentenin kendi oluşturduğu alt acente yolu ikinci kaydı başlatmıyordu. Yönetici panelindeki tiki kapat/aç işlemi mevcut update sync yolunu çalıştırıp eksik eşlemeyi sonradan yazıyordu. Admin doğrudan oluşturma yolu sync yapıyordu fakat transaction dışında kalıyordu. Ayrıca agent/sub_agent auth yetkileri periyodik yenilenmiyor; sidebar profil önbelleği 5 dakikaydı.

## Değişiklik
- Ortak `agentAcademyAccess.ts` yalnız agent/sub_agent kullanıcılarını eşler. İlk kurulum yalnız aktif/full acenteye ve eksik override'a uygulanır; explicit true/false değerleri korunur.
- Doğrudan admin oluşturma, alt acente oluşturma, başvuru aktivasyonu ve uygun mevcut profil kaydı aynı transaction'da eşlenir. İlk yetki kurulumu başka rol veya agent_staff'a grant vermez.
- Gerçek Academy paket seçimi değişirse yönetici tercihi aynı transaction'da yazılır. Başka bir profil/özellik değişikliği explicit kullanıcı reddini geri açmaz. Kullanıcı→acente lock sırası aktivasyonla uyumludur.
- Auth agent/sub_agent için görünür sekmede 30 saniye, mevcut agent_staff için 5 saniye yenilenir. Sidebar agent-me sorgusu kullanıcı ID'sine bağlanır ve 30 saniye yenilenir.
- Yeni UI metni yoktur; mevcut 23 dilli Academy etiketi korunur. Rol paketleri, şifre, sözleşme, imza, Academy receiver ve dış entegrasyon güvenlik kapıları değiştirilmez.

## Yerel kanıt
Gerçek disposable local PostgreSQL'de 11 kontrol PASS: yeni agent/sub_agent, provisional→full aktivasyon, explicit deny, feature disabled, staff izolasyonu, admin değişikliği, rollback, idempotency, userId yokluğu ve gerçek login route'unun ilk yanıtında academy.access. Sentetik kullanıcılar temizlendi, gerçek e-posta/Academy çağrısı yapılmadı. 27 provisioning/application/SSO safety testi PASS. API/frontend typecheck ve 23 dil eşliği ayrıca doğrulanır.

## Yayın sınırı
Yalnız staging hedeflenir. Production Apply değişmez. Staging'de Academy menüsü/yetki eşliği test edilebilir; production Academy'ye gerçek SSO geçişi mevcut ortam politikası gereği kapalı kalır. Eski hesaplarda explicit kullanıcı reddi otomatik kaldırılmaz.
