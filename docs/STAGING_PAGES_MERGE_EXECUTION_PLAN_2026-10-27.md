# Staging Pages Birleşim ve Yayın Planı — 27 Ekim 2026

Durum: Uygulama ve staging doğrulaması için yürütülüyor  
Hedef: Yalnız `staging.findandstudy.com`  
Production ve `Find-And-Study-OS-Next`: Kapsam dışı

## 1. Doğrulanmış tabanlar

- Çalışan staging kaynak commit'i: `5258641642faae43b16d5da84fd7f8fd5c64bb35`
- Çalışan staging image'i: `sha256:ba2b09c9d4b201ba86206026da156beee7a3ac2c483b0118a1ed6207bfb0d1bf`
- Pages taşıma commit'i: `304d03ba5fe864068b2b42c0fc543a61b4337ae8`
- Birleşim branch'i: `codex/staging-pages-merged-20261027`
- Birleşim commit'i: `b1a9c2d35`

Pages paketi ile `5258641` sonrasında değişen staging dosyaları arasında doğrudan dosya çakışması yoktur. Paket migration, `pnpm-lock.yaml` veya package manifesti değiştirmez.

## 2. Taşınacak kapsam

1. Genişletilmiş Dynamic Page Editor.
2. Geniş section kataloğu ve responsive section düzenleri.
3. Shared Detail Template metin, değişken ve görünüm editörü.
4. Managed Page bölüm görünümü özelleştirmeleri.
5. Gelişmiş managed-page renderer ve güvenli HTML içeriği.
6. Kayıt, inceleme ve yayın koridoru.
7. Yayın öncesi SEO ve içerik kontrolleri.
8. Çeviri kapsamı görünümü.
9. Theme Builder görünüm seçenekleri.

Mevcut ajan çalışma alanı, sözleşme/PDF düzeltmeleri, rol sınırları ve staging güvenlik ayarları korunacaktır.

## 3. Bu dalgaya alınmayacaklar

- AI içerik üretimi ve dış model çağrıları.
- Kalıcı çeviri kuyruğu.
- Hava durumu ve diğer dış veri sağlayıcıları.
- Pipeline/board modülü.
- Production veya `Next` dağıtımı.
- Veritabanı migration'ı, seed veya katalog veri kopyası.

## 4. Uygulama kapıları

1. Temiz exact-head worktree ve remote branch doğrulaması.
2. API ve frontend typecheck.
3. Pages/API contract ve inventory testleri.
4. Production API ve frontend build.
5. Staging kaynak checkout ve disk rezervi preflight'i.
6. Taze staging veritabanı yedeği ve geri okunabilirlik kontrolü.
7. Yalnız app image build ve yalnız staging app container değişimi.
8. Health, release ID, DB bağlantısı, noindex, güvenlik sınırı ve Pages smoke/UAT.

## 5. Geri dönüş

- Kod geri dönüşü: kaynak `5258641642faae43b16d5da84fd7f8fd5c64bb35` ve image `sha256:ba2b09c9d4b201ba86206026da156beee7a3ac2c483b0118a1ed6207bfb0d1bf`.
- Veritabanı değişikliği olmadığı için normal geri dönüş yalnız app container/image değişimidir.
- Veritabanı restore'u otomatik rollback değildir ve ayrıca açık onay gerektirir.
- Başka Docker projeleri, worker'lar, production ve volume'ler yeniden başlatılmaz veya temizlenmez.
