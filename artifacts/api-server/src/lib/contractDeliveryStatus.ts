import { pool } from '@workspace/db';
export type ContractDeliverySummary = { state: 'pending' | 'sent' | 'attention' | 'unconfirmed'; acceptedAt: Date | string | null };
/** Caller must first resolve an authorized session (token/own-agent/admin scope). */
export async function readContractDeliveryStatus(sessionId: number, agentId?: number): Promise<ContractDeliverySummary> {
  const unknown:ContractDeliverySummary={state:'unconfirmed',acceptedAt:null};
  if (!Number.isSafeInteger(sessionId)||sessionId<=0) return unknown;
  try {
    // Safe with the pre-migration default-off release. Do not trust legacy
    // emailed_at alone: the old sender could set it without SMTP acceptance.
    const exists=await pool.query("SELECT to_regclass('public.signed_contract_deliveries') IS NOT NULL AS present");
    if(!exists.rows[0]?.present)return unknown;
    const result=await pool.query(`SELECT d.state,d.accepted_at,
      (sc.emailed_at=d.accepted_at AND sc.pdf_object_key=d.pdf_object_key AND sc.evidence_hash=d.evidence_hash
        AND lower(btrim(sc.signer_email))=d.recipient AND d.receipt->>'recipient'=d.recipient
        AND d.receipt->>'messageId'=d.message_id) AS accepted_proven
      FROM signed_contract_deliveries d JOIN signed_contracts sc ON sc.id=d.signed_contract_id
      JOIN signing_sessions ss ON ss.id=d.signing_session_id AND ss.id=sc.signing_session_id
      WHERE d.signing_session_id=$1 AND ss.status='signed' AND ss.revoked_at IS NULL
        AND ($2::integer IS NULL OR sc.agent_id=$2) LIMIT 1`,[sessionId,agentId??null]);
    const row=result.rows[0];if(!row)return unknown;
    if(row.state==='accepted')return row.accepted_proven===true?{state:'sent',acceptedAt:row.accepted_at}:unknown;
    if(['waiting_pdf','preparing','ready','sending'].includes(row.state))return{state:'pending',acceptedAt:null};
    return{state:'attention',acceptedAt:null};
  }catch{return unknown;}
}
