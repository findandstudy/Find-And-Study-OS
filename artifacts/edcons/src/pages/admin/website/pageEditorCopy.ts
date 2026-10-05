// Page-editor copy only; catalogue facts and user-authored content are never translated here.
const TURKISH: Record<string, string> = {
  Hero: "Üst bölüm", "Rich Text": "Zengin metin", "Stats Strip": "İstatistik şeridi", "Live Catalog Grid": "Güncel katalog listesi",
  "Feature Cards": "Özellik kartları", "Icon Cards": "Simgeli kartlar", "CTA Banner": "Çağrı bandı", FAQ: "Sık sorulan sorular",
  "Team Grid": "Ekip listesi", "Office List": "Ofis listesi", "Logo Grid": "Logo listesi", Testimonials: "Yorumlar",
  "Section Title + Subtitle": "Bölüm başlığı ve alt başlığı", "Spacer / Divider": "Boşluk / ayırıcı", "Reusable Global Block": "Yeniden kullanılabilir ortak blok",
  content: "İçerik", media: "Medya", layout: "Düzen", data: "Veri", reference: "Referans",
  "Badge Text": "Rozet metni", Title: "Başlık", Subtitle: "Alt başlık", "CTA Button Label": "Çağrı düğmesi metni", "CTA Button URL": "Çağrı düğmesi adresi",
  "Secondary Button Label": "İkinci düğme metni", "Secondary Button URL": "İkinci düğme adresi", "Background Image": "Arka plan görseli", "Show Overlay": "Karartmayı göster",
  "Content (HTML)": "İçerik (HTML)", "Max Width": "En fazla genişlik", Narrow: "Dar", Medium: "Orta", Wide: "Geniş", Full: "Tam",
  Background: "Arka plan", Primary: "Ana renk", Card: "Kart", Transparent: "Saydam", Stats: "İstatistikler", Value: "Değer", Label: "Etiket",
  "Section Title": "Bölüm başlığı", "Section Subtitle": "Bölüm alt başlığı", "Catalogue Source": "Katalog kaynağı", Programs: "Programlar", Universities: "Üniversiteler",
  Destinations: "Destinasyonlar", Cities: "Şehirler", "Items to show": "Gösterilecek kayıt sayısı", "Country filter (optional)": "Ülke filtresi (isteğe bağlı)", "City filter (optional)": "Şehir filtresi (isteğe bağlı)",
  Columns: "Sütunlar", Cards: "Kartlar", "Icon Name": "Simge adı", Description: "Açıklama", "Link URL": "Bağlantı adresi", "Link Label": "Bağlantı metni",
  "Background Style": "Arka plan stili", Gradient: "Renk geçişi", "Solid Primary": "Düz ana renk", Image: "Görsel", "Button Label": "Düğme metni", "Button URL": "Düğme adresi",
  "Secondary Button": "İkinci düğme", "Secondary URL": "İkinci adres", "FAQ Items": "Sorular", Question: "Soru", Answer: "Yanıt", Source: "Kaynak", "From Collections": "Koleksiyonlardan", Manual: "Elle",
  "Team Members": "Ekip üyeleri", Name: "Ad", Role: "Görev", "Photo URL": "Fotoğraf adresi", Bio: "Biyografi", Offices: "Ofisler", City: "Şehir", Address: "Adres", Phone: "Telefon", Email: "E-posta",
  Logos: "Logolar", "Logo URL": "Logo adresi", Layout: "Düzen", Carousel: "Kaydırıcı", Grid: "Izgara", Content: "İçerik", "Rating (1-5)": "Puan (1–5)",
  Alignment: "Hizalama", Left: "Sol", Center: "Orta", Right: "Sağ", Size: "Boyut", Small: "Küçük", Large: "Büyük", "Height (px)": "Yükseklik (piksel)", "Show Divider Line": "Ayırıcı çizgiyi göster", "Divider Color": "Ayırıcı rengi",
  "Global Component ID": "Ortak bileşen kimliği", "Component Slug": "Bileşen adresi", "Move block up": "Bloğu yukarı taşı", "Move block down": "Bloğu aşağı taşı", "Hide block": "Bloğu gizle", "Show block": "Bloğu göster", "Duplicate block": "Bloğu kopyala", "Remove block": "Bloğu kaldır",
  "Select...": "Seçin...", "Image URL": "Görsel adresi", "Add Item": "Öğe ekle", Item: "Öğe", "Remove item": "Öğeyi kaldır",
};

export function pageEditorText(lang: string, english: string, turkish?: string): string {
  return lang === "tr" ? turkish ?? TURKISH[english] ?? english : english;
}
