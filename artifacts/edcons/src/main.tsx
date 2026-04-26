import { activateInMemoryRouting, getSavedNavPath } from "./lib/navigation";
import { getAuthCache } from "./lib/auth-cache";
import "./lib/csrfSetup";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./assets/fonts/inter.css";
import "./index.css";

// ─── Determine the starting in-memory path ───────────────────────────────────
//
// Three-tier priority — evaluated synchronously before React mounts:
//
// 1. localStorage saved path (highest priority)
//    Every in-memory navigate() writes the current path to localStorage key
//    "_edcons_nav_path" as { path, ts }.  localStorage survives both
//    window.location.reload() AND iframe element recreation (the Replit canvas
//    proxy destroys and recreates the iframe on every Vite-server reconnect,
//    which wipes sessionStorage but leaves localStorage intact).
//    The saved path is only used when the user also has a valid auth-cache
//    entry (≤ 2 h old), so a logged-out user is never routed to a stale portal.
//
// 2. Auth-cache redirect (middle priority)
//    If there is no saved path (first visit) but the browser pathname is an
//    unrecognised route (e.g. /en/dashboard from the canvas initialPath),
//    read the auth cache and jump straight to the correct portal root.
//    Avoids any flash of the public branch on hard Vite reconnects.
//
// 3. Browser pathname (fallback)
//    Handles normal direct-URL navigations and the very first visit.

const _PORTAL_PREFIXES = ["/admin", "/staff", "/student", "/agent"];

function _isKnownPublicPath(path: string): boolean {
  const PUBLIC_SUB = new Set(["", "about", "countries", "programs", "blog", "contact", "login"]);
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

// ── Priority 1: localStorage saved path (paired with auth cache) ──────────────
const _savedPath  = getSavedNavPath();
const _cachedAuth = getAuthCache() as { role?: string } | undefined;
// Use the saved path only when:
//   a) it exists, AND
//   b) the auth cache is still valid (user is likely still logged in), AND
//   c) the saved path points at a portal or a known public route
const _savedOk =
  !!_savedPath &&
  !!_cachedAuth &&
  (_isPortalPath(_savedPath) || _isKnownPublicPath(_savedPath));

let _startPath: string;

if (_savedOk) {
  _startPath = _savedPath!;
} else {
  // ── Priority 2 & 3 ────────────────────────────────────────────────────────
  _startPath = window.location.pathname || "/";

  if (!_isPortalPath(_startPath) && !_isKnownPublicPath(_startPath)) {
    // Unrecognised path (e.g. /en/dashboard from the canvas initialPath):
    // redirect to the portal matching the cached role — avoids public-branch flash.
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

// Activate in-memory routing before React mounts so the Replit canvas proxy
// never sees a URL change for any navigation (public or admin).
activateInMemoryRouting(_startPath);

if (import.meta.env.DEV) {
  const count = parseInt(sessionStorage.getItem("_appInitCount") || "0") + 1;
  sessionStorage.setItem("_appInitCount", String(count));
  const restoreTag = _savedOk ? "(restored from localStorage)" : "(fresh start)";
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

createRoot(document.getElementById("root")!).render(<App />);
