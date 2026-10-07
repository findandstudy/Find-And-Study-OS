# Takım tasarım önizlemesi — staging release dilimi

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
