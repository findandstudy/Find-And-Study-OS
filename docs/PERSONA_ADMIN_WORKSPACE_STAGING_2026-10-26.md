# Ajan takımı — yönetici oturumuyla kalıcı staging çalışma alanı

## Kapsam ve yetki

Kullanıcının staging talebi ve 26 Ekim açıklaması doğrultusunda mevcut Admin/Super Admin oturumu yeniden kullanılır. Cloud KMS, HSM, yeni imza hizmeti veya ücretli sağlayıcı gerekmez. Bu değişiklik global Control Plane sözleşmesini değiştirmez; yalnız açıkça seçilmiş staging projesinin mock çalışma alanına yerel oturum adaptörü ekler.

Üretim ortamı, gerçek AI/HeyGen, dış mesaj/yayın ve eski ajan çalıştırıcısı kapalı kalır. Eski persona sahipliği tahmin edilmez. Yeni proje ve iki mevcut insan hesabı yalnız ayrı, denetlenebilir staging kurulumuyla eşlenir; migration kendiliğinden hesap/grant/proje oluşturmaz. Emrullah'ın henüz etkinleştirilmemiş hesabı bu paketle otomatik etkinleşmez ve şifre/kimlik doğrulaması atlanmaz.

## Çalışan akış

- Mevcut OS menüsünden Ajan Takımı: proje seçimi, kişisel taslağı ve yerleşimi kaydetme, yeniden açma, sürüm çakışmasını gösterme.
- Boş projede ilk takım: persona olmadan takım taslağı oluşturma, farklı yöneticinin aynı içerik sürümünü onaylaması, tek seferlik ve duraklatılmış kurulum.
- Görev paneli: kurulu takım üyeleri, görev hazırlama, ayrı insan onayı, mock yürütme, sonuç/geçmiş, duraklatma.
- Her veri okuması ve araç çağrısı güncel gerçek oturuma, aktif hesaba, role, kanonik insan üyeliğine ve sabit sunucu projesine bağlıdır. Çapraz proje, impersonation, bearer token, CSRF ve iptal edilmiş oturum reddedilir.
- Onay tek yürütmeye atomik bağlanır. İçerik/hedef değişimi yeni onay ister. Proje ve persona bütçeleri birlikte kilitlenir; belirsiz çökme rezervleri kör yeniden denemeyle iade edilmez.

Mevcut görev istemcisi React içine tema kapsamlı olarak alınmıştır. Çok adımlı workflow listesi salt okunur kalır; bu sürüm tek mock görev döngüsünü panelden tamamlar.

## Migration ve mevcut verinin korunması

Staging tabanı `babb2099fc9979ca955c71e967365c8b65f5443d`, mevcut ledger 133'tür. Yalnız `0133_persona_admin_workspace.sql` eklenir: hazırlanan ilk altı persona şemasının 14 FORCE-RLS tablosu, local takım taslağı sequence'i ve bütünlük guard'ları. Sonuç 134 migration'dır. İlk 133 kayıt değişmez; eski kullanıcı/CRM/Pages/AI verileri taşınmaz veya yeniden sahiplenilmez.

Ana kirli geliştirme kopyasındaki Pages 0133–0138 dosyaları bu adaya dahil DEĞİLDİR. Bu kopyanın 139'luk journal'ı staging'e kopyalanmamalıdır. Gelecek Pages aktarımı, staging'e kabul edilen bu migration'dan sonra kontrollü namespace birleştirmesi gerektirir. Sosyal-content phase6 bu paket dışındadır ve runtime flag'i açılmaz.

## Kanıt

- Admin/session/bootstrap unit ve API TypeScript: PASS.
- İlk takım draft/workspace/application unit 31; görev istemcisi 6: PASS.
- Frontend 41; build regresyon 125; Edcons TypeScript/i18n/build/bundle: PASS.
- Gerçek PostgreSQL + normal OS tarayıcı birleşik 18: PASS. Fresh134/replay, 133→134 ve mevcut altı ürün tablosunun satır eşliği, boş projeden takım, iki kişi onayı, bütçe/onay yarışı, çökme, iptal, yeniden açma, 390px mobil doğrulandı. Sentetik hesap ve geçici DB kullanıldı; sağlayıcı istekleri engellendi.
- Yazar/rota envanterine yalnız bu modülün yeni yüzeyleri eklendi. Dış pilot allowlist sıfır; legacy karantinası kaldırılmadı.

## Staging kurulumu ve geri dönüş

Paket tam kaynak commit'ine ve dosya SHA256 manifestine bağlanır. Dağıtımdan önce exact staging DB yedeği ve ayrı geçici veritabanına restore testi gerekir. Dedicated `fas_persona_staging_executor` NOSUPERUSER/NOBYPASSRLS/NOINHERIT rolü yalnız test edilen tablo/sütun/sequence izinleri alır. Secret sunucuda üretilir ve çıktılara yazılmaz. Mevcut secret/config yerelden kopyalanmaz.

Yeni Admin adaptörünü açan ayarlar: `PERSONA_WORKSPACE_ENABLED`, `PERSONA_RUNTIME_MODE=staging-mock`, `PERSONA_DATABASE_URL`, `PERSONA_DATABASE_SERVER_ADDRESS`, `PERSONA_ADMIN_PROJECT_JSON`. APP_BASE_URL exact staging olmak zorundadır; canlı entegrasyon false kalır.

Sorunda eski app image/config/source geri alınır; additive tablolar tutulur, canlı DB geri yüklenmez. Normal health, yeni workspace API, ayrı insan erişimi ve diğer container kimlikleri doğrulanmadan deployment tamamlandı sayılmaz. Yerel PASS, staging deployment kanıtının yerine geçmez. Gerçek dağıtım sonucu ayrı operasyon makbuzunda kaydedilir.
