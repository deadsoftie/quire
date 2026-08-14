import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/electron/renderer";
import "@quire/design";
import { App } from "./App";

if (window.quireDesktop.sentryEnabled) {
  Sentry.init();
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
