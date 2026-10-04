import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { createDaemonClient } from "./daemon/client";
import { DaemonProvider } from "./state/daemon";
import "./styles/tokens.css";
import "./styles/app.css";

void createDaemonClient().then((client) => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <DaemonProvider client={client}>
        <App />
      </DaemonProvider>
    </React.StrictMode>,
  );
});
