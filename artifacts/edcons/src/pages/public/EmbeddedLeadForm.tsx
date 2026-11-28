import { translateUi } from "@/lib/ui-localization";
import { useEffect,useRef,useState } from 'react';
import { useI18n } from '@/hooks/use-i18n';
const validSlug=(value:unknown)=>typeof value==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)&&value.length<=80?value:'website-contact';
export function EmbeddedLeadForm({slug,preview=false}:{slug?:unknown;preview?:boolean}){
 const {lang,t}=useI18n(),name=validSlug(slug);const frame=useRef<HTMLIFrameElement>(null);
 const [token,setToken]=useState(''),[height,setHeight]=useState(760),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{setToken('');setFailed(false);if(preview)return;const controller=new AbortController();const timeout=setTimeout(()=>{setFailed(true);controller.abort();},12000);
 fetch(`/api/public/embed/${name}/website-token`,{credentials:'same-origin',signal:controller.signal,cache:'no-store'}).then(async r=>{if(!r.ok)throw Error();const data=await r.json();if(typeof data.token!=='string'||data.token.length>1000)throw Error();if(!controller.signal.aborted)setToken(data.token);}).catch(()=>{if(!controller.signal.aborted)setFailed(true);else if(controller.signal.reason?.name==='TimeoutError')setFailed(true);}).finally(()=>clearTimeout(timeout));
 return()=>{clearTimeout(timeout);controller.abort();};},[name,preview,retry]);
 const sendSource=()=>frame.current?.contentWindow?.postMessage({type:'edcons-source-context',slug:name,sourcePageUrl:location.origin+location.pathname},location.origin);
 useEffect(()=>{const receive=(event:MessageEvent)=>{if(event.origin!==location.origin||event.source!==frame.current?.contentWindow||event.data?.slug!==name)return;if(event.data?.type==='edcons-analytics-request'){sendSource();return;}if(event.data?.type!=='edcons-resize')return;const h=Number(event.data.height);if(Number.isFinite(h))setHeight(Math.max(280,Math.min(2600,Math.ceil(h))));};window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);},[name]);
 if(preview)return <div className="website-embed-preview" role="note">{translateUi(lang, "System embed form", "Sistem içi embed form")} · {name}<p>{translateUi(lang, "Manage fields in Embeds. Submissions are disabled in the editor preview.", "Form alanları Embeds ekranından yönetilir. Önizlemede gönderim kapalıdır.")}</p></div>;
 if(failed)return <div role="alert">{t('common.error')} <button type="button" onClick={()=>setRetry(n=>n+1)}>{translateUi(lang, "Retry", "Yeniden dene")}</button></div>;
 return token?<iframe ref={frame} onLoad={sendSource} className="website-embedded-lead-form" title={t('contact.formTitle')} src={`/api/public/embed/${name}/widget?lang=${encodeURIComponent(lang)}&t=${encodeURIComponent(token)}`} style={{width:'100%',height,border:0,display:'block',background:'transparent'}} referrerPolicy="strict-origin-when-cross-origin"/>:<div role="status" className="website-embed-preview">{t('common.loading')}</div>;
}
