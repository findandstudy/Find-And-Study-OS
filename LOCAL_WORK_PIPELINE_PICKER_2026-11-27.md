# Pipeline seçici ve favoriler — yalnız local

- Tüm pipeline'ları yatay basan menü kaldırıldı. Seçili pipeline adlı açılır
  menü, sunucuda arama, sayfalı liste ve mevcut oluşturma dialog'una bağlantı var.
- Yan yıldız veya listedeki yıldız ile favori ekle/çıkar. Yatay şerit yalnız
  favorileri gösterir; normal pipeline'lar açılır menüdedir. Yetki/source/CRM
  akışı değişmez. Favori çözümlemesi de sunucudaki board erişim filtresinden geçer.
- Tercihler mevcut sidebar yaklaşımıyla bu tarayıcıda kullanıcı ID'sine özel
  localStorage anahtarında tutulur. Aynı origin sekmelerinde storage event ile
  eşitlenir; cihazlar arası senkron değildir. En fazla 100 favori desteklenir.
- 14 hedefli API/preference kontrolü PASS; invalid/empty/foreign ID filtresi,
  arama erişimi ve storage round-trip doğrulandı.
- Ön yüz typecheck PASS; API typecheck yalnız önceden mevcut
  `embedLeadFormI18n.ts:41` `ur` locale tipi hatasında kalır. Board kart sorgusu
  önceki board placeholder'ını kullanmaz; geçişte eski kartlar gösterilmez.
- Sekme takılmasının somut nedeni: Vite proxy, API kesildiğinde headers gönderilmiş
  SSE yanıtını kapatmıyordu. Tarayıcı→Vite bağlantıları açıkken API tarafında
  karşılığı kalmamıştı. Proxy aborted/error cleanup eklendi; normal headers öncesi
  500 davranışı korundu. Geçici 15 saniyelik server/client lease kaldırıldı.
  Hidden-tab abonelik duraklatması korunur.
- Gerçek HTTP upstream kesintisi testi PASS: başlamış SSE kapanır, ardından health
  isteği başarılı olur, headers öncesi hata 500 kalır.
- İç tarayıcı UI doğrulandı: giriş, pipeline arama, ksks seçimi, yıldızla favoriye
  ekleme, yalnız favorinin yatay görünmesi ve reload sonrası kalıcılık PASS.
  Pipeline aşamaları ve Excel kontrolleri görünür. Test yalnız sentetik local hesapla yapıldı.
- Staging/Apply deploy veya remote push yoktur.
