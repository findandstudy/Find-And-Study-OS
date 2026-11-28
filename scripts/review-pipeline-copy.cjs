const fs = require('node:fs');
const path = require('node:path');
const {execFileSync}=require('node:child_process');
const root = path.resolve(__dirname, '../artifacts/edcons/src/lib/i18n/translations');
const keys = 'view|noContact|messages|dropHere|filters|addRecord|addStage|save|assignee|none|stage|retry|more|newStage|inbox|importExcel|followups|historyText|addFollowup|followupTitle|assignedTo|notesOptional|overdue|editFollowup|noNotesYet|newNoteText|addNote|followupUpdated|recordUpdated|noScheduledFollowups|upcomingAndOverdueFollowups|recentNotes|pipelineFollowupsAndNotes|pipelineInformation|processing|importCompleted'.split('|');
const fixes = {
 uz: 'Ko‘rish|Aloqa ma’lumotlari yo‘q|Xabarlar|Shu yerga tashlang|Filtrlar|Yozuv qo‘shish|Bosqich qo‘shish|Saqlash|Mas’ul shaxs|Biriktirilmagan|Bosqich|Qayta urinish|Ko‘proq yuklash|Yangi bosqich|Suhbatni ochish|Exceldan import qilish|Kuzatuvlar|Tarix|Kuzatuv qo‘shish|Kuzatuv sarlavhasi|Mas’ul shaxs|Izohlar (ixtiyoriy)| · Muddati o‘tgan|Kuzatuvni tahrirlash|Hali izohlar yo‘q.|Yangi izoh|Izoh qo‘shish|Kuzatuv yangilandi|Yozuv yangilandi|Rejalashtirilgan kuzatuvlar yo‘q.|Yaqinlashayotgan va muddati o‘tgan kuzatuvlar|So‘nggi izohlar|Ish jarayoni kuzatuvlari va izohlari|Ish jarayoni ma’lumotlari|Qayta ishlanmoqda…|Import tugallandi.',
 tk: 'Görmek|Aragatnaşyk maglumaty ýok|Habarlar|Şu ýere goýberiň|Süzgüçler|Ýazgy goşmak|Tapgyr goşmak|Ýatda saklamak|Jogapkär|Bellenmedik|Tapgyr|Gaýtadan synanyşmak|Has köp ýüklemek|Täze tapgyr|Söhbeti açmak|Excel-den import etmek|Gözegçilikler|Taryh|Gözegçilik goşmak|Gözegçiligiň ady|Jogapkär|Bellikler (hökmany däl)| · Möhleti geçen|Gözegçiligi üýtgetmek|Entek bellik ýok.|Täze bellik|Bellik goşmak|Gözegçilik täzelendi|Ýazgy täzelendi|Meýilleşdirilen gözegçilik ýok.|Ýakynlaşýan we möhleti geçen gözegçilikler|Soňky bellikler|Iş akymynyň gözegçilikleri we bellikleri|Iş akymy barada maglumat|Işlenilýär…|Import tamamlandy.',
 ky: 'Көрүү|Байланыш маалыматы жок|Билдирүүлөр|Бул жерге таштаңыз|Чыпкалар|Жазуу кошуу|Этап кошуу|Сактоо|Жооптуу адам|Дайындалган эмес|Этап|Кайра аракет кылуу|Дагы жүктөө|Жаңы этап|Сүйлөшүүнү ачуу|Excelден импорттоо|Көзөмөлдөр|Тарых|Көзөмөл кошуу|Көзөмөлдүн аталышы|Жооптуу адам|Эскертүүлөр (милдеттүү эмес)| · Мөөнөтү өткөн|Көзөмөлдү түзөтүү|Азырынча эскертүүлөр жок.|Жаңы эскертүү|Эскертүү кошуу|Көзөмөл жаңыртылды|Жазуу жаңыртылды|Пландалган көзөмөлдөр жок.|Жакында боло турган жана мөөнөтү өткөн көзөмөлдөр|Акыркы эскертүүлөр|Иш агымынын көзөмөлдөрү жана эскертүүлөрү|Иш агымы жөнүндө маалымат|Иштетилүүдө…|Импорт аяктады.',
 kk: 'Қарау|Байланыс ақпараты жоқ|Хабарламалар|Осы жерге тастаңыз|Сүзгілер|Жазба қосу|Кезең қосу|Сақтау|Жауапты адам|Тағайындалмаған|Кезең|Қайталау|Тағы жүктеу|Жаңа кезең|Әңгімені ашу|Excelден импорттау|Бақылаулар|Тарих|Бақылау қосу|Бақылау атауы|Жауапты адам|Ескертпелер (міндетті емес)| · Мерзімі өткен|Бақылауды өңдеу|Әзірге ескертпелер жоқ.|Жаңа ескертпе|Ескертпе қосу|Бақылау жаңартылды|Жазба жаңартылды|Жоспарланған бақылаулар жоқ.|Алдағы және мерзімі өткен бақылаулар|Соңғы ескертпелер|Жұмыс ағынының бақылаулары мен ескертпелері|Жұмыс ағыны туралы ақпарат|Өңделуде…|Импорт аяқталды.',
 tg: 'Дидан|Маълумоти тамос нест|Паёмҳо|Ба ин ҷо гузоред|Филтрҳо|Иловаи сабт|Иловаи марҳила|Захира кардан|Шахси масъул|Таъин нашудааст|Марҳила|Кӯшиши дубора|Бештар бор кардан|Марҳилаи нав|Кушодани суҳбат|Воридот аз Excel|Пайгириҳо|Таърих|Иловаи пайгирӣ|Унвони пайгирӣ|Шахси масъул|Эзоҳҳо (ихтиёрӣ)| · Муҳлат гузаштааст|Таҳрири пайгирӣ|Ҳанӯз эзоҳҳо нестанд.|Эзоҳи нав|Иловаи эзоҳ|Пайгирӣ нав карда шуд|Сабт нав карда шуд|Пайгириҳои банақшагирифташуда нестанд.|Пайгириҳои наздик ва муҳлатгузашта|Эзоҳҳои охирин|Пайгириҳо ва эзоҳҳои раванди кор|Маълумоти раванди кор|Коркард мешавад…|Воридот анҷом ёфт.',
 ur: 'دیکھیں|رابطے کی معلومات نہیں|پیغامات|یہاں چھوڑیں|فلٹرز|ریکارڈ شامل کریں|مرحلہ شامل کریں|محفوظ کریں|ذمہ دار فرد|غیر تفویض شدہ|مرحلہ|دوبارہ کوشش کریں|مزید لوڈ کریں|نیا مرحلہ|گفتگو کھولیں|Excel درآمد کریں|فالو اپس|تاریخچہ|فالو اپ شامل کریں|فالو اپ کا عنوان|ذمہ دار فرد|نوٹس (اختیاری)| · مقررہ وقت گزر چکا|فالو اپ میں ترمیم کریں|ابھی کوئی نوٹس نہیں۔|نیا نوٹ|نوٹ شامل کریں|فالو اپ اپ ڈیٹ ہو گیا|ریکارڈ اپ ڈیٹ ہو گیا|کوئی فالو اپ طے نہیں کیا گیا۔|آنے والے اور تاخیر شدہ فالو اپس|حالیہ نوٹس|پائپ لائن کے فالو اپس اور نوٹس|پائپ لائن کی معلومات|کارروائی جاری ہے…|درآمد مکمل ہو گئی۔',
};
const notes = {en:'Notes',tr:'Notlar',ar:'الملاحظات',fr:'Notes',ru:'Заметки',fa:'یادداشت‌ها',zh:'备注',hi:'नोट्स',es:'Notas',id:'Catatan',ur:'نوٹس',tk:'Bellikler',ky:'Эскертүүлөр',kk:'Ескертпелер',uz:'Izohlar',tg:'Эзоҳҳо',bn:'নোট',pt:'Notas',ne:'टिप्पणीहरू',vi:'Ghi chú',ko:'메모',uk:'Нотатки',it:'Note'};
const extra={
 pt:{assignee:'Responsável',assignedTo:'Responsável'},vi:{assignee:'Người phụ trách',assignedTo:'Người phụ trách'},uk:{assignee:'Відповідальний',assignedTo:'Відповідальний'},ko:{stage:'단계',source:'출처'},
};
for(const [lang,note] of Object.entries(notes)){
 const file=path.join(root,lang+'.json');const json=JSON.parse(fs.readFileSync(file,'utf8'));
 if(fixes[lang]){const values=fixes[lang].split('|');if(values.length!==keys.length)throw Error(lang+' key count');keys.forEach((key,i)=>json.workPipelines[key]=values[i]);}
 json.workPipelines.notes=note;
 Object.assign(json.workPipelines,extra[lang]||{});
 // Preserve every byte outside this namespace, including legacy duplicate keys.
 // Parsing/stringifying the whole legacy dictionary can change unrelated copy.
 const original=execFileSync('git',['show','HEAD:artifacts/edcons/src/lib/i18n/translations/'+lang+'.json'],{encoding:'utf8',maxBuffer:4*1024*1024});
 const marker=original.lastIndexOf('"workPipelines":');
 const start=original.indexOf('{',marker);let depth=0,quoted=false,escaped=false,end=-1;
 for(let i=start;i<original.length;i++){const c=original[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}else if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){end=i+1;break;}}
 if(marker<0||end<0)throw Error('Namespace boundary missing: '+lang);
 fs.writeFileSync(file,original.slice(0,start)+JSON.stringify(json.workPipelines,null,2).replace(/\n/g,'\n  ')+original.slice(end));
}
console.log('Reviewed pipeline-specific copy in 23 locale dictionaries; shared CRM copy unchanged.');
