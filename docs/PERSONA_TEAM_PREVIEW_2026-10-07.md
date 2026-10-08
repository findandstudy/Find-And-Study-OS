# Takım tasarım önizlemesi — staging release dilimi

> 8 Ekim entegre arayüz eki aşağıdaki eski standalone görünüm ve yeni-sekme
> davranışını supersede eder. Dağıtım kanıtı olmadan bu kaynak notu staging'e
> alınmış olduğu anlamına gelmez.

Kullanıcı yalnız önizlemeyi staging'e alma seçeneğini onayladı. Bu dilim mevcut
yerel organizasyon editörünü yeniden kullanır; kalıcı persona platformu değildir.

## Kapsam

- `/admin/agent-team-preview/`: yalnız mevcut gerçek admin/super_admin oturumu.
- Default-off. Exact production runtime + staging origin + live integrations
  kapalı + `PERSONA_TEAM_PREVIEW_ENABLED=true` gerekir. Production hostunda açılmaz.
- Sabit sentetik sosyal medya takımı; kart ekleme/silme, sürükle/bağla, talimat,
  zoom/pan, arama, dal aç/kapa, undo/redo yalnız açık sekmenin belleğindedir.
- Yenileme değişiklikleri sıfırlar. Açık uyarı ve kaydedilmemiş değişiklikte
  çıkış uyarısı vardır. Sunucuya kayıt, onay, görev, export/import ve storage yoktur.
- CSP: outbound/connect/worker/frame/form kapalı; yalnız sabit same-origin
  script/CSS varlıkları. HTML, JS ve CSS aynı normal oturum korumasını kullanır.
- API token, impersonation, manager/staff/student/agent ve mutasyonlar reddedilir.
- KMS/HSM signer, canonical persona runtime, project/persona grant veya prepared
  migration devreye alınmaz; bu sınırları geçen sahte bir çalıştırma yolu yoktur.

## Yayın izolasyonu

Taban `1c028fb1fa4344941b5fcc637e17e55d7d05ce5b`; ayrı
`codex/team-preview-staging-20261007` dalı. Ana çalışma ağacındaki tamamlanmamış
Pages, persona, provider ve güvenlik değişiklikleri korunur; bu yayına taşınmaz.
Mevcut staging frontend/public varlıkları ve index dışı API dosyaları korunur.
Yeni backend entry ve iki editor asset'i exact-source API build'den alınır.
Bağımlılık, DB, migration, global auth davranışı, CRM veya provider ayarı değişmez.
Tek yeni ayar yalnız staging tasarım önizleme bayrağıdır.

## Doğrulama

- Ayrı erişim testleri: gerçek requireAuth/requireRole ve sentetik session reader.
- Tarayıcı: sürükle/bırak, bağlantı, ekle/sil, talimat, zoom/pan, geri/ileri,
  mobil ve yenileme. Network/storage/provider girişimleri instrument edilip
  sıfır olduğu doğrulanır. Bu test normal OS oturum UAT'si yerine geçmez.
- Eski yerel mock editörü ve disposable full-chain regresyonu ayrıca korunur.
- Yayın öncesi exact-head CI, artifact checksum, staging backup + izole restore
  ve runtime kimliği; yayın sonrası gerçek staging admin oturumu/deny smoke'u
  ayrıca gerekir. Hazırlık dosyası yayın tamamlandı iddiası değildir.

## Geri dönüş

Önceki staging image/release ve host-only env snapshot'larına yalnız app rollback.
DB/container/worker restart, DB restore, migration veya production işlemi yoktur.
Görsel editör veriyi kalıcı tutmadığı için kaydedilmiş iş/veri geri alma yoktur.
Tam kalıcı takım platformu ayrı signer/ownership/approval/provisioning kapılarında kalır.

## 8 Ekim 2026 — menü ve giriş dönüşü

- Staging'de admin/super_admin menüsünün Otomasyon ve Entegrasyonlar grubunda,
  AI Personaları yanında `Takım Tasarımcısı — Önizleme` görünür. İngilizce arayüzde
  `Team Designer — Preview` olarak gösterilir; diğer diller İngilizce etiketi kullanır.
- Mevcut güvenli yeni-sekme bağlantısı kullanılır. Önizleme bir SPA rotası değildir;
  menü tıklaması normal bir belge isteği yapar. Favorilere sabitleme de aynı bağlantıyı korur.
- Oturumsuz/süresi dolmuş kök HTML ziyaretleri sabit normal giriş adresine yönlenir.
  Caller query'si dönüş hedefini belirlemez. Giriş sonrası yalnız exact staging origin
  ve exact önizleme yolu tam sayfa geçişi yapar; diğer giriş dönüşleri değişmez.
  Eski ekran önbelleği oturum kanıtı sayılmaz: sunucudan yeniden doğrulanır;
  süresi dolmuş oturumda önbellek temizlenir ve giriş formu kullanılabilir kalır.
- JSON, asset ve HEAD istekleri giriş yönlendirmesi almaz. Rol, token, impersonation,
  canonical session ve default-off runtime kontrolleri korunur.
- Bu ekin tabanı staging'de doğrulanmış `2a665099d9f0e74be1b775076565e0aa00f93845`.
  Artık yalnız API giriş paketi ve bu menü/giriş düzeltmelerini içeren frontend derlemesi
  yenilenir. Önceki hashed frontend varlıkları korunur; DB/migration/provider değişmez.
- Doğrulama: erişim/editör testleri, menü/dönüş unit testleri, sentetik API'lerle gerçek
  derlenmiş arayüz tarayıcı testi, API/frontend build ve typecheck. Staging yayını ayrıca
  exact-head CI, yedek/izole restore ve yayın sonrası erişim testlerine bağlıdır.

## 8 Ekim 2026 — mevcut OS içine entegre tasarım

- Menü artık normal SPA gezinmesidir; mevcut DashboardLayout, üst başlık,
  marka, tema, Button/Card/Tabs/Sheet/form bileşenleri kullanılır. Ayrı HTML
  ekran veya iframe kullanılmaz. CSS yalnız bu modülün geometrisini kapsar.
- Kanonik belge adresi mevcut session guard'dan sonra sabit
  `/?workspace=team-preview` adresine yönlenir. Dar staging-only bootstrap bu
  ipucunu tüketip mevcut korumalı React rotasını açar; keyfi hedef kabul etmez.
  Oturum/token/impersonation yetki kontrolleri değişmemiştir.
- İlk sentetik takım yalnız aynı guard'ın `/template.json` okumasından gelir.
  Başarısız/eksik yetki yanıtında yerel örnek üretilmez. Okuma süre sınırlıdır;
  geçici hatada kullanıcı kontrollü tekrar denenir.
- Harita ilk ekranda görünür: sürükleyerek konumlandırma, üst birime bırakma,
  bağlantı düğmesi veya seçici ile bağlama, arama/liste, zoom/pan/fit,
  otomatik yerleşim, talimat düzenleme, açık alt-ağaç silme onayı ve undo/redo.
  Kök silinemez, döngü ve uzmanı yönetici yapma reddedilir; üst sınır 20 üyedir.
- Mobil/tablette ayrıntılar erişilebilir Sheet'te açılır. Klavyeyle kart seçimi,
  ok tuşlarıyla konumlandırma, bağlantı seçicisi, RTL metin ve tema renkleri
  korunur. Önizleme etiketleri Türkçe ve açık İngilizce fallback kullanır;
  mevcut 23 dilli sistem değiştirilmez.
- Tüm tasarım state'i yalnız mounted React ekranının belleğindedir. Ayrılma veya
  yenilemede kaybolur; uyarı görünür, değişiklikten sonra browser unload uyarısı
  eklenir. Kalıcı kayıt/export/import/onay/görev/provider endpoint'i açılmaz.
- Eski standalone CSP'si tüm Dashboard'a aktarılmaz veya gevşetilmez: normal
  shell mevcut kendi CSP'sini ve normal oturum/tema/menü/telemetri okumalarını
  kullanır. Tasarım modülü yalnız sabit template GET yapar; görev veya iş verisi
  yazmaz. Bu yüzden bütün sayfa için "ağ isteği yok" iddiası yapılmaz.
- Önceki sabit asset yolları uyumluluk için guard arkasında kalır; React ekranı
  bunları import etmez. Eski DOM editörü yalnız kendi regresyon testlerinde kalır.

Yerel doğrulama: model/hiyerarşi, API session deny/revocation, SPA menü/giriş,
tarayıcı düzenleme/bağlama/silme/undo, mobil/tablet/RTL/tema ve build/typecheck.
Tarayıcıdaki API'ler sentetiktir; actual session middleware testinde canonical
session reader test double'dır. Bunlar gerçek DB/kalıcı takım çalışması kanıtı
değildir. Güvenli staging dağıtımı ayrı exact-head CI ve runtime kapılarını korur.

Entegre sürümün yerel kanıtı: model/menü/login 22/22, API erişim/önizleme/ağaç
29/29, derlenmiş arayüz tarayıcı senaryoları 21/21 ve mevcut frontend build
regresyonları 125/125 PASS; API/frontend typecheck ve build PASS. Son browser
çalışması deny-proxy ile dış ağı kapatır; 302 belge yönlendirmesi backend testinde,
köprüye geçiş browser fixture'ında doğrulanır. Desktop mouse/klavye ile düzenleme
ve mobil/tablet yerleşimi kanıtlanmıştır; gerçek dokunmatik cihaz ve tam WCAG
denetimi değildir. Telefonda tüm ağacı sığdırmak yazıları küçültür; zoom ve Üyeler
görünümü kullanılabilir. Bu yerel sonuçlar tek başına staging yayını kanıtlamaz.
