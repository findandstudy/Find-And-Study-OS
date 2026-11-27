# Yerel pipeline atama ve Mesajlar eşleşmesi

Kapsam yalnız izole local geliştirmedir; staging/Apply/production, dış mesaj veya e-posta gönderimi yoktur.

- Kaynak üzerinden açıkça conversationId ile bağlı kart, Mesajlar sağ panelinde pipeline adı, aşama ve sorumlu olarak gösterilir. Telefon/e-posta benzerliğinden bağlantı tahmin edilmez.
- Aşama iki ekranda aynı kartın stageId alanıdır. Mesajlar paneli değişiklik olayını mevcut SSE bağlantısından alır; pipeline görünürken 3 saniyelik sorgu yenilemesi diğer ekrandaki değişikliği alır. Ek kalıcı SSE bağlantısı açılmaz.
- Mesajlar üst atama menüsü ve sağ paneldeki sorumlu, pipeline kartı ile aynı üyelik doğrulamasından geçer. Kart + konuşma ataması tek transaction içinde güncellenir; olay commit ile yayınlanır. Atamayı kaldırma ve tekrar aynı kişiyi seçme de desteklenir.
- Pipeline ayarlarındaki Ekip erişimi ve yeni pipeline formu, atanabilecek ekip üyelerini açıkça seçtirir. Oluşturan kişi korunur. Atanmış kayıt/açık takip varken üye çıkarılamaz; önce yeniden atama gerekir.
- Bağsız konuşmalar standart CRM akışını korur. Work-pipeline işlemleri lead/student/application tablolarına yazmaz. CRM zincirine bağlı konuşmanın sorumlusu bu yoldan değiştirilmez. Birden çok aktif pipeline kartında çelişen sorumlular varsa sessiz seçim yerine 409 döner.
- Yeni dar PATCH yalnız aşama/sorumlu alanlarını değiştirir; revision çakışması 409 döner. Mevcut tam kart PUT aynı ortak doğrulama ve kaynak korumasını kullanır.

Doğrulama:

- 12 gerçek local API/PostgreSQL kontrolü PASS: atama iki yön, aşama, null atama, stale revision, geçersiz aşama, ekip dışı kullanıcı, erişim iptali, atanmış üyeyi çıkarma, commit-bound olay ve CRM kayıt sayısı korunması.
- İç tarayıcıda sentetik konuşma: Mesajlar'dan Meeting + Pipeline Admin TEST ataması, pipeline kartında aynı değerler; pipeline'dan New kaydı ve Mesajlar'a dönüşte aynı aşama/sorumlu doğrulandı.
- Ön yüz TypeScript PASS. API TypeScript yalnız önceden var olan embedLeadFormI18n.ts:41 `ur` locale tipi hatasında kalır.
- Local DB'nin conversation_participants(conversation_id,user_id) unique indeksi eksikti; mevcut Inbox ON CONFLICT yazımı 500 veriyordu. Hedef DB kimliği doğrulanarak yalnız local indeks eklendi; kayıtlar değiştirilmedi. Tekrar kullanılabilir local repair scripti ve local setup kontrolü eklendi. Production migration yapılmadı.

Proxy düzeltmesi için önceki seçici notundaki yeni doğrulama geçerlidir; 15 saniyelik geçici lease kaldırılmıştır.
