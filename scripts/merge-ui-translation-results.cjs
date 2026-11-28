const fs=require('node:fs'),path=require('node:path');
const input=path.resolve(process.argv[2]||''),dir=path.resolve(__dirname,'../artifacts/edcons/src/lib/i18n/translations');
if(!process.argv[2]||!fs.statSync(input).isDirectory())throw Error('Pass the isolated translation result directory');
const result={};for(const file of fs.readdirSync(input).filter(f=>/^[a-z]{2}-.+\.json$/.test(f)).sort((a,b)=>Number(!a.includes('-seed.'))-Number(!b.includes('-seed.'))||a.localeCompare(b))){const lang=file.slice(0,2);Object.assign(result[lang]??={},JSON.parse(fs.readFileSync(path.join(input,file),'utf8')));}
const tokens=s=>[...s.matchAll(/\{\{[^{}]+\}\}|\{[A-Za-z0-9_]+\}|%s/g)].map(([t])=>t.startsWith('{{')?'{{'+t.slice(2,-2).split('|')[0]+'}}':t).sort().join('|');
const prepared=[];const counts={};
for(const[lang,values]of Object.entries(result)){const file=path.join(dir,lang+'.json');if(!fs.existsSync(file))throw Error('Unknown locale');const dictionary=JSON.parse(fs.readFileSync(file,'utf8'));let changed=0;
 for(const[key,translated]of Object.entries(values)){if(typeof translated!=='string'||!translated.trim())throw Error(`Empty translation ${lang}:${key}`);const parts=key.split('.'),leaf=parts.pop();let node=dictionary;for(const p of parts){if(!Object.hasOwn(node,p)||!node[p]||typeof node[p]!=='object')throw Error(`Unknown namespace ${lang}:${key}`);node=node[p];}if(!Object.hasOwn(node,leaf)||typeof node[leaf]!=='string')throw Error(`Unknown key ${lang}:${key}`);
 const source=node[leaf];if(tokens(source)!==tokens(translated))throw Error(`Placeholder drift ${lang}:${key}`);
 const lead=source.match(/^\s*/)[0],tail=source.match(/\s*$/)[0];const value=lead+translated.trim()+tail;
 if(source!==value){node[leaf]=value;changed++;}
 }
 prepared.push([file,JSON.stringify(dictionary,null,2)+'\n']);counts[lang]={reviewed:Object.keys(values).length,changed};
}
// Validate the entire set before replacing any catalogue.
for(const[file,value]of prepared)fs.writeFileSync(file,value);
fs.mkdirSync(path.resolve(__dirname,'../reports'),{recursive:true});
fs.writeFileSync(path.resolve(__dirname,'../reports/ui-localization-repair-counts.json'),JSON.stringify(counts,null,2)+'\n');
console.log(JSON.stringify(counts));
