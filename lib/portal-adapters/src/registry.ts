import type { UniversityAdapter } from "./types.js";
import { topkapiAdapter }          from "./universities/topkapi/adapter.js";
import { salesforceAdapters }      from "./universities/salesforce/adapter.js";
import { sitAdapter }              from "./universities/sit/adapter.js";
import { unitedAdapter }           from "./universities/united/adapter.js";
import { createDeclarativeAdapter } from "./declarativeAdapter.js";
import { declarativeConfigs }       from "./declarativeConfigs.js";

// ---------------------------------------------------------------------------
// Declarative adapters — generated from JSON-serialisable configs.
// Code adapters always take priority; declarative adapters are appended last.
// ---------------------------------------------------------------------------

const _declarativeAdapters: UniversityAdapter[] =
  declarativeConfigs.map(createDeclarativeAdapter);

// ---------------------------------------------------------------------------
// Master adapter list — order = priority in adapterForUniversity()
// ---------------------------------------------------------------------------
export const adapters: UniversityAdapter[] = [
  topkapiAdapter,
  ...salesforceAdapters,
  sitAdapter,
  unitedAdapter,
  ..._declarativeAdapters,
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Returns the first adapter whose matches() returns true for the given name. */
export function adapterForUniversity(name: string): UniversityAdapter | null {
  return adapters.find((a) => a.matches(name)) ?? null;
}

/** Returns the adapter registered under the given key. */
export function adapterByKey(key: string): UniversityAdapter | null {
  return adapters.find((a) => a.key === key) ?? null;
}

/** Returns all registered adapter keys. */
export function allAdapterKeys(): string[] {
  return adapters.map((a) => a.key);
}

/**
 * Returns lightweight metadata for all adapters.
 * Safe for logging / API responses — contains NO credentials.
 */
export function adapterMetadata(): {
  key: string;
  label: string;
  kind: "code" | "declarative";
}[] {
  const codeKeys = new Set<string>([
    topkapiAdapter.key,
    ...salesforceAdapters.map((a) => a.key),
    sitAdapter.key,
    unitedAdapter.key,
  ]);
  return adapters.map((a) => ({
    key:  a.key,
    label: a.label,
    kind: codeKeys.has(a.key) ? "code" : "declarative",
  }));
}

/** Keys of declarative-only adapters (useful for admin tooling). */
export function declarativeAdapterKeys(): string[] {
  return _declarativeAdapters.map((a) => a.key);
}
