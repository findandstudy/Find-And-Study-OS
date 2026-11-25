import { createHash } from 'node:crypto';
export type ContractSmtpOutcome =
  | { state: 'accepted'; receipt: { messageId: string; recipient: string; responseSha256: string } }
  | { state: 'rejected' | 'ambiguous'; code: string };

/** SMTP acceptance is not inbox delivery. Missing or inconsistent evidence is uncertain. */
export function contractSmtpOutcome(value: unknown, recipient: string, messageId: string): ContractSmtpOutcome {
  const info = value as { accepted?: unknown; rejected?: unknown; messageId?: unknown; response?: unknown } | null;
  const normalize = (items: unknown): string[] | null => Array.isArray(items) && items.every(v => typeof v === 'string')
    ? items.map(v => v.trim().toLowerCase()) : null;
  const accepted = normalize(info?.accepted), rejected = normalize(info?.rejected);
  if (!accepted || !rejected || typeof info?.response !== 'string') return { state: 'ambiguous', code: 'SMTP_RECEIPT_INCOMPLETE' };
  if (accepted.length === 1 && accepted[0] === recipient && rejected.length === 0
    && info?.messageId === messageId && /^2\d\d(?:[ -]|$)/.test(info.response)) {
    return { state: 'accepted', receipt: { messageId, recipient,
      responseSha256: createHash('sha256').update(info.response).digest('hex') } };
  }
  if (accepted.length === 0 && rejected.length === 1 && rejected[0] === recipient) return { state: 'rejected', code: 'SMTP_RECIPIENT_REJECTED' };
  return { state: 'ambiguous', code: 'SMTP_RECEIPT_MISMATCH' };
}
