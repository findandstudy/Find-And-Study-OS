const labels: Record<string, readonly [string, string]> = {
  program: ["Program", "Program"], university: ["University", "Üniversite"], destination: ["Country / destination", "Ülke / destinasyon"], city: ["City", "Şehir"],
  draft: ["Draft", "Taslak"], published: ["Published", "Yayında"], archived: ["Archived", "Arşivlendi"], default: ["Default layout", "Varsayılan düzen"], absent: ["Not saved yet", "Henüz kaydedilmedi"],
  hero: ["Hero", "Üst bölüm"], navigation: ["Page navigation", "Bölüm gezinmesi"], overview: ["Overview", "Genel bakış"],
  requirements: ["Requirements", "Gereklilikler"], intakes: ["Intakes", "Başvuru dönemleri"], fees: ["Fees", "Ücretler"], related: ["Related programs", "İlgili programlar"],
  facts: ["Key facts", "Temel bilgiler"], programs: ["Programs", "Programlar"], universities: ["Universities", "Üniversiteler"], cities: ["Cities", "Şehirler"],
  cta: ["Next step", "Sonraki adım"], mobileActions: ["Mobile actions", "Mobil işlem düğmeleri"],
  "editorial-gallery": ["Image gallery", "Görsel galerisi"], "editorial-highlights": ["Highlights", "Öne çıkanlar"],
  "editorial-cautions": ["Things to consider", "Dikkat edilmesi gerekenler"], "editorial-curriculum": ["Curriculum", "Müfredat"],
  "editorial-education": ["Education", "Eğitim"], "editorial-admission": ["Admission information", "Kabul bilgileri"],
  "editorial-scholarships": ["Scholarships", "Burslar"], "editorial-living": ["Living costs", "Yaşam maliyetleri"],
  "editorial-campus": ["Campus", "Kampüs"], "editorial-housing": ["Housing", "Konaklama"],
  "editorial-services": ["Student services", "Öğrenci hizmetleri"], "editorial-recognition": ["Recognition and accreditation", "Tanınma ve akreditasyon"],
  "editorial-faq": ["Frequently asked questions", "Sıkça sorulan sorular"], "editorial-applyGuide": ["Application guide", "Başvuru rehberi"],
};

/** Module-local EN/TR copy follows the existing Pages authoring convention. */
export function detailTemplateLabel(key: string, lang: string): string {
  return labels[key]?.[lang === "tr" ? 1 : 0] ?? key;
}
