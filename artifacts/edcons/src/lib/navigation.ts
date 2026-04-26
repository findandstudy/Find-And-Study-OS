/**
 * Custom navigation module — must be imported FIRST in main.tsx, before App.tsx.
 *
 * ROOT CAUSE OF THE WHITE FLASH:
 * 1. Wouter v3 monkey-patches history.pushState and dispatches a "pushState"
 *    window event on every SPA navigation, which the Replit canvas iframe
 *    wrapper intercepts and may use to reload the frame.
 * 2. useSyncExternalStore explicitly opts out of React 18's concurrent
 *    transition features, so startTransition cannot defer Suspense fallbacks
 *    when using it — causing a brief white ShellLoader flash in the content
 *    area every time a lazy-loaded route is first visited.
 *
 * FIX:
 * 1. Set Wouter's internal patch key early so Wouter skips its own patching.
 * 2. Apply our own silent patch: call the real history.pushState/replaceState
 *    with no window event dispatch; notify subscribers via in-memory Set.
 * 3. Export useCustomBrowserLocation — a Wouter-compatible location hook that
 *    uses useState (not useSyncExternalStore) so that startTransition() in
 *    DashboardLayout.navigate() can defer Suspense fallbacks during navigation,
 *    keeping the old content visible until the new chunk is ready.
 */

import { useState, useCallback, useEffect } from "react";

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

// ─── 3. Custom Wouter location hook ──────────────────────────────────────────
/**
 * Drop-in replacement for Wouter's useBrowserLocation.
 * Uses useState (not useSyncExternalStore) so that calling:
 *
 *   startTransition(() => setLocation(url))
 *
 * in DashboardLayout.navigate() makes React treat the navigation as a
 * low-priority transition: if the new lazy route chunk needs to download,
 * React keeps showing the current page until it's ready — no Suspense
 * fallback / white flash is shown to the user.
 *
 * Usage: <WouterRouter hook={useCustomBrowserLocation}>
 */
export function useCustomBrowserLocation({ base = "" }: { base?: string } = {}) {
  const getPath = useCallback((): string => {
    const raw = window.location.pathname;
    if (base && raw.startsWith(base)) {
      return raw.slice(base.length) || "/";
    }
    return raw;
  }, [base]);

  const [pathname, setPathname] = useState(getPath);

  // Re-sync on external navigation events (pushState/replaceState/popstate/hashchange)
  useEffect(() => {
    const onNav = () => setPathname(getPath());
    _subscribers.add(onNav);
    window.addEventListener("popstate", onNav);
    window.addEventListener("hashchange", onNav);
    return () => {
      _subscribers.delete(onNav);
      window.removeEventListener("popstate", onNav);
      window.removeEventListener("hashchange", onNav);
    };
  }, [getPath]);

  const navigate = useCallback(
    (to: string, opts: { replace?: boolean; state?: unknown } = {}) => {
      const { replace = false, state = null } = opts;
      const absolute = base + (to.startsWith("/") ? to : `/${to}`);
      if (replace) {
        history.replaceState(state, "", absolute);
      } else {
        history.pushState(state, "", absolute);
      }
      // setPathname is called by the _subscribers / popstate handlers above
      // when _notify() fires inside our patched pushState/replaceState.
      // However, if startTransition wraps the navigate() call, React needs
      // the setState to happen inside the transition. We call it explicitly
      // here so the caller's startTransition context applies.
      const result = base && absolute.startsWith(base)
        ? absolute.slice(base.length) || "/"
        : absolute;
      setPathname(result);
    },
    [base]
  );

  return [pathname, navigate] as const;
}
