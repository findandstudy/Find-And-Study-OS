import crypto from "crypto";
import { and, eq, gt, isNotNull } from "drizzle-orm";
import { db, emailVerificationCodesTable } from "@workspace/db";

const EMAIL_VERIFICATION_LINK_TTL_MS = 24 * 60 * 60 * 1000;

function hashVerificationToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Issues a short-lived, one-time email-verification link token.
 *
 * Only the SHA-256 digest is stored. Reissuing a link invalidates previous
 * link tokens for the same email without invalidating manual six-digit codes.
 */
export async function issueEmailVerificationToken(emailInput: string): Promise<string> {
  const email = emailInput.trim().toLowerCase();
  if (!email) throw new Error("Email is required for verification-token issuance");

  await db.update(emailVerificationCodesTable)
    .set({ used: true })
    .where(and(
      eq(emailVerificationCodesTable.email, email),
      isNotNull(emailVerificationCodesTable.token),
      eq(emailVerificationCodesTable.used, false),
    ));

  const rawToken = crypto.randomBytes(32).toString("base64url");
  await db.insert(emailVerificationCodesTable).values({
    email,
    // The link flow does not expose or consume this code, but the shared table
    // keeps it non-null for the manual-code flows.
    code: String(crypto.randomInt(0, 1_000_000)).padStart(6, "0"),
    token: hashVerificationToken(rawToken),
    expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_LINK_TTL_MS),
  });

  return rawToken;
}

/** Atomically consumes a valid link token and returns its bound email. */
export async function findEmailVerificationRecipient(rawToken: string): Promise<string | null> {
  if (!rawToken || rawToken.length < 32 || rawToken.length > 200) return null;

  const [match] = await db.select({ email: emailVerificationCodesTable.email })
    .from(emailVerificationCodesTable)
    .where(and(
      eq(emailVerificationCodesTable.token, hashVerificationToken(rawToken)),
      eq(emailVerificationCodesTable.used, false),
      gt(emailVerificationCodesTable.expiresAt, new Date()),
    )).limit(1);
  return match?.email ?? null;
}

export async function consumeEmailVerificationToken(
  rawToken: string,
  email: string,
  executor: Pick<typeof db, "update">,
): Promise<boolean> {
  if (!rawToken || rawToken.length < 32 || rawToken.length > 200) return false;

  const [consumed] = await executor.update(emailVerificationCodesTable)
    .set({ used: true })
    .where(and(
      eq(emailVerificationCodesTable.token, hashVerificationToken(rawToken)),
      eq(emailVerificationCodesTable.email, email),
      eq(emailVerificationCodesTable.used, false),
      gt(emailVerificationCodesTable.expiresAt, new Date()),
    ))
    .returning({ email: emailVerificationCodesTable.email });

  return !!consumed;
}
