# Yerel pipeline Excel aktarımı — 27 Kasım 2026

Kapsam: `codex/local-work-pipelines-20261127`; staging/Apply değişmedi.

- Pano ve tabloyla aynı toolbar'da Excel içe/dışa aktar düğmeleri.
- Export yalnız seçili board ID + yetki kontrolünden sonra çalışır; etkin arama,
  aşama ve sorumlu filtreleri tüm sayfalara uygulanır. Başka board'a sorgu yoktur.
- XLSX: Records, Pipeline (kimlik/rehber), Stages ve Assignees sayfaları.
  Şablon boş kayıt sayfası ve yalnız ilgili pipeline'ın seçeneklerini içerir.
- İçe aktarım XLSX/XLS/CSV; 5 MB / 2000 satır sınırı, formül hücresi reddi.
  Önizleme: create/update/unchanged/error, gerçek Excel satır numarası.
  Hatalı satır varsa hiçbir kayıt yazılmaz. Preview hash board/card revision ve
  girdiyle yeniden hesaplanır; değişmiş önizleme 409 ile durur.
- RecordId yalnız seçili board'da çözülür. Başka board metadata/ID reddedilir.
  Kimliksiz tekrar yüklemelerde email/phone/title tabanlı importKey kullanılır;
  belirsiz eşleşme ve dosya içi tekrarlar hata olur. Aynı kişi için farklı kart
  gerekiyorsa RecordId içeren export dosyası kullanılır; bu bir kişi merge'i değildir.
- Güncellemelerde notlar, takipler, source ve task verisi korunur. Dosyada
  bulunmayan temel sütunlar eski değeri korur; mevcut boş hücre alanı temizler.
  Yeni satırda Title zorunlu, aşama verilmemişse ilk aşama kullanılır.
- Export en fazla 2000 sonuç; aşımda filtre daraltma hatası, kısmi dosya yok.
  Import sırasında mevcut board taraması 10000 kartla sınırlıdır; daha büyük
  panolar için ayrı batch tasarımı gerekir. Üretim ölçeği iddiası yoktur.
- 14 hedefli gerçek local API/DB kontrolü ve in-memory XLSX round-trip PASS:
  seçili board izolasyonu, filtre, preview-only, tekrar yükleme, foreign metadata/
  ID, hata atomikliği, dış kullanıcı deny, not/telefon koruma, stale preview,
  formüle dönüşmeyen string hücre, template seçenekleri, CRM counts sabit.
- UI'da indirme/yükleme doğrulaması tamamlanamadı: iç tarayıcı yeni sekme ve
  reload'da CDP navigation/focus timeout verdi; eski açık sekmeler önceki toolbar'ı
  göstermeye devam etti. API ve Vite HTTP 200 kontrol edildi. UI PASS denmez.
- API typecheck yalnız önceden mevcut `embedLeadFormI18n.ts:41` `ur` locale
  tipi hatasında kalır; yeni transfer koduna ait TypeScript hatası yoktur.
- Ön yüz TypeScript kontrolü PASS.
- Sentetik test dosyası OS temp `pipeline-excel-ui-test.xlsx`; gerçek kişi yok.
  Çalıştırma: `node --env-file=.env.work-pipelines.local node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/cli.mjs artifacts/api-server/scripts/test-local-work-pipeline-transfer.ts`.
