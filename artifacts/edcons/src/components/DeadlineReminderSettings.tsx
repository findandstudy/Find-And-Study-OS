import {useEffect,useState,useId} from 'react';
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {useI18n} from '@/hooks/use-i18n';
import {useToast} from '@/hooks/use-toast';
import {apiFetch} from '@/lib/apiFetch';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
export type ReminderPolicy={mode:'SYSTEM'|'INHERIT'|'CUSTOM';days:number[];globalDays:number[];effectiveDays:number[];version:string;deliveryEnabled:false};
export async function reminderApi(url:string,options?:RequestInit){const r=await apiFetch(url,options);const body=await r.json();if(!r.ok)throw new Error(body.code||'REMINDER_REQUEST_FAILED');return body;}
export const reminderPolicyUrl=(id?:number)=>id?`/api/universities/${id}/deadline-reminder-settings`:'/api/application-deadline-reminders/settings';
export function useReminderPolicy(id?:number){return useQuery<ReminderPolicy>({queryKey:['deadline-reminder-policy',id??'system'],queryFn:()=>reminderApi(reminderPolicyUrl(id))});}
export function DeadlineReminderSettings({universityId}:{universityId?:number}){
 const {t}=useI18n(),{toast}=useToast(),qc=useQueryClient(),inputId=useId();const q=useReminderPolicy(universityId);
 const [mode,setMode]=useState('SYSTEM'),[text,setText]=useState('');
 useEffect(()=>{if(q.data){setMode(q.data.mode);setText(q.data.days.join(', '));}},[q.data]);
 const parsed=text.trim()===''?[]:text.split(/[,;\s]+/).filter(Boolean).map(x=>/^\d+$/.test(x)?Number(x):NaN);
 const valid=parsed.length<=20&&parsed.every(x=>Number.isSafeInteger(x)&&x>=0&&x<=3650);
 const save=useMutation({mutationFn:()=>reminderApi(reminderPolicyUrl(universityId),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode,days:parsed,version:q.data?.version})}),onSuccess:(data)=>{qc.setQueryData(['deadline-reminder-policy',universityId??'system'],data);qc.invalidateQueries({queryKey:['deadline-reminder-policy']});toast({title:t('common.saved')});},onError:()=>toast({title:t('common.error'),description:t('deadlineReminders.saveError'),variant:'destructive'})});
 return <section className="rounded-xl border p-4 space-y-3" aria-label={t('deadlineReminders.title')}>
  <h3 className="font-semibold">{t('deadlineReminders.title')}</h3><p className="text-sm text-muted-foreground">{t(universityId?'deadlineReminders.universityHelp':'deadlineReminders.globalHelp')}</p>
  {q.isLoading?<p>{t('common.loading')}</p>:q.isError?<div role="alert"><p>{t('common.error')}</p><Button type="button" variant="outline" onClick={()=>q.refetch()}>{t('common.retry')}</Button></div>:<>
  {universityId&&<div className="flex flex-wrap gap-2"><Button type="button" variant={mode==='INHERIT'?'default':'outline'} onClick={()=>setMode('INHERIT')}>{t('deadlineReminders.inherit')}</Button><Button type="button" variant={mode==='CUSTOM'?'default':'outline'} onClick={()=>setMode('CUSTOM')}>{t('deadlineReminders.custom')}</Button></div>}
  {mode!=='INHERIT'&&<div><Label htmlFor={inputId}>{t('deadlineReminders.days')}</Label><Input id={inputId} value={text} maxLength={140} dir="ltr" placeholder="45, 14, 3, 0" onChange={e=>setText(e.target.value)} aria-invalid={!valid} aria-describedby={`${inputId}-help`}/><p id={`${inputId}-help`} className="mt-1 text-xs text-muted-foreground">{t('deadlineReminders.help')}</p>{!valid&&<p role="alert" className="text-sm text-destructive">{t('deadlineReminders.invalid')}</p>}</div>}
  <p className="text-sm">{t('deadlineReminders.effective')}: <bdi dir="ltr">{(q.data?.effectiveDays??[]).join(', ')||t('deadlineReminders.off')}</bdi></p>
  <Button type="button" disabled={save.isPending||(mode!=='INHERIT'&&!valid)} onClick={()=>save.mutate()}>{t('common.save')}</Button>
  <Button type="button" variant="ghost" onClick={()=>q.refetch()}>{t('common.retry')}</Button>
  </>}
  <p className="text-xs text-muted-foreground">{t('deadlineReminders.previewOnly')}</p>
 </section>;
}
export function DeadlineReminderPreview({universityId,disabled,onPreview}:{universityId:number;disabled:boolean;onPreview:(day:number)=>void}){
 const {t}=useI18n(),q=useReminderPolicy(universityId);const [selected,setSelected]=useState('');
 const day=q.data?.effectiveDays.includes(Number(selected))&&selected!==''?Number(selected):q.data?.effectiveDays[0];
 return <div className="flex flex-wrap items-center gap-2"><Label>{t('deadlineReminders.preview')}</Label>{q.isError?<p role="alert">{t('common.error')}</p>:<><select aria-label={t('deadlineReminders.days')} className="h-9 rounded-md border bg-background px-2" value={day??''} onChange={e=>setSelected(e.target.value)} disabled={!q.data?.effectiveDays.length}>{q.data?.effectiveDays.map(n=><option key={n} value={n}>{n}</option>)}</select><Button type="button" variant="outline" size="sm" disabled={disabled||day===undefined||q.isFetching} onClick={()=>onPreview(day!)}>{t('deadlineReminders.preview')}</Button>{q.data&&!q.data.effectiveDays.length&&<span className="text-sm">{t('deadlineReminders.off')}</span>}</>}<span className="text-xs text-muted-foreground">{t('deadlineReminders.previewOnly')}</span></div>;
}
