// ---------------------------------------------------------------------------
// @workspace/portal-adapters — public API
// ---------------------------------------------------------------------------

// Core types (PortalCredentials removed — credentials live in .env)
export type {
  AdapterSession,
  SubmitResult,
  SubmitProfile,
  SubmitFiles,
  UniversityAdapter,
} from "./types.js";

// Credential helper — reads from process.env
export { portalCreds, type ResolvedCreds } from "./portalCreds.js";

// Browser utilities
export {
  launchPortal,
  saveState,
  closePortal,
  logger,
  type LaunchOpts,
} from "./browser.js";

// Program matching
export {
  fold,
  matchProgram,
  type ProgramCandidate,
  type MatchResult,
} from "./programMatch.js";

// Profile helpers
export {
  mapDocType,
  buildProfile,
  REQUIRED_DOCS,
  type DocType,
} from "./profile.js";

// Registry
export {
  adapters,
  adapterForUniversity,
  adapterByKey,
  allAdapterKeys,
  adapterMetadata,
  declarativeAdapterKeys,
} from "./registry.js";

// Declarative adapter engine
export {
  createDeclarativeAdapter,
  executeStep,
  runSteps,
  checkResult,
  type DeclarativeConfig,
  type DeclarativeStep,
  type DeclarativeCredentials,
  type SubmitCheck,
  type MinimalPage,
  type ProfileField,
  type FileField,
} from "./declarativeAdapter.js";
