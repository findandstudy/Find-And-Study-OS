/**
 * Custom navigation module — must be imported FIRST in main.tsx, before App.tsx.
 *
 * ROOT CAUSE OF THE WHITE FLASH:
 * Wouter v3 monkey-patches `history.pushState` so that every SPA navigation
 * dispatches a `new Event("pushState")` on `window`. The Replit canvas iframe
 * wrapper listens for that event on the inner frame's contentWindow and reloads
 * the iframe with the new URL as the starting path — causing a full-page white
 * flash on every sidebar click.
 *
 * FIX:
 * 1. Set Wouter's internal patch key early so Wouter skips its own patching.
 * 2. Apply our own silent patch: call the real `history.pushState/replaceState`
 *    + notify React subscribers via an in-memory Set (no `window` event dispatch).
 * 3. Export `useCustomBrowserLocation` — a Wouter-compatible location hook that
 *    passes to `<WouterRouter hook={useCustomBrowserLocation}>`.
 */

import { useSyncExternalStore, useCallback } from "react";

// ─── 1. Prevent Wouter from monkey-patching ───────────────────────────────────
// Wouter checks `typeof window[Symbol.for("wouter_v3")] === "undefined"` before
// patching. Setting it here (before Wouter's module evaluates) stops the patch.
if (typeof window !== "undefined") {
  const WOUTER_PATCH_KEY = Symbol.for("wouter_v3");
  if (typeof (window as Record<symbol, unknown>)[WOUTER_PATCH_KEY] === "undefined") {
    Object.defineProperty(window, WOUTER_PATCH_KEY, {
      value: true,
      configurable: false,
      writable: false,
    });
  }
}

// ─── 2. Capture originals & apply silent patch ────────────────────────────────
const _originalPush =
  typeof history !== "undefined" ? history.pushState.bind(history) : null;
const _originalReplace =
  typeof history !== "undefined" ? history.replaceState.bind(history) : null;

type NavSubscriber = () => void;
const _subscribers = new Set<NavSubscriber>();

function _notify() {
  if (import.meta.env.DEV) {
    console.log("[nav] _notify path=" + window.location.pathname + " subscribers=" + _subscribers.size);
  }
  _subscribers.forEach((fn) => fn());
}

export function subscribeToNavigation(fn: NavSubscriber) {
  _subscribers.add(fn);
  return () => {
    _subscribers.delete(fn);
  };
}

if (typeof history !== "undefined" && _originalPush && _originalReplace) {
  history.pushState = function (
    data: unknown,
    unused: string,
    url?: string | URL | null
  ) {
    _originalPush(data, unused, url);
    _notify();
  };

  history.replaceState = function (
    data: unknown,
    unused: string,
    url?: string | URL | null
  ) {
    _originalReplace(data, unused, url);
    _notify();
  };
}

// Also handle browser back/forward (native popstate) and hash navigation
if (typeof window !== "undefined") {
  window.addEventListener("popstate", _notify);
  window.addEventListener("hashchange", _notify);
}

// ─── 3. Custom Wouter location hook ──────────────────────────────────────────
/**
 * Drop-in replacement for Wouter's `useBrowserLocation`.
 * Usage: <WouterRouter hook={useCustomBrowserLocation}>
 */
export function useCustomBrowserLocation({ base = "" }: { base?: string } = {}) {
  const getSnapshot = useCallback((): string => {
    const path = window.location.pathname;
    if (base && path.startsWith(base)) {
      return path.slice(base.length) || "/";
    }
    return path;
  }, [base]);

  const pathname = useSyncExternalStore(
    subscribeToNavigation,
    getSnapshot,
    getSnapshot
  );

  const navigate = useCallback(
    (to: string, opts: { replace?: boolean; state?: unknown } = {}) => {
      const { replace = false, state = null } = opts;
      const absolute = base + (to.startsWith("/") ? to : `/${to}`);
      if (replace) {
        history.replaceState(state, "", absolute);
      } else {
        history.pushState(state, "", absolute);
      }
    },
    [base]
  );

  return [pathname, navigate] as const;
}
