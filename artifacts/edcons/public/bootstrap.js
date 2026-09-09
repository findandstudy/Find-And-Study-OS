(function () {
  "use strict";

  try {
    var mode = localStorage.getItem("edcons_theme") || "light";
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var dark = mode === "dark" || (mode === "system" && prefersDark);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch (_) {
    // Storage may be unavailable in privacy-restricted browsers.
  }

  function showBootstrapError() {
    var root = document.getElementById("root");
    if (!root || root.children.length) return;

    var panel = document.createElement("div");
    var heading = document.createElement("h2");
    var message = document.createElement("p");
    panel.style.cssText = "padding:40px;font-family:sans-serif";
    panel.setAttribute("role", "alert");
    heading.style.color = "#b91c1c";
    heading.textContent = "Application could not be loaded";
    message.textContent = "Please refresh the page. If the problem continues, contact support.";
    panel.appendChild(heading);
    panel.appendChild(message);
    root.replaceChildren(panel);
  }

  window.onerror = showBootstrapError;
  window.addEventListener("unhandledrejection", showBootstrapError);
})();
