const fs=require('node:fs'),path=require('node:path');const root=path.resolve(__dirname,'../artifacts/edcons/src/lib/i18n/translations');
const en=JSON.parse(fs.readFileSync(path.join(root,'en.json'),'utf8'));const empty=Object.entries(en.uiText).filter(([,v])=>!v.trim()).map(([k])=>k);
for(const f of fs.readdirSync(root).filter(f=>f.endsWith('.json'))){const p=path.join(root,f),d=JSON.parse(fs.readFileSync(p,'utf8'));for(const k of empty)delete d.uiText[k];fs.writeFileSync(p,JSON.stringify(d,null,2)+'\n');}
const reportPath=path.resolve(__dirname,'../reports/ui-localization-migration.json'),report=JSON.parse(fs.readFileSync(reportPath,'utf8'));for(const k of empty)delete report.entries[k];fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
const publicKeysPath=path.resolve(__dirname,'../artifacts/edcons/scripts/public-ui-text-keys.json');const keys=JSON.parse(fs.readFileSync(publicKeysPath,'utf8')).filter(k=>!empty.includes(k));fs.writeFileSync(publicKeysPath,JSON.stringify(keys));
console.log({emptyKeysRemoved:empty});
