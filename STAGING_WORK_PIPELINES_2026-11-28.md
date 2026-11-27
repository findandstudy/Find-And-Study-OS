# Pipeline staging deployment — 28 Kasım 2026

Kapsam: bağımsız pipeline, ekip ataması, Inbox aşama eşliği, not/takip,
sistem içi bildirim/dashboard, Embed kaynak seçimi, pipeline'a özel Excel,
aranabilir seçici/favoriler ve 23 dil.

- Apply production kapsam dışı. Yerel veriler/credentials taşınmaz.
- Explicit WORK_PIPELINES_ENV=staging, staging hostname, fas_app@db:5432/fasos_staging,
  staging release ID ve kapalı dış iletişim doğrulanmadan modül açılmaz.
- 0144 yalnız yeni izole schema/tables/RLS/grants ekler. CRM migration/backfill yok.
  Uyumluluk için schema adı local_work_pipelines olarak korunur.
- Migration öncesi staging-only backup; canonical staging migration runner kullanılır.
- 30 saniyelik reminder worker yalnız in_app notifications yazar; shutdown'da durur.
- Feature flag kapatılması ve önceki app image geri dönüşü application rollback'tir;
  schema/veri silinmez. Production feature wiring yapılmaz.
- Yeni environment testleri 2/2, 145/145 journal validation PASS.
- Önceki 23 locale / SSR / scoped transfer / inbox parity doğrulamaları local notlarda.

Dağıtım ve gerçek staging kabul sonuçları işlem sonunda eklenecektir.

## Yayın kabul sonucu

Staging'e alındı. Sunucudaki birleştirme commit'i:
`8c44bafee32f37474b81284493ed328587762f50`.
Release: `staging-20261127T215540Z-8c44bafee32f` (UTC release kimliği).
Local feature kaynağı: `94f4c61a`; önceki staging delta'sı korunarak cherry-pick edildi.

- Runtime app/db healthy; public health HTTP 200, dbConnected=true.
- Migration runner PostgreSQL identity + exact source doğrulamasıyla 144 -> 145 PASS.
- 13.297.447 byte staging-only backup, SHA-256 ve network-none restore PASS:
  önceki 144 migration / 14 kullanıcı doğrulandı; disposable container kaldırıldı.
- Environment 2 test, 23 locale parity, 24 i18n test ve 23 dil React render PASS.
- Gerçek staging API sentetik kabul akışı 27 kontrol PASS: auth, feature/options,
  board/card create, stage, not, follow-up, tamamla, liste, Excel export,
  dashboard, archive, logout. TEST board'lar arşivli, kaynak bağları yok.
- Dış mesaj/e-posta kapalı; unrelated schedulers kapalı. Production Apply değişmedi.
- Pipeline route HTTP 200 SPA; anonymous browser login'e yönleniyor. Admin tarayıcı
  oturumu süresi dolduğu için oturum içi görsel kontrol yapılmadı; UI PASS iddiası yok.
- HSTS ve X-Robots-Tag noindex,nofollow korundu. Sözleşme ve program kartı
  düzeltmeleri geri alınmadı. Local test verisi/credential aktarılmadı.

Rollback: önceki app image `findandstudy-staging-app:restore-program-cards-keep-contract`;
secrets altındaki `app.env.before-work-pipelines-20261128` ve
`compose.env.before-work-pipelines-20261128` yedekleriyle yalnız app servisini
eski image'a döndür; schema/veri silme veya DB restore yapma.

Kaynak/provenance notu: local feature branch GitHub'a push edildi. Sunucudaki
birleştirme branch'i clean commit'tir; GitHub push oturumu olmadığı için remote'a
push edilmedi. Sunucu staging kaynak bundle'ı ve backup attestation'ı saklandı.
Sonraki kaynak eşitlemede bu staging integration head'i ayrıca remote'a alınmalıdır.
