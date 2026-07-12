import type { UniversityAdapter } from "./types.js";
import { topkapiAdapter }          from "./universities/topkapi/adapter.js";
import { salesforceAdapters }      from "./universities/salesforce/adapter.js";
import { sitAdapter }              from "./universities/sit/adapter.js";
import { unitedAdapter }           from "./universities/united/adapter.js";
import { okanAdapter }             from "./universities/okan/adapter.js";
import { emuAdapter }              from "./universities/emu/adapter.js";
import { altinbasAdapter }         from "./universities/altinbas/adapter.js";
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
  altinbasAdapter,
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

type AdapterFamily = "metronic" | "salesforce" | "sit" | "united" | "okan" | "emu" | "altinbas" | "declarative";

function resolveFamily(adapterKey: string): AdapterFamily {
  if (adapterKey === topkapiAdapter.key) return "metronic";
  if (salesforceAdapters.some((a) => a.key === adapterKey)) return "salesforce";
  if (adapterKey === sitAdapter.key) return "sit";
  if (adapterKey === unitedAdapter.key) return "united";
  if (adapterKey === okanAdapter.key) return "okan";
  if (adapterKey === emuAdapter.key) return "emu";
  if (adapterKey === altinbasAdapter.key) return "altinbas";
  return "declarative";
}

// ---------------------------------------------------------------------------
// Experimental adapter families.
//
// These adapters are not yet production-proven. They MUST NOT auto-submit:
// the scheduled drain worker excludes them and the panel blocks enabling
// auto-process for them. Manual single-submission (operator-triggered) is
// still allowed. Topkapı (metronic) and the Okan/Medipol declarative flow
// remain production-active.
// ---------------------------------------------------------------------------
const EXPERIMENTAL_FAMILIES: ReadonlySet<AdapterFamily> = new Set<AdapterFamily>([
  "salesforce",
  "sit",
  "united",
  "emu",
  "altinbas",
]);

/** True when the given adapter key belongs to an experimental (non-auto) family. */
export function isExperimentalAdapterKey(adapterKey: string): boolean {
  return EXPERIMENTAL_FAMILIES.has(resolveFamily(adapterKey));
}

/**
 * Auto-graduation threshold: an adapter whose family is experimental stops
 * being treated as experimental once it has this many `submitted` portal
 * submissions (counted live per adapter_key — no persisted flag). The count
 * itself lives in the DB layer (api-server / worker); this registry stays
 * pure, so only the shared constant is exported here.
 */
export const GRADUATION_THRESHOLD = 3;

/**
 * True when the given adapter key resolves to the "sit" family — the only
 * adapter that submits via a create-webhook + URL references instead of a
 * real browser upload from local temp files. All other families (metronic,
 * salesforce, united, okan, emu, altinbas, declarative) drive a real browser
 * upload widget and therefore require locally-downloaded document files.
 */
export function isSitFamilyKey(adapterKey: string): boolean {
  return resolveFamily(adapterKey) === "sit";
}

// ---------------------------------------------------------------------------
// adapterMetadata — lightweight summary safe for API / logging
// Returns NO credentials.
// ---------------------------------------------------------------------------
export function adapterMetadata(): {
  key: string;
  label: string;
  family: AdapterFamily;
  experimental: boolean;
  allowlist?: string[];
}[] {
  return adapters.map((a) => {
    const family = resolveFamily(a.key);
    const entry: {
      key: string;
      label: string;
      family: AdapterFamily;
      experimental: boolean;
      allowlist?: string[];
    } = {
      key:    a.key,
      label:  a.label,
      family,
      experimental: EXPERIMENTAL_FAMILIES.has(family),
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
