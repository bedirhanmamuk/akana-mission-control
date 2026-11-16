import { useEffect, useState } from "react";

export type Theme = "dark" | "light";
const KEY = "amc.theme";

export function getTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#f3f1fa" : "#09070f");
  try { localStorage.setItem(KEY, theme); } catch { /* özel pencere: yalnızca bu oturum */ }
  window.dispatchEvent(new CustomEvent("amc-theme", { detail: theme }));
}

/** Geçerli temayı ve değiştirme işlevini verir; farklı yerlerdeki düğmeler eşzamanlı kalır. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(getTheme);
  useEffect(() => {
    const on = (e: Event) => setTheme((e as CustomEvent<Theme>).detail);
    window.addEventListener("amc-theme", on);
    return () => window.removeEventListener("amc-theme", on);
  }, []);
  return [theme, applyTheme];
}
