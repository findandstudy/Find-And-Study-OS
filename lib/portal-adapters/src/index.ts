// ---------------------------------------------------------------------------
// @workspace/portal-adapters — public API
// ---------------------------------------------------------------------------

// Core types
export type {
  PortalCredentials,
  AdapterSession,
  SubmitResult,
  SubmitProfile,
  SubmitFiles,
  UniversityAdapter,
} from "./types.js";

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
} from "./registry.js";
