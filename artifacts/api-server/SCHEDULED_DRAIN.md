# Portal Submission Drain — Scheduled Deployment Kurulumu

## Genel Bakış

`drain-once.ts` scripti, kuyrukta bekleyen (`queued`) tüm `portal_submissions` kayıtlarını sıralı olarak işler ve çıkar. Replit Autoscale'de sürekli çalışan worker olmayacağı için, bu scripti Replit **Scheduled Deployment** (zamanlanmış deployment) olarak periyodik çalıştırın.

## Çalıştırma Komutu

```bash
pnpm --filter @workspace/api-server exec tsx scripts/drain-once.ts
```

## Gerekli Environment Değişkenleri

| Değişken | Açıklama |
|---|---|
| `DATABASE_URL` | PostgreSQL bağlantı URL'si |
| `ENCRYPTION_KEY` | Portal kimlik bilgileri şifreleme anahtarı |
| `SESSION_SECRET` | ENCRYPTION_KEY yoksa fallback olarak kullanılır |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` | Nix chromium yolu (otomatik `.replit` tarafından set edilir) |

## Replit Scheduled Deployment Adımları

1. **Replit panelinde** projenizi açın
2. Sol menüden **Deployments** → **New Deployment** seçin
3. Deployment tipini **Scheduled** olarak ayarlayın
4. **Command** alanına:
   ```
   pnpm --filter @workspace/api-server exec tsx scripts/drain-once.ts
   ```
5. **Schedule** (önerilen):
   - Her 5 dakikada bir: `*/5 * * * *`
   - Her 15 dakikada bir: `*/15 * * * *`
   - Her saat başı: `0 * * * *`
6. **Environment Variables** bölümünde `DATABASE_URL`, `ENCRYPTION_KEY`, `SESSION_SECRET` ekleyin

## Önemli Notlar

- Script **idempotent**tir — aynı anda birden fazla çalışsa bile `FOR UPDATE SKIP LOCKED` sayesinde her satır yalnızca bir kez işlenir
- Her submission'dan sonra browser **kapatılır** (bellek temizlenir)
- Başarısız submission'lar `portal_submissions.status = 'failed'` olarak kaydedilir; `max_attempts` aşılmamışsa bir sonraki çalışmada tekrar denenir
- Script sıfır (`0`) ile çıkar — başarısız submission'lar olsa bile (DB hatası yoksa)

## Manuel Çalıştırma

Dev ortamında test için:

```bash
# Tüm kuyruklanmış submission'ları işle
pnpm --filter @workspace/api-server exec tsx scripts/drain-once.ts

# Çıktı örneği:
# [drain-once] Starting — id=drain-once-hostname-12345
# [drain-once] Released 0 stale submission(s)
# [drain-once] Processing #42 — uni=topkapi mode=dry attempt=1/3
# [drain-once] #42 → dry_run
# [drain-once] Done — 1 submission(s) processed
#   #42: dry_run
```

## Manuel "Şimdi İşle" (API)

Scheduled deployment beklemeden anlık işleme için Submission Board'daki **"Şimdi İşle"** butonunu kullanın:

- **Tekil**: Bir submission satırındaki "İşle" butonu
- **Toplu**: Toolbar'daki "Tüm Bekleyenleri İşle" butonu
