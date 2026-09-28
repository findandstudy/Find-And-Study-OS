# Güvenlik ve izole HTTP testi — 28 Eylül 2026

## Kapsam ve kaynak

Kullanıcının “başla” onayıyla 23 Eylül yerel güvenlik paketinin üstüne uygulanan
ilk güvenlik/test dilimi. Branch `codex/public-detail-staging-20260919`, taban
`c2b872abe22848a50e61f12d73ff6b5b11591379`. Kanıt commit edilmemiş çalışma ağacına
aittir. Önceki değişiklikler korunmuştur; bu rapor önceki çalışmaların tamamının
yeniden yapıldığını veya dağıtıldığını söylemez.

Staging/production/VPS, gerçek kullanıcı kaydı, provider, GitHub, merge, push ve
deployment değiştirilmedi. Yeni migration yazılmadı. Mevcut 126 migration, yalnız
bu görevin oluşturduğu boş PostgreSQL 16.15 cluster'ına uygulandı; üretim dump'ı
veya mevcut geliştirme veritabanı kullanılmadı. Runtime data dizini ayrı,
endpoint yalnız `127.0.0.1:5433/fasos_apply_local`; rol izinleri yalnız bu
disposable fixture içindir.

## Uygulanan düzeltmeler

1. **Dosya yetkisi önce:** `documents.ts` ve `leads.ts` mevcut non-staff/agent
   sahiplik kontrollerini byte okuma, doğrulama, silme ve sıkıştırmadan önce
   uygular. Personelin mevcut izinleri genişletilmedi. Reddedilen nesnenin anahtarı
   ve kullanıcı kimliği artık bu uyarı loglarına yazılmaz.
2. **Public acente yüklemesi:** geçerli 15 dakikalık ticket, daha önce yüklenmiş
   belgenin bytes/MIME değerini değiştiremez. Mevcut immutable local publisher
   yeniden kullanılır. Aynı içerik retry `204`, farklı içerik `409`, devam eden
   yayın `503` + `Retry-After: 1`. E-posta/ticket/path bağı ve dosya doğrulaması
   korunur. Bu, kalıcı single-use grant sistemi değildir; cloud signed PUT kapsamı
   dışındadır.
3. **Academy ortam ayrımı:** explicit outbound-disable önce çalışır. Canlı Academy
   receiver'ına token ancak `NODE_ENV=production`, staging olmayan release kimliği
   ve en az bir geçerli canonical üretim base URL'siyle verilir. APP_BASE_URL ve
   BASE_URL birlikte tanımlıysa aynı origin olmalıdır. Yalnız
   `https://apply.findandstudy.com` / `https://findandstudy.com` kabul edilir;
   path, query, userinfo, alternatif port, bilinmeyen/eksik/çelişkili adres deny.
   Request Host header'ı güven kaynağı değildir. HS256/120 saniye receiver contract'ı
   değiştirilmedi. Receiver tarafında replay/code-exchange hâlâ ayrı iştir.
4. **Linux doğrulama kapısı:** sabit beş sentetik runtime suite'i, native bağımlılık
   sürümleri, source/lock hashleri, süre/çıktı bütçesi ve temiz child environment.
   SKIP/TODO/eksik sonuç PASS olamaz. Kurulum, servis başlatma veya deploy yapmaz.
5. **Disposable HTTP test altyapısı:** exact DB endpoint + PostgreSQL-reported
   data directory + UUID run comment + boş business tabloları + exclusive test
   lock. İlk bağlantıdan sonra yeni DB socket kabulü kapanır. Runtime SQL tek
   rollback transaction ve `fas_app` üzerinden çalışır. Standard Node dış ağ,
   DNS, TLS ve subprocess girişimleri engellenir. İş bitince tablo sayıları
   karşılaştırılır ve yalnız run-owned geçici storage temizlenir. Bu bir OS
   firewall, tüm browser E2E veya gerçek connection-pool concurrency kanıtı değildir.
6. **CSRF sınırının test edilebilirliği:** mevcut middleware davranış değiştirmeden
   `middlewares/csrf.ts` içine taşındı. Ana uygulamadaki cookie/auth/CSRF/router
   sırası korunur; dar HTTP testi aynı gerçek middleware ve route'ları kullanır.
7. **Eşzamanlı upload lock yarışı:** `mkdir` EEXIST döndükten sonra mevcut owner
   kilidi kaldırmışsa sonuç retryable Busy olur. Kilit çalınmaz, yeniden alınmaz
   ve dosyaya yazılmaz. Gözlenen symlink/non-directory kilit hâlâ Unsafe reddidir.

## Test ve review durumu

- Sahiplik sırası gerçek handler regresyonları: **12/12 PASS**; foreign/missing/
  null owner durumlarında 403 ve sıfır object read/delete/recompress/write.
- Acente ticket/immutable PUT gerçek handler + dosya testleri: **7/7 PASS**;
  aynı içerik, farklı içerik, eşzamanlılık, expiry, path, invalid bytes ve busy.
  Bu suite raw-body/rate-limit middleware'ını değil son handler'ı çalıştırır.
- Academy politika/handler testleri: **11/11 PASS**; izin verilmeyen ortamda PII,
  DB, token ve redirect etkisi sıfır. Gerçek receiver'a çağrı yapılmaz.
- CSRF davranış ve wiring eşliği: **8/8 PASS**. Disposable test güvenlik sınırı:
  **11/11 PASS**; yalnız literal `127.0.0.1` için ağsız DNS cevabı vardır, gerçek
  hostname çözümlemesi, diğer socket hedefleri ve subprocess engellenir.
- API birleşik security/health/email/agency/disposable-safety grubu:
  **256 PASS, 1 Windows file-symlink SKIP, 0 FAIL** (257 assertion).
- Local publisher suite **25 PASS / 1 Windows SKIP**; deterministic lock-race ve
  symlink/non-directory negatif testleri eklendi. Ayrı process yarışını da içeren
  bütün suite beş kez aynı sonuçla geçti. İlk birleşik çalışmada yakalanan yarış
  gizlenmedi; düzeltmeden sonra birleşik grup yeniden PASS oldu.
- Linux kapı saf testleri + eski staging quarantine + package-manager + public
  web CI wiring: **36/36 PASS**. Mevcut yazmalı staging UAT aracı kapalı kaldı.
- Library build/typecheck ve API noEmit: **PASS**. Yerel API production-mode
  build: **PASS**. Deployed image kanıtı değildir.
- Güncel production dependency audit: **641 dependency, 0 bilinen advisory**.
  Bu sonuç pentest veya üretim güvenliği sertifikası değildir.
- Bağımsız alt ajan review'u belge sırası/public immutable upload/Academy için
  tamamlandı. Test harness review'unda bulunan ikinci DB bağlantısı kaçış yolu
  kapatıldı; son temizleme sırasında dış etki girişimleri de sonucu FAIL yapar.

### Linux durumu

**BLOCKED:** Yerel Docker CLI var fakat Docker Linux daemon'u çalışmıyor; WSL'de
yalnız docker-desktop dağıtımı var. Servis/host ayarı değiştirilmedi. Gerçek CLI
Windows'ta child başlatmadan `LINUX_RUNTIME_REQUIRED` ile beklendiği gibi reddeder.
Bu ret Linux testlerinin geçtiği anlamına gelmez. Hazır, izole Linux checkout'ta
`node scripts/verify-security-linux.mjs` çalıştırılmalıdır; PDF renderer ve gerçek
symlink testi eksikse kapı kapanmaz.
Güncel beş Linux suite'i için minimum toplam **61** assertion zorunludur.

### İlk HTTP denemesinde bulunan mimari borç

Tam `app.ts` import'u, index.ts/worker başlatılmasa bile notification rule seed ve
feed/inbox LISTEN/reconnect başlatıyor. İlk deneme güvenlik sınırlarıyla reddedildi;
task-owned başarısız Node process'i durduruldu ve users/object_owners/sessions ile
diğer client bağlantıları sıfır doğrulandı. Bu davranış sessizce mocklanarak tam
uygulama PASS raporlanmaz. Import yan etkilerinin explicit lifecycle/teardown'a
alınması ayrı backlog'dur. Dar auth/storage test yolu ayrıca doğrulanır.

### Gerçek disposable HTTP sonucu

**PASS (iki başarılı çalışma, sonuncusu lock-race düzeltmesi sonrası):** gerçek
PostgreSQL + gerçek auth/storage handler'ları + gerçek CSRF ve
Sharp/dosya işleme ile 10 kontrol grubu tamamlandı. Giriş/oturum ayrımı, eksik
CSRF reddi, kullanıcıya bağlı upload grant, anonim/farklı kullanıcı PUT reddi,
immutable yayın/aynı içerik retry/farklı içerik conflict, private download ve
eski public alias erişim reddi, reserved path reddi ve logout sonrası **eski
oturum cookie'sinin yeniden oynatılmasında 401** doğrulandı. Beklenen logout
204 contract'ı değiştirilmedi; test beklentisi mevcut contract'a uyarlandı.

İlk iki dar test denemesinde test altyapısındaki literal loopback DNS engeli ve
logout için yanlış 200 beklentisi düzeltildi. Runtime güvenlik kontrolleri
gevşetilmedi; başarılı sonuç ancak son yeniden çalıştırmada kaydedildi.

Provider/email kuyruğunda etki yok; bütün public tablo satır sayıları rollback
öncesindeki değerlere döndü. Sequence sayacı rollback kapsamı dışındadır.
Bağımsız SQL kontrolünde users/object_owners/sessions ve diğer DB client sayıları
`0/0/0/0` bulundu. Teste ait storage temizlendi. Yalnız göreve ait cluster
`pg_ctl -m fast` ile durduruldu; 5433 listener ve kalan HTTP fixture dizini sıfır.
Yeni oluşturulan cluster dosyaları inceleme için tutuldu; mevcut DB silinmedi.

Bu sonuç tarayıcı, bütün application journey, ana uygulama bootstrap'ı, global
router veya normal connection-pool concurrency testi değildir.

## Bu dilimde değişen dosyalar

Repo köküne göre; 23 Eylül'den kalan diğer dirty dosyalar ayrıca önceki raporda:

| Dosya | Amaç |
| --- | --- |
| `artifacts/api-server/src/routes/documents.ts`, `leads.ts` | Dosya I/O öncesi mevcut sahiplik kontrolü, redacted deny log |
| `artifacts/api-server/src/routes/agentApplications.ts` | Ticket ile immutable local upload |
| `artifacts/api-server/src/routes/academySso.ts`, `src/lib/academySsoPolicy.ts` | Production receiver ortam sınırı |
| `artifacts/api-server/src/app.ts`, `src/middlewares/csrf.ts` | Davranış koruyan CSRF extraction |
| `artifacts/api-server/src/lib/localUploadPublication.ts`, `scripts/test-local-upload-publication.ts` | EEXIST/lock kaldırma yarışı ve fail-closed regresyonları |
| `artifacts/api-server/scripts/test-document-upload-ownership-order.ts` | Gerçek handler sahiplik regresyonları |
| `artifacts/api-server/scripts/test-agency-upload-immutability.ts` | Ticket/immutable yayın testleri |
| `artifacts/api-server/scripts/test-academy-sso-delivery-safety.ts` | Ortam/PII/token sınırı regresyonu |
| `artifacts/api-server/scripts/test-csrf-middleware.ts`, `test-security-regressions.ts` | Middleware ve wiring eşliği |
| `artifacts/api-server/scripts/disposable-route-e2e-safety.ts`, `run-disposable-route-e2e.ts`, `test-disposable-route-e2e-safety.ts` | Yeni izole auth/storage HTTP test koridoru |
| `scripts/verify-security-linux.mjs`, `scripts/test-security-linux-gate.mjs` | Linux-only doğrulama ve saf kapı testleri |
| `artifacts/api-server/package.json`, `package.json` | Tekrarlanabilir yerel test komutları |
| `security/legacy-role-gate-registry.json` | Değişen route kaynak hashleri; yetki sınıfı gevşetilmedi |
| `AGENTS.md`, bu rapor | Yerel kanıt, sınır ve açık iş kaydı |

## Uyumluluk, rollout ve geri dönüş

Route/response şekilleri, mevcut auth/rol ve object owner/download modeli korunur.
Acente upload artık aynı key için farklı dosyayı reddeder; değişiklik için yeni
upload URL istenmelidir. Academy release preflight'ında mevcut base URL'lerin
canonical ve uyumlu olduğu doğrulanmadan dağıtım yapılmamalıdır; yeni kontrol
konfigürasyon eksikliğini 403 ile kapatır. Production config bu görevde okunmadı
ve değiştirilmedi. DB migration gerektirmeyen kod değişikliğidir; rollback önceki
güvenlik açığını geri getireceğinden doğrulanmış hotfix tercih edilir.

## Açık işler

- Gerçek Linux native/symlink/fsync kapısı ve exact source release doğrulaması.
- Genel upload grant expiry + ayrı durable consume/finalization receipt; kalıcı
  `object_owners` download yetkisini TTL uygulayarak veya silerek çözmemek gerekir.
- Cloud PUT/thumbnail cancellation ve PDF processing retry determinizmi.
- Webhook freshness/replay; dış üretici contract'ını koordinasyonsuz değiştirmeme.
- Academy receiver tarafı replay/audience/issuer veya one-time code exchange.
- Tam uygulama/browser workflow, çoklu transaction/concurrency/outbox, staging
  gerçek içerik UAT, yük/CWV ve offsite restore/DR kanıtı.
- Eager import seed/LISTEN lifecycle'ının yönetilebilir hale getirilmesi.

**Release status: PARTIALLY READY.** Yerel kanıtlar staging/production dağıtımı
veya tüm güvenlik açıklarının kapandığı iddiası değildir.
