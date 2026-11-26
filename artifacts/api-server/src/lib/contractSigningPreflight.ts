import { JSDOM } from 'jsdom';
import { buildAgentContext, buildFinalSignedContractHtml, contractNumber } from './contractRenderer';
import { sanitizeContractBranding, validateCompanySignatureDataUrl } from './contractBranding';
import { contractSigningIntakeRequirements, missingContractTemplateFields, normalizeContractSigningIntake } from './contractSigningFields';

/** Frozen contract preparation only: no database, storage, queue or provider. */
export function prepareFrozenContractPdf(snapshot: { contract: any; session: any }) {
  const c = snapshot.contract, s = snapshot.session;
  if (c.pdf_object_key || c.evidence_hash || s.status !== 'signed' || s.revoked_at || c.signing_session_id !== s.id
    || c.template_id !== s.template_id || typeof s.template_body_html_snapshot !== 'string' || !s.template_body_html_snapshot
    || Buffer.byteLength(s.template_body_html_snapshot)>2*1024*1024
    || !s.template_name_snapshot || !s.template_language_snapshot || !s.template_version_snapshot
    || (s.intake_data != null && (typeof s.intake_data !== 'object' || Array.isArray(s.intake_data)))) throw new Error('CONTRACT_FROZEN_INPUT_REQUIRED');
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
  const intake = normalizeContractSigningIntake(s.intake_data);
  const reserved:Record<string,string>={contract_number:number,sign_date:signedAt.toISOString().slice(0,10),year:String(signedAt.getUTCFullYear()),
    signer_email:c.signer_email,signer_name:c.signer_name||'',signature,main_agency_signature:branding.companySignatureDataUrl};
  for (const [key,value] of Object.entries(reserved)) {
    if (Object.prototype.hasOwnProperty.call(intake,key) && intake[key]!==value) throw new Error('CONTRACT_RESERVED_METADATA_CONFLICT');
  }
  const ctx = buildAgentContext(null, intake, { signerEmail: c.signer_email, signerName: c.signer_name, date: signedAt.toISOString().slice(0,10), number });
  ctx.signature = signature; ctx.main_agency_signature = branding.companySignatureDataUrl;
  const required = contractSigningIntakeRequirements({ bodyHtml: s.template_body_html_snapshot, intakeSchema:s.template_intake_schema_snapshot, intakeData:intake });
  const missingFields = [...new Set([...required.missingFields, ...missingContractTemplateFields(s.template_body_html_snapshot,ctx)])];
  if (missingFields.length) throw Object.assign(new Error('CONTRACT_FROZEN_FIELD_MISSING'), { missingFields });
  const bodyHtml = buildFinalSignedContractHtml({ bodyHtml:s.template_body_html_snapshot,templateLanguage:s.template_language_snapshot,
    agent:null,intakeData:intake,signerEmail:c.signer_email,signerName:c.signer_name,signedAt,signatureBase64:c.signature_image_base64,
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

/** Pure pre-sign validation: no Chromium, storage, provider or DB operation. */
export function preflightUnsignedContractPdf(session: any, input: { signedAt: Date; signatureBase64: string; signerName: string | null;
  signerIp: string | null; signerUserAgent: string | null; evidence: { required: boolean; method: string | null; verifiedAt: Date | null } }) {
  return prepareFrozenContractPdf({
    contract: { signing_session_id: session.id, template_id: session.templateId, pdf_object_key: null, evidence_hash: null,
      signature_image_base64: input.signatureBase64, signed_at: input.signedAt, signer_email: session.signerEmail,
      signer_name: input.signerName, signer_ip: input.signerIp, signer_user_agent: input.signerUserAgent,
      email_verification_required: input.evidence.required, email_verification_method: input.evidence.method, email_verified_at: input.evidence.verifiedAt },
    session: { id: session.id, template_id: session.templateId, status: 'signed', revoked_at: session.revokedAt, signed_at: input.signedAt,
      template_body_html_snapshot: session.templateBodyHtmlSnapshot, template_name_snapshot: session.templateNameSnapshot,
      template_language_snapshot: session.templateLanguageSnapshot, template_version_snapshot: session.templateVersionSnapshot,
      template_intake_schema_snapshot: session.templateIntakeSchemaSnapshot,
      template_signing_page_config_snapshot: session.templateSigningPageConfigSnapshot, intake_data: session.intakeData },
  });
}

/** Compare only inputs that authorized this signature; incidental openedAt is not one. */
export function signingSnapshotIdentity(session: any): string {
  const fields = ['id','templateId','mode','status','expiresAt','revokedAt','agentId','subjectType','subjectId','signerEmail','expectedEmail','signerName',
    'verifiedEmail','emailVerificationMethod','emailVerifiedAt','templateBodyHtmlSnapshot','templateNameSnapshot',
    'templateLanguageSnapshot','templateVersionSnapshot','templateIntakeSchemaSnapshot','templateSigningPageConfigSnapshot','intakeData'];
  return JSON.stringify(fields.map(field => session[field] ?? null));
}
