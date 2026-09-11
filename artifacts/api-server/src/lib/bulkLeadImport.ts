export type BulkLeadIdentity = {
  email: string | null;
  phoneE164: string | null;
};

export type BulkLeadIdentitySets = {
  emails: Set<string>;
  phones: Set<string>;
};

export function normalizeBulkLeadEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

export function normalizeBulkLeadPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

export function findBulkLeadIdentityConflict(
  identity: BulkLeadIdentity,
  existing: BulkLeadIdentitySets,
): "email" | "phone" | "email and phone" | null {
  const emailConflict = Boolean(
    identity.email && existing.emails.has(identity.email),
  );
  const phoneConflict = Boolean(
    identity.phoneE164 && existing.phones.has(identity.phoneE164),
  );

  if (emailConflict && phoneConflict) return "email and phone";
  if (emailConflict) return "email";
  if (phoneConflict) return "phone";
  return null;
}

export function rememberBulkLeadIdentity(
  identity: BulkLeadIdentity,
  existing: BulkLeadIdentitySets,
): void {
  if (identity.email) existing.emails.add(identity.email);
  if (identity.phoneE164) existing.phones.add(identity.phoneE164);
}
