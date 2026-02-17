"use client";

import { useEffect } from "react";

export function AppReadySignal() {
  useEffect(() => {
    requestAnimationFrame(() => {
      document.documentElement.dataset.appReady = "true";
    });
  }, []);

  return null;
}
