const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');const root=path.resolve(__dirname,'../artifacts/edcons/src');
for(const [name,helper,extra]of [['components/NotificationCenter.tsx','timeAgo',''],['pages/admin/Activity.tsx','timeAgo',''],['components/AuditLogSection.tsx','relativeTime','if (Date.now()-new Date(iso).getTime()>=7*86400000) return "";'],['components/shared/ActivityFeed.tsx','relativeTime','if (Date.now()-new Date(iso).getTime()>=7*86400000) return new Date(iso).toLocaleDateString(lang);']]){
const file=path.join(root,name);let source=fs.readFileSync(file,'utf8');const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const fn=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text===helper);if(!fn)throw Error(file);const arg=fn.parameters[0].name.getText(tree);const replacement=`function ${helper}(${arg}: string | null, lang: Parameters<typeof formatTimeAgo>[0]): string {\n  if (!${arg}) return "—";\n  ${extra}\n  return formatTimeAgo(lang, ${arg});\n}`;
source=source.slice(0,fn.getStart(tree))+replacement+source.slice(fn.end);source='import { formatTimeAgo } from "@/lib/i18n/index";\n'+source;
if(name.includes('Notification'))source=source.replaceAll('timeAgo(n.createdAt)','timeAgo(n.createdAt, uiLanguage)');
if(name.includes('admin/Activity'))source=source.replaceAll('timeAgo(u.lastSeen)','timeAgo(u.lastSeen, lang)');
if(name.includes('AuditLog'))source=source.replaceAll('relativeTime(log.createdAt)','relativeTime(log.createdAt, lang)');
if(name.includes('shared/'))source=source.replace('  const [expanded, setExpanded] = useState(false);','  const { lang } = useI18n();\n  const [expanded, setExpanded] = useState(false);').replaceAll('relativeTime(item.ts)','relativeTime(item.ts, lang)');
fs.writeFileSync(file,source);
}
