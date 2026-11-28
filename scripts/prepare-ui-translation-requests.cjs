const fs=require('node:fs'),path=require('node:path');
const dir=path.resolve(__dirname,'../artifacts/edcons/src/lib/i18n/translations');
const flat=(o,p='',r={})=>{for(const[k,v]of Object.entries(o))v&&typeof v==='object'?flat(v,p+k+'.',r):r[p+k]=v;return r;};
const en=flat(JSON.parse(fs.readFileSync(path.join(dir,'en.json'),'utf8'))),audit=require('../reports/ui-localization-audit.json'),migration=require('../reports/ui-localization-migration.json');
const artifactKeys=new Set(audit.artifacts.map(x=>x.file+':'+x.key));
const brand=/^(?:Find (?:And|and|&) Study(?: OS)?|OpenAI|Anthropic|Claude|Google Gemini|WhatsApp|Telegram|YouTube|Instagram|Facebook|LinkedIn|TikTok|Twitter|CWTS Leiden|Times Higher Education|TOEFL|IELTS|Duolingo|Zernio|SMTP|OAuth|PostgreSQL|WordPress|Vistara)$/i;
const tasks=[];for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.json'))){const lang=file.slice(0,-5),filePath=path.join(dir,file),dict=JSON.parse(fs.readFileSync(filePath,'utf8')),values=flat(dict),texts={};
// Reuse an existing translated exact UI phrase before requesting it again.
const known=new Map();for(const[key,value]of Object.entries(en))if(!key.startsWith('uiText.')&&values[key]&&values[key]!==value)known.set(value,values[key]);
for(const[key,value]of Object.entries(dict.uiText))if(lang!=='en'&&value===en['uiText.'+key]&&known.has(value)){dict.uiText[key]=known.get(value);values['uiText.'+key]=known.get(value);}
fs.writeFileSync(filePath,JSON.stringify(dict,null,2)+'\n');
for(const[key,value]of Object.entries(en)){
 if(!String(value).trim())continue;
 const missingEnglish=values[key]===value&&/[a-zA-Z]{3}/.test(value)&&!brand.test(value)&&!/^https?:|^mailto:|^tel:|^[A-Z0-9_ .:/-]+$|^\{\{?\w+\}?\}$/.test(value);
 const sourceTurkish=lang==='en'&&(key.startsWith('uiText.')||(/[çğıöşüÇĞİÖŞÜ]/.test(value)&&!/(?:Acıbadem|Türkiye|İstanbul|İzmir|Oʻzbekcha|Türkçe|Français|Português|Español)/.test(value)));
 // These legacy catalogues contain unrelated desktop-software/dictionary
 // translations (e.g. Students -> Finland). Review the complete catalogue,
 // not merely English leftovers, so key parity cannot hide semantic damage.
 const semanticRepair=['tk','ky','kk','uz','tg','ur'].includes(lang)&&/[\p{L}]{2}/u.test(value)&&!brand.test(value)&&!/^https?:|^mailto:|^tel:|^[A-Z0-9_ .:/-]+$/.test(value);
 if((lang!=='en'&&missingEnglish)||sourceTurkish||artifactKeys.has(file+':'+key)||semanticRepair)texts[key]=value;
}
tasks.push({lang,texts});}
fs.writeFileSync(path.resolve(__dirname,'../reports/ui-translation-requests.json'),JSON.stringify(tasks));
const publicKeys=Object.entries(migration.entries).filter(([,e])=>e.contexts.some(f=>f.startsWith('pages/public/')||f.startsWith('components/'))).map(([key])=>key);
fs.writeFileSync(path.resolve(__dirname,'../artifacts/edcons/scripts/public-ui-text-keys.json'),JSON.stringify(publicKeys));
console.log(JSON.stringify(tasks.map(t=>({lang:t.lang,count:Object.keys(t.texts).length}))));
