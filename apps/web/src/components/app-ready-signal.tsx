"use client";

import { useEffect } from "react";

export function AppReadySignal() {
  useEffect(() => {
    let cancelled = false;
    const reveal = () => {
      if (!cancelled) {
        document.documentElement.dataset.appReady = "true";
      }
    };

    requestAnimationFrame(() => {
      reveal();
    });

    const fallbackTimer = window.setTimeout(reveal, 1500);

    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimer);
    };
  }, []);

  return null;
}
