import "./lib/csrfSetup";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./assets/fonts/inter.css";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
