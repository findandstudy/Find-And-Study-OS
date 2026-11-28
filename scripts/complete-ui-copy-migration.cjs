const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'../artifacts/edcons/src'),reportFile=path.resolve(__dirname,'../reports/ui-localization-migration.json'),report=JSON.parse(fs.readFileSync(reportFile,'utf8'));
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return's'+(h>>>0).toString(16);}
function register(en,tr,context){const k=hash(en);report.entries[k]??={en,contexts:[]};if(report.entries[k].en!==en)throw Error('Collision');if(tr)report.entries[k].tr=tr;if(!report.entries[k].contexts.includes(context))report.entries[k].contexts.push(context);}
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory()){if(e.name!=='i18n')walk(file);continue;}if(!/\.tsx?$/.test(file)||file.endsWith('ui-localization.tsx'))continue;
 const source=fs.readFileSync(file,'utf8'),tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS),edits=[],helpers=[];let needed=false;const context=path.relative(root,file).replaceAll('\\','/');
 function visit(n){
  if(ts.isVariableDeclaration(n)&&n.name.getText(tree)==='copy'&&n.initializer&&ts.isArrowFunction(n.initializer)){
   const fn=n.initializer,params=fn.parameters.map(p=>p.name.getText(tree));let b=fn.body;while(ts.isParenthesizedExpression(b))b=b.expression;
   if(params.length===2){const trIndex=params.findIndex(p=>/^tr$|turkish|turk|^trText$/i.test(p));helpers.push({tr:trIndex>=0?trIndex:1,en:trIndex===0?1:0});}
   if(ts.isConditionalExpression(b)){const yes=params.indexOf(b.whenTrue.getText(tree)),no=params.indexOf(b.whenFalse.getText(tree));if(yes>=0&&no>=0&&yes!==no&&(/lang\s*===\s*["']tr["']/.test(b.condition.getText(tree))||b.condition.getText(tree)==='tr')){edits.push({start:b.getStart(tree),end:b.end,text:`translateUi(lang, ${params[no]}, ${params[yes]})`});needed=true;}}
  }
  if(ts.isConditionalExpression(n)&&ts.isStringLiteral(n.whenTrue)&&ts.isStringLiteral(n.whenFalse)&&/^(?:lang|language)\s*===\s*["']tr["']$/.test(n.condition.getText(tree))){const lang=n.condition.left.getText(tree),en=n.whenFalse.text,tr=n.whenTrue.text;register(en,tr,context);edits.push({start:n.getStart(tree),end:n.end,text:`translateUi(${lang}, ${JSON.stringify(en)}, ${JSON.stringify(tr)})`});needed=true;}
  ts.forEachChild(n,visit);
 }visit(tree);
 function calls(n){if(ts.isCallExpression(n)&&n.expression.getText(tree)==='copy'&&n.arguments.length>=1&&ts.isStringLiteral(n.arguments[0])){const order=helpers[0]||{en:0,tr:1};if(n.arguments[order.en]&&ts.isStringLiteral(n.arguments[order.en]))register(n.arguments[order.en].text,n.arguments[order.tr]&&ts.isStringLiteral(n.arguments[order.tr])?n.arguments[order.tr].text:undefined,context);}ts.forEachChild(n,calls);}calls(tree);
 // The existing page editor dictionary is UI metadata, not page content.
 if(file.endsWith('pageEditorCopy.ts')){for(const stmt of tree.statements){if(ts.isVariableStatement(stmt))for(const decl of stmt.declarationList.declarations){if(decl.name.getText(tree)==='TURKISH'&&decl.initializer&&ts.isObjectLiteralExpression(decl.initializer))for(const p of decl.initializer.properties)if(ts.isPropertyAssignment(p)&&ts.isStringLiteral(p.initializer))register(p.name.text,p.initializer.text,context);}}
  const old='return lang === "tr" ? turkish ?? TURKISH[english] ?? english : english;';if(source.includes(old)){edits.push({start:source.indexOf(old),end:source.indexOf(old)+old.length,text:'return translateUi(lang, english, turkish ?? TURKISH[english]);'});needed=true;}}
 if(!edits.length)continue;let next=source;for(const edit of edits.sort((a,b)=>b.start-a.start))next=next.slice(0,edit.start)+edit.text+next.slice(edit.end);if(needed&&!source.includes('import { translateUi'))next='import { translateUi } from "@/lib/ui-localization";\n'+next;fs.writeFileSync(file,next);
}}
walk(root);
const dir=path.join(root,'lib/i18n/translations');const flatten=(o,p='',r={})=>{for(const[k,v]of Object.entries(o))v&&typeof v==='object'?flatten(v,p+k+'.',r):r[p+k]=v;return r;};const en=JSON.parse(fs.readFileSync(path.join(dir,'en.json'),'utf8')),keysByText=new Map(Object.entries(flatten(en)).filter(([k])=>!k.startsWith('uiText.')).map(([k,v])=>[v,k]));
for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.json'))){const lang=file.slice(0,-5),f=path.join(dir,file),dict=JSON.parse(fs.readFileSync(f,'utf8')),values=flatten(dict);for(const[k,e]of Object.entries(report.entries)){const existing=keysByText.get(e.en);dict.uiText[k]=lang==='en'?e.en:lang==='tr'&&e.tr?e.tr:existing?values[existing]||e.en:dict.uiText[k]||e.en;}fs.writeFileSync(f,JSON.stringify(dict,null,2)+'\n');}
fs.writeFileSync(reportFile,JSON.stringify(report,null,2));console.log('Registered UI strings:',Object.keys(report.entries).length);
