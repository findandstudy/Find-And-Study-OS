const DAY_MS = 24 * 60 * 60 * 1000;

function parseIsoDate(value: string | null | undefined): Date | null {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  ));
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
  )
    ? date
    : null;
}

function addUtcYears(date: Date, years: number): Date {
  const next = new Date(date.getTime());
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next;
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface AltinbasPassportDatePolicyResult {
  issueDate: string;
  expiryDate: string;
  fallbackFields: Array<"passportIssueDate" | "passportExpiryDate">;
}

/**
 * Altınbaş-only compatibility policy for historical CRM rows collected before
 * the portal required both passport dates. It never changes valid source data
 * and never writes the synthesized values back to the CRM.
 */
export function resolveAltinbasPassportDates(input: {
  dateOfBirth?: string | null;
  passportIssueDate?: string | null;
  passportExpiryDate?: string | null;
  now?: Date;
}): AltinbasPassportDatePolicyResult {
  const now = input.now ?? new Date();
  const today = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ));
  const yesterday = new Date(today.getTime() - DAY_MS);
  const dob = parseIsoDate(input.dateOfBirth);
  const sourceIssue = parseIsoDate(input.passportIssueDate);
  const sourceExpiry = parseIsoDate(input.passportExpiryDate);
  const fallbackFields: AltinbasPassportDatePolicyResult["fallbackFields"] = [];

  let issue = sourceIssue;
  if (
    !issue ||
    issue.getTime() > today.getTime() ||
    (dob && issue.getTime() <= dob.getTime())
  ) {
    fallbackFields.push("passportIssueDate");
    const expiryBased = sourceExpiry
      ? addUtcYears(sourceExpiry, -5)
      : addUtcYears(yesterday, -1);
    issue = expiryBased.getTime() <= yesterday.getTime()
      ? expiryBased
      : yesterday;
    if (dob && issue.getTime() <= dob.getTime()) {
      const ageSixteen = addUtcYears(dob, 16);
      issue = ageSixteen.getTime() <= yesterday.getTime()
        ? ageSixteen
        : yesterday;
    }
  }

  let expiry = sourceExpiry;
  if (!expiry || expiry.getTime() <= issue.getTime()) {
    fallbackFields.push("passportExpiryDate");
    expiry = addUtcYears(issue, 5);
  }

  return {
    issueDate: iso(issue),
    expiryDate: iso(expiry),
    fallbackFields,
  };
}

/** Deterministic first-wins selection after caller sorts newest/content first. */
export function selectFirstDocumentPerMappedSlot<T>(
  docs: readonly T[],
  mapSlot: (doc: T) => string | null | undefined,
): T[] {
  const seen = new Set<string>();
  const selected: T[] = [];
  for (const doc of docs) {
    const slot = mapSlot(doc);
    if (!slot || seen.has(slot)) continue;
    seen.add(slot);
    selected.push(doc);
  }
  return selected;
}
