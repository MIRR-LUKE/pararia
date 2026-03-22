"use client";

import { createContext, useContext } from "react";

export type ThemeMode = "system" | "light" | "dark";
type ResolvedTheme = "dark";

type ThemeContextValue = {
  themeMode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setThemeMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const value: ThemeContextValue = {
  themeMode: "dark",
  resolvedTheme: "dark",
  setThemeMode: () => {},
};

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }
  return context;
}
