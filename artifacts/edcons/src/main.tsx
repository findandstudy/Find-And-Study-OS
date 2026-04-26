import { activateInMemoryRouting, NAV_SESSION_KEY } from "./lib/navigation";
import { getAuthCache } from "./lib/auth-cache";
import "./lib/csrfSetup";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./assets/fonts/inter.css";
import "./index.css";

// ─── Determine the starting in-memory path ───────────────────────────────────
//
// Three-tier priority for choosing where the app begins:
//
// 1. sessionStorage (highest priority)
//    sessionStorage survives Vite HMR full-reloads (window.location.reload())
//    but clears on tab close.  Every in-memory navigation saves the current
//    path here, so after a Vite reconnect-reload the app resumes EXACTLY where
//    the user was — no flash, no lost position.
//
// 2. Auth-cache redirect (middle priority)
//    If sessionStorage is empty (fresh tab) and the browser pathname is an
//    unrecognised route (e.g. /en/dashboard from the canvas initialPath),
//    check localStorage auth cache.  If a valid session is found, jump
//    straight to the user's portal — never render the public/404 branch.
//
// 3. Browser pathname (lowest priority / fallback)
//    Used when neither sessionStorage nor auth-cache redirect applies.

const _PORTAL_PREFIXES = ["/admin", "/staff", "/student", "/agent"];

function _isKnownPublicPath(path: string): boolean {
  const PUBLIC_SUB = new Set(["", "about", "countries", "programs", "blog", "contact", "login"]);
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return true;            // "/"
  if (parts.length === 1) return true;            // "/:lang"
  if (parts.length >= 2 && PUBLIC_SUB.has(parts[1])) return true;
  if (parts.length >= 3 && parts[1] === "countries") return true;
  return false;
}

function _isPortalPath(p: string) {
  return _PORTAL_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix + "/"));
}

// ── Priority 1: sessionStorage ────────────────────────────────────────────────
const _savedPath = (() => { try { return sessionStorage.getItem(NAV_SESSION_KEY); } catch { return null; } })();
const _savedOk = _savedPath && (_isPortalPath(_savedPath) || _isKnownPublicPath(_savedPath));

let _startPath: string;

if (_savedOk) {
  // Resume from where the user was before the Vite reload
  _startPath = _savedPath!;
} else {
  // ── Priority 2 & 3: auth-cache redirect or browser pathname ──────────────
  _startPath = window.location.pathname || "/";

  if (!_isPortalPath(_startPath) && !_isKnownPublicPath(_startPath)) {
    // Unrecognised path (e.g. /en/dashboard from canvas initialPath).
    // Check auth cache and redirect to the appropriate portal.
    const _cached = getAuthCache() as { role?: string } | undefined;
    if (_cached?.role && _cached.role !== "pending") {
      const _ADMIN = ["super_admin", "admin", "manager", "staff", "consultant", "editor", "accountant"];
      if (_ADMIN.includes(_cached.role)) {
        _startPath = "/admin";
      } else if (_cached.role === "student") {
        _startPath = "/student";
      } else if (["agent", "sub_agent", "agent_staff"].includes(_cached.role)) {
        _startPath = "/agent";
      }
    }
  }
}

// Activate in-memory routing immediately — before React mounts — so the
// Replit canvas proxy never sees a URL change for any navigation (public or
// admin). The browser URL stays frozen at the initial canvas path forever.
activateInMemoryRouting(_startPath);

if (import.meta.env.DEV) {
  const count = parseInt(sessionStorage.getItem("_appInitCount") || "0") + 1;
  sessionStorage.setItem("_appInitCount", String(count));
  console.log(
    "[main] APP INIT #" + count,
    "at", _startPath,
    "(browser:", window.location.pathname + ")",
    _savedOk ? "(restored from session)" : "(fresh start)",
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
