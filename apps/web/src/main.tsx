import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { initBrowserTelemetry } from "./lib/telemetry";
import "./styles.css";

initBrowserTelemetry();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
