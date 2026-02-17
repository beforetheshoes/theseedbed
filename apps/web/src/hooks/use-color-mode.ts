"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getInitialColorMode,
  type ColorMode,
  writeColorModeCookie,
} from "@/lib/color-mode";
import { reapplyThemeRecolor } from "@/lib/user-theme";

const COOKIE_NAME = "colorMode";

const getSystemPref = (): "light" | "dark" =>
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

export function useColorMode() {
  // Lazy-initialize from cookie on first client render to avoid
  // setState-in-effect and the associated cascading render.
  const [mode, setModeState] = useState<ColorMode>(() => {
    if (typeof document === "undefined") return "system";
    return getInitialColorMode(document.cookie, COOKIE_NAME);
  });
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  const applyMode = useCallback((value: ColorMode) => {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return;
    }
    const next = value === "system" ? getSystemPref() : value;
    setResolved(next);
    document.documentElement.classList.toggle("dark", next === "dark");

    const link = document.getElementById(
      "primereact-theme",
    ) as HTMLLinkElement | null;
    if (link) {
      const themeName =
        next === "dark" ? "lara-dark-indigo" : "lara-light-indigo";
      link.href = `/themes/${themeName}/theme.css`;
      // Re-apply user's primary color to the new theme CSS.
      reapplyThemeRecolor();
    }
  }, []);

  const setMode = useCallback(
    (value: ColorMode) => {
      if (typeof window === "undefined") {
        return;
      }
      setModeState(value);
      writeColorModeCookie(
        COOKIE_NAME,
        value,
        window.location.protocol === "https:",
      );
      applyMode(value);
    },
    [applyMode],
  );

  // Apply the persisted mode on first mount
  useEffect(() => {
    applyMode(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useMemo(
    () => ({
      mode,
      resolved,
      applyMode,
      setMode,
      toggle: () => setMode(resolved === "dark" ? "light" : "dark"),
    }),
    [applyMode, mode, resolved, setMode],
  );
}
