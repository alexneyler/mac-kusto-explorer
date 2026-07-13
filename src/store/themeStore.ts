import { create } from "zustand";

export type Theme = "dark" | "light";

const STORAGE_KEY = "kusto-explorer.theme";

function loadTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // The active theme still applies when storage is unavailable.
  }
}

interface ThemeStore {
  theme: Theme;
  setTheme(theme: Theme): void;
  toggleTheme(): void;
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  theme: loadTheme(),

  setTheme(theme) {
    applyTheme(theme);
    saveTheme(theme);
    set({ theme });
  },

  toggleTheme() {
    get().setTheme(get().theme === "dark" ? "light" : "dark");
  },
}));

export function initializeTheme(): void {
  applyTheme(useThemeStore.getState().theme);
}
