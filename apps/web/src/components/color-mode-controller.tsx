"use client";

import { useEffect } from "react";
import { useColorMode } from "@/hooks/use-color-mode";

export function ColorModeController() {
  const { mode, applyMode, setMode } = useColorMode();

  useEffect(() => {
    applyMode(mode);
  }, [applyMode, mode]);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const listener = () => {
      if (mode === "system") {
        applyMode("system");
      }
    };

    if (!media) return;
    media.addEventListener?.("change", listener);
    return () => media.removeEventListener?.("change", listener);
  }, [applyMode, mode]);

  useEffect(() => {
    (
      window as typeof window & {
        __setColorMode?: (value: "light" | "dark" | "system") => void;
      }
    ).__setColorMode = (value) => setMode(value);
  }, [setMode]);

  return null;
}
