/** Apply legacy compatibility only; no automatic adoption of historical rows. */
export function contractDeliveryMode(env: NodeJS.ProcessEnv = process.env): 'off' | 'prepare' | 'send' {
  if (env.SIGNED_CONTRACT_DELIVERY_ENABLED !== 'false' || env.SIGNED_CONTRACT_PDF_WORKER_ENABLED !== 'false') return 'off';
  const mode = env.SIGNED_CONTRACT_DURABLE_DELIVERY_MODE;
  return mode === 'prepare' || mode === 'send' ? mode : 'off';
}
export function contractSmtpAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return contractSmtpScope(env) !== null;
}

export type ContractSmtpScope =
  | { kind: 'canary'; signedContractId: number; recipient: string }
  | { kind: 'future'; from: string };

function canonicalRecipient(value: string): boolean {
  return typeof value === 'string' && value.length <= 254 && value === value.trim().toLowerCase()
    && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(value);
}

/** Contract-specific permission never enables unrelated live integrations. */
export function contractSmtpScope(env: NodeJS.ProcessEnv = process.env): ContractSmtpScope | null {
  if (contractDeliveryMode(env) !== 'send' || env.NODE_ENV !== 'production'
    || env.SIGNED_CONTRACT_SMTP_ENABLED !== 'true'
    || (env.EMAIL_DELIVERY_DISABLED !== undefined && env.EMAIL_DELIVERY_DISABLED !== 'false')
    || (env.ALLOW_LIVE_INTEGRATIONS !== undefined && env.ALLOW_LIVE_INTEGRATIONS !== 'true')) return null;
  if (env.SIGNED_CONTRACT_SMTP_SCOPE === 'canary') {
    const id = env.SIGNED_CONTRACT_SMTP_CANARY_CONTRACT_ID ?? '';
    const recipient = env.SIGNED_CONTRACT_SMTP_CANARY_RECIPIENT ?? '';
    if (!/^[1-9]\d{0,9}$/.test(id) || Number(id) > 2147483647 || !canonicalRecipient(recipient)) return null;
    return { kind: 'canary', signedContractId: Number(id), recipient };
  }
  if (env.SIGNED_CONTRACT_SMTP_SCOPE === 'future') {
    const from = env.SIGNED_CONTRACT_SMTP_FUTURE_FROM ?? '';
    const date = new Date(from);
    if (!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(from)
      || !Number.isFinite(date.getTime()) || date.toISOString() !== from) return null;
    return { kind: 'future', from };
  }
  return null;
}

export interface ContractSmtpIdentity {
  signedContractId: number;
  recipient: string;
  enrolledAt: Date | string;
  signedAt: Date | string;
}

export function contractMatchesSmtpScope(identity: ContractSmtpIdentity, scope: ContractSmtpScope | null): boolean {
  if (!scope || !Number.isSafeInteger(identity.signedContractId) || identity.signedContractId <= 0 || !canonicalRecipient(identity.recipient)) return false;
  if (scope.kind === 'canary') return identity.signedContractId === scope.signedContractId && identity.recipient === scope.recipient;
  const from = new Date(scope.from).getTime();
  const enrolled = new Date(identity.enrolledAt).getTime(), signed = new Date(identity.signedAt).getTime();
  return Number.isFinite(enrolled) && Number.isFinite(signed) && enrolled >= from && signed >= from;
}

/** Re-evaluated immediately before SMTP; missing/changed scope never sends. */
export function contractSmtpMessageAllowed(identity: ContractSmtpIdentity, env: NodeJS.ProcessEnv = process.env): boolean {
  return contractMatchesSmtpScope(identity, contractSmtpScope(env));
}
