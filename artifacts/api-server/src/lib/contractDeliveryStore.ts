import { createHash, randomUUID } from 'node:crypto';
import type { ContractSmtpOutcome } from './contractSmtpReceipt';
import { contractMatchesSmtpScope, type ContractSmtpScope } from './contractDeliveryPolicy';
export interface ContractDeliveryClient {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
  release(): void;
}
export interface ContractDeliveryPool { connect(): Promise<ContractDeliveryClient> }
export interface ContractDeliveryRow {
  signed_contract_id: number; signing_session_id: number; recipient: string; message_id: string;
  state: string; claim_id: string; pdf_object_key: string; pdf_sha256: string; evidence_hash: string;
  subject: string; html_body: string; text_body: string;
  created_at: Date; signature_signed_at: Date;
}
export const contractPdfDigest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function validateDeliveryPdf(bytes: Buffer): void {
  if (bytes.length < 100 || bytes.length > 10 * 1024 * 1024 || bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('CONTRACT_PDF_INVALID');
}

/** Prepared SQL schema, deliberately independent of the global email queue. */
export class ContractDeliveryStore {
  constructor(private pool: ContractDeliveryPool) {}
  private async transaction<T>(run: (client: ContractDeliveryClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='3s'");
      await client.query("SET LOCAL statement_timeout='10s'");
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  async claimPreparation(): Promise<ContractDeliveryRow | null> {
    return this.transaction(async client => {
      // Only preparation (no SMTP started) can retry, at most three times.
      await client.query(`UPDATE signed_contract_deliveries SET state=CASE WHEN prepare_attempts>=3 THEN 'failed' ELSE 'waiting_pdf' END,
        claim_id=NULL, claimed_at=NULL, updated_at=now(), failure_code='PREPARATION_LEASE_EXPIRED'
        WHERE state='preparing' AND claimed_at < now()-interval '5 minutes'`);
      const selected = await client.query(`SELECT signed_contract_id FROM signed_contract_deliveries
        WHERE state='waiting_pdf' AND prepare_attempts<3 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`);
      if (!selected.rows.length) return null;
      const result = await client.query(`UPDATE signed_contract_deliveries SET state='preparing', claim_id=$2, claimed_at=now(),
        prepare_attempts=prepare_attempts+1, updated_at=now() WHERE signed_contract_id=$1 RETURNING *`, [selected.rows[0].signed_contract_id, randomUUID()]);
      return result.rows[0];
    });
  }
  async failPreparation(row: ContractDeliveryRow): Promise<void> {
    await this.transaction(client => client.query(`UPDATE signed_contract_deliveries SET state='failed', failure_code='PREPARATION_FAILED', updated_at=now()
      WHERE signed_contract_id=$1 AND state='preparing' AND claim_id=$2`, [row.signed_contract_id, row.claim_id]).then(() => {}));
  }
  async bindPrepared(row: ContractDeliveryRow, artifact: { key: string; evidenceHash: string; bytes: Buffer }, email: { subject: string; html: string; text: string }): Promise<void> {
    validateDeliveryPdf(artifact.bytes);
    if (!/^\/objects\/signed-contracts\/[a-zA-Z0-9._-]+$/.test(artifact.key) || !/^[a-f0-9]{64}$/.test(artifact.evidenceHash)
      || !email.subject || email.subject.length > 1000 || email.html.length > 250000 || email.text.length > 250000) throw new Error('CONTRACT_DELIVERY_CONTENT_INVALID');
    await this.transaction(async client => {
      const result = await client.query(`UPDATE signed_contract_deliveries d SET state='ready',pdf_object_key=$3,pdf_sha256=$4,evidence_hash=$5,
        subject=$6,html_body=$7,text_body=$8,claim_id=NULL,claimed_at=NULL,updated_at=now()
        FROM signed_contracts sc JOIN signing_sessions ss ON ss.id=sc.signing_session_id
        WHERE d.signed_contract_id=$1 AND d.state='preparing' AND d.claim_id=$2 AND sc.id=d.signed_contract_id
        AND sc.signing_session_id=d.signing_session_id AND lower(btrim(sc.signer_email))=d.recipient
        AND sc.pdf_object_key=$3 AND sc.evidence_hash=$5 AND sc.emailed_at IS NULL AND ss.status='signed' AND ss.revoked_at IS NULL
        RETURNING d.signed_contract_id`, [row.signed_contract_id, row.claim_id, artifact.key, contractPdfDigest(artifact.bytes), artifact.evidenceHash, email.subject, email.html, email.text]);
      if (result.rowCount !== 1) throw new Error('CONTRACT_DELIVERY_BIND_CHANGED');
    });
  }
  async nextReady(scope: ContractSmtpScope | null): Promise<ContractDeliveryRow | null> {
    return this.transaction(async client => {
      // SMTP may have succeeded before a crash. Never return these to ready.
      await client.query(`UPDATE signed_contract_deliveries SET state='ambiguous',failure_code='SMTP_ATTEMPT_INTERRUPTED',updated_at=now()
        WHERE state='sending' AND sending_at < now()-interval '5 minutes'`);
      if (!scope) return null;
      const result = await client.query(`SELECT d.*, sc.signed_at AS signature_signed_at FROM signed_contract_deliveries d
        JOIN signed_contracts sc ON sc.id=d.signed_contract_id AND sc.signing_session_id=d.signing_session_id
        WHERE d.state='ready' AND ${scope.kind === 'canary' ? 'd.signed_contract_id=$1 AND d.recipient=$2' : 'd.created_at >= $1::timestamptz AND sc.signed_at >= $1::timestamptz'}
        ORDER BY d.created_at LIMIT 1`, scope.kind === 'canary' ? [scope.signedContractId, scope.recipient] : [scope.from]);
      return result.rows[0] ?? null;
    });
  }
  async failReady(row: ContractDeliveryRow, code: 'CONTRACT_ATTACHMENT_CHANGED' | 'CONTRACT_SOURCE_CHANGED'): Promise<void> {
    await this.transaction(client => client.query(`UPDATE signed_contract_deliveries SET state='failed',failure_code=$2,updated_at=now()
      WHERE signed_contract_id=$1 AND state='ready'`,[row.signed_contract_id,code]).then(()=>{}));
  }
  async claimSending(row: ContractDeliveryRow, bytes: Buffer, scope: ContractSmtpScope | null): Promise<ContractDeliveryRow | null> {
    if (!scope || !contractMatchesSmtpScope({ signedContractId: row.signed_contract_id, recipient: row.recipient,
      enrolledAt: row.created_at, signedAt: row.signature_signed_at }, scope)) return null;
    try {
      validateDeliveryPdf(bytes);
      if (contractPdfDigest(bytes) !== row.pdf_sha256) throw new Error('CONTRACT_ATTACHMENT_CHANGED');
    } catch(error) { await this.failReady(row,'CONTRACT_ATTACHMENT_CHANGED'); throw error; }
    return this.transaction(async client => {
      const result = await client.query(`UPDATE signed_contract_deliveries d SET state='sending',claim_id=$2,claimed_at=now(),sending_at=now(),updated_at=now()
        FROM signed_contracts sc JOIN signing_sessions ss ON ss.id=sc.signing_session_id
        WHERE d.signed_contract_id=$1 AND d.state='ready' AND d.pdf_sha256=$3 AND sc.id=d.signed_contract_id
        AND sc.signing_session_id=d.signing_session_id AND sc.pdf_object_key=d.pdf_object_key AND sc.evidence_hash=d.evidence_hash
        AND lower(btrim(sc.signer_email))=d.recipient AND sc.emailed_at IS NULL AND ss.status='signed' AND ss.revoked_at IS NULL
        AND ${scope.kind === 'canary' ? 'd.signed_contract_id=$4 AND d.recipient=$5' : 'd.created_at >= $4::timestamptz AND sc.signed_at >= $4::timestamptz'}
        RETURNING d.*, sc.signed_at AS signature_signed_at`, [row.signed_contract_id, randomUUID(), row.pdf_sha256,
          ...(scope.kind === 'canary' ? [scope.signedContractId, scope.recipient] : [scope.from])]);
      if (!result.rows.length) {
        // Invalid source must not permanently block every later ready item.
        // If another worker won the send claim this WHERE is a no-op.
        await client.query(`UPDATE signed_contract_deliveries SET state='failed',failure_code='CONTRACT_SOURCE_CHANGED',updated_at=now()
          WHERE signed_contract_id=$1 AND state='ready'`,[row.signed_contract_id]);
      }
      return result.rows[0] ?? null;
    });
  }
  async finishSending(row: ContractDeliveryRow, outcome: ContractSmtpOutcome): Promise<void> {
    if (outcome.state === 'accepted' && (outcome.receipt?.recipient !== row.recipient
      || outcome.receipt.messageId !== row.message_id || !/^[a-f0-9]{64}$/.test(outcome.receipt.responseSha256))) {
      throw new Error('CONTRACT_SMTP_RECEIPT_INVALID');
    }
    await this.transaction(async client => {
      const result = await client.query(`UPDATE signed_contract_deliveries SET state=$3,receipt=$4::jsonb,failure_code=$5,
        accepted_at=CASE WHEN $3='accepted' THEN clock_timestamp() ELSE NULL END,updated_at=now()
        WHERE signed_contract_id=$1 AND state='sending' AND claim_id=$2 RETURNING accepted_at`,
      [row.signed_contract_id, row.claim_id, outcome.state, outcome.state === 'accepted' ? JSON.stringify(outcome.receipt) : null, outcome.state === 'accepted' ? null : outcome.code]);
      if (result.rowCount !== 1) throw new Error('CONTRACT_DELIVERY_RECEIPT_CONFLICT');
      if (outcome.state === 'accepted') {
        // Copy the database timestamp directly: a JS Date would truncate its
        // microseconds and break the exact durable-receipt status projection.
        const updated = await client.query(`UPDATE signed_contracts sc SET emailed_at=d.accepted_at
          FROM signed_contract_deliveries d WHERE sc.id=$1 AND sc.emailed_at IS NULL
          AND sc.signing_session_id=$2 AND sc.pdf_object_key=$3 AND sc.evidence_hash=$4 AND lower(btrim(sc.signer_email))=$5
          AND d.signed_contract_id=sc.id AND d.state='accepted' AND d.claim_id=$6 RETURNING sc.id`,
        [row.signed_contract_id,row.signing_session_id,row.pdf_object_key,row.evidence_hash,row.recipient,row.claim_id]);
        if (updated.rowCount !== 1) throw new Error('CONTRACT_DELIVERY_SOURCE_CHANGED');
      }
    });
  }
}
