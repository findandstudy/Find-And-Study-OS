import { createHash } from "node:crypto";

export function normalizeReminderDays(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > 20 || value.some(day => typeof day !== "number" || !Number.isSafeInteger(day) || day < 0 || day > 3650)) {
    throw new Error("INVALID_REMINDER_DAYS");
  }
  return [...new Set(value as number[])].sort((a,b)=>b-a);
}
export function parseReminderDay(value: unknown): number {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,3})$/.test(value)) throw new Error("INVALID_REMINDER_DAYS");
  const day=Number(value); normalizeReminderDays([day]); return day;
}
export function calendarDay(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("INVALID_CALENDAR_DATE");
  const ms=Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0,10)!==value) throw new Error("INVALID_CALENDAR_DATE");
  return ms/86400000;
}
export function deadlineTiming(deadline: string, timezone: string, daysBefore: number, now=new Date()) {
  normalizeReminderDays([daysBefore]);
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
  const part=(name:string)=>parts.find(p=>p.type===name)!.value;
  const today=`${part("year")}-${part("month")}-${part("day")}`;
  const targetDay=calendarDay(deadline)-daysBefore;
  return {localToday:today,deadline,timezone,daysBefore,scheduledOn:new Date(targetDay*86400000).toISOString().slice(0,10),remainingDays:calendarDay(deadline)-calendarDay(today),dueToday:targetDay===calendarDay(today)};
}
export function policyVersion(globalRevision:number,universityRevision=0) {return `g${globalRevision}-u${universityRevision}`;}
export function calendarFingerprint(value:unknown) {return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
