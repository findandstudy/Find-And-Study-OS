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
