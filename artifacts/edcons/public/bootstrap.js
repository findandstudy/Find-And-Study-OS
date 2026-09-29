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

  try {
    var consent = localStorage.getItem("cookie_consent");
    if (consent === "all" || consent === "essential") {
      document.documentElement.classList.add("cookie-consent-known");
    }
    document.addEventListener("click", function (event) {
      var target = event.target instanceof Element
        ? event.target.closest("[data-cookie-consent-choice]")
        : null;
      if (!target) return;
      var choice = target.getAttribute("data-cookie-consent-choice");
      if (choice !== "all" && choice !== "essential") return;
      localStorage.setItem("cookie_consent", choice);
      document.documentElement.classList.add("cookie-consent-known");
      var shell = document.querySelector(".public-consent-shell");
      if (shell) shell.remove();
    });
  } catch (_) {
    // Consent remains available through the React control when storage is unavailable.
  }

  try {
    var parts = window.location.pathname.split("/").filter(Boolean);
    var supported = /^(en|tr|ar|fr|ru|fa|zh|hi|es|id|ur|tk|ky|kk|uz|tg|bn|pt|ne|vi|ko|uk|it)$/;
    var publicSections = /^(|about|countries|destinations|cities|programs|universities|guides|blog|contact|agency)$/;
    if (supported.test(parts[0] || "") && publicSections.test(parts[1] || "")) {
      var preload = document.createElement("link");
      preload.rel = "preload";
      preload.as = "fetch";
      preload.crossOrigin = "anonymous";
      preload.href = "/i18n-critical/" + parts[0] + ".json";
      document.head.appendChild(preload);
    }
  } catch (_) {
    // A preload hint is optional; the provider retains the full dictionary fallback.
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
