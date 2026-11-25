import { pool } from '@workspace/db';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { buildAgentContext, buildFinalSignedContractHtml, contractNumber } from './contractRenderer';
import { sanitizeContractBranding, validateCompanySignatureDataUrl } from './contractBranding';
import { buildSignedPdf } from './contractPdf';
import { ObjectStorageService } from './objectStorage';
import { withRenderLock } from './renderLock';
import type { ContractDeliveryRow } from './contractDeliveryStore';

export function prepareEnrolledPdf(snapshot: { contract: any; session: any }) {
  const c = snapshot.contract, s = snapshot.session;
  if (c.pdf_object_key || c.evidence_hash || s.status !== 'signed' || s.revoked_at || c.signing_session_id !== s.id
    || c.template_id !== s.template_id || typeof s.template_body_html_snapshot !== 'string' || !s.template_body_html_snapshot
    || Buffer.byteLength(s.template_body_html_snapshot)>2*1024*1024
    || !s.template_name_snapshot || !s.template_language_snapshot || !s.template_version_snapshot
    || !s.intake_data || typeof s.intake_data !== 'object' || Array.isArray(s.intake_data)) throw new Error('CONTRACT_FROZEN_INPUT_REQUIRED');
  const branding = sanitizeContractBranding(s.template_signing_page_config_snapshot);
  const signature = `data:image/png;base64,${c.signature_image_base64 || ''}`;
  if (!branding?.companySignatureDataUrl || validateCompanySignatureDataUrl(signature) !== null
    || Buffer.from(c.signature_image_base64, 'base64').toString('base64') !== c.signature_image_base64) throw new Error('CONTRACT_FROZEN_SIGNATURE_REQUIRED');
  const signedAt = new Date(c.signed_at);
  const verifiedAt = c.email_verified_at ? new Date(c.email_verified_at) : null;
  if (!Number.isFinite(signedAt.getTime()) || new Date(s.signed_at).getTime() !== signedAt.getTime()
    || typeof c.email_verification_required !== 'boolean'
    || (c.email_verification_required && (!verifiedAt || !Number.isFinite(verifiedAt.getTime()) || verifiedAt > signedAt
      || !['one_time_code','verified_agent_application','authenticated_portal_session','legacy_verified_email'].includes(c.email_verification_method)))
    || (!c.email_verification_required && (c.email_verification_method!=='not_required' || verifiedAt))) throw new Error('CONTRACT_FROZEN_EVIDENCE_REQUIRED');
  const number = contractNumber(s.id, signedAt);
  const reserved:Record<string,string>={contract_number:number,sign_date:signedAt.toISOString().slice(0,10),year:String(signedAt.getUTCFullYear()),
    signer_email:c.signer_email,signer_name:c.signer_name||'',signature,main_agency_signature:branding.companySignatureDataUrl};
  for (const [key,value] of Object.entries(reserved)) {
    if (Object.prototype.hasOwnProperty.call(s.intake_data,key) && s.intake_data[key]!==value) throw new Error('CONTRACT_RESERVED_METADATA_CONFLICT');
  }
  const ctx = buildAgentContext(null, s.intake_data, { signerEmail: c.signer_email, signerName: c.signer_name, date: signedAt.toISOString().slice(0,10), number });
  ctx.signature = signature; ctx.main_agency_signature = branding.companySignatureDataUrl;
  for (const match of s.template_body_html_snapshot.matchAll(/\{\{\{?\s*([\w.]+)\s*\}\}\}?/g)) {
    const parts = match[1].split('.');
    if (parts.some((part: string) => ['__proto__','prototype','constructor'].includes(part))) throw new Error('CONTRACT_FROZEN_FIELD_MISSING');
    const value = parts.reduce((current: any, part: string) => current && Object.prototype.hasOwnProperty.call(current,part) ? current[part] : undefined, ctx);
    const fallback = parts.length === 1 ? [ctx.intake,ctx.agent,ctx.contract].map(scope => scope?.[parts[0]]).find(v => v !== undefined && v !== '') : undefined;
    if ((value === undefined || value === null || value === '') && (fallback === undefined || fallback === null || fallback === '')) throw new Error('CONTRACT_FROZEN_FIELD_MISSING');
  }
  const bodyHtml = buildFinalSignedContractHtml({ bodyHtml:s.template_body_html_snapshot,templateLanguage:s.template_language_snapshot,
    agent:null,intakeData:s.intake_data,signerEmail:c.signer_email,signerName:c.signer_name,signedAt,signatureBase64:c.signature_image_base64,
    contractNumber:number,signingPageConfig:s.template_signing_page_config_snapshot });
  const document = new JSDOM(bodyHtml);
  try {
    for (const image of document.window.document.querySelectorAll('img')) {
      // Inspect the actual attribute, never similarly named data-src/srcset.
      if (validateCompanySignatureDataUrl(image.getAttribute('src')) !== null) throw new Error('CONTRACT_LOGO_SNAPSHOT_REQUIRED');
    }
  } finally { document.window.close(); }
  return { bodyHtml,templateName:s.template_name_snapshot,signerEmail:c.signer_email,signerName:c.signer_name,
    signerIp:c.signer_ip,signerUserAgent:c.signer_user_agent,signedAt,emailVerificationRequired:c.email_verification_required,
    emailVerificationMethod:c.email_verification_method,emailVerifiedAt:verifiedAt };
}
const sourceQuery = `SELECT jsonb_build_object('contract',to_jsonb(sc),'session',to_jsonb(ss)-'token_hash') AS source
  FROM signed_contracts sc JOIN signing_sessions ss ON ss.id=sc.signing_session_id
  JOIN signed_contract_deliveries d ON d.signed_contract_id=sc.id
  WHERE d.signed_contract_id=$1 AND d.state='preparing' AND d.claim_id=$2
    AND sc.signing_session_id=d.signing_session_id AND lower(btrim(sc.signer_email))=d.recipient AND sc.emailed_at IS NULL`;
/** Only future, explicitly enrolled records. No current template, agent or seal lookup. */
export async function renderEnrolledContractPdf(row: ContractDeliveryRow): Promise<{pdfObjectKey:string;evidenceHash:string}> {
  return withRenderLock(async () => {
    const client = await pool.connect();
    try {
      const result = await client.query(sourceQuery,[row.signed_contract_id,row.claim_id]);
      if (result.rows.length !== 1) throw new Error('CONTRACT_DELIVERY_OWNER_CHANGED');
      const source = result.rows[0].source;
      const params = prepareEnrolledPdf(source);
      const digest = createHash('sha256').update(JSON.stringify(source)).digest('hex');
      const built = await buildSignedPdf(params);
      const pdfObjectKey = await new ObjectStorageService().uploadBuffer({ subdir:'signed-contracts',filename:`contract-${row.signing_session_id}.pdf`,buffer:Buffer.from(built.pdfBytes),contentType:'application/pdf' });
      await client.query('BEGIN');
      const fresh = await client.query(`${sourceQuery} FOR UPDATE OF sc,ss,d`,[row.signed_contract_id,row.claim_id]);
      if (fresh.rows.length !== 1 || createHash('sha256').update(JSON.stringify(fresh.rows[0].source)).digest('hex') !== digest) throw new Error('CONTRACT_FROZEN_INPUT_CHANGED');
      const saved = await client.query(`UPDATE signed_contracts SET pdf_object_key=$2,evidence_hash=$3
        WHERE id=$1 AND pdf_object_key IS NULL AND evidence_hash IS NULL AND emailed_at IS NULL RETURNING id`,[row.signed_contract_id,pdfObjectKey,built.evidenceHash]);
      if (saved.rowCount !== 1) throw new Error('CONTRACT_FINAL_ARTIFACT_EXISTS');
      await client.query('COMMIT');
      return {pdfObjectKey,evidenceHash:built.evidenceHash};
    } catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
    finally {client.release();}
  });
}
