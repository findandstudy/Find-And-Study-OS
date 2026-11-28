import { translateUi } from '../../../lib/ui-localization';
const labels: Record<string, readonly [string, string]> = {
  program: ["Program", "Program"], university: ["University", "Üniversite"], destination: ["Country / destination", "Ülke / destinasyon"], city: ["City", "Şehir"],
  draft: ["Draft", "Taslak"], published: ["Published", "Yayında"], archived: ["Archived", "Arşivlendi"], default: ["Default layout", "Varsayılan düzen"], absent: ["Not saved yet", "Henüz kaydedilmedi"],
  hero: ["Hero", "Üst bölüm"], navigation: ["Page navigation", "Bölüm gezinmesi"], overview: ["Overview", "Genel bakış"],
  requirements: ["Requirements", "Gereklilikler"], intakes: ["Intakes", "Başvuru dönemleri"], fees: ["Fees", "Ücretler"], related: ["Other options", "Diğer seçenekler"],
  facts: ["Key facts", "Temel bilgiler"], weather: ["Stored weather", "Saklanan hava durumu"], programs: ["Programs", "Programlar"], universities: ["Universities", "Üniversiteler"], cities: ["Cities", "Şehirler"],
  languageCourses: ["Free language courses", "Ücretsiz dil kursları"], cta: ["Next step", "Sonraki adım"], mobileActions: ["Mobile actions", "Mobil işlem düğmeleri"],
  "editorial-gallery": ["Image gallery", "Görsel galerisi"], "editorial-highlights": ["Highlights", "Öne çıkanlar"],
  "editorial-cautions": ["Things to consider", "Dikkat edilmesi gerekenler"], "editorial-curriculum": ["Curriculum", "Müfredat"],
  "editorial-education": ["Education", "Eğitim"], "editorial-admission": ["Admission information", "Kabul bilgileri"],
  "editorial-scholarships": ["Scholarships", "Burslar"], "editorial-living": ["Living costs", "Yaşam maliyetleri"],
  "editorial-campus": ["Campus", "Kampüs"], "editorial-housing": ["Housing", "Konaklama"],
  "editorial-services": ["Student services", "Öğrenci hizmetleri"], "editorial-recognition": ["Recognition and accreditation", "Tanınma ve akreditasyon"],
  "editorial-climate": ["Weather and climate", "Hava durumu ve iklim"], "editorial-transport": ["Transport", "Ulaşım"],
  "editorial-visa": ["Visa and calendar", "Vize ve takvim"], "editorial-intakeGuide": ["Intakes and calendar", "Başvuru dönemleri ve takvim"],
  "editorial-support": ["Student support", "Öğrenci desteği"], "editorial-reviews": ["Student reviews", "Öğrenci yorumları"],
  "editorial-studentStory": ["Student experience", "Öğrenci deneyimi"], "editorial-requirements": ["Requirements guidance", "Gereklilik rehberi"],
  "editorial-faq": ["Frequently asked questions", "Sıkça sorulan sorular"], "editorial-applyGuide": ["Application guide", "Başvuru rehberi"],
};

/** UI metadata follows the same catalogue as the rest of the editor. */
export function detailTemplateLabel(key: string, lang: string): string {
  const label = labels[key];
  return label ? translateUi(lang, label[0], label[1]) : key;
}
