# Bağımsız iş pipeline'ları — yerel inceleme sürümü

## Kapsam ve durum

Branch: `codex/local-work-pipelines-20261127`.
Bu geliştirme yereldir; remote push, staging veya Apply deployment yapılmadı.
Önceki program kartı geri alımı ve yeni sözleşme görünüm politikası korunur.

Ön yüz: http://127.0.0.1:25197/staff/pipelines
API: http://127.0.0.1:8080
PostgreSQL: yalnız `127.0.0.1:5433/fasos_apply_local`.

Yeni, boş ve sentetik verili bir PostgreSQL kümesi kullanılır. Önceki yerel
kopyalar veya production dump'ları kullanılmadı. Ana şema mevcut reviewed
migration runner ile kuruldu. Bağımsız modülün additive SQL'i yalnız bu DB'ye
uygulandı; deployment migration journal'ına eklenmedi.

## Çalışan yetenekler

- Sidebar'da Pipelines; çok sayıda pipeline, dropdown, kullanıcıya özel sabitlenen sekmeler.
- Kanban ve tablo, sürükle/bırak aşama değişikliği; klavye için aşama seçicisi.
- Aşama adı, rengi, sırası ve açık/başarıyla kapalı/kapalı niteliği.
- Kart başlığı/açıklaması, sorumlu, hedef tarihi, öncelik ve çalışma durumu.
- Tamamlanabilir görev listesi, iç notlar ve actor/tarih içeren işlem geçmişi.
- Admin ayar yönetimi; yalnız üye iç ekip kullanıcılarına kart erişimi.
- Kart ve pipeline güncellemelerinde revision kontrolü, çakışmada 409.
- Kaynak seçimi: mevcut mesaj hesabı, lead_form embed, token'lı acente web-to-lead.
- Kaynak bağlantısı tek pipeline'a aittir; eşleşme tahmin veya AI ile yapılmaz.
- Inbox mesajı mevcut mesaj alanında kalır; konuşma bağlantısı karttan açılabilir.
- Aynı konuşma / form kimliği için idempotent kart oluşturma.
- Yalnız bağlanan kaynaklarda öğrenci identity/lead capture ve öğrenci bot yolu atlanır.
  Bağlı olmayan kaynaklar mevcut davranışı sürdürür. Mevcut kişi bağlantıları silinmez.
- Kaynağı bağlı bir pipeline arşivlenemez; kaynakların açıkça ayrılması gerekir.
- Pipeline listesi 50'lik, kartlar 200'lük sayfalar halinde yüklenir; daha fazla yükleme vardır.

## Güvenlik ve ayrım

Veri ayrı `local_work_pipelines` şemasındadır: boards, cards, sources.
Her kayıtta tenant UUID, composite FK/unique kısıtları ve FORCE RLS bulunur.
Tenant yalnız sunucu ortamından çözülür; client tenant seçemez. Request bazlı
transaction-local tenant scope transaction sonunda temizlenir.

Feature default-off. `NODE_ENV=production`, yanlış DB adresi veya açık canlı
entegrasyon halinde feature fail-closed reddeder. Bu yerel tenant namespace'i,
mevcut multi-tenant active-context sisteminin production entegrasyonu değildir.
Production öncesi o authority bağının ve migration/rol politikasının ayrıca
tasarlanması ve review edilmesi zorunludur.

Mevcut Lead/Student/Application statüleri, CRM tablo yapıları ve stage listeleri
değişmez. Testlerde bu üç tablonun satır sayıları korunmuştur.

Yeni ekran TR/EN copy içerir; diğer UI dillerinde İngilizce fallback kullanır.
İlk yerel sürüm; kampanya/anahtar kelime kuralları, geçmiş inbox kayıtlarının
toplu import'u, özelleştirilebilir kart alanları, ek dosyalar ve dış otomasyonlar
bu sürümün tamamlandı iddiasına dahil değildir.

## Yerel çalıştırma

Runtime PostgreSQL cluster'ı:
`C:/Users/Find And Study/.codex/tmp/work-pipelines-pg-20261127`
Bu cluster yalnız loopback'te dinler. Gerçek kullanıcı/kurum/messaging secret'ı yoktur.

API (repo kökünden):
```
node --env-file=.env.work-pipelines.local node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/cli.mjs watch scripts/start-local-work-pipelines.ts
```
API launcher production startup seed/worker'larını çalıştırmaz.

Ön yüz PowerShell:
```
$env:PORT='25197'
$env:API_PROXY_TARGET='http://127.0.0.1:8080'
node artifacts/edcons/node_modules/vite/bin/vite.js --config artifacts/edcons/vite.config.ts --host 127.0.0.1
```

Sentetik admin: `pipeline.admin@example.invalid`.
Yerel parola `.local-work-pipeline-credentials.json` dosyasında `password`
alanındadır. Dosya Git tarafından ignore edilir. Gerçek admin şifresi kullanılmaz.

## Kanıt

`artifacts/api-server/scripts/test-local-work-pipelines.ts`: 17 entegrasyon kontrolü PASS.
Gerçek session login/CSRF, admin/member/outsider, source exclusivity, kart CRUD,
not/görev/tarih, revision conflict, yabancı aşama reddi, beş paralel duplicate,
embed HTTP submission, web-to-lead HTTP submission, inbound message + replay,
CRM sayım eşliği, non-superuser tenant RLS ve UPDATE kapalı source-lock kontrolü.

Ön yüz TypeScript kontrolü PASS. Genel API typecheck, bu değişiklikten önce de
var olan `embedLeadFormI18n.ts:41` locale union/`ur` hatasıyla duruyor; bu dosya
bu işte değiştirilmedi.

UI ekranları ve drag/drop etkileşiminin görsel kabulü henüz tamamlanmadı:
yerel tarayıcı giriş ekranında. Admin login sonrası masaüstü/pano/tablo,
ayar dialog'u ve kart paneli gezilerek devam edilecek. Gerçek gönderim yok.

## Sonraki kapı

Yerel ürün değerlendirmesi → UI/UX düzeltmeleri → genişletilecek alanların kararı
→ bağımsız yetki/tenant ve inbound recovery incelemesi → migration release planı.
Bu iş staging/production deployment onayı içermez.
