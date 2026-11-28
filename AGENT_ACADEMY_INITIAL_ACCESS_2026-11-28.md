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

## Staging teslim kanıtı
- Local code `d2e0fad9`; staging integration `59a28b040637`.
- Release `staging-20261128T090314Z-59a28b040637`; image `findandstudy-staging-app:academy-initial-access`.
- API/DB/frontend typecheck, 27 provisioning/application/SSO safety ve 190 mevcut frontend build testi PASS. 23 locale eşliği PASS. Public health HTTP200/dbConnected=true/exact release ve Docker healthy PASS.
- Salt-okunur başlangıç denetiminde iki aktif/full agent/sub_agent paketinde Academy açık, kişisel override eksik ve rol paketinde academy.access yoktu. Explicit deny sayısı0 idi.
- Bu iki mevcut hesaba yalnız eksik academy.access=true eşlemesi eklendi. İşlem fas_app yetkisiyle bounded transaction, row lock, exact2 kapsam guard'ı ve gerçek staging admin actor'u üzerinden iki audit kaydıyla yapıldı. Başka acente profili/kullanıcı alanı, rol paketi veya açık ret değiştirilmedi. İlk TEMP tablo denemesi izin kapısında reddedildi; hak genişletilmeden DO/row-lock transaction ile tamamlandı.
- Son aggregate: eşleme eksiği0; repair audit2. Migration yok; ledger146 olarak korundu. Her iki kaynak worktree temiz; app env'de yalnız image/release seçimi değişti, önceki image/env geri dönüş için durur.
- İlk login HTTP kanıtı yerel sentetik kullanıcı ve gerçek auth/login route'u üzerindedir. Staging'de gerçek acente kimliğiyle login veya production Academy SSO yönlendirmesi denenmedi. Staging dış entegrasyon kapıları korunur. Production Apply'a deploy/yazı yoktur.
