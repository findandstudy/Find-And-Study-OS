# Portal Automation — Scheduled Drain

## Neden gerekli?

Replit'te always-on arka plan worker yoktur. Portal kuyruğuna alınan görevler
(`status = 'queued'`) otomatik olarak işlenmez; birisi tetikleme yapana kadar
`queued` kalır.

**Manuel tetikleme** için:
- Admin paneli → Portal Automation → Submissions sekmesi →
  **"Process All Queued"** butonu.

Bu endpoint (`POST /api/portal-submissions/process-queued`) kuyruktaki tüm
görevleri sırayla, aynı Node.js process içinde, inline çalıştırır. Güvenlidir
(mutex ile eşzaman korumalı).

---

## Otomatik drain — seçenekler

### Seçenek 1: Replit Scheduled Deployment (önerilen)

1. Ayrı bir "drain" deployment'ı oluşturun:
   ```
   pnpm --filter @workspace/api-server drain
   ```
   (`artifacts/api-server/package.json` → `"drain": "tsx scripts/drain-once.ts"`)

2. Replit "Scheduled" deployment türünü seçin, istediğiniz cron'u girin:
   ```
   0 */6 * * *   # her 6 saatte bir
   ```
   Bu deployment tam çalışır, kuyruğu boşaltır ve kapanır.

### Seçenek 2: Harici cron servisi (cron-job.org, GitHub Actions, vb.)

Herhangi bir HTTP cron servisiyle şu isteği tetikleyin:

```
POST https://<your-domain>/api/portal-submissions/process-queued
Headers:
  Cookie: <admin oturumu cookie'si>
  x-csrf-token: <csrf token>
  Content-Type: application/json
```

Veya bir API token ile (Bearer auth CSRF'i atlar):
```
POST https://<your-domain>/api/portal-submissions/process-queued
Headers:
  Authorization: Bearer fas_live_<token>
  Content-Type: application/json
```

API token `scope: portal` ile oluşturulmuş olmalıdır.

### Seçenek 3: drain-once.ts scripti (tek seferlik / CI)

```bash
pnpm --filter @workspace/api-server drain
```

`artifacts/api-server/scripts/drain-once.ts` doğrudan DB'ye bağlanır,
kuyruğu boşaltır ve çıkar. Herhangi bir CI ortamında veya sunucu
cron'u olarak kullanılabilir. Ortam değişkenlerine ihtiyaç duyar:

```
DATABASE_URL=postgres://...
ENCRYPTION_KEY=...
NODE_ENV=production
```

---

## Credential kurulumu (PROD'da Topkapi için)

`/api/portal-submissions/process` hatası alıyorsanız credential
ayarlanmamış demektir. Admin paneli → Portal Automation →
**Portal Credentials** sekmesinden Topkapi bilgilerini ekleyin.

DB'de `portal_key = 'topkapi'` ile kayıt oluşur.
`portal_universities` tablosuna otomatik kayıt eklenmemişse endpoint
artık adapter registry'den de fallback okur (bkz. `/university-portals`
düzeltmesi).

---

## Özet: hangi durumda ne yapmalı?

| Durum | Çözüm |
|---|---|
| Submission `queued` kalıyor | Admin paneli → "Process All Queued" |
| Process butonu "failed" dönüyor | Portal Credentials sekmesinden Topkapi creds girin |
| PROD'da dropdown boş | Credentials girdin mi? Registry fallback artık devrede |
| Otomatik işlemek istiyorum | Scheduled deployment veya harici cron (bkz. yukarıda) |
