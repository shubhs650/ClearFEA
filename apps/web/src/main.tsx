// SPDX-License-Identifier: AGPL-3.0-or-later
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { shareTokenOf } from "./api/shareLinks";
import { SharedRunPage } from "./share/SharedRunPage";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("index.html has no #root element to mount the app into.");
}

// A read-only share link (M8.7) opens the shared run's page instead of the workbench.
const shareToken = shareTokenOf(window.location.pathname);

createRoot(root).render(<StrictMode>{shareToken === null ? <App /> : <SharedRunPage token={shareToken} />}</StrictMode>);
