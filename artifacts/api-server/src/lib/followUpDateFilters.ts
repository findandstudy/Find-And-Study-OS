export function parseClientDayBounds(
  rawOffset: unknown,
  referenceNow = new Date(),
): { now: Date; today: Date; tomorrow: Date; nextSevenDays: Date; offsetMinutes: number } {
  const parsedOffset = Number(rawOffset);
  const offsetMinutes = Number.isFinite(parsedOffset) && Math.abs(parsedOffset) <= 14 * 60
    ? parsedOffset
    : 0;
  const now = new Date(referenceNow);
  const shifted = new Date(now.getTime() - offsetMinutes * 60_000);
  const localMidnightAsUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
  const today = new Date(localMidnightAsUtc + offsetMinutes * 60_000);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const nextSevenDays = new Date(today.getTime() + 8 * 24 * 60 * 60 * 1000);
  return { now, today, tomorrow, nextSevenDays, offsetMinutes };
}

export function parseClientCalendarDate(value: unknown, offsetMinutes: number, endOfDay = false): Date | null {
  const match = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  const parsed = new Date(utc + offsetMinutes * 60_000);
  const shifted = new Date(parsed.getTime() - offsetMinutes * 60_000);
  if (shifted.getUTCFullYear() !== year || shifted.getUTCMonth() !== month - 1 || shifted.getUTCDate() !== day) return null;
  return parsed;
}
