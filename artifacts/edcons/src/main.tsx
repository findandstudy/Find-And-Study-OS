import "./lib/navigation";
import "./lib/csrfSetup";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./assets/fonts/inter.css";
import "./index.css";

// DEV diagnostic: detect if this page is being reloaded/unloaded
if (import.meta.env.DEV) {
  console.log("[main] APP INIT at", window.location.pathname, new Date().toISOString());
  window.addEventListener("beforeunload", () => {
    console.log("[main] BEFOREUNLOAD — page is being destroyed at", window.location.pathname);
  });
}

createRoot(document.getElementById("root")!).render(<App />);
