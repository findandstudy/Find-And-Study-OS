/**
 * Locale-independent date helpers for use in components that don't have
 * the i18n lang context handy, or that bypass the central formatDate util.
 * Always produces dd.mm.yyyy / dd.mm.yyyy HH:MM.
 */

/** Format a date-like value as dd.mm.yyyy. Returns "—" for null/invalid. */
export function fmtDate(value: string | number | Date | null | undefined): string {
  if (value == null || value === "") return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return "—";
  return (
    String(d.getDate()).padStart(2, "0") +
    "." +
    String(d.getMonth() + 1).padStart(2, "0") +
    "." +
    d.getFullYear()
  );
}

/** Format a date-like value as dd.mm.yyyy HH:MM (24h). Returns "—" for null/invalid. */
export function fmtDateTime(value: string | number | Date | null | undefined): string {
  if (value == null || value === "") return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return "—";
  return (
    String(d.getDate()).padStart(2, "0") +
    "." +
    String(d.getMonth() + 1).padStart(2, "0") +
    "." +
    d.getFullYear() +
    " " +
    String(d.getHours()).padStart(2, "0") +
    ":" +
    String(d.getMinutes()).padStart(2, "0")
  );
}
