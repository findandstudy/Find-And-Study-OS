# Sözleşme tasarım/PDF düzeltmesi — staging adayı

Kullanıcı 9 Ekim 2026 tarihinde yalnız staging dağıtımını onayladı. Production,
şablon yayınlama, imza, gönderim, migration ve geçmiş PDF regeneration kapsam dışıdır.

## Taban ve izolasyon

Doğrulanmış staging tabanı: `0abfb1eb288c4be09643017b02c98021e70015e9`, release
`staging-20261008T085615Z-0abfb1eb288c`. Ayrı dal:
`codex/contract-rendering-staging-20261009`.
Mevcut Pages ve entegre takım önizlemesi korunur. Ana kirli çalışma ağacındaki
Pages/persona/schema ve diğer geliştirmeler bu dilime dahil değildir.

## Değişiklik

- contractHtmlSanitizer: fragment başındaki güvenli head CSS korunur; dış CSS
  import/URL ve kaçış varyasyonları engellenir.
- ContractRichTextEditor + contractEditorMode: tasarımlı/full HTML şablonlar
  kayıplı görsel editöre geçirilmez; basit metinde görsel editör korunur.
- contractPdfAssets: yalnız tam HTTPS adres izin listesi, açık entegrasyon kapısı,
  DNS/IP/TLS pinning ve bounded PNG/JPEG normalizasyonuyla logo snapshot'ı.
- contractBranding/contractTemplateBranding: server-owned kaynak/hash/byte
  snapshot'ı mevcut signing-page JSON'una bağlanır; yalnız exact img kaynağı gömülür.
- contracts, agentApplications, agentOnboarding, agents: yalnız beş yeni imza
  oturumu captureLogo çağrısı. Eski PDF okuması dış ağdan logo indirmez.
- safeOutboundRequest: optional AbortSignal ile DNS/request/body iptali.
- İlgili testler ve package test komutları. Güvenlik envanterinde yalnız dört
  route dosyasının SHA pinleri değişir; hiçbir yetki/karantina sınırı değişmez.

## Yerel kanıt

Ayrılmış staging diliminde sözleşme testleri 51/51, editör 7/7, frontend
build öncesi 125/125 ve 23 locale parity PASS. API/Edcons build ve typecheck
geçişi ayrı doğrulanır. Önceki yerel incelemede gerçek Chromium ile iki
sentetik PDF ve dört sayfanın görsel kontrolü PASS; gerçek imza/sağlayıcı değildir.
Bağımsız read-only kapsam incelemesinde disabled-outbound staging için engel yok.

Staging salt-okunur preflight sırasında signed_contracts toplamı 0 ve eksik
PDF/evidence sayısı 0. Kaynak clean, health exact release ve dbConnected=true.
Bu sayımlar production sözleşmelerine ilişkin bir iddia değildir.

## Yayın ve geri dönüş sınırı

Exact-head CI, checksum'lı staging yedeği + network-none restore, mevcut image/
source/env/DB/diğer container kimliği ve kill-switch doğrulanmadan switch yok.
Yalnız staging app değişir. Bütün eski hashed frontend dosyaları ve API index
dışındaki runtime dosyaları korunur. DB 133 ledger değişmez; migration/seed yok.
Kod geri dönüşü önceki image ve exact env snapshot'larıyla yapılır; DB restore yok.

CONTRACT_PDF_TRUSTED_LOGO_URLS bu yayında yapılandırılmaz. Global dış entegrasyon
kapısı kapalı kalır; gerçek logo edinimi açılmaz. Gelecek etkinleştirmede logo
ediniminin agent-application transaction süresine (en fazla 5 saniye) etkisi ve
başarısız kaynakta session oluşturmanın güvenli reddi ayrıca test edilmelidir.

Önceden CSS'i kaybolmuş v4 kaydı ayrıca metni korunarak yeni TASLAK sürümde
onarılmalıdır. Mevcut imza/PDF/evidence kayıtları değiştirilmez. Henüz PDF'si
üretilmemiş tarihsel imzalı kayıtlar gelecekte düzeltilmiş renderer'ı kullanabilir;
production öncesi bu kayıt sınıfı ayrıca incelenmelidir.

Bu kaynak notu tek başına başarılı dağıtım kanıtı değildir. Exact commit/image,
CI, yedek ve son health/smoke sonuçları dağıtım sonunda ayrıca raporlanır.
