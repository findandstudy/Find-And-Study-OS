import "./lib/client-state-version";
import { activateInMemoryRouting, getSavedNavPath } from "./lib/navigation";
import { getAuthCache } from "./lib/auth-cache";
import { getPersonaTeamPreviewBridgePath } from "./lib/personaTeamPreviewNavigation";
import "./lib/csrfSetup";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./assets/fonts/inter.css";
import "./index.css";
// Public detail pages are route-split, but their visual foundation must be in
// the render-blocking stylesheet. Otherwise the SSR shell paints before the
// lazy route discovers this CSS and visitors see a short unstyled flash.
import "./pages/public/detailEditorial.css";

// ─── Determine the starting in-memory path ───────────────────────────────────
//
// Three-tier priority — evaluated synchronously before React mounts:
//
// 1. localStorage saved path (highest priority)
//    Every in-memory navigate() writes the current path to localStorage key
//    "_edcons_nav_path" as { path, ts } with an 8-hour TTL.  localStorage
//    survives both window.location.reload() AND iframe element recreation
//    (the Replit canvas proxy destroys and recreates the iframe on every Vite
//    server reconnect, which wipes sessionStorage but leaves localStorage
//    intact because it is scoped to the origin, not the iframe element).
//
//    Security note: auth cache validation is NOT required here.  ProtectedRoute
//    validates the actual session cookie on every render, so routing to a stale
//    portal path at most shows a blank screen for one tick before the redirect
//    to /login fires.  Requiring auth cache here would silently fall back to the
//    public branch after 2 hours even for active users — exactly the flash we
//    are trying to prevent.
//
// 2. Auth-cache redirect (middle priority)
//    If there is no saved path (first visit, cleared storage) and the browser
//    pathname is an unrecognised route (e.g. /en/dashboard from the canvas
//    initialPath), read the auth cache and jump to the correct portal root.
//
// 3. Browser pathname (fallback)
//    Handles normal direct-URL navigations and the very first visit.

const _PORTAL_PREFIXES = ["/admin", "/staff", "/student", "/agent"];

// Fixed staging-only entry from the guarded preview document. This selects a
// page, never authority: its template requires a current server-checked session.
const _teamPreviewEntry = getPersonaTeamPreviewBridgePath(
  window.location.origin, window.location.pathname, window.location.search,
);
if (_teamPreviewEntry) window.history.replaceState(null, "", _teamPreviewEntry);

function _isKnownPublicPath(path: string): boolean {
  const PUBLIC_SUB = new Set(["", "about", "countries", "programs", "universities", "blog", "contact", "login"]);
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return true;
  if (parts.length === 1) return true;
  if (parts.length >= 2 && PUBLIC_SUB.has(parts[1])) return true;
  if (parts.length >= 3 && parts[1] === "countries") return true;
  return false;
}

function _isPortalPath(p: string) {
  return _PORTAL_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix + "/"));
}

// ── Priority 1: localStorage saved path ──────────────────────────────────────
// No auth-cache pairing: ProtectedRoute handles session validation.
const _savedPath = getSavedNavPath();
const _savedOk = !!_savedPath && (_isPortalPath(_savedPath) || _isKnownPublicPath(_savedPath));

let _startPath: string;

if (_teamPreviewEntry) {
  _startPath = _teamPreviewEntry;
} else if (_savedOk) {
  _startPath = _savedPath!;
} else {
  // ── Priority 2 & 3 ────────────────────────────────────────────────────────
  _startPath = window.location.pathname || "/";

  if (!_isPortalPath(_startPath) && !_isKnownPublicPath(_startPath)) {
    // Unrecognised path (e.g. /en/dashboard from the canvas initialPath).
    // Use auth cache to redirect to the correct portal root — avoids the
    // public-branch flash on the very first canvas load before any navigation.
    const _cachedAuth = getAuthCache() as { role?: string } | undefined;
    if (_cachedAuth?.role && _cachedAuth.role !== "pending") {
      const _ADMIN = ["super_admin", "admin", "manager", "staff", "consultant", "editor", "accountant"];
      if (_ADMIN.includes(_cachedAuth.role)) {
        _startPath = "/admin";
      } else if (_cachedAuth.role === "student") {
        _startPath = "/student";
      } else if (["agent", "sub_agent", "agent_staff"].includes(_cachedAuth.role)) {
        _startPath = "/agent";
      }
    }
  }
}

// Activate in-memory routing ONLY when the app is embedded in the Replit
// canvas iframe.  The in-memory mode freezes the browser URL to prevent the
// canvas proxy from detecting URL changes and reloading the iframe.
//
// When the app is accessed directly (e.g. Playwright e2e tests, standalone
// browser tab), real history.pushState is used so that window.location
// reflects each navigation — required for page.waitForURL() to work.
try {
  if (window.top !== window.self) {
    activateInMemoryRouting(_startPath);
  }
} catch {
  // Cross-origin iframe: window.top access throws SecurityError — assume
  // we are embedded and activate in-memory routing to be safe.
  activateInMemoryRouting(_startPath);
}

if (import.meta.env.DEV) {
  const count = parseInt(sessionStorage.getItem("_appInitCount") || "0") + 1;
  sessionStorage.setItem("_appInitCount", String(count));
  const restoreTag = _savedOk
    ? "(restored from localStorage: " + _savedPath + ")"
    : "(fresh start)";
  console.log(
    "[main] APP INIT #" + count,
    "at", _startPath,
    "(browser:", window.location.pathname + ")",
    restoreTag,
    new Date().toISOString()
  );

  window.addEventListener("beforeunload", () => {
    console.log("[main] BEFOREUNLOAD — page is being destroyed at", window.location.pathname);
  });

  const badge = document.createElement("div");
  badge.id = "_app_init_badge";
  badge.style.cssText =
    "position:fixed;bottom:4px;left:4px;z-index:2147483647;background:#1e3a5f;color:#fff;padding:2px 7px;font-size:9px;font-family:monospace;border-radius:3px;pointer-events:none;line-height:1.6;";
  badge.textContent = "init #" + count;
  document.body.appendChild(badge);
}

const rootElement = document.getElementById("root")!;
// The SSR/ISR pilot emits safe semantic HTML for crawlers and no-JS visitors,
// but it is not a React hydration payload. Showing that legacy markup and then
// replacing it with the richer React template caused a visible second layout
// pass even when the page was otherwise fast. bootstrap.js marks JS-capable
// documents before first paint. A deliberately non-page-like branded cover
// now masks the handoff, so users never mistake loading geometry for the final
// template. No-JS visitors retain the original semantic HTML unchanged.
if (rootElement.hasAttribute("data-public-render-shell-root")) {
  const preloader = document.createElement("div");
  preloader.id = "public-app-preloader";
  preloader.className = "public-app-preloader";
  preloader.setAttribute("role", "status");
  preloader.setAttribute("aria-live", "polite");
  preloader.setAttribute("aria-label", "Loading");

  const brand = document.createElement("div");
  brand.className = "public-app-preloader-brand";
  const logo = document.createElement("img");
  logo.className = "public-app-preloader-logo";
  logo.src = `${import.meta.env.BASE_URL || "/"}api/settings/branding/logo?variant=header`;
  logo.alt = "Find & Study";
  logo.decoding = "async";
  logo.fetchPriority = "high";
  const fallback = document.createElement("strong");
  fallback.className = "public-app-preloader-fallback";
  fallback.textContent = "Find & Study";
  fallback.hidden = true;
  logo.addEventListener("error", () => {
    logo.hidden = true;
    fallback.hidden = false;
  }, { once: true });
  const activity = document.createElement("span");
  activity.className = "public-app-preloader-activity";
  activity.setAttribute("aria-hidden", "true");
  activity.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
  brand.append(logo, fallback, activity);
  preloader.append(brand);
  document.documentElement.classList.add("public-preloader-active");
  document.body.append(preloader);

  rootElement.replaceChildren();
  rootElement.setAttribute("aria-busy", "true");

  let handedOff = false;
  const handoff = () => {
    if (handedOff) return;
    handedOff = true;
    observer.disconnect();
    clearTimeout(failSafe);
    rootElement.removeAttribute("data-public-render-shell-root");
    rootElement.removeAttribute("aria-busy");
    document.documentElement.classList.remove("public-preloader-active");
    preloader.classList.add("is-leaving");
    const removePreloader = () => preloader.remove();
    preloader.addEventListener("transitionend", removePreloader, { once: true });
    window.setTimeout(removePreloader, 240);
  };
  const observer = new MutationObserver(() => {
    if (rootElement.querySelector("h1")) requestAnimationFrame(handoff);
  });
  observer.observe(rootElement, { childList: true, subtree: true });
  const failSafe = window.setTimeout(handoff, 15_000);
}
createRoot(rootElement).render(<App />);
