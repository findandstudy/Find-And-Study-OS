import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  ACTIVE_CONTEXT_V2_ALGORITHM,
  fingerprintActiveContextPublicKey,
  issueVersionedActiveTenantContext,
  signActiveTenantContext,
  type ActiveContextExternalSigner,
  type ActiveContextVerificationKey,
  type ActiveContextVersionedSubject,
  type ResolvedActiveContextState,
} from "../src/lib/activeTenantContext.js";
import {
  authorizeInstitutionMutation,
  type InstitutionCurrentAuthority,
  type InstitutionMutationAuthorizationOptions,
  type InstitutionMutationIdentity,
  type InstitutionMutationResource,
} from "../src/lib/institutionAdmissionsAuthorization.js";

const NOW = 2_000_000_000_000;
const ID = {
  context:"018fa000-0000-7000-8000-000000000001",
  tenant:"018fa000-0000-7000-8000-000000000002",
  otherTenant:"018fa000-0000-7000-8000-000000000003",
  relationship:"018fa000-0000-7000-8000-000000000004",
  otherRelationship:"018fa000-0000-7000-8000-000000000005",
  principal:"018fa000-0000-7000-8000-000000000006",
  otherPrincipal:"018fa000-0000-7000-8000-000000000007",
  membership:"018fa000-0000-7000-8000-000000000008",
  package:"018fa000-0000-7000-8000-000000000009",
  policy:"018fa000-0000-7000-8000-00000000000a",
  selection:"018fa000-0000-7000-8000-00000000000b",
  otherSelection:"018fa000-0000-7000-8000-00000000000c",
  stepUp:"018fa000-0000-7000-8000-00000000000d",
  issuer:"018fa000-0000-7000-8000-00000000000e",
};
const USER_ID = 901;
const SESSION_FINGERPRINT = "a".repeat(64);
const REQUEST_HASH = "b".repeat(64);
const CAPABILITY = "institution.decisions.approve" as const;
const RESOURCE_TYPE = "institution_decision";
const RESOURCE_ID = "018fa000-0000-7000-8000-00000000000f";
const AUDIENCE = "fas.institution.mutation";
const ENVIRONMENT = "test";
const CELL = "cell-a";
const KEY_ID = "institution-context-2026-09-a";
const KEY_REFERENCE = "test-memory://institution/key-a";

const pair = crypto.generateKeyPairSync("ed25519");
const publicKeyPem = pair.publicKey.export({type:"spki",format:"pem"}).toString();
const signer: ActiveContextExternalSigner = {
  async sign(input) {
    assert.equal(input.keyReference,KEY_REFERENCE);
    assert.equal(input.algorithm,ACTIVE_CONTEXT_V2_ALGORITHM);
    return crypto.sign(null,input.signingInput,pair.privateKey);
  },
};

function key(overrides:Partial<ActiveContextVerificationKey>={}):ActiveContextVerificationKey {
  return {
    keyId:KEY_ID,algorithm:ACTIVE_CONTEXT_V2_ALGORITHM,state:"ACTIVE",issuerId:ID.issuer,
    environmentId:ENVIRONMENT,cellId:CELL,publicKeyPem,
    publicKeyFingerprint:fingerprintActiveContextPublicKey(publicKeyPem),
    signFrom:NOW-60_000,signUntil:NOW+60_000,verifyUntil:NOW+120_000,...overrides,
  };
}

function subject(overrides:Partial<ActiveContextVersionedSubject>={}):ActiveContextVersionedSubject {
  return {
    contextId:ID.context,tenantId:ID.tenant,organizationId:null,legacyBranchId:null,
    principalId:ID.principal,membershipId:ID.membership,assignmentIds:[ID.membership],
    policyVersionId:ID.policy,policyVersion:3,selectionId:ID.selection,sessionGeneration:4,
    ...overrides,
  };
}

async function token(overrides:Partial<ActiveContextVersionedSubject>={},now=NOW) {
  return issueVersionedActiveTenantContext({subject:subject(overrides),audience:AUDIENCE,
    environmentId:ENVIRONMENT,cellId:CELL,issuerId:ID.issuer,keyId:KEY_ID,
    keyReference:KEY_REFERENCE,keyRing:[key()],signer,ttlMs:60_000,now});
}

function identity(overrides:Partial<InstitutionMutationIdentity>={}):InstitutionMutationIdentity {
  return {authenticatedUserId:USER_ID,authenticatedPrincipalId:ID.principal,tenantId:ID.tenant,
    relationshipId:ID.relationship,membershipId:ID.membership,sessionFingerprint:SESSION_FINGERPRINT,
    impersonatorPrincipalId:null,...overrides};
}

function resource(overrides:Partial<InstitutionMutationResource>={}):InstitutionMutationResource {
  return {tenantId:ID.tenant,relationshipId:ID.relationship,resourceType:RESOURCE_TYPE,
    resourceId:RESOURCE_ID,requestHash:REQUEST_HASH,...overrides};
}

function state(overrides:{
  principal?:Partial<ResolvedActiveContextState["principal"]>;
  membership?:Partial<ResolvedActiveContextState["membership"]>;
  assignment?:Partial<ResolvedActiveContextState["assignments"][number]>;
  capability?:Partial<ResolvedActiveContextState["assignments"][number]["capabilities"][number]>;
}={}):ResolvedActiveContextState {
  return {
    tenant:{id:ID.tenant,status:"ACTIVE",policyVersion:3},
    principal:{id:ID.principal,principalType:"HUMAN",status:"ACTIVE",riskState:"NORMAL",...overrides.principal},
    membership:{id:ID.membership,tenantId:ID.tenant,organizationId:null,legacyBranchId:null,
      principalId:ID.principal,status:"ACTIVE",validFrom:NOW-10_000,validUntil:NOW+60_000,...overrides.membership},
    policy:{id:ID.policy,tenantId:ID.tenant,version:3,state:"ACTIVE",effectiveAt:NOW-10_000,revokedAt:null},
    assignments:[{id:ID.membership,tenantId:ID.tenant,membershipId:ID.membership,status:"ACTIVE",
      validFrom:NOW-10_000,validUntil:NOW+60_000,scopeType:"TENANT",organizationId:null,
      legacyBranchId:null,constraintDocument:{},rolePackageVersionId:ID.package,
      rolePackageStatus:"ACTIVE",rolePackagePrincipalType:"HUMAN",rolePackageEffectiveAt:NOW-10_000,
      rolePackageDeprecatedAt:null,capabilities:[{key:CAPABILITY,effect:"ALLOW",status:"ACTIVE",
        stepUpRequired:true,approvalRequired:true,...overrides.capability}],...overrides.assignment}],
  };
}

function authority(overrides:Partial<InstitutionCurrentAuthority> & {
  selection?:Partial<InstitutionCurrentAuthority["selection"]>;
  relationship?:Partial<InstitutionCurrentAuthority["relationship"]>;
  stepUpReceipt?:Partial<NonNullable<InstitutionCurrentAuthority["stepUpReceipt"]>>|null;
}={}):InstitutionCurrentAuthority {
  const defaultStepUp:NonNullable<InstitutionCurrentAuthority["stepUpReceipt"]> = {
    id:ID.stepUp,tenantId:ID.tenant,relationshipId:ID.relationship,principalId:ID.principal,
    membershipId:ID.membership,selectionId:ID.selection,sessionGeneration:4,contextId:ID.context,
    capabilityKey:CAPABILITY,resourceType:RESOURCE_TYPE,resourceId:RESOURCE_ID,requestHash:REQUEST_HASH,
    status:"ACTIVE",issuedAt:NOW-1_000,expiresAt:NOW+30_000,consumedAt:null,
  };
  return {
    principalLegacyUserId:overrides.principalLegacyUserId ?? USER_ID,
    selection:{id:ID.selection,tenantId:ID.tenant,relationshipId:ID.relationship,membershipId:ID.membership,
      principalId:ID.principal,legacyUserId:USER_ID,sessionFingerprint:SESSION_FINGERPRINT,
      sessionGeneration:4,status:"ACTIVE",expiresAt:NOW+60_000,impersonatorPrincipalId:null,
      ...overrides.selection},
    relationship:{id:ID.relationship,tenantId:ID.tenant,status:"ACTIVE",purposeCode:"admissions.review",
      dataScopes:["application.decision"],policyVersion:3,validFrom:NOW-10_000,validUntil:NOW+60_000,
      ...overrides.relationship},
    state:overrides.state ?? state(),
    stepUpReceipt:overrides.stepUpReceipt === null ? null : {...defaultStepUp,...overrides.stepUpReceipt},
  };
}

async function authorize(overrides:Partial<InstitutionMutationAuthorizationOptions>={}) {
  return authorizeInstitutionMutation({activeContextToken:await token(),stepUpReceiptId:ID.stepUp,
    versionedActiveContext:{audience:AUDIENCE,environmentId:ENVIRONMENT,cellId:CELL,
      issuerId:ID.issuer,keyRing:[key()]},requestIdentity:identity(),resource:resource(),
    capabilityKey:CAPABILITY,requiredDataScope:"application.decision",approvalSatisfied:true,
    resolveCurrentAuthority:async()=>authority(),
    now:()=>NOW,...overrides});
}

test("exact external relationship context plus single-use step-up authorizes",async()=>{
  const result=await authorize();
  assert.equal(result.ok,true);
  if(!result.ok)return;
  assert.equal(result.receipt.decision,"ALLOW");
  assert.equal(result.receipt.stepUpReceiptId,ID.stepUp);
  assert.equal(result.receipt.capabilityDecision.reason,"allowed");
});

test("legacy unbound active context is rejected without downgrade",async()=>{
  const legacy=signActiveTenantContext({tokenVersion:1,contextId:ID.context,tenantId:ID.tenant,
    organizationId:null,legacyBranchId:null,principalId:ID.principal,membershipId:ID.membership,
    assignmentIds:[ID.membership],policyVersionId:ID.policy,policyVersion:3,issuedAt:NOW,expiresAt:NOW+60_000},
  "legacy-institution-secret-with-more-than-32-bytes");
  const result=await authorize({activeContextToken:legacy});
  assert.equal(result.ok,false);
  if(!result.ok)assert.equal(result.error.reason,"active_context_rejected");
});

test("principal, scope and impersonation mismatches are hidden or denied",async()=>{
  const principal=await authorize({requestIdentity:identity({authenticatedPrincipalId:ID.otherPrincipal})});
  assert.equal(principal.ok,false);
  if(!principal.ok)assert.equal(principal.error.reason,"authenticated_principal_mismatch");
  const scope=await authorize({resource:resource({relationshipId:ID.otherRelationship})});
  assert.equal(scope.ok,false);
  if(!scope.ok)assert.equal(scope.error.reason,"resource_not_found");
  const impersonation=await authorize({requestIdentity:identity({impersonatorPrincipalId:ID.otherPrincipal})});
  assert.equal(impersonation.ok,false);
  if(!impersonation.ok)assert.equal(impersonation.error.reason,"impersonation_forbidden");
});

test("selection replacement and session drift invalidate an otherwise valid token",async()=>{
  for(const selection of [
    {id:ID.otherSelection},
    {sessionGeneration:5},
    {sessionFingerprint:"c".repeat(64)},
    {status:"REPLACED" as const},
  ]){
    const result=await authorize({resolveCurrentAuthority:async()=>authority({selection})});
    assert.equal(result.ok,false);
    if(!result.ok)assert.equal(result.error.reason,"authority_not_current");
  }
});

test("missing step-up and missing maker-checker approval fail independently",async()=>{
  const missing=await authorize({stepUpReceiptId:null,resolveCurrentAuthority:async()=>authority({stepUpReceipt:null})});
  assert.equal(missing.ok,false);
  if(!missing.ok){assert.equal(missing.error.reason,"capability_denied");assert.equal(missing.error.detail,"step_up_required");}
  const approval=await authorize({approvalSatisfied:false});
  assert.equal(approval.ok,false);
  if(!approval.ok){assert.equal(approval.error.reason,"capability_denied");assert.equal(approval.error.detail,"approval_required");}
});

test("step-up is exact-context, exact-resource, exact-request and one-time",async()=>{
  for(const stepUpReceipt of [
    {contextId:ID.otherSelection},
    {resourceId:"different-resource"},
    {requestHash:"d".repeat(64)},
    {selectionId:ID.otherSelection},
    {status:"CONSUMED" as const,consumedAt:NOW-1},
    {expiresAt:NOW},
  ]){
    const result=await authorize({resolveCurrentAuthority:async()=>authority({stepUpReceipt})});
    assert.equal(result.ok,false);
    if(!result.ok)assert.equal(result.error.reason,"step_up_receipt_invalid");
  }
});

test("relationship revocation and expiry deny current authority",async()=>{
  for(const relationship of [
    {status:"REVOKED" as const},
    {validUntil:NOW},
    {purposeCode:"analytics.read"},
    {policyVersion:2},
  ]){
    const result=await authorize({resolveCurrentAuthority:async()=>authority({relationship})});
    assert.equal(result.ok,false);
    if(!result.ok)assert.ok(["relationship_not_current","authority_state_invalid"].includes(result.error.reason));
  }
});

test("current capability metadata still applies deny-wins and risk state",async()=>{
  const explicit=await authorize({resolveCurrentAuthority:async()=>authority({state:state({capability:{effect:"DENY"}})})});
  assert.equal(explicit.ok,false);
  if(!explicit.ok){assert.equal(explicit.error.reason,"capability_denied");assert.equal(explicit.error.detail,"explicit_deny");}
  const locked=await authorize({resolveCurrentAuthority:async()=>authority({state:state({principal:{riskState:"LOCKED"}})})});
  assert.equal(locked.ok,false);
  if(!locked.ok){assert.equal(locked.error.reason,"capability_denied");assert.equal(locked.error.detail,"principal_risk_blocked");}
});

test("authority resolution is bounded and receipts contain no profile PII",async()=>{
  let clock=NOW;
  const timeout=await authorize({resolutionBudgetMs:10,now:()=>{clock+=11;return clock;}});
  assert.equal(timeout.ok,false);
  if(!timeout.ok)assert.equal(timeout.error.reason,"authority_resolution_timeout");
  const result=await authorize();
  assert.equal(result.ok,true);
  if(result.ok){
    const serialized=JSON.stringify(result.receipt);
    assert.doesNotMatch(serialized,/email|givenName|familyName|passport|dateOfBirth/i);
  }
});
