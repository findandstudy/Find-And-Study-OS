import crypto from "node:crypto";

type TokenKind = "email-proof" | "upload-ticket";

type TokenPayload = {
  kind: TokenKind;
  email: string;
  expiresAt: number;
  objectPath?: string;
  documentKind?: "logo" | "representative_id" | "business_registration";
};

function secret(): string {
  const configured = process.env.AGENT_APPLICATION_TOKEN_SECRET
    || process.env.SESSION_SECRET
    || process.env.JWT_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AGENT_APPLICATION_TOKEN_SECRET is required in production");
  }
  return "find-and-study-local-agent-application-secret";
}

function signature(encodedPayload: string): string {
  return crypto.createHmac("sha256", secret()).update(encodedPayload).digest("base64url");
}

function issue(payload: TokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

function read(token: string, kind: TokenKind): TokenPayload | null {
  const [encoded, suppliedSignature] = token.split(".");
  if (!encoded || !suppliedSignature) return null;
  const expectedSignature = signature(encoded);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as TokenPayload;
    if (payload.kind !== kind || !payload.email || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now()) return null;
    return { ...payload, email: payload.email.trim().toLowerCase() };
  } catch {
    return null;
  }
}

export function issueAgentApplicationEmailProof(email: string): string {
  return issue({
    kind: "email-proof",
    email: email.trim().toLowerCase(),
    expiresAt: Date.now() + 30 * 60 * 1000,
  });
}

export function readAgentApplicationEmailProof(token: string): TokenPayload | null {
  return read(token, "email-proof");
}

export function issueAgentApplicationUploadTicket(params: {
  email: string;
  objectPath: string;
  documentKind: "logo" | "representative_id" | "business_registration";
}): string {
  return issue({
    kind: "upload-ticket",
    email: params.email.trim().toLowerCase(),
    objectPath: params.objectPath,
    documentKind: params.documentKind,
    expiresAt: Date.now() + 15 * 60 * 1000,
  });
}

export function readAgentApplicationUploadTicket(token: string): TokenPayload | null {
  return read(token, "upload-ticket");
}

export function agentApplicationUploadPrefix(email: string): string {
  const emailHash = crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 24);
  return `agent-applications/pending/${emailHash}`;
}
