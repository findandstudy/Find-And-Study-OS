import { ArrowUpRight, Languages, Sparkles } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import type { HTMLAttributes } from "react";

type BannerCopy = {
  eyebrow: string;
  title: string;
  body: string;
  free: string;
  open: string;
};

const copyByLocale: Record<string, BannerCopy> = {
  en: { eyebrow: "Free language learning", title: "Build your language skills for free", body: "Prepare for study and everyday life with self-paced courses in seven languages. Choose a course and start learning at no cost.", free: "7 languages · Free access", open: "Open" },
  tr: { eyebrow: "Ücretsiz dil eğitimi", title: "Dil becerilerinizi ücretsiz geliştirin", body: "Yedi dilde, kendi hızınızda ilerleyebileceğiniz kurslarla eğitime ve günlük yaşama hazırlanın. Kursunuzu seçin ve ücretsiz öğrenmeye başlayın.", free: "7 dil · Ücretsiz erişim", open: "Aç" },
  ar: { eyebrow: "تعلم اللغات مجانًا", title: "طوّر مهاراتك اللغوية مجانًا", body: "استعد للدراسة والحياة اليومية بدورات ذاتية الوتيرة بسبع لغات. اختر دورتك وابدأ التعلم دون تكلفة.", free: "7 لغات · وصول مجاني", open: "افتح" },
  fr: { eyebrow: "Apprentissage gratuit des langues", title: "Développez gratuitement vos compétences linguistiques", body: "Préparez vos études et votre vie quotidienne avec des cours à votre rythme dans sept langues. Choisissez un cours et commencez gratuitement.", free: "7 langues · Accès gratuit", open: "Ouvrir" },
  ru: { eyebrow: "Бесплатное изучение языков", title: "Развивайте языковые навыки бесплатно", body: "Подготовьтесь к учёбе и повседневной жизни с курсами в собственном темпе на семи языках. Выберите курс и начните бесплатно.", free: "7 языков · Бесплатный доступ", open: "Открыть" },
  fa: { eyebrow: "آموزش رایگان زبان", title: "مهارت‌های زبانی خود را رایگان تقویت کنید", body: "با دوره‌های خودآموز در هفت زبان برای تحصیل و زندگی روزمره آماده شوید. دوره خود را انتخاب کنید و رایگان شروع کنید.", free: "۷ زبان · دسترسی رایگان", open: "باز کردن" },
  zh: { eyebrow: "免费语言学习", title: "免费提升您的语言能力", body: "通过七种语言的自主进度课程，为学习和日常生活做好准备。选择课程并免费开始学习。", free: "7 种语言 · 免费使用", open: "打开" },
  hi: { eyebrow: "निःशुल्क भाषा सीखना", title: "अपनी भाषा क्षमता निःशुल्क बढ़ाएँ", body: "सात भाषाओं में अपनी गति से चलने वाले पाठ्यक्रमों के साथ पढ़ाई और दैनिक जीवन की तैयारी करें। पाठ्यक्रम चुनें और निःशुल्क शुरू करें।", free: "7 भाषाएँ · निःशुल्क पहुँच", open: "खोलें" },
  es: { eyebrow: "Aprendizaje gratuito de idiomas", title: "Mejora gratis tus habilidades lingüísticas", body: "Prepárate para estudiar y para la vida diaria con cursos a tu ritmo en siete idiomas. Elige un curso y empieza sin coste.", free: "7 idiomas · Acceso gratuito", open: "Abrir" },
  id: { eyebrow: "Belajar bahasa gratis", title: "Tingkatkan kemampuan bahasa Anda secara gratis", body: "Persiapkan studi dan kehidupan sehari-hari dengan kursus mandiri dalam tujuh bahasa. Pilih kursus dan mulai belajar tanpa biaya.", free: "7 bahasa · Akses gratis", open: "Buka" },
  ur: { eyebrow: "مفت زبان کی تعلیم", title: "اپنی زبان کی مہارت مفت بہتر بنائیں", body: "سات زبانوں میں اپنی رفتار سے کورسز کے ساتھ تعلیم اور روزمرہ زندگی کی تیاری کریں۔ کورس منتخب کریں اور مفت سیکھنا شروع کریں۔", free: "7 زبانیں · مفت رسائی", open: "کھولیں" },
  tk: { eyebrow: "Mugt dil öwrenmek", title: "Dil başarnyklaryňyzy mugt ösdürüň", body: "Ýedi dilde öz depginiňizde geçilýän kurslar bilen okuwa we gündelik durmuşa taýýarlanyň. Kurs saýlap, mugt başlaň.", free: "7 dil · Mugt giriş", open: "Aç" },
  ky: { eyebrow: "Акысыз тил үйрөнүү", title: "Тил көндүмдөрүңүздү акысыз өнүктүрүңүз", body: "Жети тилдеги өз темпиңиз менен өтүүчү курстар аркылуу окууга жана күнүмдүк жашоого даярданыңыз. Курсту тандап, акысыз баштаңыз.", free: "7 тил · Акысыз жеткиликтүүлүк", open: "Ачуу" },
  kk: { eyebrow: "Тілді тегін үйрену", title: "Тіл дағдыларыңызды тегін жетілдіріңіз", body: "Жеті тілдегі өз қарқыныңызбен өтетін курстар арқылы оқуға және күнделікті өмірге дайындалыңыз. Курсты таңдап, тегін бастаңыз.", free: "7 тіл · Тегін қолжетімділік", open: "Ашу" },
  uz: { eyebrow: "Bepul til o‘rganish", title: "Til ko‘nikmalaringizni bepul rivojlantiring", body: "Yetti tildagi mustaqil sur’atda o‘tiladigan kurslar bilan o‘qish va kundalik hayotga tayyorlaning. Kursni tanlang va bepul boshlang.", free: "7 til · Bepul kirish", open: "Ochish" },
  tg: { eyebrow: "Омӯзиши ройгони забон", title: "Малакаҳои забонии худро ройгон такмил диҳед", body: "Бо курсҳои мустақилона дар ҳафт забон барои таҳсил ва зиндагии ҳаррӯза омода шавед. Курсро интихоб карда, ройгон оғоз намоед.", free: "7 забон · Дастрасии ройгон", open: "Кушодан" },
  bn: { eyebrow: "বিনামূল্যে ভাষা শিক্ষা", title: "বিনামূল্যে আপনার ভাষা দক্ষতা বাড়ান", body: "সাতটি ভাষায় নিজের গতিতে শেখার কোর্সের মাধ্যমে পড়াশোনা ও দৈনন্দিন জীবনের প্রস্তুতি নিন। কোর্স বেছে নিয়ে বিনামূল্যে শুরু করুন।", free: "৭টি ভাষা · বিনামূল্যে প্রবেশাধিকার", open: "খুলুন" },
  pt: { eyebrow: "Aprendizagem gratuita de idiomas", title: "Desenvolva gratuitamente as suas competências linguísticas", body: "Prepare-se para os estudos e para a vida quotidiana com cursos ao seu ritmo em sete idiomas. Escolha um curso e comece gratuitamente.", free: "7 idiomas · Acesso gratuito", open: "Abrir" },
  ne: { eyebrow: "निःशुल्क भाषा सिकाइ", title: "आफ्नो भाषा सीप निःशुल्क सुधार्नुहोस्", body: "सात भाषामा आफ्नै गतिमा सिक्न सकिने पाठ्यक्रमबाट अध्ययन र दैनिक जीवनको तयारी गर्नुहोस्। पाठ्यक्रम छान्नुहोस् र निःशुल्क सुरु गर्नुहोस्।", free: "७ भाषा · निःशुल्क पहुँच", open: "खोल्नुहोस्" },
  vi: { eyebrow: "Học ngôn ngữ miễn phí", title: "Phát triển kỹ năng ngôn ngữ hoàn toàn miễn phí", body: "Chuẩn bị cho việc học và cuộc sống hằng ngày với các khóa tự học bằng bảy ngôn ngữ. Chọn khóa học và bắt đầu miễn phí.", free: "7 ngôn ngữ · Truy cập miễn phí", open: "Mở" },
  ko: { eyebrow: "무료 언어 학습", title: "언어 능력을 무료로 키워 보세요", body: "7개 언어로 제공되는 자기 주도형 강좌를 통해 학업과 일상생활을 준비하세요. 강좌를 선택하고 무료로 시작할 수 있습니다.", free: "7개 언어 · 무료 이용", open: "열기" },
  uk: { eyebrow: "Безкоштовне вивчення мов", title: "Розвивайте мовні навички безкоштовно", body: "Підготуйтеся до навчання та повсякденного життя за допомогою курсів у власному темпі сімома мовами. Оберіть курс і почніть безкоштовно.", free: "7 мов · Безкоштовний доступ", open: "Відкрити" },
  it: { eyebrow: "Apprendimento gratuito delle lingue", title: "Sviluppa gratuitamente le tue competenze linguistiche", body: "Preparati allo studio e alla vita quotidiana con corsi autonomi in sette lingue. Scegli un corso e inizia gratuitamente.", free: "7 lingue · Accesso gratuito", open: "Apri" },
};

const courses = [
  { name: "Free English Course", image: "free-english-course.png", href: "https://freeenglishcourse.org/" },
  { name: "Free Turkish Course", image: "free-turkish-course.png", href: "https://freeturkishcourse.com/" },
  { name: "Free Spanish Course", image: "free-spanish-course.png", href: "https://freespanishcourse.com/" },
  { name: "Free German Course", image: "free-german-course.png", href: "https://freegermancourse.com/" },
  { name: "Free French Course", image: "free-french-course.png", href: "https://freefrenchcourse.com/" },
  { name: "Free Russian Course", image: "free-russian-course.png", href: "https://freerussiancourse.com/" },
  { name: "Free Chinese Course", image: "free-chinese-course.png", href: "https://freechinesecourse.com/" },
] as const;

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

/** Keeps the chapter-navigation label in sync with the banner locale copy. */
export function languageCourseNavigationLabel(locale: string) {
  return (copyByLocale[locale] ?? copyByLocale.en).eyebrow;
}

/** Shared service banner for every public destination, city, university and programme detail page. */
export function LanguageCourseBanner({ className = "", ...sectionProps }: HTMLAttributes<HTMLElement>) {
  const { lang } = useI18n();
  const copy = copyByLocale[lang] ?? copyByLocale.en;

  return <section {...sectionProps} data-detail-section="languageCourses" id="language-courses" className={`detail-section detail-language-courses ${className}`.trim()} aria-labelledby="language-courses-title">
    <div className="detail-wrap">
      <div className="detail-language-banner">
        <div className="detail-language-copy">
          <div className="detail-language-brand" aria-hidden="true">
            <img src={`${BASE_URL}/images/language-courses/free-language-course.png`} alt="" width="180" height="72" loading="lazy" decoding="async" />
          </div>
          <p className="detail-eyebrow detail-icon-line"><Sparkles size={16} aria-hidden="true" />{copy.eyebrow}</p>
          <h2 id="language-courses-title">{copy.title}</h2>
          <p>{copy.body}</p>
          <span className="detail-language-free"><Languages size={17} aria-hidden="true" />{copy.free}</span>
        </div>
        <div className="detail-language-course-list" role="list" aria-label={copy.title}>
          {courses.map(course => <a key={course.href} role="listitem" href={course.href} target="_blank" rel="noopener noreferrer" aria-label={`${copy.open}: ${course.name}`}>
            <img src={`${BASE_URL}/images/language-courses/${course.image}`} alt={course.name} width="160" height="80" loading="lazy" decoding="async" />
            <ArrowUpRight size={16} aria-hidden="true" />
          </a>)}
        </div>
      </div>
    </div>
  </section>;
}
