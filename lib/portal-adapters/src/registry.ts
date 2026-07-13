import type { UniversityAdapter } from "./types.js";
import { topkapiAdapter }          from "./universities/topkapi/adapter.js";
import { salesforceAdapters }      from "./universities/salesforce/adapter.js";
import { sitAdapter }              from "./universities/sit/adapter.js";
import { unitedAdapter }           from "./universities/united/adapter.js";
import { okanAdapter }             from "./universities/okan/adapter.js";
import { emuAdapter }              from "./universities/emu/adapter.js";
import { createDeclarativeAdapter } from "./declarativeAdapter.js";
import { declarativeConfigs, declarativeSpecRaws } from "./declarativeConfigs.js";
import { parseAdapterSpec }        from "./declarative/schema.js";
import { createSpecAdapter }       from "./declarative/interpreter.js";

// ---------------------------------------------------------------------------
// Declarative adapters — legacy DeclarativeConfig format.
// Code adapters always take priority; declarative adapters are appended last.
// ---------------------------------------------------------------------------

const _declarativeAdapters: UniversityAdapter[] =
  declarativeConfigs.map(createDeclarativeAdapter);

// ---------------------------------------------------------------------------
// Spec-format (specVersion 1) declarative adapters — built from
// declarativeSpecRaws via parseAdapterSpec + createSpecAdapter.
// Invalid specs are skipped with a warning.
// ---------------------------------------------------------------------------

const _specAdapters: UniversityAdapter[] = [];
for (const raw of declarativeSpecRaws) {
  const parsed = parseAdapterSpec(raw);
  if (parsed.ok) {
    _specAdapters.push(createSpecAdapter(parsed.spec, { allowJsHook: false }));
  } else {
    console.warn(`[registry] skipping invalid declarative spec: ${parsed.error}`);
  }
}

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
  ..._specAdapters,
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
//
// "altinbas" is kept here as an explicit key sentinel: the altınbaş adapter
// is now declarative (family = "declarative") but still experimental during
// roll-out. isExperimentalAdapterKey checks both family membership and direct
// key membership so declarative adapters can be marked experimental by key.
// ---------------------------------------------------------------------------
const EXPERIMENTAL_FAMILIES: ReadonlySet<AdapterFamily> = new Set<AdapterFamily>([
  "salesforce",
  "sit",
  "united",
  "emu",
  "altinbas",
]);

/**
 * True when the given adapter key belongs to an experimental (non-auto) family,
 * OR when the key itself is listed in EXPERIMENTAL_FAMILIES (supports declarative
 * adapters that carry their own experimental flag during roll-out).
 */
export function isExperimentalAdapterKey(adapterKey: string): boolean {
  const family = resolveFamily(adapterKey);
  if (EXPERIMENTAL_FAMILIES.has(family)) return true;
  // Declarative adapters whose key appears in EXPERIMENTAL_FAMILIES by name
  // are also treated as experimental until graduated.
  return (EXPERIMENTAL_FAMILIES as ReadonlySet<string>).has(adapterKey);
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
 * salesforce, united, okan, emu, declarative) drive a real browser
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
      key:   a.key,
      label: a.label,
      family,
      // Use isExperimentalAdapterKey so declarative adapters with an explicit
      // key entry in EXPERIMENTAL_FAMILIES are correctly flagged.
      experimental: isExperimentalAdapterKey(a.key),
    };
    if (a.allowlist !== undefined) {
      entry.allowlist = a.allowlist;
    }
    return entry;
  });
}

/** Keys of all declarative adapters (legacy + spec-format). */
export function declarativeAdapterKeys(): string[] {
  return [..._declarativeAdapters, ..._specAdapters].map((a) => a.key);
}
