import { useEffect, useState } from "react";
import {
  getSystemTheme,
  type ResolvedTheme,
  SYSTEM_DARK_QUERY,
  type ThemePreference,
} from "./theme";

export function useResolvedTheme(theme: ThemePreference): ResolvedTheme {
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme());

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const media = window.matchMedia(SYSTEM_DARK_QUERY);
    const updateSystemTheme = () => setSystemTheme(media.matches ? "dark" : "light");

    updateSystemTheme();
    media.addEventListener("change", updateSystemTheme);
    return () => media.removeEventListener("change", updateSystemTheme);
  }, []);

  return theme === "system" ? systemTheme : theme;
}
