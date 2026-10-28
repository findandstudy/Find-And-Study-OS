const keys = [
  "section", "cityTitle", "campusTitle", "feels", "range", "humidity", "wind", "stale", "source",
  "thunderstorm", "drizzle", "rain", "snow", "mist", "clear", "fewClouds", "scatteredClouds",
  "brokenClouds", "overcastClouds", "cloudy",
] as const;

export type WeatherCopy = Record<(typeof keys)[number], string>;

const rows: Record<string, string[]> = {
  en: ["Weather", "Weather in the city", "Weather in the campus city", "Feels like", "Daily range", "Humidity", "Wind", "General outlook — latest data", "Data source", "Thunderstorm", "Drizzle", "Rain", "Snow", "Mist", "Clear sky", "Few clouds", "Scattered clouds", "Broken clouds", "Overcast clouds", "Cloudy"],
  tr: ["Hava", "Şehirde hava görünümü", "Kampüs şehrinde hava görünümü", "Hissedilen", "Günün aralığı", "Nem", "Rüzgâr", "Genel görünüm — son mevcut veri", "Veri kaynağı", "Gök gürültülü fırtına", "Çisenti", "Yağmur", "Kar", "Sis", "Açık hava", "Az bulutlu", "Parçalı bulutlu", "Çok bulutlu", "Kapalı", "Bulutlu"],
  ar: ["الطقس", "الطقس في المدينة", "الطقس في مدينة الحرم الجامعي", "المحسوسة", "نطاق اليوم", "الرطوبة", "الرياح", "نظرة عامة — أحدث البيانات المتاحة", "مصدر البيانات", "عاصفة رعدية", "رذاذ", "مطر", "ثلج", "ضباب", "سماء صافية", "غيوم قليلة", "غيوم متفرقة", "غيوم متكسرة", "غائم كلياً", "غائم"],
  fr: ["Météo", "Météo dans la ville", "Météo dans la ville du campus", "Ressenti", "Plage du jour", "Humidité", "Vent", "Aperçu général — dernières données disponibles", "Source des données", "Orage", "Bruine", "Pluie", "Neige", "Brume", "Ciel dégagé", "Quelques nuages", "Nuages épars", "Nuages fragmentés", "Ciel couvert", "Nuageux"],
  ru: ["Погода", "Погода в городе", "Погода в городе кампуса", "Ощущается как", "Диапазон за день", "Влажность", "Ветер", "Общий прогноз — последние доступные данные", "Источник данных", "Гроза", "Морось", "Дождь", "Снег", "Туман", "Ясно", "Небольшая облачность", "Рассеянные облака", "Облачно с прояснениями", "Пасмурно", "Облачно"],
  fa: ["آب‌وهوا", "آب‌وهوای شهر", "آب‌وهوای شهر محل پردیس", "دمای احساسی", "بازه دمای روز", "رطوبت", "باد", "نمای کلی — آخرین داده موجود", "منبع داده", "رعدوبرق", "نم‌نم باران", "باران", "برف", "مه", "آسمان صاف", "کمی ابری", "ابرهای پراکنده", "ابرهای شکسته", "کاملاً ابری", "ابری"],
  zh: ["天气", "城市天气", "校园所在城市天气", "体感温度", "今日温度范围", "湿度", "风速", "天气概况 — 最新可用数据", "数据来源", "雷暴", "毛毛雨", "雨", "雪", "雾", "晴朗", "少云", "疏云", "多云", "阴天", "多云"],
  hi: ["मौसम", "शहर का मौसम", "परिसर वाले शहर का मौसम", "महसूस तापमान", "आज का तापमान दायरा", "आर्द्रता", "हवा", "सामान्य स्थिति — नवीनतम उपलब्ध डेटा", "डेटा स्रोत", "आंधी-तूफान", "बूंदाबांदी", "बारिश", "बर्फ", "धुंध", "साफ़ आसमान", "हल्के बादल", "छिटपुट बादल", "घने बादल", "बादलों से ढका", "बादल"],
  es: ["Tiempo", "Tiempo en la ciudad", "Tiempo en la ciudad del campus", "Sensación térmica", "Rango del día", "Humedad", "Viento", "Panorama general — últimos datos disponibles", "Fuente de datos", "Tormenta", "Llovizna", "Lluvia", "Nieve", "Niebla", "Cielo despejado", "Pocas nubes", "Nubes dispersas", "Nubes fragmentadas", "Cielo cubierto", "Nublado"],
  id: ["Cuaca", "Cuaca di kota", "Cuaca di kota kampus", "Terasa seperti", "Rentang harian", "Kelembapan", "Angin", "Gambaran umum — data terbaru yang tersedia", "Sumber data", "Badai petir", "Gerimis", "Hujan", "Salju", "Kabut", "Langit cerah", "Sedikit berawan", "Awan tersebar", "Berawan tebal", "Mendung", "Berawan"],
  ur: ["موسم", "شہر کا موسم", "کیمپس والے شہر کا موسم", "محسوس درجہ حرارت", "آج کا درجہ حرارت", "نمی", "ہوا", "عمومی صورتِ حال — تازہ ترین دستیاب ڈیٹا", "ڈیٹا کا ذریعہ", "گرج چمک", "بوندا باندی", "بارش", "برف", "دھند", "صاف آسمان", "ہلکے بادل", "بکھرے بادل", "گھنے بادل", "ابر آلود", "بادل"],
  tk: ["Howa", "Şäherdäki howa", "Kampus şäherindäki howa", "Duýulýan temperatura", "Gündelik aralyk", "Çyglylyk", "Şemal", "Umumy ýagdaý — iň soňky elýeterli maglumat", "Maglumat çeşmesi", "Gök gürrüldili harasat", "Çisgin", "Ýagyş", "Gar", "Duman", "Açyk asman", "Az bulutly", "Bölekleýin bulutly", "Gaty bulutly", "Tutuş bulutly", "Bulutly"],
  ky: ["Аба ырайы", "Шаардагы аба ырайы", "Кампус шаарындагы аба ырайы", "Сезилген температура", "Күндүк аралык", "Нымдуулук", "Шамал", "Жалпы көрүнүш — акыркы жеткиликтүү маалымат", "Маалымат булагы", "Күн күркүрөгөн бороон", "Себелеген жамгыр", "Жамгыр", "Кар", "Туман", "Ачык асман", "Аз булуттуу", "Ала булуттуу", "Калың булуттуу", "Бүркөк", "Булуттуу"],
  kk: ["Ауа райы", "Қаладағы ауа райы", "Кампус қаласындағы ауа райы", "Сезілуі", "Күндік аралық", "Ылғалдылық", "Жел", "Жалпы көрініс — соңғы қолжетімді дерек", "Дерек көзі", "Найзағайлы дауыл", "Сіркіреме", "Жаңбыр", "Қар", "Тұман", "Ашық аспан", "Аз бұлтты", "Ала бұлтты", "Қалың бұлтты", "Тұтас бұлтты", "Бұлтты"],
  uz: ["Ob-havo", "Shahardagi ob-havo", "Kampus shahridagi ob-havo", "His qilinishi", "Kunlik oraliq", "Namlik", "Shamol", "Umumiy holat — so‘nggi mavjud ma’lumot", "Ma’lumot manbai", "Momaqaldiroq", "Mayda yomg‘ir", "Yomg‘ir", "Qor", "Tuman", "Ochiq osmon", "Kam bulutli", "Tarqoq bulutli", "Qalin bulutli", "Bulut bilan qoplangan", "Bulutli"],
  tg: ["Обу ҳаво", "Обу ҳавои шаҳр", "Обу ҳавои шаҳри кампус", "Ҳарорати эҳсосшаванда", "Фосилаи рӯзона", "Намӣ", "Шамол", "Намуди умумӣ — маълумоти охирини дастрас", "Манбаи маълумот", "Раъду барқ", "Боронча", "Борон", "Барф", "Туман", "Осмони соф", "Камабр", "Абрҳои пароканда", "Абри зиёд", "Осмони пурра абрнок", "Абрнок"],
  bn: ["আবহাওয়া", "শহরের আবহাওয়া", "ক্যাম্পাস শহরের আবহাওয়া", "অনুভূত তাপমাত্রা", "দিনের তাপমাত্রার পরিসর", "আর্দ্রতা", "বাতাস", "সার্বিক অবস্থা — সর্বশেষ উপলভ্য তথ্য", "তথ্যের উৎস", "বজ্রঝড়", "গুঁড়ি গুঁড়ি বৃষ্টি", "বৃষ্টি", "তুষার", "কুয়াশা", "পরিষ্কার আকাশ", "সামান্য মেঘ", "বিক্ষিপ্ত মেঘ", "ঘন মেঘ", "মেঘাচ্ছন্ন", "মেঘলা"],
  pt: ["Tempo", "Tempo na cidade", "Tempo na cidade do campus", "Sensação térmica", "Variação do dia", "Humidade", "Vento", "Panorama geral — dados mais recentes disponíveis", "Fonte dos dados", "Trovoada", "Chuvisco", "Chuva", "Neve", "Nevoeiro", "Céu limpo", "Poucas nuvens", "Nuvens dispersas", "Nuvens fragmentadas", "Céu encoberto", "Nublado"],
  ne: ["मौसम", "सहरको मौसम", "क्याम्पस सहरको मौसम", "महसुस हुने तापक्रम", "दैनिक तापक्रम दायरा", "आर्द्रता", "हावा", "सामान्य अवस्था — पछिल्लो उपलब्ध डेटा", "डेटा स्रोत", "चट्याङसहित आँधी", "सिमसिमे पानी", "वर्षा", "हिउँ", "कुहिरो", "खुला आकाश", "थोरै बादल", "छरिएका बादल", "बाक्ला बादल", "बादलले ढाकिएको", "बादलयुक्त"],
  vi: ["Thời tiết", "Thời tiết trong thành phố", "Thời tiết tại thành phố có cơ sở", "Cảm giác như", "Khoảng nhiệt độ trong ngày", "Độ ẩm", "Gió", "Tổng quan — dữ liệu mới nhất hiện có", "Nguồn dữ liệu", "Dông", "Mưa phùn", "Mưa", "Tuyết", "Sương mù", "Trời quang", "Ít mây", "Mây rải rác", "Nhiều mây", "U ám", "Có mây"],
  ko: ["날씨", "도시 날씨", "캠퍼스 소재 도시 날씨", "체감 온도", "일일 기온 범위", "습도", "바람", "전반적인 날씨 — 최신 가용 데이터", "데이터 출처", "뇌우", "이슬비", "비", "눈", "안개", "맑음", "구름 조금", "구름 약간", "구름 많음", "흐림", "구름"],
  uk: ["Погода", "Погода в місті", "Погода в місті кампусу", "Відчувається як", "Діапазон за день", "Вологість", "Вітер", "Загальний прогноз — останні доступні дані", "Джерело даних", "Гроза", "Мряка", "Дощ", "Сніг", "Туман", "Ясно", "Невелика хмарність", "Розсіяні хмари", "Хмарно з проясненнями", "Похмуро", "Хмарно"],
  it: ["Meteo", "Meteo in città", "Meteo nella città del campus", "Percepita", "Intervallo giornaliero", "Umidità", "Vento", "Panoramica generale — ultimi dati disponibili", "Fonte dei dati", "Temporale", "Pioviggine", "Pioggia", "Neve", "Nebbia", "Cielo sereno", "Poche nuvole", "Nubi sparse", "Nubi irregolari", "Cielo coperto", "Nuvoloso"],
};

const copies: Record<string, WeatherCopy> = Object.fromEntries(Object.entries(rows).map(([locale, values]) => {
  if (values.length !== keys.length || values.some(value => !value)) throw new Error(`Incomplete weather locale: ${locale}`);
  return [locale, Object.fromEntries(keys.map((key, index) => [key, values[index]])) as WeatherCopy];
}));

export function weatherCopy(locale: string): WeatherCopy {
  return copies[locale] || copies.en;
}

export function localizedWeatherDescription(conditionCode: number, conditionGroup: string, locale: string): string {
  const copy = weatherCopy(locale);
  if (conditionCode >= 200 && conditionCode < 300) return copy.thunderstorm;
  if (conditionCode >= 300 && conditionCode < 400) return copy.drizzle;
  if (conditionCode >= 500 && conditionCode < 600) return copy.rain;
  if (conditionCode >= 600 && conditionCode < 700) return copy.snow;
  if (conditionCode >= 700 && conditionCode < 800) return copy.mist;
  if (conditionCode === 800) return copy.clear;
  if (conditionCode === 801) return copy.fewClouds;
  if (conditionCode === 802) return copy.scatteredClouds;
  if (conditionCode === 803) return copy.brokenClouds;
  if (conditionCode === 804) return copy.overcastClouds;
  const normalized = conditionGroup.trim().toLowerCase();
  if (normalized === "clear") return copy.clear;
  if (normalized === "clouds") return copy.cloudy;
  if (normalized === "rain") return copy.rain;
  if (normalized === "snow") return copy.snow;
  if (normalized === "drizzle") return copy.drizzle;
  if (normalized === "thunderstorm") return copy.thunderstorm;
  return copy.cloudy;
}
