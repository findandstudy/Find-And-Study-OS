/** Apply legacy compatibility only; no automatic adoption of historical rows. */
export function contractDeliveryMode(env: NodeJS.ProcessEnv = process.env): 'off' | 'prepare' | 'send' {
  if (env.SIGNED_CONTRACT_DELIVERY_ENABLED !== 'false' || env.SIGNED_CONTRACT_PDF_WORKER_ENABLED !== 'false') return 'off';
  const mode = env.SIGNED_CONTRACT_DURABLE_DELIVERY_MODE;
  return mode === 'prepare' || mode === 'send' ? mode : 'off';
}
export function contractSmtpAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return contractDeliveryMode(env) === 'send' && env.NODE_ENV !== 'test'
    && env.EMAIL_DELIVERY_DISABLED !== 'true' && env.ALLOW_LIVE_INTEGRATIONS === 'true';
}
