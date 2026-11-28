import {useQuery} from '@tanstack/react-query';
import {useI18n} from '@/hooks/use-i18n';
import {translateUi} from '@/lib/ui-localization';
import {reminderApi} from '@/components/DeadlineReminderSettings';
import {Button} from '@/components/ui/button';
export function ApplicationCalendarInfo({universityId,programId}:{universityId?:number;programId?:number}){
 const {t,lang}=useI18n();
 const q=useQuery({queryKey:['application-calendar-info',universityId??null,programId??null],queryFn:()=>reminderApi(programId?`/api/programs/${programId}?locale=${lang}`:`/api/universities/${universityId}/application-periods`),enabled:!!(programId||universityId)});
 const rows=programId?(q.data?.effectiveApplicationPeriod?[q.data.effectiveApplicationPeriod]:[]):(q.data?.data??[]).filter((p:any)=>p.isActive&&p.verifiedAt);
 const unresolved=programId&&['PERIOD_SELECTION_REQUIRED','DATE_CONFLICT','PERIOD_UNAVAILABLE'].includes(q.data?.applicationCalendarStatus);
 return <section className="rounded-xl border p-3 space-y-2"><h3 className="font-semibold text-sm">{t('deadlineReminders.calendarTitle')}</h3>{q.isLoading?<p>{t('common.loading')}</p>:q.isError?<div role="alert">{t('common.error')}<Button type="button" variant="ghost" onClick={()=>q.refetch()}>{t('common.retry')}</Button></div>:<>
 {unresolved&&<p className="text-sm text-amber-700">{t('deadlineReminders.selectPeriod')}</p>}
 {!rows.length&&!unresolved&&<p className="text-sm text-muted-foreground">{t('deadlineReminders.missingDate')}</p>}
 {rows.map((p:any)=><div key={p.id} className="space-y-1 border-t pt-2 first:border-0"><p className="font-medium text-sm">{p.termName} {p.academicYear}{p.campusName?` · ${p.campusName}`:''}</p><dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">{[['Applications open',p.applicationsOpenAt],['Deadline',p.applicationDeadlineAt],['Classes start',p.classesStartOn],['Classes end',p.classesEndOn]].map(([label,value])=><div key={label}><dt className="text-muted-foreground">{translateUi(lang,label)}</dt><dd><bdi dir="ltr">{value||'—'}</bdi></dd></div>)}</dl><p className="text-xs text-muted-foreground"><bdi>{p.sourceTimezone}</bdi></p></div>)}
 </>}</section>;
}
