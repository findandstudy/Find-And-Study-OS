# Threat Model

## Project Overview

EdCons OS, eğitim danışmanlığı şirketleri için geliştirilmiş çok kiracılı bir SaaS monorepo’sudur. Üretimde ana yüzeyler `artifacts/api-server` içindeki Express API ve `artifacts/edcons` içindeki React/Vite portaldır; veri PostgreSQL’de tutulur, kullanıcı yüklemeleri object storage’da saklanır ve sistem SMTP, WhatsApp/web-form webhook’ları ve AI/integration bileşenleriyle dış servislerle konuşur. Uygulama public internete açıktır; bu nedenle tehdit modeli internetten erişilebilen public, authenticated, agent ve admin yüzeylerini esas alır.

## Assets

- **Kullanıcı hesapları ve oturumlar** — staff, agent, sub-agent ve student hesapları; session cookie’leri; onboarding/signing token’ları. Ele geçirilmesi yetkisiz portal erişimi ve hesap devralmaya yol açar.
- **PII ve başvuru verileri** — isim, e-posta, telefon, pasaport bilgileri, doğum tarihi, adres, öğrenci ve başvuru kayıtları. Hem mahremiyet hem de düzenleyici risk taşır.
- **Yüklenen belgeler ve sözleşmeler** — pasaport kopyaları, transkriptler, fotoğraflar, imzalı kontratlar ve benzeri dosyalar object storage’da tutulur. Yanlış erişim kurgusu toplu veri sızıntısına neden olabilir.
- **İş verileri** — lead, application, finance, messaging, task ve pipeline kayıtları. Yetkisiz değişiklik operasyonel ve finansal zarara neden olur.
- **Uygulama sırları ve entegrasyon sırları** — SMTP kimlik bilgileri, webhook secret’ları, veritabanı bağlantısı, object storage erişimi ve benzeri gizli bilgiler. Sızmaları sistem dışına yetkisiz erişim doğurur.

## Trust Boundaries

- **Tarayıcı / API** — tüm istemci girdileri güvenilmezdir. Public formlar, embed widget’ları ve portal istekleri burada API’ye geçer.
- **Public / Authenticated / Admin / Agent ayrımı** — bazı uçlar anonim erişime açıktır (`/api/public/*`, signing linkleri, webhook’lar), çoğu uç oturum ister, bir kısmı da rol bazlı yüksek ayrıcalık ister. Bu sınır her istekte sunucu tarafında korunmalıdır.
- **API / PostgreSQL** — uygulama sunucusu veritabanına tam erişimle bağlanır. API katmanındaki injection veya yetki hatası doğrudan veri tabanını etkiler.
- **API / Object Storage** — özel belgeler ve sözleşmeler storage’da durur. Object path bilgisi tek başına yetki vermemeli; erişim ayrıca sahiplik/ACL ile doğrulanmalıdır.
- **API / Harici servisler** — SMTP, WhatsApp, AI ve webhook entegrasyonları ayrı güven sınırlarıdır. Ağ üzerindeki veya karşı taraftaki sahtecilik/tampering girişimleri burada değerlendirilir.
- **Üretim / Geliştirme** — `artifacts/mockup-sandbox` üretim dışıdır. Kanıtlı üretim erişimi gösterilmedikçe oradaki bulgular rapor dışıdır.

## Scan Anchors

- Üretim girişleri: `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, `artifacts/edcons/src/main.tsx`.
- Yüksek riskli API alanları: `src/routes/public-apply.ts`, `src/routes/embed.ts`, `src/routes/storage.ts`, `src/routes/webhooks.ts`, `src/routes/contracts.ts`, `src/routes/publicSigning.ts`, auth/session yardımcıları.
- Hassas veri yüzeyi: document/contract/object storage akışları ve user/student/application CRUD yolları.
- Dev-only ve genelde dışlanacak alan: `artifacts/mockup-sandbox`, test yardımcıları, yalnızca geliştirme amaçlı scriptler.
- Varsayımlar: üretimde `NODE_ENV=production`; Replit platform TLS’i tarayıcı↔uygulama trafiğini korur; public deployment internetten erişilebilir kabul edilir.

## Threat Categories

### Spoofing

Bu projede kimlik sahteciliği riski; zayıf session yönetimi, doğrulanmayan webhook çağrıları, kötü tasarlanmış signing/onboarding token’ları ve public akışların mevcut kullanıcılar adına işlem yapmasına izin veren mantık hataları üzerinden ortaya çıkar. Sistem, korunan tüm uçlarda geçerli bir session’ı zorunlu kılmalı; rol ve görünürlük kontrollerini istemciye bırakmamalı; webhook ve token tabanlı akışlarda imzayı veya yüksek entropili token doğrulamasını sunucu tarafında uygulamalıdır.

### Tampering

Kullanıcılar ve internetten gelen entegrasyon çağrıları lead, başvuru, belge, sözleşme ve ayar verilerini değiştirmeye çalışabilir. İstemci tarafından gönderilen kimlikler, ilişkilendirmeler, dosya yolları ve program uygunluğu gibi alanlar güvenilir kabul edilmemelidir. Sistem tüm kritik alanlarda server-side doğrulama yapmalı; başvuru, belge ve sözleşme akışlarında sahiplik ve ilişki bütünlüğünü doğrulamalı; object storage yollarını salt isim biliniyor diye yazılabilir/okunabilir hale getirmemelidir.

### Information Disclosure

Bu proje yüksek hacimde PII, pasaport verisi ve özel belgeler işler. En önemli ifşa riskleri; yanlış yetkilendirilmiş API yanıtları, özel object storage nesnelerine doğrudan erişim, kamuya açık formların kullanıcı veya pasaport varlığını doğrulaması, hassas hata mesajları ve entegrasyon trafiğinde taşıma güvenliği eksiklikleridir. Sistem, tüm veri dönüşlerini çağıranın yetki kapsamına göre daraltmalı; özel nesnelere erişimde ACL/sahiplik kontrolünü zorunlu kılmalı; public uçlarda gereksiz hesap varlığı sinyallerini azaltmalı; harici servislerle kurduğu gizli iletişimde sertifika doğrulamasını kapatmamalıdır.

### Denial of Service

Public apply, embed, signing ve webhook uçları internetten doğrudan çağrılabildiği için rate limit ve kaynak tüketimi kritik önemdedir. Büyük JSON body’ler, dosya yüklemeleri ve ağır PDF oluşturma işlemleri hizmeti bozabilir. Sistem, public uçlarda kalıcı rate limit uygulamalı; büyük body ve upload akışlarını sınırlandırmalı; ağır işlemleri güvenli şekilde serialize veya async yürütmeli; dış servis çağrılarında timeout kullanmalıdır.

### Elevation of Privilege

RBAC yoğun bir ürün olduğu için en kritik risklerden biri broken access control’dür. Authenticated olmak tek başına başka kullanıcının belgelerine, başvurularına, sözleşmelerine veya yönetici fonksiyonlarına erişim vermemelidir. Sistem, her kaynak erişiminde rol + sahiplik + tenant görünürlüğünü sunucu tarafında doğrulamalı; generic dosya/obje uçlarında “oturum açmış herhangi biri” seviyesinde izin vermemeli; admin/staff-only işlevlerde açık rol kontrollerini zorunlu kılmalıdır.
