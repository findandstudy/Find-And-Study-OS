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
- Local HTTP/1 sekme takılması için yalnız izole local launcher SSE yanıtlarını
  15 sn lease ile sonlandırır. Development istemcisi 15 sn sonra bağlantıyı
  bırakıp 1 sn sonra görünürse açar; hidden/dispose timer'ları temizlenir.
  İstemcide production lease kapalıdır; production launcher değiştirilmedi.
  Timer/visibility lifecycle 2 test PASS. Stream yeniden açılmasında mevcut
  missed-data refresh davranışları kullanılır.
- İç tarayıcı eski ekranı tuttu, reload/focus timeout devam etti. Yeni seçiciye
  görsel/UI PASS verilmedi; otomatik UI doğrulaması açık sınırdır.
- Staging/Apply deploy veya remote push yoktur.
