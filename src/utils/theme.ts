export type ThemePreference = "light" | "dark" | "system";

const THEME_KEY = "kiroku_theme_v1";
export const THEME_CHANGED_EVENT = "kiroku:theme-changed";

export function getThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch { /* ignore */ }
  return "system";
}

export function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference === "system") {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return preference;
}

export function applyThemePreference(preference: ThemePreference): void {
  document.documentElement.classList.toggle("dark", resolveTheme(preference) === "dark");
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_KEY, preference);
  } catch { /* ignore */ }
  applyThemePreference(preference);
  try {
    window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT));
  } catch { /* ignore */ }
}

/** Apply stored preference and follow OS changes while preference is "system". */
export function initTheme(): void {
  applyThemePreference(getThemePreference());
  try {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (getThemePreference() === "system") applyThemePreference("system");
    });
  } catch { /* older browsers */ }
}
