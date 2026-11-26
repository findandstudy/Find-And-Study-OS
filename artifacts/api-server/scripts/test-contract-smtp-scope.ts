import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contractSmtpAllowed, contractSmtpScope, contractSmtpMessageAllowed } from '../src/lib/contractDeliveryPolicy';

const base: NodeJS.ProcessEnv = { NODE_ENV: 'production', SIGNED_CONTRACT_DELIVERY_ENABLED: 'false',
  SIGNED_CONTRACT_PDF_WORKER_ENABLED: 'false', SIGNED_CONTRACT_DURABLE_DELIVERY_MODE: 'send',
  SIGNED_CONTRACT_SMTP_ENABLED: 'true', SIGNED_CONTRACT_SMTP_SCOPE: 'canary',
  SIGNED_CONTRACT_SMTP_CANARY_CONTRACT_ID: '47', SIGNED_CONTRACT_SMTP_CANARY_RECIPIENT: 'test+canary@example.invalid' };
const message = { signedContractId: 47, recipient: 'test+canary@example.invalid',
  signedAt: '2026-11-25T00:00:00.000Z', enrolledAt: '2026-11-25T00:00:00.000Z' };

test('contract-only opt-in works with global live setting unset and never mutates it', () => {
  const snapshot = { ...base };
  assert.equal(contractSmtpAllowed(base), true);
  assert.equal(contractSmtpMessageAllowed(message, base), true);
  assert.deepEqual(base, snapshot);
  assert.equal(base.ALLOW_LIVE_INTEGRATIONS, undefined);
});
test('default-off, prepare, explicit global vetoes and invalid settings fail closed', () => {
  for (const patch of [
    { SIGNED_CONTRACT_SMTP_ENABLED: undefined }, { SIGNED_CONTRACT_SMTP_ENABLED: 'false' },
    { SIGNED_CONTRACT_DURABLE_DELIVERY_MODE: 'prepare' }, { NODE_ENV: 'test' },
    { SIGNED_CONTRACT_DELIVERY_ENABLED: 'true' }, { SIGNED_CONTRACT_PDF_WORKER_ENABLED: undefined },
    { ALLOW_LIVE_INTEGRATIONS: 'false' }, { ALLOW_LIVE_INTEGRATIONS: '' },
    { EMAIL_DELIVERY_DISABLED: 'true' }, { EMAIL_DELIVERY_DISABLED: 'invalid' },
    { SIGNED_CONTRACT_SMTP_SCOPE: undefined }, { SIGNED_CONTRACT_SMTP_SCOPE: 'all' },
  ]) assert.equal(contractSmtpAllowed({ ...base, ...patch }), false, JSON.stringify(patch));
});
test('canary requires exact single bounded contract and canonical recipient', () => {
  for (const id of ['0', '-1', '01', '1,47', '*', '2147483648'])
    assert.equal(contractSmtpScope({ ...base, SIGNED_CONTRACT_SMTP_CANARY_CONTRACT_ID: id }), null);
  for (const recipient of ['*', 'TEST@example.invalid', ' test@example.invalid', 'a@example.invalid,b@example.invalid', 'a@example.invalid\r\nBcc: b@example.invalid'])
    assert.equal(contractSmtpScope({ ...base, SIGNED_CONTRACT_SMTP_CANARY_RECIPIENT: recipient }), null);
  assert.equal(contractSmtpMessageAllowed({ ...message, signedContractId: 48 }, base), false);
  assert.equal(contractSmtpMessageAllowed({ ...message, recipient: 'other@example.invalid' }, base), false);
});
test('future scope requires fixed canonical UTC cutoff for both signature and enrollment', () => {
  const env = { ...base, SIGNED_CONTRACT_SMTP_SCOPE: 'future', SIGNED_CONTRACT_SMTP_FUTURE_FROM: '2026-11-25T00:00:00.000Z' };
  assert.equal(contractSmtpMessageAllowed(message, env), true);
  assert.equal(contractSmtpMessageAllowed({ ...message, signedContractId: 48, recipient: 'next@example.invalid' }, env), true);
  assert.equal(contractSmtpMessageAllowed({ ...message, signedAt: '2026-11-24T23:59:59.999Z' }, env), false);
  assert.equal(contractSmtpMessageAllowed({ ...message, enrolledAt: '2026-11-24T23:59:59.999Z' }, env), false);
  assert.equal(contractSmtpMessageAllowed({ ...message, signedAt: 'invalid' }, env), false);
  for (const from of [undefined, '', '2026-11-25', '2026-11-25T03:00:00+03:00', '2026-02-30T00:00:00.000Z'])
    assert.equal(contractSmtpScope({ ...env, SIGNED_CONTRACT_SMTP_FUTURE_FROM: from }), null);
});
