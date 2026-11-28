const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../artifacts/edcons/src');
const hardcoded = [], duplicates = [], artifacts = [], englishCopies = [];
const flatten = (o, p = '', out = {}) => { for (const [k,v] of Object.entries(o)) typeof v === 'object' && v ? flatten(v,p+k+'.',out) : out[p+k]=v; return out; };
const localeDir = path.join(root,'lib/i18n/translations');
const en = flatten(JSON.parse(fs.readFileSync(path.join(localeDir,'en.json'),'utf8')));
for (const file of fs.readdirSync(localeDir)) {
  if (!file.endsWith('.json')) continue;
  const source=fs.readFileSync(path.join(localeDir,file),'utf8');
  const tree=ts.parseJsonText(file,source);
  function keys(node,prefix='') {
    if (ts.isObjectLiteralExpression(node)) {
      const seen=new Set();
      for(const prop of node.properties) {
        const key=prop.name?.text;
        if(seen.has(key)) duplicates.push({file,key:prefix+key,line:tree.getLineAndCharacterOfPosition(prop.pos).line+1});
        seen.add(key); if(prop.initializer) keys(prop.initializer,prefix+key+'.');
      }
    } else ts.forEachChild(node,n=>keys(n,prefix));
  }
  keys(tree);
  const values=flatten(JSON.parse(source));
  for(const [key,value] of Object.entries(values)) {
    if(/@\s*(info|action|label|title)|QDialog|KDE|KMail|KOrganizer|BelizComment|Saytcolor|KFile|KAction|KWidget/i.test(value)) artifacts.push({file,key,value,english:en[key]});
    if(file!=='en.json' && value===en[key] && /[a-z]{3}\s+[a-z]{3}/i.test(value) && !/https?:|Find (And|&)|API|JSON|HTML|WhatsApp/.test(value)) englishCopies.push({file,key,value});
  }
}
function walk(dir) {for(const e of fs.readdirSync(dir,{withFileTypes:true})) {
  const file=path.join(dir,e.name); if(e.isDirectory()) {if(e.name!=='i18n') walk(file);continue;}
  if(!/\.tsx?$/.test(file)) continue;
  const source=fs.readFileSync(file,'utf8'); const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  const add=(node,text,kind)=>{text=text.replace(/\s+/g,' ').trim();if(!/\p{L}{2}/u.test(text))return; hardcoded.push({file:path.relative(root,file).replaceAll('\\','/'),line:tree.getLineAndCharacterOfPosition(node.getStart(tree)).line+1,text,kind});};
  function visit(node) {
    if(ts.isJsxText(node)) add(node,node.text,'jsx');
    if(ts.isJsxAttribute(node)&&['title','placeholder','aria-label','alt'].includes(node.name.text)&&node.initializer&&ts.isStringLiteral(node.initializer)) add(node.initializer,node.initializer.text,'attribute');
    if(ts.isCallExpression(node)&&node.expression.getText(tree)==='copy'&&node.arguments.length===2&&node.arguments.every(ts.isStringLiteral)) add(node,node.arguments[1].text,'bilingual-copy');
    ts.forEachChild(node,visit);
  } visit(tree);
}}
walk(root);
const result={summary:{sourceFiles:new Set(hardcoded.map(x=>x.file)).size,hardcoded:hardcoded.length,duplicateKeys:duplicates.length,translationArtifacts:artifacts.length,englishCopies:englishCopies.length},hardcoded,duplicates,artifacts,englishCopies};
fs.mkdirSync(path.resolve(__dirname,'../reports'),{recursive:true});fs.writeFileSync(path.resolve(__dirname,'../reports/ui-localization-audit.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result.summary));
console.log('Hardcoded by area:',JSON.stringify(Object.entries(hardcoded.reduce((a,x)=>(a[x.file]=(a[x.file]||0)+1,a),{})).sort((a,b)=>b[1]-a[1]).slice(0,18)));
console.log('Artifacts by locale:',JSON.stringify(artifacts.reduce((a,x)=>(a[x.file]=(a[x.file]||0)+1,a),{})));
