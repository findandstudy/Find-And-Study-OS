import { Router } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { socialMockTeamTemplate } from "../lib/personaTeamDraft";
import {
  assertPersonaRuntime,
  createPersonaRuntimeBoundary,
  type PersonaRuntimeBoundary,
} from "../lib/personaRuntimeBoundary";

export interface PersonaPanelOptions {
  /** Trusted server configuration, never request input. */
  runtime?: PersonaRuntimeBoundary;
  mountPath?: string;
  apiBase?: string;
}

function panelPath(value: string, allowEmpty = false) {
  if (allowEmpty && value === "") return value;
  if (!/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(value))
    throw new Error("PERSONA_PANEL_PATH_INVALID");
  return value;
}

/** Only fixed application-owned files can be served. Compiled CJS uses packaged
 * dist assets; tsx uses sibling source files. There is no cwd/request fallback. */
function panelAsset(file: string) {
  const assetRoot =
    typeof __dirname === "string"
      ? join(__dirname, "assets", "persona-workspace")
      : fileURLToPath(new URL("../lib/", import.meta.url));
  return readFileSync(join(assetRoot, file), "utf8");
}

/** The default remains a disposable test-only panel. A staging mount must
 * receive the verified runtime boundary and sit behind session authentication.
 * It never exposes a test-login/session creation route. */
export function createPersonaLocalPanel(
  projectId: string,
  options: PersonaPanelOptions = {},
) {
  const runtime = options.runtime ?? createPersonaRuntimeBoundary();
  assertPersonaRuntime(runtime);
  const staging = runtime.mode === "staging-mock";
  const mountPath = panelPath(options.mountPath ?? "", true);
  const apiBase = panelPath(options.apiBase ?? "/mock");
  if (
    staging &&
    (mountPath !== "/admin/agent-team-workspace" ||
      apiBase !== "/api/persona-workspace")
  )
    throw new Error("PERSONA_PANEL_PATH_INVALID");
  const asset = (path: string) => mountPath + path;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      projectId,
    )
  )
    throw new Error("PERSONA_SCOPE_REQUIRED");
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    res.set(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    res.set("X-Content-Type-Options", "nosniff");
    try {
      assertPersonaRuntime(runtime);
    } catch {
      res.status(403).send("PERSONA_MOCK_ONLY");
      return;
    }
    next();
  });
  router.get("/", (_req, res) =>
    res
      .type("html")
      .send(
        `<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${staging ? "Staging takım çalışma alanı" : "Yerel ajan denemesi"}</title><link rel="stylesheet" href="${asset("/panel.css")}"><body data-project="${projectId}" data-persona-mode="${staging ? "staging-mock" : "disposable-mock"}" data-panel-base="${mountPath}" data-api-base="${apiBase}"><main><h1>Find And Study · ${staging ? "Staging takım çalışma alanı" : "Yerel ajan denemesi"}</h1><p>${staging ? "Taslaklar bu staging projesinde kalıcı olarak saklanır. Yalnız sahte sağlayıcı kullanılır; gerçek kişisel veri girmeyin." : "Yalnız sentetik veri ve sahte sağlayıcı."} Yayın, gönderim ve ücretli çağrı yoktur.</p><p>Görevi oluşturan ve onaylayan iki ayrı ${staging ? "yetkili kullanıcı" : "test oturumu"} olmalıdır. Bu ekran kullanıcı değiştirmez veya yetki vermez.</p><button id="load">Takımı ve geçmişi yükle</button><section><h2>Yeni taslak görevi</h2><label for="persona">Ekip üyesi</label><select id="persona"></select><label for="content">Taslak içeriği</label><textarea id="content" maxlength="16000" rows="5"></textarea><label for="target">Hedef (yalnız sahte taslak)</label><input id="target" value="local-preview" maxlength="256"><button id="propose">İnsan onayına gönder</button></section><section><h2>İnceleme ve sahte çalıştırma</h2><label for="action">Görev numarası</label><input id="action" type="number" min="1"><button id="review">İçeriği incele</button><pre id="reviewed"></pre><button id="approve" disabled>Bu sürümü onayla</button><button id="execute">Onaylı görevi sahte çalıştır</button></section><p id="status" role="status" aria-live="polite"></p><h2>Çalışma geçmişi</h2><pre id="history"></pre></main><script src="${asset("/panel.js")}" defer></script></body></html>`,
      ),
  );
  router.get("/panel.css", (_req, res) =>
    res
      .type("css")
      .send(
        `body{font:16px system-ui;margin:0;background:#f5f7fb;color:#17233a}main{max-width:850px;margin:auto;padding:24px}section{background:white;border:1px solid #ccd4e0;border-radius:12px;padding:20px;margin:20px 0}label{display:block;margin:12px 0 6px}input,textarea,select{box-sizing:border-box;width:100%;padding:12px;font:inherit}button{padding:12px;margin:10px 8px 0 0;min-height:44px;cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere}*:focus-visible{outline:3px solid #235fce;outline-offset:3px}`,
      ),
  );
  router.get("/team-tree.js", (_req, res) =>
    res.type("js").send(panelAsset("persona-team-tree.client.js")),
  );
  router.get("/team-tree.css", (_req, res) =>
    res.type("css").send(panelAsset("persona-team-tree.css")),
  );
  for (const [path, file, type] of [
    ["/team-tasks.js", "persona-team-tasks.client.js", "js"],
    ["/team-tasks.css", "persona-team-tasks.css", "css"],
  ])
    router.get(path, (_req, res) => res.type(type).send(panelAsset(file)));
  router.get("/team-template", (_req, res) => res.json(socialMockTeamTemplate));
  router.get("/panel.js", (_req, res) =>
    res.type("js").send(`"use strict";
const panelBase=document.body.dataset.panelBase||'';
const treeStyles=document.createElement('link');treeStyles.rel='stylesheet';treeStyles.href=panelBase+'/team-tree.css';document.head.append(treeStyles);
const taskStyles=document.createElement('link');taskStyles.rel='stylesheet';taskStyles.href=panelBase+'/team-tasks.css';document.head.append(taskStyles);
import(panelBase+'/team-tree.js');
const el=id=>document.getElementById(id),base=document.body.dataset.apiBase+'/'+document.body.dataset.project;let reviewed=null;
const recovery=document.createElement('section');
for(const [tag,id,text] of [['h2','','Belirsiz işlem kontrolü'],['p','','Bu işlem yalnız mevcut sonuç kanıtını kontrol eder. Görevi tekrar çalıştırmaz. Kanıt yoksa bütçe rezervasyonu korunur.'],['button','history-refresh','Geçmişi yenile'],['label','recovery-label','Kontrol edilecek çalışma'],['select','recovery-execution',''],['button','reconcile','Kanıtı kontrol et'],['pre','recovery-result','']]){const node=document.createElement(tag);if(id)node.id=id;node.textContent=text;recovery.append(node);}
document.querySelector('main').append(recovery);el('recovery-label').htmlFor='recovery-execution';el('reconcile').disabled=true;
let recoverable=new Set();
const teamSection=document.createElement('section');for(const [tag,id,text] of [['h2','','Takım organizasyon taslağı'],['p','','Bu sürüm yalnız taslağı kaydeder ve insan onayını tutar; ajan etkinleştirme veya erişim yetkisi oluşturmaz.'],['button','team-template','Sosyal medya şablonunu yükle'],['label','team-label','Düzenlenebilir takım tanımı (JSON)'],['textarea','team-document',''],['button','team-save','Yeni taslak sürümünü kaydet'],['button','team-list','Kayıtlı taslakları incele'],['label','team-choice-label','Onaylanacak taslak'],['select','team-choice',''],['pre','team-preview',''],['button','team-approve','Gösterilen takım sürümünü onayla']]){const node=document.createElement(tag);if(id)node.id=id;node.textContent=text;teamSection.append(node);}document.querySelector('main').append(teamSection);el('team-label').htmlFor='team-document';el('team-document').rows=12;el('team-choice-label').htmlFor='team-choice';el('team-approve').disabled=true;let teamRows=[];
function selectTeam(){const row=teamRows.find(x=>String(x.action_id)===el('team-choice').value);el('team-preview').textContent=row?JSON.stringify(row,null,2):'';el('team-approve').disabled=!row||!!row.reviewer;return row;}
el('team-choice').onchange=selectTeam;
function showHistory(rows){el('history').textContent=JSON.stringify(rows,null,2);recoverable=new Set();el('recovery-execution').replaceChildren();for(const row of rows){if(!['RESERVED','DISPATCHED','UNCERTAIN'].includes(row.state))continue;recoverable.add(row.id);const option=document.createElement('option');option.value=row.id;option.textContent=row.id+' — '+row.state+' — ayrılan: '+row.reserved_micros+' sahte mikro birim';el('recovery-execution').append(option);}el('reconcile').disabled=recoverable.size===0;}
async function api(path,body,method){const csrf=document.cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith('csrf_token='))?.slice(11);let r;try{r=await fetch(base+path,{method:method||(body===undefined?'GET':'POST'),credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf||''},...(body===undefined?{}:{body:JSON.stringify(body)})});}catch{throw Error('Bağlantı kesildi. İşlem tamamlanmış olabilir; yeniden göndermeden önce geçmişi kontrol edin.');}const data=await r.json();if(r.status===429)throw Error('İstek sınırına ulaşıldı. '+(data.retryAfterSeconds||60)+' saniye sonra elle tekrar deneyin. Otomatik tekrar yapılmadı.');if(!r.ok)throw Error(data.error||'İşlem reddedildi');return data;}
function bind(id,work){el(id).onclick=async()=>{const button=el(id);button.disabled=true;try{const message=await work();el('status').textContent=message||'İşlem tamamlandı; yalnız sahte sağlayıcı kullanıldı.';}catch(e){el('status').textContent=e.message;}finally{button.disabled=(id==='approve'&&!reviewed)||(id==='reconcile'&&recoverable.size===0)||(id==='team-approve'&&!teamRows.some(row=>String(row.action_id)===el('team-choice').value&&!row.reviewer));}};}
const action=()=>{const id=Number(el('action').value);if(!Number.isSafeInteger(id)||id<1)throw Error('Geçerli görev numarası girin');return id;};
bind('team-template',async()=>{const r=await fetch(panelBase+'/team-template');if(!r.ok)throw Error('Şablon yüklenemedi');el('team-document').value=JSON.stringify(await r.json(),null,2);});
bind('team-save',async()=>{const result=await api('/team-drafts',{personaId:Number(el('persona').value),document:JSON.parse(el('team-document').value)});el('team-preview').textContent=JSON.stringify(result,null,2);el('team-approve').disabled=true;teamRows=[];return 'Yeni taslak sürümü kaydedildi. Ayrı insan onayı gerekiyor; hiçbir ajan veya yetki açılmadı.';});
bind('team-list',async()=>{teamRows=await api('/team-drafts');el('team-choice').replaceChildren();for(const row of teamRows){const option=document.createElement('option');option.value=row.action_id;option.textContent=row.action_id+' — '+row.document.name;el('team-choice').append(option);}selectTeam();});
bind('team-approve',async()=>{const row=selectTeam();if(!row||row.reviewer)throw Error('Önce onaysız taslağı inceleyin');await api('/team-drafts/'+row.action_id+'/approve',{digest:row.digest});teamRows=[];el('team-choice').replaceChildren();el('team-preview').textContent='Onay kaydedildi. Etkinleştirme ve yeni yetki yok.';return 'Takım taslağı onaylandı; ajan çalıştırma veya yetki açılmadı.';});
bind('load',async()=>{const rows=await api('/personas');el('persona').replaceChildren();for(const row of rows){const opt=document.createElement('option');opt.value=row.id;opt.textContent=row.name;el('persona').append(opt);}showHistory(await api('/history'));});
bind('history-refresh',async()=>{showHistory(await api('/history'));});
bind('reconcile',async()=>{const id=el('recovery-execution').value;if(!recoverable.has(id)||!/^[a-f0-9-]{36}$/i.test(id))throw Error('Önce çalışma geçmişini yükleyip bir işlem seçin.');const result=await api('/reconcile/'+id,{});el('recovery-result').textContent=JSON.stringify(result,null,2);if(result.state==='UNCERTAIN')return 'Sonuç kanıtı bulunamadı. İşlem belirsiz; rezervasyon korunuyor. Yeniden çalıştırma veya iade yapılmadı.';if(result.state!=='SUCCEEDED')throw Error('Beklenmeyen işlem durumu; tekrar çalıştırmayın, geçmişi kontrol edin.');recoverable.delete(id);for(const option of [...el('recovery-execution').options])if(option.value===id)option.remove();return 'Kalıcı sonuç kanıtı doğrulandı. Görev yeniden çalıştırılmadan hesap kapatıldı.';});
bind('propose',async()=>{const result=await api('/proposals',{personaId:Number(el('persona').value),content:el('content').value,target:el('target').value});el('action').value=result.actionId;reviewed=null;el('approve').disabled=true;el('reviewed').textContent=JSON.stringify(result,null,2);});
el('action').oninput=()=>{reviewed=null;el('approve').disabled=true;el('reviewed').textContent='';};
bind('review',async()=>{const id=action();reviewed=null;el('approve').disabled=true;el('reviewed').textContent='';const result=await api('/approvals/'+id);if(action()!==id)throw Error('Görev numarası değişti. Yeni görevi tekrar inceleyin.');reviewed={id,digest:result.digest};el('reviewed').textContent=JSON.stringify(result,null,2);el('approve').disabled=false;});
bind('approve',async()=>{if(!reviewed||reviewed.id!==action())throw Error('Önce bu görevin içeriğini inceleyin');await api('/approvals/'+reviewed.id,{digest:reviewed.digest});reviewed=null;});
bind('execute',async()=>{el('history').textContent=JSON.stringify(await api('/executions/'+action(),{}),null,2);});
function section(title,fields){const box=document.createElement('section');const h=document.createElement('h2');h.textContent=title;box.append(h);for(const [tag,id,label] of fields){if(['input','textarea','select'].includes(tag)){const l=document.createElement('label');l.htmlFor=id;l.textContent=label;box.append(l);}const n=document.createElement(tag);n.id=id;if(!['input','textarea','select'].includes(tag))n.textContent=label;if(tag==='textarea')n.rows=6;box.append(n);}document.querySelector('main').append(box);}
section('Onaylı takımın yerel kurulumu', [['button','team-install','Seçili onaylı taslağı duraklatılmış kur'],['button','teams-load','Kurulmuş takımları göster'],['input','team-id','Takım kimliği'],['button','team-resume','Yalnız mock çalışmaya aç'],['button','team-pause','Takımı duraklat'],['pre','teams-result','']]);
bind('team-install',async()=>{const row=teamRows.find(x=>String(x.action_id)===el('team-choice').value);if(!row?.reviewer)throw Error('Önce onaylı taslağı listeden seçin');const result=await api('/team-drafts/'+row.action_id+'/install',{digest:row.digest});el('team-id').value=result.id;el('teams-result').textContent=JSON.stringify(result,null,2);});
bind('teams-load',async()=>{el('teams-result').textContent=JSON.stringify(await api('/teams'),null,2);});
for(const [button,paused] of [['team-resume',false],['team-pause',true]])bind(button,async()=>{const id=el('team-id').value;if(!/^[a-f0-9-]{36}$/i.test(id))throw Error('Geçerli takım kimliği girin');el('teams-result').textContent=JSON.stringify(await api('/teams/'+id+'/pause',{paused}),null,2);});
section('Kalıcı görev zinciri — insan denetimli mock', [['p','workflow-help','Her alt görev önce ayrı insan onayı alır. İlerle düğmesi yalnız sıradaki taslağı hazırlar; çalıştırma veya yayın yapmaz.'],['input','workflow-key','Tekrarlanan isteği tanıyan anahtar'],['textarea','workflow-document','Görev tanımı (name, brief, nodes: key, personaId, dependsOn)'],['button','workflow-create','Zinciri kaydet'],['input','workflow-id','Zincir görev numarası'],['button','workflow-read','Durumu oku'],['button','workflow-advance','Sıradaki taslağı hazırla'],['button','workflow-cancel','Zinciri iptal et'],['button','workflow-review','İncelenen tamamlanmış sonucu onayla'],['pre','workflow-result','']]);
const stepButton=document.createElement('button');stepButton.id='workflow-run-step';stepButton.textContent='Onaylı sıradaki işi mock çalıştır';el('workflow-result').before(stepButton);
const listButton=document.createElement('button');listButton.id='workflow-list';listButton.textContent='Son 25 zinciri listele';el('workflow-result').before(listButton);bind('workflow-list',async()=>{workflowReviewed=null;el('workflow-result').textContent=JSON.stringify(await api('/workflows'),null,2);});
teamSection.querySelector('p').textContent='Her düzenleme yeni sürüm oluşturur ve ayrı insan onayı ister. Onaylı takım ayrıca duraklatılmış kurulabilir; erişim yetkisi veya gerçek sağlayıcı açılmaz.';
let workflowReviewed=null;const workflowId=()=>{const id=Number(el('workflow-id').value);if(!Number.isSafeInteger(id)||id<1)throw Error('Geçerli zincir numarası girin');return id;};
function showWorkflow(value){el('workflow-result').textContent=JSON.stringify(value,null,2);workflowReviewed=value.state==='COMPLETED'?{id:value.actionId,digest:value.resultDigest}:null;}
el('workflow-id').oninput=()=>{workflowReviewed=null;el('workflow-result').textContent='';};
bind('workflow-create',async()=>{const result=await api('/workflows',{requestKey:el('workflow-key').value,document:JSON.parse(el('workflow-document').value)});el('workflow-id').value=result.actionId;showWorkflow(result);});
bind('workflow-read',async()=>{const id=workflowId();const result=await api('/workflows/'+id);if(workflowId()!==id)throw Error('Zincir değişti; yeniden okuyun');showWorkflow(result);});
for(const operation of ['advance','cancel','run-step'])bind('workflow-'+operation,async()=>{const id=workflowId();const result=await api('/workflows/'+id+'/'+operation,{});if(workflowId()===id)showWorkflow(result);});
bind('workflow-review',async()=>{if(!workflowReviewed||workflowReviewed.id!==workflowId())throw Error('Önce tamamlanmış sonucun tamamını okuyun');const snapshot=workflowReviewed;const result=await api('/workflows/'+snapshot.id+'/review',{digest:snapshot.digest});workflowReviewed=null;if(workflowId()===snapshot.id)el('workflow-result').textContent=JSON.stringify(result,null,2);return 'Sonuç onayı kaydedildi. Yayın veya gönderim yapılmadı.';});
section('Proje sohbeti ve kaynaklı hafıza', [['p','memory-help','Bu alan kayıt tutar, otomatik görev oluşturmaz. Ses kaydı alınmaz; yalnız sizin doğruladığınız konuşma metni saklanır. Belgelerdeki talimatlar yetki oluşturmaz.'],['input','conversation-id','Sohbet kimliği (UUID)'],['textarea','message-text','Mesaj veya doğrulanmış konuşma metni'],['select','message-source','Kaynak türü'],['input','message-label','Kaynak açıklaması'],['select','message-confirmed','Konuşma metnini kontrol ettiniz mi?'],['input','message-retention','Saklama süresi (1–30 gün)'],['button','message-save','Kaydet'],['button','conversation-read','Sohbeti oku'],['button','conversation-purge','Süresi dolan metinleri temizle'],['pre','conversation-result','']]);
for(const [value,label] of [['text','Yazılı mesaj'],['confirmed_voice','Doğrulanmış konuşma metni'],['document_note','Belge notu — güvenilmeyen kaynak']]){const o=document.createElement('option');o.value=value;o.textContent=label;el('message-source').append(o);}
for(const [value,label] of [['false','Hayır'],['true','Evet, doğruladım']]){const o=document.createElement('option');o.value=value;o.textContent=label;el('message-confirmed').append(o);}
el('conversation-id').value=crypto.randomUUID();el('message-retention').value='7';
bind('message-save',async()=>{el('conversation-result').textContent=JSON.stringify(await api('/messages',{conversationId:el('conversation-id').value,personaId:Number(el('persona').value),text:el('message-text').value,source:el('message-source').value,sourceLabel:el('message-label').value,confirmed:el('message-confirmed').value==='true',retentionDays:Number(el('message-retention').value)}),null,2);});
bind('conversation-read',async()=>{const id=el('conversation-id').value;if(!/^[a-f0-9-]{36}$/i.test(id))throw Error('Geçerli sohbet kimliği girin');el('conversation-result').textContent=JSON.stringify(await api('/conversations/'+id),null,2);});
bind('conversation-purge',async()=>{el('conversation-result').textContent=JSON.stringify(await api('/messages/purge-expired',{}),null,2);});`),
  );
  return router;
}
