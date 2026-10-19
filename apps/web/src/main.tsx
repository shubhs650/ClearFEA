// SPDX-License-Identifier: AGPL-3.0-or-later
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { LandingPage } from "./landing/LandingPage";
import { NotFoundPage } from "./layout/NotFoundPage";
import { pageOf } from "./pages";
import { SharedRunPage } from "./share/SharedRunPage";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("index.html has no #root element to mount the app into.");
}

const page = pageOf(window.location.pathname);

createRoot(root).render(
  <StrictMode>
    {page.kind === "landing" && <LandingPage />}
    {page.kind === "workbench" && <App />}
    {/* A read-only share link (M8.7) opens the shared run's page instead of the workbench. */}
    {page.kind === "shared" && <SharedRunPage token={page.token} />}
    {page.kind === "missing" && <NotFoundPage />}
  </StrictMode>,
);
