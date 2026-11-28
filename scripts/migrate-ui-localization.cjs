// One-time, syntax-aware migration. Never translates API values or user data.
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'../artifacts/edcons/src'),dir=path.join(root,'lib/i18n/translations');
const flat=(o,p='',r={})=>{for(const [k,v]of Object.entries(o))v&&typeof v==='object'?flat(v,p+k+'.',r):r[p+k]=v;return r;};
const dicts={};
// Merge duplicate objects deliberately: last value wins on conflicts, unique
// earlier keys survive. JSON.parse previously discarded the whole first object.
function readDictionary(file){const source=fs.readFileSync(file,'utf8'),tree=ts.parseJsonText(file,source);function read(n){if(ts.isObjectLiteralExpression(n)){const out={};for(const p of n.properties){const key=p.name.text,value=read(p.initializer);out[key]=value&&typeof value==='object'&&out[key]&&typeof out[key]==='object'?{...out[key],...value}:value;}return out;}return JSON.parse(n.getText(tree));}return read(tree.statements[0].expression);}
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.json')))dicts[f.slice(0,-5)]=readDictionary(path.join(dir,f));
const enFlat=flat(dicts.en),byText=new Map();for(const [k,v]of Object.entries(enFlat))if(!byText.has(v))byText.set(v,k);
const translations=Object.fromEntries(Object.entries(dicts).map(([l,d])=>[l,flat(d)]));
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return 's'+(h>>>0).toString(16);}
const entries={},skipped=[],changed=[];
function register(en,tr){const key=hash(en);if(entries[key]&&entries[key].en!==en)throw Error('Hash collision');entries[key]??={en,contexts:[]};if(tr)entries[key].tr=tr;return key;}
function eligible(text){return /\p{L}{2}/u.test(text)&&!/^\s*(?:Logo|KB|MB|GB|AI|API|PDF|CSV|JSON|USD|EUR|GBP|PLN|PNG|JPEG|HTML|CSS|WhatsApp|OpenAI|Anthropic|Claude|Google Gemini|Find (?:&|And|and) Study|EN|TR|GET|POST|PUT|DELETE|PATCH|UTF-8|HTTP|HTTPS|\{\{[^}]+\}\})\s*[✓:]?\s*$/i.test(text)&&!/^https?:|^\//.test(text);}
function walk(dirPath){for(const e of fs.readdirSync(dirPath,{withFileTypes:true})){const file=path.join(dirPath,e.name);if(e.isDirectory()){if(e.name!=='i18n')walk(file);continue;}if(!/\.tsx?$/.test(file))continue;
 const source=fs.readFileSync(file,'utf8'),tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS),edits=[],hooks=new Map();let needed=false,componentNeeded=false;
 function component(n){for(let p=n.parent;p;p=p.parent){if(ts.isFunctionDeclaration(p)&&p.name&&/^[A-Z]/.test(p.name.text)&&p.body)return p;if(ts.isArrowFunction(p)&&ts.isVariableDeclaration(p.parent)&&/^[A-Z]/.test(p.parent.name.getText(tree))&&ts.isBlock(p.body))return p;}return null;}
 function expression(n,text){const key=register(text);entries[key].contexts.push(path.relative(root,file).replaceAll('\\','/'));needed=true;const owner=component(n);if(owner){hooks.set(owner.body.getStart(tree)+1,true);return `translateUi(uiLanguage, ${JSON.stringify(text)})`;}componentNeeded=true;return `<UiText text={${JSON.stringify(text)}} />`;}
 // Bilingual helper definitions have an explicit parameter order. Preserve it.
 const copyHelpers=[];
 function visit(n){
  if(ts.isVariableDeclaration(n)&&n.name.getText(tree)==='copy'&&n.initializer&&ts.isArrowFunction(n.initializer)&&n.initializer.parameters.length===2&&ts.isConditionalExpression(n.initializer.body)){
   const fn=n.initializer,b=fn.body,params=fn.parameters.map(p=>p.name.getText(tree)),yes=params.indexOf(b.whenTrue.getText(tree)),no=params.indexOf(b.whenFalse.getText(tree));
   if(yes>=0&&no>=0&&yes!==no&&/lang\s*===\s*["']tr["']/.test(b.condition.getText(tree))){copyHelpers.push({fn,tr:yes,en:no});edits.push({start:b.getStart(tree),end:b.end,text:`translateUi(lang, ${params[no]}, ${params[yes]})`});needed=true;}
  }
  if(ts.isJsxText(n)){const value=n.text.replace(/\s+/g,' ').trim();if(eligible(value)){const decoded=value.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');const exp=expression(n,decoded);const lead=/^\s/.test(n.text)?' ':'';const tail=/\s$/.test(n.text)?' ':'';edits.push({start:n.pos,end:n.end,text:lead+(exp.startsWith('<')?exp:`{${exp}}`)+tail});}}
  if(ts.isJsxAttribute(n)&&['title','placeholder','aria-label','alt'].includes(n.name.getText(tree))&&n.initializer&&ts.isStringLiteral(n.initializer)&&eligible(n.initializer.text)){
   if(component(n)){const exp=expression(n,n.initializer.text);edits.push({start:n.initializer.getStart(tree),end:n.initializer.end,text:`{${exp}}`});}else skipped.push({file:path.relative(root,file),text:n.initializer.text});
  }
  ts.forEachChild(n,visit);
 }visit(tree);
 function calls(n){if(ts.isCallExpression(n)&&n.expression.getText(tree)==='copy'&&n.arguments.length===2&&n.arguments.every(ts.isStringLiteral)){const helper=copyHelpers.find(h=>{let p=n.parent;while(p){if(p===h.fn.parent.parent.parent)return true;p=p.parent;}return false;})|| (copyHelpers.length===1?copyHelpers[0]:null);if(helper)register(n.arguments[helper.en].text,n.arguments[helper.tr].text);}ts.forEachChild(n,calls);}calls(tree);
 if(!edits.length)continue;
 for(const start of hooks.keys())edits.push({start,end:start,text:'\n  const { lang: uiLanguage } = useUiLanguage();'});
 let next=source;for(const edit of edits.sort((a,b)=>b.start-a.start))next=next.slice(0,edit.start)+edit.text+next.slice(edit.end);
 const imports=[];if(needed)imports.push('translateUi');if(componentNeeded)imports.push('UiText');if(hooks.size)imports.push('useUiLanguage');
 next=`import { ${imports.join(', ')} } from "@/lib/ui-localization";\n`+next;fs.writeFileSync(file,next);changed.push(path.relative(root,file));
}}
walk(root);
for(const [lang,dict]of Object.entries(dicts)){dict.uiText??={};for(const [key,e]of Object.entries(entries)){const existing=byText.get(e.en);dict.uiText[key]=lang==='en'?e.en:lang==='tr'&&e.tr?e.tr:existing?translations[lang][existing]||e.en:e.en;}fs.writeFileSync(path.join(dir,lang+'.json'),JSON.stringify(dict,null,2)+'\n');}
fs.writeFileSync(path.resolve(__dirname,'../reports/ui-localization-migration.json'),JSON.stringify({changed,skipped,entries},null,2));
console.log(JSON.stringify({files:changed.length,strings:Object.keys(entries).length,skippedAttributes:skipped.length}));
