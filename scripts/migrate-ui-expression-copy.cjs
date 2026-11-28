const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'../artifacts/edcons/src'),reportPath=path.resolve(__dirname,'../reports/ui-localization-migration.json'),report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return's'+(h>>>0).toString(16);}
const ignored=/^(?:[A-Z0-9_ .:/-]+|https?:.*|\/.*|#[\w-]+|(?:en|tr|ar|fr|ru|fa|zh|hi|es|id|ur|tk|ky|kk|uz|tg|bn|pt|ne|vi|ko|uk|it)|Find (?:And|and|&) Study(?: OS)?|OpenAI|Anthropic|Claude|WhatsApp|Telegram|YouTube|Instagram|Facebook|LinkedIn|TikTok|Twitter|Google|Chrome|Firefox|Windows|Linux|MacOS|Safari|Edge|Opera|WebKit|Logo|avatar|student|lead|application|admin|staff|agent|super_admin|profile|settings|idle|pending|active|completed|error|success|default|outline|destructive|secondary|ghost|sm|lg|icon|button|submit|text|email|password|tel|number|date|datetime-local|url|file)$/;
function eligible(s){return /\p{L}{2}/u.test(s)&&!ignored.test(s)&&!/^\{\{?\w+\}?\}$/.test(s);}
function owner(n){for(let p=n.parent;p;p=p.parent){if(ts.isFunctionDeclaration(p)&&p.name&&/^[A-Z]/.test(p.name.text)&&p.body)return p;if(ts.isArrowFunction(p)&&ts.isVariableDeclaration(p.parent)&&/^[A-Z]/.test(p.parent.name.getText())&&ts.isBlock(p.body))return p;}return null;}
let count=0;function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory()){if(e.name!=='i18n')walk(file);continue;}if(!file.endsWith('.tsx')||file.endsWith('ui-localization.tsx'))continue;const source=fs.readFileSync(file,'utf8'),tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),edits=[],hooks=new Map();
function visit(n){if(ts.isStringLiteral(n)&&eligible(n.text)){
 let p=n.parent,context=false;
 let unsafe=false,child=n;
 while(ts.isParenthesizedExpression(p)||ts.isConditionalExpression(p)||ts.isBinaryExpression(p)){
   if(ts.isConditionalExpression(p)&&p.condition===child)unsafe=true;
   if(ts.isBinaryExpression(p)&&![ts.SyntaxKind.BarBarToken,ts.SyntaxKind.QuestionQuestionToken,ts.SyntaxKind.PlusToken].includes(p.operatorToken.kind))unsafe=true;
   child=p;p=p.parent;
 }
 if(ts.isJsxExpression(p)&&!ts.isJsxAttribute(p.parent))context=true;
 if(ts.isPropertyAssignment(p)&&['title','description'].includes(p.name.getText(tree))){let q=p.parent;while(ts.isObjectLiteralExpression(q)||ts.isPropertyAssignment(q))q=q.parent;if(ts.isCallExpression(q)&&/^toast(?:\.|$)/.test(q.expression.getText(tree)))context=true;}
 const component=context&&!unsafe?owner(n):null;
 if(component){const key=hash(n.text);if(report.entries[key]&&report.entries[key].en!==n.text)throw Error('Collision');report.entries[key]??={en:n.text,contexts:[]};const contextPath=path.relative(root,file).replaceAll('\\','/');if(!report.entries[key].contexts.includes(contextPath))report.entries[key].contexts.push(contextPath);
 edits.push({start:n.getStart(tree),end:n.end,text:`translateUi(uiLanguage, ${JSON.stringify(n.text)})`});hooks.set(component.body.getStart(tree)+1,component.body.getText(tree).includes('lang: uiLanguage'));count++;}}
ts.forEachChild(n,visit);}visit(tree);if(!edits.length)continue;
for(const[start,exists]of hooks)if(!exists)edits.push({start,end:start,text:'\n  const { lang: uiLanguage } = useUiLanguage();'});
let next=source;for(const e of edits.sort((a,b)=>b.start-a.start))next=next.slice(0,e.start)+e.text+next.slice(e.end);
if(source.includes('from "@/lib/ui-localization"'))next=next.replace(/import \{ ([^}]+) \} from "@\/lib\/ui-localization";/,(all,names)=>`import { ${[...new Set([...names.split(',').map(x=>x.trim()),'translateUi','useUiLanguage'])].join(', ')} } from "@/lib/ui-localization";`);else next='import { translateUi, useUiLanguage } from "@/lib/ui-localization";\n'+next;
fs.writeFileSync(file,next);
}}
walk(root);for(const file of fs.readdirSync(path.join(root,'lib/i18n/translations')).filter(f=>f.endsWith('.json'))){const p=path.join(root,'lib/i18n/translations',file),dict=JSON.parse(fs.readFileSync(p,'utf8'));for(const[k,e]of Object.entries(report.entries))dict.uiText[k]??=file==='tr.json'&&e.tr?e.tr:e.en;fs.writeFileSync(p,JSON.stringify(dict,null,2)+'\n');}fs.writeFileSync(reportPath,JSON.stringify(report,null,2));console.log({expressions:count,totalStrings:Object.keys(report.entries).length});
