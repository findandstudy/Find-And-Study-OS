import type { UniversityAdapter } from "./types.js";
import { topkapiAdapter }      from "./universities/topkapi/adapter.js";
import { salesforceAdapters }  from "./universities/salesforce/adapter.js";
import { sitAdapter }          from "./universities/sit/adapter.js";
import { unitedAdapter }       from "./universities/united/adapter.js";

// ---------------------------------------------------------------------------
// Master adapter list — order determines priority in adapterForUniversity()
// ---------------------------------------------------------------------------
export const adapters: UniversityAdapter[] = [
  topkapiAdapter,
  ...salesforceAdapters,
  sitAdapter,
  unitedAdapter,
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Returns the first adapter whose matches() returns true for the given name. */
export function adapterForUniversity(name: string): UniversityAdapter | null {
  return adapters.find(a => a.matches(name)) ?? null;
}

/** Returns the adapter registered under the given key. */
export function adapterByKey(key: string): UniversityAdapter | null {
  return adapters.find(a => a.key === key) ?? null;
}

/** Returns all registered adapter keys. */
export function allAdapterKeys(): string[] {
  return adapters.map(a => a.key);
}

/**
 * Returns lightweight metadata for all adapters (key + label only).
 * Safe for logging, API responses, etc. — contains NO credentials.
 */
export function adapterMetadata(): { key: string; label: string }[] {
  return adapters.map(a => ({ key: a.key, label: a.label }));
}
