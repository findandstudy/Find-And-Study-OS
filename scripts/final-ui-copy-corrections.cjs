const fs=require('node:fs'),path=require('node:path');const root=path.resolve(__dirname,'../artifacts/edcons/src');
const applicationFile=path.join(root,'pages/staff/ApplicationDetail.tsx');fs.writeFileSync(applicationFile,fs.readFileSync(applicationFile,'utf8').replaceAll('toLocaleTimeString(lang,','toLocaleTimeString(uiLanguage,'));
for(const name of ['DetailVariableInsertPanel.tsx','DetailTemplates.tsx']){const file=path.join(root,'pages/admin/website',name);fs.writeFileSync(file,fs.readFileSync(file,'utf8').replaceAll('{{alan|','{{field|').replaceAll('{{değişken}}','{{variable}}'));}
