import { useEffect,useRef,useState } from 'react';
import { useI18n } from '@/hooks/use-i18n';
const validSlug=(value:unknown)=>typeof value==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)&&value.length<=80?value:'website-contact';
export function EmbeddedLeadForm({slug,preview=false}:{slug?:unknown;preview?:boolean}){
 const {lang,t}=useI18n(),name=validSlug(slug);const frame=useRef<HTMLIFrameElement>(null);
 const [token,setToken]=useState(''),[height,setHeight]=useState(760),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{setToken('');setFailed(false);if(preview)return;const controller=new AbortController();const timeout=setTimeout(()=>{setFailed(true);controller.abort();},12000);
 fetch(`/api/public/embed/${name}/website-token`,{credentials:'same-origin',signal:controller.signal,cache:'no-store'}).then(async r=>{if(!r.ok)throw Error();const data=await r.json();if(typeof data.token!=='string'||data.token.length>1000)throw Error();if(!controller.signal.aborted)setToken(data.token);}).catch(()=>{if(!controller.signal.aborted)setFailed(true);else if(controller.signal.reason?.name==='TimeoutError')setFailed(true);}).finally(()=>clearTimeout(timeout));
 return()=>{clearTimeout(timeout);controller.abort();};},[name,preview,retry]);
 useEffect(()=>{const receive=(event:MessageEvent)=>{if(event.origin!==location.origin||event.source!==frame.current?.contentWindow||event.data?.type!=='edcons-resize'||event.data.slug!==name)return;const h=Number(event.data.height);if(Number.isFinite(h))setHeight(Math.max(280,Math.min(2600,Math.ceil(h))));};window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);},[name]);
 if(preview)return <div className="website-embed-preview" role="note">{lang==='tr'?'Sistem içi embed form':'System embed form'} · {name}<p>{lang==='tr'?'Form alanları Embeds ekranından yönetilir. Önizlemede gönderim kapalıdır.':'Manage fields in Embeds. Submissions are disabled in the editor preview.'}</p></div>;
 if(failed)return <div role="alert">{t('common.error')} <button type="button" onClick={()=>setRetry(n=>n+1)}>{lang==='tr'?'Yeniden dene':'Retry'}</button></div>;
 return token?<iframe ref={frame} className="website-embedded-lead-form" title={t('contact.formTitle')} src={`/api/public/embed/${name}/widget?lang=${encodeURIComponent(lang)}&t=${encodeURIComponent(token)}`} style={{width:'100%',height,border:0,display:'block',background:'transparent'}} referrerPolicy="strict-origin-when-cross-origin"/>:<div role="status" className="website-embed-preview">{t('common.loading')}</div>;
}
