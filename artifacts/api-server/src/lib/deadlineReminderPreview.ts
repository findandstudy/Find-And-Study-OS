import { createHash } from "node:crypto";

export type ReminderChannel = "EMAIL" | "WHATSAPP";

export type DeadlineReminderCandidate = {
  reference: string;
  interested: boolean;
  applicationComplete: boolean;
  emailAvailable: boolean;
  whatsappAvailable: boolean;
  emailConsent: boolean;
  whatsappConsent: boolean;
  unsubscribed: boolean;
  remindedWithinDays: number | null;
};

export type DeadlineReminderPreviewRow = DeadlineReminderCandidate & {
  channel: ReminderChannel | null;
  eligible: boolean;
  reason: string;
};

export function reminderScheduleFingerprint(input: {
  periodId: number;
  deadline: string | null;
  timezone: string;
  daysBefore: number;
}) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

/** Fail-closed audience evaluation. A candidate needs explicit interest,
 * incomplete application, current consent and a reachable channel. */
export function evaluateDeadlineReminderCandidate(
  candidate: DeadlineReminderCandidate,
  recentReminderWindowDays = 14,
): DeadlineReminderPreviewRow {
  if (!candidate.interested) return { ...candidate, channel: null, eligible: false, reason: "NO_EXPLICIT_INTEREST" };
  if (candidate.applicationComplete) return { ...candidate, channel: null, eligible: false, reason: "APPLICATION_COMPLETED" };
  if (candidate.unsubscribed) return { ...candidate, channel: null, eligible: false, reason: "UNSUBSCRIBED" };
  if (candidate.remindedWithinDays != null && candidate.remindedWithinDays <= recentReminderWindowDays) {
    return { ...candidate, channel: null, eligible: false, reason: "RECENT_REMINDER" };
  }
  if (candidate.whatsappAvailable && candidate.whatsappConsent) {
    return { ...candidate, channel: "WHATSAPP", eligible: true, reason: "EXPLICIT_WHATSAPP_CONSENT" };
  }
  if (candidate.emailAvailable && candidate.emailConsent) {
    return { ...candidate, channel: "EMAIL", eligible: true, reason: "EXPLICIT_EMAIL_CONSENT" };
  }
  if (!candidate.emailConsent && !candidate.whatsappConsent) {
    return { ...candidate, channel: null, eligible: false, reason: "CONSENT_MISSING" };
  }
  return { ...candidate, channel: null, eligible: false, reason: "CHANNEL_UNAVAILABLE" };
}

export function buildSyntheticDeadlinePreview() {
  const candidates: DeadlineReminderCandidate[] = [
    { reference: "SYN-ELIGIBLE-EMAIL", interested: true, applicationComplete: false, emailAvailable: true, whatsappAvailable: false, emailConsent: true, whatsappConsent: false, unsubscribed: false, remindedWithinDays: null },
    { reference: "SYN-ELIGIBLE-WHATSAPP", interested: true, applicationComplete: false, emailAvailable: true, whatsappAvailable: true, emailConsent: true, whatsappConsent: true, unsubscribed: false, remindedWithinDays: null },
    { reference: "SYN-COMPLETED", interested: true, applicationComplete: true, emailAvailable: true, whatsappAvailable: true, emailConsent: true, whatsappConsent: true, unsubscribed: false, remindedWithinDays: null },
    { reference: "SYN-NO-CONSENT", interested: true, applicationComplete: false, emailAvailable: true, whatsappAvailable: true, emailConsent: false, whatsappConsent: false, unsubscribed: false, remindedWithinDays: null },
    { reference: "SYN-UNSUBSCRIBED", interested: true, applicationComplete: false, emailAvailable: true, whatsappAvailable: true, emailConsent: true, whatsappConsent: true, unsubscribed: true, remindedWithinDays: null },
    { reference: "SYN-RECENT", interested: true, applicationComplete: false, emailAvailable: true, whatsappAvailable: false, emailConsent: true, whatsappConsent: false, unsubscribed: false, remindedWithinDays: 3 },
  ];
  return candidates.map(candidate => evaluateDeadlineReminderCandidate(candidate));
}
