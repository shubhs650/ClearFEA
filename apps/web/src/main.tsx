// SPDX-License-Identifier: AGPL-3.0-or-later
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { NotFoundPage } from "./layout/NotFoundPage";
import { pageOf, WORKBENCH_PATH } from "./pages";
import { SharedRunPage } from "./share/SharedRunPage";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("index.html has no #root element to mount the app into.");
}

let page = pageOf(window.location.pathname);
if (page.kind === "landing") {
  // The landing page comes with M10.4; until then / opens the workbench at its own address.
  window.history.replaceState(null, "", `${WORKBENCH_PATH}${window.location.search}${window.location.hash}`);
  page = { kind: "workbench" };
}

createRoot(root).render(
  <StrictMode>
    {page.kind === "workbench" && <App />}
    {/* A read-only share link (M8.7) opens the shared run's page instead of the workbench. */}
    {page.kind === "shared" && <SharedRunPage token={page.token} />}
    {page.kind === "missing" && <NotFoundPage />}
  </StrictMode>,
);
