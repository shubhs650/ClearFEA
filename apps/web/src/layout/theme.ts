// SPDX-License-Identifier: AGPL-3.0-or-later
// The light or dark theme (UI redesign, ADR-094): kept in this browser only, as a convenience;
// the page works the same when the browser keeps nothing.

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

const KEY = "clearfea.theme";

function stored(): Theme {
  try {
    return window.localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** The theme chosen in this browser and a function to change it; it sets data-theme on <html>. */
export function useTheme(): [Theme, (next: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(stored);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(KEY, theme);
    } catch {
      // A browser that keeps nothing still shows the theme until the page is closed.
    }
  }, [theme]);
  return [theme, setTheme];
}
