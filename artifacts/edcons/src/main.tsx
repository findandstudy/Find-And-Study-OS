import { activateInMemoryRouting } from "./lib/navigation";
import { getAuthCache } from "./lib/auth-cache";
import "./lib/csrfSetup";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./assets/fonts/inter.css";
import "./index.css";

// ─── Determine starting in-memory path ───────────────────────────────────────
// The Replit canvas proxy loads the app with window.location.pathname set to
// something like "/en/dashboard" (from ?initialPath in the wrapper URL).
// "/en/dashboard" is not a real public route, so the Router would briefly flash
// the NotFound page before the auth-cache redirect fires.
//
// Fix: check the localStorage auth cache RIGHT NOW (before React mounts) and,
// if the path is not a recognised public or portal path, jump straight to the
// user's portal.  This is zero-render — the Router never sees the wrong path.

function _isKnownPublicPath(path: string): boolean {
  const PUBLIC_SUB = new Set(["", "about", "countries", "programs", "blog", "contact", "login"]);
  const parts = path.split("/").filter(Boolean); // ["en","about"] etc.
  if (parts.length === 0) return true;            // "/"
  if (parts.length === 1) return true;            // "/:lang"
  if (parts.length >= 2 && PUBLIC_SUB.has(parts[1])) return true;   // "/:lang/about" etc.
  if (parts.length >= 3 && parts[1] === "countries") return true;   // "/:lang/countries/:slug"
  return false;
}

const _PORTAL_PREFIXES = ["/admin", "/staff", "/student", "/agent"];

let _startPath = window.location.pathname || "/";

const _isPortal = _PORTAL_PREFIXES.some(
  (p) => _startPath === p || _startPath.startsWith(p + "/")
);

if (!_isPortal && !_isKnownPublicPath(_startPath)) {
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

// Activate in-memory routing immediately — before React mounts — so the
// Replit canvas proxy never sees a URL change for any navigation (public or
// admin). The browser URL stays frozen at the initial canvas path forever.
activateInMemoryRouting(_startPath);

if (import.meta.env.DEV) {
  // Increment a sessionStorage counter on every real page load.
  // sessionStorage survives SPA navigation (pushState) but is cleared on
  // actual page reload — so if this counter grows past 1 while the user
  // navigates, the page is genuinely reloading.
  const count = parseInt(sessionStorage.getItem("_appInitCount") || "0") + 1;
  sessionStorage.setItem("_appInitCount", String(count));
  console.log("[main] APP INIT #" + count, "at", _startPath, "(browser:", window.location.pathname + ")", new Date().toISOString());

  window.addEventListener("beforeunload", () => {
    console.log("[main] BEFOREUNLOAD — page is being destroyed at", window.location.pathname);
  });

  // Show init count in DOM so the user can see it without opening DevTools
  const badge = document.createElement("div");
  badge.id = "_app_init_badge";
  badge.style.cssText =
    "position:fixed;bottom:4px;left:4px;z-index:2147483647;background:#1e3a5f;color:#fff;padding:2px 7px;font-size:9px;font-family:monospace;border-radius:3px;pointer-events:none;line-height:1.6;";
  badge.textContent = "init #" + count;
  document.body.appendChild(badge);
}

createRoot(document.getElementById("root")!).render(<App />);
