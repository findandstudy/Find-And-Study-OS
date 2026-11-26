import { pool } from '@workspace/db';
import { ContractDeliveryStore, type ContractDeliveryRow } from './contractDeliveryStore';
import { contractDeliveryMode, contractSmtpScope, contractSmtpMessageAllowed, type ContractSmtpScope } from './contractDeliveryPolicy';
import type { ContractSmtpOutcome } from './contractSmtpReceipt';
import { buildSignedContractEmail, getAppBaseUrl, prepareContractSmtpTransport } from './email';
import { ObjectStorageService } from './objectStorage';
import { readBoundedDocumentStream } from './documentByteLimits';

type Transport = NonNullable<Awaited<ReturnType<typeof prepareContractSmtpTransport>>>;
export interface ContractDeliveryDependencies {
  store: ContractDeliveryStore;
  prepare: (row: ContractDeliveryRow) => Promise<{ artifact: { key: string; evidenceHash: string; bytes: Buffer }; email: { subject: string; html: string; text: string } }>;
  readPdf: (key: string) => Promise<Buffer>;
  transport: () => Promise<Transport | null>;
  sendScope: () => ContractSmtpScope | null;
  maySend: (row: ContractDeliveryRow) => boolean;
}

/** One bounded sweep through actual durable transitions; dependencies are fake in tests. */
export async function runContractDeliverySweep(deps: ContractDeliveryDependencies): Promise<void> {
  const preparing = await deps.store.claimPreparation();
  if (preparing) {
    try {
      const prepared = await deps.prepare(preparing);
      await deps.store.bindPrepared(preparing, prepared.artifact, prepared.email);
    } catch {
      await deps.store.failPreparation(preparing);
    }
  }
  const scope = deps.sendScope();
  const ready = await deps.store.nextReady(scope);
  if (!ready || !deps.maySend(ready)) return;
  let transport: Transport | null = null;
  try {
    let pdf: Buffer;
    try { pdf = await deps.readPdf(ready.pdf_object_key); }
    catch { await deps.store.failReady(ready,'CONTRACT_ATTACHMENT_CHANGED'); return; }
    transport = await deps.transport();
    if (!transport || !deps.maySend(ready)) return;
    // SMTP must not begin unless this unique attempt is committed first.
    const sending = await deps.store.claimSending(ready, pdf, deps.sendScope());
    if (!sending) return;
    if (!deps.maySend(sending)) {
      await deps.store.finishSending(sending, { state: 'ambiguous', code: 'CONTRACT_SCOPE_CHANGED_BEFORE_SEND' });
      return;
    }
    let outcome: ContractSmtpOutcome;
    try {
      outcome = await transport.send({ signedContractId: sending.signed_contract_id, enrolledAt: sending.created_at,
        signedAt: sending.signature_signed_at, recipient: sending.recipient, messageId: sending.message_id,
        subject: sending.subject, html: sending.html_body, text: sending.text_body, pdf });
    } catch { outcome = { state: 'ambiguous', code: 'SMTP_OUTCOME_UNCONFIRMED' }; }
    // A DB failure after acceptance leaves SENDING; next sweep marks it
    // AMBIGUOUS. It cannot send again or falsely claim it was accepted.
    await deps.store.finishSending(sending, outcome);
  } finally { transport?.close(); }
}

async function readPdf(key: string): Promise<Buffer> {
  if (!/^\/objects\/signed-contracts\/[a-zA-Z0-9._-]+$/.test(key)) throw new Error('CONTRACT_PDF_KEY_INVALID');
  const file = await new ObjectStorageService().getObjectEntityFile(key);
  return readBoundedDocumentStream(file.createReadStream(), { maxBytes: 10 * 1024 * 1024, readTimeoutMs: 10000 });
}
const store = new ContractDeliveryStore(pool);
const runtime: ContractDeliveryDependencies = {
  store, readPdf, transport: prepareContractSmtpTransport, sendScope: contractSmtpScope,
  maySend: row => contractSmtpMessageAllowed({ signedContractId: row.signed_contract_id, recipient: row.recipient,
    enrolledAt: row.created_at, signedAt: row.signature_signed_at }),
  async prepare(row) {
    const client = await pool.connect();
    let source: any;
    try {
      const result = await client.query(`SELECT sc.id,sc.pdf_object_key,sc.evidence_hash,sc.signer_name,
        ss.template_name_snapshot,ss.template_language_snapshot
        FROM signed_contracts sc JOIN signing_sessions ss ON ss.id=sc.signing_session_id
        WHERE sc.id=$1 AND sc.signing_session_id=$2 AND lower(btrim(sc.signer_email))=$3
          AND ss.status='signed' AND ss.revoked_at IS NULL AND sc.emailed_at IS NULL`,
      [row.signed_contract_id,row.signing_session_id,row.recipient]);
      source = result.rows[0];
    } finally { client.release(); }
    if (!source?.template_name_snapshot || !source.template_language_snapshot) throw new Error('CONTRACT_SNAPSHOT_MISSING');
    if (!source.pdf_object_key || !source.evidence_hash) {
      // Only an atomically enrolled new signature reaches this branch.
      const { renderEnrolledContractPdf } = await import('./contractDeliveryPdf');
      const built = await renderEnrolledContractPdf(row);
      source.pdf_object_key = built.pdfObjectKey; source.evidence_hash = built.evidenceHash;
    }
    const portal = new URL('/agent/account', getAppBaseUrl());
    if (portal.protocol !== 'https:' || portal.username || portal.password) throw new Error('CONTRACT_PORTAL_URL_INVALID');
    const email = await buildSignedContractEmail({ signerName: source.signer_name, templateName: source.template_name_snapshot,
      portalUrl: portal.toString(), language: source.template_language_snapshot });
    return { artifact: { key: source.pdf_object_key, evidenceHash: source.evidence_hash, bytes: await readPdf(source.pdf_object_key) }, email };
  },
};

/** Default-off; existing scheduler/coordinator owns its lifecycle. No app startup here. */
export function startDurableContractDeliveryWorker(intervalMs = 30000): () => Promise<void> {
  if (contractDeliveryMode() === 'off') return async () => {};
  let stopped = false;
  let current: Promise<void> | null = null;
  const sweep = () => {
    if (stopped || current || contractDeliveryMode() === 'off') return;
    current = runContractDeliverySweep(runtime).catch(() => {
      console.error('[contract-delivery] Sweep requires inspection; no automatic SMTP retry');
    }).finally(() => { current = null; });
  };
  const initial = setTimeout(sweep, 15000);
  const interval = setInterval(sweep, Math.max(1000, intervalMs));
  initial.unref(); interval.unref();
  return async () => { stopped = true; clearTimeout(initial); clearInterval(interval); await current; };
}
