// SPDX-License-Identifier: AGPL-3.0-or-later
// The page any address outside the app's pages opens (a mistyped or shortened link).

import { WORKBENCH_PATH } from "../pages";
import { Logo } from "./AppHeader";

export function NotFoundPage() {
  return (
    <div className="signin-page">
      <main className="signin" aria-label="Page not found">
        <div className="signin-form">
          <h1 className="signin-title">
            <Logo size={32} />
            ClearFEA
          </h1>
          <p className="form-problem" role="alert">
            There is no page at this address. Check the link you followed, or open the workbench.
          </p>
          <a href={WORKBENCH_PATH}>Go to your projects</a>
        </div>
      </main>
    </div>
  );
}
