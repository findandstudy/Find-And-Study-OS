# WhatsApp modelinden hareketle ortak pipeline e-posta modeli

28 Kasım 2026 — inceleme ve tasarım. Bu belge uygulama/deploy kaydı değildir.
Son kullanıcı yönlendirmesine göre merkez yerleşimi yeniden ele alınmıştır;
şu an yayımlanmış Mesajlar merkezli düzen bu turda değiştirilmemiştir.

## Kullanıcının istediği kullanım

1. E-posta şablonları ve hesapları bir kez ortak merkezde tanımlanır.
2. Kullanıcı pipeline yönetiminden bir aşamayı düzenler.
3. O aşamada kime, hangi hesaptan, hangi şablonla gönderileceğini seçer.
4. Kayıt gerçekten o aşamaya girince sistem gönderimi gerçekleştirir.
5. Aynı kullanım Application, Student, Lead ve bağımsız iş pipeline'larında
   tutarlı olur. Aşama ekranında şablon yazılmaz veya SMTP parolası girilmez.

## WhatsApp'ta doğrulanan mevcut davranış

- `EditStagesDialog.tsx` aşama düzenleme formunda otomatik WhatsApp açık/kapalı,
  onaylı şablon, aktif gönderici hesabı ve kaynak seçimi vardır.
- Şablonlar `/api/message-templates?channel=whatsapp&activeOnly=true`, hesaplar
  `/api/inbox/whatsapp-accounts` üzerinden yüklenir. Kayıt aşaması yalnız ID'leri
  saklar; aşama başına şablon/haberleşme hesabı kopyalanmaz.
- `StageAutomaticMessage` alanları enabled, templateId, channelAccountId,
  originTypes'tır. **Ayrı bir recipientType/Kime alanı yoktur.**
- Direct/Agent/Sub-agent, hangi kaynaklardan gelen kayıtların kapsanacağını
  seçer. Alıcı seçimi değildir. Application WhatsApp hedefi
  `resolveApplicationMessageTarget` ile öğrencinin telefonuna çözülür; agentId
  erişim/aidiyet kapsamıdır, acentenin telefonuna dönüşüm değildir.
- Lead/Student/Application tablolarındaki DB trigger'ları geçişle aynı transaction
  içinde `pipeline_stage_message_dispatches` oluşturur. Kuyruk worker'ı onaylı
  WhatsApp şablonu ve hesabı kontrol edip kampanya/gönderim hattını kullanır.
- Kayıt/aşama başına tek intent kısıtı vardır. Kaydetmek eski kayıtları taramaz.
- Önceki çakışma incelemesindeki genel WhatsApp/özel WhatsApp, susturma ve gecikmiş
  mesaj eksikleri geçerlidir; eksikler e-posta modeline taşınmamalıdır.

## Pipeline türlerinin bugünkü kapsamı

| Yapı | WhatsApp aşama ayarı | E-posta aşama ayarı | Gerçek veri yapısı |
| --- | --- | --- | --- |
| Lead | Var | Yok | pipeline_stages + leads.status |
| Student | Var | Yok | pipeline_stages + students.status |
| Application | Var | Var, yalnız bu türle sınırlı | pipeline_stages + applications.stage |
| Bağımsız iş pipeline'ı | Bu modelde yok | Yok | tenant/board UUID + JSON aşamalar + kart.stageId |

Bağımsız pipeline'lar Lead ekranının görünümünü paylaşsa da aynı tablo veya stage
editörünü kullanmıyor. `useWorkPipelines.ts/Stage` yalnız id/name/color/result
içeriyor; backend `workBoardInput` da ayrı sözleşme. Bağlı channel/embed/web
kaynakları **kayıt girişi** içindir; aşamadan dış mesaj gönderme ayarı değildir.

## Önerilen tek merkez

Son tarif için **Ayarlar → Bildirimler** altında dört bölüm:

- Genel bildirim kuralları: olaylar, ekip/iç bildirimler, finans, sözleşme, süreler.
- E-posta şablonları: ortak gövde, konu, dil, değişkenler, önizleme ve mevcut onay.
- E-posta hesapları: ortak gönderici hesapları ve bağlantı/doğrulama durumu.
- Gönderim geçmişi: kayıt/pipeline/aşama, kanal, alıcı türü, sonuç ve atlanma nedeni.

Mesajlar'da ikinci e-posta editörü bulunmaz; gerekirse bu ortak merkeze bağlantı
verilir. WhatsApp'ın mevcut Meta/onaylı şablon yönetimi bu iş için taşınmaz.

Hesap ekranı mevcut Entegrasyonlar/SMTP altyapısını kullanır. SMTP credential'ı
iki ayrı alanda tutulmaz. Entegrasyonlar kartı ile bu hesap listesi aynı hesap
yönetimine açılır. Şu anki legacy SMTP referans yaklaşımı yeniden kullanılabilir:
asıl credential yerinde kalır, kaynak değişince önceki doğrulama geçersizleşir.
Yeni bir posta gönderim sağlayıcısı, inbox ürünü veya paralel SMTP deposu yoktur.

## Her aşamada aynı sade form

```text
Otomatik e-posta                         Açık / Kapalı

Kime gönderilecek?                      [Alıcı kuralını seç]
Hangi e-posta hesabından?               [Ortak hesaplardan seç]
Hangi şablon / dil sürümü?              [Uyumlu onaylı sürümü seç]

Kapsanan kayıt kaynakları               [Varsa Direct / Agent / Sub-agent]
```

Kaynak kapsamı ile Kime alanı ayrı tutulur. Kullanıcı her aşama için bağımsız
seçim yapabilir; her aşamaya yeni şablon veya hesap oluşturmak zorunda kalmaz.
Seçili hesabın gerçek From adresi ve Reply-To bilgisi görünür. Taslak/retired
şablon, doğrulanmamış/kapalı hesap seçilemez; seçilmiş eski referans bozulursa
başka hesaba sessiz fallback yapılmaz.

### Alıcı seçenekleri pipeline bağlamına göre

| Pipeline | Sunulacak uygun alıcı türleri |
| --- | --- |
| Application | Kaynağa göre otomatik; öğrenci; bağlı acente/alt acente; yetkili atanmış sorumlu |
| Student | Kaynağa göre otomatik; öğrenci; bağlı acente/alt acente; yetkili sorumlu |
| Lead | Kayıttaki iletişim kişisi; varsa bağlı acente; yetkili sorumlu |
| Bağımsız pipeline | Karttaki iletişim kişisi; pipeline'a yetkili atanmış sorumlu |

Application için varsayılan **Kaynağa göre otomatik**: bireysel öğrenci → öğrenci,
acente öğrencisi → bağlı acente/alt acente. Bu, kullanıcının önceki açık kararıdır.
Bağımsız kart kişisi öğrenci varsayılmaz; gereksiz öğrenci/acente alanları açılmaz.
Her seçenek kayıt ilişkisi/yetki/iletişim uygunluğu açısından gönderim anında
yeniden çözülür. Eksik alıcı için başka kişi veya üst acente kendiliğinden seçilmez.
İlk kapsamda keyfî dış adres listesi, serbest CC/BCC veya bütün rollere fan-out yoktur.

## Ortak şablon, bağlama uygun değişkenler

Şablon deposu ve editörü tek kalır. Seçici, pipeline'ın gerçekten sağlayabildiği
değişkenlere uygun sürümleri gösterir. Örneğin Application program/üniversite
bilgisi verebilir; bağımsız iş kartına aynı değişkenler uydurulmaz. Ortak aşama ve
kayıt adları bağlam adaptörüyle çözülür; katalog/başvuru gerçeği değiştirilmez.
Seçili şablon uyumsuzlaşırsa kayıt veya gönderim açık gerekçeyle engellenir.

## Çalışma mantığı ve çakışmanın çözümü

1. Aşama geçişi gerçekten kaydedilir; kayıt değişmemişse yeni intent yoktur.
2. Aynı transaction'da kayıt + pipeline + aşama + kanal için gönderim niyeti oluşur.
3. Ortak karar noktası alıcı, kaynak, tercih/susturma, şablon onayı ve hesabı kontrol eder.
4. Mevcut email_queue ve SMTP worker kullanılır; WhatsApp worker'ı ayrı taşıyıcıdır.
5. Sağlayıcı çağrısından hemen önce güncel aşama, alıcı, hesap ve policy yeniden kontrol edilir.
6. Sonuç mevcut geçmişte saklanır. Belirsiz SMTP sonucunda başka üreticiyle yeniden
   gönderim yapılmaz. Hata ile atlama farklı gösterilir.

Öğrenci/acente için dış **aşama güncellemesinin sahibi aşama ayarıdır**. Genel
application.stage_changed olayı aynı konu/alıcı/kanalda ikinci mesaj oluşturmaz;
personel in-app uyarısı korunur. Genel görev, finans, sözleşme ve süre uyarıları
ayrı konulardır, bu değişiklikle kapanmaz. E-posta ve WhatsApp ayrı ayrı seçilmişse
iki farklı kanalda iletişim bilinçli tercih olabilir; aynı kanalın iki üreticisi
aynı mesajı tekrar gönderemez.

İlk sürümde mevcut “kayıt/aşama için bir kez” davranışı korunur; ayar kaydı veya
şablon güncellemesi eski kayıtları yeniden göndermez. Geri dönüşte tekrar gönderim
istenirse bu ayrı bir ürün kararıdır, kendiliğinden açılmaz.

## Kademeli uygulama

1. Merkezin yerleşimini kesinleştir: yukarıdaki Settings/Notifications düzeni;
   mevcut şablon ve hesap ID'lerini koru, kopyalama/silme yapma.
2. Mevcut Application e-posta alanına açık Kime kuralını ekle; WhatsApp ile aynı
   görsel dilde üç seçiciyi kullan. Genel/özel konu önceliğini ortaklaştır.
3. Lead ve Student için aynı form ve mevcut tablolara uygun intent üretimini ekle.
4. Bağımsız pipeline'ın kendi aşama editörüne aynı formu bağla. Board/tenant kimliği
   korunur; bu kartlar Lead/Student/Application kayıtlarına dönüştürülmez.
5. Tüm geçiş yollarını kapsa: detay, kanban, tablo, toplu işlem, import, inbox ve
   izinli otomasyon. Sadece kanban drop handler'ına e-posta çağrısı eklemek yeterli değildir.
6. Sentetik alıcılarla email/WhatsApp açık-kapalı kombinasyonları, tekrar giriş,
   eşzamanlı geçiş, kaynak/hesap/şablon değişimi, tercih/susturma, yetki ve dil
   uyumluluğunu doğrula. Yeni UI 23 dili ve RTL'yi kapsar. Gerçek gönderim ayrı kalır.

Bu model yeni bir otomasyon tasarım aracı kurmaz. Kullanıcı ortak merkezde
hazırlayıp mevcut pipeline aşamasında seçer; teknik ortaklaştırma arka plandadır.
