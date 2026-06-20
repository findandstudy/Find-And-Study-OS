import type { UniversityAdapter } from "./types.js";
import { topkapiAdapter }          from "./universities/topkapi/adapter.js";
import { salesforceAdapters }      from "./universities/salesforce/adapter.js";
import { sitAdapter }              from "./universities/sit/adapter.js";
import { unitedAdapter }           from "./universities/united/adapter.js";
import { okanAdapter }             from "./universities/okan/adapter.js";
import { emuAdapter } from "./universities/emu/adapter.js";
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
  okanAdapter,
  emuAdapter,
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

// ---------------------------------------------------------------------------
// Adapter family classification
// ---------------------------------------------------------------------------

type AdapterFamily = "metronic" | "salesforce" | "sit" | "united" | "okan" | "emu" | "declarative";

function resolveFamily(adapterKey: string): AdapterFamily {
  if (adapterKey === topkapiAdapter.key) return "metronic";
  if (salesforceAdapters.some((a) => a.key === adapterKey)) return "salesforce";
  if (adapterKey === sitAdapter.key) return "sit";
  if (adapterKey === unitedAdapter.key) return "united";
  if (adapterKey === okanAdapter.key) return "okan";
  if (adapterKey === emuAdapter.key) return "emu";
  return "declarative";
}

// ---------------------------------------------------------------------------
// adapterMetadata — lightweight summary safe for API / logging
// Returns NO credentials.
// ---------------------------------------------------------------------------
export function adapterMetadata(): {
  key: string;
  label: string;
  family: AdapterFamily;
  allowlist?: string[];
}[] {
  return adapters.map((a) => {
    const entry: {
      key: string;
      label: string;
      family: AdapterFamily;
      allowlist?: string[];
    } = {
      key:    a.key,
      label:  a.label,
      family: resolveFamily(a.key),
    };
    if (a.allowlist !== undefined) {
      entry.allowlist = a.allowlist;
    }
    return entry;
  });
}

/** Keys of declarative-only adapters (useful for admin tooling). */
export function declarativeAdapterKeys(): string[] {
  return _declarativeAdapters.map((a) => a.key);
}
