import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { createDaemonClient } from "./daemon/client";
import { createSetupClient } from "./setup/client";
import { DaemonProvider } from "./state/daemon";
import { Welcome } from "./welcome/Welcome";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/welcome.css";
import "./styles/helper.css";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

// `?view=welcome` is the first-run wizard (its own window in the app,
// `agentux-cockpit --welcome`); it needs no daemon.
if (new URLSearchParams(window.location.search).get("view") === "welcome") {
  void createSetupClient().then((client) => {
    root.render(
      <React.StrictMode>
        <Welcome client={client} />
      </React.StrictMode>,
    );
  });
} else {
  void createDaemonClient().then((client) => {
    root.render(
      <React.StrictMode>
        <DaemonProvider client={client}>
          <App />
        </DaemonProvider>
      </React.StrictMode>,
    );
  });
}
