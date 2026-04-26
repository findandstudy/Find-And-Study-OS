import "./lib/navigation";
import "./lib/csrfSetup";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./assets/fonts/inter.css";
import "./index.css";

if (import.meta.env.DEV) {
  // Increment a sessionStorage counter on every real page load.
  // sessionStorage survives SPA navigation (pushState) but is cleared on
  // actual page reload — so if this counter grows past 1 while the user
  // navigates, the page is genuinely reloading.
  const count = parseInt(sessionStorage.getItem("_appInitCount") || "0") + 1;
  sessionStorage.setItem("_appInitCount", String(count));
  console.log("[main] APP INIT #" + count, "at", window.location.pathname, new Date().toISOString());

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
