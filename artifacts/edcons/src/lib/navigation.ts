/**
 * Custom navigation module — must be imported FIRST in main.tsx, before App.tsx.
 *
 * ROOT CAUSE OF THE RELOAD ON EVERY ROUTE CHANGE:
 * The Replit canvas wraps our app in an inner iframe and monitors
 * `iframe.contentWindow.location.pathname`. Whenever the SPA calls
 * history.pushState (which changes the pathname), the canvas proxy detects the
 * change and reloads the inner iframe at the new path — causing a full page
 * reload on every navigation.
 *
 * FIX — in-memory routing for the portal shell:
 * 1. A module-level `_inMemoryPath` variable acts as the authoritative route
 *    when set (non-null). When it's null, real browser location is used.
 * 2. DashboardLayout calls `activateInMemoryRouting(initialPath)` on mount
 *    and `deactivateInMemoryRouting()` on unmount.
 * 3. While in-memory routing is active, navigate() skips history.pushState
 *    entirely — the browser URL stays frozen at the portal entry point (e.g.
 *    /admin). The proxy never detects a URL change, so no reload occurs.
 * 4. React state is updated via _notify() → setPathname() exactly as before,
 *    so transitions, Suspense, and concurrent features all keep working.
 *
 * Additional fixes that remain in place:
 * 5. Wouter v3 patch key: prevents Wouter from dispatching a "pushState" window
 *    event that the canvas may also use to detect URL changes.
 * 6. useState (not useSyncExternalStore): allows startTransition() to defer
 *    Suspense fallbacks, keeping old content visible during navigation.
 */

import { useState, useCallback, useEffect } from "react";

// ─── 1. Prevent Wouter from monkey-patching ───────────────────────────────────
if (typeof window !== "undefined") {
  const WOUTER_PATCH_KEY = Symbol.for("wouter_v3");
  if (typeof (window as unknown as Record<symbol, unknown>)[WOUTER_PATCH_KEY] === "undefined") {
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

// ─── 3. In-memory routing (global) ───────────────────────────────────────────
/**
 * When non-null, this is the current route path used by the app instead of
 * window.location.pathname. The browser URL is NOT changed during navigation.
 *
 * Activated once at startup (main.tsx) with window.location.pathname.
 * This covers ALL pages — public and admin — so the proxy never sees a URL
 * change and never reloads the iframe for any navigation.
 */
let _inMemoryPath: string | null = null;

/**
 * sessionStorage key where we persist the current in-memory path.
 * sessionStorage survives Vite HMR full-reloads (window.location.reload())
 * but is cleared when the browser tab is closed — so it is always fresh per
 * session and safe to use as a "restore the last page" mechanism.
 */
export const NAV_SESSION_KEY = "_edcons_nav_path";

/** Persist the current path so Vite-reload restores exactly where we were. */
function _saveSession(path: string) {
  try { sessionStorage.setItem(NAV_SESSION_KEY, path); } catch { /* ignore */ }
}

/**
 * Activate in-memory routing. Safe to call multiple times — if already active
 * the existing path is preserved (not overwritten).
 */
export function activateInMemoryRouting(initialPath: string) {
  if (_inMemoryPath === null) {
    _inMemoryPath = initialPath;
  }
}

/**
 * Deactivate in-memory routing (rarely needed).
 */
export function deactivateInMemoryRouting() {
  _inMemoryPath = null;
}

// ─── 4. Custom Wouter location hook ──────────────────────────────────────────
export function useCustomBrowserLocation({ base = "" }: { base?: string } = {}) {
  const getPath = useCallback((): string => {
    // In-memory routing: return the frozen internal path instead of the real URL
    if (_inMemoryPath !== null) {
      return _inMemoryPath;
    }
    const raw = window.location.pathname;
    if (base && raw.startsWith(base)) {
      return raw.slice(base.length) || "/";
    }
    return raw;
  }, [base]);

  const [pathname, setPathname] = useState(getPath);

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
      const result = base && absolute.startsWith(base)
        ? absolute.slice(base.length) || "/"
        : absolute;

      // ── In-memory mode: skip history API, update internal state only ──
      // This keeps the browser URL frozen so the Replit canvas proxy cannot
      // detect URL changes and reload the iframe.
      if (_inMemoryPath !== null) {
        _inMemoryPath = result;
        _saveSession(result);   // persist so Vite HMR reload restores this page
        _notify();
        setPathname(result);
        return;
      }

      // ── Normal mode: real history navigation ──
      if (replace) {
        history.replaceState(state, "", absolute);
      } else {
        history.pushState(state, "", absolute);
      }
      setPathname(result);
    },
    [base]
  );

  return [pathname, navigate] as const;
}
