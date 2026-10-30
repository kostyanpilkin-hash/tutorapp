import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n";
import "./index.css";
// Brand-alike fonts for themes (bundled, offline).
import "@fontsource-variable/inter";
import "@fontsource-variable/noto-sans";
import "@fontsource-variable/figtree";
import "@fontsource-variable/mona-sans";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource/lato/400.css";
import "@fontsource/lato/700.css";
import "@fontsource/lato/900.css";
import "@fontsource-variable/lora";
import "@fontsource-variable/roboto-flex";
import "@fontsource-variable/outfit";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
