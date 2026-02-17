"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  // Always start with "system" to match server render and avoid hydration mismatch.
  // The real value from the cookie is synced in a useEffect below.
  const [mode, setModeState] = useState<ColorMode>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");
  const didSyncRef = useRef(false);

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

  // Sync the real persisted mode from the cookie after first mount
  useEffect(() => {
    if (didSyncRef.current) return;
    didSyncRef.current = true;
    const persisted = getInitialColorMode(document.cookie, COOKIE_NAME);
    if (persisted !== "system") {
      setModeState(persisted);
    }
    applyMode(persisted);
  }, [applyMode]);

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
